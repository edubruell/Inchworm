---
status: proposal
updated: 2026-08-17
links: [01_scope]
---

# 02 — design (proposal)

**Status: proposal, not yet adopted.** Nothing in the active notes is
rewritten until the decision rule below resolves.

| Test outcome | Action |
|---|---|
| Reads stay under 5 ms at 10k records | adopt |
| Anything slower | keep [[04_storage]] |

## Sketch
An index sidecar beside the flat file.
