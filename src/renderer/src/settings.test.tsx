// @vitest-environment happy-dom
/**
 * Settings (⌘,) and the folder that is not a project yet — the two halves of
 * "which agent, and where".
 *
 * The bridge is the fake one throughout: what main does with a launcher id is
 * `main/handlers.test.ts`'s, and the rule under test here is that the renderer
 * only ever *names* an agent.
 */

import { render } from 'solid-js/web'
import { afterEach, describe, expect, test } from 'vitest'
import type { OpenProjectError, ProjectSnapshot, Settings } from '@shared/api.js'
import { fakeApi, type FakeApi } from '../../../tests/support/api.js'
import { App } from './App.jsx'

const FILES = new Map([
  ['wiki/00_state.md', '# state\n'],
  ['CLAUDE.md', '# CLAUDE\n'],
])

const project: ProjectSnapshot = {
  dir: '/p',
  name: 'p',
  hue: 210,
  layout: { wikiRoot: 'wiki', journal: 'notes', kind: 'software' },
  files: [...FILES.keys()],
}

const TWO: Settings = {
  launchers: [
    { id: 'claude', label: 'claude', command: 'claude' },
    { id: 'codex', label: 'codex', command: 'codex --model o3' },
  ],
  defaultLauncherId: 'claude',
  noteTag: 'eddy',
}

const NO_WIKI: OpenProjectError = {
  kind: 'no-llmwiki',
  dir: '/Users/e/git/newthing',
  markers: { agentFiles: [], wiki: false },
}

let dispose = (): void => undefined

afterEach(() => {
  dispose()
  document.body.innerHTML = ''
  delete (window as { wiki?: unknown }).wiki
})

const settle = async (): Promise<void> => {
  for (let tick = 0; tick < 12; tick += 1) await Promise.resolve()
}

const mount = async (
  options: Parameters<typeof fakeApi>[0] = { project, files: new Map(FILES) },
): Promise<FakeApi> => {
  const fake = fakeApi(options)
  Object.defineProperty(window, 'wiki', { value: fake.api, configurable: true })
  dispose = render(() => <App />, document.body)
  await settle()
  return fake
}

const button = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find((element) => element.textContent.trim() === text)

const field = (label: string): HTMLInputElement | null =>
  document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)

const click = async (element: Element | null | undefined): Promise<void> => {
  ;(element as HTMLElement | null | undefined)?.click()
  await settle()
}

const type = async (input: HTMLInputElement | null, value: string): Promise<void> => {
  if (input === null) return
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}

const sheet = (label: string): HTMLDialogElement | null =>
  document.querySelector<HTMLDialogElement>(`dialog[open][aria-label="${label}"]`)

describe('the settings sheet', () => {
  test('⌘, opens it in a project window, and it is a view with its own heading', async () => {
    const fake = await mount()

    fake.send({ kind: 'settings' })
    await settle()

    expect(sheet('Settings')).not.toBeNull()
    expect(sheet('Settings')?.querySelector('h1')?.textContent).toBe('Settings')
  })

  test('⌘, opens it in the picker too — the settings belong to the app', async () => {
    const fake = await mount({ project: undefined })

    fake.send({ kind: 'settings' })
    await settle()

    expect(sheet('Settings')).not.toBeNull()
  })

  test('the front door opens it with a button, not only with an accelerator', async () => {
    // A menu-only affordance is one no reader finds by looking — and one no
    // automated check can reach by looking at the menu bar.
    await mount({ project: undefined })

    await click(button('Settings'))

    expect(sheet('Settings')).not.toBeNull()
  })

  test('an edited row is saved on request, not on every keystroke', async () => {
    const fake = await mount({ project, files: new Map(FILES), settings: TWO })
    fake.send({ kind: 'settings' })
    await settle()

    await type(field('Command for agent 2'), 'codex --model o4')
    // Nothing yet: a half-typed command is not a command.
    expect(fake.saved).toEqual([])

    await click(button('Save'))

    expect(fake.saved.at(-1)?.launchers[1]?.command).toBe('codex --model o4')
  })

  test('a refusal is shown and nothing is written', async () => {
    const fake = await mount({
      project,
      files: new Map(FILES),
      settings: TWO,
      refuseSettings: { kind: 'empty-field', field: 'command' },
    })
    fake.send({ kind: 'settings' })
    await settle()

    await click(button('Save'))

    expect(fake.saved).toEqual([])
    expect(sheet('Settings')?.querySelector('[role="alert"]')?.textContent).toContain('needs a command')
  })

  test('typing does not rebuild the row underneath the reader', async () => {
    const fake = await mount({ project, files: new Map(FILES), settings: TWO })
    fake.send({ kind: 'settings' })
    await settle()

    const before = field('Command for agent 2')
    await type(before, 'codex --model o4')

    // The same element, still: a rebuilt row takes the focus and the caret with
    // it, which makes the sheet unusable after one character.
    expect(field('Command for agent 2')).toBe(before)
    expect(field('Command for agent 2')?.value).toBe('codex --model o4')
  })

  test('an agent added and left blank is refused in words, not as a bug report', async () => {
    // The schema takes the shape and `core` judges the meaning: an empty
    // command must not come back as "this is a bug in the app".
    const fake = await mount({
      project,
      files: new Map(FILES),
      refuseSettings: { kind: 'empty-field', field: 'command' },
    })
    fake.send({ kind: 'settings' })
    await settle()

    await click(button('Add an agent'))
    await click(button('Save'))

    expect(sheet('Settings')?.querySelector('[role="alert"]')?.textContent).toContain('needs a command')
    expect(sheet('Settings')?.querySelector('[role="alert"]')?.textContent).not.toContain('bug in the app')
  })

  test('the default is a radio, because exactly one row is the default', async () => {
    const fake = await mount({ project, files: new Map(FILES), settings: TWO })
    fake.send({ kind: 'settings' })
    await settle()

    const radios = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    expect(radios).toHaveLength(2)
    expect(radios[0]?.checked).toBe(true)

    await click(button('Add an agent'))

    expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(3)
  })
})

