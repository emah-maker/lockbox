/* =========================================================================
   labelsPanel.js -- owns the "Manage labels" catalog CRUD panel end-to-end:
   the list render, the add-label form (always-visible 12-swatch picker +
   name input), the per-row recolor popover (compact trigger + the same
   12-swatch set), inline rename, inline delete-confirm, the at-capacity
   swap, and every setDoc/createCustomLabel/renameCustomLabel/
   recolorCustomLabel/deleteCustomLabel write. Split out of dashboard.js so
   this one bounded feature's render + write logic live together in one
   file (see sessionLabelPicker.js's header comment for the same rationale).

   Firestore write shape is unchanged: settings/app has no scoped `update`
   rule, so every write here still resends the full syncable-settings
   payload (themeMode/accent/callAlertsEnabled) alongside the new
   customLabels array, exactly like the app's own localSettingsPayload().
   ========================================================================= */
import {
  setDoc,
  doc,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  createCustomLabel,
  renameCustomLabel,
  recolorCustomLabel,
  deleteCustomLabel,
  LABEL_SWATCHES,
  MAX_CUSTOM_LABELS,
  MAX_LABEL_NAME_LENGTH,
} from './focusStats.js';
import { showMessage, describeWriteError } from './dashMessage.js';
import { clear, swap } from './dom.js';


// Module-scoped: only one recolor popover can be open at a time, and only
// one add-label swatch selection is in progress at a time -- both are
// singletons for the page, not per-row state.
let openPopover = null; // { pop, trigger } | null
let addSelectedColor = null;
let lastAtCap = null;

function closePopover() {
  if (!openPopover) return;
  const { pop, trigger } = openPopover;
  pop.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
  openPopover = null;
}

function closePopoverAndRefocus() {
  const prior = openPopover;
  closePopover();
  if (prior) prior.trigger.focus();
}

/** Whole-document write of the customLabels catalog. `ctx.getDb()`/
 * `ctx.getUid()` are getters (not static values) because mountLabelsPanel
 * is wired once at page init, before sign-in resolves dashDb/dashUid in
 * dashboard.js -- a plain captured value would be stale/null forever. */
async function writeCustomLabels(next, ctx) {
  const settings = ctx.getSettings();
  await setDoc(doc(ctx.getDb(), 'users', ctx.getUid(), 'settings', 'app'), {
    themeMode: settings.themeMode,
    accent: settings.accent,
    callAlertsEnabled: settings.callAlertsEnabled,
    customLabels: next,
    updatedAt: Date.now(),
  });
  ctx.onWritten(next); // triggers dashboard.js's renderDataViews -> renderLabelsList
}

function buildSwatchOption(hex, { pressed, onPick }) {
  const opt = document.createElement('button');
  opt.type = 'button';
  opt.className = 'dash__swatch-opt';
  opt.style.background = hex;
  opt.setAttribute('aria-pressed', String(pressed));
  opt.setAttribute('aria-label', `Color ${hex}`);
  // No extra keydown handling needed for Enter/Space -- a native <button>
  // already fires `click` for both, and Tab already moves between these
  // buttons in DOM order; this satisfies "keyboard operable" without a
  // hand-rolled roving-tabindex arrow-key scheme (see the ARIA-role note
  // in the designer's spec for why a full menu widget is skipped here).
  opt.addEventListener('click', () => onPick(hex, opt));
  return opt;
}

