/* =========================================================================
   dashboard.js -- wires dashboard.html to Firebase Auth (Google sign-in) +
   Firestore, reading and writing the exact documents app/src/sync/
   firestoreSync.ts uses (users/{uid}/sessions, users/{uid}/settings/app),
   and rendering them with the pure helpers in focusStats.js.

   Writable, as of the sessions `update` rule in firestore.rules: a session's
   `topic` can now be changed here (click a label chip in the sessions table
   or the calendar day list) as a scoped Firestore update, and the
   customLabels catalog can be added to/renamed/recolored/deleted (already
   covered by settings/app's existing whole-doc write rule). Every other
   session field stays immutable, enforced by the rules, not just by this
   file's own restraint. app/src/sync/sessionMerge.ts's last-write-wins merge
   (keyed on topicUpdatedAt) is what stops a relabel made here from being
   silently clobbered -- or silently clobbering an in-app retag -- on the next app sync.

   Gated: this page is for signed-in users only. Sign-in happens on login.html
   (login.js) -- this file only checks auth state and redirects there when signed out.

   Motion decision (2026-08-17 audit): this page deliberately carries no
   GSAP, unlike script.js's hero boot-in / override-tick pops. Per the
   motion-and-animation skill's frequency gate, GSAP's "juicy" overshoot
   pops are reserved for first-load/one-time persuade moments on the
   marketing page; this is a data/utility surface a user returns to
   repeatedly, where a repeated overshoot beat would read as noise rather
   than delight. Its state changes already animate via the flat
   .dash__fade / --ease / --ease-snap CSS transitions used across this page
   (showState here, statsCards.js's renderTrend/renderBreakdown, etc.) --
   restraint here is a deliberate call, not a gap left by drift.
   ========================================================================= */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { loadFirebaseConfigOrNull } from './firebaseConfig.js';
import { friendlyErrorMessage, isIgnorableAuthError, logAuthError } from './authErrors.js';
import { resolveTheme, applyTheme, DEFAULT_THEME_MODE, DEFAULT_ACCENT } from './theme.js';
import { aggregate, lastNDays, topicBreakdownWithCustom } from './focusStats.js';
import { showMessage, describeWriteError } from './dashMessage.js';
import { mountLabelsPanel, renderLabelsList } from './labelsPanel.js';
import { mountGoalsPanel, renderGoalsList } from './goalsPanel.js';
import { sanitizeRemoteGoals, computeGoalProgress, pruneArchivedGoals } from './goals.js';
import { mountAccountPanel, renderAccountPanel } from './accountPanel.js';
import { mountCalendarPanel, renderCalendar, resetCalendarView } from './calendarPanel.js';
import { renderSessionsTable } from './sessionsTable.js';
import { renderSummary, renderFacts, renderTrend, renderBreakdown } from './statsCards.js';

// Defensive cap, not a product window: the summary tiles/streak/calendar all
// want true all-time data, so this reads newest-first and reverses back to the
// oldest-first order aggregate()/renderAll() expect, rather than windowing to
// "recent N days" and changing what "Total focus time"/"Streak"/"Longest"
// mean. At a few sessions/day this is years of history before it ever
// truncates anything; it exists only to bound one account's per-load read.
const SESSIONS_QUERY_LIMIT = 2000;

