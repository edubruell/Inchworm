/**
 * The `/llmwiki` skill as a *manifest*: which files the skill is made of and
 * where each one lands under `~/.claude`. The skill and the app are one
 * product, so the app ships the skill and installs it — and the list of what
 * that means is schema knowledge, which lives here and nowhere else.
 * `main/skill.ts` is the disk; this file is the shape.
 *
 * Two write scopes, both named here and nothing else: the skill directory and
 * the three SessionStart hook scripts. `~/.claude/settings.json` is deliberately
 * absent — `install.sh` does not edit it either, and a wiring line the app
 * guessed wrong would break every project on the machine.
 */

/** One file of the skill: its name in the bundle, its path under `~/.claude`. */
export type SkillFile = {
  readonly source: string
  /** Relative to `~/.claude`, posix — never absolute, never `..`. */
  readonly target: string
  /** A hook is executed by Claude Code, so it is written `+x`. */
  readonly executable: boolean
}

/** The directory Claude Code discovers *only at startup* — a fresh install is
 * not visible to a session already running. */
export const SKILL_DIR = 'skills/llmwiki'

/**
 * Exactly what `skills/llmwiki/install.sh` copies, minus the settings.json
 * snippet it prints. The docs come along because `SKILL.md` points at them by
 * name and a skill with dangling pointers is a skill that lies.
 */
export const SKILL_FILES: readonly SkillFile[] = [
  { source: 'SKILL.md', target: `${SKILL_DIR}/SKILL.md`, executable: false },
  { source: 'MIGRATION.md', target: `${SKILL_DIR}/MIGRATION.md`, executable: false },
  { source: 'RATIONALE.md', target: `${SKILL_DIR}/RATIONALE.md`, executable: false },
  { source: 'wiki-sweepcheck.py', target: 'hooks/wiki-sweepcheck.py', executable: true },
  { source: 'wiki-contentions.py', target: 'hooks/wiki-contentions.py', executable: true },
  { source: 'wiki-overdue.py', target: 'hooks/wiki-overdue.py', executable: true },
  { source: 'wiki-trigger.py', target: 'hooks/wiki-trigger.py', executable: true },
]

/** One file as it was found: its sha, or `''` when it is not there. */
export type SkillEntry = { readonly target: string; readonly sha: string }

/**
 * The comparison the install is guarded by, as a stable string: one sorted line
 * per file, so a copy that gained, lost or changed a single file gets a
 * different answer. `''` — and only `''` — means *nothing of the skill is
 * installed*, which is the case the restart notice is about.
 *
 * It is not hashed here: `core` is pure and has no `node:crypto`. Main hashes
 * this, which is what makes the digest short enough to carry on the wire.
 */
export const skillDigest = (entries: readonly SkillEntry[]): string =>
  entries.every((entry) => entry.sha === '')
    ? ''
    : [...entries]
        .sort((a, b) => a.target.localeCompare(b.target))
        .map((entry) => `${entry.target} ${entry.sha}`)
        .join('\n')

/**
 * Absent, the same bytes this build carries, or something else. `differs` is
 * one state on purpose: an older install and a hand-edited one are the same
 * question — *replace what is there?* — and the app answers it the same way,
 * by writing whole files and never merging.
 */
export type SkillState = 'absent' | 'current' | 'differs'

export const skillState = (bundled: string, installed: string): SkillState =>
  installed === '' ? 'absent' : installed === bundled ? 'current' : 'differs'

/** Whether an install would create the skill directory rather than refresh it. */
export const isFreshInstall = (entries: readonly SkillEntry[]): boolean =>
  entries.every((entry) => entry.sha === '' || !entry.target.startsWith(`${SKILL_DIR}/`))
