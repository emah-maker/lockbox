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

/** The string literals of an array assignment, in source order. */
function arrayLiteral(source, pattern) {
  const m = pattern.exec(source);
  assert.ok(m, `could not find the subcollection list (${pattern})`);
  return [...m[1].matchAll(/['"]([A-Za-z]+)['"]/g)].map((x) => x[1]);
}

const appList = arrayLiteral(appSync, /const subcollections = \[([^\]]*)\]/);
const webList = arrayLiteral(webDelete, /const DELETABLE_SUBCOLLECTIONS = \[([^\]]*)\]/);

describe('account-deletion cascade', () => {
  it('wipes the same subcollections from the app and from the dashboard', () => {
    // Order too, not just membership: both files document themselves as
    // deleting "in the same order", and a reader comparing them should be
    // able to do it line by line.
    assert.deepEqual(webList, appList);
  });

  it('finds a non-trivial list on both sides', () => {
    // Guards the regexes above: a rename that made either match the empty
    // array would otherwise make the equality check pass while testing
    // nothing at all.
    assert.ok(appList.length >= 5, `app list looks wrong: ${JSON.stringify(appList)}`);
    assert.ok(webList.length >= 5, `website list looks wrong: ${JSON.stringify(webList)}`);
  });

  it('includes the two subcollections an automated backend job reads', () => {
    // These are the ones whose absence does not merely orphan data but keeps
    // sending notifications to a deleted account -- see this file's header.
    for (const sub of ['pushTokens', 'scheduledSessions']) {
      assert.ok(appList.includes(sub), `app cascade is missing ${sub}`);
      assert.ok(webList.includes(sub), `website cascade is missing ${sub}`);
    }
  });

  it('only lists subcollections the rules actually let a client delete', () => {
    // A name in either array that the rules refuse is worse than a missing
    // one: the delete throws partway through the cascade, so an account
    // deletion fails after having already wiped whatever came before it.
    for (const sub of new Set([...appList, ...webList])) {
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

  it('never tries to delete sessions, which the rules deliberately refuse', () => {
    // firestore.rules makes session docs `allow delete: if false` for every
    // client including the owner -- an integrity property, so a compromised
    // token cannot erase real history. Both cascades leave them orphaned on
    // purpose, and the confirm copy tells the user so.
    assert.ok(!appList.includes('sessions'));
    assert.ok(!webList.includes('sessions'));
  });
});