const els = {
  notConfigured: document.getElementById('dashNotConfigured'),
  loading: document.getElementById('dashLoading'),
  error: document.getElementById('dashError'),
  errorMsg: document.getElementById('dashErrorMsg'),
  content: document.getElementById('dashContent'),
  summaryTotal: document.getElementById('dashSummaryTotal'),
  summarySub: document.getElementById('dashSummarySub'),
  miniRow: document.getElementById('dashMiniRow'),
  emptyHint: document.getElementById('dashEmptyHint'),
  factsCard: document.getElementById('dashFactsCard'),
  facts: document.getElementById('dashFacts'),
  trend: document.getElementById('dashTrend'),
  breakdown: document.getElementById('dashBreakdown'),
  sessionsBody: document.getElementById('dashSessionsBody'),
  signOutBtn: document.getElementById('signOutBtn'),
  calPrev: document.getElementById('dashCalPrev'),
  calNext: document.getElementById('dashCalNext'),
  calMonthLabel: document.getElementById('dashCalMonthLabel'),
  calGrid: document.getElementById('dashCalGrid'),
  calDayTitle: document.getElementById('dashCalDayTitle'),
  calDayList: document.getElementById('dashCalDayList'),
  writeError: document.getElementById('dashWriteError'),
  labelsMsg: document.getElementById('dashLabelsMsg'),
  labelsList: document.getElementById('dashLabelsList'),
  labelAddForm: document.getElementById('dashLabelAddForm'),
  labelAddSwatches: document.getElementById('dashLabelAddSwatches'),
  labelAddName: document.getElementById('dashLabelAddName'),
  labelAddSubmit: document.getElementById('dashLabelAddSubmit'),
  labelsCapMsg: document.getElementById('dashLabelsCapMsg'),
  goalsMsg: document.getElementById('dashGoalsMsg'),
  goalsList: document.getElementById('dashGoalsList'),
  goalFormSlot: document.getElementById('dashGoalFormSlot'),
  goalsCapMsg: document.getElementById('dashGoalsCapMsg'),
  accountMsg: document.getElementById('dashAccountMsg'),
  accountBody: document.getElementById('dashAccountBody'),
};

// ---------- Write state (populated once loadDashboard resolves) ----------
// dashDb/dashUid: needed by every write below, set once per sign-in. Named
// distinctly from loadDashboard's own (db, uid) parameters below, which
// would otherwise shadow these module-level bindings inside that function.
// currentSettings holds the three settings/app fields a label-catalog write
// doesn't touch -- settings/app's rule is a whole-document `allow write` (not
// a scoped `update`), so writeCustomLabels below must resend them unchanged
// alongside the new customLabels array, exactly like the app's own
// localSettingsPayload() does.
let dashDb = null;
let dashUid = null;
let currentSettings = { themeMode: DEFAULT_THEME_MODE, accent: DEFAULT_ACCENT, callAlertsEnabled: true };

// ---------- Account panel wiring (accountPanel.js owns render + writes) ----------
// dashAuth/dashUser mirror dashDb/dashUid's "set once per sign-in" shape
// above, for the same reason: accountCtx (below) is built once at module
// init, before sign-in resolves any of these. dashUser (unlike dashUid) is
// the live firebase User object itself -- accountPanel.js's render needs
// providerData/emailVerified/metadata off it, not just the uid string.
// lastLoadedAt is stamped after every successful loadDashboard (the initial
// load and every manual "Refresh") so the account panel's data-freshness
// caption never has to guess.
let dashAuth = null;
let dashUser = null;
let lastLoadedAt = null;

function showWriteError(err) {
  console.error(err);
  showMessage(els.writeError, describeWriteError(err), { kind: 'err', autoDismissMs: 6000 });
}

// ---------- Manage-labels panel wiring (labelsPanel.js owns render + writes) ----------
// getDb/getUid are getters, not static values, because mountLabelsPanel below
// is wired once at module init -- before sign-in has resolved dashDb/dashUid
// -- so a captured value would be stale/null forever; labelsPanel.js reads
// these live at write time instead.
const labelsCtx = {
  getDb: () => dashDb,
  getUid: () => dashUid,
  getSettings: () => currentSettings,
  getCustomLabels: () => calCustomLabels,
  onWritten: (next) => renderDataViews(calSessions, next),
};

