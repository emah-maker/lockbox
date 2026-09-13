// deleteCascade.test.js -- "delete my account" is implemented twice, against
// the same Firestore data, in two codebases that never import from each
// other: app/src/sync/firestoreSync.ts's deleteAllUserData (TypeScript, in a
// React Native bundle) and website/js/accountDelete.js (a plain ES module in
// the browser). Both enumerate the subcollections to wipe as a hand-written
// array, because Firestore has no cascade delete. Nothing checked that the
// two arrays said the same thing, and they stopped.
//
// A drift here is silent in the worst way. The account IS deleted -- the Auth
// user goes, the user doc goes, the page says so -- and what is left behind
// is precisely the data an automated backend job reads: functions/ queries
// scheduledSessions with the Admin SDK, which bypasses firestore.rules and
// never checks whether the owning account still exists. So the leftovers do
// not sit inert; they keep firing. A user who deleted their account from the
// dashboard carried on receiving push reminders for it.
//
// Since 0fb77ae the pair also shares an ORDER, not just a membership list:
// sessions are deletable only while users/{uid} is absent, so both cascades
// must delete that parent doc FIRST and sweep sessions afterwards. That claim
// is asserted here too, because getting it backwards is invisible -- the
// denied session deletes are deliberately swallowed, so the flow still
// reports success while leaving every session undeletable by anyone, forever.
//
// Lives at the repo root, not in either sub-project, because it belongs to
// neither: it is a claim ABOUT the pair. Both sides are read as TEXT rather
// than imported -- one pulls in React Native the moment it is imported, the
// other expects a browser and a live Firestore -- the same approach
// bleUuids.test.js takes for the same reason.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..');

const appSync = readFileSync(path.join(repoRoot, 'app', 'src', 'sync', 'firestoreSync.ts'), 'utf8');
const webDelete = readFileSync(path.join(repoRoot, 'website', 'js', 'accountDelete.js'), 'utf8');
const rules = readFileSync(path.join(repoRoot, 'app', 'firestore.rules'), 'utf8');

// Each side is matched in its own shape rather than forced into a common one:
// the app inlines the list into its sweep loop, the website keeps a named
// constant it can document. Named up here so the failure messages below can
// point at the exact pattern that stopped matching.
const APP_LIST = /for \(const sub of \[([^\]]*)\] as const\)/;
const WEB_LIST = /const DELETABLE_SUBCOLLECTIONS = \[([^\]]*)\]/;

/** The string literals of an array literal, in source order -- or null when
 * the pattern does not match.
 *
 * Returning null instead of asserting is the whole point, and it is worth
 * spelling out: this extraction used to run at MODULE scope and assert there.
 * When 0fb77ae inlined the app's list into its loop, the regex stopped
 * matching and the assertion threw during import -- so node:test reported one
 * opaque crashed file rather than a named failing claim, and every OTHER
 * check in here (including the cascade-parity one that had genuinely broken)
 * stopped running at the same moment without ever saying so. Every caller is
 * now inside an it(), so a pattern that goes stale fails as exactly one test,
 * by name, with the regex to fix printed in the message. */
