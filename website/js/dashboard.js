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
   silently clobbered -- or silently clobbering an in-app retag -- on the
   next app sync.

   Gated: this page is for signed-in users only. Sign-in itself happens on
   login.html (login.js) -- this file only checks auth state and redirects
   there when signed out, rather than offering its own sign-in button.

   Motion decision (2026-08-17 audit): this page deliberately carries no
   GSAP, unlike script.js's hero boot-in / override-tick pops. Per the
   motion-and-animation skill's frequency gate, GSAP's "juicy" overshoot
   pops are reserved for first-load/one-time persuade moments on the
   marketing page; this is a data/utility surface a user returns to
   repeatedly, where a repeated overshoot beat would read as noise rather
   than delight. Its state changes already animate via the flat
   .dash__fade / --ease / --ease-snap CSS transitions used elsewhere in this
   file (showState, renderTrend, renderBreakdown) -- restraint here is a
   deliberate call, not a gap left by drift.
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
import { firebaseConfig, isFirebaseConfigured } from './firebaseConfig.js';
import { friendlyErrorMessage, isIgnorableAuthError } from './authErrors.js';
import { resolveTheme, compositeHex, DEFAULT_THEME_MODE, DEFAULT_ACCENT } from './theme.js';
import {
  aggregate,
  formatDuration,
  completionRate,
  dayKey,
  groupByDay,
  bestDay,
  lastNDays,
  topicBreakdownWithCustom,
  dominantTopicWithCustom,
  topComparisons,
  formatComparison,
  startOfMonth,
  buildMonthGrid,
  readableTextColor,
} from './focusStats.js';
import { showMessage, describeWriteError } from './dashMessage.js';
import { createLabelPicker } from './sessionLabelPicker.js';
import { mountLabelsPanel, renderLabelsList } from './labelsPanel.js';
import { mountGoalsPanel, renderGoalsList } from './goalsPanel.js';
import { sanitizeRemoteGoals, computeGoalProgress, pruneArchivedGoals } from './goals.js';

const TOP_FACTS = 5;
// Defensive cap, not a product window: the summary tiles/streak/calendar all
// want true all-time data, so this reads newest-first and reverses back to
// the oldest-first order aggregate()/renderAll() expect, rather than
// windowing to "recent N days" and silently changing what "Total focus
// time"/"Streak"/"Longest" mean. At a few sessions/day this is years of
// history before it ever truncates anything; it only exists so one account's
// history can't grow into an unbounded per-load Firestore read.
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

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// ---------- Theme (mirrors the signed-in user's app themeMode + accent) ----------
// Starts as the app's own SYNCABLE_SETTINGS_DEFAULTS (dark/mint) so the page
// never flashes an unstyled/wrong-accent state before settings load.
let theme = resolveTheme(DEFAULT_THEME_MODE, DEFAULT_ACCENT);
let themeMode = DEFAULT_THEME_MODE;

// Paints the resolved theme onto CSS custom properties (dashboard.css reads
// these) rather than keeping color logic duplicated in both CSS and JS --
// the calendar heatmap below is the one place that also needs the raw hex
// values in JS (to alpha-composite per-cell).
function applyTheme(t) {
  const root = document.documentElement.style;
  root.setProperty('--bg', t.bg);
  root.setProperty('--bg-2', t.bg);
  root.setProperty('--card', t.surface);
  root.setProperty('--card-2', t.surface);
  root.setProperty('--text', t.text);
  root.setProperty('--text-2', t.textDim);
  root.setProperty('--text-3', t.textDim);
  root.setProperty('--unlocked', t.accent);
  root.setProperty('--unlocked-2', t.accent);
  root.setProperty('--locked', t.danger);
  root.setProperty('--locked-2', t.danger);
  root.setProperty('--closed', t.warn);
  root.setProperty('--accent-text', t.accentText);
  root.setProperty('--accent-soft', compositeHex(t.accent, t.surface, 0.12));
}
applyTheme(theme);

// ---------- Calendar state (month cursor + selected day) ----------
let calCursor = startOfMonth(new Date());
let calSelectedKey = dayKey(Date.now());
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

