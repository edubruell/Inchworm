/**
 * A modal sheet on the native `<dialog>`, and no overlay library.
 *
 * `showModal` is what earns that: focus is trapped, Escape closes, the rest of
 * the document goes inert, and the top layer paints above everything without a
 * z-index. "One `h1` per view" holds *inside* the sheet, because while it is
 * open the sheet **is** the view.
 */

import { createEffect, type JSX } from 'solid-js'

export const Sheet = (props: {
  readonly open: boolean
  readonly label: string
  readonly onClose: () => void
  readonly children: JSX.Element
}): JSX.Element => {
  let dialog: HTMLDialogElement | undefined

  // Driven by the prop rather than by the caller holding a ref: the sheet's
  // openness is state, and `showModal()` on an already-open dialog throws.
  createEffect(() => {
    if (dialog === undefined) return
    if (props.open && !dialog.open) dialog.showModal()
    if (!props.open && dialog.open) dialog.close()
  })

  return (
    <dialog
      ref={(element) => (dialog = element)}
      aria-label={props.label}
      class="sheet"
      // Escape and `close()` both land here, so "the sheet is shut" has one home.
      onClose={() => {
        props.onClose()
      }}
      // A click on the backdrop is a click on the dialog element itself: the
      // content sits in a child, so `currentTarget === target` means outside.
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose()
      }}
    >
      <div class="sheet-body">{props.children}</div>
    </dialog>
  )
}
