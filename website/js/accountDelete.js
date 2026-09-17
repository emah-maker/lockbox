/* =========================================================================
   accountDelete.js -- owns the account-deletion confirm box + the cascade
   delete itself. Split out of accountPanel.js purely to keep that file
   under the project's 500-line guideline (same reasoning as goalForm.js
   being split out of goalsPanel.js) -- this is one bounded, high-stakes
   chunk of that panel's Danger zone, not a separately-mounted feature, so
   it has no ctx/mount shape of its own; it's called directly from
   accountPanel.js's buildDangerSection with the same `els`/`ctx` that
   module already has in hand.

   The flow mirrors the app's own, which is split across two files:
   app/src/auth/useAuthStore.ts's deleteAccount (the step order) and
   app/src/sync/firestoreSync.ts's deleteAllUserData (the cascade itself --
   same subcollections, same batch chunk size). See account-spec.md §4.

   Three orderings here are load-bearing rather than tidy, and each one is
   the fix for a bug this file shipped with:

   1. RE-AUTHENTICATE FIRST, before anything destructive. Re-auth is the one
      step in this flow the user can cancel or fail, and this file used to
      wipe Firestore and only then attempt it. A dismissed popup therefore
      left the cloud data destroyed, the user still signed in, and -- since
      a dismissed popup is not an error worth a banner -- nothing on screen
      saying so. Same bug, same fix, same reasoning as the ordering comment
      in useAuthStore.deleteAccount.
   2. users/{uid} GOES BEFORE ITS SUBCOLLECTIONS. firestore.rules permits
      deleting a session only while the parent user doc is absent (the
      `!exists(/databases/$(database)/documents/users/$(uid))` clause on the
      sessions block), so removing the parent is precisely what opens the
      window the sessions sweep needs. Deleting it last -- as this did --
      left every session document behind permanently: once the Auth user is
      gone nobody can satisfy isOwner(uid) again, so no client can ever
      delete them, and this design has no privileged backend that could.
   3. ALL FIRESTORE DATA GOES BEFORE THE AUTH USER. Every delete below is
      authorized by isOwner(uid), which needs the caller still signed in as
      that uid; removing the Auth user first would make even the permitted
      deletes impossible.
   ========================================================================= */
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  deleteUser,
  reauthenticateWithCredential,
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
// The subcollections deleteAllUserData sweeps in its loop, in the same
// order. `sessions` is deliberately NOT in this list and that is not an
// omission: it is swept separately at the end of deleteFirestoreData because
// it is the one sweep allowed to fail (see there), and keeping it out of the
// loop is what makes that difference visible. firestore.rules lets an owner
// delete each of these unconditionally; a session only while users/{uid} is
// absent, which is what point 2 of this file's header is about.
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

// Firebase reports a wrong password as auth/invalid-credential on projects
// with Email Enumeration Protection (this one); auth/wrong-password is the
// older pre-protection code, matched too so this stays correct if that
// setting is ever turned off. Used ONLY in the delete-reauth path below --
// see showDeleteFailure for why this one case earns its own copy instead of
// authErrors.js's generic mapping.
const WRONG_PASSWORD_CODES = new Set(['auth/invalid-credential', 'auth/wrong-password']);

/** Enumerate one subcollection under users/{uid} and delete every document
 * in it, chunked to Firestore's per-batch write limit (defensive -- one
 * account's data is expected to stay far under it). Mirrors the helper of
 * the same name in firestoreSync.ts, and exists here for the same reason it
 * does there: the sessions sweep needs this loop too, and a third hand-rolled
 * copy of a batch-commit loop is a third place to get the chunking wrong. */
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
 * require -- see points 2 and 3 of this file's header.
 *
 * `onIrreversible` fires the instant the first delete lands, because that is
 * the instant "nothing happened, try again" stops being a true thing to tell
 * the user. runDeleteAccount uses it to choose which message a later failure
 * gets; without it, a failure mid-cascade would be reported with the same
 * copy as one that touched nothing. */
async function deleteFirestoreData(db, uid, onIrreversible) {
  // FIRST, and load-bearing rather than tidy (header point 2): this is the
  // delete that opens the window firestore.rules requires for the session
  // sweep at the bottom of this function.
  await deleteDoc(doc(db, 'users', uid));
  onIrreversible();
  for (const sub of DELETABLE_SUBCOLLECTIONS) {
    await deleteSubcollection(db, uid, sub);
  }
  // Sessions go last, and are the one sweep permitted to fail.
  //
  // firestore.rules is deployed separately from this page -- `firebase deploy
  // --only firestore:rules` is its own command -- so a dashboard build can be
  // live before the ruleset that lets it purge sessions is. Then these
  // deletes come back permission-denied, and letting that throw would abandon
  // the flow with users/{uid} already gone and the Auth user still alive:
  // strictly worse than the orphaning this replaced, and on the one path the
  // user cannot retry from a clean state. Swallowing it degrades to exactly
  // the old behaviour instead, and the warning is the signal that a rules
  // deploy is overdue. Same reasoning, same try/catch, as deleteAllUserData.
  try {
    await deleteSubcollection(db, uid, 'sessions');
  } catch (e) {
    console.warn('[phonebox] session history not purged on account deletion:', (e && e.message) || e);
  }
}

