/**
 * "When was this last open", as a phrase.
 *
 * Pure, and given its `now` rather than reading a clock: `core` does no I/O,
 * and a label that reads the wall clock is a test that passes until midnight.
 *
 * The grain coarsens with distance, which is how the question is actually
 * asked: minutes matter this hour, days matter this week, and a project last
 * opened in the spring is "5 mo ago" — a date there would be read as data.
 * Nothing here is a *timestamp*: the exact one is in the tooltip, on the path.
 */
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
/** The average Gregorian month, which is the honest unit for "a while ago". */
const MONTH = 30.44 * DAY
const YEAR = 365.25 * DAY

export const sinceLabel = (thenMs: number, nowMs: number): string => {
  // A clock that moved backwards (a sync, a timezone change) is not the
  // future: it is "now", which is the least wrong thing to say.
  const elapsed = Math.max(0, nowMs - thenMs)
  const count = (unit: number): string => String(Math.floor(elapsed / unit))
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return `${count(MINUTE)} min ago`
  if (elapsed < DAY) return `${count(HOUR)} h ago`
  if (elapsed < WEEK) return `${count(DAY)} d ago`
  if (elapsed < MONTH) return `${count(WEEK)} w ago`
  if (elapsed < YEAR) return `${count(MONTH)} mo ago`
  return `${count(YEAR)} y ago`
}
