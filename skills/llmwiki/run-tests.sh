#!/usr/bin/env bash
# Fixture tests for wiki-sweepcheck.py. Every case is a real failure mode found
# in the 2026-08-25 audit of five live wikis. Run from this directory.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
CHK="python3 wiki-sweepcheck.py"
export LLMWIKI_SWEEP_WINDOW_DAYS=99999   # date-stable: fixtures never age out
# The fixtures are dated absolutely and the suite reads the clock ~40 times, so
# a run started near midnight could answer one case as yesterday and the next as
# today (one unreproduced 95/1 at the 2026-09-01 rollover). Pin the day instead.
export LLMWIKI_TODAY=2026-09-03           # arbitrary, and after every fixture date
pass=0; fail=0
ok()   { pass=$((pass+1)); printf "  ok   %s\n" "$1"; }
bad()  { fail=$((fail+1)); printf "  FAIL %s\n     %s\n" "$1" "$2"; }
has()  { grep -qF -- "$2" <<<"$1" && ok "$3" || bad "$3" "missing: $2"; }
hasnt(){ grep -qF -- "$2" <<<"$1" && bad "$3" "unexpected: $2" || ok "$3"; }

echo "debtproj — a register with real debt"
out=$($CHK testwiki/debtproj); rc=$?
[ $rc -eq 1 ] && ok "exits 1 on debt" || bad "exits 1 on debt" "got rc=$rc"
has "$out" "SWEEP DEBT — 3 unswept links"        "exactly 3 debt links"
has "$out" "#never_stamped"                       "anchored entry with no stamp is debt"
has "$out" "#also_never_stamped"                  "wrapped Affects clause keeps later targets"
has "$out" "#too_old"                             "stamp older than the entry is debt"
hasnt "$out" "#config_load"                       "matching stamp passes"
hasnt "$out" "#RETRY_CAP"                         "same-day stamp passes"
hasnt "$out" "#retry_cap "                        "anchor match is case-insensitive"
hasnt "$out" "umlaut"                             "non-ASCII anchor passes"
hasnt "$out" "moved_home"                         "target resolved inside archive/"
hasnt "$out" "#ancient"                           "entry on/before the cutoff is skipped"
hasnt "$out" "#undated"                           "undated entry is skipped"
hasnt "$out" "#range_child"                       "date-range header dates nothing"
hasnt "$out" "malformed"                          "'Affects: none' is silent, not malformed"
hasnt "$out" "contentions"                        "cross-ref to a register is not a sweep"
has "$out" "09_future#not_yet]] (deferred)"       "(pending: why) defers instead of failing"
has "$out" "1 entry names a note without an #anchor" "unanchored is a warning, not debt"
grep -q "05_utils.md#never_stamped" <<<"$out" && grep -c "findings.md:8" <<<"$out" | grep -q '^1$' \
  && ok "duplicate links on one entry are reported once" || bad "dup collapse" "see output"

echo "cleanproj — no cutoff line: the derived cutoff must not fire on old entries"
out=$($CHK testwiki/cleanproj); rc=$?
[ $rc -eq 0 ] && ok "exits 0 when clean" || bad "exits 0 when clean" "got rc=$rc"
has "$out" "clean (cutoff"                        "reports clean"
has "$out" "derived"                              "cutoff is derived without a CLAUDE.md edit"

echo "robustness"
out=$(LLMWIKI_SWEEP_WINDOW_DAYS=abc $CHK testwiki/cleanproj 2>&1); rc=$?
[ $rc -eq 0 ] && ok "bad env var does not crash" || bad "bad env var" "rc=$rc: $out"
out=$(LLMWIKI_SWEEP_WINDOW_DAYS=-5 $CHK testwiki/debtproj 2>&1); rc=$?
[ $rc -eq 1 ] && ok "negative window cannot disable the gate" || bad "negative window" "rc=$rc"
out=$(echo '{}' | $CHK --hook 2>&1); rc=$?
[ $rc -eq 0 ] && [ -z "$out" ] && ok "--hook with no cwd is silent, exit 0" || bad "--hook empty" "rc=$rc out=$out"
out=$(echo 'not json' | $CHK --hook 2>&1); rc=$?
[ $rc -eq 0 ] && ok "--hook survives malformed stdin" || bad "--hook malformed" "rc=$rc"
out=$(printf '{"cwd":"%s/testwiki/debtproj/wiki/archive"}' "$PWD" | $CHK --hook 2>&1); rc=$?
[ $rc -eq 0 ] && ok "--hook exits 0 even with debt" || bad "--hook rc" "rc=$rc"
has "$out" "sweep debt left by an earlier session" "hook finds the project root from a deep cwd"
out=$(cd testwiki/debtproj/wiki && python3 "$OLDPWD/wiki-sweepcheck.py" 2>&1); rc=$?
[ $rc -eq 1 ] && ok "CLI walks up to the project root from a subdir" || bad "cwd walk-up" "rc=$rc"
out=$(mkdir -p /tmp/llmwiki-empty && $CHK /tmp/llmwiki-empty 2>&1); rc=$?
[ $rc -eq 0 ] && ok "non-wiki project exits 0" || bad "non-wiki" "rc=$rc"

