/**
 * The settings sheet (⌘,), and the only place the app's own preferences are
 * edited.
 */

import { createSignal, Index, Show, type JSX } from 'solid-js'
import { freeLauncherId, MAX_LAUNCHERS } from '@core/settings.js'
import type { Launcher, Settings as SettingsValue, SkillInstalled, SkillStatus, WikiApi } from '@shared/api.js'
import { Icon } from './Icon.js'
import { settingsMessage, skillMessage, skillStateMessage } from './messages.js'

/**
 * The settings sheet (⌘,): the app's own preferences, as opposed to a
 * project's, which are read from its agent file and never configured here.
 *
 * Sections rather than one list, because the reason the sheet exists
 * generalises: `claude` was hard-coded into the terminal presets, and which
 * agent writes a wiki is the reader's choice. The last section is the **skill
 * install** — the shipping path for the copy of `/llmwiki` this build carries,
 * and the one thing on this sheet that writes outside a project.
 *
 * It edits a **draft** and saves on request rather than on every keystroke: a
 * half-typed command is not a command, and a live-saving list would broadcast a
 * broken launcher to every window between two characters.
 */
export const Settings = (props: {
  readonly api: WikiApi
  readonly settings: SettingsValue
  readonly onClose: () => void
}): JSX.Element => {
  const [draft, setDraft] = createSignal<SettingsValue>(props.settings)
  const [failure, setFailure] = createSignal<string>()
  const [saved, setSaved] = createSignal(false)
  const [skill, setSkill] = createSignal<SkillStatus>()
  const [skillFailure, setSkillFailure] = createSignal<string>()
  const [installed, setInstalled] = createSignal<SkillInstalled>()
  const [installing, setInstalling] = createSignal(false)

  /**
   * What is under `~/.claude` right now. Read when the sheet opens and again
   * after every install, because the digest it hands back is the guard the next
   * install carries — a stale one is refused, which is the point.
   */
  const readSkill = (): void => {
    props.api
      .skillStatus()
      .then((result) => {
        if (result.ok) setSkill(result.value)
        else setSkillFailure(skillMessage(result.error))
      })
      .catch((error: unknown) => {
        console.error('[Inchworm] skillStatus', error)
        setSkillFailure('Could not be read: the app could not reach ~/.claude.')
      })
  }
  readSkill()

  /**
   * One at a time, and the button says so. Two clicks before the first answers
   * would send the same digest twice — and a click after the success but before
   * the re-read would send a digest that is provably stale, so the reader would
   * be told the copy "changed since this sheet read it" about a copy nobody
   * else touched.
   */
  const install = (): void => {
    const status = skill()
    if (status === undefined || installing()) return
    setInstalling(true)
    setSkillFailure(undefined)
    setInstalled(undefined)
    props.api
      .installSkill(status.sha)
      .then((result) => {
        if (result.ok) setInstalled(result.value)
        else setSkillFailure(skillMessage(result.error))
        // Either way: after a write the digest moved, and after a refusal the
        // sheet is holding one that is provably stale. The button stays down
        // until this lands, which is what makes the next click's digest true.
        readSkill()
      })
      .catch((error: unknown) => {
        console.error('[Inchworm] installSkill', error)
        setSkillFailure('Could not be installed: the app could not reach ~/.claude.')
      })
      .finally(() => {
        setInstalling(false)
      })
  }

  const edit = (change: (current: SettingsValue) => SettingsValue): void => {
    setFailure(undefined)
    setSaved(false)
    setDraft(change)
  }

  const editLauncher = (id: string, change: (launcher: Launcher) => Launcher): void => {
    edit((current) => ({
      ...current,
      launchers: current.launchers.map((launcher) => (launcher.id === id ? change(launcher) : launcher)),
    }))
  }

  const save = (): void => {
    props.api
      .setSettings(draft())
      .then((result) => {
        if (!result.ok) {
          setFailure(settingsMessage(result.error))
          return
        }
        // What comes back is what main *stored*, which is not always what was
        // sent: a default naming a deleted row is repaired on the way in.
        setDraft(result.value)
        setSaved(true)
      })
      .catch((error: unknown) => {
        console.error('[Inchworm] setSettings', error)
        setFailure('Could not be saved: the app could not reach the settings store.')
      })
  }

  return (
    <section class="flex w-[34rem] max-w-full flex-col gap-5 p-6">
      <h1 class="text-lg font-semibold">Settings</h1>

      <section class="flex flex-col gap-3">
        <div>
          <h2 class="font-medium">Agents</h2>
          <p class="mt-1 text-sm text-status-muted">
            What the drawer's <code>+</code> buttons run, and what starts in a folder with no wiki yet.
            Each is a command line, run through a login shell in the project directory.
          </p>
        </div>

        {/*
          `Index`, not `For`. `For` is keyed by *reference*, so editing a row
          replaces its object and Solid rebuilds that row's DOM — which throws
          away the `<input>` the reader is typing into, and with it the focus
          and the caret, after every single character (browser check
          2026-08-21). `Index` keys by position: the row's elements outlive its
          value, which is exactly what an editable list needs.
        */}
        <ul class="flex flex-col gap-2">
          <Index each={draft().launchers}>
            {(row, index) => {
              const launcher = (): Launcher => row()
              // The field names are **positional**, not the row's own label: a
              // control whose accessible name changes with every character the
              // reader types is a control a screen reader re-announces mid-word.
              const nth = String(index + 1)

              return (
                <li class="flex items-center gap-2">
                  {/*
                    The default is a radio, not a star or a drag handle: exactly
                    one row is the default, which is what a radio group means.
                  */}
                  <input
                    type="radio"
                    name="default-launcher"
                    class="no-drag"
                    checked={draft().defaultLauncherId === launcher().id}
                    aria-label={`Make agent ${nth} the default`}
                    onChange={() => {
                      edit((current) => ({ ...current, defaultLauncherId: launcher().id }))
                    }}
                  />
                  <input
                    class="field w-32 shrink-0"
                    value={launcher().label}
                    aria-label={`Name of agent ${nth}`}
                    onInput={(event) => {
                      editLauncher(launcher().id, (current) => ({ ...current, label: event.currentTarget.value }))
                    }}
                  />
                  <input
                    class="field min-w-0 flex-1 font-mono"
                    value={launcher().command}
                    aria-label={`Command for agent ${nth}`}
                    onInput={(event) => {
                      editLauncher(launcher().id, (current) => ({ ...current, command: event.currentTarget.value }))
                    }}
                  />
                  <button
                    class="btn btn-icon no-drag"
                    aria-label={`Remove ${launcher().label}`}
                    onClick={() => {
                      edit((current) => ({
                        ...current,
                        launchers: current.launchers.filter((other) => other.id !== launcher().id),
                      }))
                    }}
                  >
                    <Icon name="remove" />
                  </button>
                </li>
              )
            }}
          </Index>
        </ul>

        <button
          class="btn no-drag w-fit"
          disabled={draft().launchers.length >= MAX_LAUNCHERS}
          onClick={() => {
            edit((current) => ({
              ...current,
              launchers: [
                ...current.launchers,
                { id: freeLauncherId(current, 'agent'), label: 'agent', command: '' },
              ],
            }))
          }}
        >
          <Icon name="plus" />
          Add an agent
        </button>
      </section>

      <section class="flex flex-col gap-2">
        <div>
          <h2 class="font-medium">Notes to the agent</h2>
          <p class="mt-1 text-sm text-status-muted">
            ⌘E in the source editor wraps the selection in your own tag and leaves the caret inside it.
            The tag is not markdown: it survives a save byte-for-byte, and an agent reading the file
            sees it. The reading pane drops the tags and keeps the words inside them — unless the
            opening tag ends up alone on its line, which markdown reads as raw HTML and hides whole.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <input
            class="field w-32"
            value={draft().noteTag}
            aria-label="Note tag name"
            onInput={(event) => {
              const noteTag = event.currentTarget.value
              edit((current) => ({ ...current, noteTag }))
            }}
          />
          {/* The setting is a name; this is what the name *does*. */}
          <span class="font-mono text-sm text-status-muted">
            {`<${draft().noteTag}>…</${draft().noteTag}>`}
          </span>
        </div>
      </section>

      {/*
        The other half of the product. The app ships the `/llmwiki` skill it
        reads, so a machine with the app has no separate step to remember
        (wiki 01_product_scope) — and the two write scopes are named on screen,
        because this is the only place the app writes outside a project.
      */}
      <section class="flex flex-col gap-2">
        <div>
          <h2 class="font-medium">The /llmwiki skill</h2>
          <p class="mt-1 text-sm text-status-muted">
            Teaches Claude Code the schema this app reads. Install it once and{' '}
            <code>/llmwiki</code> is there in every project on this Mac — there is nothing
            to download, and nothing to set up per project.
          </p>
          {/*
            The inventory is still on screen, and so is the one step the app
            cannot take for the reader — folded, because a first-time reader
            needs the button, not the file list.
          */}
          <details class="mt-1 text-sm text-status-muted">
            <summary class="cursor-pointer no-drag">What it writes</summary>
            <p class="mt-1">
              The agent's own instructions, <code>SKILL.md</code> and its checkers, into{' '}
              <code>~/.claude/skills/llmwiki/</code>, and its SessionStart hooks into{' '}
              <code>~/.claude/hooks/</code>. Nothing else on your Mac is touched — your{' '}
              <code>settings.json</code> is never edited, so a first install ends with two
              hook lines that still have to be added to it. <code>MIGRATION.md</code> lands
              beside the skill with them in it, and the agent in the drawer below can do it
              for you.
            </p>
          </details>
        </div>

        <Show when={skill()}>
          {(status) => (
            <div class="flex items-center gap-2">
              <button class="btn no-drag" disabled={installing()} onClick={install}>
                <Icon name="save" />
                {status().state === 'absent' ? 'Install' : 'Reinstall'}
              </button>
              <span class="text-sm text-status-muted">{skillStateMessage(status())}</span>
            </div>
          )}
        </Show>

        {/*
          Said in the same breath as the success, never after it: a fresh skill
          directory is discovered only at startup, so a bare "Installed" is a
          lie the reader would find out about at `/llmwiki` (`gotchas` 2026-08-25).
        */}
        <Show when={installed()}>
          {(result) => (
            <p role="status" class="text-sm text-status-proposal">
              {result().fresh
                ? `Installed ${String(result().files)} files. Restart Claude Code — a skill directory that was not there at startup is not discovered until the next one. Then the hooks: ask your agent to add the two hook lines from ~/.claude/skills/llmwiki/MIGRATION.md to ~/.claude/settings.json — or paste them in yourself.`
                : `Installed ${String(result().files)} files. Restart Claude Code: a running session keeps the hooks it started with.`}
            </p>
          )}
        </Show>

        <Show when={skillFailure()}>
          {(message) => (
            <p role="alert" class="text-status-over">
              {message()}
            </p>
          )}
        </Show>
      </section>

      <Show when={failure()}>
        {(message) => (
          <p role="alert" class="text-status-over">
            {message()}
          </p>
        )}
      </Show>

      <div class="flex items-center gap-2">
        <button class="btn btn-accent no-drag" onClick={save}>
          <Icon name="save" />
          Save
        </button>
        <button class="btn no-drag" onClick={props.onClose}>
          Close
        </button>
        {/* Saying it happened, because nothing else on this sheet moves when it does. */}
        <Show when={saved()}>
          <span role="status" class="text-sm text-status-muted">
            Saved
          </span>
        </Show>
      </div>
    </section>
  )
}