// ---------- Focus goals panel wiring (goalsPanel.js owns render + writes) ----------
// Same live-getter shape as labelsCtx above, and for the same reason: this
// object is built once at module init, before sign-in resolves dashDb/dashUid
// or the first load populates calGoals/calCustomLabels.
//
// `writeGoals` is handed over rather than re-implemented in the panel --
// dashboard.js already owns this doc's write path (see writeGoals below), and
// it is deliberately the ONLY place users/{uid}/goals/config is written.
// `rerender` exists because two of the panel's states (an open add/edit form,
// a cancelled one) change nothing in Firestore but still need the list
// rebuilt -- routed through renderDataViews rather than the panel poking its
// own DOM, so a re-render from a write and a re-render from a UI toggle take
// the identical path.
const goalsCtx = {
  getGoals: () => calGoals,
  getCustomLabels: () => calCustomLabels,
  getThemeMode: () => themeMode,
  writeGoals: (next) => writeGoals(next),
  rerender: () => renderDataViews(calSessions, calCustomLabels),
};

// ---------- Account panel ctx (accountPanel.js owns render + writes) ----------
// Same live-getter shape as labelsCtx/goalsCtx above, for the same reason.
// onThemeWritten/onRefresh/onSignOut are callbacks rather than getters
// because accountPanel.js triggers these as one-shot actions (a write, a
// reload, a sign-out) instead of reading live state through them.
const accountCtx = {
  getAuth: () => dashAuth,
  getDb: () => dashDb,
  getUid: () => dashUid,
  getSettings: () => currentSettings,
  getCustomLabels: () => calCustomLabels,
  getLastLoadedAt: () => lastLoadedAt,
  onThemeWritten: (nextThemeMode, nextAccent) => {
    themeMode = nextThemeMode;
    currentSettings = { ...currentSettings, themeMode: nextThemeMode, accent: nextAccent };
    theme = resolveTheme(themeMode, nextAccent);
    applyTheme(theme);
    renderDataViews(calSessions, calCustomLabels);
  },
  onRefresh: () => { if (dashDb && dashUid) loadDashboard(dashDb, dashUid); },
  onSignOut: () => { signOut(dashAuth).catch(showError); },
};

// ---------- Per-session relabel picker ctx (sessionLabelPicker.js owns render + writes) ----------
// Rebuilt fresh on every call (renderCalDayList/renderSessionsTable both run
// inside renderDataViews, so dashDb/dashUid/calCustomLabels/themeMode are
// always current at call time) -- unlike labelsCtx above, no getter
// indirection is needed here.
function labelPickerCtx() {
  return {
    db: dashDb,
    uid: dashUid,
    customLabels: calCustomLabels,
    themeMode,
    onCommitted: () => renderDataViews(calSessions, calCustomLabels),
    onError: showWriteError,
  };
}

const STATES = ['notConfigured', 'loading', 'error', 'content'];
// Was a flat `hidden` swap (an instant snap between states); now the
// incoming container settles in with .dash__fade (dashboard.css), reusing
// script.js's waitlist hand-off technique -- remove `hidden`, flush layout
// so the opacity/translateY start state is committed, then add `is-in` so
// the transition actually fires instead of jumping straight to the end state.
function showState(name) {
  for (const s of STATES) {
    const el = els[s];
    if (s === name) {
      el.hidden = false;
      el.classList.remove('is-in');
      void el.offsetHeight; // flush hidden -> laid-out start state so .is-in transitions
      el.classList.add('is-in');
    } else {
      el.hidden = true;
      el.classList.remove('is-in');
    }
  }
}

// ---------- Theme (mirrors the signed-in user's app themeMode + accent) ----------
// Starts as the app's own SYNCABLE_SETTINGS_DEFAULTS (dark/mint) so the page
// never flashes an unstyled/wrong-accent state before settings load.
let theme = resolveTheme(DEFAULT_THEME_MODE, DEFAULT_ACCENT);
let themeMode = DEFAULT_THEME_MODE;

applyTheme(theme); // hexToRgba/applyTheme now live in theme.js -- see its header comment

