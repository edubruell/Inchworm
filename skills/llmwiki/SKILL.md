---
name: llmwiki
description: |
  Agent-facing project memory: a curated wiki layer (00_state.md + numbered
  design notes + append-only registers) over the project's dated journal.
  Subcommands: init (scaffold a project), seed (populate from existing
  material), close (session close-out), next (propose the next queued item in a
  fresh context and start it once confirmed), lint (fresh-context audit), resolve (put ripe contentions to
  the user), trigger (arm a standing obligation so a landed artefact nags until
  it is written up), state (quick 00_state reconcile). Use close at every session end /
  before /compact, next as the first thing after a /clear; lint after design
  adoptions,
  results rounds, payload returns; resolve when the overdue hook says a
  contention is ripe.
argument-hint: "[init|seed|close|next|lint|resolve|trigger|state]"
allowed-tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task"]
---

# /llmwiki — curated project memory

This SKILL.md is the single canonical copy of the schema; projects carry only
a ~15-line CLAUDE.md block pointing here. Nothing in this file may name a
specific project — a rule about one repo belongs in that repo's wiki, not in
the skill every repo loads.

**Subcommand:** `$ARGUMENTS` (default: `state` if a wiki exists, else explain).

## Principles (non-negotiable)

1. **Cheap loop or dead wiki** — every write must be fast; friction kills upkeep.
2. **Map, not territory** — CLAUDE.md and `00_state.md` point; leaves are opened on demand.
3. **One canonical home per fact** — a decided element lives in exactly ONE numbered note; everything else links.
4. **Split by churn** — all fast-moving state is quarantined in `00_state.md`.
5. **Stale is worse than absent** — a correction discovered in-session is written to the owning note in the SAME session, note first, register line second. *(Changed in place: the ordering is now part of the principle — see "Sweep sentinel".)*
6. **Append-only for history, curated for truth** — registers/journal grow by appending; state and design notes are curated.
7. **Fresh-context audits** — the lint agent never sees the session that wrote the content; it emits evidence + a proposed diff, never silent edits.
8. **Hard caps met by moving, never by shrinking** — `00_state.md` ≤ 60 lines, registers ≤ 100, CLAUDE.md ≤ 150. A cap is satisfied by moving lines out whole (split to `archive/`), never by shortening a factual entry. `wikilog.md` is uncapped. Procedure: "Register overflow" below. **A line cap is only honest if lines stay lines: no register entry runs past ~300 characters.** Past that it is a note, not an entry — promote it and leave a pointer. (Measured 2026-08-25: registers under cap pressure drift to 325 chars/line and one 47-line register reached 18 KB, so the count stopped measuring anything.) **The char rule is about prose entries, not table rows.** A pipe-delimited log — a measurement table, a `date | removed | why | replaced | ref` deletion row — is long because a row that omits what caused a delta measures nothing, and trimming it to fit would delete the fact the row exists for. Such a table lives in its **own uncapped file** beside the register (`<register>_<table>.md`), with the register keeping the ceilings, the prose and a link; where it stays in the register, its rows are exempt from the char rule and the lint reports them as table rows, not as debt. *(Added 2026-08-27, after a promotion pass recovered ~30% of four deletion rows and hit a floor made of file paths.)* *(Changed in place: the old wording allowed "trim"; trimming facts is now prohibited.)*
9. **Paired writes, machine-checked** — a register entry that names a note is half a write; the other half is the note edit, and it carries a sweep stamp. `wiki-sweepcheck.py` makes the missing half loud at the next session start. This is structural on purpose: the instruction-only version of this rule failed repeatedly, and another reminder would fail the same way.
10. **Smallest true edit** — the fix to a note is the smallest edit that makes the note true. A correction never doubles as a rewrite.

## Layout

Paths come from the project's CLAUDE.md block (machine-readable lines the
hooks also parse):

```
- Wiki root: <WIKI>
- Journal: <JOURNAL>
- Sweep cutoff: YYYY-MM-DD
- Trigger cutoff: YYYY-MM-DD                     (optional; see `trigger`)
- Trigger: <name> | <glob> | marker:<filename>   (optional, repeatable)
- Trigger: <name> | <glob> | mention
```

**Nothing in a Trigger line is a command.** There is no field a program could be
named in, so pointing a checker at a folder never means executing what is in it.
That omission is most of what makes the declaration safe for a GUI to read.

