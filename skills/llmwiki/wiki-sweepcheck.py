#!/usr/bin/env python3
"""
llmwiki sweep-debt checker — the sentinel for paired writes.

A register entry that names a note ("Affects: [[05_utils#config_load]]") is
half a write; the note must carry a matching stamp
("<!-- swept: config_load 2026-03-14 -->") dated on/after the entry. This
script finds the halves that never got their pair — deterministically, no
LLM calls.

Runs in two places:
- SessionStart hook: `wiki-sweepcheck.py --hook` (JSON on stdin, like the
  other wiki-* hooks): prints unswept debt from earlier sessions as context
  and ALWAYS exits 0, so the report reliably reaches the session (a nonzero
  SessionStart exit would surface as a hook error instead of context).
  Silent when clean. The flag is explicit because CLI callers may hold an
  open stdin that never delivers EOF — auto-detection would block.
- CLI, `--json`: `wiki-sweepcheck.py --json [PROJECT_DIR]` prints one JSON
  object on stdout and NOTHING else, keeping the exit codes below. This is
  how a verdict reaches a GUI: the reader gets records, never a report to
  regex for a filename.
- CLI, from `/llmwiki close`: `wiki-sweepcheck.py [PROJECT_DIR]`
  (default: the project root found by walking up from cwd; stdin never
  read). Exit 1 = debt (close gates on it). Exit 3 = the checker itself
  failed — that is NOT debt and must not be treated as an unclearable gate.

Enforcement is ON by default and starts from a cutoff date, so no historical
entry ever needs touching:
- an explicit "Sweep cutoff: YYYY-MM-DD" line in the CLAUDE.md llmwiki block
  wins if present;
- otherwise the cutoff is recorded per project the first time this script
  runs there (today's date, stored under ~/.claude/sessions/<hash>/), so a
  project is protected from install day forward without editing any file.
Entries dated ON OR BEFORE the cutoff are skipped, as are undated entries.

Scope: entries dated within the last LLMWIKI_SWEEP_WINDOW_DAYS days
(default 30) and after the cutoff. Unswept entries older than the window
are counted in one summary line but do not fail the check.

An entry whose [[link]] carries no #anchor cannot be checked; it is reported
as a warning with a count, never as debt — the pre-anchor corpus is the
normal state of every existing wiki, not an error.

Hook Event: SessionStart. Exits silently for projects without an llmwiki block.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import sys
from pathlib import Path

DEFAULT_WINDOW_DAYS = 30
MAX_LISTED = 12          # per section, in hook mode — a wall of text trains skimming
MAX_PARENTS = 8          # how far up to look for the project root

# Capped registers whose Affects:/Touches: lines are enforced.
REGISTERS = [
    "decisions.md",
    "findings.md",
    "contentions.md",
    "gotchas.md",
    "tried.md",
    "ideas.md",
    "budgets.md",
    "deletions.md",
]

WIKI_RE = re.compile(r"^\s*-\s*Wiki root:\s*`?([^\s`]+)", re.MULTILINE)
CUTOFF_RE = re.compile(r"^\s*-\s*Sweep cutoff:\s*`?(\d{4}-\d{2}-\d{2})", re.MULTILINE)
# The clause we enforce starts at Affects:/Touches: and runs to the end of the
# logical entry. Links BEFORE it (prose citations, "supersedes [[x]]") are not
# claims about what was swept.
AFFECTS_RE = re.compile(r"\b(?:Affects|Touches):")
# Targets and anchors may be non-ASCII (German note names are normal here).
# A pipe label ([[target|label]]) is stripped by split, not matched here.
LINK_RE = re.compile(r"\[\[\s*([^\[\]#|]+?)\s*(?:#\s*([^\[\]#|]+?)\s*)?\]\]")
# A trailing letter disambiguates same-day entries (2026-08-25a) and must not
# hide the date. Reject a longer digit run or an ISO range joined by a dash.
DATE_RE = re.compile(r"(?<![\d-])(\d{4}-\d{2}-\d{2})(?![\d-])")
STAMP_RE = re.compile(r"<!--\s*swept:\s*([^\s>]+)\s+(\d{4}-\d{2}-\d{2})[^>]*-->")
PENDING_RE = re.compile(r"\(\s*pending\b", re.IGNORECASE)

# A pair is register -> NOTE. A link to another register, to state, or to the
# maintenance log is a cross-reference ("Touches: [[contentions#C4]]" is in the
# schema's own decision template) and carries no sweep obligation.
NOT_NOTES = {r.lower() for r in REGISTERS} | {"00_state.md", "wikilog.md"}


def parse_date(s: str) -> dt.date | None:
    try:
        return dt.date.fromisoformat(s)
    except ValueError:
        return None


def date_today() -> dt.date:
    """One pinnable clock reading. `run-tests.sh` calls the checkers ~40 times
    against absolutely-dated fixtures, so a run that straddles midnight changes
    an answer half way through; LLMWIKI_TODAY pins it. A malformed value falls
    back to the real clock — a bad env var must never break a SessionStart hook.
    """
    return parse_date(os.environ.get("LLMWIKI_TODAY", "").strip()) or dt.date.today()


def window_days() -> int:
    """Never let a bad env var crash a SessionStart hook, and never let a
    non-positive window silently disable the check."""
    raw = os.environ.get("LLMWIKI_SWEEP_WINDOW_DAYS", "")
    try:
        n = int(raw)
    except ValueError:
        return DEFAULT_WINDOW_DAYS
    return n if n > 0 else DEFAULT_WINDOW_DAYS


def find_project_root(start: Path) -> Path:
    """The Bash tool carries `cd` across calls, so cwd is not the project.
    Walk up for the CLAUDE.md that declares a wiki; fall back to `start`."""
    here = start.resolve()
    for cand in [here, *list(here.parents)[:MAX_PARENTS]]:
        cm = cand / "CLAUDE.md"
        try:
            if cm.is_file() and WIKI_RE.search(
                cm.read_text(encoding="utf-8", errors="replace")
            ):
                return cand
        except OSError:
            continue
    return here


def parse_claude_md(project_dir: Path) -> tuple[Path | None, dt.date | None, str]:
    """Return (wiki_root, explicit_cutoff, note). `note` explains a None root
    so a typo'd path is never reported as 'no wiki here'."""
    claude_md = project_dir / "CLAUDE.md"
    if not claude_md.is_file():
        return None, None, "no CLAUDE.md"
    try:
        text = claude_md.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return None, None, f"CLAUDE.md unreadable ({e.__class__.__name__})"
    m = WIKI_RE.search(text)
    if not m:
        return None, None, "no 'Wiki root:' line in CLAUDE.md"
    rel = m.group(1).strip().rstrip("/")
    root = project_dir / rel
    if not root.is_dir():
        return None, None, f"declared wiki root does not exist: {rel}"
    c = CUTOFF_RE.search(text)
    return root, (parse_date(c.group(1)) if c else None), ""


