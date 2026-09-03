/**
 * Wire errors as sentences. The renderer never invents a failure of its own and
 * never shows an error kind raw: main answers with a tagged union, and this is
 * the single place it becomes English.
 */

import type { FileError, OpenProjectError, PtyError, SettingsError, SkillError, SkillStatus } from '@shared/api.js'

/** The same sentence in both mappers: a malformed payload is one failure, not two. */
const BAD_REQUEST = 'That request was malformed — this is a bug in the app.'

export const openProjectMessage = (error: OpenProjectError): string => {
  switch (error.kind) {
    case 'bad-request':
      return BAD_REQUEST
    case 'not-a-directory':
      return 'That is not a folder.'
    case 'no-llmwiki':
      // The picker draws the evidence; this is the sentence above it, and the
      // one a sheet with no room for the panel shows on its own.
      return error.markers.agentFiles.length === 0
        ? 'No llmwiki project in that folder.'
        : `${error.markers.agentFiles.join(' and ')} carries no usable llmwiki block (${error.detail ?? 'no block'}).`
  }
}

/** What is missing, as the reader's own next step rather than a parser's word. */
export const markerAdvice = (error: Extract<OpenProjectError, { kind: 'no-llmwiki' }>): string => {
  if (error.markers.agentFiles.length === 0 && error.markers.wiki) {
    return 'There is a wiki here but no agent file to declare it: an init that stopped half-way.'
  }
  if (error.markers.agentFiles.length === 0) return 'Nothing here has been initialised yet.'
  return 'The file is there; the machine-readable block that names the wiki root and the journal is not.'
}

export const settingsMessage = (error: SettingsError): string => {
  switch (error.kind) {
    case 'bad-request':
      return BAD_REQUEST
    case 'no-launchers':
      return 'Keep at least one agent — the drawer has to have something to run.'
    case 'too-many-launchers':
      return 'That is more agents than the menu can hold.'
    case 'empty-field':
      return `An agent needs a ${error.field}.`
    case 'too-long':
      return `That ${error.field} is too long.`
    case 'duplicate-id':
      return 'Two agents ended up with the same id — rename one.'
    case 'bad-tag':
      return 'A note tag is a name: a letter first, then letters, digits, - or _.'
  }
}

export const skillMessage = (error: SkillError): string => {
  switch (error.kind) {
    case 'bad-request':
      return BAD_REQUEST
    case 'no-bundle':
      // Not the reader's doing: the app shipped without its own skill.
      return `This build carries no skill to install (${error.detail}).`
    case 'conflict':
      // The sha guard's sentence, for a directory: nothing was written.
      return 'The installed skill changed since this sheet read it, so nothing was written. Check again, then install.'
    case 'unreadable':
      return `The installed copy could not be read: ${error.detail}`
    case 'unwritable':
      // The two-phase write makes a half-install unlikely, not impossible, and
      // the state line above this one is re-read either way — so it is pointed at.
      return `Could not be written: ${error.detail}. Check the state above before retrying.`
  }
}

/** What is under `~/.claude` now, against what this build carries. */
export const skillStateMessage = (status: SkillStatus): string => {
  switch (status.state) {
    case 'absent':
      return `Not installed. Installing writes ${String(status.files)} files into ~/.claude.`
    case 'current':
      return 'Installed, and the same as the copy in this build.'
    case 'differs':
      return 'Installed, and different from the copy in this build. Installing replaces it — it never merges.'
  }
}

export const fileMessage = (error: FileError): string => {
  switch (error.kind) {
    case 'bad-request':
      return BAD_REQUEST
    case 'outside-project':
      return 'That path is outside the project.'
    case 'not-found':
      return 'That file is no longer there.'
    case 'too-large':
      return `Too large to show (${String(Math.round(error.bytes / 1000))} kB).`
    case 'unreadable':
      return `Could not be read: ${error.detail}`
    case 'conflict':
      return 'The file changed on disk since it was opened.'
    case 'no-project':
      return 'This window has no project open.'
  }
}

export const ptyMessage = (error: PtyError): string => {
  switch (error.kind) {
    case 'bad-request':
      return BAD_REQUEST
    case 'no-project':
      return 'This window has no project or folder to run anything in.'
    case 'too-many':
      return 'This window already has as many panes as it can hold.'
    case 'no-launcher':
      return 'No agent is configured — add one in Settings.'
    case 'spawn-failed':
      // The ordinary case is `claude` not being on PATH, so the detail is the
      // whole point of the sentence.
      return `Could not start: ${error.detail}`
  }
}
