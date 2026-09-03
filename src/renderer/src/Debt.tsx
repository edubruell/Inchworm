/**
 * The sidebar's debt section: one row per thing that landed and was never
 * written up. It sits above State because it
 * is the only part of the sidebar that is about *time* — everything below it is
 * the wiki as it stands, and this is the wiki as it has fallen behind.
 *
 * It is `--status-*`, never `--accent-*`: debt is fixed meaning, not project
 * identity, and the two colour families are disjoint.
 *
 * The section is absent when there is nothing owed. That is deliberate and the
 * opposite of the contention badge's rule: "no open contentions" is a fact
 * about a project worth a permanent slot, while "nothing unwritten" is the
 * resting state of a wiki being kept, and a row that is always there and
 * always zero is a row nobody reads.
 */

import { For, Show, type JSX } from 'solid-js'
import type { DebtError, DebtItem } from '@shared/api.js'
import { debtCountLabel, debtFailedLabel, debtLabel } from './signals.js'
import type { DebtStore } from './debtStore.js'

const errorLine = (error: DebtError): string => {
  switch (error.kind) {
    case 'no-project':
      return 'no project in this window'
    case 'no-python':
      return 'no python3 on PATH — the checkers cannot run'
    case 'no-bundle':
      return 'this build carries no checkers'
    case 'unreachable':
      return 'the checkers could not be reached — this list may be stale'
  }
}

const Row = (props: {
  readonly item: DebtItem
  readonly onSelect: (path: string) => void
}): JSX.Element => {
  const title = (): string => `${debtLabel(props.item.kind)} — ${props.item.detail}`
  const shared = 'flex w-full items-baseline gap-2 px-2 py-1'
  const inside = (): JSX.Element => (
    <>
      <span class="truncate">{props.item.label}</span>
      <span class="ml-auto shrink-0 text-label text-status-muted">{debtLabel(props.item.kind)}</span>
    </>
  )

  return (
    <li>
      {/*
        A row is a button only when it can do something. An artefact under the
        project's own folders is real debt the app must show and cannot open,
        and a button that does nothing when pressed teaches the reader that
        none of them work.
      */}
      <Show
        when={props.item.path}
        fallback={
          <span class={`${shared} text-status-muted`} title={title()}>
            {inside()}
          </span>
        }
      >
        {(path) => (
          <button
            class={`no-drag rounded text-left hover:bg-accent-wash ${shared}`}
            title={title()}
            onClick={() => {
              props.onSelect(path())
            }}
          >
            {inside()}
          </button>
        )}
      </Show>
    </li>
  )
}

export const DebtSection = (props: {
  readonly debt: DebtStore
  readonly onSelect: (path: string) => void
}): JSX.Element => {
  const items = (): readonly DebtItem[] => props.debt.report()?.items ?? []
  const failed = (): string | undefined => debtFailedLabel(props.debt.report()?.failed ?? [])
  const error = (): DebtError | undefined => props.debt.error()

  return (
    <Show when={items().length > 0 || error() !== undefined || failed() !== undefined}>
      <section aria-label="Not written up">
        <h2 class="mt-4 mb-1 flex items-center gap-2 px-2 text-label tracking-wider text-status-muted uppercase first:mt-0">
          <span>Not written up</span>
          <Show when={items().length > 0}>
            <span
              class="rounded-full bg-status-proposal px-1.5 text-label text-surface"
              aria-label={debtCountLabel(items().length)}
              title={debtCountLabel(items().length)}
            >
              {items().length}
            </span>
          </Show>
          {/*
            The manual half of the refresh policy. It re-asks; it never writes,
            and it never clears a row on its own — a row goes away because the
            wiki gained the line, which is the only thing that makes it true.
          */}
          <button
            class="no-drag ml-auto rounded px-1 hover:bg-accent-wash"
            title="Check again"
            aria-label="Check again"
            disabled={props.debt.checking()}
            onClick={() => {
              props.debt.refresh()
            }}
          >
            {props.debt.checking() ? '…' : '↻'}
          </button>
        </h2>
        <Show when={error()}>
          {(reason) => (
            <p class="px-2 pb-1 text-label text-status-over" role="alert">
              {errorLine(reason())}
            </p>
          )}
        </Show>
        <Show when={failed()}>
          {(warning) => (
            <p class="px-2 pb-1 text-label text-status-proposal" role="status">
              {warning()}
            </p>
          )}
        </Show>
        <ul>
          <For each={items()}>{(item) => <Row item={item} onSelect={props.onSelect} />}</For>
        </ul>
      </section>
    </Show>
  )
}
