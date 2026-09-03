/**
 * The installer against a real `~/.claude` in a temp directory: what it writes,
 * what it refuses, and what it leaves alone. The manifest and the comparison
 * are `core/skill.test.ts`'s; this is the disk.
 */

import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { SKILL_DIR, SKILL_FILES } from '@core/skill.js'
import { createSkillHost, type SkillHost } from './skill.js'

type Bench = {
  readonly host: SkillHost
  readonly claudeDir: string
  readonly source: string
  /** What is under the installed copy now, by target path. */
  readonly installed: () => Promise<Map<string, string>>
}

const bench = async (options: { readonly bundle?: boolean } = {}): Promise<Bench> => {
  const base = await mkdtemp(join(tmpdir(), 'wikiviewer-skill-'))
  const source = join(base, 'bundle')
  const claudeDir = join(base, 'claude')
  await mkdir(source, { recursive: true })
  if (options.bundle !== false) {
    for (const file of SKILL_FILES) await writeFile(join(source, file.source), `# ${file.source}\n`)
  }
  return {
    host: createSkillHost({ source, claudeDir }),
    claudeDir,
    source,
    installed: async (): Promise<Map<string, string>> => {
      const pairs = await Promise.all(
        SKILL_FILES.map(async (file) => [file.target, await readFile(join(claudeDir, file.target), 'utf8').catch(() => '')] as const),
      )
      return new Map(pairs.filter(([, text]) => text !== ''))
    },
  }
}

describe('status', () => {
  test('a machine with nothing installed is absent, with an empty digest', async () => {
    const it = await bench()
    const status = await it.host.status()

    expect(status).toEqual({ ok: true, value: { state: 'absent', sha: '', files: SKILL_FILES.length } })
  })

  test('a build carrying no skill says so rather than offering to install nothing', async () => {
    const it = await bench({ bundle: false })

    expect(await it.host.status()).toMatchObject({ ok: false, error: { kind: 'no-bundle' } })
  })

  test('after an install it is current, with a digest that is no longer empty', async () => {
    const it = await bench()
    await it.host.install('')
    const status = await it.host.status()

    expect(status.ok && status.value.state).toBe('current')
    expect(status.ok && status.value.sha).not.toBe('')
  })

  test('a hand-edited copy is `differs`, not `current`', async () => {
    const it = await bench()
    await it.host.install('')
    await writeFile(join(it.claudeDir, SKILL_DIR, 'SKILL.md'), 'edited by hand\n')

    expect(await it.host.status()).toMatchObject({ ok: true, value: { state: 'differs' } })
  })
})

