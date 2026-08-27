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
import { firebaseConfig, isFirebaseConfigured } from './firebaseConfig.js';
import { friendlyErrorMessage, isIgnorableAuthError, logAuthError } from './authErrors.js';

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

function init() {
  if (!isFirebaseConfigured()) {
    showState('notConfigured');
    return;
  }

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);

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
      window.location.replace('dashboard.html');
      return;
    }
    showState('signedOut');
  });
}

init();
