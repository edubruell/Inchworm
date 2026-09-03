/**
 * A `ReadonlyMap` in, a new `ReadonlyMap` out. Solid's signals compare by
 * identity, so a store that mutates its map in place updates nothing: every
 * keyed signal in the renderer is held this way, and every one of them needs
 * these two lines, so they are written once.
 *
 * Here rather than in `core`: generic map arithmetic is not llmwiki schema
 * knowledge, which is what `core` is reserved for.
 */

export const withKey = <T>(map: ReadonlyMap<string, T>, key: string, value: T): ReadonlyMap<string, T> =>
  new Map(map).set(key, value)

export const withoutKey = <T>(map: ReadonlyMap<string, T>, key: string): ReadonlyMap<string, T> => {
  const next = new Map(map)
  next.delete(key)
  return next
}
