/* =========================================================================
   accountDelete.js -- owns the account-deletion confirm box + the cascade
   delete itself. Split out of accountPanel.js purely to keep that file
   under the project's 500-line guideline (same reasoning as goalForm.js
   being split out of goalsPanel.js) -- this is one bounded, high-stakes
   chunk of that panel's Danger zone, not a separately-mounted feature, so
   it has no ctx/mount shape of its own; it's called directly from
   accountPanel.js's buildDangerSection with the same `els`/`ctx` that
   module already has in hand.

   The delete cascade mirrors app/src/sync/firestoreSync.ts's
   deleteAllUserData step for step (same subcollections in the same order,
   same batch chunk size, same parent-doc-first ordering, same
   permitted-to-fail sessions sweep -- see account-spec.md §4). Two
   orderings are load-bearing here and neither is obvious from the body:

     - Firestore data goes before the Auth user, while still authenticated as
       this uid, because an owner-scoped rule can't authorize a delete once
       the Auth user performing it no longer exists.
     - users/{uid} goes before its own subcollections, because firestore.rules
       permits a session delete only while that parent doc is absent. Deleting
       it last -- as this file did back when sessions were merely orphaned --
       would leave every session permanently undeletable by anyone.

   tests/contracts/deleteCascade.test.js pins this file against the app's
   copy, since the two never import from each other and nothing else does.
   ========================================================================= */
