#!/usr/bin/env bash
# Mutation check for tests/apple-intelligence-genmoji.test.js
#
# Each mutation is a one-line change that breaks a property the suite claims to
# protect. A mutation that leaves the suite green is a hole in the tests, not a
# pass. Every mutation is reverted immediately after it is measured.
set -u

cd "$(dirname "$0")/.." || exit 1

SUITE="tests/apple-intelligence-genmoji.test.js"
LOG="docs-audit/mutation-check-apple-intelligence-genmoji.txt"

LIB="src/lib/apple-intelligence.js"
SWIFT="src/lib/apple-intelligence.swift"
PRELOAD="preload.js"
VIEW="view_preload.js"

killed=0
survived=0

# apply.js <file> <old> <new>
apply() {
  node scripts/mutate-once.js "$1" "$2" "$3"
}

run_suite() { npx jest "$SUITE" 2>&1 | grep -E "^Tests:"; }

# mutate <label> <file> <old> <new>
mutate() {
  local label="$1" file="$2" old="$3" new="$4"
  cp "$file" "$file.mutbak"

  if ! apply "$file" "$old" "$new"; then
    echo "MUTATION SETUP FAILED: $label"
    mv "$file.mutbak" "$file"
    survived=$((survived + 1))
    return
  fi

  if cmp -s "$file" "$file.mutbak"; then
    echo "MUTATION DID NOT APPLY (pattern absent): $label"
    mv "$file.mutbak" "$file"
    survived=$((survived + 1))
    return
  fi

  local out
  out="$(run_suite)"
  echo "  $out"
  if printf '%s' "$out" | grep -q 'failed'; then
    echo "  KILLED:   $label"
    killed=$((killed + 1))
  else
    echo "  SURVIVED: $label   <-- the suite does not cover this"
    survived=$((survived + 1))
  fi
  mv "$file.mutbak" "$file"
}

{
  echo "# Mutation check — apple-intelligence-genmoji"
  echo
  echo "Captured: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "Baseline: $(git -C .. rev-parse --short HEAD)"
  echo "Suite:    $SUITE"
  echo
  echo "A mutation that leaves the suite green is a hole in the tests, not a pass."
  echo "Every mutation below is reverted immediately after it is measured, and the"
  echo "run aborts loudly if a mutation fails to apply rather than reporting a"
  echo "misleading pass."
  echo
  echo '## 1. Drop the non-macOS guard — Apple Intelligence on any platform'
  mutate "Apple Intelligence becomes reachable off macOS" \
    "$LIB" \
    "if (process.platform !== 'darwin') {" \
    "if (false) {"

  echo
  echo '## 2. Route genmoji through the image command'
  mutate "generateGenmoji sends command: image" \
    "$LIB" \
    "runAppleIntelligenceCommand('genmoji', { prompt })" \
    "runAppleIntelligenceCommand('image', { prompt })"

  echo
  echo '## 3. Remove the genmoji arm from the Swift helper'
  mutate "helper stops handling genmoji" \
    "$SWIFT" \
    'case "genmoji":' \
    'case "genmojiDisabled":'

  echo
  echo '## 4. Rename the IPC channel in preload only'
  mutate "preload and main disagree on the channel name" \
    "$PRELOAD" \
    "ipcRenderer.invoke('apple-intelligence-genmoji'" \
    "ipcRenderer.invoke('apple-intelligence-emoji'"

  echo
  echo '## 5. Lower the Genmoji OS floor from 15.4 to 15.0'
  mutate "helper would run genmoji on an OS it cannot support" \
    "$SWIFT" \
    'if #available(macOS 15.4, *) {
                    do {
                        let path = try await generateGenmoji(prompt)' \
    'if #available(macOS 15.0, *) {
                    do {
                        let path = try await generateGenmoji(prompt)'

  echo
  echo '## 6. Hand the helper a shell instead of piping JSON'
  mutate "helper is spawned through a shell" \
    "$LIB" \
    "const child = spawn(binary, [], {" \
    "const child = spawn(binary, [], { shell: true,"

  echo
  echo '## 7. Expose generateGenmoji to remote web pages'
  mutate "view_preload.js gains an Apple Intelligence entry point" \
    "$VIEW" \
    "const { contextBridge, ipcRenderer } = require('electron');" \
    "const { contextBridge, ipcRenderer } = require('electron');
const generateGenmoji = (p) => ipcRenderer.invoke('apple-intelligence-genmoji', p);"

  echo
  echo "## Result"
  echo
  echo "killed:   $killed"
  echo "survived: $survived"
  echo
  if [ "$survived" -eq 0 ]; then
    echo "Every mutation was detected."
  else
    echo "At least one mutation survived. Fix the suite before relying on it."
  fi
} | tee "$LOG"

exit "$survived"