```
<WIKI>/
  00_state.md        fast churn ONLY (cap 60 lines)
  01..NN_<topic>.md  numbered design notes = decided elements
  ideas.md           idea ledger (raw → scouted → active → parked → dead)
  decisions.md       append-only dated decision register (= design change log)
  contentions.md     open/fragile points — surface before touching, never silently resolve
  findings.md        distilled facts learned, each with a source pointer
  gotchas.md         traps: data quirks, env, statutory details, conventions
  tried.md           "tried X, failed because Y, don't retry unless Z"
  wikilog.md         UNCAPPED append-only maintenance log: lint verdicts, splits,
                     migrations, process notes about the wiki itself — one line each.
                     Facts about the project never live here; wiki meta never
                     lives in a capped register.
  archive/           overflow from capped files; bodies of superseded notes
<JOURNAL>/           append-only dated notes/session logs (pre-existing)
```

The wiki layer is gitignored. Stable data documentation still promotes to
tracked `docs/`/`data_docs/`.

## Formats

**Numbered note frontmatter** (registers stay plain markdown):

```yaml
---
status: active | proposal | superseded-by-NN
updated: YYYY-MM-DD
links: [03_simplification, decisions#YYYY-MM-DD]
---
```

**00_state.md** skeleton:

```markdown
# state — <project>            (updated: YYYY-MM-DD)
## Now
- <current focus, 1–3 bullets; link the controlling note>
## Open loops
- <started-not-finished; blocked-on-what>
## Next
- <numbered, concrete next actions>
## Controlling documents
- design: 02_… · plan: 06_… · <exactly one winner per domain>
```

**Proposal note header** (a contemplated redesign NEVER edits active notes):

```markdown
**Status: proposal, not yet adopted.** Nothing in the active notes is
rewritten until the decision rule below resolves.
| Test outcome | Action |
|---|---|
```

**decisions.md entry** (append-only; the `Rejected`/`Expect` lines stop
future sessions re-proposing dead branches and enable calibration):

```markdown
## [YYYY-MM-DD] <design|data|scope|process> | <one-line ruling>
- **Ruling:** …
- **Why:** …
- **Rejected:** <alternatives and why not>
- **Expect:** <what should happen if this is right>; confidence: high|med|low
- **Touches:** [[NN_note#anchor]], [[contentions#Cx]]
```

**Register entries:**

```markdown
contentions:  ## Cx — <fragile assumption> (what it's existential for) · status: open|parked
              <paragraph on why it is fragile and what it is existential for>
              **Resolves when:** <the condition, stated so a session can check it>
              **Fallback:** <what the project does if it resolves the wrong way>
findings:     ## [date] <fact>. Source: <file:symbol / log / paper §>. Affects: [[NN_note#anchor]].
gotchas:      - [date] <trap + how to avoid> (context). Affects: [[NN_note#anchor]].
tried:        ## [date] Tried <X> → <outcome>. Failed because <Y>. Don't retry unless <Z>.
ideas:        ## Ix — <name> · status: raw|scouted|active|parked|dead · <one-line pitch> · notes: [[NN]]
wikilog:      - YYYY-MM-DD <lint|split|migration|process>: <one line>
```

**Every register carries pointers.** `Affects:` on `findings`/`gotchas`/`tried`,
`Touches:` on `decisions`/`ideas` — same meaning, same obligation, same check.
An entry that genuinely bears on no note omits the clause or writes
`Affects: none`; both are silent to the checker. Leaving the clause off to
dodge the sweep is the defect this schema exists to make visible.

**The owed-marker (`unswept`) — the sentinel's other tense.** The sweep stamp
marks a claim *done*; a trigger marker marks an artefact *owed*:

```markdown
<!-- swept:   config_load 2026-03-14 -->   a note edit that discharged an entry
<!-- unswept: payload 20260826d -->        an artefact nobody has written up
```

One regex reads both — `<!--\s*(un)?swept:` — so one grammar serves both hooks.
The marker lives **inside the landed thing's own folder**, which is why it
cannot drift out of sync with reality: there is no second state file. Write it
by hand, from a producer script, or with `wiki-trigger.py --mark <path>`.

A marker is deleted by the write-up, never by tidying. Deleting one without
writing the line is the only way to lie to this mechanism, and it takes as much
work as doing it properly.

**Cross-references are not sweeps.** A link to another register, to
`00_state.md` or to `wikilog.md` (`Touches: [[contentions#C4]]`) is a pointer,
not a paired write, and carries no stamp obligation.

**The contentions lifecycle**, because four projects invented four:

- IDs are identities, never slots — `C7` is retired forever once used, and a
  new contention takes the next free number even if C7's body is long gone.
- An entry leaves `contentions.md` in exactly one way: the user rules on it
  (see the check-in in `close`), then the body moves to
  `archive/contentions_<era>.md` and ONE row stays behind — id, question,
  answer, date. Never strikethrough in place, never a `## Resolved` section:
  both keep dead text in the read path, and a resolved contention that is
  still readable as an instruction will misdirect the next session.
