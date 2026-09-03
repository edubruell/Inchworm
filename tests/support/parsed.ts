/**
 * `parseNote` returns a union: a file over the parse budget comes back
 * `unparsed`. Every fixture in these suites is well
 * within budget, so an `unparsed` result is a *test failure* rather than a
 * branch each assertion has to narrow past — this helper says that once, and
 * fails loudly with the reason instead of silently skipping the assertion.
 */

import type { NoteState, ParsedNote } from '@core/note.js'

export const expectParsed = (state: NoteState): ParsedNote => {
  if (state.kind === 'unparsed') {
    throw new Error(`expected a parsed note, got unparsed: ${JSON.stringify(state.refusal)}`)
  }
  return state
}