// ---------- Calendar/sessions state (fed to calendarPanel.js/sessionsTable.js) ----------
// The month cursor/selected day moved into calendarPanel.js, which owns them
// privately -- dashboard.js only ever resets them via resetCalendarView (renderAll below).
let calSessions = [];
let calCustomLabels = [];

// ---------- Focus goals (see goals.js for the model, goalsPanel.js for the UI) ----------
// calGoals/goalsProgress are threaded through renderAll/renderDataViews the
// same way calCustomLabels is above. Both are now consumed: renderDataViews
// hands them to goalsPanel.js's renderGoalsList, and goalsCtx.getGoals()
// reads calGoals live so every createGoal/updateGoal/archiveGoal call in the
// panel operates on the current array rather than a captured snapshot.
// calGoals holds the SANITIZED array (sanitizeRemoteGoals runs at the
// Firestore boundary in loadDashboard) and still contains archived
// tombstones -- goalsPanel.js filters those out for display, exactly as
// computeGoalProgress already does for progress.
let calGoals = [];
let goalsProgress = [];

/** Re-renders every data view from the current (sessions, customLabels,
 * goals) state, without touching the calendar's month cursor/selected day --
 * used after a write (a relabel, a labels-catalog edit, or a goals write --
 * see writeGoals below) so e.g. renaming a label doesn't also silently snap
 * the calendar back to today's month. See renderAll below for the
 * initial-load path, which does reset those.
 *
 * `goals` defaults to the last-loaded set so every existing call site
 * (sessionLabelPicker.js's commit() via onCommitted, labelsPanel.js's writes
 * via onWritten) keeps working unchanged -- none of them touch goals, so
 * they shouldn't have to pass calGoals through by hand on every call. */
function renderDataViews(sessions, customLabels, goals = calGoals) {
  const stats = aggregate(sessions);
  const trend = lastNDays(sessions);
  const topics = topicBreakdownWithCustom(sessions, customLabels, themeMode);

  // These three must be assigned BEFORE any render below, not after. Every
  // renderX call below that reaches for a relabel picker does so via
  // labelPickerCtx() (passed as ctx.labelPickerCtx to sessionsTable.js/
  // calendarPanel.js), which closes over this module-level `calCustomLabels`
  // rather than taking the `customLabels` argument. When these sat after the
  // render calls, the FIRST load rendered the sessions table while
  // calCustomLabels was still its initial [], so resolveTopic() missed every
  // `custom:`-prefixed id and each custom-labelled row fell through to
  // "Untagged" -- self-healing on the next renderDataViews, which is why it
  // read as cosmetic rather than a bug. Keep this assignment order.
  calSessions = sessions;
  calCustomLabels = customLabels;
  calGoals = goals;

  renderSummary(stats, els);
  els.miniRow.hidden = stats.n === 0;
  els.emptyHint.hidden = stats.n > 0;
  els.factsCard.hidden = false;
  renderFacts(sessions, stats.foc, els);
  renderTrend(trend, els);
  renderBreakdown(topics, theme, els);
  renderSessionsTable(sessions, els, { labelPickerCtx });
  renderLabelsList(customLabels, els, labelsCtx);
  // Computed once here and passed into the panel, rather than letting
  // goalsPanel.js call computeGoalProgress itself -- both would read their
  // own Date.now(), so a render straddling a local-midnight (or Sunday-
  // midnight) window boundary could show a row's bar computed against one
  // window and its "Week of ..." caption against the next.
  goalsProgress = computeGoalProgress(goals, sessions);
  renderGoalsList(goals, goalsProgress, els, goalsCtx);
  renderCalendar(sessions, customLabels, els, { theme, themeMode, labelPickerCtx });
}

function renderAll(sessions, customLabels, goals = []) {
  resetCalendarView();
  renderDataViews(sessions, customLabels, goals);
}

