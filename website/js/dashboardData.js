/* =========================================================================
   dashboardData.js -- the dashboard's read side: the four Firestore reads
   one page load needs, and the untrusted-input boundary they pass through
   before anything renders them.

   Split out of dashboard.js, which is otherwise wiring -- which panel gets
   which callbacks, what is on screen, what a click writes back. This half is
   a pure function of (db, uid): it holds no page state, touches no DOM, and
   is the same shape the app keeps its sync modules in, separate from the
   stores that render their results.

   The sanitising here is the point of the boundary, not politeness.
   settings/app's rule bounds the label catalog's SIZE but cannot iterate a
   list of maps, so its ENTRIES are checked by nobody until sanitizeCustomLabels
   sees them; goals get the same treatment through sanitizeRemoteGoals. Every
   renderer downstream reads .id/.name/.color and goal fields straight out of
   these, so this is the last place a malformed document can be stopped.
   ========================================================================= */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { sanitizeCustomLabels } from './focusStats.js';
import { sanitizeRemoteGoals } from './goals.js';
import { loadScheduledSessions } from './scheduledSessionsSync.js';

// Defensive cap, not a product window: the summary tiles/streak/calendar all
// want true all-time data, so this reads newest-first and reverses back to the
// oldest-first order aggregate()/renderAll() expect, rather than windowing to
// "recent N days" and changing what "Total focus time"/"Streak"/"Longest"
// mean. At a few sessions/day this is years of history before it ever
// truncates anything; it exists only to bound one account's per-load read.
const SESSIONS_QUERY_LIMIT = 2000;

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


/**
 * Everything one dashboard load reads, already sanitized.
 *
 * Rejects only on a failure that should take the page to its error state --
 * a denied or timed-out read of the core documents. The planned-sessions
 * read is deliberately NOT one of those; see its own comment below.
 *
 * Answers with { sessions, settings, customLabels, goals, plans }.
 */
export async function fetchDashboardData(db, uid) {
  const [sessionsSnap, settingsSnap, goalsSnap, plans] = await withTimeout(Promise.all([
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
    // Planned focus sessions. An empty collection is the normal first-run
    // case, exactly like a missing goals/config above -- not an error.
    //
    // Caught HERE rather than by the outer try, because these four reads
    // share one Promise.all: an unhandled rejection from this one would
    // take the whole dashboard to its error state, hiding sessions, stats,
    // goals and labels over a feature the user may not be using. That is
    // not hypothetical -- this is the newest collection, and a project
    // whose firestore.rules predate it denies the read outright (see
    // docs/push-notifications.md). Degrading to "no plans" keeps the rest
    // of the page working and leaves the Planned block simply empty.
    loadScheduledSessions(db, uid).catch((err) => {
      console.warn('[dashboard] could not load planned sessions:', err?.message ?? err);
      return [];
    }),
  ]), LOAD_TIMEOUT_MS);
  // Back to oldest-first -- the query above reads newest-first so the cap
  // keeps the *most recent* sessions, but every render/aggregate helper
  // below expects oldest-first input. Keeps its own doc id (unlike the
  // previous read-only version, which discarded it) -- createLabelPicker
  // needs it to address the doc for a relabel `update`.
  const sessions = sessionsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
  const settings = settingsSnap.exists() ? settingsSnap.data() : {};
  // Sanitized, not merely defaulted. This used to be
  // `settings.customLabels || []`, trusted on the grounds that settings/
  // app's write rule bounds its shape -- but that rule caps the catalog's
  // SIZE and cannot iterate a list of maps, so the ENTRIES were never
  // checked by anything, and every renderer below reads .id/.name/.color
  // straight out of them.
  const customLabels = sanitizeCustomLabels(settings.customLabels);
  // sanitizeRemoteGoals is the untrusted-input boundary for this doc (see
  // its own comment in goals.js) -- run before anything else (including
  // computeGoalProgress in renderAll/renderDataViews) ever sees it, the
  // same boundary customLabels just went through above.
  const goals = sanitizeRemoteGoals(goalsSnap.exists() ? goalsSnap.data().goals : []);
  // `settings` is the RAW document, returned alongside the sanitized
  // catalogs above because the caller still needs its themeMode/accent/
  // callAlertsEnabled to paint the page as this user's app -- and resends
  // them unchanged on a labels write, since settings/app has no scoped
  // update rule. Those three are normalized where they are applied
  // (theme.js's resolveTheme already falls back for values it does not
  // know), not here, so this stays a read rather than a policy.
  return { sessions, settings, customLabels, goals, plans };
}
