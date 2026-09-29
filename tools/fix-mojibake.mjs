/**
 * One-off repair for mojibake: em-dashes, arrows and curly quotes that were
 * UTF-8 encoded, then read back as cp1252 and re-encoded as UTF-8 again.
 *
 * The approach is a whitelist match, not a decode round-trip. A round-trip
 * (the obvious Buffer.from(s,'utf8').toString('latin1')) was tried first and is
 * wrong in both directions: it grows the string instead of shrinking it, and a
 * working variant would also "repair" the legitimately non-ASCII content --
 * the Japanese character names, the accented labels -- into different-but-still
 * broken text, which is far harder to notice than the mojibake it replaced.
 *
 * Matching only these code points makes the blast radius provable: none of them
 * occur in correctly-encoded Japanese or accented Latin text, so a run of them
 * can only be damage.
 *
 * Run: node tools/fix-mojibake.mjs [--check]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';

// fileURLToPath, not `.pathname` with a manual leading-slash strip: this
// project lives under a path containing a space ("GAME D3V"), and `.pathname`
// leaves it percent-encoded as "GAME%20D3V". That directory does not exist, so
// the walk silently matched nothing and every run reported "0 files" while
// the real source files were never opened.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK = process.argv.includes('--check');

/**
 * The code points that only appear in mangled text, as numbers on purpose.
 *
 * Written numerically because two earlier attempts at this table failed: as
 * literal characters it got re-encoded in transit, and as backslash escapes it
 * arrived doubled -- both leaving a table that describes the wrong set and
 * matches nothing while reporting success. Numbers have nothing to mangle, and
 * the named ones are self-documenting (0x2014 EM DASH, 0x20AC EURO SIGN).
 */
const MOJI = new Set();
for (let c = 0x00a0; c <= 0x00bf; c++) MOJI.add(String.fromCodePoint(c));
for (const c of [0x00c2, 0x00c3, 0x00e2, 0x0192, 0x0161, 0x009d, 0x201a, 0x20ac, 0x201c, 0x201d, 0x2018, 0x2019]) {
  MOJI.add(String.fromCodePoint(c));
}
const EM_DASH = String.fromCodePoint(0x2014);

/**
 * Every mangled sequence in this codebase is a dash or an arrow, and both sit
 * between spaces, so a run of three or more collapses to an em dash. A run of
 * one or two is a stray byte rather than a character and becomes a space: a
 * lone A-circumflex in a comment is noise, not information.
 */
function repair(text) {
  let out = '';
  let run = 0;
  const flush = () => {
    if (!run) return;
    out += run > 2 ? EM_DASH : ' ';
    run = 0;
  };
  for (const ch of text) {
    if (MOJI.has(ch)) {
      run++;
      continue;
    }
    flush();
    out += ch;
  }
  flush();
  return out;
}

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    // Skip build output, dependencies and dot-directories. The dot rule is not
    // cosmetic: an earlier run rewrote ten files inside a leftover
    // .tmp-chrome profile, because that was the only place a buggy version of
    // this table happened to match.
    if (e === 'node_modules' || e === 'dist' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (['.js', '.mjs', '.html', '.css'].includes(extname(p))) acc.push(p);
  }
  return acc;
}

const files = walk(ROOT);
let changed = 0;
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  const after = repair(before);
  if (after === before) continue;
  changed++;
  const name = file.slice(ROOT.length);
  if (CHECK) console.log(`would fix ${name}`);
  else {
    writeFileSync(file, after, 'utf8');
    console.log(`fixed ${name}`);
  }
}
console.log(`${CHECK ? 'would fix' : 'fixed'} ${changed} of ${files.length} scanned file(s)`);

