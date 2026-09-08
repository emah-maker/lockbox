/* =========================================================================
   emailAuthForm.js -- the email/password half of login.html's sign-in gate,
   split out of login.js (which stays under this project's 500-line
   guideline) since a real form with three modes (sign in, create account,
   reset password) is a distinct, self-contained piece of behavior from the
   Google/Apple popup flow login.js already owns.

   One <form> serves all three modes rather than three separate markup
   blocks -- same reasoning as goalForm.js's single builder for create+edit:
   the fields are almost entirely shared (email is common to all three,
   password to two of them), so three copies would only be three places to
   keep the same behavior correct. setMode() below is the only place that
   knows which fields/labels/autocomplete a given mode needs; every handler
   after it just reads the current `mode`.

   Email Enumeration Protection is enabled on this Firebase project (see
   authErrors.js's 'auth/invalid-credential' entry, and
   app/src/auth/accountLinking.ts for the same constraint on the app side):
   signInWithEmailAndPassword can't tell a caller whether a failure was a
   wrong password or no such account, and fetchSignInMethodsForEmail always
   returns []. Nothing here tries to work around that -- the copy in
   authErrors.js is written to stay accurate for both cases, and the
   password-reset confirmation below is worded to never confirm or deny
   that an account exists.
   ========================================================================= */
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { friendlyErrorMessage, logAuthError } from './authErrors.js';
import { showMessage } from './dashMessage.js';

const els = {
  form: document.getElementById('emailAuthForm'),
  email: document.getElementById('authEmail'),
  passwordField: document.getElementById('authPasswordField'),
  password: document.getElementById('authPassword'),
  confirmField: document.getElementById('authConfirmField'),
  confirm: document.getElementById('authPasswordConfirm'),
  error: document.getElementById('authFormError'),
  submitBtn: document.getElementById('authSubmitBtn'),
  forgotBtn: document.getElementById('authForgotBtn'),
  toggleModeBtn: document.getElementById('authToggleModeBtn'),
};

// A loose shape check only -- "does this look like an email", not RFC 5322
// validation. The SDK is still the real authority: a string that passes
// this but isn't a real address surfaces as auth/invalid-email from
// signIn/createUser below, via the same friendlyErrorMessage() path as
// every other rejection.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let mode = 'signin'; // 'signin' | 'signup' | 'reset'

// createUserWithEmailAndPassword signs the new user in immediately, which
// fires login.js's onAuthStateChanged and redirects to dashboard.html --
// possibly before the next line here even runs, since that listener has no
// idea a verification email is also trying to go out. Left to race, the
// redirect's navigation can abort the sendEmailVerification request before
// it leaves the browser. login.js awaits this (via awaitPendingVerification)
// right before its redirect so the send always gets a chance to complete;
// it defaults to an already-resolved promise so every other sign-in path
// (Google, Apple, an existing session, plain email sign-in) redirects with
// no added delay. Always resolves, never rejects -- the signup branch below
// swallows a failed send and releases this from a `finally` -- so it can
// never itself block the redirect it's guarding.
let pendingVerification = Promise.resolve();

export function awaitPendingVerification() {
  return pendingVerification;
}

function clearError() {
  els.error.hidden = true;
  els.error.classList.remove('is-in');
  els.error.textContent = '';
}

// The one function that knows what each of the three modes actually looks
// like. Hidden fields drop out of .dash__auth-form's flex layout entirely
// (styles.css's global `[hidden] { display: none }`), so no extra spacing
// bookkeeping is needed here when a field disappears.
function setMode(next) {
  mode = next;
  els.passwordField.hidden = mode === 'reset';
  els.password.required = mode !== 'reset';
  // current-password vs new-password matters to browser/OS credential
  // managers -- getting it wrong is how a password manager offers to save a
  // signup's brand-new password under the wrong entry, or declines to
  // suggest one at all.
  els.password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  els.confirmField.hidden = mode !== 'signup';
  els.confirm.required = mode === 'signup';
  els.forgotBtn.hidden = mode !== 'signin';
  els.toggleModeBtn.textContent =
    mode === 'signup' ? 'Already have an account? Sign in'
    : mode === 'reset' ? 'Back to sign in'
    : 'Need an account? Create one';
  els.submitBtn.textContent = mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in';
  clearError();
}

// Only what the SDK can't already tell us more specifically -- the shape of
// the email, the 6-character floor Firebase itself enforces (so a
// too-short password never even reaches the network), and that the two
// password fields match on signup. Everything else (wrong password, no
// such account, email already registered) is left to the SDK's own
// rejection so the copy in authErrors.js stays the single source of truth
// for it.
function validationError() {
  const email = els.email.value.trim();
  if (!email || !EMAIL_RE.test(email)) return 'Enter a valid email address.';
  if (mode === 'reset') return null;
  if (els.password.value.length < 6) return 'Password must be at least 6 characters.';
  if (mode === 'signup' && els.password.value !== els.confirm.value) return 'Passwords don’t match.';
  return null;
}

export function initEmailAuthForm(auth) {
  setMode('signin');

  els.forgotBtn.addEventListener('click', () => setMode('reset'));
  els.toggleModeBtn.addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const problem = validationError();
    if (problem) {
      showMessage(els.error, problem, { kind: 'err' });
      return;
    }

    const email = els.email.value.trim();
    els.submitBtn.disabled = true;
    try {
      if (mode === 'signin') {
        await signInWithEmailAndPassword(auth, email, els.password.value);
        // Left disabled: login.js's onAuthStateChanged is about to navigate
        // away, and a control that stays visible-but-inert through that
        // wait is simpler than re-enabling it just before it disappears.
      } else if (mode === 'signup') {
        // Armed BEFORE the call, not from its result: the SDK notifies
        // onAuthStateChanged observers from inside
        // createUserWithEmailAndPassword, before the promise it returns
        // settles for this caller. A barrier assigned on the line after the
        // await is therefore assigned too late -- login.js's redirect would
        // already have read the default resolved promise and navigated,
        // which is the exact abort this guard exists to prevent. Assigning
        // it first makes the SDK's internal ordering irrelevant.
        let releaseVerification;
        pendingVerification = new Promise((resolve) => {
          releaseVerification = resolve;
        });
        try {
          const cred = await createUserWithEmailAndPassword(auth, email, els.password.value);
          // Best-effort: the account itself is already created by this
          // point, so a failed send is logged, not shown -- telling the user
          // signup failed would be wrong. They have no in-app way to request
          // another yet (no account-panel action for it today); a reasonable
          // follow-up, not something this form can fix by waiting longer.
          await sendEmailVerification(cred.user).catch((err) => {
            logAuthError('send-email-verification', err);
          });
        } finally {
          // Also runs on the createUser failure path, where no observer ever
          // fired and nothing is waiting -- releasing an unawaited barrier is
          // a no-op, whereas leaving it pending would stall the redirect of
          // whichever sign-in succeeded next for the life of the page.
          releaseVerification();
        }
      } else {
        await sendPasswordResetEmail(auth, email);
        // Deliberately non-committal either way -- see this file's header.
        // Firebase resolves this call identically whether or not the
        // address has an account, so confirming existence here would just
        // be this code re-introducing the enumeration leak the SDK avoids.
        showMessage(els.error, 'If an account exists for that address, a reset link is on its way.', { kind: 'ok' });
        els.submitBtn.disabled = false;
      }
    } catch (err) {
      logAuthError(`email-auth:${mode}`, err);
      showMessage(els.error, friendlyErrorMessage(err), { kind: 'err' });
      els.submitBtn.disabled = false;
    }
  });
}
