/**
 * The parse budget. `parseNote` runs on the watcher path, so a single file must
 * never be able to freeze the app — and measurement showed that **bytes alone
 * cannot express that limit**.
 *
 * Parse cost follows a file's *shape*, not its size: at 64 KB, ordinary prose
 * parses in under 20 ms, a tab-nested list in 938 ms and a nested blockquote in
 * 4 336 ms. Holding the worst shape under ~100 ms would need a ≈16 KB cap,
 * while real wiki files are already 12 KB and grow by appending — no single
 * byte number admits real files and excludes the pathology. So the guard reads
 * the shape first, in one cheap scan.
 *
 * What it measures is container nesting — the leading run of ` `, `\t` and `>`
 * on each line, which is exactly the prefix micromark re-walks per line — in
 * two forms, because neither alone predicts the cost:
 * - `deepest`, which catches one absurdly deep line (`'>'.repeat(20000)`:
 *   292 ms at a `total` that is otherwise unremarkable), and
 * - `total`, which catches many moderately nested lines (500 lines at depth
 *   150: 171 ms at a `deepest` of only 151).
 */

/** A file the budget refuses to hand to the parser, and the number that refused it. */
export type ParseRefusal =
  | { readonly kind: 'too-large'; readonly bytes: number; readonly limit: number }
  /**
   * The parse overflowed the stack inside a dependency, at a shape this budget
   * admits. The budget measures *container* nesting from line prefixes; inline
   * nesting it cannot see, and `remark-gfm`'s visitor recurses over both.
   * Kept as a refusal rather than a crashed window:
   * `parseNote` is total, and the file is still shown as raw text.
   */
  | { readonly kind: 'stack' }
  | {
      readonly kind: 'too-nested'
      /** Which of the two nesting measures broke — the message has to name it. */
      readonly measure: 'deepest' | 'total'
      readonly depth: number
      readonly limit: number
    }

export type ParseBudget = {
  /** UTF-16 code units, not bytes on disk: this is what the parser is handed. */
  readonly bytes: number
  readonly deepest: number
  readonly total: number
}

/**
 * Measured, not guessed. Against a real wiki (25 files, 144 KB) the
 * deepest nesting is 32 and the largest total is 364, so every limit here has
 * over 100× headroom on real material, and the largest real file is 12 KB
 * against the 128 KB byte term.
 *
 * The other side of each number is the worst case they still admit, which is
 * the promise the budget actually makes: ~60 ms (128 KB of prose 55 ms, a
 * 4 000-deep blockquote 39 ms, 20 000 of total nesting 59 ms).
 */
export const PARSE_BUDGET: ParseBudget = {
  bytes: 131_072,
  deepest: 4_000,
  total: 20_000,
}

/** A tab opens as much container as four spaces, and costs about four times as much. */
const TAB_WIDTH = 4

const SPACE = 32
const TAB = 9
const NEWLINE = 10
const GREATER_THAN = 62

/** How much container one character opens at the start of a line; 0 ends the prefix. */
const prefixWidth = (code: number): number => {
  if (code === SPACE || code === GREATER_THAN) return 1
  if (code === TAB) return TAB_WIDTH
  return 0
}

/**
 * One pass, no allocation, no regex — 0.43 ms over the whole 144 KB corpus,
 * which is what makes a pre-scan affordable on every watcher event at all.
 */
export const nesting = (text: string): { readonly deepest: number; readonly total: number } => {
  let deepest = 0
  let total = 0
  let run = 0
  // Leading runs only: a `>` in the middle of a sentence opens no container.
  let atLineStart = true

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code === NEWLINE) {
      total += run
      if (run > deepest) deepest = run
      run = 0
      atLineStart = true
      continue
    }
    if (!atLineStart) continue
    const width = prefixWidth(code)
    if (width === 0) atLineStart = false
    else run += width
  }

  // The last line has no closing newline of its own.
  total += run
  return { deepest: run > deepest ? run : deepest, total }
}

/**
 * `undefined` when the text is within budget — the shape `capFor` already uses
 * for "no limit applies here", rather than a `Result` whose error is the
 * interesting case in only one of two branches.
 */
export const checkParseBudget = (text: string, budget: ParseBudget = PARSE_BUDGET): ParseRefusal | undefined => {
  if (text.length > budget.bytes) return { kind: 'too-large', bytes: text.length, limit: budget.bytes }

  const { deepest, total } = nesting(text)
  if (deepest > budget.deepest) return { kind: 'too-nested', measure: 'deepest', depth: deepest, limit: budget.deepest }
  if (total > budget.total) return { kind: 'too-nested', measure: 'total', depth: total, limit: budget.total }
  return undefined
}