function renderCalendar() {
  const byDay = groupByDay(calSessions);
  const grid = buildMonthGrid(calCursor);
  const todayKey = dayKey(Date.now());
  const maxFocus = Math.max(1, ...Array.from(byDay.values()).map((list) => list.reduce((sum, s) => sum + s.actualS, 0)));

  els.calMonthLabel.textContent = calCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  clear(els.calGrid);

  for (const date of grid) {
    const cell = document.createElement('div');
    if (!date) {
      els.calGrid.appendChild(cell);
      continue;
    }
    const key = dayKey(date.getTime());
    const daySessions = byDay.get(key) || [];
    const focusS = daySessions.reduce((sum, s) => sum + s.actualS, 0);
    const dominant = dominantTopicWithCustom(daySessions, calCustomLabels, themeMode);

    cell.className = 'dash__cal-cell';
    if (key === calSelectedKey) cell.classList.add('dash__cal-cell--selected');
    if (key === todayKey) cell.classList.add('dash__cal-cell--today');
    if (focusS > 0) cell.classList.add('dash__cal-cell--focus');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dash__cal-daynum';
    btn.textContent = String(date.getDate());
    btn.setAttribute('aria-pressed', String(key === calSelectedKey));
    if (key === todayKey) btn.setAttribute('aria-current', 'date');
    const fullDate = date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    btn.setAttribute('aria-label', focusS > 0 ? `${fullDate}, ${formatDuration(focusS)} focused` : fullDate);
    if (focusS > 0) {
      // Mirrors the app's CalendarScreen exactly: the cell fills with the
      // user's own accent color at an intensity scaled to that day's focus
      // time (app: withAlpha(c.accent, intensity)). Pre-composited against
      // the card surface (rather than a real alpha channel) so the text
      // color below can be picked by measured contrast at this exact
      // resulting shade, instead of assuming the app's fixed accentText
      // clears 4.5:1 at every intensity/accent/mode combination.
      const intensity = 0.25 + 0.75 * Math.min(1, focusS / maxFocus);
      const fill = compositeHex(theme.accent, theme.surface, intensity);
      btn.style.background = fill;
      btn.style.color = readableTextColor(fill);
    }
    btn.addEventListener('click', () => {
      calSelectedKey = key;
      renderCalendar();
    });
    cell.appendChild(btn);

    if (dominant) {
      const dot = document.createElement('span');
      dot.className = 'dash__cal-dot';
      dot.style.background = dominant.color;
      cell.appendChild(dot);
    }
    els.calGrid.appendChild(cell);
  }

  renderCalDayList(byDay.get(calSelectedKey) || []);
}

