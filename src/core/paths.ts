/**
 * Path arithmetic for `core`, which may not import `node:path` — it is pure by
 * construction. Paths here are always
 * **project-relative and `/`-separated**; main resolves and containment-checks
 * absolute paths before anything reaches this layer.
 */

/** Everything after the last `/`. */
export const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** The file name without its extension: `wiki/01_scope.md` → `01_scope`. */
export const stem = (path: string): string => {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? name : name.slice(0, dot)
}

export const isMarkdown = (path: string): boolean => basename(path).toLowerCase().endsWith('.md')

/**
 * A directory as a comparable prefix: no leading `./`, exactly one trailing `/`.
 * The project root — `''`, `.` or `./`, which used to normalise to two different
 * things — is `''`, and `''` is not a usable prefix.
 */
export const asDirPrefix = (dir: string): string => {
  const trimmed = dir.replace(/^(?:\.\/+)+/, '').replace(/\/+$/, '')
  return trimmed === '' || trimmed === '.' ? '' : `${trimmed}/`
}

/**
 * True when `path` is inside `dir` (at any depth). A directory is not inside
 * itself, and **nothing is inside the empty prefix**: a containment primitive
 * that answers "yes" to "is this inside no directory?" is an allow-all hiding
 * in the one module whose job is to say no.
 */
export const isInside = (path: string, dir: string): boolean => {
  const prefix = asDirPrefix(dir)
  return prefix !== '' && path.startsWith(prefix)
}

/**
 * True when `path` is under a **layout root**, where `''` means the project root
 * and therefore contains everything. Deliberately a second function: `isInside`
 * is the containment check and must never read "no directory" as "everything",
 * but a layout root of `''` is a real, if unusual, project shape.
 */
export const isUnder = (path: string, dir: string): boolean => asDirPrefix(dir) === '' || isInside(path, dir)

/** The part of `path` below `dir`; `path` itself when it is not inside `dir`. */
export const relativeTo = (path: string, dir: string): string => {
  const prefix = asDirPrefix(dir)
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

/**
 * The number of lines a reader sees — the unit the schema's caps are written
 * in, so an off-by-one here is an off-by-one in every cap badge. A file ending
 * in a newline does not count a phantom last line; a file whose last line is
 * unterminated still counts it. This is deliberately **not** `wc -l`, which
 * counts newline characters and so reports 0 for a one-line unterminated file.
 */
export const countLines = (text: string): number => {
  if (text === '') return 0
  const newlines = text.split('\n').length - 1
  return text.endsWith('\n') ? newlines : newlines + 1
}

/**
 * The directory a path sits in, without its trailing slash: an absolute
 * project directory's *parent*, which is what a picker row shows under the
 * project's name. A path with no `/` (and the root itself) has no parent, and
 * says so with `''` rather than with a slash that means "the root".
 */
export const parentDir = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '')
  const cut = trimmed.lastIndexOf('/')
  return cut <= 0 ? '' : trimmed.slice(0, cut)
}
