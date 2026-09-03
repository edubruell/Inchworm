/**
 * The right rail: this note's outline over the notes pointing *at* it.
 *
 * Both come from `core` — `outline` nests the headings `parseNote` found, and
 * the backlink index is the reversed link graph of the whole project. The rail
 * is the reason the store parses every file and not just the open one.
 */

import { For, Show, createMemo, type JSX } from 'solid-js'
import { basename } from '@core/paths.js'
import type { NoteState } from '@core/note.js'
import type { OutlineNode } from '@core/outline.js'
import { outline } from '@core/outline.js'
import type { NoteStore } from './noteStore.js'

/**
 * A heading scrolls into view by its **position among the headings**, not by an
 * id: `renderHtml` mints no ids (they would be the one thing in the document a
 * note could collide with), and the rendered heading order is the parsed
 * heading order.
 */
const scrollToHeading = (ordinal: number): void => {
  const headings = document.querySelectorAll('.prose :is(h1,h2,h3,h4,h5,h6)')
  headings[ordinal]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const Branch = (props: {
  readonly nodes: readonly OutlineNode[]
  readonly ordinalOf: (node: OutlineNode) => number
}): JSX.Element => (
  <ul>
    <For each={props.nodes}>
      {(node) => (
        <li>
          <button
            class="no-drag block w-full truncate rounded px-2 py-0.5 text-left hover:bg-accent-wash"
            onClick={() => {
              scrollToHeading(props.ordinalOf(node))
            }}
          >
            {node.heading.text}
          </button>
          <Show when={node.children.length > 0}>
            <div class="ml-2 border-l border-hairline pl-1">
              <Branch nodes={node.children} ordinalOf={props.ordinalOf} />
            </div>
          </Show>
        </li>
      )}
    </For>
  </ul>
)

export const Rail = (props: {
  readonly store: NoteStore
  readonly path: string
  readonly state: NoteState | undefined
  readonly onOpen: (path: string) => void
}): JSX.Element => {
  const headings = createMemo(() => (props.state?.kind === 'parsed' ? props.state.headings : []))
  const tree = createMemo(() => outline(headings()))
  const ordinalOf = (node: OutlineNode): number => headings().indexOf(node.heading)
  const backlinks = createMemo(() => props.store.backlinksTo(props.path))

  return (
    <aside class="w-56 shrink-0 overflow-y-auto border-l border-hairline px-2 py-3 text-caption" aria-label="Outline and backlinks">
      <h2 class="mb-1 px-2 text-label tracking-wider text-status-muted uppercase">Outline</h2>
      <Show when={tree().length > 0} fallback={<p class="px-2 text-status-muted">No headings.</p>}>
        <Branch nodes={tree()} ordinalOf={ordinalOf} />
      </Show>

      <h2 class="mt-5 mb-1 px-2 text-label tracking-wider text-status-muted uppercase">Backlinks</h2>
      <Show when={backlinks().length > 0} fallback={<p class="px-2 text-status-muted">Nothing links here.</p>}>
        <ul>
          <For each={backlinks()}>
            {(backlink) => (
              <li>
                <button
                  class="no-drag block w-full truncate rounded px-2 py-0.5 text-left text-accent hover:bg-accent-wash"
                  title={`${backlink.from}:${String(backlink.line)}`}
                  onClick={() => {
                    props.onOpen(backlink.from)
                  }}
                >
                  {basename(backlink.from)}
                  <span class="text-status-muted"> :{backlink.line}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </aside>
  )
}