/** Picks the ONE already-linked provider to re-authenticate with. deleteUser()
 * removes the Auth user and every linked provider association in a single
 * call, so running each linked provider's flow would double- (or triple-)
 * prompt for one deletion. The preference order google > apple > password
 * mirrors useAuthStore.deleteAccount's own tie-break, which is what keeps an
 * OAuth user's flow unchanged by password existing as an option: they never
 * see a new prompt because of it, and password is only ever chosen when it is
 * the sole linked method -- it is the one provider with no popup this module
 * can raise on its own, so the confirm box has to collect it up front (see
 * buildDeleteConfirm). */
function chosenReauthProviderId(user) {
  const ids = user.providerData.map((p) => p.providerId);
  if (ids.includes('google.com')) return 'google.com';
  if (ids.includes('apple.com')) return 'apple.com';
  if (ids.includes('password')) return 'password';
  // Nothing recognized -- fall back to Google, which is what this chose
  // before password was an option at all. What it must NOT do is land on
  // 'password' by exhaustion and demand a password from an account that has
  // none: that would make deletion impossible rather than merely awkward.
  return 'google.com';
}

/** Step 1, and the only step the user can cancel: prove the account holder is
 * present, BEFORE anything destructive runs (header point 1). A failure here
 * -- dismissed popup, wrong password, anything -- aborts the deletion with
 * nothing deleted. */
async function reauthenticateForDeletion(user, password) {
  const providerId = chosenReauthProviderId(user);
  if (providerId === 'password') {
    if (!user.email) {
      // Should be unreachable: every password-linked Firebase user has an
      // email from account creation. Thrown rather than skipped, because
      // skipping would let the destructive phase below start with nothing
      // having actually proven the user's presence.
      throw new Error('This account has no email address to re-authenticate with.');
    }
    // The address comes from Firebase, not from a field on this page: the user
    // is already signed in, so the only secret worth asking for is the
    // password. It is used once, here, and never stored, echoed, or logged.
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    return;
  }
  await reauthenticateWithPopup(
    user,
    providerId === 'apple.com' ? new OAuthProvider('apple.com') : new GoogleAuthProvider(),
  );
}

/** One retry on auth/requires-recent-login and one only -- mirrors
 * useAuthStore.ts's deleteWithReauthRetry. Every other error is rethrown
 * immediately without a second prompt: nothing destructive has run yet, so
 * aborting costs the user nothing, and silently re-opening a popup the user
 * just dismissed reads as the page fighting them. */
async function withReauthRetry(run) {
  try {
    await run();
  } catch (err) {
    if (!err || err.code !== 'auth/requires-recent-login') throw err;
    await run();
  }
}

/** The three ways a deletion can fail, which must not share one message:
 * nothing was touched, the password was wrong, or the data is already gone. */
function showDeleteFailure(els, err, dataGone, usedPassword) {
  if (dataGone) {
    // The one abnormal outcome this flow can produce, and the reason it gets
    // its own copy: the cloud data really is gone, so the generic "please try
    // again" would tell the user the opposite of what happened. Retrying IS
    // the right next step -- the cascade is safe to re-enter, since
    // users/{uid} is already absent and the remaining sweeps just finish --
    // but not before the user is told what already went. Mirrors
    // DangerZoneSection.tsx's AccountDataWipedError branch.
    logAuthError('account deletion after data wipe', err);
    showMessage(
      els.accountMsg,
      'Your cloud data was deleted, but we could not finish removing your account. '
        + 'Please try Delete account again.',
      { kind: 'err', autoDismissMs: 12000 },
    );
    return;
  }
  if (isIgnorableAuthError(err)) {
    // The re-auth popup was dismissed. Because re-auth now runs first, that
    // means nothing was deleted and there is genuinely nothing to report --
    // the user can just retry. While the wipe ran first, this same silent
    // branch is what hid a completed data loss behind an empty screen.
    return;
  }
  if (usedPassword && WRONG_PASSWORD_CODES.has(err && err.code)) {
    // The one case named instead of handed to friendlyErrorMessage, and only
    // inside the password path so an OAuth deletion can never reach it.
    // authErrors.js maps auth/invalid-credential to sign-in copy that points
    // at login.html's "Forgot password?" button, which does not exist on this
    // page -- and "please try again" invites retrying the same wrong password
    // forever, the one retry that can never work. Naming it leaks nothing:
    // the user is already signed in as this account, so there is no
    // account-existence to disclose the way a signed-out form would have.
    logAuthError('account deletion reauth', err);
    showMessage(els.accountMsg, 'Incorrect password. Please try again.', { kind: 'err', autoDismissMs: 8000 });
    return;
  }
  logAuthError('account deletion', err);
  showMessage(els.accountMsg, friendlyErrorMessage(err), { kind: 'err', autoDismissMs: 8000 });
}