// ---------- Focus goals persistence ----------
// Called only from goalsPanel.js, via goalsCtx.writeGoals above -- the panel
// composes the next array with goals.js's createGoal/updateGoal/archiveGoal
// against calGoals and hands the result here. Kept in this file (not moved
// into the panel alongside labelsPanel.js's own writeCustomLabels) so
// dashboard.js remains the single module that touches Firestore for this doc.
// Re-throws after surfacing the banner so the panel can tell a failed write
// from a successful one (it restores its open form and re-enables its buttons).
/** Writes the full goals array to users/{uid}/goals/config. Unlike
 * labelsPanel.js's writeCustomLabels, this doc has no *other* fields to
 * resend -- `{ goals, updatedAt }` is its entire shape (contract §1) -- so
 * this is a plain whole-document overwrite, not a merge; still a full setDoc
 * rather than updateDoc for the same reason writeCustomLabels uses one:
 * there's no scoped Firestore `update` rule for this doc (see
 * app/firestore.rules' settings/app rule, the pattern this doc's own rule
 * mirrors). `updatedAt` is stamped as a client logical clock via Date.now(),
 * exactly like writeCustomLabels/localSettingsPayload() do -- never
 * serverTimestamp(), so it stays comparable against the app's own goals doc
 * clock. Tombstones are pruned right before the write lands (see goals.js's
 * pruneArchivedGoals), not on every read, so a fresh tombstone still gets a
 * full propagation window before it can be dropped by whichever side writes next. */
async function writeGoals(next) {
  const pruned = pruneArchivedGoals(next, Date.now());
  try {
    await setDoc(doc(dashDb, 'users', dashUid, 'goals', 'config'), {
      goals: pruned,
      updatedAt: Date.now(),
    });
  } catch (err) {
    showWriteError(err);
    throw err;
  }
  renderDataViews(calSessions, calCustomLabels, pruned);
}

// ---------- Firebase wiring ----------
function showError(err) {
  if (isIgnorableAuthError(err)) return;
  logAuthError('dashboard load', err);
  els.errorMsg.textContent = friendlyErrorMessage(err);
  showState('error');
}

// Firestore's SDK can retry a stuck connection (missing database, blocked
// request) silently instead of rejecting, which left this screen stuck on
// "Loading..." forever with no error. Race it against a timeout so a stall
// always surfaces as an actionable error instead of hanging indefinitely.
const LOAD_TIMEOUT_MS = 15000;
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(Object.assign(new Error('Dashboard load timed out'), { code: 'timeout' })), ms);
    }),
  ]);
}

// Bumped at the start of every loadDashboard call, captured as `seq` in each
// call's own closure -- guards against two overlapping loads (a manual
// "Refresh" clicked while the initial load is still in flight, or
// onAuthStateChanged firing again before the first load settles) racing each
// other. Without this, whichever call's Firestore round-trip happened to
// resolve LAST would win and overwrite the screen, even if it was the OLDER
// (now-stale) call -- a double-click on Refresh could leave the page showing
// data from a moment before the click. Comparing against the module-level
// counter after the await is what lets a stale call's result be silently
// dropped instead of rendered.
let loadSeq = 0;