echo "--json — records for a caller that must not regex a report"
out=$($CHK --json testwiki/debtproj); rc=$?
[ $rc -eq 1 ] && ok "--json keeps the debt exit code" || bad "json rc" "rc=$rc"
python3 -c "import json,sys; json.loads(sys.stdin.read())" <<<"$out" \
  && ok "--json emits one object and nothing else" || bad "json parse" "$out"
python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
assert len(d["debt"])==3, d["debt"]
r=[x for x in d["debt"] if x["anchor"]=="never_stamped"][0]
assert r["register"]=="findings.md" and isinstance(r["line"],int) and r["note"]=="05_utils.md", r
assert d["clean"] is False and d["stale_count"]==0, d
assert len(d["pending"])==1 and d["pending"][0]["anchor"]=="not_yet", d["pending"]
assert len(d["unanchored"])==1, d["unanchored"]
' <<<"$out" && ok "debt records carry register, line and anchor as fields" || bad "json debt shape" "$out"
out=$($CHK --json testwiki/cleanproj); rc=$?
[ $rc -eq 0 ] && ok "--json exits 0 when clean" || bad "json clean rc" "rc=$rc"
python3 -c "import json,sys; d=json.loads(sys.stdin.read()); sys.exit(0 if d['clean'] and not d['debt'] else 1)" <<<"$out"   && ok "a clean project reports clean:true with empty lists" || bad "json clean shape" "$out"
out=$($CHK --json /tmp/llmwiki-empty); rc=$?
python3 -c "import json,sys; d=json.loads(sys.stdin.read()); sys.exit(0 if d['wiki'] is None and d['note'] else 1)" <<<"$out"   && ok "a non-wiki project is JSON too, never a bare prose line" || bad "json non-wiki" "$out"
out=$(echo '{}' | $CHK --hook --json 2>&1)
[ -z "$out" ] && ok "--hook wins over --json: a SessionStart never emits JSON" || bad "hook+json" "$out"

echo "contentionproj — ripeness across the five field spellings"
# Date-stable: staleness off, so only condition/evidence rules can fire.
out=$(LLMWIKI_CONTENTION_STALE_DAYS=99999 python3 wiki-contentions.py testwiki/contentionproj)
ripe() { grep -qE "^RIPE  $1 " <<<"$out"; }
ripe C1 && ok "condition met by a later ruling is ripe"      || bad "C1 ripe" "$out"
ripe C3 && ok "unfalsifiable condition is ripe"              || bad "C3 ripe" "$out"
ripe C5 && ok "no resolve-condition at all is ripe"          || bad "C5 ripe" "$out"
ripe C7 && ok "marked resolved but still listed is ripe"     || bad "C7 ripe" "$out"
ripe C8 && bad "C8 ripe" "the lifecycle's own end state — resolved WITH its archive pointer — must not be nagged; that asks the wiki to delete the index the lifecycle exists to keep" || ok "resolved + archive pointer is closed, not debt"
ripe C2 && bad "C2 not ripe" "roll-call line counted as evidence" || ok "roll-call naming many ids is not evidence"
ripe C4 && bad "C4 not ripe" "$out"                          || ok "a fourth spelling with no news stays open"
ripe C6 && bad "C6 not ripe" "$out"                          || ok "parked with an unpark condition stays parked"
has "$out" "What resolves it:" "reads a non-canonical field spelling"
has "$out" "Test:"             "reads the 'Test:' spelling"
ripe C2 && bad "status-quo line" "a 'stays open' receipt counted as evidence" || ok "a 'stays open' receipt is not evidence"
out2=$(LLMWIKI_CONTENTION_STALE_DAYS=1 python3 wiki-contentions.py testwiki/contentionproj)
grep -qE "^RIPE  C2 " <<<"$out2" && ok "staleness alone makes an entry ripe" || bad "C2 stale" "$out2"
out3=$(LLMWIKI_CONTENTION_STALE_DAYS=99999 python3 wiki-contentions.py --json testwiki/contentionproj)
python3 -c "import json,sys; d=json.loads(sys.stdin.read()); sys.exit(0 if len(d['contentions'])==8 else 1)" <<<"$out3" \
  && ok "--json returns every entry, table rows excluded" || bad "json shape" "$out3"

