# graph — the re-immersion pass's dataflow views

Three flows, drawn from a **comment-stripped** copy of `src/` by an agent with
no access to this wiki, then checked against it (`11_reimmersion_pass`, run 1,
2026-09-02): a **save**, an **open**, and the **child processes** the app starts.

`./render.sh save.d2` → `save.svg` → `save.png`. D2 through elk, PNG through
headless Chrome because D2's markdown labels are `<foreignObject>` HTML that
only a browser rasterizes correctly. The layer spacing is wider than the
convention's default: these views carry a sentence on almost every edge.

**Hues here mean processes, and nothing else.** They are not `--accent-*` or
`--status-*`, which have fixed meanings in the app (`04_ui_layout`).

Keep them. The next pass diffs against these rather than starting over — that
diff is the only picture of how the codebase grew.
