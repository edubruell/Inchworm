# Inchworm

A small desktop app for reading and editing **llmwiki** project memory —
`00_state.md`, numbered design notes, append-only registers and the dated
journal — beside a terminal running the agent that writes them.
Status: **post-M4, in daily use**: the CodeMirror source editor with a
sha-guarded save, the register append affordance, an xterm + node-pty drawer
and a packaged dmg — plus what use added, a settings surface whose launchers
name the agent, a front door, a door into a folder that is not a project yet,
and a Settings section that installs the `/llmwiki` skill this app reads.
This is the code's first public commit — its own development wiki
(`local_context/wiki/`) is gitignored and does not ship with it; run
`/llmwiki init` there to start one for work on this repo itself.

## Stack (settled — see wiki `03_technology_research`)

Electron (main / preload / sandboxed renderer) · Vite (3 build targets) ·
SolidJS · Tailwind v4 `@theme` tokens + native macOS chrome (vibrancy,
hidden-inset title bar; Kobalte deferred — `decisions` 2026-08-19) ·
CodeMirror 6 in **source mode** (its own line separator, so a save is
byte-faithful) · unified/remark + rehype for markdown · xterm.js + node-pty
(N-API prebuilds, no rebuild) · electron-builder · zod · vitest. macOS arm64 only.

## Hard rules

- **The renderer never touches the filesystem**, and never names its project:
  fs / git / PTY live in main behind a zod-validated, allow-listed IPC surface
  scoped by the *sending window*. `contextIsolation`, `sandbox`, no
  `nodeIntegration`. Reads and writes reach the wiki root, the journal and
  CLAUDE.md — never the rest of the repository.
- **`src/core` is pure** — no DOM, no node builtins, no I/O. All llmwiki schema
  knowledge lives there; no component may regex a filename.
- **Byte-faithful saves.** The app never reformats markdown, never sorts a
  register, never trims a file over its cap. No formatter is ever pointed at .md.
- **Registers are append-only**: new entries at the bottom, from the template.
  Two of them are tables and get no append affordance at all, rather than a
  wrong one.
- **Multi-window, one project per window.** Project-scoped state is per project
  and reference-counted; project-scoped IPC events broadcast to every window on
  that project, never just `event.sender`.
- **Colour has two disjoint families**: `--accent-*` is project identity (one
  hue per project, an OKLCH ramp over `--project-hue`), `--status-*` is fixed
  meaning (amber/red for proposals and cap breaches). Never derive one from the
  other; never a raw hex outside the theme file.
- **Functional TypeScript**: no classes, data-first small functions, pipelines,
  `Result<T,E>` over throwing, discriminated unions, `readonly`, no `any`, no `!`.
  Full rules in wiki `06_coding_style` — read it before writing code.
- **Budgets are ceilings** (wiki `budgets.md`, the only home for the numbers —
  never copy one into another file): runtime dependencies, coverage on `core`,
  LOC per package. A new runtime dependency needs a `decisions.md` entry, and
  so does a raised ceiling.
- Milestone order is `core` before pixels — wiki `05_implementation_plan`.

## Iteration review protocol (mandatory, every milestone)

No iteration is done until a **fresh-context review round** has run. Launch all
four in parallel, each as a subagent that has NOT seen the session that wrote
the code, each reporting findings with `file:line` evidence and editing nothing:

1. **Code quality & style** (Sonnet) — adherence to wiki `06_coding_style` and
   the patterns already decided; no new opinions.
2. **Test completeness** (Opus) — what is untested, what is tested shallowly,
   what the fixture does not cover.
3. **Bug hunt** (Opus) — correctness, lifecycle, IPC, error paths.
4. **`/llmwiki lint`** — doc↔code contradictions, caps, stale notes, links.

Plus a **visual check of the real interface in a browser via the Chrome MCP**
(screenshot + console + a11y tree), not just a passing build.

Then: apply the fixes, commit, push, and run `/llmwiki close`.

## Project memory (llmwiki)
- Wiki root: local_context/wiki/
- Journal: local_context/notes/
- Kind: software
- Sweep cutoff: 2026-08-25   (register entries on/after this date are sentinel-checked)
- Schema + workflows: `/llmwiki` skill.
- **Read `local_context/wiki/00_state.md` first in every session.** Open numbered
  notes on demand via its pointers; do not re-derive settled design.
- Before touching design: check `local_context/wiki/contentions.md` — never
  silently resolve an open contention, and never sit on a ripe one: `close`
  brings back, with a recommendation, every contention whose **Resolves when:**
  condition is met or which 3 sessions have not moved. The verdict is mine.
- Skill source of truth is `skills/llmwiki/` in this repo — install with
  `./skills/llmwiki/install.sh`, never edit `~/.claude/skills/llmwiki/` by hand.
- Corrections found in-session are written to the owning note the SAME session,
  plus a findings.md or decisions.md line.
- Session end / before compact: run `/llmwiki close`; first thing after a
  `/clear`, run `/llmwiki next` to pick up `00_state.md`'s Next list.
- Run `/llmwiki lint` after: design adoption/supersession, a results round, a
  payload round returning, CLAUDE.md edits, or 5+ sessions without one.