function arrayLiteral(source, pattern) {
  const m = pattern.exec(source);
  if (!m) return null;
  return [...m[1].matchAll(/['"]([A-Za-z]+)['"]/g)].map((x) => x[1]);
}

/** arrayLiteral, plus the assertion that it matched at all. Call from inside
 * an it(). `what` names the file, so the message says where to look. */
function listOrFail(source, pattern, what) {
  const list = arrayLiteral(source, pattern);
  assert.ok(
    list,
    `could not find the subcollection list in ${what} using ${pattern} -- the `
      + 'source was probably refactored. Update the pattern to match its new shape; '
      + 'do NOT delete this check, which is how this file went blind before.',
  );
  return list;
}

const appList = () => listOrFail(appSync, APP_LIST, 'app/src/sync/firestoreSync.ts');
const webList = () => listOrFail(webDelete, WEB_LIST, 'website/js/accountDelete.js');

/** Source offset of the first match, or -1. Used for the ordering claim
 * below: these files are read as text, so "before" means "earlier in the
 * source", which holds because both cascades are a single straight-line
 * async function with no branching between the two statements compared. */
function at(source, pattern) {
  const m = pattern.exec(source);
  return m ? m.index : -1;
}

// The two statements whose relative order the rules make load-bearing, plus
// the tolerated-failure wrapper around the second. Written identically in
// both files, so one pattern checks both.
const PARENT_DELETE = /await deleteDoc\(doc\(db, 'users', uid\)\)/;
const SESSIONS_SWEEP = /await deleteSubcollection\(db, uid, 'sessions'\)/;
const TOLERATED_SWEEP = /try \{\s*await deleteSubcollection\(db, uid, 'sessions'\);\s*\} catch/;

/** The two implementations, so each claim below is made about both. */
const BOTH = [
  ['app', appSync],
  ['website', webDelete],
];

describe('account-deletion cascade', () => {
  it('wipes the same subcollections from the app and from the dashboard', () => {
    // Order too, not just membership: both files document themselves as
    // deleting "in the same order", and a reader comparing them should be
    // able to do it line by line.
    assert.deepEqual(webList(), appList());
  });

  it('finds a non-trivial list on both sides', () => {
    // Guards the regexes above: a rename that made either match the empty
    // array would otherwise make the equality check pass while testing
    // nothing at all.
    assert.ok(appList().length >= 5, `app list looks wrong: ${JSON.stringify(appList())}`);
    assert.ok(webList().length >= 5, `website list looks wrong: ${JSON.stringify(webList())}`);
  });

  it('includes the two subcollections an automated backend job reads', () => {
    // These are the ones whose absence does not merely orphan data but keeps
    // sending notifications to a deleted account -- see this file's header.
    for (const sub of ['pushTokens', 'scheduledSessions']) {
      assert.ok(appList().includes(sub), `app cascade is missing ${sub}`);
      assert.ok(webList().includes(sub), `website cascade is missing ${sub}`);
    }
  });

  it('only lists subcollections the rules actually let a client delete', () => {
    // A name in either array that the rules refuse is worse than a missing
    // one: the delete throws partway through the cascade, so an account
    // deletion fails after having already wiped whatever came before it.
    // sessions is deliberately in neither array -- its rule is conditional
    // and it is swept separately, which the three tests after this cover.
    for (const sub of new Set([...appList(), ...webList()])) {
      // The doc-id segment is a wildcard for some (`/devices/{deviceId}`) and
      // a fixed name for others (`/settings/app`, `/goals/config`), so match
      // either shape rather than assuming every collection uses a wildcard.
      const block = new RegExp(
        `match /${sub}/(?:\\{[A-Za-z]+\\}|[A-Za-z]+) \\{([\\s\\S]*?)\\n      \\}`,
      ).exec(rules);
      assert.ok(block, `no rules block found for ${sub}`);
      assert.match(
        block[1],
        /allow[^;]*\bdelete\b[^;]*:\s*if isOwner\(uid\)/,
        `${sub} is in a delete cascade but its rule does not allow an owner to delete it`,
      );
    }
  });

  it('purges session history on both sides, not just the account', () => {
    // App Store Review Guideline 5.1.1(v) asks for the account AND its data,
    // and a session's topic is free text a user typed. Swept outside the
    // arrays above because its rule is narrower and its failure is tolerated.
    for (const [name, src] of BOTH) {
      assert.match(src, SESSIONS_SWEEP, `${name} cascade never sweeps sessions`);
    }
  });

  it('deletes the parent user doc BEFORE sweeping sessions, on both sides', () => {
    // The one ordering firestore.rules makes load-bearing: a session delete
    // is permitted only while users/{uid} is absent, so a cascade that
    // removes the parent last can never delete a session at all. Nothing
    // surfaces that -- the denials are swallowed by design (next test) --
    // so the flow reports success and the history silently survives.
    for (const [name, src] of BOTH) {
      const parent = at(src, PARENT_DELETE);
      const sessions = at(src, SESSIONS_SWEEP);
      assert.ok(parent >= 0, `${name}: no users/{uid} delete found`);
      assert.ok(sessions >= 0, `${name}: no sessions sweep found`);
      assert.ok(
        parent < sessions,
        `${name} deletes users/{uid} AFTER sweeping sessions -- the rules only permit `
          + 'a session delete while that doc is absent, so this order purges nothing',
      );
    }
  });

  it('lets the sessions sweep fail without aborting the deletion', () => {
    // firestore.rules ships separately from both clients and this repo has no
    // CI for deploying it, so either one can be live against a ruleset that
    // still refuses session deletes. Throwing there would abandon the flow
    // with users/{uid} already gone and the Auth user still alive -- strictly
    // worse than the orphaning this replaced, and on the one path a user
    // cannot retry from a clean state. Swallowing degrades to the old
    // behaviour instead. Every other subcollection must still fail loudly,
    // which is why this wrapper is around the sessions sweep ALONE.
    for (const [name, src] of BOTH) {
      assert.match(
        src,
        TOLERATED_SWEEP,
        `${name}: the sessions sweep is not wrapped in its own try/catch -- a stale `
          + 'deployed ruleset would abort account deletion half-finished',
      );
    }
  });

  it('opens the session-delete window exactly where the cascade needs it', () => {
    // The rules side of the same claim. Sessions stay append-only for
    // anything a running app can do -- users/{uid} exists for the whole life
    // of a signed-in account -- and open only in the state the cascades above
    // create deliberately. Pinned here because relaxing this to a plain
    // `if isOwner(uid)` would quietly hand a stolen client token the ability
    // to erase real history, and tightening it back to `if false` would
    // quietly put the 5.1.1(v) gap back.
    const block = /match \/sessions\/\{sessionId\} \{([\s\S]*?)\n      \}/.exec(rules);
    assert.ok(block, 'no rules block found for sessions');
    assert.match(
      block[1],
      /allow delete: if isOwner\(uid\)\s*&&\s*!exists\(\/databases\/\$\(database\)\/documents\/users\/\$\(uid\)\)/,
      'the sessions delete rule is no longer the parent-absent window both cascades rely on',
    );
  });

  it('keeps sessions out of the fail-loudly list on both sides', () => {
    // Sessions ARE deleted now, but they must not be in the arrays above:
    // those are swept unconditionally and a denial on one of them is a real
    // fault. Moving sessions into either list would make a stale ruleset
    // abort the whole account deletion instead of degrading gracefully.
    assert.ok(!appList().includes('sessions'), 'app: sessions must be swept separately, not in the unconditional list');
    assert.ok(!webList().includes('sessions'), 'website: sessions must be swept separately, not in the unconditional list');
  });
});