def derived_cutoff(project_dir: Path, today: dt.date) -> dt.date:
    """Protection without an opt-in edit: remember the first day the checker
    saw this project and enforce only what is written after it. A neglected
    wiki gets covered by simply being opened."""
    h = hashlib.md5(str(project_dir).encode()).hexdigest()[:8]
    path = Path.home() / ".claude" / "sessions" / h / "wiki-sweepcheck-state.json"
    try:
        d = parse_date(json.loads(path.read_text()).get("cutoff", ""))
        if d is not None:
            return d
    except (OSError, ValueError, AttributeError, json.JSONDecodeError):
        pass
    # `--no-persist` is for a *reader* rather than a session: a GUI that polls
    # this must not pin a project's cutoff simply because someone opened the
    # folder to look at it. It still derives today, it just does not remember
    # it, so the first real session is what sets the line (bug hunt 2026-08-27).
    if "--no-persist" in sys.argv[1:]:
        return today
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"cutoff": today.isoformat()}))
    except OSError:
        pass
    return today


def resolve_target(wiki: Path, target: str, index: dict) -> Path | None:
    """[[05_utils]] -> the note anywhere under the wiki, archive/ included:
    archiving a note must not turn every entry that named it into permanent
    debt clearable only by editing an append-only register."""
    name = target.split("|")[0].strip()
    name = name if name.endswith(".md") else name + ".md"
    direct = wiki / name
    if direct.is_file():
        return direct
    if not index:
        try:
            for p in wiki.rglob("*.md"):
                index.setdefault(p.name.lower(), p)
        except OSError:
            pass
    return index.get(Path(name).name.lower())


def stamps_in(path: Path, cache: dict) -> list[tuple[str, dt.date]]:
    if path not in cache:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            text = ""
        found = []
        for anchor, date_s in STAMP_RE.findall(text):
            d = parse_date(date_s)
            if d is not None:
                found.append((anchor.casefold(), d))
        cache[path] = found
    return cache[path]


