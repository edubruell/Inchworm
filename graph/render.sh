#!/usr/bin/env bash
# Render data_flow.d2 -> SVG -> PNG.
# PNG goes through headless Chrome (not Inkscape) because D2 markdown labels
# become SVG <foreignObject>/HTML, which only a browser rasterizes correctly.
set -euo pipefail
cd "$(dirname "$0")"

SRC="${1:-data_flow.d2}"
BASE="${SRC%.d2}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Wider layer spacing than the screening agent's diagrams need: these views
# carry a sentence on almost every edge, and at the default 70/40 ELK routes
# those labels straight through the boxes of the next band.
d2 --layout elk --theme 0 --pad 60 \
   --elk-nodeNodeBetweenLayers 190 --elk-edgeNodeBetweenLayers 110 \
   "$SRC" "$BASE.svg"

# ---- label-box relief (only for the *_fs.d2 full-screen diagrams) -----------
# D2 sizes each markdown label's <foreignObject> from its OWN text measurement,
# which under-estimates lines containing glyphs outside its metric tables
# (✎ ✉ 🗄 📎 🤖 …). Chrome then renders the line wider than the box, re-wraps it,
# and — since a foreignObject clips its content — silently eats the overflowing
# last line. So: forbid wrapping (the author's <br/> already sets every break)
# and let the box not clip. No repositioning: the box is centred inside its card
# already, and nudging it risks pushing a near-card-width label off the canvas.
# Restricted to *_fs.d2 because in the older diagrams the label box IS the
# visible coloured card, so touching it would change the look.
case "$BASE" in
  *_fs)
    python3 - "$BASE.svg" <<'PY'
import re, sys

path = sys.argv[1]
svg = open(path).read()

pat = re.compile(
    r'<foreignObject requiredFeatures="(?P<feat>[^"]*)" '
    r'x="(?P<x>[-\d.]+)" y="(?P<y>[-\d.]+)" '
    r'width="(?P<w>[\d.]+)" height="(?P<h>[\d.]+)">')

def unclip(m):
    return (f'<foreignObject requiredFeatures="{m.group("feat")}" overflow="visible" '
            f'x="{m.group("x")}" y="{m.group("y")}" '
            f'width="{m.group("w")}" height="{m.group("h")}">')

svg, n = pat.subn(unclip, svg)
svg, k = re.subn(r'(<div xmlns="[^"]*" class="md[^"]*" style=")',
                 r'\1white-space:nowrap;', svg)
open(path, "w").write(svg)
print(f"  label boxes un-clipped: {n} (nowrap: {k})")
PY
    ;;
esac

DIM=$(grep -oE 'width="[0-9]+" height="[0-9]+"' "$BASE.svg" | head -1 \
      | grep -oE '[0-9]+' | tr '\n' ',' | sed 's/,$//')

printf '%s\n' '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}img{display:block}</style></head><body><img src="'"$BASE"'.svg"></body></html>' > _wrap.html

"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size="$DIM" \
  --default-background-color=FFFFFFFF \
  --screenshot="$BASE.png" "file://$PWD/_wrap.html" >/dev/null 2>&1

rm -f _wrap.html
echo "Rendered $BASE.png ($(file -b "$BASE.png"))"
