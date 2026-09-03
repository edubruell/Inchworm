/**
 * The settings file as bytes: what decodes, what is repaired, and what a file
 * from an older build turns into. Unreadable is the defaults, never a crash.
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { DEFAULT_SETTINGS } from '@core/settings.js'
import type { Settings } from '@shared/api.js'
import { createSettingsStore, decodeSettings, encodeSettings, SETTINGS_VERSION } from './settingsStore.js'

const two: Settings = {
  launchers: [
    { id: 'claude', label: 'claude', command: 'claude' },
    { id: 'codex', label: 'codex', command: 'codex --model o3' },
  ],
  defaultLauncherId: 'codex',
  noteTag: 'eddy',
}

describe('decodeSettings', () => {
  test('round-trips through encodeSettings, version included', () => {
    expect(decodeSettings(encodeSettings(two))).toEqual(two)
    expect(JSON.parse(encodeSettings(two))).toMatchObject({ version: SETTINGS_VERSION })
  })

  test('a missing, empty or unreadable file is the defaults rather than a crash', () => {
    expect(decodeSettings('')).toEqual(DEFAULT_SETTINGS)
    expect(decodeSettings('{oh no')).toEqual(DEFAULT_SETTINGS)
    expect(decodeSettings(JSON.stringify({ version: 99, launchers: [] }))).toEqual(DEFAULT_SETTINGS)
  })

  /**
   * The point of running `core`'s repair over a file that *parsed*: JSON can be
   * well-formed and a launcher still unusable, and one bad row must not cost
   * the reader the others.
   */
  test('a hand-edited file keeps its good rows and loses its broken one', () => {
    const text = JSON.stringify({
      version: SETTINGS_VERSION,
      launchers: [
        { id: 'claude', label: 'claude', command: 'claude' },
        { id: 'broken', label: '', command: '' },
      ],
      defaultLauncherId: 'claude',
    })

    expect(decodeSettings(text).launchers.map((launcher) => launcher.id)).toEqual(['claude'])
  })

  test('a default naming a row that is not in the file falls back to one that is', () => {
    const text = JSON.stringify({
      version: SETTINGS_VERSION,
      launchers: [{ id: 'codex', label: 'codex', command: 'codex' }],
      defaultLauncherId: 'claude',
    })

    expect(decodeSettings(text).defaultLauncherId).toBe('codex')
  })
})

describe('createSettingsStore', () => {
  let path = ''
  beforeEach(async () => {
    path = join(await mkdtemp(join(tmpdir(), 'wikiviewer-settings-')), 'settings.json')
  })

  test('a machine with no settings file gets the one-agent default', async () => {
    const store = await createSettingsStore(path)
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
  })

  test('a saved change is on disk and readable back', async () => {
    const store = await createSettingsStore(path)

    await store.set(two)

    expect(store.get()).toEqual(two)
    expect(decodeSettings(await readFile(path, 'utf8'))).toEqual(two)
  })

  test('a file from a newer app is moved aside rather than destroyed', async () => {
    await writeFile(path, JSON.stringify({ version: 99, wat: true }), 'utf8')
    const store = await createSettingsStore(path)

    await store.set(two)

    expect(JSON.parse(await readFile(`${path}.unreadable`, 'utf8'))).toEqual({ version: 99, wat: true })
    expect(decodeSettings(await readFile(path, 'utf8'))).toEqual(two)
  })

  test('two writes in flight at once do not interleave into half a file', async () => {
    const store = await createSettingsStore(path)

    await Promise.all([store.set(two), store.set(DEFAULT_SETTINGS), store.set(two)])

    expect(decodeSettings(await readFile(path, 'utf8'))).toEqual(two)
  })
})
