/**
 * The one-time `wikiviewer` → `Inchworm` `userData` handoff: copies when there
 * is something to copy, and is a no-op every other way a launch can find it.
 */

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { migrateLegacyUserData } from './legacyUserData.js'

let base = ''
let legacyDir = ''
let userDataDir = ''

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'inchworm-migrate-'))
  legacyDir = join(base, 'wikiviewer')
  userDataDir = join(base, 'Inchworm')
  await mkdir(userDataDir, { recursive: true })
})

describe('migrateLegacyUserData', () => {
  test('copies projects.json and settings.json out of the old wikiviewer folder', async () => {
    await mkdir(legacyDir, { recursive: true })
    await writeFile(join(legacyDir, 'projects.json'), '{"projects":[]}', 'utf8')
    await writeFile(join(legacyDir, 'settings.json'), '{"noteTag":"eddy"}', 'utf8')

    await migrateLegacyUserData(userDataDir)

    expect(await readFile(join(userDataDir, 'projects.json'), 'utf8')).toBe('{"projects":[]}')
    expect(await readFile(join(userDataDir, 'settings.json'), 'utf8')).toBe('{"noteTag":"eddy"}')
  })

  test('a legacy folder that does not exist is not an error', async () => {
    await expect(migrateLegacyUserData(userDataDir)).resolves.toBeUndefined()
  })

  test('never overwrites a file the new install already wrote', async () => {
    await mkdir(legacyDir, { recursive: true })
    await writeFile(join(legacyDir, 'projects.json'), '{"projects":["legacy"]}', 'utf8')
    await writeFile(join(userDataDir, 'projects.json'), '{"projects":["current"]}', 'utf8')

    await migrateLegacyUserData(userDataDir)

    expect(await readFile(join(userDataDir, 'projects.json'), 'utf8')).toBe('{"projects":["current"]}')
  })
})
