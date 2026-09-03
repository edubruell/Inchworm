# Migrating an existing llmwiki to the sentinel schema

**Nothing historical needs touching, and there is no opt-in step.** The
checker records the date it first runs in a project and enforces only entries
dated *after* it; everything already written is out of scope permanently.
Verified 2026-08-25 against five live wikis (wikiviewer, BreakingFree,
llmtalks, HartzProductivity, KeepingTheDoctorAway): all five report clean on
first run.

## Per project — optional, ~1 minute

1. **Pin the cutoff, if you want it visible.** Without this line the checker
   derives one (today, stored under `~/.claude/sessions/<hash>/`). With it,
   the date is in the file where a reader can see and move it:

   ```markdown
   - Sweep cutoff: 2026-08-25    (register entries after this date are sentinel-checked)
   ```

   Never backdate it: a backdated cutoff enforces the pre-anchor corpus and
   produces debt no author could have avoided.

2. **Create the uncapped maintenance log** `<WIKI>/wikilog.md`, with a
   one-line header ("append-only, one line each: lint verdicts, splits,
   migrations, wiki process notes — never project facts") and a first line
   recording this migration.

3. **Move wiki meta out of the capped registers, whole.** Lint verdicts,
   split records and process notes go to `wikilog.md`. This is the highest-
   leverage step: measured across the five wikis it is ~131 lines, and it
   takes two registers off their cap without a split.

4. **Normalise the contentions register** to the schema's field names
   (`**Resolves when:**`, `**Fallback:**`, `status: open|parked`). The
   contention check-in in `close` reads `Resolves when:`; as of 2026-08-25
   that field existed in one of five wikis, so without this step the check-in
   silently finds nothing. While there: resolved-but-still-listed entries get
   the lifecycle treatment (one row, body to `archive/`).

5. From now on, new register entries use anchored links
   (`Affects: [[05_utils#anchor]]`), and every note edit they receipt carries
   `<!-- swept: <anchor> YYYY-MM-DD -->`. Unanchored entries stay legal; they
   are reported as unchecked, not as debt.

Do not run a bulk retro-anchoring pass — it churns append-only registers for
no reader benefit.

## Hook install

`./install.sh` copies `wiki-sweepcheck.py` to `~/.claude/hooks/`. Wire it into
SessionStart after `wiki-restore.py` in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "python3 ~/.claude/hooks/wiki-restore.py" },
          { "type": "command", "command": "python3 ~/.claude/hooks/wiki-sweepcheck.py --hook" }
        ]
      }
    ]
  }
}
```

(Append to the existing entry's `hooks` array; do not add a second matcher.)

With `--hook` the script always exits 0 and prints debt as session context,
capped at 12 lines per section. `/llmwiki close` runs the same script from the
CLI, where debt exits 1 and close must not finish until it is clean.

## Knobs

- Check window: `LLMWIKI_SWEEP_WINDOW_DAYS` (default 30). Debt older than the
  window is summarised in one line but does not fail the check. A bad or
  non-positive value falls back to 30 rather than crashing or silently
  disabling the gate.
- To move enforcement forward after a bulk rewrite, set `Sweep cutoff:` to the
  rewrite date.

## What this does NOT check

Known blind spots, so nobody reads a clean run as a clean wiki:

- A stamp proves the note was edited under that anchor, not that the edit made
  the note true, and not that a contradicting sentence elsewhere in the note
  was found. A correction appended below a falsehood passes.
- Entries with no `#anchor` are counted, not checked.
- Numbers. Prose registers cannot audit magnitudes; only a generated export can.
- Whether `close` or `lint` ran at all.
