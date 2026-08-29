/* =========================================================================
   dom.js — the DOM helpers every panel on this site needs, in one place.

   Both of these were previously copy-pasted per module: `clear` existed
   byte-identically in five files (dashboard.js, goalsPanel.js, labelsPanel.js,
   accountPanel.js, sessionLabelPicker.js) and `swap` in two (goalsPanel.js,
   labelsPanel.js). Same shape as the site's other small shared modules
   (dashMessage.js, authErrors.js): no state, no imports, safe for any of the
   panels to pull in.
   ========================================================================= */

/** Removes every child of `el`.
 *
 * `removeChild` in a loop rather than `el.innerHTML = ''`: this site re-renders
 * whole lists on every write, and innerHTML re-parses the assignment as markup,
 * which is both slower and the wrong tool for "empty this node" — nothing here
 * ever wants string parsing. */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Hides `hideEl` and reveals `showEl` with the shared `.is-in` enter
 * transition — the row/confirm toggle behind every destructive confirm on the
 * dashboard.
 *
 * The `void showEl.offsetHeight` is a deliberate forced reflow, not dead code:
 * the element is unhidden and has `is-in` removed in the same frame, so
 * without flushing layout in between the browser coalesces both changes and
 * the transition never runs. Reading `offsetHeight` is what commits the
 * pre-transition state so re-adding the class animates. */
export function swap(hideEl, showEl) {
  hideEl.hidden = true;
  hideEl.classList.remove('is-in');
  showEl.hidden = false;
  showEl.classList.remove('is-in');
  void showEl.offsetHeight;
  showEl.classList.add('is-in');
}
