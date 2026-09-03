/**
 * Source mode: markdown as its own bytes, with the two things this schema adds
 * on top of markdown marked — `[[links]]` and the frontmatter block.
 *
 * **Source, not WYSIWYG.** The reader edits the file the agent reads; anything
 * that renders while typing is a second opinion about what the bytes are.
 *
 * `minimalSetup` rather than `basicSetup`: undo, a selection and highlighting,
 * and none of the fold gutters and search panels that would make a quiet Mac
 * window look like an IDE.
 *
 * Line numbers are the one exception, and only here: the editor mounts in edit
 * mode alone, where a line is the unit the reader and the agent talk about — a
 * cap is "105ℓ", a review finding is `file:line`. The gutter is quiet rather
 * than absent: no background, no active-line highlight, a hairline and muted
 * digits.
 */

import { RangeSetBuilder, StateEffect } from '@codemirror/state'
import type { StateEffectType } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, lineNumbers } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { minimalSetup } from 'codemirror'
import type { LinkResolution } from '@core/links.js'
import { WIKILINK, splitTarget } from '@core/links.js'

/**
 * "The link index moved." A dangling `[[link]]` resolves the moment the agent
 * creates the file, and an idle editor has no other reason to recompute — so
 * the view is told, rather than left showing a red mark over a file that now
 * exists.
 */
export const refreshLinks: StateEffectType<null> = StateEffect.define()

/**
 * The document, with the line endings the file actually has.
 *
 * `doc.toString()` always joins with `\n` however the document was split, so
 * reading it is a silent CRLF-to-LF conversion — a formatter, in the one place
 * the app promises never to be one. `state.lineBreak` is what `lineSeparator`
 * was given when the document was created.
 */
export const docText = (state: EditorState): string =>
  state.doc.sliceString(0, state.doc.length, state.lineBreak)

/** The leading `---` … `---` block, or nothing. Line-exact, like the parser's. */
export const frontmatterEnd = (text: string): number => {
  if (!text.startsWith('---\n')) return 0
  const close = /^---\s*$/m.exec(text.slice(4))
  return close?.index === undefined ? 0 : 4 + close.index + close[0].length
}

/**
 * Every decoration the editor draws, as a flat set. Built over the *visible*
 * ranges rather than the whole document, so a long journal costs a screenful of
 * work per scroll rather than a file's worth per keystroke.
 */
const decorate = (view: EditorView, resolve: (target: string) => LinkResolution): DecorationSet => {
  const ranges: { readonly from: number; readonly to: number; readonly value: Decoration }[] = []
  const doc = view.state.doc

  const end = frontmatterEnd(doc.sliceString(0, Math.min(doc.length, 4096)))
  for (let at = 0; at < end; at = doc.lineAt(at).to + 1) {
    ranges.push({ from: doc.lineAt(at).from, to: doc.lineAt(at).from, value: FRONTMATTER_LINE })
  }

  for (const { from, to } of view.visibleRanges) {
    const text = doc.sliceString(from, to)
    for (const match of text.matchAll(WIKILINK)) {
      const { target } = splitTarget(match[0].slice(2, -2))
      const dangling = resolve(target).status !== 'resolved'
      ranges.push({
        from: from + match.index,
        to: from + match.index + match[0].length,
        value: dangling ? DANGLING : RESOLVED,
      })
    }
  }

  const builder = new RangeSetBuilder<Decoration>()
  // Sorted, because line decorations and marks are collected in two passes and
  // a `RangeSet` is an ordered structure — an unsorted add throws.
  for (const range of [...ranges].sort((a, b) => a.from - b.from || a.to - b.to)) {
    builder.add(range.from, range.to, range.value)
  }
  return builder.finish()
}

const FRONTMATTER_LINE = Decoration.line({ class: 'cm-frontmatter' })
/** Resolved and dangling are told apart by more than colour: the class adds a rule. */
const RESOLVED = Decoration.mark({ class: 'cm-wikilink' })
const DANGLING = Decoration.mark({ class: 'cm-wikilink-dangling' })

const wikilinks = (resolve: (target: string) => LinkResolution): Extension =>
  ViewPlugin.define(
    (view) => ({
      decorations: decorate(view, resolve),
      update(update: ViewUpdate): void {
        const told = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(refreshLinks)))
        if (update.docChanged || update.viewportChanged || told) {
          this.decorations = decorate(update.view, resolve)
        }
      },
    }),
    { decorations: (plugin) => plugin.decorations },
  )

/**
 * The editor's own theme, which carries no colours of its own: every
 * value is a token from `theme.css`, so the accent family stays the project's
 * and the status family stays fixed.
 */
const look = EditorView.theme({
  '&': { backgroundColor: 'transparent', height: '100%' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    borderRight: '1px solid var(--color-hairline)',
    color: 'var(--color-status-muted)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 0.5rem 0 1rem', minWidth: '2.5ch' },
  '.cm-gutters .cm-gutterElement.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', padding: '1rem 1.5rem' },
  '&.cm-focused': { outline: 'none' },
  '.cm-frontmatter': { backgroundColor: 'var(--color-accent-wash)' },
  '.cm-wikilink': { color: 'var(--color-accent)' },
  '.cm-wikilink-dangling': { color: 'var(--color-status-over)', textDecoration: 'underline wavy' },
})

export const sourceExtensions = (options: {
  readonly path: string
  readonly resolve: (target: string) => LinkResolution
  readonly onChange: (text: string) => void
}): readonly Extension[] => [
  minimalSetup,
  lineNumbers(),
  markdown(),
  EditorView.lineWrapping,
  wikilinks(options.resolve),
  look,
  // The editable region is the document as far as a screen reader is concerned,
  // so it says which file it is.
  EditorView.contentAttributes.of({ 'aria-label': `Source of ${options.path}` }),
  EditorView.updateListener.of((update: ViewUpdate) => {
    if (update.docChanged) options.onChange(docText(update.state))
  }),
]