def logical_entries(lines: list[str]):
    """Yield (lineno, text, header_date) per logical entry. A register entry
    is a '## ' block or a '- ' bullet; an Affects: clause that wraps onto
    continuation lines belongs to the entry that opened it, so the wrapped
    targets are seen. A '## ' header carrying two dates (an era range) dates
    nothing — inheriting its first date invents a date for every bullet."""
    header_date: dt.date | None = None
    buf: list[str] = []
    start = 0
    buf_header: dt.date | None = None

    def flush():
        if buf:
            return (start, " ".join(s.strip() for s in buf), buf_header)
        return None

    for lineno, line in enumerate(lines, 1):
        opens = line.startswith("## ") or re.match(r"^\s*[-*]\s+\S", line)
        if opens:
            done = flush()
            if done:
                yield done
            buf, start, buf_header = [], lineno, header_date
            if line.startswith("## "):
                dates = DATE_RE.findall(line)
                header_date = parse_date(dates[0]) if len(dates) == 1 else None
                buf_header = header_date
        if not line.strip():
            done = flush()
            if done:
                yield done
            buf = []
            continue
        if buf or opens:
            buf.append(line)
        else:
            buf, start, buf_header = [line], lineno, header_date
    done = flush()
    if done:
        yield done


def scan(wiki: Path, cutoff: dt.date, today: dt.date, win: int):
    """(debt, pending, unanchored, stale_count). The first three are lists of
    records, not strings: a caller that has to regex a report to find a
    filename has been handed the wrong shape, and one of those callers is a
    renderer forbidden to parse paths at all. `report()` formats them; `--json`
    emits them."""
    window_start = today - dt.timedelta(days=win)
    debt: list[dict] = []
    pending: list[dict] = []
    unanchored: list[dict] = []
    stale_count = 0
    stamp_cache: dict = {}
    note_index: dict = {}

    for reg_name in REGISTERS:
        reg = wiki / reg_name
        if not reg.is_file():
            continue
        try:
            lines = reg.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue

        for lineno, text, header_date in logical_entries(lines):
            m_aff = AFFECTS_RE.search(text)
            if not m_aff:
                continue
            clause = text[m_aff.end():]

            # A date on the entry itself wins over its section header's.
            m = DATE_RE.search(text)
            entry_date = (parse_date(m.group(1)) if m else None) or header_date
            # <= cutoff, not <: "cutoff = today" must mean "nothing written
            # so far is debt", which is what the migration promises.
            if entry_date is None or entry_date <= cutoff:
                continue

            links = LINK_RE.findall(clause)
            in_window = entry_date >= window_start

            if not links:
                # "Affects: none", or a plain-text note name. Nothing to check
                # and nothing wrong; silence beats a false "malformed".
                continue

            if PENDING_RE.search(clause):
                for target, anchor in links:
                    pending.append({
                        "register": reg_name, "line": lineno,
                        "date": entry_date.isoformat(),
                        "target": target, "anchor": anchor or None,
                    })
                continue

            seen: set[tuple[str, str]] = set()
            for target, anchor in links:
                if (target, anchor) in seen:
                    continue          # the same target twice on one line is one claim
                seen.add((target, anchor))
                path = resolve_target(wiki, target, note_index)
                if path is not None and path.name.lower() in NOT_NOTES:
                    continue
                if path is None:
                    problem = f"target [[{target}]] not found in wiki"
                elif not anchor:
                    if in_window:
                        unanchored.append({
                            "register": reg_name, "line": lineno,
                            "date": entry_date.isoformat(),
                            "target": target, "note": path.name,
                        })
                    continue
                else:
                    ok = any(
                        a == anchor.casefold() and d >= entry_date
                        for a, d in stamps_in(path, stamp_cache)
                    )
                    problem = (
                        None
                        if ok
                        else (
                            f"{path.name}#{anchor} — no "
                            f"<!-- swept: {anchor} YYYY-MM-DD --> dated >= {entry_date}"
                        )
                    )
                if problem:
                    if in_window:
                        debt.append({
                            "register": reg_name, "line": lineno,
                            "date": entry_date.isoformat(),
                            "target": target, "anchor": anchor or None,
                            "note": path.name if path is not None else None,
                            "problem": problem,
                        })
                    else:
                        stale_count += 1

    return debt, pending, unanchored, stale_count


def _fmt_debt(r: dict) -> str:
    return f"  {r['register']}:{r['line']} → {r['problem']}"


def _fmt_pending(r: dict) -> str:
    frag = f"#{r['anchor']}" if r["anchor"] else ""
    return f"  {r['register']}:{r['line']} → [[{r['target']}{frag}]] (deferred)"


def _fmt_unanchored(r: dict) -> str:
    return f"  {r['register']}:{r['line']} → [[{r['target']}]] ({r['note']})"


def _clip(lines: list[str], hook_mode: bool) -> list[str]:
    if not hook_mode or len(lines) <= MAX_LISTED:
        return lines
    return lines[:MAX_LISTED] + [f"  …and {len(lines) - MAX_LISTED} more"]


