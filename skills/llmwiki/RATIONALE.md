**A.** Chose `<!-- swept: <anchor> <YYYY-MM-DD> -->`, the anchor carried by the stamp
alone: one artifact per pair-half, one regex, and a newer stamp covers all older entries
at that anchor. Rejected: separate `<a id>` anchor element + register-named stamp — two
things to place, and naming the register forces N stamps when one edit answers N
registers. Unconsidered failure modes: the stamp proves an edit *near* the claim, not
that it made the note true (a lazy stamp passes — lint's contradiction sweep remains the
quality backstop), and an anchor typo copied register→stamp passes invisibly.

**B.** One dual-mode script: `--hook` reads JSON stdin; plain CLI takes a project dir
and never touches stdin (auto-detection blocked on an idle pipe in testing). Reuses the
hooks' `Wiki root:` regex plus a new `Sweep cutoff:` line. Hook mode always exits 0,
printing debt as context (nonzero at SessionStart surfaces as a hook error); CLI exits 1
so `close` gates. Rejected: two scripts — drift between them is the disease treated.
Deviation, flagged: a pure last-N-days window lets debt *expire* silently (the old
failure in new clothes), so older unswept entries get a non-failing count line.

**C.** Order: sweep → receipt → script gate → state → journal; the receipt must quote
the changed note line, so writing it presupposes the edit. Rejected: the old order plus
a final "verify" step — that IS the current design and it failed four times; the agent
that forgot cannot be its own verifier.

**D.** Split-by-era is the only cap remedy; shortening a factual entry is banned (lost
detail is unrecoverable and indistinguishable from never-recorded); wiki meta moves to
uncapped `wikilog.md` — the thrashing was self-inflicted: the old skill told lint to log
its verdict INTO capped findings.md. Rejected: raising the caps — past the cap nobody
reads, so the cap is right; only the remedy order was wrong.

**E.** New principle 10 + editing rule: smallest edit that makes the note true; never
restructure in the correcting session. Rejected: numeric cap on note edits — close must
stay cheap; ~10 lines applies only in lint, where one party applies another's findings.

**F.** `file.ext:symbol` preferred (greppable, survives edits above it); line numbers
only where nothing is nameable, then quoted. Rejected: banning line numbers outright.
**G.** Every lint citation quoted verbatim; batch-pattern reporting ("all off by 20")
banned; new first check verifies the previous audit landed; application capped at ~10
changed lines per finding, larger → logged restructuring task. Rejected: lint applying
its own fixes — breaks principle 7. **Pushback:** the brief blames memory, but the real
problem was that the register write was the *cheap* half — C fixes the incentive, A/B
only add the alarm. And the sentinel is opt-in via `Sweep cutoff:`; an unmigrated
project keeps the old failure mode silently.
