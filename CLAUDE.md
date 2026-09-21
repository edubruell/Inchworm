# Inchworm

A small desktop app for reading and editing **llmwiki** project memory —
`00_state.md`, numbered design notes, append-only registers and the dated journal —
beside a terminal running the agent that writes them. The `/llmwiki` skill it
installs is developed in this repo (`skills/llmwiki/`), so the schema and the reader
that renders it ship together.

Status: shipped and in daily use — the viewer, the CodeMirror source editor with
its sha-guarded save, the register append affordance, the xterm + node-pty
drawer, the debt section, the Settings sheet, the wiki zip export and a packaged
dmg. What is left is release polish (notarization), the **Windows and Linux
ports** — raised from non-goals to medium-term goals on 2026-09-08, surveyed
unbuilt in wiki `07_platform_ports` — and the ideas in the wiki's `ideas.md`.

This repo's own wiki lives in `local_context/wiki/` and is gitignored: it is
memory for work on this code, not part of what ships.

## Stack (settled — wiki `03_technology_research` has the revisit conditions)

Electron (main / preload / sandboxed renderer) · Vite, three build targets ·
SolidJS · Tailwind v4 `@theme` tokens with native macOS chrome (vibrancy,
hidden-inset title bar) · CodeMirror 6 in **source mode**, so a save is
byte-faithful · unified/remark + rehype · xterm.js + node-pty (N-API prebuilds,
no rebuild step on macOS/Windows — **Linux compiles it from source**) ·
electron-builder · zod · vitest. Ships macOS arm64; Windows and Linux are goals
and unbuilt — platform is an *injected value*, never a `process.platform` read
inside a module (wiki `07_platform_ports`).

`npm run check` is lint + typecheck + the suite, and is what CI runs.

## Hard rules

- **The renderer never touches the filesystem**, and never names its project:
  fs, git and PTY live in main behind a zod-validated, allow-listed IPC surface
  scoped by the *sending window*. `contextIsolation`, `sandbox`, no
  `nodeIntegration`. Reads and writes reach the wiki root, the journal and the
  agent file — `CLAUDE.md` **or** `AGENTS.md` (`core/schema.ts:AGENT_FILES`) —
  never the rest of the repository. **One write goes where the *reader* points**:
  the export bundle, its destination from a native save dialog and never from a
  payload (`main/export.ts`, wiki `01_product_scope` surface 7).
- **`src/core` is pure** — no DOM, no node builtins, no I/O. All llmwiki schema
  knowledge lives there and no component may regex a filename: a schema rule
  lands in `core` with its tests before any component shows it.
- **Byte-faithful saves.** Never reformats markdown, never sorts a register,
  never trims a file over its cap. No formatter is ever pointed at .md.
- **Registers are append-only**: new entries at the bottom, from the template.
  Three get none at all rather than a wrong one: two tables, and the wikilog,
  whose bullets the `/llmwiki` subcommands write.
- **Multi-window, one project per window.** Project-scoped state is per project
  and reference-counted; project-scoped IPC events broadcast to every window on
  that project, never just `event.sender` — a pane is the one window-scoped one.
- **Colour has two disjoint families**: `--accent-*` is project identity (one
  hue per project, an OKLCH ramp over `--project-hue`), `--status-*` is fixed
  meaning (amber/red for proposals and cap breaches). Never derive one from the
  other; never a raw hex outside the theme file.
- **Commits carry no agent attribution.** No `Co-Authored-By: Claude`, no
  `Claude-Session:` trailer, whatever the harness's default reminder says. The
  two commits that had them were rewritten and force-pushed on 2026-09-08.
- **Functional TypeScript**: no classes, data-first small functions, pipelines,
  `Result<T,E>` over throwing, discriminated unions, `readonly`, no `any`, no `!`.
  Full rules in wiki `06_coding_style` — read it before writing code.
- **Budgets are ceilings** (wiki `budgets.md`, the only home for the numbers —
  never copy one into another file): runtime dependencies, coverage on `core`,
  LOC per package. A new dependency or a raised ceiling needs a `decisions.md`
  entry; the total is the sum of the five packages and moves only when one does.

## Iteration review protocol (mandatory, every feature round)

No round is done until a **fresh-context review** has run: four subagents in
parallel, none having seen the session that wrote the code, each reporting
findings with `file:line` evidence and editing nothing, plus a visual check.

1. **Code quality & style** (Sonnet) — adherence to wiki `06_coding_style` and
   the patterns already decided; no new opinions.
2. **Test completeness** (Opus) — untested, tested shallowly, or absent from
   the fixture.
3. **Bug hunt** (Opus) — correctness, lifecycle, IPC, error paths.
4. **`/llmwiki lint`** — doc↔code contradictions, caps, stale notes, links.
5. **The real interface in a browser via the Chrome MCP** (screenshot, console,
   a11y tree), not just a passing build.

Then: apply the fixes, commit, push, run `/llmwiki close`. **Armed**: the new
journal entry is debt to `wiki-trigger.py` until its `reviews` marker is swept.

## Project memory (llmwiki)
- Wiki root: local_context/wiki/
- Journal: local_context/notes/
- Kind: software
- Sweep cutoff: 2026-09-08   (register entries on/after this date are sentinel-checked)
- Trigger cutoff: 2026-09-18
- Trigger: review-round | local_context/notes/*.md | marker:reviews
- Schema + workflows: `/llmwiki` skill.
- **Read `local_context/wiki/00_state.md` first in every session.** Open numbered
  notes on demand via its pointers; do not re-derive settled design.
- Before touching design: check `local_context/wiki/contentions.md` — never
  silently resolve an open contention, and never sit on a ripe one: `close`
  brings back, with a recommendation, every contention whose **Resolves when:**
  condition is met or which 3 sessions have not moved. The verdict is mine.
- Skill source of truth is `skills/llmwiki/` in this repo — install with
  `./skills/llmwiki/install.sh`, never edit `~/.claude/skills/llmwiki/` by hand,
  and diff the two before any install: a fix made in another project lands in
  the installed copy first.
- Corrections found in-session are written to the owning note the SAME session,
  stamped (`<!-- swept: anchor date -->`), and only then receipted with a
  findings.md or decisions.md line.
- Session end / before compact: run `/llmwiki close` and stamp the new journal
  entry `<!-- unswept: reviews -->`; it nags until the four reviews are in it.
  After a `/clear`, run `/llmwiki next` for `00_state.md`'s Next list.
- Run `/llmwiki lint` after: design adoption/supersession, a review round, a
  CLAUDE.md edit, or 5+ sessions without one.