def report(debt, pending, unanchored, stale_count, cutoff, win, hook_mode) -> str:
    out = []
    tag = "[llmwiki]" if hook_mode else "[llmwiki sweepcheck]"
    if debt:
        n = len(debt)
        if hook_mode:
            head = (
                f"{tag} sweep debt left by an earlier session — the notes below "
                f"still state the superseded version. Sweep them BEFORE new "
                f"work (cutoff {cutoff}, window {win}d):"
            )
        else:
            head = (
                f"{tag} SWEEP DEBT — {n} unswept link"
                f"{'' if n == 1 else 's'} (cutoff {cutoff}, window {win}d):"
            )
        out.append(head)
        out.extend(_clip([_fmt_debt(r) for r in debt], hook_mode))
        out.append(
            "  Fix: edit each target note at the claim, smallest edit that "
            "makes it true, and append <!-- swept: <anchor> YYYY-MM-DD --> "
            "on the edited line."
        )
    if pending:
        out.append(f"{tag} pending (deferred, not debt):")
        out.extend(_clip([_fmt_pending(r) for r in pending], hook_mode))
    if unanchored:
        n = len(unanchored)
        out.append(
            f"{tag} {n} entr{'y names' if n == 1 else 'ies name'} a note "
            f"without an #anchor, so the pair cannot be checked (not debt; "
            f"anchor new entries as [[note#anchor]]):"
        )
        out.extend(_clip([_fmt_unanchored(r) for r in unanchored], hook_mode))
    if stale_count:
        out.append(
            f"{tag} {stale_count} unswept link"
            f"{'' if stale_count == 1 else 's'} older than the "
            f"{win}d window — sweep or archive when next in the register."
        )
    return "\n".join(out)


def _emit_json(payload: dict) -> None:
    print(json.dumps(payload, indent=1))


def run() -> int:
    hook_mode = "--hook" in sys.argv[1:]
    as_json = "--json" in sys.argv[1:] and not hook_mode
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    project_dir = None

    if hook_mode:
        try:
            hook_input = json.load(sys.stdin)
        except Exception:
            hook_input = {}
        cwd = hook_input.get("cwd", "") if isinstance(hook_input, dict) else ""
        if not cwd:
            return 0
        project_dir = find_project_root(Path(cwd))

    if project_dir is None:
        project_dir = find_project_root(Path(args[0]) if args else Path.cwd())

    if not project_dir.is_dir():
        if as_json:
            _emit_json({"project": str(project_dir), "ok": False,
                        "note": "not a directory", "wiki": None})
            return 2
        if not hook_mode:
            print(f"[llmwiki sweepcheck] not a directory: {project_dir}")
            return 2
        return 0

    wiki, cutoff, note = parse_claude_md(project_dir)
    if wiki is None:
        if as_json:
            _emit_json({"project": str(project_dir), "ok": True,
                        "note": note, "wiki": None})
            return 0
        if not hook_mode:
            print(f"[llmwiki sweepcheck] no wiki checked here — {note}.")
        return 0

    today = date_today()
    source = "declared"
    if cutoff is None:
        cutoff = derived_cutoff(project_dir, today)
        source = "derived (first run here; add 'Sweep cutoff:' to CLAUDE.md to pin it)"

    win = window_days()
    debt, pending, unanchored, stale_count = scan(wiki, cutoff, today, win)

    if as_json:
        _emit_json({
            "project": str(project_dir), "ok": True, "note": None,
            "wiki": str(wiki), "cutoff": cutoff.isoformat(),
            "cutoff_source": source, "window_days": win,
            "clean": not (debt or pending or unanchored or stale_count),
            "debt": debt, "pending": pending, "unanchored": unanchored,
            "stale_count": stale_count,
        })
        return 1 if debt else 0

    if debt or pending or unanchored or stale_count:
        print(report(debt, pending, unanchored, stale_count, cutoff, win, hook_mode))
    elif not hook_mode:
        print(
            f"[llmwiki sweepcheck] clean (cutoff {cutoff}, {source}, window {win}d)."
        )

    return 1 if (debt and not hook_mode) else 0


def main():
    # A checker that crashes must never look like debt, and must never break
    # a SessionStart hook. Exit 3 is "the checker failed"; close does not gate
    # on it.
    try:
        sys.exit(run())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 - deliberate catch-all
        if "--hook" in sys.argv[1:]:
            sys.exit(0)
        print(f"[llmwiki sweepcheck] checker error ({e.__class__.__name__}: {e}) — "
              "this is NOT sweep debt; close is not gated on it.")
        sys.exit(3)


if __name__ == "__main__":
    main()
