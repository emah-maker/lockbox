// deleteCascade.test.js -- "delete my account" is implemented twice, against
// the same Firestore data, in two codebases that never import from each
// other: the app (app/src/auth/useAuthStore.ts's deleteAccount driving
// app/src/sync/firestoreSync.ts's deleteAllUserData, TypeScript in a React
// Native bundle) and the dashboard (website/js/accountDelete.js, a plain ES
// module in the browser). Nothing but this file checks that the two say the
// same thing, and they have now drifted twice.
//
// Four claims are pinned here, each one a bug that actually shipped:
//
// 1. The same subcollections, in the same order. A name missing from one
//    side is silent in the worst way: the account IS deleted -- the Auth
//    user goes, the user doc goes, the page says so -- and what is left is
//    precisely the data an automated backend job reads. functions/ queries
//    scheduledSessions with the Admin SDK, which bypasses firestore.rules
//    and never checks whether the owning account still exists, so the
//    leftovers do not sit inert: they keep firing. A user who deleted their
//    account from the dashboard carried on receiving push reminders for it.
// 2. Both sides sweep `sessions`, separately from that loop and best-effort.
//    Sessions used to be left behind deliberately; App Store Review
//    Guideline 5.1.1(v) (the account AND its data) is why they are not. The
//    sweep is separate because it is the one step allowed to fail --
//    firestore.rules deploys independently of either client, so a stale
//    ruleset must degrade to the old orphaning, not abort a deletion that
//    has already started.
// 3. Both sides delete the parent users/{uid} doc BEFORE that loop. This is
//    the one ordering the rules can't express as a requirement: session
//    docs are append-only except while the parent doc is absent, so
//    removing it first is what opens the window the sessions sweep needs.
//    Deleting it last -- which the dashboard did -- left every session
//    permanently undeletable, since once the Auth user is gone nothing can
//    satisfy isOwner(uid) again.
// 4. Both sides re-authenticate BEFORE anything destructive runs. Re-auth is
//    the only step a user can cancel, and both sides once wiped first and
//    asked after: a dismissed picker then left the cloud data destroyed with
//    the user still signed in and nothing on screen saying so.
//
// Every extraction below is LAZY -- inside a function a test calls, never at
// module scope -- and returns an empty string/array instead of throwing when
// a pattern stops matching. The previous version parsed at import time and
// asserted there, so when the app's array moved inline the assert threw
// during import and took the whole file down: all five assertions went dead
// at once, and the failure read as a broken test file rather than a broken
// contract. "Finds both sides of the contract" below is what turns a stale
// regex back into one named, obvious failure -- the same shape
// bleUuids.test.js uses, for the same reason.
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
const appStore = readFileSync(path.join(repoRoot, 'app', 'src', 'auth', 'useAuthStore.ts'), 'utf8');
const webDelete = readFileSync(path.join(repoRoot, 'website', 'js', 'accountDelete.js'), 'utf8');
const rules = readFileSync(path.join(repoRoot, 'app', 'firestore.rules'), 'utf8');

/** One function's source text, declaration through the closing brace that
 * ends it. '' when the pattern no longer matches, so the caller fails its own
 * named assertion rather than this throwing where nothing can report it. */
function body(source, pattern) {
  const m = pattern.exec(source);
  return m ? m[0] : '';
}

// The four function bodies every claim below is read out of. Kept as
// functions, not constants: see this file's header on lazy extraction.
const appCascade = () => body(appSync, /\nexport async function deleteAllUserData\([\s\S]*?\n\}/);
const webCascade = () => body(webDelete, /\nasync function deleteFirestoreData\([\s\S]*?\n\}/);
const appFlow = () => body(appStore, /\n {2}deleteAccount: async \([\s\S]*?\n {2}\},/);
const webFlow = () => body(webDelete, /\nasync function runDeleteAccount\([\s\S]*?\n\}/);