describe('install', () => {
  test('writes every file of the manifest, into both scopes', async () => {
    const it = await bench()
    const done = await it.host.install('')

    expect(done).toMatchObject({ ok: true, value: { files: SKILL_FILES.length, fresh: true } })
    expect([...(await it.installed()).keys()].sort()).toEqual(SKILL_FILES.map((file) => file.target).sort())
  })

  test('the bytes are the bundle byte for byte — nothing is templated on the way through', async () => {
    const it = await bench()
    await it.host.install('')

    expect((await it.installed()).get(`${SKILL_DIR}/SKILL.md`)).toBe('# SKILL.md\n')
  })

  test('the hooks land executable and the documents do not', async () => {
    const it = await bench()
    await it.host.install('')

    for (const file of SKILL_FILES) {
      const mode = (await stat(join(it.claudeDir, file.target))).mode & 0o111
      expect(mode !== 0).toBe(file.executable)
    }
  })

  test('it creates ~/.claude and both directories under it, on a machine that has none', async () => {
    const it = await bench()

    expect(await it.host.install('')).toMatchObject({ ok: true })
  })

  test('settings.json is never touched, even when one is sitting there', async () => {
    const it = await bench()
    await mkdir(it.claudeDir, { recursive: true })
    await writeFile(join(it.claudeDir, 'settings.json'), '{"hooks":{}}\n')
    await it.host.install('')

    expect(await readFile(join(it.claudeDir, 'settings.json'), 'utf8')).toBe('{"hooks":{}}\n')
  })

  /**
   * The guard, and the reason this is not a copy loop: it refuses on a digest
   * that has moved and writes nothing at all.
   */
  test('a stale digest is refused, the current one comes back, and nothing is written', async () => {
    const it = await bench()
    await it.host.install('')
    await writeFile(join(it.claudeDir, SKILL_DIR, 'SKILL.md'), 'edited by hand\n')
    const current = await it.host.status()

    const refused = await it.host.install('')

    expect(refused).toEqual({ ok: false, error: { kind: 'conflict', currentSha: current.ok ? current.value.sha : '' } })
    expect((await it.installed()).get(`${SKILL_DIR}/SKILL.md`)).toBe('edited by hand\n')
  })

  test('the refusal is recoverable: re-read the digest and the same install goes through', async () => {
    const it = await bench()
    await it.host.install('')
    await writeFile(join(it.claudeDir, SKILL_DIR, 'SKILL.md'), 'edited by hand\n')
    const current = await it.host.status()

    const done = await it.host.install(current.ok ? current.value.sha : '')

    expect(done).toMatchObject({ ok: true, value: { fresh: false } })
    expect((await it.installed()).get(`${SKILL_DIR}/SKILL.md`)).toBe('# SKILL.md\n')
  })

  test('a second install of the same bytes is not fresh — no restart is owed for a directory that was there', async () => {
    const it = await bench()
    await it.host.install('')
    const after = await it.host.status()

    expect(await it.host.install(after.ok ? after.value.sha : '')).toMatchObject({ ok: true, value: { fresh: false } })
  })

  test('hooks left by an older install still count as fresh: the skill directory is what a restart is about', async () => {
    const it = await bench()
    await mkdir(join(it.claudeDir, 'hooks'), { recursive: true })
    await writeFile(join(it.claudeDir, 'hooks', 'wiki-overdue.py'), 'old\n')
    const status = await it.host.status()

    expect(await it.host.install(status.ok ? status.value.sha : '')).toMatchObject({ ok: true, value: { fresh: true } })
  })

  test('a build with no skill in it installs nothing and says which directory it looked in', async () => {
    const it = await bench({ bundle: false })

    expect(await it.host.install('')).toMatchObject({ ok: false, error: { kind: 'no-bundle' } })
    expect((await it.installed()).size).toBe(0)
  })

  test('a destination that cannot be written comes back as a sentence, not a throw', async () => {
    const it = await bench()
    await mkdir(join(it.claudeDir, SKILL_DIR), { recursive: true })
    await chmod(join(it.claudeDir, SKILL_DIR), 0o500)

    const refused = await it.host.install('')

    await chmod(join(it.claudeDir, SKILL_DIR), 0o700)
    expect(refused).toMatchObject({ ok: false, error: { kind: 'unwritable' } })
  })

  test('a failed write leaves no temp file behind', async () => {
    const it = await bench()
    await mkdir(join(it.claudeDir, SKILL_DIR), { recursive: true })
    await chmod(join(it.claudeDir, SKILL_DIR), 0o500)
    await it.host.install('')
    await chmod(join(it.claudeDir, SKILL_DIR), 0o700)

    expect((await readdir(join(it.claudeDir, SKILL_DIR))).filter((name) => name.endsWith('.tmp'))).toEqual([])
    await rm(it.claudeDir, { recursive: true, force: true })
  })
})

/**
 * The manifest against the directory it names. Every other test here builds a
 * synthetic bundle, so without this one a renamed hook — or a packaging filter
 * that drops it — passes the whole suite and dies in the shipped app
 * bundle it actually ships.
 */
describe('the bundle this repo actually carries', () => {
  const repoRoot = join(import.meta.dirname, '../..')

  test('every file the manifest names is in skills/llmwiki/', async () => {
    for (const file of SKILL_FILES) {
      expect(await stat(join(repoRoot, 'skills/llmwiki', file.source)).then(() => file.source, () => 'MISSING')).toBe(
        file.source,
      )
    }
  })

  /**
   * The other direction, which the check above cannot see: a file added to
   * `skills/llmwiki/` and never added to `SKILL_FILES` ships nowhere and fails
   * silently. That happened the day `wiki-trigger.py` was written (lint
   * 2026-08-27, M7), so the manifest is now pinned both ways.
   */
  test('every shippable file in skills/llmwiki/ is in the manifest', async () => {
    const notShipped = new Set(['install.sh', 'run-tests.sh', 'README.md'])
    const named = new Set(SKILL_FILES.map((file) => file.source))
    const present = (await readdir(join(repoRoot, 'skills/llmwiki'), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.py')))
      .map((entry) => entry.name)
      .filter((name) => !notShipped.has(name))

    expect(present.filter((name) => !named.has(name))).toEqual([])
  })

  test('every file install.sh copies is in the manifest — the two must not drift apart', async () => {
    const script = await readFile(join(repoRoot, 'skills/llmwiki/install.sh'), 'utf8')
    const named = new Set(SKILL_FILES.map((file) => file.source))
    // The docs the script copies by name, and the hooks it lists in HOOKS=().
    for (const source of ['SKILL.md', 'MIGRATION.md', 'RATIONALE.md', ...(/HOOKS=\(([^)]*)\)/.exec(script)?.[1] ?? '').split(/\s+/).filter(Boolean)]) {
      expect(named.has(source)).toBe(true)
    }
  })

  test('the packaged build ships every manifest file: no exclude pattern matches one', async () => {
    const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
      readonly build: { readonly extraResources: readonly { readonly filter: readonly string[] }[] }
    }
    const excluded = (pkg.build.extraResources[0]?.filter ?? [])
      .filter((pattern) => pattern.startsWith('!'))
      .map((pattern) => pattern.slice(1).replace('${/*}', ''))

    for (const file of SKILL_FILES) expect(excluded).not.toContain(file.source)
  })
})

