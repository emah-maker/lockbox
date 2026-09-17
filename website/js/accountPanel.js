/* =========================================================================
   accountPanel.js -- owns the "Account" panel end-to-end: sign-in-method
   status (provider chips, link/unlink), the data-freshness/"Refresh"
   status, the appearance (theme) picker, the Data & privacy statement, and
   the danger zone (sign out + two-step account deletion). Split out of
   dashboard.js for the same reason goalsPanel.js/labelsPanel.js already
   are -- one bounded feature's render + write logic living together in one
   file, kept out of dashboard.js so that file doesn't grow past the
   project's 500-line guideline (see account-spec.md, shared with the app's
   AccountSection.tsx).

   Unlike labelsPanel.js/goalsPanel.js, this module owns THREE different
   kinds of write against three different backends: a scoped Firestore
   setDoc (appearance, resending settings/app's other fields unchanged --
   same whole-doc convention labelsPanel.js's writeCustomLabels uses, since
   that doc still has no scoped `update` rule), Firebase Auth calls
   (linkWithPopup/unlink/deleteUser/reauthenticateWithPopup), and a
   multi-collection Firestore delete cascade. The deletion deliberately
   mirrors the app's own, which is split across two files:
   app/src/auth/useAuthStore.ts's deleteAccount for the step order
   (reauthenticate, THEN wipe Firestore, THEN remove the Auth user) and
   app/src/sync/firestoreSync.ts's deleteAllUserData for the cascade itself
   (same subcollections, same batch chunk size, parent users/{uid} doc
   deleted FIRST). Every one of those orderings is load-bearing rather than
   stylistic -- accountDelete.js's own header spells out which bug each one
   prevents, and account-spec.md §4 is the shared spec.

   ctx (built once in dashboard.js, passed to mountAccountPanel/
   renderAccountPanel) = {
     getAuth(), getDb(), getUid(),   // live getters -- see labelsCtx's comment
                                      // in dashboard.js for why these are
                                      // getters and not captured values
     getSettings(),                  // -> { themeMode, accent, callAlertsEnabled }
     getCustomLabels(),              // -> current customLabels array (resent
                                      //    unchanged on an appearance write)
     getLastLoadedAt(),              // -> ms epoch of the last successful
                                      //    Firestore load, or null
     onThemeWritten(themeMode, accent), // dashboard.js applies the new theme
                                      //    + re-renders the data views
     onRefresh(),                    // re-runs dashboard.js's loadDashboard
     onSignOut(),                    // dashboard.js's existing signOut(auth) path
   }
   ========================================================================= */
