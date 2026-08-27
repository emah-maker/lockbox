#!/usr/bin/env node
/**
 * Cross-shell-safe hook launcher.
 *
 * ROOT CAUSE THIS REPLACES (see forensics + reproduction, 2026-08-27):
 * every hook command in .claude/settings.json used to be
 *   cmd /c "IF EXIST "%CLAUDE_PROJECT_DIR%\...\hook-handler.cjs" (node "..." pre-bash) ELSE (node "%USERPROFILE%\...\hook-handler.cjs" pre-bash)"
 * On this machine, hook commands are executed through a POSIX shell
 * (Git Bash `sh -c`), not natively through cmd.exe. `%VAR%` never expands
 * under sh, and — far worse — sh's word-splitting/quote-collapsing of the
 * nested unescaped double quotes corrupts cmd.exe's `/c` switch. Without an
 * effective `/c`, cmd.exe starts INTERACTIVELY and reads the piped hook
 * payload (raw tool_input JSON / file content / command text) as literal
 * typed console commands. Any bare `>` in ordinary source (`=> void`,
 * `x > 0`, `.map((r) => r.goalId)`, a CSS `> .btn`) is then honored as a
 * redirect, creating a zero-byte file named after the next token, in the
 * hook's cwd. That's where the `void`, `g.id`, `0)`,
 * `r.goalId)).toEqual(['g1'])` junk files came from. It also means every
 * hook silently never ran node at all — pre-bash's safety checks, learning
 * hooks, memory sync, etc. have effectively been dead code.
 *
 * FIX: never spawn cmd.exe for hook dispatch, and never put a shell
 * variable reference or nested quotes in the settings.json command string.
 * settings.json now points at this single hardcoded path with ONE pair of
 * quotes (parses identically under `sh -c` and `cmd.exe /d /s /c` — no
 * nesting for either to mis-parse). All the "project copy vs. user-level
 * copy" fallback logic that the old IF EXIST/ELSE did in batch syntax is
 * reproduced here in plain JS instead, reading process.env directly (which
 * is populated correctly by the child process regardless of which shell,
 * if any, parsed the command line).
 *
 * Usage: node hook-entry.cjs <script-basename> <subcommand> [...extraArgs]
 *   e.g. node hook-entry.cjs hook-handler.cjs pre-bash
 *        node hook-entry.cjs auto-memory-hook.mjs import
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

function resolveHelperScript(scriptName) {
  const candidates = [];
  try {
    const projectDir = process.env.CLAUDE_PROJECT_DIR;
    if (projectDir) candidates.push(path.join(projectDir, '.claude', 'helpers', scriptName));
  } catch (_) { /* ignore */ }
  // This file's own directory — always correct for THIS project's checkout,
  // independent of env vars or which shell (if any) parsed the command line.
  candidates.push(path.join(__dirname, scriptName));
  try {
    const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
    if (home) candidates.push(path.join(home, '.claude', 'helpers', scriptName));
  } catch (_) { /* ignore */ }

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch (_) { /* keep trying */ }
  }
  // Nothing found — return the first candidate anyway so the caller gets a
  // clear ENOENT-style failure instead of a silent no-op; main() below
  // still fails open (exit 0) regardless.
  return candidates[0] || scriptName;
}

function main() {
  const [scriptName, subcommand, ...extraArgs] = process.argv.slice(2);
  if (!scriptName) {
    console.log('[WARN] hook-entry.cjs: no target script given, skipping');
    process.exit(0);
  }

  const target = resolveHelperScript(scriptName);

  let status = 0;
  try {
    const result = spawnSync(
      process.execPath,
      [target, ...(subcommand ? [subcommand] : []), ...extraArgs],
      { stdio: 'inherit', env: process.env }
    );
    if (result.error) {
      console.log(`[WARN] hook-entry.cjs: failed to launch ${target}: ${result.error.message}`);
      status = 0; // fail open — never block Claude Code on a launcher error
    } else if (typeof result.status === 'number') {
      status = result.status;
    }
  } catch (e) {
    // Hooks must never crash the session or block a tool call because of a
    // launcher bug — fail open unconditionally.
    try { console.log(`[WARN] hook-entry.cjs: unexpected error: ${e.message}`); } catch (_) { /* ignore */ }
    status = 0;
  }
  process.exit(status);
}

main();