async function loadDashboard(db, uid) {
  const seq = ++loadSeq;
  showState('loading');
  dashDb = db;
  dashUid = uid;
  try {
    const [sessionsSnap, settingsSnap, goalsSnap] = await withTimeout(Promise.all([
      getDocs(query(
        collection(db, 'users', uid, 'sessions'),
        orderBy('startedAt', 'desc'),
        limit(SESSIONS_QUERY_LIMIT),
      )),
      getDoc(doc(db, 'users', uid, 'settings', 'app')),
      // users/{uid}/goals/config -- see goals.js's header. A missing doc here
      // is the normal first-run case (no goals set yet), not an error, same
      // as settings/app potentially not existing for a brand-new account --
      // handled below via goalsSnap.exists(), not a catch.
      getDoc(doc(db, 'users', uid, 'goals', 'config')),
    ]), LOAD_TIMEOUT_MS);
    // Back to oldest-first -- the query above reads newest-first so the cap
    // keeps the *most recent* sessions, but every render/aggregate helper
    // below expects oldest-first input. Keeps its own doc id (unlike the
    // previous read-only version, which discarded it) -- createLabelPicker
    // needs it to address the doc for a relabel `update`.
    const sessions = sessionsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
    const settings = settingsSnap.exists() ? settingsSnap.data() : {};
    const customLabels = settings.customLabels || [];
    // sanitizeRemoteGoals is the untrusted-input boundary for this doc (see
    // its own comment in goals.js) -- run before anything else (including
    // computeGoalProgress in renderAll/renderDataViews) ever sees it, same
    // as customLabels above being trusted only because settings/app's own
    // write rule already bounds its shape.
    const goals = sanitizeRemoteGoals(goalsSnap.exists() ? goalsSnap.data().goals : []);
    // A newer loadDashboard call already started (and may have already
    // rendered) while this one's Firestore round-trip was in flight -- drop
    // this stale result rather than let it stomp the newer one. See loadSeq's
    // own comment above.
    if (seq !== loadSeq) return;
    // Same themeMode/accent fields useSettingsStore.ts syncs from the app
    // (SyncableSettings) -- resolving them here is what makes this page look
    // like *this user's* app, not just a fixed website palette. Also kept
    // around (currentSettings) so writeCustomLabels can resend them unchanged
    // on a labels-catalog write, since settings/app has no scoped update rule.
    themeMode = settings.themeMode === 'light' ? 'light' : DEFAULT_THEME_MODE;
    theme = resolveTheme(themeMode, settings.accent || DEFAULT_ACCENT);
    currentSettings = {
      themeMode,
      accent: settings.accent || DEFAULT_ACCENT,
      callAlertsEnabled: settings.callAlertsEnabled !== undefined ? settings.callAlertsEnabled : true,
    };
    applyTheme(theme);
    renderAll(sessions, customLabels, goals);
    // Stamped after a successful load (initial or a manual "Refresh" from
    // the account panel), not before -- a failed/timed-out load shouldn't
    // claim the data is fresh. renderAccount() re-renders from `dashUser`
    // rather than the `user` this function doesn't have in scope; dashUser
    // is set by onAuthStateChanged below before every loadDashboard call.
    lastLoadedAt = Date.now();
    renderAccount();
    showState('content');
  } catch (err) {
    // Same staleness guard as the success path above -- an older call's
    // timeout/rejection landing after a newer call already resolved (or is
    // still loading) must not clobber the screen with a stale error.
    if (seq !== loadSeq) return;
    showError(err);
  }
}

function renderAccount() {
  if (dashUser) renderAccountPanel(dashUser, els, accountCtx);
}

async function init() {
  mountLabelsPanel(els, labelsCtx);
  mountGoalsPanel();
  mountAccountPanel();
  mountCalendarPanel(els);

  // Fetched from Firebase Hosting rather than bundled -- see firebaseConfig.js.
  const firebaseConfig = await loadFirebaseConfigOrNull();
  if (!firebaseConfig) {
    showState('notConfigured');
    return;
  }

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  dashAuth = auth;

  els.signOutBtn.addEventListener('click', () => {
    signOut(auth).catch(showError);
  });

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      // Gated page: signed-out visitors belong on login.html, not on a
      // "please sign in" state rendered here. `replace` so the gated view
      // never sits in history for the back button to land on. Also covers
      // the account panel's own delete-account success path -- deleteUser()
      // firing this same callback with `user === null` is exactly how that
      // panel lands back on the signed-out surface, with no redirect logic
      // of its own.
      dashUser = null;
      window.location.replace('login.html');
      return;
    }
    dashUser = user;
    els.signOutBtn.hidden = false;
    loadDashboard(db, user.uid);
  });
}

// init() is async now (it fetches the config); without this a throw inside
// it would surface only as an unhandled rejection.
init().catch((err) => showError(err));
