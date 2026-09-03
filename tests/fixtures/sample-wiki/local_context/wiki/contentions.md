# contentions — open/fragile points

Surface these before touching the surrounding design. An open contention is
NEVER resolved silently; raise it with the user.

Deliberately just under the 100-line cap, so the fixture has a register in the
amber "near cap" band as well as one over it ([[decisions]]).

## C1 — the flat file is read whole at start (existential above ~50k records)
Start-up cost is linear in the file and nothing pages it in lazily.
**Resolves when:** a 50k-record file loads under 200 ms on the target machine.
**Fallback:** adopt the sidecar index in [[02_design]].

## C2 — two writers on one file (fragile)
Nothing arbitrates a second process appending at the same moment.
**Resolves when:** the writer takes a lock and a concurrent-append test passes.
**Fallback:** single-writer discipline, enforced by convention only.

## C3 — no checksum on a record (fragile)
A half-written final line is indistinguishable from a short record.
**Resolves when:** the reader rejects a truncated tail without losing the rest of the file.
**Fallback:** drop the last line on a parse failure and say so loudly.

## C4 — the date field is a string (fragile)
Nothing enforces that it is a date, so a typo sorts wrong forever.
**Resolves when:** a parse step rejects a non-date at write time.
**Fallback:** sort by insertion order instead of by the field.

## C5 — no bound on field length (fragile)
One pasted paragraph makes every later read slower for no reason.
**Resolves when:** a length ceiling exists and the writer enforces it.
**Fallback:** truncate on display only, never on disk.

## C6 — the file lives in a synced folder (fragile, not existential)
Two machines can append the same second and the sync tool picks a winner.
**Resolves when:** a real two-machine session ends with no lost record.
**Fallback:** keep the file outside the synced tree.

## C7 — error text is the only failure channel (fragile)
A caller has to read prose to know what went wrong.
**Resolves when:** failures carry a tag the caller can switch on.
**Fallback:** one error type per failure mode, no free text.

## C8 — nothing tests the empty file (fragile)
The zero-record case is the one nobody writes a fixture for.
**Resolves when:** the empty file is in the fixture set and the reader returns zero records.
**Fallback:** treat a missing file and an empty file identically.

## C9 — the record separator is untested against CRLF (fragile)
A file touched on another platform gains carriage returns.
**Resolves when:** a CRLF fixture parses to the same records as the LF one.
**Fallback:** strip a trailing CR before splitting fields.

## C10 — the reader holds every record in memory (fragile)
Nothing streams, so peak memory is the file size plus the parse overhead.
**Resolves when:** memory stays under 50 MB for the largest real file.
**Fallback:** stream the parse and keep only the fields a query needs.

## C11 — backups are the user's problem (fragile, not existential)
The append-only file is the only copy and nothing snapshots it.
**Resolves when:** a restore from a copied file is exercised once.
**Fallback:** copy the file on every start and keep the last three.

## C12 — the field order is positional (fragile)
Inserting a field in the middle silently shifts every later value.
**Resolves when:** new fields are only ever appended, checked by a test.
**Fallback:** a header line naming the fields, read once.

## C13 — timestamps are local time (fragile)
A file written either side of a DST change sorts wrong for one hour a year.
**Resolves when:** writes record UTC and the reader converts for display.
**Fallback:** accept the hour and document it.

## C14 — nothing prunes dead records (fragile, not existential)
The file only grows, and most of it is history nobody queries.
**Resolves when:** a query over a year-old file is still under the read budget.
**Fallback:** an era split, the same remedy the registers use.

## C15 — the parser trusts the field count (fragile)
A line with one extra tab is currently read as a valid record.
**Resolves when:** a wrong field count is a typed failure rather than a silent one.
**Fallback:** reject the file rather than the line, and say which line.