async function runDeleteAccount(user, els, ctx, controls) {
  controls.input.disabled = true;
  controls.cancel.disabled = true;
  controls.confirmBtn.disabled = true;
  if (controls.password) controls.password.disabled = true;
  // Read once, here, and passed straight through to the credential below --
  // never kept on this module, never put in a log line.
  const password = controls.password ? controls.password.value : undefined;
  // Flips the moment the cascade's first delete lands. Everything before that
  // point aborts harmlessly; everything after it has already destroyed data,
  // and the two cases cannot share a message (see showDeleteFailure).
  let dataGone = false;
  try {
    // Step 1: prove the user is present (header point 1). Throws on a
    // cancelled popup or a wrong password, leaving everything below untouched.
    await withReauthRetry(() => reauthenticateForDeletion(user, password));
    // Step 2: only now is anything destroyed.
    await deleteFirestoreData(ctx.getDb(), user.uid, () => {
      dataGone = true;
    });
    // Step 3: the Auth user goes last (header point 3). No re-auth fallback
    // here on purpose -- step 1 already proved presence seconds ago, so a
    // failure at this point is a real failure, and re-prompting would ask for
    // two authentications for one deletion.
    await deleteUser(user);
    // Success: onAuthStateChanged (dashboard.js) observes the now-null user
    // and redirects to login.html on its own -- no manual redirect needed
    // here, and nothing left to render on this panel.
  } catch (err) {
    showDeleteFailure(els, err, dataGone, controls.password != null);
    controls.input.disabled = false;
    controls.cancel.disabled = false;
    controls.input.value = '';
    controls.confirmBtn.disabled = true;
    if (controls.password) {
      controls.password.disabled = false;
      controls.password.value = '';
    }
  }
}

/** Builds the second-step confirm box: warning copy, a "type DELETE" input
 * gating the destructive button, a password field for the one account type
 * that has no popup to re-authenticate with, Cancel, and the destructive
 * action itself. `onCancel` is accountPanel.js's own responsibility (clears
 * its openConfirmKey singleton and re-renders the panel) -- kept as a
 * callback rather than this module reaching back into that module's state, so
 * the two files don't need a circular import. */
export function buildDeleteConfirm(user, els, ctx, onCancel) {
  const box = document.createElement('div');
  box.className = 'acct__confirm';

  const warning = document.createElement('p');
  // Copy pinned to account-spec.md §4, and it has to describe what the
  // cascade above actually does. The old version promised "your session
  // history stays in the cloud but is orphaned", which was true only while
  // the rules refused session deletes; sessions are swept now (header point
  // 2), and a stale promise that data SURVIVES deletion is the worst kind to
  // leave standing on a destructive confirm.
  warning.textContent = 'This permanently deletes your account and its cloud data: profile, settings, '
    + 'custom labels, focus goals, linked devices, and your focus session history. The physical Phone Box '
    + 'and anything stored locally on this phone are not affected. This cannot be undone.';
  box.appendChild(warning);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'acct__confirm-input';
  input.placeholder = DELETE_CONFIRM_WORD;
  input.setAttribute('aria-label', `Type ${DELETE_CONFIRM_WORD} to confirm account deletion`);
  input.autocomplete = 'off';
  box.appendChild(input);

  // Shown only when password is the provider this deletion will reauthenticate
  // with -- i.e. when it is the only one linked. Google/Apple accounts prove
  // presence through their own popup and must never be asked for a password
  // they may not even have. Collected here, in the box the user is already
  // filling in, because unlike a popup there is nothing this module can raise
  // on its own mid-flow: without the field, a password-only account could
  // never complete a deletion at all -- it hit requires-recent-login, found no
  // popup provider to retry with, and gave up.
  const needsPassword = chosenReauthProviderId(user) === 'password';
  let password = null;
  if (needsPassword) {
    const note = document.createElement('p');
    note.textContent = 'This account signs in with a password. Enter it to confirm deletion.';
    box.appendChild(note);
    password = document.createElement('input');
    password.type = 'password';
    password.className = 'acct__confirm-input';
    password.placeholder = 'Password';
    password.setAttribute('aria-label', 'Password, to confirm account deletion');
    // current-password (not off): this is a real credential prompt for an
    // existing account, so a password manager should be allowed to fill it --
    // the same field semantics login.html's sign-in mode uses.
    password.autocomplete = 'current-password';
    box.appendChild(password);
  }

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

  // Both gates, not just the typed word: with an empty password the flow would
  // spend the user's confirmation on a re-auth that cannot succeed, and the
  // failure would read as a rejection rather than a field they missed.
  const syncConfirmEnabled = () => {
    confirmBtn.disabled = input.value !== DELETE_CONFIRM_WORD || (needsPassword && password.value === '');
  };
  input.addEventListener('input', syncConfirmEnabled);
  if (password) password.addEventListener('input', syncConfirmEnabled);
  confirmBtn.addEventListener('click', () => runDeleteAccount(user, els, ctx, {
    input, cancel, confirmBtn, password,
  }));

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