describe('the note tag', () => {
  test('the sheet shows what the tag will look like, not just its name', async () => {
    const fake = await mount({ project, files: new Map(FILES), settings: TWO })
    fake.send({ kind: 'settings' })
    await settle()

    expect(sheet('Settings')?.textContent).toContain('<eddy>…</eddy>')

    await type(field('Note tag name'), 'ebr')

    expect(sheet('Settings')?.textContent).toContain('<ebr>…</ebr>')
  })

  test('a name the app could not write is refused in words', async () => {
    const fake = await mount({
      project,
      files: new Map(FILES),
      settings: TWO,
      refuseSettings: { kind: 'bad-tag' },
    })
    fake.send({ kind: 'settings' })
    await settle()

    await click(button('Save'))

    expect(sheet('Settings')?.querySelector('[role="alert"]')?.textContent).toContain('a letter first')
  })

  test('⌘E wraps the selection in the editor and leaves the caret inside', async () => {
    const fake = await mount({ project, files: new Map(FILES), settings: TWO })
    await click(button('Edit source'))

    fake.send({ kind: 'tag' })
    await settle()

    // The document, not the DOM: what matters is the bytes the save will write.
    expect(document.querySelector('.cm-content')?.textContent).toContain('<eddy></eddy>')
  })

  test('two presses are two notes — the request is counted, not flagged', async () => {
    const fake = await mount({ project, files: new Map(FILES), settings: TWO })
    await click(button('Edit source'))

    fake.send({ kind: 'tag' })
    await settle()
    fake.send({ kind: 'tag' })
    await settle()

    const text = document.querySelector('.cm-content')?.textContent ?? ''
    // Nested, because the caret is left inside the first pair.
    expect(text).toContain('<eddy><eddy></eddy></eddy>')
  })

  test('a note stays in the file it was asked for — opening another one inserts nothing', async () => {
    const fake = await mount({ project, files: new Map(FILES), settings: TWO })
    await click(button('Edit source'))

    fake.send({ kind: 'tag' })
    await settle()

    // The sidebar entry carries its gauge in the same button, so it is matched
    // by what it opens rather than by its whole label.
    await click(
      [...document.querySelectorAll('button')].find((element) => element.textContent.startsWith('CLAUDE.md')),
    )
    await settle()

    // The other file's bytes, untouched: one ⌘E is one note, in one file.
    expect(document.querySelector('.cm-content')?.textContent).not.toContain('<eddy>')
  })

  test('⌘E in reading mode does nothing at all — there is nowhere to put it', async () => {
    const fake = await mount({ project, files: new Map(FILES), settings: TWO })

    fake.send({ kind: 'tag' })
    await settle()

    expect(document.querySelector('.cm-content')).toBeNull()
    expect(document.body.textContent).not.toContain('<eddy>')
  })
})

