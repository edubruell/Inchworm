/**
 * The content pane: a header card built from the frontmatter, then the note.
 *
 * Nothing here reads the schema. `classify` says what the file is, `capFor`
 * what its ceiling is, `renderHtml` what it looks like — this component places
 * them. No component may regex a filename.
 */

import { For, Show, createMemo, type JSX } from 'solid-js'
import { capFor, capStatus } from '@core/caps.js'
import { classify } from '@core/classify.js'
import { splitTarget } from '@core/links.js'
import { renderHtml } from '@core/render.js'
import { isAppendable } from '@core/templates.js'
import type { CapStatus } from '@core/caps.js'
import type { Frontmatter } from '@core/frontmatter.js'
import type { LinkResolution } from '@core/links.js'
import type { ProjectSnapshot } from '@shared/api.js'
import type { Drafts } from './drafts.js'
import { Gauge } from './Gauge.js'
import { Icon } from './Icon.js'
import { statusLabel } from './signals.js'
import type { NoteStore } from './noteStore.js'
import { Rail } from './Rail.js'
import { Source } from './Source.js'

const Chip = (props: {
  readonly children: JSX.Element
  readonly tone?: 'accent' | 'proposal' | 'over' | undefined
}): JSX.Element => (
  <span
    class="rounded-full border border-hairline px-2 py-0.5 text-label"
    classList={{
      'border-accent-line text-accent': props.tone === 'accent',
      'text-status-proposal': props.tone === 'proposal',
      'text-status-over': props.tone === 'over',
      'text-status-muted': props.tone === undefined,
    }}
  >
    {props.children}
  </span>
)

/**
 * The header card: what the frontmatter says about this file, the cap gauge,
 * and the one control that changes what the pane is showing. Its own component
 * because the pane below it is a different question — and because a single
 * function holding both is past the size a component should be.
 */
const Header = (props: {
  readonly path: string | undefined
  readonly frontmatter: Frontmatter | undefined
  readonly cap: CapStatus | undefined
  readonly editing: boolean
  /** A file the window could not read has no source to offer. */
  readonly editable: boolean
  readonly onToggleEdit: () => void
  readonly resolve: (target: string) => LinkResolution
  readonly onOpen: (path: string) => void
}): JSX.Element => (
        <div class="sticky top-0 border-b border-hairline bg-surface px-6 py-3">
          <h1 class="font-semibold">{props.path ?? 'Inchworm'}</h1>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <Show when={props.frontmatter?.status}>
              {(status) => (
                <Chip tone={status().kind === 'active' ? 'accent' : status().kind === 'proposal' ? 'proposal' : undefined}>
                  {statusLabel(status())}
                </Chip>
              )}
            </Show>
            <Show when={props.frontmatter?.updated}>{(updated) => <Chip>updated {updated()}</Chip>}</Show>
            <span class="text-label">
              <Gauge cap={props.cap} long />
            </span>
            <Show when={props.editable}>
              {/* The icon says which way the toggle goes; the word says what
                  it is. Neither alone is enough — a pencil that becomes a book
                  is a rebus, and a bare word is what made every control in this
                  row look like a badge (reported in use, 2026-08-21). */}
              <button
                class="btn btn-accent no-drag"
                aria-pressed={props.editing}
                onClick={() => {
                  props.onToggleEdit()
                }}
              >
                <Icon name={props.editing ? 'read' : 'edit'} />
                {props.editing ? 'Read' : 'Edit source'}
              </button>
            </Show>
            <For each={props.frontmatter?.links ?? []}>
              {(link) => (
                <button
                  class="btn no-drag rounded-full text-accent"
                  onClick={() => {
                    // `splitTarget`, not a local split: `target#anchor` is the
                    // schema's syntax and `core` is where it is read.
                    const resolution = props.resolve(splitTarget(link).target)
                    if (resolution.status === 'resolved') props.onOpen(resolution.path)
                  }}
                >
                  {link}
                </button>
              )}
            </For>
          </div>
        </div>
)

/**
 * The reading half of the pane: the rendered note, or the bytes when the
 * pipeline would not take them, plus the register append affordance. Separated
 * from the editing half so neither function has to know about the other's
 * states, and so neither grows past the size a component should be.
 */
const Prose = (props: {
  readonly path: string | undefined
  readonly html: string | undefined
  readonly raw: string | undefined
  readonly failed: boolean
  readonly appendable: boolean
  readonly onAppend: (path: string) => void
  readonly onClick: (event: MouseEvent) => void
}): JSX.Element => (
  <>
        <Show when={props.path === undefined}>
          <p class="px-6 py-4 text-status-muted">Pick a file on the left.</p>
        </Show>

        {/* An empty file, or one that is nothing but frontmatter, renders to no
            markup at all — without this the pane is a header card over silence. */}
        <Show when={props.path !== undefined && !props.failed && props.html === ''}>
          <p class="px-6 py-4 text-status-muted">This file has no content yet.</p>
        </Show>

        {/* `innerHTML` with markup `core` sanitised — the one place the app
            injects HTML, and the reason `renderHtml` owns the pipeline. */}
        <Show when={props.html}>
          {(body) => <div class="prose px-6 py-4" onClick={props.onClick} innerHTML={body()} />}
        </Show>

        {/* The append affordance: a footer, never an insertion. It writes the
            template into the *draft* at the bottom of the file and hands the
            reader the editor — the app never appends to disk on its own
            (wiki 04_ui_layout, [[ideas#I4]]). */}
        <Show when={props.appendable && props.path !== undefined}>
          <div class="px-6 py-4">
            <button
              class="btn btn-accent no-drag"
              onClick={() => {
                if (props.path !== undefined) props.onAppend(props.path)
              }}
            >
              <Icon name="append" />
              Append entry from template
            </button>
          </div>
        </Show>

        <Show when={props.raw}>
          {(text) => (
            <>
              <p role="status" class="px-6 pt-4 text-status-proposal">
                Shown as plain text — this file is past what the renderer will parse.
              </p>
              <pre class="px-6 py-4 font-mono text-xs whitespace-pre-wrap">{text()}</pre>
            </>
          )}
        </Show>
  </>
)

