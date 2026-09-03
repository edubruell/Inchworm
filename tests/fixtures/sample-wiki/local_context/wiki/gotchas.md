# gotchas — traps: data quirks, env, conventions

- A wikilink inside a code span is syntax, not a link: `[[04_storage]]` and
  `[[target|label]]` here must not be extracted, or the fixture reports two
  false unresolved links. (2026-08-18)
- A wikilink inside a fenced block is also syntax:

```md
See [[99_missing]] for the shape of a dangling pointer.
```

- Tabs, not spaces, separate the fields; an editor that trims trailing
  whitespace corrupts an empty last field. (2026-08-17)
