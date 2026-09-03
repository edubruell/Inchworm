#!/usr/bin/env python3
"""
llmwiki overdue reporter — what has not run for too long.

The 2026-08-25 audit found the loop's real gap is not bad writing but absent
writing: `/llmwiki close` ran in 7 of 16 sessions in one project, two sessions
wrote nothing at all, `/llmwiki lint` stopped for 8 sessions with its own
"5+ sessions" trigger four days overdue, and `/llmwiki state` ran 0 times in
22 sessions — once immediately after a hook asked for it. None of that is
visible from inside a session, because the thing that did not happen leaves
no trace in context.

So this counts sessions per project and speaks only when something is
genuinely overdue. It is deliberately quiet: a reminder that fires every
session is one a reader learns to skip, which also costs the hooks printed
next to it. It never blocks and never edits.

  wiki-overdue.py --hook      SessionStart (JSON on stdin), always exit 0
  wiki-overdue.py [DIR]       CLI, exit 0 (report only), 3 on checker error
  wiki-overdue.py --json [DIR]  one JSON object on stdout and nothing else,
                              exit 0. READ-ONLY: it reports the session
                              counters without advancing them, because a GUI
                              that polls must not consume the count the next
                              SessionStart is meant to make.

Thresholds (env): LLMWIKI_JOURNAL_SESSIONS (3), LLMWIKI_JOURNAL_DAYS (7),
LLMWIKI_LINT_DAYS (30), LLMWIKI_LINT_SESSIONS (8).
"""

from __future__ import annotations

import datetime as dt
import hashlib
import importlib.util
import json
import os
import re
import sys
from pathlib import Path


def _env(name: str, default: int) -> int:
    try:
        v = int(os.environ.get(name, ""))
        return v if v > 0 else default
    except ValueError:
        return default


JOURNAL_SESSIONS = _env("LLMWIKI_JOURNAL_SESSIONS", 3)
JOURNAL_DAYS = _env("LLMWIKI_JOURNAL_DAYS", 7)
LINT_DAYS = _env("LLMWIKI_LINT_DAYS", 30)
LINT_SESSIONS = _env("LLMWIKI_LINT_SESSIONS", 8)

WIKI_RE = re.compile(r"^\s*-\s*Wiki root:\s*`?([^\s`]+)", re.MULTILINE)
# Nothing in the hook collection parsed this line before 2026-08-25, which is
# why a skipped journal entry was invisible while a skipped state write was not.
JOURNAL_RE = re.compile(r"^\s*-\s*Journal:\s*`?([^\s`]+)", re.MULTILINE)
FILE_DATE_RE = re.compile(r"(\d{4})[-_](\d{2})[-_](\d{2})")
LINT_LINE_RE = re.compile(r"(\d{4}-\d{2}-\d{2}).{0,40}\blint\b", re.IGNORECASE)


def parse_date(s: str):
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


def find_project_root(start: Path) -> Path:
    here = start.resolve()
    for cand in [here, *list(here.parents)[:8]]:
        cm = cand / "CLAUDE.md"
        try:
            if cm.is_file() and WIKI_RE.search(cm.read_text(encoding="utf-8", errors="replace")):
                return cand
        except OSError:
            continue
    return here


def paths_from_claude_md(project_dir: Path):
    cm = project_dir / "CLAUDE.md"
    if not cm.is_file():
        return None, None
    try:
        text = cm.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None, None
    mw = WIKI_RE.search(text)
    if not mw:
        return None, None
    wiki = project_dir / mw.group(1).strip().rstrip("/")
    mj = JOURNAL_RE.search(text)
    journal = project_dir / mj.group(1).strip().rstrip("/") if mj else None
    return (wiki if wiki.is_dir() else None), (journal if journal and journal.is_dir() else None)