describe('two installs at once', () => {
  /**
   * The interleaving `files.ts` serialises against, one directory up: both read
   * the same digest, both pass the guard, and they then race over the same
   * files. Two windows both have a Settings sheet.
   */
  test('are serialised: both answer, neither is a write failure, and the bytes are whole', async () => {
    const it = await bench()

    const [first, second] = await Promise.all([it.host.install(''), it.host.install('')])

    for (const result of [first, second]) {
      expect(result.ok || result.error.kind).not.toBe('unwritable')
    }
    // One of them wrote and the other found the copy moved — never both writing.
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)
    expect([...(await it.installed()).values()]).toEqual(SKILL_FILES.map((file) => `# ${file.source}\n`))
  })

  test('a failed install does not poison the queue for the next one', async () => {
    const it = await bench()

    await it.host.install('a stale digest')
    expect(await it.host.install('')).toMatchObject({ ok: true })
  })
})

describe('a write that fails part-way', () => {
  test('replaces nothing: the staging phase fails before any file is moved', async () => {
    const it = await bench()
    await it.host.install('')
    const before = await it.host.status()
    // The second scope is unwritable, and it holds the *last* three files.
    await chmod(join(it.claudeDir, 'hooks'), 0o500)

    const refused = await it.host.install(before.ok ? before.value.sha : '')

    await chmod(join(it.claudeDir, 'hooks'), 0o700)
    expect(refused).toMatchObject({ ok: false, error: { kind: 'unwritable' } })
    // The digest is unchanged, so the copy is whole and the sheet is not lying.
    expect(await it.host.status()).toEqual(before)
  })

  test('leaves no temp file behind in either scope, and none that Claude Code would list', async () => {
    const it = await bench()
    await it.host.install('')
    const before = await it.host.status()
    await chmod(join(it.claudeDir, 'hooks'), 0o500)
    await it.host.install(before.ok ? before.value.sha : '')
    await chmod(join(it.claudeDir, 'hooks'), 0o700)

    for (const dir of [SKILL_DIR, 'hooks']) {
      expect((await readdir(join(it.claudeDir, dir))).filter((name) => name.includes('.tmp'))).toEqual([])
    }
  })
})

describe('a copy that cannot be read', () => {
  /**
   * Absent and unreadable are different answers. Collapsing them would offer an
   * Install for a copy that is there, and would make the guard compare two
   * digests that both mean "I could not look".
   */
  test('is not reported as absent — it is its own refusal', async () => {
    const it = await bench()
    await it.host.install('')
    await chmod(join(it.claudeDir, SKILL_DIR, 'SKILL.md'), 0o000)

    const status = await it.host.status()

    await chmod(join(it.claudeDir, SKILL_DIR, 'SKILL.md'), 0o600)
    expect(status).toMatchObject({ ok: false, error: { kind: 'unreadable' } })
  })

  test('is refused by the install too, before anything is written', async () => {
    const it = await bench()
    await it.host.install('')
    await chmod(join(it.claudeDir, SKILL_DIR, 'SKILL.md'), 0o000)

    const refused = await it.host.install('')

    await chmod(join(it.claudeDir, SKILL_DIR, 'SKILL.md'), 0o600)
    expect(refused).toMatchObject({ ok: false, error: { kind: 'unreadable' } })
  })
})

describe('a bundle with a file missing', () => {
  /** What a wrong `extraResources` filter looks like from inside the app. */
  test('is a broken bundle, not a smaller one — no install is offered', async () => {
    const it = await bench()
    await rm(join(it.source, 'wiki-overdue.py'))

    expect(await it.host.status()).toMatchObject({ ok: false, error: { kind: 'no-bundle' } })
  })

  test('and pressing install anyway writes nothing', async () => {
    const it = await bench()
    await rm(join(it.source, 'wiki-overdue.py'))

    expect(await it.host.install('')).toMatchObject({ ok: false, error: { kind: 'no-bundle' } })
    expect((await it.installed()).size).toBe(0)
  })
})
