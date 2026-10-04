/**
 * mutate-once.js — one-shot first-occurrence string replacement, used by
 * scripts/mutation-check-genmoji.sh. Exits non-zero if the pattern is absent,
 * so a mutation that silently does nothing is reported rather than counted.
 *
 * usage: node .mutate.js <file> <old> <new>
 */
const fs = require('fs');

const [file, oldText, newText] = process.argv.slice(2);

if (!file || oldText === undefined) {
  console.error('usage: node .mutate.js <file> <old> <new>');
  process.exit(2);
}

const source = fs.readFileSync(file, 'utf8');
const at = source.indexOf(oldText);

if (at === -1) {
  console.error(`pattern not found in ${file}: ${JSON.stringify(oldText.slice(0, 60))}`);
  process.exit(1);
}

fs.writeFileSync(file, source.slice(0, at) + newText + source.slice(at + oldText.length));
