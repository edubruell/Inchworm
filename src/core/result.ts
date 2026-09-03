/**
 * The single failure vocabulary for the app: anything that can fail returns a
 * `Result`, never `null` and never a thrown error. `throw` is reserved for
 * broken invariants (programmer error), not for a file that isn't there.
 *
 * Two constructors and a union, and nothing else. The usual combinators
 * (`mapOk`, `andThen`, `allOk`, …) are absent because nothing here wanted them:
 * narrowing on `r.ok` reads better than a predicate, and an unused abstraction
 * is a thing to keep in step for no one.
 */

export type Ok<T> = { readonly ok: true; readonly value: T }
export type Err<E> = { readonly ok: false; readonly error: E }
export type Result<T, E> = Ok<T> | Err<E>

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
export const err = <E>(error: E): Err<E> => ({ ok: false, error })
