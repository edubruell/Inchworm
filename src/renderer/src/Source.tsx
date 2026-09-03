/**
 * Edit mode: the bytes, a line saying what state they are in, and — when the
 * file moved underneath — the two ways out, spelled out.
 *
 * Neither way out is taken for the reader. "Reload" throws away what was typed
 * and "Overwrite" throws away what the agent wrote, so both are buttons and
 * neither is a default.
 */

import { Show, createMemo, type JSX } from 'solid-js'
import type { LinkIndex, LinkResolution } from '@core/links.js'
import type { Drafts } from './drafts.js'
import { canSave, editLabel, editRole } from './edit.js'
import { Editor } from './Editor.js'
import { Icon } from './Icon.js'

export const Source = (props: {
  readonly path: string
  readonly drafts: Drafts
  readonly resolve: (target: string) => LinkResolution
  readonly links: LinkIndex
  readonly caret: number | undefined
  /** A ⌘E note-tag request, by nonce; forwarded to the editor untouched. */
  readonly tag: { readonly name: string; readonly nonce: number } | undefined
}): JSX.Element => {
  const state = createMemo(() => props.drafts.state(props.path))
  const draft = createMemo(() => props.drafts.get(props.path))

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      {/* `!== undefined`, not truthiness: main answers `currentSha: ''` for a
          file that is no longer there, and a falsy check hides the banner over
          exactly the case where unsaved work is at risk. */}
      <Show when={props.drafts.conflict(props.path) !== undefined}>
        <div role="alert" class="border-b border-status-over px-6 py-3 text-status-over">
          <p>
            <strong>{props.path}</strong>{' '}
            {props.drafts.conflict(props.path) === ''
              ? 'is no longer on disk. Nothing has been saved.'
              : 'was written by something else while you were editing it. Nothing has been saved and nothing has been merged.'}
          </p>
          <div class="mt-2 flex gap-2">
            <button
              class="btn no-drag"
              onClick={() => {
                props.drafts.reload(props.path)
              }}
            >
              <Icon name="revert" />
              Discard my changes and reload
            </button>
            <button
              class="btn btn-danger no-drag"
              onClick={() => {
                props.drafts.overwrite(props.path)
              }}
            >
              {props.drafts.conflict(props.path) === '' ? 'Write it back' : 'Overwrite the other change'}
            </button>
          </div>
        </div>
      </Show>

      <Show when={props.drafts.failure(props.path)}>
        {(message) => (
          <p role="alert" class="border-b border-hairline px-6 py-2 text-status-over">
            Failed: {message()}
          </p>
        )}
      </Show>

      <Show when={draft()}>
        {(present) => (
          <Editor
            path={props.path}
            text={present().text}
            resolve={props.resolve}
            caret={props.caret}
            links={props.links}
            tag={props.tag}
            onChange={(text) => {
              props.drafts.change(props.path, text)
            }}
          />
        )}
      </Show>

      <div class="flex shrink-0 items-center gap-3 border-t border-hairline px-6 py-1 text-label">
        <Show when={state()}>
          {(present) => (
            <span
              role={editRole(present())}
              classList={{
                'text-status-proposal': editRole(present()) !== undefined,
                'text-status-muted': editRole(present()) === undefined,
              }}
            >
              {editLabel(present())}
            </span>
          )}
        </Show>
        <button
          class="btn btn-accent no-drag"
          disabled={props.drafts.saving(props.path) || !canSave(state() ?? 'clean')}
          onClick={() => {
            props.drafts.save(props.path)
          }}
        >
          <Icon name="save" />
          {props.drafts.saving(props.path) ? 'Saving…' : 'Save'}
        </button>
        {/* Available whenever the file moved, not only after a refused save:
            a reader who has seen the amber line must be able to act on it. The
            label changes with what it costs — taking the other change back
            over a draft throws the draft away. */}
        <Show when={state() === 'stale' || state() === 'diverged'}>
          <button
            class="btn no-drag"
            onClick={() => {
              props.drafts.reload(props.path)
            }}
          >
            <Icon name="revert" />
            {state() === 'diverged' ? 'Discard my changes and reload' : 'Reload from disk'}
          </button>
        </Show>
      </div>
    </div>
  )
}
