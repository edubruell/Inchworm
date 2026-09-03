---
status: active
updated: 2026-08-18
links: [01_scope, 03_storage, decisions#2026-08-18]
covers: ["src/storage/**"]
---

# 04 — storage

One append-only file, read whole at start. Supersedes [[03_storage]].

## Format
One record per line, tab separated.

## Why not a database
The record count is bounded by hand-editing, so a file is the honest size.
