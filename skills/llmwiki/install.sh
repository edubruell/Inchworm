#!/usr/bin/env bash
# Install the vendored llmwiki skill + sweep-sentinel hook into ~/.claude.
# Backs up anything it replaces. Never edits settings.json — prints the snippet.
set -euo pipefail

src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skill_dir="${HOME}/.claude/skills/llmwiki"
hook_dir="${HOME}/.claude/hooks"
stamp="$(date +%Y%m%d-%H%M%S)"

backup() {
  [ -f "$1" ] || return 0
  cp "$1" "$1.bak-$stamp"
  echo "  backed up $1 -> $1.bak-$stamp"
}

mkdir -p "$skill_dir" "$hook_dir"

command -v python3 >/dev/null || { echo "python3 not found — the hook needs it."; exit 1; }
HOOKS=(wiki-sweepcheck.py wiki-contentions.py wiki-overdue.py wiki-trigger.py)
for h in "${HOOKS[@]}"; do
  python3 -m py_compile "$src/$h" || { echo "$h does not compile — refusing to install."; exit 1; }
done
if [ -x "$src/run-tests.sh" ]; then
  "$src/run-tests.sh" >/dev/null 2>&1 || { echo "fixture tests fail — refusing to install. Run ./run-tests.sh to see why."; exit 1; }
  echo "  fixture tests pass"
fi

echo "installing skill:"
backup "$skill_dir/SKILL.md"
cp "$src/SKILL.md" "$skill_dir/SKILL.md"
echo "  $skill_dir/SKILL.md"
for doc in MIGRATION.md RATIONALE.md; do
  cp "$src/$doc" "$skill_dir/$doc"          # SKILL.md points at these by name
  echo "  $skill_dir/$doc"
done

echo "installing hooks:"
for h in "${HOOKS[@]}"; do
  backup "$hook_dir/$h"
  cp "$src/$h" "$hook_dir/$h"
  chmod +x "$hook_dir/$h"
  echo "  $hook_dir/$h"
done

if python3 - "$HOME/.claude/settings.json" <<'PYCHK' 2>/dev/null; then
import json, sys
cfg = json.load(open(sys.argv[1]))
entries = cfg.get("hooks", {}).get("SessionStart", [])
cmds = [h.get("command", "") for e in entries for h in e.get("hooks", [])]
need = ("wiki-sweepcheck.py", "wiki-overdue.py", "wiki-trigger.py")
sys.exit(0 if all(any(n in c for c in cmds) for n in need) else 1)
PYCHK
  echo "settings.json: sweepcheck, overdue and trigger are wired into SessionStart."
else
  cat <<'SNIP'

settings.json is NOT edited by this script. Add the sweepcheck command to the
existing SessionStart entry that runs wiki-restore.py:

  { "type": "command", "command": "python3 ~/.claude/hooks/wiki-sweepcheck.py --hook" }
  { "type": "command", "command": "python3 ~/.claude/hooks/wiki-overdue.py --hook" }
  { "type": "command", "command": "python3 ~/.claude/hooks/wiki-trigger.py --hook" }

The sentinel needs no per-project opt-in: it records its own cutoff on first
run, so nothing already written counts as debt. A "Sweep cutoff: YYYY-MM-DD"
line in a project's CLAUDE.md pins that date explicitly. Same for the trigger
checker, which is silent in a project that declares no "Trigger:" line. See
MIGRATION.md (installed next to the skill).

Verify with:  python3 ~/.claude/hooks/wiki-sweepcheck.py <a project dir>
SNIP
fi
