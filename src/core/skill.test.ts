/**
 * The manifest and the comparison behind the install guard. Nothing here
 * touches a disk: `main/skill.test.ts` owns the bytes, this owns the rules.
 */

import { describe, expect, test } from 'vitest'
import { isFreshInstall, skillDigest, skillState, SKILL_DIR, SKILL_FILES, type SkillEntry } from './skill.js'

const entries = (shas: Record<string, string>): readonly SkillEntry[] =>
  SKILL_FILES.map((file) => ({ target: file.target, sha: shas[file.target] ?? '' }))

const ALL = Object.fromEntries(SKILL_FILES.map((file) => [file.target, `sha-${file.target}`]))

describe('the manifest', () => {
  test('names both write scopes and nothing else — settings.json is never a target', () => {
    const scopes = new Set(SKILL_FILES.map((file) => file.target.split('/').slice(0, -1).join('/')))
    expect([...scopes].sort()).toEqual(['hooks', SKILL_DIR])
    expect(SKILL_FILES.some((file) => file.target.includes('settings.json'))).toBe(false)
  })

  test('every target stays under ~/.claude: relative, no `..`, no absolute path', () => {
    for (const file of SKILL_FILES) {
      expect(file.target.startsWith('/')).toBe(false)
      expect(file.target.split('/')).not.toContain('..')
      expect(file.source.includes('/')).toBe(false)
    }
  })

  test('the hooks are executable and the documents are not', () => {
    for (const file of SKILL_FILES) {
      expect(file.executable).toBe(file.target.startsWith('hooks/'))
    }
  })
})

describe('the digest', () => {
  test('a copy with nothing installed is `` — the only value that means absent', () => {
    expect(skillDigest(entries({}))).toBe('')
  })

  test('one file present is not absent, however many are missing', () => {
    expect(skillDigest(entries({ [`${SKILL_DIR}/SKILL.md`]: 'x' }))).not.toBe('')
  })

  test('is order-independent: the same files in any order digest the same', () => {
    const forwards = entries(ALL)
    expect(skillDigest([...forwards].reverse())).toBe(skillDigest(forwards))
  })

  test('one changed byte anywhere changes it', () => {
    expect(skillDigest(entries({ ...ALL, 'hooks/wiki-overdue.py': 'other' }))).not.toBe(skillDigest(entries(ALL)))
  })

  test('a file that vanished changes it — a half-deleted install is not `current`', () => {
    const { [`${SKILL_DIR}/RATIONALE.md`]: _gone, ...rest } = ALL
    expect(skillDigest(entries(rest))).not.toBe(skillDigest(entries(ALL)))
  })
})

describe('the state', () => {
  test('absent when nothing is installed, whatever the build carries', () => {
    expect(skillState('bundled', '')).toBe('absent')
  })

  test('current only when the two digests are identical', () => {
    expect(skillState('bundled', 'bundled')).toBe('current')
    expect(skillState('bundled', 'older')).toBe('differs')
  })
})

describe('freshness', () => {
  test('a machine with no skill directory would be a fresh install', () => {
    expect(isFreshInstall(entries({}))).toBe(true)
  })

  test('hooks left behind by an older install do not make it fresh — the directory is what Claude Code discovers at startup', () => {
    expect(isFreshInstall(entries({ 'hooks/wiki-overdue.py': 'x' }))).toBe(true)
    expect(isFreshInstall(entries({ [`${SKILL_DIR}/SKILL.md`]: 'x' }))).toBe(false)
  })
})
