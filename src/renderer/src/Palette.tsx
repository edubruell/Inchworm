/**
 * ⌘K: jump to any file the window can open.
 *
 * The list and its order come from `core` — the same `buildNavigation` the
 * sidebar draws, so the palette can never disagree with it about what a project
 * contains, and no component regexes a filename. This file owns only the
 * keyboard and the roles.
 */

import { For, createEffect, createMemo, createSignal, type JSX } from 'solid-js'
import { filterEntries, jumpTargets } from '@core/navigation.js'
import type { ProjectSnapshot } from '@shared/api.js'
import { Sheet } from './Sheet.js'

export const Palette = (props: {
  readonly open: boolean
  readonly project: ProjectSnapshot
  readonly onClose: () => void
  readonly onOpen: (path: string) => void
}): JSX.Element => {
  const [query, setQuery] = createSignal('')
  const [cursor, setCursor] = createSignal(0)
  let input: HTMLInputElement | undefined

  const matches = createMemo(() => filterEntries(jumpTargets(props.project.files, props.project.layout), query()))
  // Clamped, not stored: a watcher event can delete the file under the cursor
  // while the palette is open, and an index past the end names an option that
  // is not there.
  const active = createMemo(() => Math.min(cursor(), Math.max(matches().length - 1, 0)))

  // Every opening starts from nothing typed: a palette that remembers the last
  // query is a palette that opens showing the wrong file selected.
  createEffect(() => {
    if (props.open) {
      setQuery('')
      setCursor(0)
      input?.focus()
    }
  })

  const choose = (path: string | undefined): void => {
    if (path === undefined) return
    props.onOpen(path)
    props.onClose()
  }

  /** Wraps, because a list this short is faster to cycle than to stop at the end. */
  const move = (delta: number): void => {
    const count = matches().length
    if (count > 0) setCursor((active() + delta + count) % count)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
    }
    if (event.key === 'Enter') choose(matches()[active()]?.path)
  }

  const optionId = (index: number): string => `palette-option-${String(index)}`

  return (
    <Sheet open={props.open} label="Jump to file" onClose={props.onClose}>
      <h1 class="text-label tracking-wider text-status-muted uppercase">Jump to file</h1>
      <input
        ref={(element) => (input = element)}
        class="w-full border-b border-accent-line bg-transparent py-2 text-base outline-none"
        placeholder="Type part of a name or a folder"
        value={query()}
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={matches().length > 0 ? optionId(active()) : undefined}
        onInput={(event) => {
          setQuery(event.currentTarget.value)
          setCursor(0)
        }}
        onKeyDown={onKeyDown}
      />
      <ul id="palette-list" role="listbox" aria-label="Files" class="mt-2 min-h-0 flex-1 overflow-y-auto">
        <For each={matches()} fallback={<li class="px-2 py-1 text-status-muted">No file matches.</li>}>
          {(entry, index) => (
            <li
              id={optionId(index())}
              role="option"
              aria-selected={index() === active()}
              class="cursor-default rounded px-2 py-1"
              classList={{ 'bg-accent-wash font-medium': index() === active() }}
              onMouseEnter={() => {
                setCursor(index())
              }}
              onClick={() => {
                choose(entry.path)
              }}
            >
              {entry.name}
              <span class="ml-2 text-label text-status-muted">{entry.path}</span>
            </li>
          )}
        </For>
      </ul>
    </Sheet>
  )
}