function renderCalDayList(daySessions) {
  els.calDayTitle.textContent = new Date(calSelectedKey).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
  clear(els.calDayList);
  if (daySessions.length === 0) {
    const li = document.createElement('li');
    li.className = 'dash__cal-empty';
    li.textContent = 'No focus sessions logged this day.';
    els.calDayList.appendChild(li);
    return;
  }
  for (const s of daySessions.slice().sort((a, b) => a.startedAt - b.startedAt)) {
    const li = document.createElement('li');
    li.dataset.sessionId = s.id;
    const time = document.createElement('span');
    time.textContent = new Date(s.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const dur = document.createElement('span');
    dur.textContent = formatDuration(s.actualS);
    const label = createLabelPicker(s, labelPickerCtx());
    const outcome = document.createElement('span');
    outcome.textContent = s.outcome === 'completed' ? 'Completed' : 'Ended early';
    li.append(time, dur, label, outcome);
    els.calDayList.appendChild(li);
  }
}

els.calPrev.addEventListener('click', () => {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
  renderCalendar();
});
els.calNext.addEventListener('click', () => {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
  renderCalendar();
});

// ---------- Summary card ----------
// Mirrors StatsScreen.tsx's single "Total focus time" card exactly (big
// accent total + sub-copy + a borderless Completed/Streak/Longest row)
// rather than five separately-boxed tiles.
function renderSummary(stats) {
  els.summaryTotal.textContent = formatDuration(stats.foc);
  els.summarySub.textContent = `across ${stats.n} session${stats.n === 1 ? '' : 's'}`;
  clear(els.miniRow);
  const minis = [
    ['Completed', `${completionRate(stats)}%`],
    ['Streak', String(stats.str)],
    ['Longest', formatDuration(stats.lng)],
  ];
  for (const [label, value] of minis) {
    const stat = document.createElement('div');
    stat.className = 'dash__mini-stat';
    const v = document.createElement('div');
    v.className = 'dash__mini-value';
    v.textContent = value;
    const l = document.createElement('div');
    l.className = 'dash__mini-label';
    l.textContent = label;
    stat.append(v, l);
    els.miniRow.appendChild(stat);
  }
}

// ---------- Fun facts ----------
// Feather-style icon outlines (award/zap), matching the app's StatsScreen use
// of @expo/vector-icons' Feather set for this same card, rather than inventing
// a different icon language for the same content on the website.
const ICON_AWARD = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>';
const ICON_ZAP = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';

function renderFacts(sessions, totalFocusS) {
  clear(els.facts);
  if (totalFocusS <= 0) {
    const p = document.createElement('p');
    p.className = 'dash__facts-empty';
    p.textContent = 'Finish a focus session to see how it stacks up.';
    els.facts.appendChild(p);
    return;
  }
  const best = bestDay(sessions);
  if (best) {
    const banner = document.createElement('div');
    banner.className = 'dash__best-day';
    const dateStr = new Date(best.dateMs).toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    banner.innerHTML = `${ICON_AWARD}<span>Your best day was ${dateStr} -- ${formatDuration(best.focusS)} focused.</span>`;
    els.facts.appendChild(banner);
  }
  for (const cmp of topComparisons(totalFocusS).slice(0, TOP_FACTS)) {
    const row = document.createElement('div');
    row.className = 'dash__fact-row';
    row.innerHTML = `${ICON_ZAP}<span>${formatComparison(cmp)}</span>`;
    els.facts.appendChild(row);
  }
}

// ---------- 7-day trend ----------
function renderTrend(trend) {
  clear(els.trend);
  const max = Math.max(1, ...trend.map((d) => d.focusS));
  for (const d of trend) {
    const col = document.createElement('div');
    col.className = 'dash__trend-day';
    const track = document.createElement('div');
    track.className = 'dash__trend-track';
    const bar = document.createElement('div');
    bar.className = 'dash__trend-bar';
    const h = Math.max(4, Math.round((d.focusS / max) * 100));
    // Scale a full-height bar instead of animating `height` -- see styles.css
    // .dash__trend-bar comment for why (layout-thrash / craft-floor finding).
    bar.style.setProperty('--h', h / 100);
    bar.title = formatDuration(d.focusS);
    track.appendChild(bar);
    const label = document.createElement('div');
    label.className = 'dash__trend-label';
    label.textContent = d.label;
    col.append(track, label);
    els.trend.appendChild(col);
  }
}

// ---------- Label breakdown ----------
function renderBreakdown(topics) {
  clear(els.breakdown);
  if (topics.length === 0) {
    const p = document.createElement('p');
    p.className = 'dash__facts-empty';
    p.textContent = 'No labeled sessions yet -- tag a session from the Phone Box app to see the split here.';
    els.breakdown.appendChild(p);
    return;
  }
  const max = Math.max(1, ...topics.map((t) => t.focusS));
  for (const t of topics) {
    const row = document.createElement('div');
    row.className = 'dash__breakdown-row';
    const swatch = document.createElement('span');
    swatch.className = 'dash__breakdown-swatch';
    swatch.style.background = t.color;
    const meta = document.createElement('div');
    meta.className = 'dash__breakdown-meta';
    const name = document.createElement('span');
    name.className = 'dash__breakdown-name';
    name.textContent = t.label;
    const value = document.createElement('span');
    value.className = 'dash__breakdown-value';
    value.textContent = `${formatDuration(t.focusS)} · ${t.n} session${t.n === 1 ? '' : 's'}`;
    meta.append(name, value);
    const track = document.createElement('div');
    track.className = 'dash__breakdown-track';
    // Tinted with this row's own topic color (not the page accent) so each
    // track/fill pair reads as one color family, the same way the trend
    // bars' track is a tint of the one accent color they use throughout.
    track.style.background = compositeHex(t.color, theme.surface, 0.15);
    const fill = document.createElement('div');
    fill.className = 'dash__breakdown-fill';
    // Scale via transform, not `width` -- same convention (and reason) as
    // .dash__trend-bar just above: transform/opacity skip layout on change.
    fill.style.setProperty('--w', Math.max(0.04, t.focusS / max));
    fill.style.background = t.color;
    track.appendChild(fill);
    row.append(swatch, meta, track);
    els.breakdown.appendChild(row);
  }
}

// ---------- Recent sessions table ----------
const RECENT_LIMIT = 25;
function renderSessionsTable(sessions) {
  clear(els.sessionsBody);
  const recent = sessions.slice().sort((a, b) => b.startedAt - a.startedAt).slice(0, RECENT_LIMIT);
  for (const s of recent) {
    const tr = document.createElement('tr');
    tr.dataset.sessionId = s.id;

    const date = document.createElement('td');
    date.textContent = new Date(s.startedAt).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });

    const label = document.createElement('td');
    label.appendChild(createLabelPicker(s, labelPickerCtx()));

    const planned = document.createElement('td');
    planned.textContent = formatDuration(s.plannedS);
    const actual = document.createElement('td');
    actual.textContent = formatDuration(s.actualS);

    const outcome = document.createElement('td');
    outcome.textContent = s.outcome === 'completed' ? 'Completed' : 'Ended early';
    outcome.className = s.outcome === 'completed' ? 'dash__outcome--completed' : 'dash__outcome--overridden';

    tr.append(date, label, planned, actual, outcome);
    els.sessionsBody.appendChild(tr);
  }
}

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

  renderSummary(stats);
  els.miniRow.hidden = stats.n === 0;
  els.emptyHint.hidden = stats.n > 0;
  els.factsCard.hidden = false;
  renderFacts(sessions, stats.foc);
  renderTrend(trend);
  renderBreakdown(topics);
  renderSessionsTable(sessions);
  renderLabelsList(customLabels, els, labelsCtx);

  calSessions = sessions;
  calCustomLabels = customLabels;
  calGoals = goals;
  // Computed once here and passed into the panel, rather than letting
  // goalsPanel.js call computeGoalProgress itself -- both would read their
  // own Date.now(), so a render straddling a local-midnight (or Sunday-
  // midnight) window boundary could show a row's bar computed against one
  // window and its "Week of ..." caption against the next.
  goalsProgress = computeGoalProgress(goals, sessions);
  renderGoalsList(goals, goalsProgress, els, goalsCtx);
  renderCalendar();
}

