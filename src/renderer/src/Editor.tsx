/**
 * The CodeMirror instance, and the three things the app asks of it that a
 * default editor does not do: keep the file's own line ending, take a document
 * pushed in from outside without losing the caret, and let `core` decide what a
 * `[[link]]` is.
 */

import { on, onCleanup, onMount, createEffect, type JSX } from 'solid-js'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { LinkIndex, LinkResolution } from '@core/links.js'
import { tagInsertion } from '@core/templates.js'
import { docText, refreshLinks, sourceExtensions } from './sourceMode.js'

/**
 * The line ending the file already uses. CodeMirror normalises every ending to
 * `\n` unless it is told otherwise, so an editor that does not set this rewrites
 * every line of a CRLF file the moment one character is typed — a formatter,
 * in the one place the app promises never to be one: a save is byte-faithful.
 *
 * A file with *mixed* endings cannot be preserved by any single-separator
 * editor; it takes the ending it opens with, and that is a documented limit
 * rather than a silent one.
 */
const separatorOf = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n')

/**
 * The source pane. One `EditorView` per file — the parent keys this component
 * on the path, so switching notes builds a new editor rather than pouring one
 * document into another's undo history.
 *
 * The document is pushed in from outside only when it *disagrees* with what is
 * on screen, which happens exactly twice: a reload that takes the bytes on
 * disk, and an appended register entry. Every other change came from the
 * keyboard and is already here.
 */
export const Editor = (props: {
  readonly path: string
  readonly text: string
  readonly resolve: (target: string) => LinkResolution
  readonly onChange: (text: string) => void
  /** Where to put the caret; re-applied whenever it changes, not only on a replace. */
  readonly caret?: number | undefined
  /**
   * The project's link index. A `[[link]]` that was dangling when the editor
   * opened resolves the moment the agent creates the file, and the marks have
   * to be told — nothing else in an idle editor makes them recompute.
   */
  readonly links: LinkIndex
  /**
   * A note to the agent, asked for from outside (⌘E). The **nonce** is what is
   * watched: the request is "do it again", and two identical requests are two
   * insertions — a boolean would only ever fire once.
   */
  readonly tag?: { readonly name: string; readonly nonce: number } | undefined
}): JSX.Element => {
  let host: HTMLDivElement | undefined
  let view: EditorView | undefined

  onMount(() => {
    if (host === undefined) return
    view = new EditorView({
      state: EditorState.create({
        doc: props.text,
        extensions: [
          EditorState.lineSeparator.of(separatorOf(props.text)),
          ...sourceExtensions({ path: props.path, resolve: props.resolve, onChange: props.onChange }),
        ],
      }),
      parent: host,
    })
    view.focus()
  })

  createEffect(() => {
    const text = props.text
    const editor = view
    if (editor === undefined || docText(editor.state) === text) return
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } })
  })

  // Its own effect, because the caret moves for a reason of its own: an
  // appended register entry sets it on a document the editor is already
  // showing, and a caret folded into the text effect would never run.
  createEffect(() => {
    const caret = props.caret
    const editor = view
    if (editor === undefined || caret === undefined) return
    editor.dispatch({
      selection: EditorSelection.cursor(Math.min(caret, editor.state.doc.length)),
      scrollIntoView: true,
    })
    editor.focus()
  })

  /**
   * `<eddy>…</eddy>` around the selection, caret inside. The *string* is
   * `core`'s and the *selection* is CodeMirror's, which is why this lives here
   * and not in the parent: nothing outside this component knows where the
   * caret is.
   */
  createEffect(
    // Explicitly `on` the nonce, and nothing else. The insertion *changes the
    // document*, which flows back out as a new draft and in again as a new
    // props object — an effect that tracked the whole request would re-run on
    // its own output, forever.
    on(
      () => props.tag?.nonce ?? 0,
      (nonce) => {
        const editor = view
        const name = props.tag?.name
        if (editor === undefined || name === undefined || nonce === 0) return
        const range = editor.state.selection.main
        const { insert, caret } = tagInsertion(name, editor.state.sliceDoc(range.from, range.to))
        editor.dispatch({
          changes: { from: range.from, to: range.to, insert },
          selection: EditorSelection.cursor(range.from + caret),
          scrollIntoView: true,
        })
        editor.focus()
      },
      // `defer`, because this editor is **re-created per file** (`Note` keys the
      // source pane by path) while the nonce lives in the window. Without it a
      // remount would run the effect on mount with a nonce already past zero,
      // and one ⌘E would put a note into the top of every file opened after.
      { defer: true },
    ),
  )

  createEffect(() => {
    const editor = view
    // Reading the index is the point: this effect exists to re-run on it.
    void props.links
    if (editor !== undefined) editor.dispatch({ effects: refreshLinks.of(null) })
  })

  onCleanup(() => {
    view?.destroy()
  })

  return <div class="min-h-0 flex-1 overflow-y-auto" ref={(element) => (host = element)} />
}