def journal_mark(journal: Path, newest) -> str:
    """Date alone is not a mark: two entries on one day are two entries, and
    keying on the date left the counter running through a close that had just
    written one."""
    try:
        n = sum(1 for p in journal.iterdir()
                if p.is_file() and p.suffix.lower() in (".md", ".markdown")
                and FILE_DATE_RE.search(p.name))
    except OSError:
        n = 0
    return f"{newest.isoformat() if newest else 'none'}:{n}"


def newest_journal_date(journal: Path):
    """Filename conventions differ per project (2026-08-25_slug.md and
    2026_08_25_slug.md both occur), so read the date out of the name either
    way rather than globbing one pattern and reporting an empty journal."""
    best = None
    try:
        for p in journal.iterdir():
            if p.suffix.lower() not in (".md", ".markdown") or not p.is_file():
                continue
            m = FILE_DATE_RE.search(p.name)
            if not m:
                continue
            d = parse_date(f"{m.group(1)}-{m.group(2)}-{m.group(3)}")
            if d and (best is None or d > best):
                best = d
    except OSError:
        return None
    return best


def newest_lint_date(wiki: Path):
    for name in ("wikilog.md", "findings.md"):     # wikilog is the new home
        p = wiki / name
        if not p.is_file():
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        dates = [parse_date(m.group(1)) for m in LINT_LINE_RE.finditer(text)]
        dates = [d for d in dates if d]
        if dates:
            return max(dates), name
    return None, ""


def bump_counters(project_dir: Path, journal_mark_s: str, lint_date,
                  bump: bool = True) -> dict:
    """Sessions since the last journal entry / lint. Each counter resets when
    its marker moves, so 'sessions since' means what it says.

    `bump=False` reads without writing and without incrementing: a caller that
    only wants to display the count (the app, via --json) must not spend it."""
    h = hashlib.md5(str(project_dir).encode()).hexdigest()[:8]
    path = Path.home() / ".claude" / "sessions" / h / "wiki-overdue-state.json"
    state = {"journal_mark": "", "journal_sessions": 0, "lint_mark": "", "lint_sessions": 0}
    try:
        loaded = json.loads(path.read_text())
        if isinstance(loaded, dict):
            state.update({k: loaded.get(k, v) for k, v in state.items()})
    except (OSError, ValueError, json.JSONDecodeError):
        pass

    jm = journal_mark_s
    lm = lint_date.isoformat() if lint_date else ""
    if not bump:
        return {**state,
                "journal_sessions": 0 if state["journal_mark"] != jm else state["journal_sessions"],
                "lint_sessions": 0 if state["lint_mark"] != lm else state["lint_sessions"]}
    state["journal_sessions"] = 0 if state["journal_mark"] != jm else state["journal_sessions"] + 1
    state["lint_sessions"] = 0 if state["lint_mark"] != lm else state["lint_sessions"] + 1
    state["journal_mark"], state["lint_mark"] = jm, lm
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(state))
    except OSError:
        pass
    return state