export const Note = (props: {
  readonly project: ProjectSnapshot
  readonly store: NoteStore
  readonly drafts: Drafts
  readonly path: string | undefined
  readonly onOpen: (path: string) => void
  /** Source instead of prose, on the same pane and the same file (⌥⏎). */
  readonly editing: boolean
  readonly onToggleEdit: () => void
  /** Appends a new entry from that register's template and opens it for editing. */
  readonly onAppend: (path: string) => void
  readonly caret: number | undefined
  /** A ⌘E note-tag request, by nonce — only the source pane can act on it. */
  readonly tag: { readonly name: string; readonly nonce: number } | undefined
  readonly onOpenExternal: (url: string) => void
}): JSX.Element => {
  const entry = createMemo(() => (props.path === undefined ? undefined : props.store.get(props.path)))
  const failure = createMemo(() => (props.path === undefined ? undefined : props.store.failure(props.path)))
  const state = createMemo(() => entry()?.note)

  const frontmatter = createMemo(() => {
    const note = state()
    return note?.kind === 'parsed' && note.frontmatter.kind === 'parsed' ? note.frontmatter.fields : undefined
  })

  /**
   * The register whose entries are appended at the bottom, if this is one.
   * `core` answers both halves — which register this is, and whether its
   * entries are blocks rather than table rows. Registers are append-only.
   */
  const appendable = createMemo(() => {
    if (props.path === undefined) return false
    const kind = classify(props.path, props.project.layout)
    return kind.kind === 'register' && isAppendable(kind.register)
  })

  const cap = createMemo(() => {
    const note = state()
    if (note === undefined || props.path === undefined) return undefined
    return capStatus(note.lineCount, capFor(classify(props.path, props.project.layout)))
  })

  /** One render per parse, from the AST the store already holds. */
  const rendered = createMemo(() => {
    const note = state()
    if (note?.kind !== 'parsed') return undefined
    return renderHtml(note.ast, note.links, props.store.resolve)
  })
  const html = createMemo(() => {
    const result = rendered()
    return result?.ok === true ? result.value : undefined
  })

  const raw = createMemo(() => {
    const note = state()
    const result = rendered()
    // Shown, never hidden: a note too big or too deep for the pipeline still
    // reaches the reader as its own bytes.
    return note !== undefined && (note.kind === 'unparsed' || result?.ok === false) ? entry()?.text : undefined
  })

  /**
   * `[[links]]` are anchors `core` minted and the sanitiser vetted, so a click
   * inside the prose is navigation, not a URL: nothing is parsed out of the
   * DOM but the path that was put there.
   */
  const onClick = (event: MouseEvent): void => {
    const anchor = event.target instanceof Element ? event.target.closest('a') : null
    if (!(anchor instanceof HTMLElement)) return
    // Every anchor in the prose is intercepted, not only ours: letting the
    // window navigate would replace the app with a page.
    event.preventDefault()
    const { path } = anchor.dataset
    if (path !== undefined) {
      props.onOpen(path)
      return
    }
    // A web link leaves through the OS, never through this window: a renderer
    // that navigates keeps the privileged bridge and stops being the app.
    const href = anchor.getAttribute('href')
    if (href !== null) props.onOpenExternal(href)
  }

  return (
    <div class="flex min-h-0 flex-1">
      {/* Plain elements, not `section`/`header`: inside the window's `main`
          they would add a second banner landmark and an unnamed region to the
          document outline, which is noise, not structure (browser check). */}
      <div class="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <Header
          path={props.path}
          frontmatter={frontmatter()}
          cap={cap()}
          editing={props.editing}
          editable={props.path !== undefined && entry() !== undefined}
          onToggleEdit={props.onToggleEdit}
          resolve={props.store.resolve}
          onOpen={props.onOpen}
        />

        <Show when={failure()}>
          {(message) => (
            <p role="alert" class="px-6 py-4 text-status-over">
              Failed: {message()}
            </p>
          )}
        </Show>

        {/* Keyed on the path: a new file gets a new editor rather than pouring
            one document into another's undo history. */}
        <Show when={props.editing && props.path !== undefined ? props.path : undefined} keyed>
          {(path) => (
            <Source
              path={path}
              drafts={props.drafts}
              resolve={props.store.resolve}
              links={props.store.index()}
              caret={props.caret}
              tag={props.tag}
            />
          )}
        </Show>

        <Prose
          path={props.path}
          html={props.editing ? undefined : html()}
          raw={props.editing ? undefined : raw()}
          failed={failure() !== undefined}
          appendable={!props.editing && appendable()}
          onAppend={props.onAppend}
          onClick={onClick}
        />
      </div>

      <Show when={props.path}>
        {(path) => <Rail store={props.store} path={path()} state={state()} onOpen={props.onOpen} />}
      </Show>
    </div>
  )
}