function buildLabelRow(label, customLabels, els, ctx) {
  const li = document.createElement('li');
  li.className = 'dash__labels-row';
  li.dataset.labelId = label.id;

  // ---------- main face: swatch trigger, name input, delete (x) ----------
  const main = document.createElement('div');
  main.className = 'dash__labels-row-main dash__pick-fade is-in';

  const swatchWrap = document.createElement('div');
  swatchWrap.className = 'dash__labels-swatch-wrap';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'dash__labels-swatch';
  trigger.style.background = label.color;
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', `Change color for ${label.name}`);

  const pop = document.createElement('div');
  pop.className = 'dash__swatch-pop';
  pop.hidden = true;
  for (const hex of LABEL_SWATCHES) {
    pop.appendChild(buildSwatchOption(hex, {
      pressed: hex === label.color,
      onPick: async (hex_) => {
        closePopover();
        try {
          const next = recolorCustomLabel(customLabels, label.id, hex_);
          await writeCustomLabels(next, ctx);
          // A successful write re-renders the whole list (settings/app has
          // no scoped update, so every row is rebuilt) -- re-query the
          // fresh trigger by its stable data-label-id hook rather than
          // using the (now-detached) local `trigger` reference.
          const fresh = document.querySelector(`[data-label-id="${label.id}"] .dash__labels-swatch`);
          if (fresh) {
            fresh.classList.add('dash__save-flash');
            fresh.focus();
          }
        } catch (err) {
          // No rerender happened -- the local nodes are still live.
          showMessage(els.labelsMsg, describeWriteError(err), { kind: 'err', autoDismissMs: 4000 });
          trigger.classList.add('dash__save-flash', 'dash__save-flash--err');
          trigger.focus();
        }
      },
    }));
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openPopover && openPopover.pop === pop) {
      closePopover();
      return;
    }
    closePopover();
    pop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    openPopover = { pop, trigger };
  });
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openPopover && openPopover.pop === pop) {
      e.stopPropagation();
      closePopoverAndRefocus();
    }
  });
  // Escape from inside the popover (focus moved to a swatch option via Tab)
  // also closes it and returns focus to the trigger.
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePopoverAndRefocus();
    }
  });

  swatchWrap.append(trigger, pop);

  const name = document.createElement('input');
  name.type = 'text';
  name.className = 'dash__labels-name';
  name.value = label.name;
  name.maxLength = MAX_LABEL_NAME_LENGTH;
  name.setAttribute('aria-label', `Rename ${label.name}`);
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); name.blur(); } // explicit commit
    if (e.key === 'Escape') { name.value = label.name; name.blur(); } // explicit discard
  });
  name.addEventListener('change', async () => {
    const original = label.name;
    name.disabled = true;
    name.classList.add('dash__chip-select--saving');
    try {
      const next = renameCustomLabel(customLabels, label.id, name.value);
      await writeCustomLabels(next, ctx);
      showMessage(els.labelsMsg, 'Label renamed.', { kind: 'ok', autoDismissMs: 4000 });
      const fresh = document.querySelector(`[data-label-id="${label.id}"] .dash__labels-name`);
      if (fresh) fresh.classList.add('dash__save-flash');
    } catch (err) {
      name.value = original;
      name.disabled = false;
      name.classList.remove('dash__chip-select--saving');
      name.classList.add('dash__save-flash', 'dash__save-flash--err');
      showMessage(els.labelsMsg, describeWriteError(err), { kind: 'err', autoDismissMs: 4000 });
    }
  });

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'dash__label-delete';
  del.textContent = '×';
  del.setAttribute('aria-label', `Delete ${label.name}`);

  main.append(swatchWrap, name, del);

  // ---------- confirm face: inline delete confirmation, swaps in for main ----------
  const confirm = document.createElement('div');
  confirm.className = 'dash__labels-confirm dash__pick-fade';
  confirm.hidden = true;

  const confirmText = document.createElement('span');
  confirmText.className = 'dash__labels-confirm-text';
  confirmText.textContent = `Delete "${label.name}"? Sessions already tagged with it will show as untagged.`;

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn--sm btn--ghost dash__labels-confirm-cancel';
  cancelBtn.textContent = 'Cancel';

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'dash__labels-confirm-delete';
  deleteBtn.textContent = 'Delete';

  confirm.append(confirmText, cancelBtn, deleteBtn);

  del.addEventListener('click', () => {
    swap(main, confirm);
    cancelBtn.focus(); // the safe default gets focus for a destructive action
  });
  cancelBtn.addEventListener('click', () => {
    swap(confirm, main);
    del.focus();
  });
  confirm.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      swap(confirm, main);
      del.focus();
    }
  });
  deleteBtn.addEventListener('click', async () => {
    // Same disable-during-write treatment as the rename input/recolor
    // trigger above -- a successful delete tears this row down anyway, but
    // disabling first still matters: it blocks a double-click from firing
    // two overlapping deleteCustomLabel writes while the first is in flight.
    deleteBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      const idx = customLabels.findIndex((l) => l.id === label.id);
      const next = deleteCustomLabel(customLabels, label.id);
      await writeCustomLabels(next, ctx);
      showMessage(els.labelsMsg, 'Label deleted.', { kind: 'ok', autoDismissMs: 4000 });
      focusAfterDelete(els, next, idx);
    } catch (err) {
      deleteBtn.disabled = false;
      cancelBtn.disabled = false;
      showMessage(els.labelsMsg, describeWriteError(err), { kind: 'err', autoDismissMs: 4000 });
    }
  });

  li.append(main, confirm);
  return li;
}

/** After a successful delete, `renderLabelsList` has already rebuilt the
 * list -- land focus on the delete button of the row now at the same
 * index (or the previous index if the deleted row was last), or on the
 * add-label name field if the catalog is now empty, rather than letting
 * focus silently fall back to <body>. */