describe('the drawer follows settings', () => {
  test('one + button per configured agent, and the id is what crosses the bridge', async () => {
    const fake = await mount({ project, files: new Map(FILES), settings: TWO })
    fake.send({ kind: 'terminal' })
    await settle()

    expect(button('+ claude')).not.toBeUndefined()
    expect(button('+ codex')).not.toBeUndefined()

    await click(button('+ codex'))

    // A *name*, never a command line: the argv is main's.
    expect(fake.started).toEqual(['agent'])
    expect(fake.launched).toEqual(['codex'])
  })

  test('a launcher added in another window reaches this drawer without a reload', async () => {
    const fake = await mount()
    fake.send({ kind: 'terminal' })
    await settle()
    expect(button('+ codex')).toBeUndefined()

    fake.settingsChanged(TWO)
    await settle()

    expect(button('+ codex')).not.toBeUndefined()
  })
})

describe('a folder with no llmwiki in it', () => {
  const openRefused = async (markers = NO_WIKI): Promise<FakeApi> => {
    const fake = await mount({
      project: undefined,
      recent: [{ dir: '/Users/e/git/newthing', name: 'newthing', hue: 300, lastOpenedMs: Date.now() }],
      refuseOpen: markers,
    })
    await click(document.querySelector('.project-row'))
    return fake
  }

  test('says what is missing, by name, rather than "not a project"', async () => {
    await openRefused()

    const panel = document.querySelector('[aria-label="Not an llmwiki project"]')
    expect(panel?.textContent).toContain('CLAUDE.md')
    expect(panel?.textContent).toContain('AGENTS.md')
    expect(panel?.textContent).toContain('local_context/wiki')
    // And which folder it is talking about.
    expect(panel?.textContent).toContain('/Users/e/git/newthing')
  })

  test('an init that stopped half-way is told apart from an empty folder', async () => {
    await openRefused({ ...NO_WIKI, markers: { agentFiles: [], wiki: true } })

    expect(document.body.textContent).toContain('half-way')
  })

  test('offers the default agent, and starting it opens a pane in that folder', async () => {
    const fake = await openRefused()

    await click(button('Start claude here'))

    // The renderer named an agent; the folder is the one main just refused,
    // which is why no directory crosses the bridge here.
    expect(fake.started).toEqual(['agent'])
    expect(fake.launched).toEqual(['claude'])
    expect(document.querySelector('.xterm')).not.toBeNull()
  })

  test('the offered agent is whichever one settings call the default', async () => {
    const fake = await mount({
      project: undefined,
      recent: [{ dir: '/Users/e/git/newthing', name: 'newthing', hue: 300, lastOpenedMs: Date.now() }],
      refuseOpen: NO_WIKI,
      settings: { ...TWO, defaultLauncherId: 'codex' },
    })
    await click(document.querySelector('.project-row'))

    expect(button('Start codex here')).not.toBeUndefined()
    await click(button('Start codex here'))
    expect(fake.launched).toEqual(['codex'])
  })

  test('the agent takes the window rather than a strip inside the panel', async () => {
    await openRefused()
    await click(button('Start claude here'))

    // A conversation with an agent needs the window: the pane is the window's,
    // not the panel's, and it carries its own way back.
    const pane = document.querySelector('[aria-label="claude in /Users/e/git/newthing"]')
    expect(pane).not.toBeNull()
    expect(pane?.className).toContain('fixed')
    expect(pane?.querySelector('.xterm')).not.toBeNull()
    expect(pane?.textContent).toContain('Check again')
    // Below the title bar, so the traffic lights and the drag region survive.
    expect(pane?.className).toContain('top-12')
  })

  test('closing the pane gives the folder panel back, and kills the pty', async () => {
    const fake = await openRefused()
    await click(button('Start claude here'))
    expect(fake.livePanes()).toBe(1)

    await click(button('Close'))

    expect(document.querySelector('[aria-label="claude in /Users/e/git/newthing"]')).toBeNull()
    expect(button('Start claude here')).not.toBeUndefined()
    expect(fake.livePanes()).toBe(0)
  })

  test('check again re-opens the same folder, and the panel goes when it works', async () => {
    const fake = await openRefused()
    expect(fake.opened).toEqual(['/Users/e/git/newthing'])

    await click(button('Check again'))

    expect(fake.opened).toEqual(['/Users/e/git/newthing', '/Users/e/git/newthing'])
  })
})

/**
 * The skill install: the one thing on this sheet that writes outside a project
 * — the bridge is the fake one, and what lands under
 * `~/.claude` is `main/skill.test.ts`'s, and the rule under test here is that
 * the sheet carries the digest it was shown and never claims more than happened.
 */
