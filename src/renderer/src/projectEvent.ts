/**
 * How a window reacts to a project event, as one pure function. It lives
 * outside the components because a component that decides is a bug — and
 * because the rule worth testing is the one a component cannot be asked about:
 * **an event for another project changes nothing here.** Main only broadcasts
 * to the windows on a project, so this is a second line, not the only one.
 */

import type { ProjectEvent, ProjectSnapshot } from '@shared/api.js'
export const applyProjectEvent = (snapshot: ProjectSnapshot, event: ProjectEvent): ProjectSnapshot => {
  if (event.dir !== snapshot.dir) return snapshot
  switch (event.kind) {
    case 'files':
      return { ...snapshot, files: event.files }
    case 'accent':
      return { ...snapshot, hue: event.hue }
    // A content change does not change the snapshot: the open file re-reads.
    case 'file':
      return snapshot
  }
}