echo "overdue — quiet unless something is genuinely overdue"
export LLMWIKI_JOURNAL_DAYS=99999 LLMWIKI_LINT_DAYS=99999 LLMWIKI_JOURNAL_SESSIONS=2 LLMWIKI_LINT_SESSIONS=99999
rm -rf "$HOME/.claude/sessions/$(python3 -c "import hashlib,sys;print(hashlib.md5(sys.argv[1].encode()).hexdigest()[:8])" "$PWD/testwiki/contentionproj")" 2>/dev/null
out=$(python3 wiki-overdue.py testwiki/contentionproj)
hasnt "$out" "no journal entry since" "first session does not nag about the journal"
python3 wiki-overdue.py testwiki/contentionproj >/dev/null
out=$(python3 wiki-overdue.py testwiki/contentionproj)
has "$out" "no journal entry since" "nags once the session count passes the threshold"
touch testwiki/contentionproj/journal/2026-08-24_second-entry.md
out=$(python3 wiki-overdue.py testwiki/contentionproj)
hasnt "$out" "no journal entry since" "a second entry on the same day resets the counter"
rm -f testwiki/contentionproj/journal/2026-08-24_second-entry.md
out=$(LLMWIKI_JOURNAL_SESSIONS=99999 python3 wiki-overdue.py testwiki/cleanproj)
has "$out" "no lint verdict on record" "a wiki that never linted is reported"
out=$(printf '{"cwd":"%s/testwiki/contentionproj/wiki"}' "$PWD" | python3 wiki-overdue.py --hook); rc=$?
[ $rc -eq 0 ] && ok "overdue --hook exits 0" || bad "overdue hook rc" "rc=$rc"
has "$out" "contention" "hook finds the project root from a deep cwd"
out=$(echo '{}' | python3 wiki-overdue.py --hook 2>&1); rc=$?
[ $rc -eq 0 ] && [ -z "$out" ] && ok "overdue --hook with no cwd is silent" || bad "overdue empty" "rc=$rc out=$out"
out=$(LLMWIKI_JOURNAL_SESSIONS=abc python3 wiki-overdue.py testwiki/cleanproj 2>&1); rc=$?
[ $rc -eq 0 ] && ok "overdue survives a bad env var" || bad "overdue env" "rc=$rc $out"

# The counter is the point: a GUI polling --json must not spend the count the
# next SessionStart is meant to make.
out=$(python3 wiki-overdue.py --json testwiki/contentionproj)
python3 -c "import json,sys; d=json.loads(sys.stdin.read()); sys.exit(0 if d['newest_journal'] and isinstance(d['journal_sessions'],int) and 'thresholds' in d else 1)" <<<"$out" \
  && ok "overdue --json emits facts, not a formatted report" || bad "overdue json shape" "$out"
before=$(python3 -c "import json,sys; print(json.loads(sys.stdin.read())['journal_sessions'])" <<<"$out")
python3 wiki-overdue.py --json testwiki/contentionproj >/dev/null
python3 wiki-overdue.py --json testwiki/contentionproj >/dev/null
after=$(python3 wiki-overdue.py --json testwiki/contentionproj | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['journal_sessions'])")
[ "$before" = "$after" ] && ok "--json is read-only: three calls do not advance the session count" \
  || bad "json bumps the counter" "before=$before after=$after"
python3 wiki-overdue.py testwiki/contentionproj >/dev/null
bumped=$(python3 wiki-overdue.py --json testwiki/contentionproj | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['journal_sessions'])")
[ "$bumped" -gt "$after" ] && ok "a real session still advances it" || bad "no bump on a real run" "after=$after bumped=$bumped"
out=$(echo '{}' | python3 wiki-overdue.py --hook --json 2>&1)
[ -z "$out" ] && ok "overdue --hook wins over --json" || bad "overdue hook+json" "$out"

unset LLMWIKI_JOURNAL_DAYS LLMWIKI_LINT_DAYS LLMWIKI_JOURNAL_SESSIONS LLMWIKI_LINT_SESSIONS

