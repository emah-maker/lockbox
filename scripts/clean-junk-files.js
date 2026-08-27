#!/usr/bin/env node
/**
 * Finds (and, with --delete, removes) zero-byte junk files created by the
 * cmd.exe redirect-misparse bug: a hook payload or shell command containing
 * an unquoted `>` reaching an interactive cmd.exe session, which then
 * creates a zero-byte file named after whatever token followed the `>`
 * (e.g. `void`, `g.id`, `0)`, `{,+`, `updateGoal(goals`,
 * `r.goalId)).toEqual(['g1'])`). See .claude/helpers/hook-entry.cjs for the
 * root-cause fix; this script only cleans up ones already on disk.
 *
 * Dry-run by default — only lists candidates. Pass --delete to remove them.
 *
 * Usage:
 *   node scripts/clean-junk-files.js            # list candidates only
 *   node scripts/clean-junk-files.js --delete   # actually remove them
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const DELETE = process.argv.includes('--delete');

// Directories we never want to walk into.
const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.expo', 'ios', 'android',
  '.playwright-mcp', '.swarm', '.claude-flow',
  '.next', 'dist', 'build', 'coverage',
]);

// A file is a junk candidate if it is exactly 0 bytes AND its name contains
// punctuation that (verified via `git ls-files`) appears in zero real
// filenames in this repo — parens, braces, commas, backticks, quotes, or
// square brackets — which is exactly what cmd.exe leaves behind from a
// mis-parsed `=>`, comparison, template literal, or chained call/assert
// expression (e.g. `void`, `0)`, `r.goalId)).toEqual(['g1'])`, `` `${x}` ``).
const JUNK_NAME_RE = /[(){}\[\],`'"]/;

function getTrackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, maxBuffer: 1024 * 1024 * 64 });
    return new Set(out.toString('utf8').split('\0').filter(Boolean));
  } catch (e) {
    console.error(`[WARN] could not read tracked files via git (${e.message}); treating nothing as tracked`);
    return new Set();
  }
}

function walk(dir, tracked, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return; // unreadable dir — skip
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), tracked, results);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!JUNK_NAME_RE.test(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch (e) {
      continue;
    }
    if (stat.size !== 0) continue;

    const relPath = path.relative(REPO_ROOT, fullPath).split(path.sep).join('/');
    if (tracked.has(relPath)) continue; // never touch a tracked (legitimate) file

    results.push(fullPath);
  }
}

function main() {
  const tracked = getTrackedFiles();
  const results = [];
  walk(REPO_ROOT, tracked, results);

  if (results.length === 0) {
    console.log('[OK] No junk files found.');
    return;
  }

  console.log(`Found ${results.length} candidate junk file(s):`);
  for (const f of results) {
    console.log(`  ${path.relative(REPO_ROOT, f)}`);
  }

  if (!DELETE) {
    console.log('\nDry run only — nothing deleted. Re-run with --delete to remove these files.');
    return;
  }

  let deleted = 0;
  for (const f of results) {
    try {
      fs.unlinkSync(f);
      deleted++;
    } catch (e) {
      console.error(`[WARN] failed to delete ${f}: ${e.message}`);
    }
  }
  console.log(`\nDeleted ${deleted}/${results.length} file(s).`);
}

main();