import {
  GoogleAuthProvider,
  OAuthProvider,
  linkWithPopup,
  unlink,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { resolveTheme, ACCENT_NAMES, DEFAULT_ACCENT } from './theme.js';
import { showMessage } from './dashMessage.js';
import { friendlyErrorMessage, isIgnorableAuthError, logAuthError } from './authErrors.js';
import { buildDeleteConfirm } from './accountDelete.js';
import { clear } from './dom.js';


// Module-scoped: only one destructive confirm (unlink or delete) can be open
// at a time on this panel -- same singleton reasoning as labelsPanel.js's
// openPopover. `null`, or the key of the open confirm ('delete', or the
// providerId being unlinked).
let openConfirmKey = null;

const PROVIDER_LABELS = { 'google.com': 'Google', 'apple.com': 'Apple' };
// Contract §1: anything not google.com/apple.com reads as "Other" rather
// than crashing on an unrecognized provider id (password, phone, etc. --
// none of which this app issues today, but a stale/foreign provider id
// should still render instead of throwing).
function providerLabel(id) {
  return PROVIDER_LABELS[id] || 'Other';
}

function shortDate(msOrIso) {
  if (!msOrIso) return 'Unknown';
  const d = new Date(msOrIso);
  return Number.isNaN(d.getTime()) ? 'Unknown' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" -- byte-for-byte the same
 * copy as the app's AccountSection.tsx formatRelative, so the two surfaces'
 * freshness captions read identically (account-spec.md's shared-model
 * requirement). */
function formatRelative(epochMs) {
  const diffMs = Date.now() - epochMs;
  const mins = Math.max(0, Math.round(diffMs / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/* ---------------------------------------------------------------------------
   Sign-in method status (contract §1)
   --------------------------------------------------------------------------- */
function buildSignInSection(user, els, ctx) {
  const section = document.createElement('div');
  section.className = 'acct__section';

  const name = document.createElement('div');
  name.className = 'acct__name';
  name.textContent = user.displayName || user.email || 'Signed in';
  section.appendChild(name);

  if (user.email) {
    const email = document.createElement('div');
    email.className = 'acct__email';
    email.textContent = user.email;
    if (!user.emailVerified) {
      const note = document.createElement('span');
      note.className = 'acct__email-unverified';
      note.textContent = ' (not verified)';
      email.appendChild(note);
    }
    section.appendChild(email);
  }

  const linkedIds = user.providerData.map((p) => p.providerId);
  const canUnlink = linkedIds.length >= 2; // never leave zero sign-in methods

  const label = document.createElement('div');
  label.className = 'acct__label';
  label.textContent = linkedIds.length > 1 ? 'Linked sign-in methods' : 'Sign-in method';
  section.appendChild(label);

  const chips = document.createElement('div');
  chips.className = 'acct__chips';
  for (const id of linkedIds) {
    const group = document.createElement('span');
    group.className = 'acct__chip-group';
    const chip = document.createElement('span');
    chip.className = 'dash__chip';
    // Was a fixed white-8% wash -- invisible on a light card, same theme-leak
    // class as dashboard.css's old .dash__breakdown-track/.dash__cal-navbtn
    // literals. var(--border-soft) is derived from t.text (dashboard.js's
    // applyTheme), so it flips with the mode for free; var(--text) already
    // reads fine against it either way, the same as every other border-soft
    // surface on this page (e.g. .dash__labels-name's input background).
    chip.style.background = 'var(--border-soft)';
    chip.style.color = 'var(--text)';
    chip.textContent = providerLabel(id);
    group.appendChild(chip);
    if (canUnlink) {
      if (openConfirmKey === id) {
        group.appendChild(buildUnlinkConfirm(id, user, els, ctx));
      } else {
        const unlinkBtn = document.createElement('button');
        unlinkBtn.type = 'button';
        unlinkBtn.className = 'acct__unlink-btn';
        unlinkBtn.textContent = 'Unlink';
        unlinkBtn.setAttribute('aria-label', `Unlink ${providerLabel(id)}`);
        unlinkBtn.addEventListener('click', () => {
          openConfirmKey = id;
          renderAccountPanel(user, els, ctx);
        });
        group.appendChild(unlinkBtn);
      }
    }
    chips.appendChild(group);
  }
  section.appendChild(chips);

  // Offer to link whichever of Google/Apple ISN'T already linked. Apple is
  // always offered on the web (contract §1: unlike the app, there's no
  // AppleAuthentication.isAvailableAsync() gate -- linkWithPopup works from
  // any browser).
  const missing = ['google.com', 'apple.com'].filter((id) => !linkedIds.includes(id));
  if (missing.length > 0) {
    const linkRow = document.createElement('div');
    linkRow.className = 'acct__linkrow';
    for (const id of missing) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--sm btn--ghost';
      btn.textContent = `Link ${providerLabel(id)}`;
      btn.addEventListener('click', () => handleLink(id, user, els, ctx));
      linkRow.appendChild(btn);
    }
    section.appendChild(linkRow);
  }

  const meta = document.createElement('div');
  meta.className = 'acct__meta';
  meta.textContent = `Account created ${shortDate(user.metadata.creationTime)} · Last sign-in ${shortDate(user.metadata.lastSignInTime)}`;
  section.appendChild(meta);

  return section;
}

function buildUnlinkConfirm(providerId, user, els, ctx) {
  const wrap = document.createElement('span');
  wrap.className = 'acct__inline-confirm';
  const text = document.createElement('span');
  text.textContent = `Unlink ${providerLabel(providerId)}?`;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'acct__unlink-btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    openConfirmKey = null;
    renderAccountPanel(user, els, ctx);
  });
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'acct__unlink-btn acct__unlink-btn--danger';
  confirmBtn.textContent = 'Unlink';
  confirmBtn.addEventListener('click', () => handleUnlink(providerId, user, els, ctx));
  wrap.append(text, cancel, confirmBtn);
  return wrap;
}

async function handleLink(providerId, user, els, ctx) {
  const provider = providerId === 'apple.com' ? new OAuthProvider('apple.com') : new GoogleAuthProvider();
  try {
    await linkWithPopup(user, provider);
    showMessage(els.accountMsg, `Linked ${providerLabel(providerId)}.`, { kind: 'ok', autoDismissMs: 4000 });
  } catch (err) {
    if (isIgnorableAuthError(err)) return;
    logAuthError('account link', err);
    showMessage(els.accountMsg, friendlyErrorMessage(err), { kind: 'err', autoDismissMs: 6000 });
  }
  // Re-read auth.currentUser rather than reusing `user`: a successful link
  // mutates providerData on the SDK's own User instance, but re-fetching is
  // cheap and keeps this correct even if that internal detail ever changes.
  renderAccountPanel(ctx.getAuth().currentUser, els, ctx);
}

async function handleUnlink(providerId, user, els, ctx) {
  openConfirmKey = null;
  try {
    await unlink(user, providerId);
    showMessage(els.accountMsg, `Unlinked ${providerLabel(providerId)}.`, { kind: 'ok', autoDismissMs: 4000 });
  } catch (err) {
    logAuthError('account unlink', err);
    showMessage(els.accountMsg, friendlyErrorMessage(err), { kind: 'err', autoDismissMs: 6000 });
  }
  renderAccountPanel(ctx.getAuth().currentUser, els, ctx);
}

/* ---------------------------------------------------------------------------
   Data status (contract §2 -- web is a reader, not a sync engine: this is
   freshness-of-last-read + a manual re-read, never a fabricated sync state)
   --------------------------------------------------------------------------- */
function buildDataStatusSection(user, els, ctx) {
  const section = document.createElement('div');
  section.className = 'acct__section';
  const label = document.createElement('div');
  label.className = 'acct__label';
  label.textContent = 'Data';
  const row = document.createElement('div');
  row.className = 'acct__data-row';
  const status = document.createElement('span');
  const lastLoadedAt = ctx.getLastLoadedAt();
  status.textContent = lastLoadedAt ? `Last loaded ${formatRelative(lastLoadedAt)}` : 'Not loaded yet';
  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'btn btn--sm btn--ghost';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.addEventListener('click', () => ctx.onRefresh());
  row.append(status, refreshBtn);
  section.append(label, row);
  return section;
}

/* ---------------------------------------------------------------------------
   Appearance (contract §3 -- reuses theme.js's own MODES/ACCENTS table, the
   SAME mechanism dashboard.js's applyTheme already paints with, rather than
   a second theme system) + Data & privacy statement
   --------------------------------------------------------------------------- */
function buildAppearanceSection(els, ctx) {
  const section = document.createElement('div');
  section.className = 'acct__section';
  const label = document.createElement('div');
  label.className = 'acct__label';
  label.textContent = 'Appearance';
  section.appendChild(label);

  const settings = ctx.getSettings();
  const currentMode = settings.themeMode;
  const currentAccent = settings.accent || DEFAULT_ACCENT;

  const modeRow = document.createElement('div');
  modeRow.className = 'acct__mode-row';
  for (const mode of ['dark', 'light']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--sm btn--ghost acct__mode-btn';
    btn.textContent = mode === 'dark' ? 'Dark' : 'Light';
    btn.setAttribute('aria-pressed', String(mode === currentMode));
    btn.addEventListener('click', () => writeAppearance(mode, currentAccent, els, ctx));
    modeRow.appendChild(btn);
  }
  section.appendChild(modeRow);

  const swatchRow = document.createElement('div');
  swatchRow.className = 'dash__swatch-row';
  swatchRow.setAttribute('role', 'group');
  swatchRow.setAttribute('aria-label', 'Accent color');
  for (const accentName of ACCENT_NAMES) {
    const hex = resolveTheme(currentMode, accentName).accent;
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'dash__swatch-opt';
    opt.style.background = hex;
    opt.setAttribute('aria-pressed', String(accentName === currentAccent));
    opt.setAttribute('aria-label', `${accentName} accent`);
    opt.addEventListener('click', () => writeAppearance(currentMode, accentName, els, ctx));
    swatchRow.appendChild(opt);
  }
  section.appendChild(swatchRow);

  return section;
}

/** Whole-document write of settings/app's theme fields -- same convention as
 * labelsPanel.js's writeCustomLabels: this doc has no scoped Firestore
 * `update` rule, so every write resends the fields this module doesn't own
 * (callAlertsEnabled, customLabels, excludedTopicKeys) unchanged. */
async function writeAppearance(themeMode, accent, els, ctx) {
  const settings = ctx.getSettings();
  try {
    await setDoc(doc(ctx.getDb(), 'users', ctx.getUid(), 'settings', 'app'), {
      themeMode,
      accent,
      callAlertsEnabled: settings.callAlertsEnabled,
      customLabels: ctx.getCustomLabels(),
      // See writeCustomLabels in labelsPanel.js: a whole-document write that
      // omits a field deletes it, and the phone then syncs the deletion down.
      excludedTopicKeys: settings.excludedTopicKeys,
      updatedAt: Date.now(),
    });
  } catch (err) {
    logAuthError('appearance write', err);
    showMessage(els.accountMsg, friendlyErrorMessage(err), { kind: 'err', autoDismissMs: 6000 });
    return;
  }
  // Updates dashboard.js's own theme state + re-renders the data views
  // (the calendar heatmap/breakdown bars are tinted with this same accent),
  // then this panel re-renders itself below to reflect the new pressed state.
  ctx.onThemeWritten(themeMode, accent);
  renderAccountPanel(ctx.getAuth().currentUser, els, ctx);
}

function buildPrivacySection() {
  const section = document.createElement('div');
  section.className = 'acct__section';
  const label = document.createElement('div');
  label.className = 'acct__label';
  label.textContent = 'Data & privacy';
  const p = document.createElement('p');
  p.className = 'acct__privacy';
  p.textContent = 'Stored in your account’s cloud data: your profile (email, display name, photo), '
    + 'app settings, custom labels, focus goals, and your focus session history. Not stored here: '
    + 'anything else on your phone, and nothing about the physical box itself.';
  section.append(label, p);
  return section;
}

/* ---------------------------------------------------------------------------
   Danger zone (contract §4 -- sign out + two-step account deletion). The
   confirm box + the delete cascade itself live in accountDelete.js (split
   out purely to keep this file under the 500-line guideline); this file
   just owns the toggle between "Delete account" button and that confirm box.
   --------------------------------------------------------------------------- */
function buildDangerSection(user, els, ctx) {
  const section = document.createElement('div');
  section.className = 'acct__section acct__danger';
  const label = document.createElement('div');
  label.className = 'acct__label';
  label.textContent = 'Danger zone';
  section.appendChild(label);

  const row = document.createElement('div');
  row.className = 'acct__danger-row';
  const signOutBtn = document.createElement('button');
  signOutBtn.type = 'button';
  signOutBtn.className = 'btn btn--sm btn--ghost';
  signOutBtn.textContent = 'Sign out';
  signOutBtn.addEventListener('click', () => ctx.onSignOut());
  row.appendChild(signOutBtn);

  if (openConfirmKey !== 'delete') {
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'dash__labels-confirm-delete';
    deleteBtn.textContent = 'Delete account';
    deleteBtn.addEventListener('click', () => {
      openConfirmKey = 'delete';
      renderAccountPanel(user, els, ctx);
    });
    row.appendChild(deleteBtn);
  }
  section.appendChild(row);

  if (openConfirmKey === 'delete') {
    section.appendChild(buildDeleteConfirm(user, els, ctx, () => {
      openConfirmKey = null;
      renderAccountPanel(user, els, ctx);
    }));
  }

  return section;
}

/** Re-renders the whole panel from the current Auth user. Called on initial
 * load (dashboard.js's loadDashboard) and after every link/unlink/appearance/
 * refresh action above. `user` is the live firebase User object -- never
 * cached beyond a single render, since providerData/emailVerified can change
 * out from under a stale reference. */
export function renderAccountPanel(user, els, ctx) {
  clear(els.accountBody);
  if (!user) return; // mid sign-out/delete -- nothing left to show
  els.accountBody.append(
    buildSignInSection(user, els, ctx),
    buildDataStatusSection(user, els, ctx),
    buildAppearanceSection(els, ctx),
    buildPrivacySection(),
    buildDangerSection(user, els, ctx),
  );
}

/** One-time wiring: resets this module's own open-confirm state. Nothing
 * else to attach at page init -- every control above is rebuilt fresh by
 * renderAccountPanel, same as goalsPanel.js's mountGoalsPanel(). */
export function mountAccountPanel() {
  openConfirmKey = null;
}