/** The string literals of an array body, in source order. */
const stringLiterals = (text) => [...text.matchAll(/['"]([A-Za-z]+)['"]/g)].map((m) => m[1]);

/** The app's list is inline in its own sweep loop (`for (const sub of [...]
 * as const)`), so it is read out of deleteAllUserData's body rather than the
 * whole file: firestoreSync.ts holds other array literals, and a regex loose
 * enough to find this one anywhere in the file would eventually find one of
 * those instead and compare the wrong thing. */
function appList() {
  const m = /for \(const sub of \[([^\]]*)\]/.exec(appCascade());
  return m ? stringLiterals(m[1]) : [];
}

/** The dashboard's is a named module constant. */
function webList() {
  const m = /const DELETABLE_SUBCOLLECTIONS = \[([^\]]*)\]/.exec(webDelete);
  return m ? stringLiterals(m[1]) : [];
}

// Source positions, not just presence: claims 3 and 4 are about ORDER, and
// order inside one function is only checkable by where the calls sit.
const parentDeleteAt = (b) => b.search(/deleteDoc\(\s*doc\([^)]*['"]users['"]/);
const sweepLoopAt = (b) => b.search(/for \(const sub of /);
const sessionSweepAt = (b) => b.search(/deleteSubcollection\([^)]*['"]sessions['"]\)/);

/** The sessions sweep, its own catch, and a warning rather than a throw. */
const sessionSweepIsBestEffort = (b) =>
  /try \{[\s\S]{0,200}?['"]sessions['"][\s\S]{0,200}?\} catch[\s\S]{0,400}?console\.warn/.test(b);

// Each side names its own re-auth wrapper; both wrap the one cancellable
// step and are called before the wipe below them.
const appReauthAt = () => appFlow().search(/await deleteWithReauthRetry\(/);
const appWipeAt = () => appFlow().search(/deleteAllUserData\(/);
const webReauthAt = () => webFlow().search(/await withReauthRetry\(/);
const webWipeAt = () => webFlow().search(/deleteFirestoreData\(/);

/** The `match /sessions/{sessionId}` block of firestore.rules. */
function sessionsRulesBlock() {
  const m = /match \/sessions\/\{[A-Za-z]+\} \{([\s\S]*?)\n {6}\}/.exec(rules);
  return m ? m[1] : '';
}

describe('account-deletion cascade', () => {
  // Guards every case below against passing vacuously, and is the one test
  // that fails when a rename defeats a regex -- everything after it then
  // still runs and still means something. See this file's header.
  it('finds both sides of the contract', () => {
    assert.ok(appList().length >= 5, `app list looks wrong: ${JSON.stringify(appList())}`);
    assert.ok(webList().length >= 5, `website list looks wrong: ${JSON.stringify(webList())}`);
    assert.ok(appCascade(), 'firestoreSync.ts no longer declares deleteAllUserData');
    assert.ok(webCascade(), 'accountDelete.js no longer declares deleteFirestoreData');
    assert.ok(appFlow(), 'useAuthStore.ts no longer declares a deleteAccount action');
    assert.ok(webFlow(), 'accountDelete.js no longer declares runDeleteAccount');
    assert.ok(sessionsRulesBlock(), 'firestore.rules no longer has a sessions block');
    for (const [name, b] of [['app', appCascade()], ['website', webCascade()]]) {
      assert.ok(parentDeleteAt(b) >= 0, `${name}: no users/{uid} delete found in the cascade`);
      assert.ok(sweepLoopAt(b) >= 0, `${name}: no subcollection sweep loop found in the cascade`);
      assert.ok(sessionSweepAt(b) >= 0, `${name}: no separate sessions sweep found in the cascade`);
    }
    assert.ok(appReauthAt() >= 0, 'useAuthStore.deleteAccount no longer calls deleteWithReauthRetry');
    assert.ok(appWipeAt() >= 0, 'useAuthStore.deleteAccount no longer calls deleteAllUserData');
    assert.ok(webReauthAt() >= 0, 'runDeleteAccount no longer calls withReauthRetry');
    assert.ok(webWipeAt() >= 0, 'runDeleteAccount no longer calls deleteFirestoreData');
  });

  it('wipes the same subcollections from the app and from the dashboard', () => {
    // Order too, not just membership: both files document themselves as
    // deleting "in the same order", and a reader comparing them should be
    // able to do it line by line.
    assert.deepEqual(webList(), appList());
  });

  it('includes the two subcollections an automated backend job reads', () => {
    // These are the ones whose absence does not merely orphan data but keeps
    // sending notifications to a deleted account -- see claim 1 in the header.
    for (const sub of ['pushTokens', 'scheduledSessions']) {
      assert.ok(appList().includes(sub), `app cascade is missing ${sub}`);
      assert.ok(webList().includes(sub), `website cascade is missing ${sub}`);
    }
  });

  it('only lists subcollections the rules actually let a client delete', () => {
    // A name in either array that the rules refuse is worse than a missing
    // one: the delete throws partway through the cascade, so an account
    // deletion fails after having already wiped whatever came before it.
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

  it('sweeps sessions on both sides, separately from the loop and best-effort', () => {
    // sessions is NOT in either array, and that is the contract rather than
    // an oversight: unlike the five, its rule is conditional and its sweep is
    // the one permitted to fail, so it gets its own call in its own
    // try/catch. Folding it into the loop would make a stale deployed ruleset
    // abort the whole deletion (see claim 2 in the header).
    assert.ok(!appList().includes('sessions'), 'app: sessions belongs in its own guarded sweep, not the loop');
    assert.ok(!webList().includes('sessions'), 'website: sessions belongs in its own guarded sweep, not the loop');
    for (const [name, b] of [['app', appCascade()], ['website', webCascade()]]) {
      assert.ok(sessionSweepAt(b) > sweepLoopAt(b), `${name}: the sessions sweep must come after the loop`);
      assert.ok(
        sessionSweepIsBestEffort(b),
        `${name}: the sessions sweep must be wrapped in its own try/catch that only warns -- a stale `
          + 'deployed ruleset has to degrade to orphaning, not abandon a deletion mid-flight',
      );
    }
  });

  it('deletes the parent user doc before sweeping, on both sides', () => {
    // The ordering the rules depend on, checked by source position because
    // there is nowhere else it is written down as a requirement: session
    // docs are append-only for every client including the owner, EXCEPT
    // while users/{uid} is absent. Deleting the parent first is what opens
    // that window, and a "tidier" cascade that deletes it last would leave
    // sessions undeletable by anyone, forever.
    for (const [name, b] of [['app', appCascade()], ['website', webCascade()]]) {
      assert.ok(
        parentDeleteAt(b) < sweepLoopAt(b),
        `${name}: users/{uid} must be deleted BEFORE the subcollection sweep, not after`,
      );
      assert.ok(
        parentDeleteAt(b) < sessionSweepAt(b),
        `${name}: users/{uid} must be deleted BEFORE the sessions sweep, or the rules deny it`,
      );
    }
    // And the rule that makes it load-bearing, so this test fails rather
    // than goes quietly obsolete if that condition is ever relaxed.
    const deleteRule = /allow delete:([\s\S]*?);/.exec(sessionsRulesBlock());
    assert.ok(deleteRule, 'the sessions block no longer has a delete rule');
    assert.match(deleteRule[1], /isOwner\(uid\)/);
    assert.match(
      deleteRule[1],
      /!exists\(\/databases\/\$\(database\)\/documents\/users\/\$\(uid\)\)/,
      'the sessions delete window is no longer tied to users/{uid} being absent',
    );
  });

  it('re-authenticates before it destroys anything, on both sides', () => {
    // Re-auth is the one step in this flow the user can cancel or fail, and
    // both sides once ran it AFTER the wipe: a dismissed picker left the
    // cloud data destroyed, the user still signed in, and -- because a
    // dismissed popup is not an error worth a banner -- nothing said so.
    // Position again, because "before" is the whole property.
    assert.ok(
      appReauthAt() < appWipeAt(),
      'useAuthStore.deleteAccount must re-authenticate before calling deleteAllUserData',
    );
    assert.ok(
      webReauthAt() < webWipeAt(),
      'runDeleteAccount must re-authenticate before calling deleteFirestoreData',
    );
  });
});
