/**
 * Turning dropped file paths into something a shell can read.
 *
 * A terminal that ignores a drop is a terminal the reader has to alt-tab out
 * of to paste a path, which is exactly the round trip this app exists to remove
 * — dropping a screenshot on the agent pane should type its path.
 *
 * Pure and here rather than in the component for the usual reason: quoting is
 * where this goes wrong, and it goes wrong on the paths a screenshot actually
 * has — `Bildschirmfoto 2026-08-21 um 09.01.23.png` is two spaces and a
 * non-ASCII byte. The app never *runs* this text; it types it, and the reader
 * presses return. Quoting it correctly is still the app's job.
 */

/**
 * Characters a POSIX shell leaves alone. Anything outside this set — a space, a
 * quote, a `$`, a `(`, any non-ASCII byte — means the whole word gets quoted.
 * Deliberately conservative: over-quoting is invisible, under-quoting is a
 * mangled command.
 */
const BARE = /^[A-Za-z0-9._\-/@:+,=]+$/

/**
 * One argument, safe to type at a prompt. Single quotes because they are the
 * only shell quoting with no interior escapes at all; the sole thing they
 * cannot hold is a single quote, which is closed, escaped and reopened —
 * `it's` becomes `'it'\''s'`.
 */
export const quoteForShell = (value: string): string =>
  BARE.test(value) && value !== '' ? value : `'${value.replaceAll("'", String.raw`'\''`)}'`

/**
 * What a drop types into the pane: the paths, quoted, separated and with a
 * **trailing space** so the reader can keep typing after them. No newline — the
 * app never presses return on the reader's behalf, because the pane may hold an
 * agent mid-question rather than a prompt.
 *
 * An empty list yields an empty string, so a drop of something that has no path
 * (a text selection, a browser image) types nothing rather than a stray space.
 */
export const dropText = (paths: readonly string[]): string =>
  paths.length === 0 ? '' : `${paths.map(quoteForShell).join(' ')} `
