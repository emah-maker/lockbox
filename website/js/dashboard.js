/* =========================================================================
   dashboard.js -- wires dashboard.html to Firebase Auth (Google sign-in) +
   Firestore, reading the exact documents app/src/sync/firestoreSync.ts
   writes (users/{uid}/sessions, users/{uid}/settings/app), and rendering
   them with the pure helpers in focusStats.js. Read-only: firestore.rules
   makes session docs create-only, so there is nothing for this page to
   write back (a past session's label can only ever be retagged from the
   app -- see app/src/sync/sessionMerge.ts's comment on why that never syncs
   back to an already-created remote doc).

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
  resolveTopic,
  topicBreakdownWithCustom,
  dominantTopicWithCustom,
  topComparisons,
  formatComparison,
  startOfMonth,
  buildMonthGrid,
  readableTextColor,
} from './focusStats.js';

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
};

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
    const time = document.createElement('span');
    time.textContent = new Date(s.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const dur = document.createElement('span');
    dur.textContent = formatDuration(s.actualS);
    const label = document.createElement('span');
    label.style.display = 'inline-flex';
    label.style.alignItems = 'center';
    label.style.gap = '6px';
    const resolved = resolveTopic(s.topic, calCustomLabels, themeMode);
    if (resolved) {
      const dot = document.createElement('span');
      dot.className = 'dash__cal-dot';
      dot.style.background = resolved.color;
      label.appendChild(dot);
      const nameSpan = document.createElement('span');
      nameSpan.textContent = resolved.label;
      label.appendChild(nameSpan);
    } else {
      label.textContent = 'Untagged';
    }
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
function renderSessionsTable(sessions, customLabels) {
  clear(els.sessionsBody);
  const recent = sessions.slice().sort((a, b) => b.startedAt - a.startedAt).slice(0, RECENT_LIMIT);
  for (const s of recent) {
    const tr = document.createElement('tr');

    const date = document.createElement('td');
    date.textContent = new Date(s.startedAt).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });

    const label = document.createElement('td');
    const resolved = resolveTopic(s.topic, customLabels, themeMode);
    if (resolved) {
      const chip = document.createElement('span');
      chip.className = 'dash__chip';
      chip.style.background = resolved.color;
      chip.style.color = resolved.textColor;
      chip.textContent = resolved.label;
      label.appendChild(chip);
    } else {
      label.textContent = '—';
    }

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

function renderAll(sessions, customLabels) {
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
  renderSessionsTable(sessions, customLabels);

  calSessions = sessions;
  calCustomLabels = customLabels;
  calCursor = startOfMonth(new Date());
  calSelectedKey = dayKey(Date.now());
  renderCalendar();
}

// ---------- Firebase wiring ----------
function showError(err) {
  if (isIgnorableAuthError(err)) return;
  els.errorMsg.textContent = friendlyErrorMessage(err);
  showState('error');
}

async function loadDashboard(db, uid) {
  showState('loading');
  try {
    const [sessionsSnap, settingsSnap] = await Promise.all([
      getDocs(query(
        collection(db, 'users', uid, 'sessions'),
        orderBy('startedAt', 'desc'),
        limit(SESSIONS_QUERY_LIMIT),
      )),
      getDoc(doc(db, 'users', uid, 'settings', 'app')),
    ]);
    // Back to oldest-first -- the query above reads newest-first so the cap
    // keeps the *most recent* sessions, but every render/aggregate helper
    // below expects oldest-first input.
    const sessions = sessionsSnap.docs.map((d) => d.data()).reverse();
    const settings = settingsSnap.exists() ? settingsSnap.data() : {};
    const customLabels = settings.customLabels || [];
    // Same themeMode/accent fields useSettingsStore.ts syncs from the app
    // (SyncableSettings) -- resolving them here is what makes this page look
    // like *this user's* app, not just a fixed website palette.
    themeMode = settings.themeMode === 'light' ? 'light' : DEFAULT_THEME_MODE;
    theme = resolveTheme(themeMode, settings.accent || DEFAULT_ACCENT);
    applyTheme(theme);
    renderAll(sessions, customLabels);
    showState('content');
  } catch (err) {
    showError(err);
  }
}

function init() {
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
