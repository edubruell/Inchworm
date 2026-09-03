/**
 * The llmwiki schema, as data. Every other module — and every component —
 * asks this file what a register is called and where a cap sits, so no
 * component ever regexes a filename.
 *
 * The canonical statement of the schema is the `/llmwiki` SKILL.md; this is
 * that statement in TypeScript, and `tests/fixtures/sample-wiki/` is the same
 * statement in files.
 */

/**
 * Registers, in the order the schema lists them — which is the order the
 * sidebar shows them in. Never alphabetical.
 */
export const REGISTERS = [
  'ideas',
  'decisions',
  'contentions',
  'findings',
  'gotchas',
  'tried',
  'budgets',
  'deletions',
] as const

export type RegisterName = (typeof REGISTERS)[number]

export const isRegisterName = (name: string): name is RegisterName =>
  (REGISTERS as readonly string[]).includes(name)

/**
 * Hard line caps. Past the cap nobody reads the file, so an append-only log
 * silently stops being memory — which is why the app shows them and never
 * trims a file to fit.
 */
export const CAP = {
  state: 60,
  register: 100,
  claudeMd: 150,
} as const

/** The read-first file, by name. */
export const STATE_FILE = '00_state.md'

/**
 * The files an agent reads first, and where the llmwiki block may live —
 * **in preference order**. `CLAUDE.md` is the one the skill writes; `AGENTS.md`
 * is the cross-tool spelling, and a project that has only that one is still a
 * project. A project has one of these, not two; when both
 * exist the first wins, and the other is an ordinary file the app never lists.
 */
export const AGENT_FILES = ['CLAUDE.md', 'AGENTS.md'] as const
export type AgentFile = (typeof AGENT_FILES)[number]

export const isAgentFile = (name: string): name is AgentFile =>
  (AGENT_FILES as readonly string[]).includes(name)
export const ARCHIVE_DIR = 'archive'

/**
 * Where `/llmwiki init` puts a wiki, used for **diagnosis only**: a folder with
 * no usable block has no declared root, and the app still wants to tell the
 * difference between an empty folder and a half-finished init. Nothing reads a
 * project through this — a project's paths come from its agent file, always.
 * The app configures no paths of its own.
 */
export const CONVENTIONAL_WIKI_ROOT = 'local_context/wiki'

/** Sections of the navigation tree, in schema read order. */
export const SECTIONS = ['state', 'notes', 'registers', 'journal', 'archive'] as const
export type Section = (typeof SECTIONS)[number]

/**
 * What a section is called where a reader sees it — the sidebar heading and the
 * View menu item are the same word, and a section added to `SECTIONS` fails to
 * compile here rather than reaching the menu under its internal name. The menu
 * once carried its own copy of this list, so a sixth section would have reached
 * it with no ⌘-number at all.
 */
export const SECTION_LABEL: Record<Section, string> = {
  state: 'State',
  notes: 'Notes',
  registers: 'Registers',
  journal: 'Journal',
  archive: 'Archive',
}