function renderAll(sessions, customLabels, goals = []) {
  calCursor = startOfMonth(new Date());
  calSelectedKey = dayKey(Date.now());
  renderDataViews(sessions, customLabels, goals);
}

// ---------- Per-session relabel picker ----------
// Ownership moved to sessionLabelPicker.js (imported above) -- see that
// file's header comment. dashboard.js keeps only the two call sites
// (renderCalDayList, renderSessionsTable, both above) plus labelPickerCtx().

// ---------- Focus goals persistence ----------
// Called only from goalsPanel.js, via goalsCtx.writeGoals above -- the panel
// composes the next array with goals.js's createGoal/updateGoal/archiveGoal
// against calGoals and hands the result here. Kept in this file (not moved
// into the panel alongside labelsPanel.js's own writeCustomLabels) so
// dashboard.js remains the single module that touches Firestore for this doc.
// Re-throws after surfacing the banner so the panel can tell a failed write
// from a successful one (it restores its open form and re-enables its
// buttons on failure).
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
 * clock. Tombstones are
 * pruned right before the write lands (see goals.js's pruneArchivedGoals),
 * not on every read, so a fresh tombstone still gets its full propagation
 * window before it can be dropped by whichever side happens to write next. */
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

// ---------- Manage labels panel ----------
// Ownership moved to labelsPanel.js (imported above) -- see that file's
// header comment. dashboard.js keeps only labelsCtx (above) and the
// mountLabelsPanel(...) one-time wiring call in init() below.

// ---------- Firebase wiring ----------
function showError(err) {
  if (isIgnorableAuthError(err)) return;
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

async function loadDashboard(db, uid) {
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
    showState('content');
  } catch (err) {
    showError(err);
  }
}

function init() {
  mountLabelsPanel(els, labelsCtx);
  mountGoalsPanel();

  if (!isFirebaseConfigured()) {
    showState('notConfigured');
    return;
  }

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  els.signOutBtn.addEventListener('click', () => {
    signOut(auth).catch(showError);
  });

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      // Gated page: signed-out visitors belong on login.html, not on a
      // "please sign in" state rendered here. `replace` so the gated view
      // never sits in history for the back button to land on.
      window.location.replace('login.html');
      return;
    }
    els.signOutBtn.hidden = false;
    loadDashboard(db, user.uid);
  });
}

init();