function focusAfterDelete(els, nextLabels, deletedIdx) {
  if (nextLabels.length === 0) {
    els.labelAddName.focus();
    return;
  }
  const idx = Math.min(deletedIdx, nextLabels.length - 1);
  const targetId = nextLabels[idx].id;
  const btn = els.labelsList.querySelector(`[data-label-id="${targetId}"] .dash__label-delete`);
  if (btn) btn.focus();
}

function updateAddSubmitState(els) {
  const hasName = els.labelAddName.value.trim().length > 0;
  els.labelAddSubmit.disabled = !(hasName && addSelectedColor);
}

/** Toggles the add-form vs. the at-capacity message via the same
 * .dash__pick-fade swap technique used elsewhere, only actually animating
 * when the at-capacity state changes (not on every unrelated re-render). */
function renderCapState(els, atCap) {
  const changed = lastAtCap !== atCap;
  lastAtCap = atCap;
  els.labelAddForm.hidden = atCap;
  els.labelsCapMsg.hidden = !atCap;
  const showEl = atCap ? els.labelsCapMsg : els.labelAddForm;
  showEl.classList.remove('is-in');
  if (changed) void showEl.offsetHeight;
  showEl.classList.add('is-in');
}

/** Re-renders the <ul> list + add-form/at-capacity toggle. Called from
 * dashboard.js's renderDataViews exactly where it used to call the local
 * renderLabelsList(customLabels). */
export function renderLabelsList(customLabels, els, ctx) {
  // clear() below tears down every row, including whichever one owns the
  // currently-open recolor popover (if any) -- renderDataViews calls this on
  // every write across the whole page (a session relabel, a goal edit, an
  // appearance change), not only on a labels-catalog write, so a popover can
  // easily still be "open" in this module's own bookkeeping at the moment an
  // unrelated re-render blows its DOM away. Left uncleared, openPopover would
  // keep pointing at detached nodes: the outside-click listener would still
  // "close" them (harmlessly, since they're gone), but any actual popover
  // opened next would only self-heal on its own click handler's mismatch
  // check rather than starting from a known-clean slate.
  openPopover = null;
  clear(els.labelsList);
  renderCapState(els, customLabels.length >= MAX_CUSTOM_LABELS);

  if (customLabels.length === 0) {
    const li = document.createElement('li');
    li.className = 'dash__labels-empty';
    li.textContent = 'No custom labels yet -- add one below, or create one from the Phone Box app.';
    els.labelsList.appendChild(li);
    return;
  }

  for (const label of customLabels) {
    els.labelsList.appendChild(buildLabelRow(label, customLabels, els, ctx));
  }
}

/** One-time wiring: builds the add-form's 12-swatch row, attaches its
 * submit handler, and registers the single delegated document-click
 * listener that closes an open recolor popover on an outside click. Call
 * once from dashboard.js's init(), after `els` is resolved.
 *   ctx = {
 *     getDb(), getUid(),         // live getters -- see writeCustomLabels's comment
 *     getSettings(),             // -> { themeMode, accent, callAlertsEnabled }
 *     getCustomLabels(),         // -> current customLabels array
 *     onWritten(nextLabels),     // re-renders the data views after a successful write
 *   }
 */
export function mountLabelsPanel(els, ctx) {
  for (const hex of LABEL_SWATCHES) {
    const opt = buildSwatchOption(hex, {
      pressed: false,
      onPick: (hex_, opt_) => {
        addSelectedColor = hex_;
        for (const child of els.labelAddSwatches.children) {
          child.setAttribute('aria-pressed', String(child === opt_));
        }
        updateAddSubmitState(els);
      },
    });
    els.labelAddSwatches.appendChild(opt);
  }

  els.labelAddName.addEventListener('input', () => updateAddSubmitState(els));

  els.labelAddForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const next = createCustomLabel(ctx.getCustomLabels(), els.labelAddName.value, addSelectedColor);
      await writeCustomLabels(next, ctx);
      els.labelAddName.value = '';
      addSelectedColor = null;
      for (const child of els.labelAddSwatches.children) child.setAttribute('aria-pressed', 'false');
      updateAddSubmitState(els);
      showMessage(els.labelsMsg, 'Label added.', { kind: 'ok', autoDismissMs: 4000 });
    } catch (err) {
      showMessage(els.labelsMsg, describeWriteError(err), { kind: 'err', autoDismissMs: 4000 });
    }
  });

  // Single delegated listener (not one per row) so opening/closing a
  // popover never attaches/detaches document-level handlers.
  document.addEventListener('click', (e) => {
    if (openPopover && !e.target.closest('.dash__labels-swatch-wrap')) {
      closePopover();
    }
  });

  updateAddSubmitState(els);
}
