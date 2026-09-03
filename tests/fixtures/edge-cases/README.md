# edge-cases — the fixture for everything `sample-wiki` must not be

`sample-wiki` is the schema spec and is deliberately a **valid, complete**
llmwiki. The malformed, boundary and hostile material lives here instead, so
neither fixture has to be two things at once (M1 review, `findings` 2026-08-19).

| Edge case | Where |
|---|---|
| an illustration of the block **before** the real block | `CLAUDE.md` |
| register **exactly at** its cap (100 / 100) | `wiki/tried.md` |
| state file **exactly at** its cap (60 / 60) | `wiki/00_state.md` |
| malformed frontmatter (`invalid`) | `wiki/05_broken.md` |
| empty frontmatter block — a placeholder, not a break | `wiki/06_empty_header.md` |
| CRLF line endings throughout | `wiki/07_crlf.md` |
| a leading BOM before the frontmatter fence | `wiki/08_bom.md` |
| a note in a wiki **sub-folder** (`other`, not a note) | `wiki/drafts/09_draft.md` |
| an archived **register overflow** | `wiki/archive/decisions_2026-08.md` |
| journal entry with session-log frontmatter (`date`/`kind`/`outcome`) | `notes/2026-08-19_session.md` |
| a journal **sub-directory** (`other`) | `notes/sub/2026-08-19_nested.md` |
| a date-shaped name that is not a day | `notes/2026-02-30_notaday.md` |
| an empty markdown file (0 lines) | `wiki/10_empty.md` |
| a non-markdown file | `assets/diagram.txt` |

`broken-projects/` holds one directory per malformed CLAUDE.md, each a project
that `parseClaudeBlock` must refuse rather than half-accept.
