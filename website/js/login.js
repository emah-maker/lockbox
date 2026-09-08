/* =========================================================================
   login.js -- the sign-in gate in front of dashboard.html. Owns the actual
   signInWithPopup call; dashboard.js only ever checks auth state and
   redirects here when signed out. Firebase Auth (Google or Apple) only --
   Firestore isn't touched on this page, that's dashboard.js's job once a
   user lands there signed in.
   ========================================================================= */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { loadFirebaseConfigOrNull } from './firebaseConfig.js';
import { initAppCheck } from './appCheck.js';
import { friendlyErrorMessage, isIgnorableAuthError, logAuthError } from './authErrors.js';
import { initEmailAuthForm, awaitPendingVerification } from './emailAuthForm.js';

const els = {
  notConfigured: document.getElementById('loginNotConfigured'),
  signedOut: document.getElementById('loginSignedOut'),
  error: document.getElementById('loginError'),
  errorMsg: document.getElementById('loginErrorMsg'),
  signInBtn: document.getElementById('signInBtn'),
  signInAppleBtn: document.getElementById('signInAppleBtn'),
  retryBtn: document.getElementById('loginRetryBtn'),
};

const STATES = ['notConfigured', 'signedOut', 'error'];
// Same crossfade convention as dashboard.js's showState (dashboard.css
// .dash__fade) -- remove `hidden`, flush layout, then add `is-in` so the
// transition actually fires instead of jumping straight to the end state.
function showState(name) {
  for (const s of STATES) {
    const el = els[s];
    if (s === name) {
      el.hidden = false;
      el.classList.remove('is-in');
      void el.offsetHeight;
      el.classList.add('is-in');
    } else {
      el.hidden = true;
      el.classList.remove('is-in');
    }
  }
}

function showError(err) {
  if (isIgnorableAuthError(err)) return;
  logAuthError('sign-in', err);
  els.errorMsg.textContent = friendlyErrorMessage(err);
  showState('error');
}

async function init() {
  // Fetched from Firebase Hosting rather than bundled -- see firebaseConfig.js.
  // Null means this page isn't being served by Hosting, which is the same
  // user-visible outcome as an unconfigured project: nothing to sign in to.
  const firebaseConfig = await loadFirebaseConfigOrNull();
  if (!firebaseConfig) {
    showState('notConfigured');
    return;
  }

  const app = initializeApp(firebaseConfig);
  // Must run before getAuth/signInWithPopup below touch the network -- see
  // appCheck.js's header. No-ops safely today (site key not registered yet).
  await initAppCheck(app);
  const auth = getAuth(app);
  initEmailAuthForm(auth);

  let lastProvider = () => new GoogleAuthProvider();
  const trySignIn = (makeProvider) => {
    if (makeProvider) lastProvider = makeProvider;
    signInWithPopup(auth, lastProvider()).catch(showError);
  };
  els.signInBtn.addEventListener('click', () => trySignIn(() => new GoogleAuthProvider()));
  els.signInAppleBtn.addEventListener('click', () => trySignIn(() => new OAuthProvider('apple.com')));
  els.retryBtn.addEventListener('click', () => trySignIn());

  onAuthStateChanged(auth, (user) => {
    if (user) {
      // Already signed in (e.g. navigated back here, or a second tab) --
      // the dashboard is the actual destination, this page is just the gate.
      // Waits on awaitPendingVerification() first: a just-completed signup
      // (emailAuthForm.js) fires this same listener, and without the wait
      // this redirect's navigation could abort that account's
      // sendEmailVerification request before it leaves the browser. Every
      // other path (Google, Apple, an existing session, plain email
      // sign-in) has nothing pending, so this resolves immediately for them.
      awaitPendingVerification().then(() => window.location.replace('dashboard.html'));
      return;
    }
    showState('signedOut');
  });
}

// init() is async now (it fetches the config); without this a throw inside
// it would surface only as an unhandled rejection.
init().catch((err) => showError(err));
