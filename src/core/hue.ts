/**
 * Project identity is one number: the hue every `--accent-*` token is derived
 * from. It is hashed from the project path so a project
 * looks the same on every launch with no setup, and is overridable in one
 * click — the store keeps the override, this is only the default.
 */

/**
 * Six colours and a graphite, spread over the arc the identity family is
 * allowed to have — and it is an arc, not a circle.
 *
 * **The warm quarter belongs to `--status-*`.** An accent that reads as amber
 * or red reads as a warning, so ≈15–85° is out. And the band just past it is
 * out for a second reason found by looking at it: at the ramp's fixed
 * lightness (0.62) everything from ~85° to ~140° is *mustard*, and lifting that
 * slot's lightness until it looks golden lands it back on the status amber. So
 * the ochre swatch is gone rather than nudged — the honest choices there were
 * ugly, ambiguous, or absent.
 *
 * What is left is 135→337 at ≥37° steps: green, teal, azure, indigo, violet,
 * magenta. Three neighbouring greens at 20–25° were what a reader could not
 * tell apart in use; the floor is now 35°, asserted, so
 * the next hue proposed has to earn its place rather than squeeze in.
 *
 * The seventh is **graphite**: a hue like any other on the wire, drained to a
 * near-neutral by `chromaFor`. A project that wants no colour is a real want,
 * and it costs one number rather than a second kind of identity.
 */
export const PALETTE = [135, 189, 226, 263, 300, 337, 250] as const
export type Hue = (typeof PALETTE)[number]

/**
 * The graphite slot. Cool rather than warm — a warm grey beside this app's
 * amber status colour reads as a faded warning.
 */
export const GRAPHITE = 250

/**
 * How much of the ramp's chroma a hue actually gets: all of it, or almost none.
 *
 * A multiplier rather than a second palette, because every `--accent-*` and
 * every terminal token is one OKLCH expression over `--project-hue` — one more
 * factor keeps that true, while a "grey ramp" would fork the theme in twelve
 * places and let the two halves drift.
 */
export const GRAPHITE_CHROMA = 0.09

export const chromaFor = (hue: number): number => (hue === GRAPHITE ? GRAPHITE_CHROMA : 1)

export const isPaletteHue = (hue: number): hue is Hue => (PALETTE as readonly number[]).includes(hue)

/** FNV-1a, 32-bit: tiny, dependency-free and stable across runs and machines. */
const hash = (text: string): number => {
  let value = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 0x01000193)
  }
  return value >>> 0
}

/**
 * The seven positions of `PALETTE`. Stating them as a type is what makes the
 * lookup below total: `% PALETTE.length` is provably one of them, but TypeScript
 * types it as `number`, and `noUncheckedIndexedAccess` then adds an `undefined`
 * the code can never see — paid for either with a banned `!` or with an
 * unreachable fallback branch that no test can ever cover.
 * Kept honest by the "every palette hue is reachable" test.
 */
type PaletteIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6

/**
 * Stable path → palette hue. Trailing slashes do not change the answer, and
 * neither does Unicode normalisation: APFS hands back NFD from `readdir` while a
 * user-typed or resolved path is NFC, so without this one project carries two
 * identities — and two accent colours — in one session.
 */
export const hueForPath = (path: string): Hue => {
  const normalised = path.replace(/\/+$/, '').normalize('NFC')
  return PALETTE[(hash(normalised) % PALETTE.length) as PaletteIndex]
}
