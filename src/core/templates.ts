/**
 * What a *new* entry in each register looks like, and where it goes.
 *
 * The hard rule is that registers are append-only: new entries at the bottom,
 * from the template, never mid-file and never a reformat. The app's job is
 * therefore to produce the skeleton and put it at the end — the words are the
 * author's, and the file's existing bytes are never touched. The shapes are the
 * `/llmwiki` SKILL.md's, restated here in TypeScript the way `schema.ts`
 * restates the layout.
 */

import type { RegisterName } from './schema.js'

/**
 * The registers whose entries *are* blocks appended at the bottom. `budgets`
 * and `deletions` are tables whose rows belong inside the table, not after the
 * prose that follows it — appending there would produce a broken file, so the
 * affordance is absent for them rather than wrong.
 */
const APPENDABLE = ['ideas', 'decisions', 'contentions', 'findings', 'gotchas', 'tried'] as const

export type AppendableRegister = (typeof APPENDABLE)[number]

export const isAppendable = (register: RegisterName): register is AppendableRegister =>
  (APPENDABLE as readonly string[]).includes(register)

/** `## C7 …` / `## I3 …` — the numbered registers, and the letter each uses. */
const MARKER = { contentions: 'C', ideas: 'I' } as const

const markerOf = (register: AppendableRegister): string | undefined =>
  register === 'contentions' ? MARKER.contentions : register === 'ideas' ? MARKER.ideas : undefined

/**
 * The next free number for a marked register. Counted from the highest marker
 * present, not from how many entries there are: a resolved contention keeps its
 * heading and its number forever, so `C8 (RESOLVED)` still means the next one
 * is C9: a contention is never deleted, only answered.
 */
export const nextMarker = (headings: readonly string[], letter: string): number => {
  const pattern = new RegExp(`^${letter}(\\d+)\\b`)
  const numbers = headings.flatMap((heading) => {
    const found = pattern.exec(heading)
    return found?.[1] === undefined ? [] : [Number(found[1])]
  })
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1
}

/**
 * The skeleton for one new entry, angle-bracket placeholders and all. They are
 * left in deliberately: an entry the author has not filled in should look
 * unfinished, and a template that guesses at content is a template that gets
 * committed unread.
 */
type Fill = { readonly date: string; readonly number: string }

const SKELETON: Record<AppendableRegister, (fill: Fill) => string> = {
  ideas: ({ number }) => `## I${number} — <name> · status: raw · <one-line pitch> · notes: [[NN]]`,

  decisions: ({ date }) =>
    [
      `## [${date}] <design|data|scope|process> | <one-line ruling>`,
      '- **Ruling:** <what was decided>',
      '- **Why:** <the reason that survives the session>',
      '- **Rejected:** <alternatives and why not>',
      '- **Expect:** <what should happen if this is right>; confidence: high|med|low',
      '- **Touches:** [[NN_note]]',
    ].join('\n'),

  contentions: ({ number }) =>
    [
      `## C${number} — <fragile assumption> (what it is existential for)`,
      '<paragraph: why it is fragile>',
      '**Resolves when:** <the test that answers it>',
      '**Fallback:** <what ships if the answer is no>',
    ].join('\n'),

  findings: ({ date }) => `## [${date}] <fact>. Source: <file/log/§>. Affects: [[NN_note]].`,

  gotchas: ({ date }) => `- <trap + how to avoid> (context, ${date})`,

  tried: ({ date }) => `## [${date}] Tried <X> → <outcome>. Failed because <Y>. Don't retry unless <Z>.`,
}

export const entryTemplate = (
  register: RegisterName,
  context: { readonly date: string; readonly headings: readonly string[] },
): string | undefined => {
  if (!isAppendable(register)) return undefined
  const letter = markerOf(register)
  return SKELETON[register]({
    date: context.date,
    number: letter === undefined ? '' : String(nextMarker(context.headings, letter)),
  })
}

/**
 * The entry, at the bottom, and **not one byte of the file rewritten**: the
 * separator is only ever added, never normalised away, because trimming a
 * trailing blank line is still a formatter and no formatter is ever pointed at
 * a register.
 *
 * `from` is where the entry starts in the new text — what the editor puts the
 * caret on, so the author lands in the skeleton rather than at the end of it.
 */
export const appendEntry = (text: string, entry: string): { readonly text: string; readonly from: number } => {
  const gap = text === '' ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
  return { text: `${text}${gap}${entry}\n`, from: text.length + gap.length }
}

/**
 * A note left in the wiki **for the agent**, as a pair of tags around the
 * caret: `<eddy>…</eddy>`, where the name is the reader's own.
 *
 * It is deliberately not markdown. The tag survives a render (the sanitiser
 * drops it, so it never shows in the reading pane), an agent reading the file
 * sees it plainly, and — because the app never reformats — it stays exactly
 * where it was put.
 *
 * Pure, and expressed as an *insertion* rather than as a new document: the
 * editor holds the selection, so it says what is selected and this says what
 * to put there and where the caret lands afterwards.
 */
export const tagInsertion = (
  tag: string,
  selected: string,
): { readonly insert: string; readonly caret: number; readonly to: number } => {
  const open = `<${tag}>`
  const close = `</${tag}>`
  return {
    insert: `${open}${selected}${close}`,
    // Inside the tags, always — with a selection wrapped, the caret goes to the
    // end of what was wrapped so typing continues the note rather than
    // replacing it.
    caret: open.length + selected.length,
    to: open.length + selected.length + close.length,
  }
}

/**
 * A tag name the app will write. XML-shaped rather than free text, because
 * what goes in the file has to be a tag a reader and an agent both recognise:
 * a letter first, then letters, digits, `-` or `_`.
 */
export const isTagName = (name: string): boolean => /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(name)