echo "triggerproj — custom triggers: the three debt kinds, the cutoff, the grammar"
TRG="python3 wiki-trigger.py"
out=$($TRG testwiki/triggerproj); rc=$?
[ $rc -eq 1 ] && ok "exits 1 on trigger debt" || bad "trigger rc" "got rc=$rc"
has "$out" "UNSWEPT   payload/incoming/20260812b"   "a marker file still marked is unswept"
has "$out" "UNSWEPT   payload/incoming/20260813legacy" "the legacy <-- unswept --> spelling still counts"
has "$out" "UNFILED   payload/incoming/20260814c"   "an artefact with no marker file is unfiled"
has "$out" "UNFILED   payload/incoming/nodate_scratch" "an undated leaf is checked, never silently skipped"
has "$out" "UNLINKED  payload/outgoing/20260813b"   "a mention that is itself unswept is not a write-up"
has "$out" "UNLINKED  payload/outgoing/20260815c"   "an artefact named nowhere is unlinked"
has "$out" "UNLINKED  exports/2026-08-17_hours.csv" "a single file, not only a directory, can be an artefact"
hasnt "$out" "20260810a"                            "a marker file with no marker passes"
hasnt "$out" "20260811a"                            "a clean mention in the wiki passes"
hasnt "$out" "2026-08-16_wages.csv"                 "a mention in the journal counts as written up"
hasnt "$out" "UNSWEPT   payload/incoming/20260715z" "an artefact on/before the cutoff is backlog, not debt"
has "$out" "predate the 2026-08-01 cutoff"          "the backlog is counted in one line"

out=$($TRG --json testwiki/triggerproj); rc=$?
[ $rc -eq 1 ] && ok "--json keeps the debt exit code" || bad "trigger json rc" "rc=$rc"
python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
assert d["clean"] is False and d["stale"]==1, d["stale"]
kinds=sorted(set(i["kind"] for i in d["open"]))
assert kinds==["unfiled","unlinked","unswept"], kinds
r=[i for i in d["open"] if i["path"].rstrip("/").endswith("20260812b")][0]
assert r["trigger"]=="payload-in" and r["date"]=="2026-08-12", r
assert len(d["triggers"])==3 and all("marker_file" in t for t in d["triggers"]), d["triggers"]
' <<<"$out" && ok "--json emits records with trigger, kind and date" || bad "trigger json shape" "$out"

out=$(printf '{"cwd":"%s/testwiki/triggerproj/payload/incoming"}' "$PWD" | $TRG --hook); rc=$?
[ $rc -eq 0 ] && ok "trigger --hook exits 0 even with debt" || bad "trigger hook rc" "rc=$rc"
has "$out" "landed and not written up yet" "the hook finds the project root from a deep cwd"
out=$(echo '{}' | $TRG --hook 2>&1); rc=$?
[ $rc -eq 0 ] && [ -z "$out" ] && ok "trigger --hook with no cwd is silent" || bad "trigger hook empty" "rc=$rc out=$out"
out=$(echo '{}' | $TRG --hook --json 2>&1)
[ -z "$out" ] && ok "trigger --hook wins over --json" || bad "trigger hook+json" "$out"

# --mark: the affordance for a project whose producer is a human and a drag.
MK=testwiki/triggerproj/payload/incoming/20260821mark
rm -rf $MK; mkdir -p $MK
out=$($TRG --mark $MK); rc=$?
[ $rc -eq 0 ] && ok "--mark arms an artefact" || bad "mark rc" "rc=$rc"
has "$out" "unswept: payload-in 20260821mark" "the marker names the trigger whose glob matched"
grep -qF "<!-- unswept: payload-in 20260821mark -->" $MK/RETURN.txt \
  && ok "--mark writes the marker file the trigger declared" || bad "mark file" "$(cat $MK/RETURN.txt 2>&1)"
# Not a pipeline: pipefail would surface the checker's own exit 1 as failure.
seen=$($TRG testwiki/triggerproj)
has "$seen" "UNSWEPT   payload/incoming/20260821mark" "and the checker reports it on the next run"
printf 'the machine half\n' > $MK/RETURN.txt
$TRG --mark $MK >/dev/null
grep -qF "the machine half" $MK/RETURN.txt \
  && ok "--mark appends, never overwrites what a producer already wrote" || bad "mark clobbered" "$(cat $MK/RETURN.txt)"
out=$($TRG --mark $MK)
has "$out" "already marked" "--mark is idempotent"
rm -rf $MK

