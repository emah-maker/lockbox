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
  setDoc,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { loadFirebaseConfigOrNull } from './firebaseConfig.js';
import { initAppCheck } from './appCheck.js';
import { friendlyErrorMessage, isIgnorableAuthError, logAuthError } from './authErrors.js';
import { resolveTheme, applyTheme, DEFAULT_THEME_MODE, DEFAULT_ACCENT } from './theme.js';
import { aggregate, lastNDays, topicBreakdownWithCustom } from './focusStats.js';
import { showMessage, describeWriteError } from './dashMessage.js';
import { mountLabelsPanel, renderLabelsList } from './labelsPanel.js';
import { mountGoalsPanel, renderGoalsList } from './goalsPanel.js';
import { pruneArchivedGoals } from './goals.js';
import { computeGoalProgress } from './goalProgress.js';
import { mountAccountPanel, renderAccountPanel } from './accountPanel.js';
import { mountCalendarPanel, renderCalendar, resetCalendarView } from './calendarPanel.js';
import {
  mountPlannedSessionsPanel,
  refreshWebPushRow,
  renderPlannedSessions,
} from './plannedSessionsPanel.js';
import { loadScheduledSessions } from './scheduledSessionsSync.js';
// The read side lives in dashboardData.js -- this file is the wiring.
import { fetchDashboardData } from './dashboardData.js';
import { disableWebPush, startForegroundWebPush } from './webPush.js';
import { renderSessionsTable } from './sessionsTable.js';
import { renderSummary, renderFacts, renderTrend, renderBreakdown } from './statsCards.js';
// Every element on dashboard.html this page touches, looked up once.
import { els } from './domRefs.js';
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
// Every field the app's localSettingsPayload writes EXCEPT customLabels and
// updatedAt, which the two writers supply themselves (the live catalog, and a
// clock stamped at write time). settings/app has no scoped `update` rule, so
// both writers resend the whole document -- a field missing HERE is missing
// from both payloads, and a whole-document setDoc that omits a field deletes
// it. excludedTopicKeys earned its place the hard way: leaving it out meant
// switching the dashboard to Light theme silently put every excluded topic
// back into the phone's totals and goal progress.
let currentSettings = {
  themeMode: DEFAULT_THEME_MODE,
  accent: DEFAULT_ACCENT,
  callAlertsEnabled: true,
  excludedTopicKeys: [],
};

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
// The Hosting-served Firebase config (firebaseConfig.js). Kept around after
// init because webPush.js needs its `vapidKey` -- see that module's header
// for why the key is read from the config rather than committed here.
let dashConfig = null;
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
// ---------- Planned sessions ctx (plannedSessionsPanel.js owns render + writes) ----------
// Same live-getter shape as labelsCtx/goalsCtx above, and for the same
// reason: built once at module init, before sign-in resolves dashDb/dashUid.
//
// Unlike goalsCtx, `onChanged` re-READS from Firestore rather than handing
// the panel a local array to mutate. Scheduled sessions are individual
// documents (not one array field), and the backend writes to them too --
// `notifiedAt`, once a reminder has been sent -- so the local copy is not
// the only writer and can't be treated as authoritative after a write.
const plannedCtx = {
  getDb: () => dashDb,
  getUid: () => dashUid,
  getPlans: () => calPlans,
  getCustomLabels: () => calCustomLabels,
  getThemeMode: () => themeMode,
  getFirebaseConfig: () => dashConfig,
  onChanged: async () => {
    if (!dashDb || !dashUid) return;
    calPlans = await loadScheduledSessions(dashDb, dashUid);
    renderDataViews(calSessions, calCustomLabels);
  },
  onError: (err) => showWriteError(err),
};

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
// incoming container settles in with .dash__fade (dashboard.css) -- remove
// `hidden`, flush layout so the opacity/translateY start state is
// committed, then add `is-in` so the transition actually fires instead of
// jumping straight to the end state.
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
// The synced counterpart to calCustomLabels' excludeFromTotals flags -- the
// six built-in topics a user has excluded from focus totals/goal progress
// (users/{uid}/settings/app's excludedTopicKeys, same field the app's
// useSettingsStore.ts syncs). Set once per load (fetchDashboardData already
// sanitizes it) and read directly by renderDataViews below, the same way
// `themeMode` is -- nothing on this page writes it, so unlike calCustomLabels
// it never needs to be threaded through a write's onWritten/onCommitted callback.
let calExcludedTopicKeys = [];
// Planned focus sessions (users/{uid}/scheduledSessions). Loaded alongside
// everything else in loadDashboard and re-read after every write -- see
// plannedCtx.onChanged for why re-reading rather than mutating locally.
let calPlans = [];

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
  // customLabels/calExcludedTopicKeys are threaded through so an
  // excludeFromTotals-tagged (or excluded-built-in-topic) session doesn't
  // inflate the total focus time / trend chart, matching app/src/stats/
  // stats.ts's aggregate and app/src/stats/trend.ts's lastNDays. Note
  // topicBreakdownWithCustom deliberately does NOT take these -- see its own
  // comment in focusStats.js for why the "by label" breakdown still shows an
  // excluded session's time.
  const stats = aggregate(sessions, customLabels, calExcludedTopicKeys);
  const trend = lastNDays(sessions, 7, Date.now(), customLabels, calExcludedTopicKeys);
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
  // Same two lists aggregate() got above -- stats.foc is its excluded total,
  // so the best-day banner underneath it has to be measured against the same
  // sessions or it can claim a day larger than the total it sits under.
  renderFacts(sessions, stats.foc, els, customLabels, calExcludedTopicKeys);
  renderTrend(trend, els);
  renderBreakdown(topics, theme, els);
  renderSessionsTable(sessions, els, { labelPickerCtx });
  renderLabelsList(customLabels, els, labelsCtx);
  // Computed once here and passed into the panel, rather than letting
  // goalsPanel.js call computeGoalProgress itself -- both would read their
  // own Date.now(), so a render straddling a local-midnight (or Sunday-
  // midnight) window boundary could show a row's bar computed against one
  // window and its "Week of ..." caption against the next.
  goalsProgress = computeGoalProgress(goals, sessions, Date.now(), customLabels, calExcludedTopicKeys);
  renderGoalsList(goals, goalsProgress, els, goalsCtx);
  renderCalendar(sessions, customLabels, els, {
    theme,
    themeMode,
    labelPickerCtx,
    // calendarPanel.js owns the selected day privately; this is how it hands
    // that day to the planned-sessions block underneath the day list.
    onDaySelected: renderPlannedSessions,
  });
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
  // Now that there IS a uid, the browser-reminder row can finally tell
  // "enabled here" from "not enabled here" -- that answer lives in a
  // Firestore document under the user, and every earlier paint ran before
  // sign-in resolved. Not awaited: it is one small read for a single row,
  // and the dashboard's own four reads below should not queue behind it.
  void refreshWebPushRow();
  try {
    const { sessions, settings, customLabels, excludedTopicKeys, goals, plans } = await fetchDashboardData(db, uid);
    // A newer loadDashboard call already started (and may have already
    // rendered) while this one's Firestore round-trip was in flight -- drop
    // this stale result rather than let it stomp the newer one. See loadSeq's
    // own comment above.
    if (seq !== loadSeq) return;
    calPlans = plans;
    calExcludedTopicKeys = excludedTopicKeys;
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
      excludedTopicKeys,
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
  mountPlannedSessionsPanel(els, plannedCtx);

  // Fetched from Firebase Hosting rather than bundled -- see firebaseConfig.js.
  const firebaseConfig = await loadFirebaseConfigOrNull();
  if (!firebaseConfig) {
    showState('notConfigured');
    return;
  }
  dashConfig = firebaseConfig;
  // The panel mounted before this fetch resolved, so its first paint saw no
  // config and hid the browser-reminder row -- repaint now that the VAPID key
  // (or its absence) is actually known.
  void refreshWebPushRow();
  const app = initializeApp(firebaseConfig);
  await initAppCheck(app); // before getAuth/getFirestore -- see appCheck.js header
  const auth = getAuth(app);
  const db = getFirestore(app);
  dashAuth = auth;

  // A reminder that arrives while a dashboard tab is FOCUSED is delivered to
  // the page, not to the service worker, and would otherwise be silently
  // dropped -- the browser equivalent of the missing presentation handler
  // documented in app/src/goals/goalNotifications.ts.
  startForegroundWebPush({
    config: firebaseConfig,
    onReminder: (title, body) => showMessage(els.planMsg, `${title} -- ${body}`, { kind: 'ok' }),
  });

  els.signOutBtn.addEventListener('click', async () => {
    // BEFORE signOut, not after: deleting this browser's push token is
    // authorized by isOwner(uid), which needs the user still signed in. Left
    // behind, it would keep this browser receiving the previous account's
    // reminders. Best-effort, and never a reason to block a sign-out
    // (webPush.js swallows its own failures).
    if (dashDb && dashUid) await disableWebPush({ db: dashDb, uid: dashUid });
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