- **A marker written *about* an entry must not carry a parseable date.**
  Ripeness reads `entry_date` as the newest `YYYY-MM-DD` anywhere in the entry,
  so `(restated during the 2026-08-31 migration)` silently resets the staleness
  clock on the very entry it documents — the edit that records a question's age
  erases it. Write the month: `2026-08 schema migration`. Provenance survives,
  the clock does not move. *(Added 2026-08-31, after a migration of eight wikis
  in which seven agents wrote the dated form and un-ripened everything they
  touched; the eighth wrote the month and kept its signal.)*
- `status: parked` is for a question that is real but cannot be tested yet;
  it must name what unparks it. A parked entry with no unpark condition is a
  resolved one nobody dared close.
- **A `Resolves when:` that no session could ever discharge is a defect in the
  entry, not an open question.** Restate it as a testable condition or drop it
  to a note. "None pending; this is a writing obligation" is a task, not a
  contention.

**Code citations in any wiki file**: cite `path/file.ext:symbol_name`
(function, class, build target, section heading), NOT a line number, wherever
a symbol exists. A symbol is greppable and survives edits above it; a line
number rots silently the moment code moves, and stale line numbers are the
bulk of every audit's noise. Use a line number only where nothing is nameable
— and then quote the line next to it, so the citation can be re-found after
it drifts.

**Sweep sentinel (the paired write).** A register entry that bears on a note
names an ANCHOR inside it; the matching note edit carries a STAMP. The pair
is what `wiki-sweepcheck.py` verifies — an entry without its stamp is
reported as debt at the next session start instead of rotting silently.

Register side — the anchor rides the wiki link:

```markdown
## [2026-03-14] Loader reads config lazily, not at import. Source:
   pipeline/loader.py:load_config. Affects: [[05_utils#config_load]].
```

Note side (`05_utils.md`) — the stamp sits on, or directly under, the line
just edited:

```markdown
- Config is read lazily at first call, not at import. <!-- swept: config_load 2026-03-14 -->
```

Rules:

- Stamp syntax: `<!-- swept: <anchor> <YYYY-MM-DD> -->`. Free text may follow
  the date before `-->` (e.g. the register name: `<!-- swept: config_load
  2026-03-14 findings -->`). An HTML comment is invisible in rendered
  markdown, greppable with one regex, cheap to type, and — unlike a line
  number — stable when the note is reordered.
- Anchor: `[A-Za-z0-9_-]+`, chosen by you, naming the CLAIM's home in the
  note (a topic, not a position). Reuse the same anchor for later entries
  about the same claim; a newer stamp covers every older entry at that
  anchor, so anchors accumulate history instead of multiplying.
- A stamp satisfies an entry when it sits in the file the link names, the
  anchors match, and its date is on/after the entry's date.
- Target note doesn't exist yet (a finding whose home is a note still to be
  written)? Put `(pending: <why>)` on the `Affects:` line. The checker
  reports pendings as deferred, not debt — resolve them at a later `close`.
- Stamps older than the check window (default 30 days) have done their job;
  delete them freely whenever you edit the note anyway.
- **An entry with no `#anchor` is a warning, never debt.** It cannot be
  checked, and every wiki predating this schema is made of such entries;
  treating them as failures would gate `close` on the whole corpus. Anchor
  new entries; leave old ones alone.
- **The cutoff is automatic.** Entries dated on or before it are never
  enforced, so the day the checker first runs in a project, nothing existing
  is debt. It records that date itself; a `Sweep cutoff: YYYY-MM-DD` line in
  CLAUDE.md pins it explicitly if you want it visible or moved. There is no
  opt-in: a wiki nobody opens is exactly the wiki that goes stale, so
  protection cannot depend on a session remembering to enable it.
- **Exit codes:** 0 clean · 1 debt · 3 the checker itself failed. `close`
  gates on 1 only — a 3 is a bug to report, not debt to clear, and must
  never become an unclearable block.

## Editing rules

- Notes with `status: active` are living documents — edit freely, bump
  `updated:`. But any edit that **changes a ruling** must, same session:
  (a) sweep every note in `links:` (stamping each), (b) append a
  `decisions.md` entry whose `Touches:` names the anchors just stamped.
- **Note first, register second.** The register line is a RECEIPT for a note
  edit that already happened — it quotes or paraphrases the note line just
  changed and names its anchor. Written the other way round it becomes a
  dangling write: the append-only log knows the truth while the note a fresh
  session actually reads keeps stating the superseded version.
- **Smallest true edit.** Prefer appending a flagged line over rewriting a
  paragraph; prefer striking one clause over restructuring a section. Never
  restructure a note in the same session you correct its content — a
  correction must stay reviewable as a correction, not become an unreviewed
  rewrite. Restructuring is its own task, done on a session with fresh eyes.
