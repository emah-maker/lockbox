/* =========================================================================
   dashMessage.js -- tiny shared DOM+string helper for the dashboard's inline
   status messages (#dashWriteError, #dashLabelsMsg). Pure DOM/string logic,
   no Firebase import -- same "pure logic, no side-channel dependency" split
   as focusStats.js, just for message plumbing instead of stat math, so this
   one small piece of behavior (fade in, auto-dismiss fade out, error-code ->
   copy) isn't duplicated between dashboard.js (surface A's write-error
   banner) and labelsPanel.js (surface B/C's success+error messages).
   ========================================================================= */
import { friendlyErrorMessage } from './authErrors.js';

// How long the fade-out transition itself takes (see dashboard.css's
// .dash__msg) -- used to delay actually blanking the text/re-hiding the
// element until after the exit transition has visually finished, so
// autoDismiss doesn't snap the text away mid-fade. No separate
// reduced-motion branch needed: styles.css's global prefers-reduced-motion
// rule already collapses the CSS transition duration to ~0, so this wait is
// imperceptible either way.
const FADE_OUT_MS = 220;

const timers = new WeakMap();

/** Sets `el`'s text and shows it via the shared .dash__msg fade idiom (the
 * same "remove hidden, flush layout, add is-in" technique dashboard.js's
 * showState() uses), replacing any prior auto-dismiss timer for that
 * element. `kind` toggles the existing .form-msg is-ok/is-err color
 * classes; `autoDismissMs`, if given, fades the message back out and clears
 * it after that delay. */
export function showMessage(el, text, { kind = 'ok', autoDismissMs } = {}) {
  const existing = timers.get(el);
  if (existing) {
    clearTimeout(existing.hideTimer);
    clearTimeout(existing.blankTimer);
    timers.delete(el);
  }

  el.textContent = text;
  el.className = `form-msg dash__msg ${kind === 'err' ? 'is-err' : 'is-ok'}`;
  el.hidden = false;
  el.classList.remove('is-in');
  void el.offsetHeight; // flush hidden -> laid-out start state so .is-in transitions
  el.classList.add('is-in');

  if (!autoDismissMs) return;
  const record = { hideTimer: null, blankTimer: null };
  record.hideTimer = setTimeout(() => {
    el.classList.remove('is-in');
    record.blankTimer = setTimeout(() => {
      el.hidden = true;
      el.textContent = '';
      timers.delete(el);
    }, FADE_OUT_MS);
  }, autoDismissMs);
  timers.set(el, record);
}

/** Firebase SDK errors carry a `.code` (permission-denied, unavailable, ...)
 * that authErrors.js already has copy for; the focusStats.js catalog
 * mutators (createCustomLabel/renameCustomLabel/recolorCustomLabel) throw
 * plain Errors with their own human-readable `.message` that should surface
 * as-is. Moved verbatim from dashboard.js's former errorMessage(). */
export function describeWriteError(err) {
  return err && err.code ? friendlyErrorMessage(err) : (err && err.message) || 'Something went wrong. Please try again.';
}