def ripe_contentions(project_dir: Path):
    mod_path = Path(__file__).with_name("wiki-contentions.py")
    if not mod_path.is_file():
        return []
    try:
        spec = importlib.util.spec_from_file_location("wiki_contentions", mod_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        entries, _ = mod.load_contentions(project_dir)
        return [e for e in entries if e.get("ripe")]
    except Exception:            # a missing sibling must never break SessionStart
        return []


def collect(project_dir: Path, today: dt.date, bump: bool = True) -> dict:
    """The facts the report is made of. Separated so `--json` can emit records
    rather than a caller regexing prose back into fields."""
    wiki, journal = paths_from_claude_md(project_dir)
    if wiki is None:
        return {"wiki": None}
    jd = newest_journal_date(journal) if journal else None
    ld, ld_where = newest_lint_date(wiki)
    counts = bump_counters(
        project_dir, journal_mark(journal, jd) if journal else "none:0", ld, bump)
    return {
        "wiki": str(wiki), "journal": str(journal) if journal else None,
        "newest_journal": jd.isoformat() if jd else None,
        "journal_age_days": (today - jd).days if jd else None,
        "journal_sessions": counts["journal_sessions"],
        "newest_lint": ld.isoformat() if ld else None,
        "lint_age_days": (today - ld).days if ld else None,
        "lint_sessions": counts["lint_sessions"], "lint_source": ld_where,
        "ripe_contentions": [
            {"id": e["id"], "title": e.get("title")} for e in ripe_contentions(project_dir)
        ],
        "thresholds": {"journal_sessions": JOURNAL_SESSIONS,
                       "journal_days": JOURNAL_DAYS,
                       "lint_days": LINT_DAYS, "lint_sessions": LINT_SESSIONS},
    }


def lines_from(facts: dict) -> list[str]:
    """The report, formatted from `collect()`'s facts and nothing else. Kept
    apart from collection so `--json` can render the same verdict without
    spending a session counter on it."""
    if facts.get("wiki") is None:
        return []
    out: list[str] = []
    t = facts["thresholds"]

    if facts["journal"] is not None:
        jd, j_age = facts["newest_journal"], facts["journal_age_days"]
        n = facts["journal_sessions"]
        if jd is None:
            out.append("  · the journal has no dated entry at all — /llmwiki close writes one")
        elif n >= t["journal_sessions"] or j_age >= t["journal_days"]:
            out.append(
                f"  · no journal entry since {jd} ({j_age}d, "
                f"{n} session{'' if n == 1 else 's'}) — /llmwiki close"
            )

    ld, l_age, ln = facts["newest_lint"], facts["lint_age_days"], facts["lint_sessions"]
    if ld is None:
        out.append("  · no lint verdict on record — /llmwiki lint (it is the only fresh-context read)")
    elif l_age >= t["lint_days"] or ln >= t["lint_sessions"]:
        out.append(
            f"  · last lint {ld} ({l_age}d, {ln} sessions "
            f"ago, per {facts['lint_source']}) — /llmwiki lint"
        )

    ripe = facts["ripe_contentions"]
    if ripe:
        ids = ", ".join(e["id"] for e in ripe[:6])
        more = f" +{len(ripe) - 6}" if len(ripe) > 6 else ""
        out.append(
            f"  · {len(ripe)} contention{' looks' if len(ripe) == 1 else 's look'} "
            f"ripe ({ids}{more}) — /llmwiki resolve puts {'it' if len(ripe) == 1 else 'them'} "
            f"to the user"
        )
    return out


def build_report(project_dir: Path, today: dt.date) -> list[str]:
    return lines_from(collect(project_dir, today))


def main() -> int:
    hook_mode = "--hook" in sys.argv[1:]
    as_json = "--json" in sys.argv[1:] and not hook_mode
    args = [a for a in sys.argv[1:] if not a.startswith("--")]

    if hook_mode:
        try:
            data = json.load(sys.stdin)
        except Exception:
            data = {}
        cwd = data.get("cwd", "") if isinstance(data, dict) else ""
        if not cwd:
            return 0
        project_dir = find_project_root(Path(cwd))
    else:
        project_dir = find_project_root(Path(args[0]) if args else Path.cwd())

    if not project_dir.is_dir():
        if as_json:
            print(json.dumps({"project": str(project_dir), "wiki": None,
                              "note": "not a directory", "overdue": []}, indent=1))
        return 0

    today = date_today()
    if as_json:
        facts = collect(project_dir, today, bump=False)
        facts["project"] = str(project_dir)
        facts["overdue"] = lines_from(facts)
        print(json.dumps(facts, indent=1))
        return 0

    lines = build_report(project_dir, today)
    if lines:
        print("[llmwiki] overdue in this project:")
        print("\n".join(lines))
    elif not hook_mode:
        print("[llmwiki overdue] nothing overdue.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        if "--hook" in sys.argv[1:]:
            sys.exit(0)
        print(f"[llmwiki overdue] checker error ({e.__class__.__name__}: {e}).")
        sys.exit(3)