- Superseding: new note gets the content, old note body moves to `archive/`,
  old file keeps frontmatter with `status: superseded-by-NN` + one pointer line.
- Before touching any design area, check `contentions.md` — an open
  contention is NEVER resolved silently; raise it with the user. Raising it is
  YOUR move to make, not something to wait to be asked for: silence reads as
  "still open" no matter how much evidence has accumulated, so a contention
  whose resolve-condition is met goes back to the user the session it is met.
  See "Contention check-in" in `close`.
- Numbers in notes come from scripts/cleared exports, not memory — link the
  source next to every magnitude.

## Register overflow (split, never shrink)

A register over its cap is a real failure: past the cap nobody reads it, so an
append-only log silently stops being memory. But the remedy is never
compression. **Do not shorten, merge, or reword a factual entry to meet a line
count.** Detail deleted to satisfy a cap is unrecoverable, and afterwards it is
indistinguishable from detail that was never recorded — the worst possible
state for a memory system. A cap is met by moving lines out whole, not by
making lines smaller.

Before splitting, check what the lines actually are:

- **Maintenance meta does not belong here.** Audit verdicts, split records,
  notes about the wiki's own upkeep go to `wikilog.md` (uncapped), whole.
  Registers hold facts about the project, not about the wiki.
- Entries that were never facts — musings, duplicates of a note's own text —
  may be deleted. Everything factual survives verbatim.

Don't wait for the cap to trigger curation. `contentions.md` especially rots
quietly: an entry stays flagged "open" long after a later decision or finding
resolved it, because nothing ever re-reads it once it's not growing. Prune on
sight whenever you're in a register for another reason — the `lint`
subcommand's "Contention currency" check exists for this.

If still over cap, split. **Archiving is not deletion and never loses a
ruling.** Four steps, in order:

1. **Split by era, not by size.** Cut at a natural boundary (a phase, a
   milestone, a change of subject), never "the oldest N lines". Write the full
   bodies to `archive/<register>_<era>.md`, each archive file opening with why
   it was split, when, and where the canonical home of its content now is.
2. **Leave an index row per entry in the live register.** One line: date, kind,
   the ruling in a clause, and the note that is its canonical home. A reader must
   be able to see that a decision exists without opening the archive — the index
   is what keeps the archive from being a memory hole.
3. **Promote the durable material into a numbered note before archiving the
   bodies.** Ask what a fresh session actually needs from these entries in the
   read path. For `decisions.md` that is the **Rejected:** lines — the
   alternatives already killed — which earn a "roads not taken" note; archiving
   them with the bodies invites re-proposing dead branches. This step is the
   difference between an archive and a landfill.
4. **Record the split**: one `wikilog.md` line — what moved where, what was
   promoted (plus a `deletions.md` row in software projects if code docs moved).

Applies to any capped file. `00_state.md` over 60 lines is a different failure —
it means settled content leaked into the churn file, so the fix is to move it
into the note that owns it, not to archive it.

---

## Subcommands

### `init`

1. Read the project's CLAUDE.md; if a `## Project memory (llmwiki)` block
   exists, report and stop (idempotent).
2. Ask/infer `<WIKI>` and `<JOURNAL>` (defaults: `local_context/wiki/`,
   `local_context/notes/`; respect existing project structure).
3. Create `<WIKI>/` skeleton: `00_state.md` from template, empty registers
   with their header lines (each register's discipline stated in its own
   header, e.g. the contentions "do not silently resolve" line), `wikilog.md`,
   `archive/`.
