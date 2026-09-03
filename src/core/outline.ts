/**
 * The outline rail: a flat heading list nested by depth. Deliberately total —
 * notes skip heading levels and start at `##`, and an outline that throws on a
 * real note is worse than one that indents oddly.
 */

export type Heading = {
  readonly depth: number
  readonly text: string
  readonly line: number
}

export type OutlineNode = {
  readonly heading: Heading
  readonly children: readonly OutlineNode[]
}

type MutableNode = { readonly heading: Heading; readonly children: MutableNode[] }

export const outline = (headings: readonly Heading[]): readonly OutlineNode[] => {
  const roots: MutableNode[] = []
  // The stack holds the ancestors of the next heading, shallowest first.
  const stack: MutableNode[] = []

  for (const heading of headings) {
    // `.at(-1)` rather than `stack[stack.length - 1] ?? …`: the fallback of an
    // indexed access here is unreachable, and an unreachable branch is a hole
    // in the coverage gate that no test can close.
    let top = stack.at(-1)
    while (top !== undefined && top.heading.depth >= heading.depth) {
      stack.pop()
      top = stack.at(-1)
    }
    const node: MutableNode = { heading, children: [] }
    const parent = stack.at(-1)
    if (parent === undefined) roots.push(node)
    else parent.children.push(node)
    stack.push(node)
  }

  return roots
}