describe('the skill install', () => {
  const open = async (options: Parameters<typeof fakeApi>[0] = { project: undefined }): Promise<FakeApi> => {
    const fake = await mount(options)
    fake.send({ kind: 'settings' })
    await settle()
    return fake
  }

  const text = (): string => sheet('Settings')?.textContent ?? ''

  test('a machine with no skill is told so, and the button offers to install', async () => {
    await open()

    expect(text()).toContain('Not installed')
    expect(button('Install')).toBeDefined()
  })

  test('the two write scopes are named on screen, and settings.json is named as untouched', async () => {
    await open()

    expect(text()).toContain('~/.claude/skills/llmwiki/')
    expect(text()).toContain('~/.claude/hooks/')
    expect(text()).toContain('settings.json')
  })

  test('installing carries the digest the sheet was shown', async () => {
    const fake = await open({ project: undefined, skill: { state: 'differs', sha: 'sha:old', files: 6 } })

    await click(button('Reinstall'))

    expect(fake.installs).toEqual(['sha:old'])
  })

  /**
   * The gotcha this whole affordance would otherwise walk into: a fresh skill
   * directory is discovered only at startup, so a bare "Installed" is a lie the
   * reader finds out about the next time they type `/llmwiki`.
   */
  test('a first install says restart Claude Code in the same breath as the success', async () => {
    await open()

    await click(button('Install'))

    expect(text()).toContain('Restart Claude Code')
    expect(text()).toContain('not discovered until the next one')
  })

  /**
   * The one step the app cannot take for the reader, said where a novice is
   * actually looking — after the install, not in the blurb before it — and
   * handed to the agent in the drawer rather than to the reader's editor.
   */
  test('a first install offers the owed hook lines to the agent, not only to the reader', async () => {
    await open()

    await click(button('Install'))

    expect(text()).toContain('ask your agent')
    expect(text()).toContain('MIGRATION.md')
    expect(text()).toContain('~/.claude/settings.json')
  })

  test('a reinstall still says restart, because a running session keeps its hooks', async () => {
    await open({ project: undefined, skill: { state: 'differs', sha: 'sha:old', files: 6 } })

    await click(button('Reinstall'))

    expect(text()).toContain('Restart Claude Code')
  })

  test('the state is re-read after an install, so the next one carries a fresh digest', async () => {
    const fake = await open()

    await click(button('Install'))
    await click(button('Reinstall'))

    expect(fake.installs).toEqual(['', 'sha:installed'])
  })

  test('a refused install is shown as a refusal and claims nothing was installed', async () => {
    await open({ project: undefined, refuseInstall: { kind: 'conflict', currentSha: 'sha:moved' } })

    await click(button('Install'))

    expect(text()).toContain('nothing was written')
    expect(text()).not.toContain('Restart Claude Code')
  })

  /**
   * The whole reason the guard is a digest and not a boolean: a refusal is
   * recoverable without a reload, because the sheet re-reads and the next click
   * carries what is on disk now.
   */
  test('refused, re-read, retried: the second click carries the digest the refusal named', async () => {
    const fake = await open({ project: undefined, refuseInstall: { kind: 'conflict', currentSha: 'sha:moved' } })

    await click(button('Install'))
    await click(button('Reinstall'))

    expect(fake.installs).toEqual(['', 'sha:moved'])
    expect(text()).toContain('Restart Claude Code')
    expect(text()).not.toContain('nothing was written')
  })

  test('a successful install relabels the button and updates the state line', async () => {
    await open()

    await click(button('Install'))

    expect(button('Install')).toBeUndefined()
    expect(text()).toContain('Installed, and the same as the copy in this build')
  })

  test('a status that cannot be read is an alert, and no install is offered over it', async () => {
    await open({ project: undefined, refuseStatus: { kind: 'unreadable', detail: 'EACCES' } })

    expect(text()).toContain('could not be read')
    expect(button('Install')).toBeUndefined()
    expect(button('Reinstall')).toBeUndefined()
  })

  /**
   * Two clicks before the first answers would send the same digest twice, and
   * the second would be refused as a conflict over a copy nobody else touched
   * else touched.
   */
  test('the button is held down while an install is in flight, so one click is one install', async () => {
    const fake = await mount({ project: undefined })
    fake.send({ kind: 'settings' })
    await settle()

    const install = button('Install')
    install?.click()
    install?.click()
    await settle()

    expect(fake.installs).toEqual([''])
  })

  test('a build carrying no skill says so rather than failing silently', async () => {
    await open({ project: undefined, refuseInstall: { kind: 'no-bundle', detail: '/nowhere' } })

    await click(button('Install'))

    expect(text()).toContain('no skill to install')
  })
})
