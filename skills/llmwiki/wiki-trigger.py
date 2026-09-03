#!/usr/bin/env python3
"""
llmwiki custom trigger checker — a landed artefact nags until the wiki has it.

Project instructions are full of sentences like "run /llmwiki lint after a
payload round returns." Nobody disobeys them on purpose; nothing says *now*.
This turns such a sentence into something that checks itself: when a thing
lands, a marker says "not written up yet", and anything that starts up can look
for markers. A marker still sitting there on Thursday means something landed on
Tuesday and nobody wrote it down.

Generalised from `payload/payload_check.py` in a project that had twenty rounds
land unrecorded (journal 2026-08-26e). Three debt kinds, all three real:

  unswept   the artefact's marker file still carries the marker
  unfiled   the artefact has no marker file at all — landed by hand
  unlinked  the artefact's name appears nowhere in the wiki or journal, or only
            on lines that themselves still carry the marker

Declared per project in CLAUDE.md's machine-readable lines, beside `Wiki root:`:

  - Trigger: <name> | <glob> | marker:<filename>
  - Trigger: <name> | <glob> | mention

`marker:` mode reports unswept + unfiled; `mention` mode reports unlinked. A
project needing both declares two triggers over the same folder. **Nothing in a
declaration is a command** — there is no field a program could be named in, and
that omission is most of what makes this safe to read from a GUI.

Three callers, the contract the other wiki-* checkers already keep:

  wiki-trigger.py --hook        SessionStart (JSON on stdin), ALWAYS exits 0
  wiki-trigger.py [DIR]         CLI, exit 1 on debt — /llmwiki close gates here
  wiki-trigger.py --json [DIR]  one JSON object on stdout and nothing else,
                                keeping the exit codes, for a GUI
  wiki-trigger.py --mark PATH   arm one artefact by writing its marker file.
                                For projects whose producers are a human and a
                                drag — without it this only works where someone
                                already built the plumbing.

BACKLOG IS NOT DEBT. The first run records a cutoff; artefacts dated on or
before it are counted in one line and never nag. An artefact is dated by its
name where the name carries a date, and otherwise by its newest content. Without that, switching this on
in an old project buries you and you switch it off again.

Exit codes: 0 clean · 1 debt · 3 the checker itself failed (never debt).
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import sys
from pathlib import Path

MAX_PARENTS = 6
MAX_LISTED = 8
MAX_SCAN_BYTES = 2_000_000

WIKI_RE = re.compile(r"^\s*[-*]?\s*Wiki root:\s*(.+?)\s*$", re.MULTILINE)
JOURNAL_RE = re.compile(r"^\s*[-*]?\s*Journal:\s*(.+?)\s*$", re.MULTILINE)
CUTOFF_RE = re.compile(r"^\s*[-*]?\s*Trigger cutoff:\s*(\d{4}-\d{2}-\d{2})\s*$", re.MULTILINE)
TRIGGER_RE = re.compile(r"^\s*[-*]?\s*Trigger:\s*(.+?)\s*$", re.MULTILINE)


def declared_dir(value: str) -> str:
    """A declared path, as CLAUDE.md may write it: an inline code span is markup,
    not path, and the trailing slash is decoration (the other hooks strip both)."""
    return value.strip().strip("`").strip().rstrip("/")

# The one grammar, both tenses. `swept` marks a claim done (the sweep sentinel);
# `unswept` marks an artefact owed. One regex serves both hooks, which is what
# journal 2026-08-26e asked for.
MARKER_RE = re.compile(r"<!--\s*(un)?swept:\s*([^\s]+)(?:\s+([^\s]+))?[^>]*-->")
# The legacy spelling, kept readable on purpose: the project this was
# generalised from writes `<-- unswept -->`, which is NOT a well-formed HTML
# comment and so renders as visible text in a markdown reader. It is recognised
# so a real project can be checked before it is migrated, never emitted.
LEGACY_UNSWEPT_RE = re.compile(r"<--\s*unswept\s*-->")

# Two leaf date shapes, inferred rather than declared: `20260826d` (the payload
# rounds) and `2026-08-26_slug` (every llmwiki journal entry).
LEAF_DATE_RES = (re.compile(r"^(\d{8})"), re.compile(r"^(\d{4}-\d{2}-\d{2})"))


def parse_date(s: str) -> dt.date | None:
    try:
        return dt.date.fromisoformat(s.strip())
    except (ValueError, AttributeError):
        return None


def date_today() -> dt.date:
    """One pinnable clock reading. `run-tests.sh` calls the checkers ~40 times
    against absolutely-dated fixtures, so a run that straddles midnight changes
    an answer half way through; LLMWIKI_TODAY pins it. A malformed value falls
    back to the real clock — a bad env var must never break a SessionStart hook.
    """
    return parse_date(os.environ.get("LLMWIKI_TODAY", "").strip()) or dt.date.today()


def leaf_date(name: str) -> dt.date | None:
    """The date a leaf name carries, or None if it carries none — in which case
    `artefact_date` asks the contents instead."""
    for rx in LEAF_DATE_RES:
        m = rx.match(name)
        if not m:
            continue
        raw = m.group(1)
        try:
            return (
                dt.datetime.strptime(raw, "%Y%m%d").date()
                if len(raw) == 8
                else dt.date.fromisoformat(raw)
            )
        except ValueError:
            return None
    return None


def content_date(path: Path) -> dt.date | None:
    """The date an artefact's *contents* carry: the newest mtime under it. A
    leaf's name is one piece of evidence about when it landed, not the only one
    — an undated round full of July files is backlog, and a checker that nags
    about backlog forever is one you switch off. None when there is nothing to
    read at all."""
    try:
        leaves = path.rglob("*") if path.is_dir() else [path]
        stamps = [p.stat().st_mtime for p in leaves if p.is_file()]
    except OSError:
        return None
    return dt.date.fromtimestamp(max(stamps)) if stamps else None


def artefact_date(path: Path) -> dt.date | None:
    """When this landed: its name's date, else its newest content's. Only when
    neither exists — an empty or unreadable leaf — is it checked unconditionally,
    so a badly named artefact still cannot escape silently."""
    return leaf_date(path.name) or content_date(path)


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


def parse_declaration(project_dir: Path):
    """(wiki, journal, triggers, explicit_cutoff, note). A malformed Trigger
    line becomes a named problem, never a silent skip: a trigger that quietly
    does not run is worse than none, because it reads as 'nothing is owed'."""
    claude_md = project_dir / "CLAUDE.md"
    if not claude_md.is_file():
        return None, None, [], None, "no CLAUDE.md"
    try:
        text = claude_md.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return None, None, [], None, f"CLAUDE.md unreadable ({e.__class__.__name__})"

    m = WIKI_RE.search(text)
    if not m:
        return None, None, [], None, "no 'Wiki root:' line in CLAUDE.md"
    wiki = project_dir / declared_dir(m.group(1))
    if not wiki.is_dir():
        return None, None, [], None, f"declared wiki root does not exist: {declared_dir(m.group(1))}"

    j = JOURNAL_RE.search(text)
    journal = project_dir / declared_dir(j.group(1)) if j else None
    if journal is not None and not journal.is_dir():
        journal = None

    triggers, problems = [], []
    for raw in TRIGGER_RE.findall(text):
        parts = [p.strip() for p in raw.split("|")]
        if len(parts) != 3 or not all(parts):
            problems.append(f"malformed Trigger line (want 'name | glob | mode'): {raw}")
            continue
        name, glob, mode = parts
        if mode == "mention":
            triggers.append({"name": name, "glob": glob, "mode": "mention", "marker_file": None})
        elif mode.startswith("marker:") and mode[len("marker:"):].strip():
            triggers.append({
                "name": name, "glob": glob, "mode": "marker",
                "marker_file": mode[len("marker:"):].strip(),
            })
        else:
            problems.append(f"unknown mode {mode!r} in Trigger {name!r} (want 'mention' or 'marker:<file>')")

    c = CUTOFF_RE.search(text)
    return wiki, journal, triggers, (parse_date(c.group(1)) if c else None), "; ".join(problems)


def derived_cutoff(project_dir: Path, today: dt.date) -> dt.date:
    """Protection without an opt-in edit, the same bargain wiki-sweepcheck
    makes: remember the first day this ran here and nag only about what landed
    after it. There is no opt-in because a project nobody configures is exactly
    the project that goes stale."""
    h = hashlib.md5(str(project_dir).encode()).hexdigest()[:8]
    path = Path.home() / ".claude" / "sessions" / h / "wiki-trigger-state.json"
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


def is_marked(text: str) -> bool:
    """Does this text still say 'not written up'? Both spellings count."""
    if LEGACY_UNSWEPT_RE.search(text):
        return True
    return any(m.group(1) == "un" for m in MARKER_RE.finditer(text))


def artefacts(project_dir: Path, glob: str):
    """Every path the glob names, newest-name last. Directories and files both:
    a payload round is a folder, an export may be a single file."""
    try:
        return sorted((p for p in project_dir.glob(glob)), key=lambda p: p.name)
    except (ValueError, OSError):
        return []


def _read(path: Path) -> str:
    try:
        if path.stat().st_size > MAX_SCAN_BYTES:
            return ""
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def mention_lines(haystacks, name: str):
    """Lines naming `name` anywhere in the wiki/journal. A line that itself
    still carries the marker is a placeholder, not a write-up — the producer
    stamps one when the artefact lands, so counting it would clear the debt the
    moment it was created."""
    hits = []
    for root in haystacks:
        if root is None or not root.is_dir():
            continue
        for f in sorted(root.rglob("*.md")):
            text = _read(f)
            if name not in text:
                continue
            for line in text.splitlines():
                if name in line and line.strip():
                    hits.append(line)
    return hits


def check(project_dir: Path, wiki: Path, journal, triggers, cutoff: dt.date):
    open_items, stale = [], 0
    haystacks = [wiki, journal]

    for trig in triggers:
        for path in artefacts(project_dir, trig["glob"]):
            d = artefact_date(path)
            if d is not None and d <= cutoff:
                stale += 1
                continue
            rel = str(path.relative_to(project_dir))
            if trig["mode"] == "marker":
                marker = path / trig["marker_file"] if path.is_dir() else path
                if path.is_dir() and not marker.is_file():
                    open_items.append({
                        "trigger": trig["name"], "kind": "unfiled", "path": rel,
                        "date": d.isoformat() if d else None,
                        "detail": f"no {trig['marker_file']} — landed by hand?",
                    })
                elif is_marked(_read(marker)):
                    open_items.append({
                        "trigger": trig["name"], "kind": "unswept", "path": rel,
                        "date": d.isoformat() if d else None,
                        "detail": f"{trig['marker_file']} is still marked unswept",
                    })
            else:
                lines = mention_lines(haystacks, path.name)
                if not any(not is_marked(ln) for ln in lines):
                    open_items.append({
                        "trigger": trig["name"], "kind": "unlinked", "path": rel,
                        "date": d.isoformat() if d else None,
                        "detail": (
                            "named nowhere in the wiki or journal"
                            if not lines
                            else f"named only on {len(lines)} line(s) that are themselves unswept"
                        ),
                    })
    return open_items, stale


def _clip(lines, hook_mode: bool):
    if not hook_mode or len(lines) <= MAX_LISTED:
        return lines
    return lines[:MAX_LISTED] + [f"  …and {len(lines) - MAX_LISTED} more"]


def report(open_items, stale, cutoff, problems, hook_mode: bool) -> str:
    tag = "[llmwiki]" if hook_mode else "[llmwiki trigger]"
    out = []
    if open_items:
        out.append(f"{tag} landed and not written up yet:")
        out.extend(_clip(
            [f"  {i['kind'].upper():<9} {i['path']}   {i['detail']}" for i in open_items],
            hook_mode,
        ))
        out.append(
            "  To clear: write the line in the wiki that says what this was, "
            "then delete its <!-- unswept: … --> marker."
        )
    if problems:
        out.append(f"{tag} declaration problem: {problems}")
    if stale and open_items:
        out.append(f"  ({stale} artefact(s) predate the {cutoff} cutoff — backlog, not debt.)")
    return "\n".join(out)


def mark(path: Path, project_dir: Path, triggers) -> int:
    """Write the 'not written up yet' marker into one artefact.

    The marker file's name comes from whichever declared trigger's glob matches
    the path, so a hand-dropped artefact arms exactly the trigger that will
    later ask about it. No match, or a mention-mode match, gets `UNSWEPT.md` —
    visible in a file listing, which is the point."""
    if not path.exists():
        print(f"[llmwiki trigger] nothing at {path}")
        return 2
    name, target = None, None
    for trig in triggers:
        if any(path.resolve() == c.resolve() for c in artefacts(project_dir, trig["glob"])):
            name = trig["name"]
            target = path / trig["marker_file"] if (path.is_dir() and trig["marker_file"]) else None
            break
    if target is None:
        target = (path if path.is_file() else path / "UNSWEPT.md")
    if target.is_file() and is_marked(_read(target)):
        print(f"[llmwiki trigger] already marked: {target}")
        return 0
    stamp = f"<!-- unswept: {name or 'artefact'} {path.name} -->"
    try:
        existing = _read(target) if target.is_file() else ""
        # Appended, never overwritten: a producer's own RETURN.txt already holds
        # the machine's half, and losing it is the one thing this must not do.
        target.write_text(f"{existing.rstrip()}\n{stamp}\n" if existing.strip() else f"{stamp}\n",
                          encoding="utf-8")
    except OSError as e:
        print(f"[llmwiki trigger] could not write {target}: {e}")
        return 2
    print(f"[llmwiki trigger] marked {target}\n  {stamp}\n"
          f"  It will be reported until a line naming '{path.name}' is in the wiki "
          f"and this marker is deleted.")
    return 0


def run() -> int:
    hook_mode = "--hook" in sys.argv[1:]
    as_json = "--json" in sys.argv[1:] and not hook_mode
    mark_mode = "--mark" in sys.argv[1:] and not hook_mode
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    project_dir = None

    if hook_mode:
        try:
            data = json.load(sys.stdin)
        except Exception:
            data = {}
        cwd = data.get("cwd", "") if isinstance(data, dict) else ""
        if not cwd:
            return 0
        project_dir = find_project_root(Path(cwd))
    if project_dir is None:
        project_dir = find_project_root(Path(args[0]) if args else Path.cwd())

    if not project_dir.is_dir():
        if as_json:
            print(json.dumps({"project": str(project_dir), "wiki": None,
                              "note": "not a directory", "open": []}, indent=1))
            return 2
        if not hook_mode:
            print(f"[llmwiki trigger] not a directory: {project_dir}")
            return 2
        return 0

    wiki, journal, triggers, cutoff, note = parse_declaration(project_dir)
    if wiki is None:
        if as_json:
            print(json.dumps({"project": str(project_dir), "wiki": None,
                              "note": note, "open": []}, indent=1))
            return 0
        if not hook_mode:
            print(f"[llmwiki trigger] no wiki checked here — {note}.")
        return 0

    today = date_today()
    source = "declared"
    if cutoff is None:
        cutoff = derived_cutoff(project_dir, today)
        source = "derived (first run here; add 'Trigger cutoff:' to CLAUDE.md to pin it)"

    if mark_mode:
        if not args:
            print("[llmwiki trigger] --mark needs a path to an artefact.")
            return 2
        return mark(Path(args[0]).resolve(), project_dir, triggers)

    if not triggers and not note:
        if as_json:
            print(json.dumps({"project": str(project_dir), "wiki": str(wiki),
                              "note": "no Trigger lines declared", "open": []}, indent=1))
            return 0
        if not hook_mode:
            print("[llmwiki trigger] no Trigger lines in CLAUDE.md — nothing to check. "
                  "Declare one: '- Trigger: <name> | <glob> | marker:<file>' or '| mention'.")
        return 0

    open_items, stale = check(project_dir, wiki, journal, triggers, cutoff)

    if as_json:
        print(json.dumps({
            "project": str(project_dir), "wiki": str(wiki),
            "journal": str(journal) if journal else None, "note": note or None,
            "cutoff": cutoff.isoformat(), "cutoff_source": source,
            "triggers": triggers, "clean": not open_items,
            "open": open_items, "stale": stale,
        }, indent=1))
        return 1 if open_items else 0

    text = report(open_items, stale, cutoff, note, hook_mode)
    if text:
        print(text)
    elif not hook_mode:
        print(f"[llmwiki trigger] clean — every artefact since {cutoff} is in the wiki "
              f"({len(triggers)} trigger(s), cutoff {source}).")

    return 1 if (open_items and not hook_mode) else 0


def main():
    # A checker that crashes must never look like debt, and must never break a
    # SessionStart hook. Exit 3 is "the checker failed"; close does not gate on it.
    try:
        sys.exit(run())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 - deliberate catch-all
        if "--hook" in sys.argv[1:]:
            sys.exit(0)
        print(f"[llmwiki trigger] checker error ({e.__class__.__name__}: {e}) — "
              "this is NOT trigger debt; close is not gated on it.")
        sys.exit(3)


if __name__ == "__main__":
    main()