4. Ensure the wiki layer is gitignored.
5. Append this block to CLAUDE.md (keep total ≤ 150 lines — trim CLAUDE.md
   content that duplicates wiki notes while you're there). `Sweep cutoff` is
   today's date — the sentinel checker enforces only entries on/after it:

```markdown
## Project memory (llmwiki)
- Wiki root: <WIKI>
- Journal: <JOURNAL>
- Kind: research | software        (software adds budgets.md, deletions.md, and the
  architecture note — see the "Software projects" section of the skill)
- Sweep cutoff: YYYY-MM-DD         (register entries on/after this date are sentinel-checked)
- Schema + workflows: `/llmwiki` skill.
- **Read `<WIKI>/00_state.md` first in every session.** Open numbered notes
  on demand via its pointers; do not re-derive settled design.
- Before touching design: check `<WIKI>/contentions.md` — never silently
  resolve an open contention, and never sit on a ripe one: `close` brings
  contentions whose resolve-condition is met (or which 3 sessions have not
  moved) back to the user with a recommendation.
- Corrections: edit the owning note FIRST and stamp it
  (`<!-- swept: anchor date -->`), then the register line as receipt
  (`Affects: [[NN_note#anchor]]`).
- Session end / before compact: run `/llmwiki close`; first thing after a
  `/clear`, run `/llmwiki next` to pick up `00_state.md`'s Next list.
- Artefacts that land (payload rounds, exports, transcripts) can nag until the
  wiki has them: `/llmwiki trigger` sets one, `close` discharges it.
- Run `/llmwiki lint` after: design adoption/supersession, a results round,
  a payload round returning, CLAUDE.md edits, or 5+ sessions without one.
```

6. Check hooks: `ls ~/.claude/hooks/wiki-*.py` (must include
   `wiki-sweepcheck.py`) and grep `wiki-` in `~/.claude/settings.json`
   (`wiki-sweepcheck.py` belongs in SessionStart, after `wiki-restore.py`;
   `wiki-trigger.py` beside it, and it is silent in a project that declares no
   `Trigger:` line, so it costs nothing to wire before one exists).
   If missing, print the install instructions (deploy with `/install-hooks`;
   settings snippet in the hooks collection's `README-llmwiki-hooks.md`).

### `seed`

Populate a freshly-initialized wiki from existing project material.

1. Inventory sources: existing notes/journal, CLAUDE.md, README, lit indexes.
2. Propose a seeding map (source → wiki file) to the user unless one is
   already agreed; then write numbered notes and registers per the formats
   above. Every seeded claim carries a provenance pointer to its source
   note/section. Contemplated-but-undecided designs seed as `status:
   proposal` notes with a decision rule — never as active.
3. Do NOT modify or move the source journal notes; add at most one header
   line to a superseded planning note pointing to the wiki.
4. Recommend a cold-read audit (fresh subagent gets ONLY the seeded wiki +
   the source notes, verifies every seeded claim against its source,
   reports discrepancies with quoted evidence). Run it via Task.

### `close` (session close-out — the unconditional loop)

Target: ≤ 5 minutes of work.

Order matters and is the point: **notes before registers**. The register line
is a receipt for a note edit that already happened. Written registers-first,
the fact lives only in the append-only log while its canonical home keeps
stating the superseded version — the single most-repeated wiki defect, which
is why step 3 checks it mechanically instead of trusting step 1.

1. **Sweep first.** For every correction, ruling, or durable fact from this
   session: edit the owning numbered note NOW — smallest edit that makes it
   true (append a flagged line; strike a clause; do not rewrite) — and put
   the sweep stamp on the edited line: `<!-- swept: <anchor> YYYY-MM-DD -->`.
   No owning note yet? Either create it, or plan the register line with
   `(pending: <why>)`.
2. **Then the receipts.** Append the register one-liners earned this session
   to `tried.md` / `gotchas.md` / `findings.md`; decisions taken get their
   `decisions.md` entry if not already written. Each `Affects:`/`Touches:`
   names the `[[note#anchor]]` just stamped and quotes or paraphrases the
   note line that changed.
3. **Run the sentinel**: `python3 ~/.claude/hooks/wiki-sweepcheck.py <project
   dir>` — it must exit 0. Exit 1 is debt: a step-1 omission, fix it now, and
   resolve or re-justify any `(pending)` it lists. Exit 3 means the checker
   crashed — say so and carry on closing; it is not debt.
3b. **Discharge the triggers**: `python3 ~/.claude/hooks/wiki-trigger.py
   <project dir>` — same gate, same exit codes. Exit 1 names artefacts that
   landed and were never written up. Clear each one the way step 1 clears a
   note: write the line that says what it *was* — the finding, the verdict, the
   reason it mattered — then delete its `<!-- unswept: … -->` marker. A project
   with no `Trigger:` lines exits 0 and says so; this step costs it nothing.
   **Do not clear a marker by deleting it.** The marker is not the debt; the
   missing sentence is.
4. Update `00_state.md`: Now / Open loops / Next / Controlling documents.
   Enforce the 60-line cap (by moving settled content to its owning note,
   never by compressing).
5. **Contention check-in — bring the ripe ones back to the user.** Read
   `contentions.md` and, for each open entry, ask the one question its own
   **Resolves when:** line asks. Surface it to the user, in the close report,
   when any of these holds:

   - its resolve-condition is **met** — including a met multi-session counter;
   - it is **partly answered** and the remainder is a task nobody has scheduled
     (name the remainder, propose who runs it and when);
   - a later `decisions.md`/`findings.md` entry has already answered it and
     nobody marked it resolved;
   - it has gone **3 sessions** without a single line of new evidence — a
     contention nothing is testing is either dead, mis-stated, or now just a
     design note, and each of those is a resolution.

   Get the list from `wiki-contentions.py` rather than by eye, and hand any
   ripe ones to `resolve` if there are more than one or two.

   Report each as one line — `Cx · <what it asked> · <what changed> ·
   <recommendation: resolve / one named step from resolution / restate / drop
   to a note>` — with the recommendation stated plainly, not hedged. **The
   verdict is the user's**: you do not mark a contention resolved on your own
   judgment, and you do not stay quiet because you are unsure it is ripe. If
   nothing is ripe, say so in one line; that line is what keeps the register
   from rotting unread. When the user rules, apply it in the SAME session:
   move the body to `archive/`, leave the one-row summary, and receipt it in
   `decisions.md`.

6. Append a journal entry `<JOURNAL>/YYYY-MM-DD_<slug>.md` (or a dated
   addendum to today's existing entry). Skeleton:
   headline outcome → the finding (if any) → consequences for the design →
   what was built → decisions taken → **nothing has run / unverified** →
   files touched (new:/rewritten:/updated:).

### `next` (propose the next queued item, then start it — the inverse of `close`)

The other half of the loop: `close` writes the queue, `next` reads it. Run it as
the first thing in a fresh context — `close` → `/clear` → `next` — so that
re-entry costs one line instead of a re-typed brief. **The Next list is the
brief**; nothing is written twice.

1. Read `00_state.md`. The SessionStart hook usually injected it already — use
   that copy rather than re-reading.
2. Take **Next item `$1`** (default: 1). A non-numeric argument is matched
   against the Next list instead; no match, ask which.
3. **Check the item is still true before doing it.** If a later
   `decisions.md`/`findings.md` entry already did it, or contradicts it, say so
   and propose the `00_state` correction — doing stale queued work is the
   failure this step exists to prevent, and a queue nobody audits grows them.
4. Open **only** what the item points at, plus `contentions.md`. Do not
   re-derive settled design; that is what the notes are for.
5. **Restate it, then ask before starting.** Two lines — what the item is, and
   what you would read and do first — then put it to the user with the question
   UI: *proceed with this* · *a different Next item* (name them) · *something
   else*. **Wait for the answer.** `next` never starts the work on its own: the
   queue was written by a past session that cannot see today, and the cheapest
   moment to redirect is before anything has been read in depth. A stale item
   found at step 3 is put the same way, with the correction as the recommended
   option.
6. On a yes, honour the project's own working rules — where CLAUDE.md asks for a
   design pass, the key implementation questions come back to the user
   **before** anything is built.

`next` never edits the wiki. It is a read, a proposal and — once confirmed — a
plan; the writes happen at `close`.

### `lint` (fresh-context audit — via Task subagent)

Spawn a subagent that gets the wiki + journal paths and NOTHING about the
current session. Its checks:

1. **Previous audit applied**: read the last lint line in `wikilog.md`, then
   verify each of that audit's accepted findings actually landed in the files
   it named. An audit whose findings evaporate is worse than no audit — it
   spends trust and fixes nothing.
2. **Contradictions**: `00_state.md` vs numbered notes vs `decisions.md`;
   two documents claiming to control the same domain.
3. **Status audit**: proposals whose decision rule has resolvable inputs;
   superseded notes still cited as active; `updated:` dates vs content.
4. **Sweep check**: run `wiki-sweepcheck.py` (deterministic — do not
   re-derive its result by reading). Manually check only what it cannot see:
   pre-cutoff or undated entries whose Touches/Affects targets look stale.
5. **Contention currency**: for every `contentions.md` entry, check whether a
   later `decisions.md`/`findings.md` entry already resolved it. A resolved
   contention left flagged live is a defect on its own — don't wait for a
   size cap to catch it. Propose marking it resolved with a pointer to what
   resolved it, or moving the settled fact to `findings.md` and dropping the
   entry. Also report, for every entry, the date of the newest evidence that
   touched it and whether its **Resolves when:** condition is met, unmet, or
   **unfalsifiable as written** — an entry no session can ever discharge is a
   defect in the entry, not an open question. Resolving is the user's call:
   lint names the ripe ones, the main session brings them to the user.
6. **Caps**: 00_state ≤ 60, registers ≤ 100, CLAUDE.md ≤ 150 — for anything
   over, propose a concrete split per "Register overflow" above (name the cut,
   the archive filename, and what gets promoted to a note), not a bare
   line count. Never propose tightening entries. Misfiled maintenance meta →
   propose moving it to `wikilog.md`.
7. **Links**: `[[targets]]` exist; journal entries since the last lint are
   reflected in state/registers.
8. **Trigger candidates**: read CLAUDE.md and the numbered notes for standing
   prose obligations of the shape *after X lands, write Y in the wiki* — "run
   `/llmwiki lint` after a payload round returns", "log every export". Each is a
   sentence that cannot fire on its own. Report them as **candidates**, with the
   obligating line quoted and a `Trigger:` line that would express it, and name
   the folder the artefacts actually live in. Never install one silently: a
   trigger the user did not choose is a nag they will switch off, and switching
   it off takes the real ones with it. Already-declared triggers are not
   reported again.

Output rules:

- Findings WITH evidence: **every** file/symbol/line citation is accompanied
  by the exact text found at that location, quoted, so the applying session
  can verify without re-reading the file. Never report a batch of citations
  as a pattern ("these four are all off by 20") — quote each one
  individually; the one exception in the batch is invisible any other way.
- The lint agent never edits. The main session applies approved changes,
  **bounded**: each finding gets a stated diff before it is applied, capped
  at ~10 changed lines. Anything larger is logged as its own restructuring
  task (in `00_state.md` → Next) and NOT done inline — see "Smallest true
  edit".
- Log the lint as one `wikilog.md` line (date + verdict), never as a
  register entry.

### `resolve` (put ripe contentions to the user — the only way one closes)

A contention is never resolved silently, and the measured failure is that it
is never resolved at all: entries whose condition was met sat open for three
sessions, for five weeks, and in one case while `00_state.md` asserted the
opposite. `close`'s check-in reports them; this stage rules on them.

1. **Enumerate, don't judge yet**:
   `python3 ~/.claude/hooks/wiki-contentions.py --json <project dir>`. It
   returns every entry with its resolve-condition (reading all five field
   spellings that predate this schema), the newest register evidence naming
   it, its age, and why it is ripe. Do not re-derive this by reading — a
   roll-call line naming every id is deliberately not counted as evidence,
   and a hand pass tends to count it.
2. **Read the ripe ones properly.** For each, open the contention and the
   evidence it cites. The script says something changed; only reading says
   what it means.
3. **Ask the user, one question per contention**, using the question UI, at
   most four per round (more than that is a meeting, not a check-in). Each
   question carries: what the contention asked, what has changed since, and
   2–4 verdicts — *resolve as X* · *still open, and here is what is missing*
   · *restate the condition* · *park with a named unpark condition* · *drop
   it to a note*. Put your recommendation first and say it plainly; a
   contention you cannot recommend on is one you have not finished reading.
   **Never resolve one on your own judgment, and never stay silent because
   you are unsure it is ripe** — the script decides ripeness, the user
   decides truth.
4. **Apply the ruling the same session**, per the contentions lifecycle:
   body to `archive/contentions_<era>.md`, one row left behind (id, question,
   answer, date), a `decisions.md` receipt with `Touches:`, a `wikilog.md`
   line. A restatement rewrites only the `Resolves when:` line. A park adds
   `status: parked` and its unpark condition.
5. Re-run the script; it must report the ruled entries as no longer ripe.

### `trigger` (arm a standing obligation so it checks itself)

A trigger nobody sets is worth nothing, and *nobody* means the agent: whoever
notices *"run `/llmwiki lint` after a payload round returns"* is the same agent
that has been ignoring it. So setting one must cost under a minute (`/llmwiki`
#1) or it never happens twice.

`/llmwiki trigger <folder>` — or no argument, to work from `lint`'s candidates.

1. **Look before proposing.** List the folder's leaves. Infer the date shape
   from the names (`20260826d` and `2026-08-26_slug` are both understood; a leaf
   with no date is always checked, never skipped). Decide the mode from what is
   actually there: a per-artefact file that a producer writes → `marker:<file>`;
   nothing inside to key on → `mention`, which asks whether the wiki names the
   artefact at all. A folder needing both gets two lines.
2. **Show what it would flag TODAY**, before writing anything:
   `python3 ~/.claude/hooks/wiki-trigger.py --json <dir>` against a draft
   declaration. A trigger that would fire on forty rounds of history is a
   trigger the user turns off within a day — which is what the cutoff is for.
3. **Put it to the user**: the line you would add, the count it flags now, and
   the cutoff you would stamp. Wait. Then write the `Trigger:` line into
   CLAUDE.md's llmwiki block and pin `Trigger cutoff:` to today.
4. **Arm the producer, or the reader.** If a script creates these artefacts, it
   should drop the marker as it files them — the obligation is armed by the act
   that creates the thing, not by anyone remembering. If a human drops them by
   hand, `wiki-trigger.py --mark <path>` is the one-liner that does it.

**Never declare a trigger the user did not approve**, and never widen one
silently. The checker never runs project code and the declaration has no field
that could name any; keep it that way.

### `state`

Quick reconcile: read `00_state.md`, compare against the live session and
repo (git status, recent journal), rewrite it. Use when the SessionStart
hook flags staleness.

## Software projects (extension)

A research wiki tracks *knowledge* growth. A software wiki must additionally track
*artifact* growth — because the generator is additive by construction and complexity
accumulates per session, not per release. Projects whose CLAUDE.md block carries
`- Kind: software` add the following.

**Two extra registers:**

- `budgets.md` — (i) declared ceilings: LOC per package, module count, max runtime
  dependencies, max complexity grade, coverage floor; (ii) dated measurement rows
  appended at every `close`. **The delta column is the product**, not the absolutes.
- `deletions.md` — append-only subtraction log:
  `date | removed | why | what replaced it (or "nothing") | decision ref`.
  Also records merges of duplicated abstractions.

**One extra numbered note, mandatory:** the architecture note — the *current* design
description of the shipped code, not the plan. arc42-lite: purpose/scope · constraints ·
building blocks (one line per package: responsibility, public surface, what it may
import) · runtime view for the 2–3 flows that matter · cross-cutting concepts · known
debt (linking to `contentions.md`). Exactly one canonical home per architectural fact.

**Frontmatter gains `covers:`** — globs of the source paths a note describes. This is
what makes drift detectable without a central docs-map (which decays under renames).

**Every architectural claim gets an executable counterpart or an explicit
`enforced-by: none (review only)`.** Prose-only facts are affordable in a research wiki
and not in a software one, because the code moves faster than anyone re-reads the doc.
This is "structural, not instructional" applied to the documentation itself.

### `close` — additional checks (all as deltas since the previous close)

1. LOC delta per top-level package, and total. Append the row to `budgets.md`.
2. **New modules**: every added source file needs a line in the architecture note or a
   justification in the session log. New module without a doc line = not done.
3. **New runtime dependencies**: hard gate — needs a `decisions.md` entry. Dependency
   sprawl is irreversible in practice.
4. **Public API delta**: additions get a line in the architecture note; breaking changes
   get a decision entry.
5. **Architecture contracts pass** (e.g. `lint-imports`); a *relaxed* contract is a
   decision, not a fix.
6. Regenerate any `<!-- generated: ... -->` block in the architecture note; if the graph
   changed, `updated:` must change too.
7. **Dead code delta** — new unreferenced symbols are deleted now or logged in
   `contentions.md` with an owner.
8. **The deletion prompt**: "what did you delete or unify?" — answered in
   `deletions.md` every session, even if "nothing". A session with new modules and zero
   deletions is a visible anomaly, not a normal day.
9. **Removed or disabled tests**: diff for deleted `def test_` and added
   skip/xfail markers. Agents make things green by turning checks off; make it loud.
10. Doc freshness: newest commit over each note's `covers:` globs vs its `updated:`.

### `lint` — additional checks (semantic; what a fresh subagent is uniquely good at)

1. **Doc↔code contradiction sweep**: read the architecture note's building-block section,
   then the actual imports, and report every claim that is false.
2. **Invariant audit**: every `enforced-by:` target exists, is not skipped, and actually
   tests the stated property — read the test, don't just grep the name.
3. **Duplicate-abstraction hunt**: two places doing the same job. Report to
   `contentions.md`.
4. **Shallow-module report**: public symbols per 100 LOC, parameter counts, concepts a
   caller must know. Flag the shallowest three as elegance debt — a large interface
   hiding little functionality is the standard shape of generated code.
5. **Orphans**: notes whose `covers:` paths are gone; decisions whose affected paths are
   gone (candidates for `superseded`).
6. **`tried.md` collision**: did this cycle re-introduce something previously rejected?
7. **Read-path budget**: `00_state.md` + CLAUDE.md + architecture note + invariants note
   under a combined line cap. Adherence is a function of the *loaded* size, not the repo
   size; push detail down into on-demand notes.

### Tooling shortlist (Python)

`import-linter` (layer/independence/forbidden contracts — the highest-value single
adoption: it makes the dependency rule a test) · `vulture` + `ruff` F401/F841/F811
(dead code) · `deptry` (dependency hygiene) · `radon`/`xenon` (complexity gate) ·
`griffe check` (public API breaking-change diff) · `pytestarch` (fitness functions
import-linter can't express) · `pyreverse -o mmd` (generated module graph).
Pick **one** boundary enforcer — `import-linter` *or* `tach` — never both as gates.

## Boundary with other skills

- Project-specific knowledge → wiki registers. **Cross-project reusable
  know-how → `/learn`** (a new skill in the collection).
- In wiki projects, `/llmwiki close` REPLACES `/session-log`
  (session-log remains for non-wiki repos).
- `/llmwiki init` replaces `/setup-local-context` in wiki projects (it
  creates the same local_context scaffolding where missing).
