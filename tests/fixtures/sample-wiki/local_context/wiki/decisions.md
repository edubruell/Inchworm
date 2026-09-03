# decisions — append-only dated decision register

Deliberately over the 100-line cap: this fixture exists so `capStatus` has a
real over-cap register to report, and so the sidebar has something to badge.

## [2026-08-10] scope | one flat file, no database
- **Ruling:** one flat file, no database.
- **Why:** the record count is bounded by hand-editing.
- **Rejected:** sqlite — a schema and a migration story for 200 rows.
- **Expect:** reads stay under 20 ms; confidence: med
- **Touches:** [[04_storage]]

## [2026-08-10] design | records are append-only
- **Ruling:** records are append-only.
- **Why:** history is the point of the file.
- **Rejected:** in-place edit — it loses the previous value.
- **Expect:** no line is ever rewritten; confidence: med
- **Touches:** [[04_storage]]

## [2026-08-11] design | tab-separated fields
- **Ruling:** tab-separated fields.
- **Why:** the values never contain tabs.
- **Rejected:** CSV — quoting rules for no benefit.
- **Expect:** a naive split parses every line; confidence: med
- **Touches:** [[04_storage]]

## [2026-08-11] process | the reader is pure
- **Ruling:** the reader is pure.
- **Why:** it makes the parser testable without I/O.
- **Rejected:** reading inside the parser.
- **Expect:** parser tests need no fixture files; confidence: med
- **Touches:** [[01_scope]]

## [2026-08-12] design | read the whole file at start
- **Ruling:** read the whole file at start.
- **Why:** simplest thing that answers every query.
- **Rejected:** lazy paging — complexity before a measurement.
- **Expect:** start-up stays under 200 ms; confidence: med
- **Touches:** [[contentions#C1]]

## [2026-08-12] scope | no networking
- **Ruling:** no networking.
- **Why:** this is a local tool.
- **Rejected:** a sync endpoint — nobody asked.
- **Expect:** the dependency count stays at one; confidence: med
- **Touches:** [[01_scope]]

## [2026-08-13] process | one writer at a time, by convention
- **Ruling:** one writer at a time, by convention.
- **Why:** a lock is not yet worth its failure modes.
- **Rejected:** file locking — untested on the target fs.
- **Expect:** no interleaved append is ever seen; confidence: med
- **Touches:** [[contentions#C2]]

## [2026-08-14] design | the last field may be empty
- **Ruling:** the last field may be empty.
- **Why:** absence and empty string differ here.
- **Rejected:** trimming the line.
- **Expect:** a trailing tab survives a round trip; confidence: med
- **Touches:** [[gotchas]]

## [2026-08-15] scope | no migrations
- **Ruling:** no migrations.
- **Why:** the format has one version and will get a new file if it changes.
- **Rejected:** a version header on every line.
- **Expect:** the reader never branches on version; confidence: med
- **Touches:** [[04_storage]]

## [2026-08-16] design | errors are values
- **Ruling:** errors are values.
- **Why:** the caller decides what a missing file means.
- **Rejected:** throwing on a missing file.
- **Expect:** no try/catch outside the edge; confidence: med
- **Touches:** [[01_scope]]

## [2026-08-17] design | reject the keyed store
- **Ruling:** reject the keyed store.
- **Why:** compaction ran during reads.
- **Rejected:** the keyed store with a background compactor.
- **Expect:** nothing compacts anything; confidence: med
- **Touches:** [[tried]]

## [2026-08-17] process | the journal is the source for findings
- **Ruling:** the journal is the source for findings.
- **Why:** a finding without a source is a memory.
- **Rejected:** undated notes.
- **Expect:** every finding names a file; confidence: med
- **Touches:** [[findings]]

## [2026-08-18] design | supersede 03 with 04
- **Ruling:** supersede 03 with 04.
- **Why:** the flat file replaced the keyed store.
- **Rejected:** editing 03 in place — it loses the ruling.
- **Expect:** 03 keeps a pointer and nothing else; confidence: med
- **Touches:** [[03_storage]], [[04_storage]]

## [2026-08-18] process | split this register at the next close
- **Ruling:** split this register at the next close.
- **Why:** it is over its cap and past the cap nobody reads it.
- **Rejected:** deleting the oldest entries.
- **Expect:** an era archive plus an index row per entry; confidence: med
- **Touches:** [[decisions]]

