/**
 * What a register *contains*, as opposed to how long it is: which file the open
 * contentions live in, and how many of them there are.
 *
 * This is schema knowledge, so it lives here and not in a component. An entry
 * is a `## ` heading, which is the shape every register format uses.
 */

import type { ProjectLayout } from './project.js'
import { classify } from './classify.js'

/**
 * A fenced block is illustration, not content — a register that shows its own
 * entry template inline would otherwise count the example. The same rule
 * `extractLinks` already follows for `[[links]]` in code.
 */
const FENCE = /^(?:```|~~~).*$[\s\S]*?^(?:```|~~~)\s*$/gm

/** `## ` at the start of a line, and nothing weaker: `###` is inside an entry. */
const ENTRY = /^## (?!#).*$/gm

/**
 * Every entry heading in a register, in file order. Exported because a new
 * entry's number is a function of the ones already there (`templates.ts`).
 */
export const headings = (text: string): readonly string[] =>
  [...text.replace(FENCE, '').matchAll(ENTRY)].map((match) => match[0].slice(3))

/**
 * An open contention. A settled one leaves the register — body to `archive/`,
 * one table row behind — so on a kept wiki there is no heading to exclude and
 * this is the count. The marker is for the wikis not there yet, still holding
 * `(RESOLVED …)` in a heading.
 *
 * Deliberately not the same set the skill's own checker matches: that one takes
 * a bare `RESOLVED` and is case sensitive, so `(Resolved …)` closes an entry
 * here and not there. The bracket is deliberate — it separates
 * a closed entry from one whose *question* is about resolving something, and a
 * list you read can afford that false positive where a badge cannot.
 */
const CONTENTION = /^C\d+\b/
const RESOLVED = /\(resolved/i

export const openContentions = (text: string): number =>
  headings(text).filter((heading) => CONTENTION.test(heading) && !RESOLVED.test(heading)).length

/** Where those contentions are. One home for "which file is the register". */
export const contentionsFile = (paths: readonly string[], layout: ProjectLayout): string | undefined =>
  paths.find((path) => {
    const kind = classify(path, layout)
    return kind.kind === 'register' && kind.register === 'contentions'
  })