import {
  GoogleAuthProvider,
  OAuthProvider,
  deleteUser,
  reauthenticateWithPopup,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc,
  deleteDoc,
  collection,
  getDocs,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { showMessage } from './dashMessage.js';
import { friendlyErrorMessage, isIgnorableAuthError, logAuthError } from './authErrors.js';

const DELETE_CONFIRM_WORD = 'DELETE';
const BATCH_LIMIT = 500; // Firestore's per-batch write cap -- mirrors firestoreSync.ts's deleteAllUserData
// The same subcollections deleteAllUserData wipes unconditionally, in the
// same order -- see firestore.rules: each of these is `allow delete: if
// isOwner`, so a denial on one of them is a real fault and must not be
// swallowed.
//
// sessions is not in this list, and is no longer excluded from the cascade
// either: it is swept separately at the end of deleteFirestoreData, because
// its rule is narrower (`isOwner` AND the parent user doc absent) and,
// uniquely, its failure is tolerated. See that call for why.
//
// pushTokens and scheduledSessions were added to the app's list when
// server-pushed reminders landed, and this copy was missed -- its comment
// still said "the same three". That gap is not cosmetic, because these two
// are the only user data an automated backend job reads: functions/ queries
// scheduledSessions with the Admin SDK, which bypasses these rules and never
// checks whether the account still exists. So a user who scheduled a session
// or enabled browser push from THIS page, then deleted their account from
// THIS page, kept receiving push notifications for an account that no longer
// exists. tests/contracts/deleteCascade.test.js now asserts the two lists
// agree, since nothing else does.
const DELETABLE_SUBCOLLECTIONS = ['settings', 'devices', 'goals', 'pushTokens', 'scheduledSessions'];

/** Enumerate one subcollection under users/{uid} and delete every document in
 * it. Firestore has no cascade-delete, so each is swept explicitly. Chunked to
 * Firestore's per-batch write limit (defensive -- one account's data is
 * expected to stay far under it). */
async function deleteSubcollection(db, uid, sub) {
  const snap = await getDocs(collection(db, 'users', uid, sub));
  let batch = writeBatch(db);
  let count = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    count += 1;
    if (count === BATCH_LIMIT) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
}

/** Cascade-deletes everything firestore.rules permits, in the order the rules
 * require -- see this file's header for why that order is not cosmetic. */
async function deleteFirestoreData(db, uid) {
  // FIRST, and load-bearing rather than tidy: firestore.rules permits a
  // session delete only while this doc is absent, and nothing but this path
  // ever produces that state. Deleting it last would leave every session
  // permanently undeletable by anyone.
  await deleteDoc(doc(db, 'users', uid));
  for (const sub of DELETABLE_SUBCOLLECTIONS) {
    await deleteSubcollection(db, uid, sub);
  }
  // Sessions go last, and are the one sweep permitted to fail.
  //
  // firestore.rules is deployed separately from this page, so the dashboard
  // can be live before the ruleset that lets it purge sessions is. Then these
  // deletes come back permission-denied, and letting that throw would abandon
  // the flow with users/{uid} already gone and the Auth user still alive:
  // strictly worse than the orphaning this replaced, and on the one path a
  // user cannot retry from a clean state. Swallowing it degrades to exactly
  // the old behaviour instead, and the warning is the signal that
  // `firebase deploy --only firestore:rules` is overdue. Every other
  // subcollection above still fails loudly.
  try {
    await deleteSubcollection(db, uid, 'sessions');
  } catch (e) {
    console.warn('[account] session history not purged on account deletion:', e instanceof Error ? e.message : e);
  }
}

/** Picks one already-linked provider to re-authenticate with when Firebase
 * demands a fresh credential. Google preferred when both are linked --
 * mirrors useAuthStore.deleteAccount's own tie-break (avoids double-
 * prompting with both a Google picker and an Apple sheet for one delete). */
function primaryReauthProvider(user) {
  const ids = user.providerData.map((p) => p.providerId);
  if (ids.includes('google.com')) return new GoogleAuthProvider();
  if (ids.includes('apple.com')) return new OAuthProvider('apple.com');
  return null;
}

async function runDeleteAccount(user, els, ctx, controls) {
  controls.input.disabled = true;
  controls.cancel.disabled = true;
  controls.confirmBtn.disabled = true;
  try {
    await deleteFirestoreData(ctx.getDb(), user.uid);
    try {
      await deleteUser(user);
    } catch (err) {
      // Firebase requires a recent credential for this destructive op --
      // re-authenticate once with the account's own primary provider, then
      // retry the delete exactly once (account-spec.md §4).
      if (err && err.code === 'auth/requires-recent-login') {
        const provider = primaryReauthProvider(user);
        if (!provider) throw err;
        await reauthenticateWithPopup(user, provider);
        await deleteUser(user);
      } else {
        throw err;
      }
    }
    // Success: onAuthStateChanged (dashboard.js) observes the now-null user
    // and redirects to login.html on its own -- no manual redirect needed
    // here, and nothing left to render on this panel.
  } catch (err) {
    if (isIgnorableAuthError(err)) {
      // The re-auth popup was dismissed -- not a failure worth an error
      // banner, just let the user retry.
    } else {
      logAuthError('account deletion', err);
      showMessage(els.accountMsg, friendlyErrorMessage(err), { kind: 'err', autoDismissMs: 8000 });
    }
    controls.input.disabled = false;
    controls.cancel.disabled = false;
    controls.input.value = '';
    controls.confirmBtn.disabled = true;
  }
}

/** Builds the second-step confirm box: warning copy, a "type DELETE" input
 * gating the destructive button, Cancel, and the destructive action itself.
 * `onCancel` is accountPanel.js's own responsibility (clears its
 * openConfirmKey singleton and re-renders the panel) -- kept as a callback
 * rather than this module reaching back into that module's state, so the
 * two files don't need a circular import. */
export function buildDeleteConfirm(user, els, ctx, onCancel) {
  const box = document.createElement('div');
  box.className = 'acct__confirm';

  const warning = document.createElement('p');
  // Copy pinned to account-spec.md §4. The orphaned-sessions caveat this
  // used to carry is gone because the behaviour is: deleteFirestoreData above
  // now purges session history too, which is the point of App Store Review
  // Guideline 5.1.1(v) -- the account AND its data -- and a session's topic is
  // free text somebody typed.
  //
  // Stated flatly rather than hedged on the sessions sweep being permitted to
  // fail: that is a rules-deploy-lag detail a reader cannot act on, and the
  // promise the product makes is the unhedged one. If the sweep is denied it
  // logs (see deleteFirestoreData) -- the fix is to deploy the rules, not to
  // soften this sentence.
  warning.textContent = 'This permanently deletes your account and its cloud data: profile, settings, '
    + 'custom labels, focus goals, linked devices, and your session history. The physical Phone Box and '
    + 'anything stored locally on this phone are not affected. This cannot be undone.';
  box.appendChild(warning);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'acct__confirm-input';
  input.placeholder = DELETE_CONFIRM_WORD;
  input.setAttribute('aria-label', `Type ${DELETE_CONFIRM_WORD} to confirm account deletion`);
  input.autocomplete = 'off';
  box.appendChild(input);

  const actions = document.createElement('div');
  actions.className = 'acct__confirm-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn--sm btn--ghost';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', onCancel);
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'dash__labels-confirm-delete';
  confirmBtn.textContent = 'Permanently delete account';
  confirmBtn.disabled = true; // enabled only once the typed text matches exactly (case-sensitive)
  actions.append(cancel, confirmBtn);
  box.appendChild(actions);

  input.addEventListener('input', () => {
    confirmBtn.disabled = input.value !== DELETE_CONFIRM_WORD;
  });
  confirmBtn.addEventListener('click', () => runDeleteAccount(user, els, ctx, { input, cancel, confirmBtn }));

  // Same Escape-to-close convention as labelsPanel.js's/goalsPanel.js's own
  // inline confirms -- this box was missing it, the one destructive confirm
  // on the page a keyboard user couldn't dismiss without tabbing to Cancel.
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  });

  return box;
}
