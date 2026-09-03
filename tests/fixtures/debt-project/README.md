A project with one of each kind of debt, for the checkers to find.

It exists because every other fixture is *clean*: `sample-wiki` has no
`Trigger:` line and no unswept entry, so the real `wiki-sweepcheck.py` and
`wiki-trigger.py` return empty lists over it and `core/debt.ts`'s readers can
only ever be tested against hand-written JSON (test review 2026-08-27). Both
cutoffs are pinned in CLAUDE.md so the answer does not depend on the day it is
run, or on whether the checker has seen this path before.
