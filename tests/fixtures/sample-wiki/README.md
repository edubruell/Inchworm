# sample-wiki — the fixture that is the schema spec

A complete, valid llmwiki for a fictional project, checked in so every `core`
test runs against real files rather than inline strings (wiki
03_technology_research, "Fixture strategy"). **The fixture is the spec: an
edge case that is not here is not tested.**

It is a whole project root — `CLAUDE.md` plus `local_context/wiki` and
`local_context/notes` — because `classify` needs the two path prefixes the
CLAUDE.md block declares.

| Edge case | Where |
|---|---|
| `00_state.md`, no frontmatter, read-first | `wiki/00_state.md` |
| note with full frontmatter (`links:`, `covers:`) | `wiki/01_scope.md` |
| `status: proposal` | `wiki/02_design.md` |
| `status: superseded-by-04` + pointer body | `wiki/03_storage.md` |
| the note that superseded it | `wiki/04_storage.md` |
| every register the schema names | `wiki/{ideas,decisions,contentions,findings,gotchas,tried,budgets,deletions}.md` |
| register **over** its cap (103 / 100) | `wiki/decisions.md` |
| register **near** its cap (83 / 100) | `wiki/contentions.md` |
| archived body of a superseded note | `wiki/archive/03_storage.md` |
| dangling `[[99_missing]]` | `wiki/00_state.md` |
| labelled link `[[04_storage\|the storage note]]` | `wiki/00_state.md` |
| anchored **body** link `[[contentions#C1]]` | `wiki/decisions.md` |
| anchored link in **frontmatter** `links:` (not a body link) | `wiki/01_scope.md` |
| wikilink inside an **inline code span** (must not be a link) | `wiki/gotchas.md` |
| wikilink inside a **fenced code block** (must not be a link) | `wiki/gotchas.md` |
| dated journal entries, two on one day | `notes/2026-08-1*.md` |

Malformed, boundary and hostile material is deliberately **not** here — this
fixture is a valid wiki, and breaking it to test a failure would cost the
assertions that depend on it being whole. That material lives in
`tests/fixtures/edge-cases/` and `tests/fixtures/broken-projects/`.

Nothing here is generated at test time: the line counts above are asserted, so
editing a fixture file is a deliberate act that some test will notice.
