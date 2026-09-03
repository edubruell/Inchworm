/**
 * Link safety. A note is untrusted input — an agent writes these files — so a
 * link in rendered markdown may name any scheme the OS knows how to open:
 * `file:` launches an application, `smb:` triggers an authentication attempt,
 * a registered custom scheme hands control to whatever claims it.
 *
 * Only web links leave the app. This lives in `core` so it is testable without
 * Electron and so the decision has exactly one home.
 */

const OPENABLE_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * The URL that is safe to hand to the user's browser, or `undefined`. It returns
 * the *parsed* href rather than a yes/no, because the caller must open what was
 * validated: the URL parser strips control characters, so a raw
 * `https://a\nhttp://b` passes the check and is a different string by the time
 * it reaches the OS.
 */
export const externalUrl = (raw: string): string | undefined => {
  try {
    const url = new URL(raw)
    return OPENABLE_PROTOCOLS.has(url.protocol) ? url.href : undefined
  } catch {
    // Not a parseable absolute URL — nothing to open.
    return undefined
  }
}
