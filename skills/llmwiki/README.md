# `llmwiki` — vendored skill

The `/llmwiki` skill, kept **in this repo** so a machine can install it from a
clone, and so the app can one day install it from Settings
(`00_state.md` → Next 5). This copy is canonical: edit it here, then
`./skills/llmwiki/install.sh`. Do not edit `~/.claude/skills/llmwiki/SKILL.md`
by hand — `install.sh` overwrites it.

| file | what it is |
|---|---|
| `SKILL.md` | the skill: schema, principles, `init`/`seed`/`close`/`lint`/`state` |
| `wiki-sweepcheck.py` | sweep-sentinel checker — SessionStart hook (`--hook`) and CLI gate |
| `wiki-contentions.py` | ripeness of every open contention — feeds `resolve` and lint's currency check |
| `wiki-overdue.py` | SessionStart reporter: journal, lint and ripe contentions, silent unless overdue |
| `MIGRATION.md` | what an existing wiki needs (sweep cutoff, `wikilog.md`, hook wiring) |
| `RATIONALE.md` | per-change: chosen, rejected, and the author's pushback |
| `testwiki/` | fixtures — `cleanproj`, `debtproj`, `contentionproj`, `triggerproj` |
| `run-tests.sh` | 100 assertions over those fixtures; `install.sh` refuses to install if they fail |

Provenance: the 2026-08-25 redesign drafted in
`~/code/new_skills/llmwiki_2026-08-25/`, vendored here the same day and then
revised against a five-agent audit of a week of real sessions across five
llmwiki projects (43% of sampled paired writes were never honoured; the draft
sentinel would have produced 99 false positives on day one). Changes made here:

- **contention check-in** in `close`/`lint` — a contention whose resolve
  condition is met comes back to the user unprompted;
- **the sentinel is on by default**, with a cutoff it records itself, because
  an opt-in line only ever reaches the wikis someone is already tending;
- entries with no `#anchor` are a warning, not debt;
- the `Affects:` clause is scoped and joined across wrapped lines; archived
  notes still resolve; registers are cross-references, not sweep targets;
- crash and debt no longer share an exit code, and a bad env var cannot break
  a SessionStart hook;
- the contentions lifecycle, the resolve-field name, and which registers carry
  pointers are all named in `SKILL.md` — each was drift caused by the skill
  being silent, not by an agent erring.

## Install

```sh
./skills/llmwiki/install.sh          # copies skill + hook, backs up what it replaces
```

It compiles the hook and runs the fixture tests before copying anything, and
refuses to install if either fails. It does not touch
`~/.claude/settings.json`: it checks whether SessionStart already runs the
sweepcheck (parsing the JSON, not grepping it) and otherwise prints the snippet
for you to paste.

No per-project step is required. The sentinel records its own cutoff the first
time it runs in a project, so nothing already written is debt; a
`Sweep cutoff:` line pins that date explicitly if you want it in the file.
