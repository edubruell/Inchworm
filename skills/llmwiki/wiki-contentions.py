#!/usr/bin/env python3
"""
llmwiki contention ripeness — which open contentions are ready for a ruling.

A contention is a fragile assumption the project agreed not to resolve
silently. The observed failure is the opposite of silent resolution: they are
never resolved at all. Measured 2026-08-25 across five wikis — a contention
whose countdown was met and ignored for three sessions, one contradicted by
00_state.md, one discharged in the code 5.5 weeks earlier and still listed.

This module decides RIPENESS deterministically; the ruling itself is the
user's and is asked for by `/llmwiki resolve`. It never edits anything.

CLI:
  wiki-contentions.py [PROJECT_DIR]           human-readable, exit 0
  wiki-contentions.py --json [PROJECT_DIR]    machine-readable for `resolve`
  wiki-contentions.py --ripe-only [...]       only the ripe ones

Importable: `load_contentions(project_dir)` -> (entries, note). Exit 3 marks
a checker failure, never mistaken for a verdict.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

STALE_DAYS = int(os.environ.get("LLMWIKI_CONTENTION_STALE_DAYS", "21") or 21)

WIKI_RE = re.compile(r"^\s*-\s*Wiki root:\s*`?([^\s`]+)", re.MULTILINE)
DATE_RE = re.compile(r"(?<![\d-])(\d{4}-\d{2}-\d{2})(?![\d-])")
# The heading of a contention entry: "## C7 — question ..." (en/em dash or -).
HEAD_RE = re.compile(r"^##\s+(?:~~)?(C\d+)(?:~~)?\s*[—–-]?\s*(.*)$")
STATUS_RE = re.compile(r"\bstatus:\s*(open|parked|resolved)\b", re.IGNORECASE)
RESOLVED_RE = re.compile(r"~~|\bRESOLVED\b|\bSETTLED\b")
# A resolved entry is SUPPOSED to leave one row behind pointing at the archive
# (the lifecycle: body to archive/, one row stays so the resolution is visible
# without opening it). An entry that both reads resolved and names its archive
# is therefore finished, not debt — nagging it asks the wiki to delete the very
# index the lifecycle exists to keep.
ARCHIVED_RE = re.compile(r"archive/[\w.\-/]*", re.IGNORECASE)
# Five different spellings for the resolve-condition were in live use before
# SKILL.md named one. Read them all; report which one was found so a
# normalising pass can see the drift.
CONDITION_RES = [
    ("Resolves when", re.compile(r"\*{0,2}Resolves when:?\*{0,2}\s*(.+)", re.IGNORECASE)),
    ("Resolved by", re.compile(r"\*{0,2}Resolved by:?\*{0,2}\s*(.+)", re.IGNORECASE)),
    ("What resolves it", re.compile(r"\*{0,2}What resolves it:?\*{0,2}\s*(.+)", re.IGNORECASE)),
    ("Test", re.compile(r"\*{0,2}Test:?\*{0,2}\s*(.+)", re.IGNORECASE)),
    ("Resume point", re.compile(r"\*{0,2}Resume point:?\*{0,2}\s*(.+)", re.IGNORECASE)),
]
# A condition no session could ever discharge is a defect in the entry.
UNFALSIFIABLE_RE = re.compile(
    r"\bnone pending\b|\bwriting obligation\b|\bnever\s+(?:writes?|produces?|happens)\b"
    r"|\bconfirmed never\b|\bif we ever\b",
    re.IGNORECASE,
)

# Evidence is a dated register line that says something NEW about the question.
# `00_state.md` and `wikilog.md` are deliberately absent: the schema calls a link
# to either a *pointer, not a paired write*, and a churn file mentioning an id
# every session is not news. Counting them produced six consecutive false-positive
# ripeness calls in one project before this was fixed (2026-09-01).
REGISTERS = ["decisions.md", "findings.md", "gotchas.md", "tried.md", "ideas.md"]


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


def wiki_root(project_dir: Path):
    cm = project_dir / "CLAUDE.md"
    if not cm.is_file():
        return None, "no CLAUDE.md"
    try:
        m = WIKI_RE.search(cm.read_text(encoding="utf-8", errors="replace"))
    except OSError as e:
        return None, f"CLAUDE.md unreadable ({e.__class__.__name__})"
    if not m:
        return None, "no 'Wiki root:' line in CLAUDE.md"
    root = project_dir / m.group(1).strip().rstrip("/")
    return (root, "") if root.is_dir() else (None, f"wiki root missing: {m.group(1)}")


def id_pattern(cid: str) -> re.Pattern:
    return re.compile(rf"(?<![A-Za-z0-9]){re.escape(cid)}(?![0-9])")


FRONT_UPDATED_RE = re.compile(r"updated:\s*(\d{4}-\d{2}-\d{2})")
ANY_ID_RE = re.compile(r"(?<![A-Za-z0-9])C\d+(?![0-9])")
# "Only C4 stays open", "C7 remains unresolved" — a restatement of the status
# quo, not news about it. Counting these made every close receipt ripen the
# contentions it merely mentioned.
STATUS_QUO_RE = re.compile(
    r"\b(still|stays?|remains?|unchanged|unresolved|not resolved|left open)\b",
    re.IGNORECASE)


def file_date(path: Path, text: str):
    """A dateless file still has two weak dates: its own `updated:` line and
    its mtime. Used only for mentions that carry no date of their own."""
    m = FRONT_UPDATED_RE.search("\n".join(text.splitlines()[:6]))
    d = parse_date(m.group(1)) if m else None
    if d:
        return d, "updated:"
    try:
        return dt.date.fromtimestamp(path.stat().st_mtime), "mtime"
    except OSError:
        return None, ""


def newest_evidence(wiki: Path, cid: str):
    """Newest dated register line that names this contention. That a later
    ruling already answered it is the commonest reason it is ripe."""
    pat = id_pattern(cid)
    best = None
    best_where = ""
    for reg in REGISTERS:
        p = wiki / reg
        if not p.is_file():
            continue
        try:
            lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        text = "\n".join(lines)
        weak_date, weak_kind = None, ""
        # Evidence is judged per logical entry, not per line: a decisions entry
        # puts its ruling on the "## [date]" line and its links on a "Touches:"
        # line below, so a per-line filter sees the qualifier and the mention
        # separately and suppresses neither.
        header_date = None
        buf: list[str] = []
        start = 0

        def verdict(buf, start, header_date, best, best_where):
            if not buf:
                return best, best_where
            blob = "\n".join(buf)
            if not pat.search(blob):
                return best, best_where
            if len(set(ANY_ID_RE.findall(blob))) > 1:
                return best, best_where          # roll-call: names every id, says nothing
            if STATUS_QUO_RE.search(blob):
                return best, best_where          # restates the status quo, not news
            m = DATE_RE.search(blob)
            d = (parse_date(m.group(1)) if m else None) or header_date
            where = f"{reg}:{start}"
            if d is None:
                nonlocal_date, kind = file_date(p, text)
                d = nonlocal_date
                where = f"{reg}:{start} (by {kind})"
            if d and (best is None or d > best):
                return d, where
            return best, best_where

        for lineno, line in enumerate(lines, 1):
            if line.startswith("## ") or re.match(r"^\s*[-*]\s+\S", line):
                if line.startswith("## "):
                    best, best_where = verdict(buf, start, header_date, best, best_where)
                    ds = DATE_RE.findall(line)
                    header_date = parse_date(ds[0]) if len(ds) == 1 else None
                    buf, start = [line], lineno
                    continue
                if not buf:
                    buf, start = [line], lineno
                    continue
            if buf:
                buf.append(line)
            else:
                buf, start = [line], lineno
        best, best_where = verdict(buf, start, header_date, best, best_where)
    return best, best_where


def load_contentions(project_dir: Path):
    wiki, note = wiki_root(project_dir)
    if wiki is None:
        return [], note
    path = wiki / "contentions.md"
    if not path.is_file():
        return [], "no contentions.md in the wiki"
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as e:
        return [], f"contentions.md unreadable ({e.__class__.__name__})"

    today = date_today()
    blocks = []
    cur = None
    for lineno, line in enumerate(lines, 1):
        m = HEAD_RE.match(line)
        if m:
            if cur:
                blocks.append(cur)
            cur = {"id": m.group(1), "title": m.group(2).strip(), "line": lineno, "body": []}
        elif cur is not None:
            if line.startswith("## "):      # a non-contention heading closes the block
                blocks.append(cur)
                cur = None
            else:
                cur["body"].append(line)
    if cur:
        blocks.append(cur)

    entries = []
    for b in blocks:
        body = "\n".join(b["body"])
        head_and_body = f"{b['title']}\n{body}"

        status_m = STATUS_RE.search(head_and_body)
        status = status_m.group(1).lower() if status_m else "open"
        marked_resolved = bool(RESOLVED_RE.search(b["title"])) or status == "resolved"

        condition, field = "", ""
        body_lines = body.splitlines()
        for name, rx in CONDITION_RES:
            for i, bl in enumerate(body_lines):
                cm = rx.search(bl)
                if not cm:
                    continue
                parts = [cm.group(1).strip()]
                for nxt in body_lines[i + 1:]:
                    # continuation: same paragraph, not the next bold field
                    if not nxt.strip() or re.match(r"\s*\*\*", nxt) or nxt.startswith("## "):
                        break
                    parts.append(nxt.strip())
                condition, field = " ".join(parts), name
                break
            if field:
                break

        dates = [d for d in (parse_date(x) for x in DATE_RE.findall(head_and_body)) if d]
        entry_date = max(dates) if dates else None
        ev_date, ev_where = newest_evidence(wiki, b["id"])
        touched = max([d for d in (entry_date, ev_date) if d], default=None)
        age = (today - touched).days if touched else None

        archived = bool(ARCHIVED_RE.search(head_and_body))

        reasons = []
        if marked_resolved:
            # Closed and archived: the prescribed end state. Say nothing at all —
            # not the archive nag, and not staleness either, which is meaningless
            # for a question that has been answered.
            if not archived:
                reasons.append("marked resolved but still in the live register — archive it")
            entries.append({
                "id": b["id"], "title": b["title"], "line": b["line"], "status": status,
                "marked_resolved": True, "closed": archived, "condition": condition,
                "condition_field": field,
                "entry_date": entry_date.isoformat() if entry_date else None,
                "evidence_date": ev_date.isoformat() if ev_date else None,
                "evidence_where": ev_where, "age_days": age,
                "ripe": bool(reasons), "reasons": reasons, "body": body.strip(),
            })
            continue
        if not field:
            reasons.append("no resolve-condition stated — it can never be discharged")
        elif UNFALSIFIABLE_RE.search(condition):
            reasons.append(f"'{field}' condition looks unfalsifiable — restate or drop to a note")
        if ev_date and entry_date and ev_date > entry_date:
            reasons.append(f"newer evidence at {ev_where} ({ev_date}) than the entry ({entry_date})")
        if age is not None and age >= STALE_DAYS:
            reasons.append(f"nothing has touched it in {age} days")
        elif age is None:
            reasons.append("undated — no way to tell whether it is moving")

        entries.append({
            "id": b["id"], "title": b["title"], "line": b["line"], "status": status,
            "marked_resolved": marked_resolved, "closed": False, "condition": condition,
            "condition_field": field, "entry_date": entry_date.isoformat() if entry_date else None,
            "evidence_date": ev_date.isoformat() if ev_date else None,
            "evidence_where": ev_where, "age_days": age,
            "ripe": bool(reasons), "reasons": reasons,
            "body": body.strip(),
        })
    return entries, ""


def main():
    argv = sys.argv[1:]
    as_json = "--json" in argv
    ripe_only = "--ripe-only" in argv
    args = [a for a in argv if not a.startswith("--")]
    project_dir = find_project_root(Path(args[0]) if args else Path.cwd())

    entries, note = load_contentions(project_dir)
    if ripe_only:
        entries = [e for e in entries if e["ripe"]]

    if as_json:
        print(json.dumps({"project": str(project_dir), "note": note,
                          "stale_days": STALE_DAYS, "contentions": entries}, indent=1))
        return 0

    if note:
        print(f"[llmwiki contentions] {note}.")
        return 0
    if not entries:
        print("[llmwiki contentions] nothing ripe." if ripe_only
              else "[llmwiki contentions] no contention entries found.")
        return 0
    for e in entries:
        flag = "RIPE" if e["ripe"] else "open"
        print(f"{flag}  {e['id']} — {e['title']}  (contentions.md:{e['line']})")
        if e["condition_field"]:
            print(f"      {e['condition_field']}: {e['condition'][:120]}")
        for r in e["reasons"]:
            print(f"      · {r}")
    ripe = [e for e in entries if e["ripe"]]
    if ripe:
        print(f"\n{len(ripe)} ripe — rule on them with /llmwiki resolve "
              f"(the verdict is the user's; never resolve one silently).")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"[llmwiki contentions] checker error ({e.__class__.__name__}: {e}).")
        sys.exit(3)
