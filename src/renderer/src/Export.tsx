/**
 * The wiki, out of the repo: a button at the right of the title bar and, behind
 * it, the two bundles.
 *
 * Two scopes and no file tree, because the choice is *who the zip is for* —
 * the reader's other machine, or someone else — and a checkbox per file would
 * ask the reader to answer that question forty times. Which files each scope
 * means is `core.exportPlan`'s; this component sends a word.
 *
 * It sits beside the accent diamond as a popover for the same reason that one
 * is: an export is one click and a native save dialog, and a sheet over the
 * whole window would be a ceremony around a copy.
 */

import { Show, createSignal, onCleanup, type JSX } from 'solid-js'
import type { ExportScope, WikiApi } from '@shared/api.js'
import { Icon } from './Icon.js'
import { exportMessage } from './messages.js'

const CHOICES: readonly { readonly scope: ExportScope; readonly label: string; readonly detail: string }[] = [
  {
    scope: 'everything',
    label: 'Whole wiki',
    detail: 'Every file under the wiki root and the journal, the archive included. For another machine of your own.',
  },
  {
    scope: 'curated',
    label: 'Key notes',
    detail: 'The state file, the numbered notes and the registers. No journal, no archive.',
  },
]

/** `saved` keeps the popover open on purpose: a path nobody read is a path nobody has. */
type Outcome = { readonly tone: 'saved' | 'failed'; readonly text: string }

export const Export = (props: { readonly api: WikiApi }): JSX.Element => {
  const [open, setOpen] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [outcome, setOutcome] = createSignal<Outcome>()
  let root: HTMLDivElement | undefined

  /*
   * The same dismissal the accent popover uses: a menu that outlives its
   * trigger is one the reader cannot close. `pointerdown` fires before a click
   * elsewhere can act on the same gesture.
   *
   * **Except while an export is in flight.** The save panel is a sheet on this
   * window, but the window keeps taking clicks; one click on the note behind
   * would dispose the popover, and the line naming the file that was just
   * written would land nowhere. A path nobody read is a path nobody has.
   */
  const onPointerDown = (event: PointerEvent): void => {
    if (busy()) return
    if (event.target instanceof Node && root?.contains(event.target) === true) return
    setOpen(false)
  }
  document.addEventListener('pointerdown', onPointerDown)
  onCleanup(() => {
    document.removeEventListener('pointerdown', onPointerDown)
  })

  const run = (scope: ExportScope): void => {
    setOutcome(undefined)
    setBusy(true)
    props.api
      .exportWiki(scope)
      .then((result) => {
        if (!result.ok) {
          setOutcome({ tone: 'failed', text: exportMessage(result.error) })
          return
        }
        // A cancelled dialog says nothing at all. The reader closed it; being
        // told so is the app narrating their own gesture back at them.
        if (result.value.kind === 'cancelled') {
          setOpen(false)
          return
        }
        const { files, path, bytes } = result.value
        setOutcome({
          tone: 'saved',
          text: `${String(files)} files, ${String(Math.round(bytes / 1000))} kB → ${path}`,
        })
      })
      .catch((error: unknown) => {
        // The invoke itself never came back — a handler that threw, or a window
        // whose bridge has gone. Silence here would leave a spinner forever.
        console.error('[Inchworm] exportWiki', error)
        setOutcome({ tone: 'failed', text: 'The export did not come back. Try again.' })
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <div
      ref={(element) => (root = element)}
      class="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy()) setOpen(false)
      }}
    >
      <button
        class="no-drag flex items-center gap-1.5 rounded px-2 py-0.5 text-label hover:bg-accent-wash"
        aria-haspopup="true"
        aria-expanded={open()}
        aria-label="Export this wiki"
        onClick={() => {
          setOutcome(undefined)
          setOpen((current) => !current)
        }}
      >
        <Icon name="export" />
        <span>Export</span>
      </button>

      <Show when={open()}>
        <div
          class="no-drag absolute top-full right-0 z-10 mt-1 w-80 rounded border border-hairline bg-surface p-2 shadow"
          role="group"
          aria-label="Export scope"
        >
          {CHOICES.map((choice) => (
            <button
              class="block w-full rounded px-2 py-1.5 text-left hover:bg-accent-wash disabled:opacity-50"
              disabled={busy()}
              onClick={() => {
                run(choice.scope)
              }}
            >
              <span class="font-medium">{choice.label}</span>
              <span class="mt-0.5 block text-label text-status-muted">{choice.detail}</span>
            </button>
          ))}

          <Show when={busy()}>
            <p class="px-2 pt-2 text-label text-status-muted">Packing…</p>
          </Show>
          <Show when={outcome()}>
            {(done) => (
              <p
                class="px-2 pt-2 text-label break-all"
                classList={{ 'text-status-muted': done().tone === 'saved', 'text-status-over': done().tone === 'failed' }}
                role={done().tone === 'failed' ? 'alert' : undefined}
              >
                {done().text}
              </p>
            )}
          </Show>
        </div>
      </Show>
    </div>
  )
}
