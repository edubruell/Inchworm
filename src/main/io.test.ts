/**
 * Each of these was a copy in three or four files before it landed here —
 * `shaOf` and the temp name in 2026-08-27, the chain and the JSON store in
 * 2026-09-03. So the point of the tests is not that a hash hashes: it is that
 * the *distinctions* survive being spelled once — `isMissing` still means only
 * ENOENT, the temp name is still hidden and unique, and a rejected job on the
 * chain still stalls nothing.
 */

import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { createChain, createJsonStore, detailOf, isMissing, shaOf, tempPathFor, tryJson } from './io.js'

describe('shaOf', () => {
  test('is sha-256 over the bytes, not over a decoded string', () => {
    const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x41])

    expect(shaOf(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'))
    // A `.dta` or an image would decode to replacement characters and hash the
    // same as any other undecodable file; the guard reads bytes for that reason.
    expect(shaOf(bytes)).not.toBe(shaOf(Buffer.from(bytes.toString('utf8'), 'utf8')))
  })
})

describe('detailOf', () => {
  test('an Error gives its message; anything else gives its own spelling', () => {
    expect(detailOf(new Error('EPERM: operation not permitted'))).toBe('EPERM: operation not permitted')
    expect(detailOf('a string nobody wrapped')).toBe('a string nobody wrapped')
    expect(detailOf(undefined)).toBe('undefined')
  })
})

describe('isMissing', () => {
  test('only ENOENT is absent — every other failure stays a failure', () => {
    expect(isMissing(Object.assign(new Error('nope'), { code: 'ENOENT' }))).toBe(true)
    // The bug this rule exists for: EACCES read as "nothing installed" makes the
    // skill digest compare two ways of saying "I could not look".
    expect(isMissing(Object.assign(new Error('nope'), { code: 'EACCES' }))).toBe(false)
    expect(isMissing(Object.assign(new Error('nope'), { code: 'EISDIR' }))).toBe(false)
  })

  test('a thrown non-object, and an object with no code, are not absent', () => {
    expect(isMissing(new Error('plain'))).toBe(false)
    expect(isMissing('ENOENT')).toBe(false)
    expect(isMissing(undefined)).toBe(false)
    expect(isMissing(null)).toBe(false)
  })
})

describe('tempPathFor', () => {
  test('is hidden, beside the target, and never the same twice', () => {
    const target = '/tmp/scope/SKILL.md'
    const first = tempPathFor(target)
    const second = tempPathFor(target)

    expect(dirname(first)).toBe(dirname(target))
    // Hidden, so a crash mid-write leaves nothing in the listing Claude Code
    // enumerates; unique, so two writers cannot rename over each other.
    expect(basename(first).startsWith('.SKILL.md.')).toBe(true)
    expect(basename(first).endsWith('.tmp')).toBe(true)
    expect(second).not.toBe(first)
  })
})

describe('tryJson', () => {
  test('parses, and answers undefined for anything that is not JSON', () => {
    expect(tryJson('{"version":1}')).toEqual({ version: 1 })
    expect(tryJson('')).toBeUndefined()
    expect(tryJson('{"version":')).toBeUndefined()
    // `null` parses. It is not an object, and the store schemas reject it —
    // which is a different answer from "this file is not JSON at all".
    expect(tryJson('null')).toBeNull()
  })
})

describe('createChain', () => {
  test('runs one at a time, in the order asked', async () => {
    const chain = createChain()
    const order: string[] = []
    const step = (name: string, ms: number): Promise<void> =>
      chain(async () => {
        order.push(`${name}:start`)
        await new Promise((resolve) => setTimeout(resolve, ms))
        order.push(`${name}:end`)
      })

    // The slow one is queued first: unserialised, `b:start` lands second.
    await Promise.all([step('a', 20), step('b', 0)])

    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })

  /**
   * The reason the chain is `queue.then(work, work)` and not `queue.then(work)`.
   * A refused save is an ordinary answer in this app — the sha guard makes one
   * every time two windows race — so a rejection must reach its own caller and
   * nobody else's, and must not leave the chain permanently rejected.
   */
  test('a rejection reaches its own caller and does not stall the queue', async () => {
    const chain = createChain()

    const failed = chain(() => Promise.reject(new Error('refused')))
    const after = chain(() => Promise.resolve('ran anyway'))

    await expect(failed).rejects.toThrow('refused')
    await expect(after).resolves.toBe('ran anyway')
  })

  test('two chains are independent — one blocked does not hold the other', async () => {
    const slow = createChain()
    const fast = createChain()
    let released = (): void => undefined
    const blocked = slow(() => new Promise<void>((resolve) => (released = resolve)))

    await expect(fast(() => Promise.resolve('through'))).resolves.toBe('through')

    released()
    await blocked
  })
})

describe('createJsonStore', () => {
  const codec = {
    decode: (text: string): number => (typeof tryJson(text) === 'number' ? (tryJson(text) as number) : 0),
    isDecodable: (text: string): boolean => typeof tryJson(text) === 'number',
    encode: (value: number): string => JSON.stringify(value),
  }
  let path = ''
  beforeEach(async () => {
    path = join(await mkdtemp(join(tmpdir(), 'wikiviewer-json-')), 'state.json')
  })

  test('a file that is not there is the codec defaults, and the first write creates it', async () => {
    const store = await createJsonStore(path, codec)
    expect(store.get()).toBe(0)

    await store.set(7)

    expect(store.get()).toBe(7)
    expect(await readFile(path, 'utf8')).toBe('7')
  })

  /**
   * The distinction the whole `isDecodable` half exists for: a file that
   * *decodes to the defaults* and a file that was *never understood* are the
   * same value and must not be the same act. Only the second keeps a copy.
   */
  test('an unreadable file is moved aside once, not on every write', async () => {
    await writeFile(path, 'from a newer app', 'utf8')
    const store = await createJsonStore(path, codec)

    await store.set(1)
    await store.set(2)

    expect(await readFile(`${path}.unreadable`, 'utf8')).toBe('from a newer app')
    expect(await readFile(path, 'utf8')).toBe('2')
  })

  test('a file that decodes to the defaults is overwritten without a copy kept', async () => {
    await writeFile(path, '0', 'utf8')
    const store = await createJsonStore(path, codec)

    await store.set(5)

    await expect(readFile(`${path}.unreadable`, 'utf8')).rejects.toThrow()
  })

  /** No temp file survives, and none of them was visible while it did exist. */
  test('writes are staged and renamed, leaving nothing beside the target', async () => {
    const store = await createJsonStore(path, codec)

    await Promise.all([store.set(1), store.set(2), store.set(3)])

    expect(await readdir(dirname(path))).toEqual(['state.json'])
    expect(await readFile(path, 'utf8')).toBe('3')
  })

  test('the value is readable back the moment set resolves, and by a second store', async () => {
    const first = await createJsonStore(path, codec)
    await first.set(42)

    expect((await createJsonStore(path, codec)).get()).toBe(42)
  })
})
