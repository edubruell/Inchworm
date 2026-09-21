/**
 * The one write that leaves the project: a zip of the wiki, somewhere the
 * reader chose.
 *
 * Two rules hold it inside the app's containment story. Every file **read**
 * goes through `readWikiBytes`, so the same four checks that guard the editor
 * guard the bundle, and a plan is a list of project-relative paths that `core`
 * produced from the schema — never a directory walk of this module's own. The
 * **destination** comes from a native save dialog, injected here as a function,
 * so no path the renderer sends can ever become a write target.
 *
 * The bytes are copied, not re-encoded. `readWikiBytes` rather than
 * `readWikiFile` for exactly that reason: a utf-8 round trip through a string
 * turns a malformed byte into U+FFFD, and the app does not rewrite bytes the
 * reader did not type — not even on the way out.
 */

import { rename, rm, writeFile } from 'node:fs/promises'
import { strToU8, zipSync, type Zippable } from 'fflate'
import { MANIFEST_FILE, bundleStem, exportPlan, manifest } from '@core/export.js'
import { err, ok } from '@core/result.js'
import type { ExportError, ExportResult, ExportScope, Layout, Wire } from '@shared/api.js'
import { readWikiBytes } from './files.js'
import { detailOf, tempPathFor } from './io.js'

/**
 * The native save dialog. Injected rather than imported: this module never
 * names Electron, which is what lets the containment rules above be tested in
 * plain node.
 *
 * It answers with the absolute path the reader chose, or `undefined` if they
 * closed the dialog. `windowId` is the window that asked, so the panel can hang
 * off it: two windows exporting two projects otherwise put up two panels that
 * differ only in a suggested filename.
 */
export type SaveDialog = (suggestedName: string, windowId: number | undefined) => Promise<string | undefined>

/**
 * Written beside the destination and renamed over it, for the same reason
 * `files.ts:writeAtomic` exists: `writeFile` truncates first, so a write that
 * fails part-way — a full disk, an ejected volume, a dropped network mount —
 * would destroy whatever bundle was already there and leave an unopenable stub
 * in its place, under a message that reads as "nothing happened".
 */
const writeAtomic = async (destination: string, bytes: Uint8Array): Promise<void> => {
  const temporary = tempPathFor(destination)
  try {
    await writeFile(temporary, bytes)
    await rename(temporary, destination)
  } catch (error: unknown) {
    await rm(temporary, { force: true })
    throw error
  }
}

export type ExportRequest = {
  readonly dir: string
  /** The project's name, which becomes the bundle's — `core.bundleStem` slugs it. */
  readonly name: string
  readonly layout: Layout
  /** The project's whole file list; the scope decides which of them go in. */
  readonly files: readonly string[]
  readonly scope: ExportScope
  /** The local day, `YYYY-MM-DD`, as the filename and the manifest carry it. */
  readonly date: string
  /** The window that asked, so the save panel hangs off it rather than floating. */
  readonly windowId: number | undefined
}

type Packed = { readonly path: string; readonly bytes: Uint8Array; readonly mtime: number }

/**
 * A zip's timestamp field cannot represent a date outside 1980–2099, and
 * `zipSync` **throws** rather than clamping. A note restored from a tarball, or
 * touched by a sync tool that lost its date, carries an epoch mtime often
 * enough — and one of those would otherwise fail the whole bundle, reported as
 * `unwritable`, which blames a destination that was fine.
 *
 * The bounds are built with the local-time constructor because fflate reads the
 * year off a local `Date`, and they are a day inside the range so no timezone
 * lands a boundary value on the wrong side of it.
 */
const ZIP_FIRST = new Date(1980, 0, 2).getTime()
const ZIP_LAST = new Date(2099, 11, 30).getTime()

export const zipTime = (mtimeMs: number): number =>
  Number.isFinite(mtimeMs) ? Math.min(Math.max(mtimeMs, ZIP_FIRST), ZIP_LAST) : ZIP_FIRST

/**
 * One folder inside the zip, named after the bundle, so unzipping in a
 * downloads directory lands a single item rather than spraying `local_context/`
 * into whatever the reader happened to be standing in. Each file carries its
 * own mtime — clamped to what a zip can hold — so the bundle says when a note
 * was last touched rather than when it was packed.
 */
const zipEntries = (stem: string, note: string, files: readonly Packed[]): Zippable => {
  // A local accumulator that does not escape (wiki 06_coding_style rule 7):
  // `Object.fromEntries` over a mixed list answers `any`, and an untyped map of
  // paths to bytes is the one thing this function exists to get right.
  const entries: Zippable = { [`${stem}/${MANIFEST_FILE}`]: strToU8(note) }
  for (const file of files) entries[`${stem}/${file.path}`] = [file.bytes, { mtime: zipTime(file.mtime) }]
  return entries
}

/**
 * Plan, ask, read, zip, write — in that order, and the order is the design.
 * The plan comes first so an empty scope is refused before a dialog opens, and
 * the dialog comes before the reads so a cancelled export costs nothing.
 */
export const exportWiki = async (
  request: ExportRequest,
  save: SaveDialog,
): Promise<Wire<ExportResult, ExportError>> => {
  const paths = exportPlan(request.files, request.layout, request.scope)
  if (paths.length === 0) return err({ kind: 'empty' })

  const stem = bundleStem(request.name, request.scope, request.date)
  const destination = await save(`${stem}.zip`, request.windowId)
  // A closed dialog is an outcome, not a failure: the reader changed their mind.
  if (destination === undefined) return ok({ kind: 'cancelled' })

  const read = await Promise.all(
    paths.map(async (path) => ({ path, file: await readWikiBytes(request.dir, request.layout, path) })),
  )
  const failed = read.find((entry) => !entry.file.ok)
  // Named, because "unreadable" over a wiki of forty files is not a report.
  if (failed !== undefined && !failed.file.ok) {
    return err({ kind: 'unreadable', detail: `${failed.path} (${failed.file.error.kind})` })
  }
  const packed = read.flatMap((entry): readonly Packed[] =>
    entry.file.ok ? [{ path: entry.path, bytes: entry.file.value.bytes, mtime: entry.file.value.mtimeMs }] : [],
  )

  const note = manifest({
    project: request.name,
    scope: request.scope,
    date: request.date,
    layout: request.layout,
    paths,
  })
  // Two `try`s, because they are two different failures to the reader. A zip
  // that cannot be built says nothing about the destination they chose, and
  // reporting it as `unwritable` sent them to look at the wrong thing.
  let bytes: Uint8Array
  try {
    bytes = zipSync(zipEntries(stem, note, packed))
  } catch (error: unknown) {
    return err({ kind: 'unpackable', detail: detailOf(error) })
  }
  try {
    await writeAtomic(destination, bytes)
    return ok({ kind: 'saved', path: destination, files: paths.length, bytes: bytes.byteLength })
  } catch (error: unknown) {
    return err({ kind: 'unwritable', detail: detailOf(error) })
  }
}