# An undated leaf takes its newest content's date, and is checked unconditionally
# only when even that is missing (10_custom_triggers#undated_leaf, 2026-08-27).
ND=testwiki/triggerproj/payload/incoming/nodate_backlog
rm -rf $ND; mkdir -p $ND
printf '<!-- unswept: payload-in nodate_backlog -->\n' > $ND/RETURN.txt
touch -t 202607150000 $ND/RETURN.txt
out=$($TRG testwiki/triggerproj)
hasnt "$out" "nodate_backlog" "an undated leaf whose newest file predates the cutoff is backlog"
has "$out" "predate the 2026-08-01 cutoff" "and it is counted with the rest of the backlog"
touch -t 202608260000 $ND/RETURN.txt
out=$($TRG testwiki/triggerproj)
has "$out" "UNSWEPT   payload/incoming/nodate_backlog" "an undated leaf with fresh content is debt"
rm -rf $ND
out=$($TRG testwiki/triggerproj)
has "$out" "UNFILED   payload/incoming/nodate_scratch" "an empty leaf has no date at all, so it stays checked"


out=$($TRG testwiki/cleanproj); rc=$?
[ $rc -eq 0 ] && ok "a project with no Trigger lines exits 0" || bad "no-trigger rc" "rc=$rc"
has "$out" "no Trigger lines" "and says so rather than reporting clean"

TMP=/tmp/llmwiki-badtrigger; rm -rf $TMP; mkdir -p $TMP/wiki
printf '## Project memory (llmwiki)\n- Wiki root: wiki/\n- Trigger: broken | only-two-fields\n- Trigger: n | g | sudo:rm\n' > $TMP/CLAUDE.md
out=$($TRG $TMP); rc=$?
has "$out" "malformed Trigger line" "a two-field Trigger line is a named problem"
has "$out" "unknown mode" "a mode that is not mention/marker: is refused, never run"
[ $rc -eq 0 ] && ok "a malformed declaration is not debt" || bad "bad decl rc" "rc=$rc"

# Several projects write the declared paths as inline code spans, which the
# other four hooks already accept; backticks are markup, not path.
TMP=/tmp/llmwiki-ticks; rm -rf $TMP; mkdir -p $TMP/wiki $TMP/notes
printf '## Project memory (llmwiki)\n- Wiki root: `wiki/`\n- Journal: `notes/`\n' > $TMP/CLAUDE.md
out=$($TRG $TMP); rc=$?
hasnt "$out" "declared wiki root does not exist" "a backticked Wiki root resolves like a bare one"
[ $rc -eq 0 ] && ok "and the hook exits 0" || bad "backtick rc" "rc=$rc"

echo "the pinned clock — a suite that straddles midnight is a gate with a hole in it"
PIN=/tmp/llmwiki-pinned; rm -rf $PIN; mkdir -p $PIN/wiki
printf '## Project memory (llmwiki)\n- Wiki root: wiki/\n' > $PIN/CLAUDE.md
rm -rf "$HOME/.claude/sessions/$(python3 -c "import hashlib,sys;print(hashlib.md5(sys.argv[1].encode()).hexdigest()[:8])" "$PIN")" 2>/dev/null
out=$($CHK --json $PIN)
python3 -c "import json,sys; sys.exit(0 if json.loads(sys.stdin.read())['cutoff']=='2026-09-03' else 1)" <<<"$out" \
  && ok "LLMWIKI_TODAY reaches the derived cutoff, so no case reads the wall clock" || bad "pin ignored" "$out"
rm -rf "$HOME/.claude/sessions/$(python3 -c "import hashlib,sys;print(hashlib.md5(sys.argv[1].encode()).hexdigest()[:8])" "$PIN")" 2>/dev/null
out=$(LLMWIKI_TODAY=not-a-date $CHK --json $PIN 2>&1); rc=$?
[ $rc -eq 0 ] && python3 -c "import json,sys,datetime as dt; sys.exit(0 if json.loads(sys.stdin.read())['cutoff']==dt.date.today().isoformat() else 1)" <<<"$out" \
  && ok "a malformed pin falls back to the clock rather than breaking a hook" || bad "bad pin" "rc=$rc $out"
out=$(LLMWIKI_TODAY=2026-09-03 python3 wiki-contentions.py --json testwiki/contentionproj)
python3 -c "import json,sys; d=json.loads(sys.stdin.read()); c=[x for x in d['contentions'] if x['id']=='C2'][0]; sys.exit(0 if c['age_days']==14 else 1)" <<<"$out" \
  && ok "and contentions age against it too: C2 is 14 days old, every run" || bad "contentions pin" "$out"
rm -rf $PIN

printf "\n%d passed, %d failed\n" "$pass" "$fail"
[ "$fail" -eq 0 ]
