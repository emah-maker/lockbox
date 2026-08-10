/* =========================================================================
   dashboard.js -- wires dashboard.html to Firebase Auth (Google sign-in) +
   Firestore, reading the exact documents app/src/sync/firestoreSync.ts
   writes (users/{uid}/sessions, users/{uid}/settings/app), and rendering
   them with the pure helpers in focusStats.js. Read-only: firestore.rules
   makes session docs create-only, so there is nothing for this page to
   write back (a past session's label can only ever be retagged from the
   app -- see app/src/sync/sessionMerge.ts's comment on why that never syncs
   back to an already-created remote doc).
   ========================================================================= */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
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
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig, isFirebaseConfigured } from './firebaseConfig.js';
import {
  aggregate,
  formatDuration,
  completionRate,
  dayKey,
  groupByDay,
  lastNDays,
  resolveTopic,
  topicBreakdownWithCustom,
  dominantTopicWithCustom,
  topComparisons,
  formatComparison,
  startOfMonth,
  buildMonthGrid,
} from './focusStats.js';

const TOP_FACTS = 5;

const els = {
  notConfigured: document.getElementById('dashNotConfigured'),
  signedOut: document.getElementById('dashSignedOut'),
  loading: document.getElementById('dashLoading'),
  error: document.getElementById('dashError'),
  errorMsg: document.getElementById('dashErrorMsg'),
  content: document.getElementById('dashContent'),
  summary: document.getElementById('dashSummary'),
  emptyHint: document.getElementById('dashEmptyHint'),
  factsCard: document.getElementById('dashFactsCard'),
  facts: document.getElementById('dashFacts'),
  trend: document.getElementById('dashTrend'),
  breakdown: document.getElementById('dashBreakdown'),
  sessionsBody: document.getElementById('dashSessionsBody'),
  signInBtn: document.getElementById('signInBtn'),
  signOutBtn: document.getElementById('signOutBtn'),
  calPrev: document.getElementById('dashCalPrev'),
  calNext: document.getElementById('dashCalNext'),
  calMonthLabel: document.getElementById('dashCalMonthLabel'),
  calGrid: document.getElementById('dashCalGrid'),
  calDayTitle: document.getElementById('dashCalDayTitle'),
  calDayList: document.getElementById('dashCalDayList'),
};

const STATES = ['notConfigured', 'signedOut', 'loading', 'error', 'content'];
function showState(name) {
  for (const s of STATES) els[s].hidden = s !== name;
}

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

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
    const dominant = dominantTopicWithCustom(daySessions, calCustomLabels);

    cell.className = 'dash__cal-cell';
    if (key === calSelectedKey) cell.classList.add('dash__cal-cell--selected');
    if (key === todayKey) cell.classList.add('dash__cal-cell--today');
    if (focusS > 0) cell.classList.add('dash__cal-cell--focus');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dash__cal-daynum';
    btn.textContent = String(date.getDate());
    if (focusS > 0) {
      const intensity = 0.25 + 0.75 * Math.min(1, focusS / maxFocus);
      btn.style.background = `rgba(0, 192, 64, ${intensity.toFixed(2)})`;
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
    const resolved = resolveTopic(s.topic, calCustomLabels);
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

// ---------- Summary tiles ----------
function renderSummary(stats) {
  clear(els.summary);
  const tiles = [
    ['Total focus time', formatDuration(stats.foc)],
    ['Sessions', String(stats.n)],
    ['Completed', `${completionRate(stats)}%`],
    ['Streak', String(stats.str)],
    ['Longest', formatDuration(stats.lng)],
  ];
  for (const [label, value] of tiles) {
    const tile = document.createElement('div');
    tile.className = 'dash__tile';
    const l = document.createElement('div');
    l.className = 'dash__tile-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'dash__tile-value';
    v.textContent = value;
    tile.append(l, v);
    els.summary.appendChild(tile);
  }
}

// ---------- Fun facts ----------
function renderFacts(totalFocusS) {
  clear(els.facts);
  if (totalFocusS <= 0) {
    const p = document.createElement('p');
    p.className = 'dash__facts-empty';
    p.textContent = 'Finish a focus session to see how it stacks up.';
    els.facts.appendChild(p);
    return;
  }
  for (const cmp of topComparisons(totalFocusS).slice(0, TOP_FACTS)) {
    const p = document.createElement('p');
    p.textContent = formatComparison(cmp);
    els.facts.appendChild(p);
  }
}

// ---------- 7-day trend ----------
function renderTrend(trend) {
  clear(els.trend);
  const max = Math.max(1, ...trend.map((d) => d.focusS));
  for (const d of trend) {
    const col = document.createElement('div');
    col.className = 'dash__trend-day';
    const bar = document.createElement('div');
    bar.className = 'dash__trend-bar';
    const h = Math.max(4, Math.round((d.focusS / max) * 100));
    bar.style.height = `${h}%`;
    bar.title = formatDuration(d.focusS);
    const label = document.createElement('div');
    label.className = 'dash__trend-label';
    label.textContent = d.label;
    col.append(bar, label);
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
    const fill = document.createElement('div');
    fill.className = 'dash__breakdown-fill';
    fill.style.width = `${Math.max(4, Math.round((t.focusS / max) * 100))}%`;
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
    const resolved = resolveTopic(s.topic, customLabels);
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
  const topics = topicBreakdownWithCustom(sessions, customLabels);

  renderSummary(stats);
  els.emptyHint.hidden = stats.n > 0;
  els.factsCard.hidden = false;
  renderFacts(stats.foc);
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
  els.errorMsg.textContent = err && err.message ? err.message : 'Something went wrong loading your data.';
  showState('error');
}

async function loadDashboard(db, uid) {
  showState('loading');
  try {
    const [sessionsSnap, settingsSnap] = await Promise.all([
      getDocs(query(collection(db, 'users', uid, 'sessions'), orderBy('startedAt'))),
      getDoc(doc(db, 'users', uid, 'settings', 'app')),
    ]);
    const sessions = sessionsSnap.docs.map((d) => d.data());
    const customLabels = settingsSnap.exists() ? settingsSnap.data().customLabels || [] : [];
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

  els.signInBtn.addEventListener('click', () => {
    signInWithPopup(auth, new GoogleAuthProvider()).catch(showError);
  });
  els.signOutBtn.addEventListener('click', () => {
    signOut(auth).catch(showError);
  });

  onAuthStateChanged(auth, (user) => {
    els.signOutBtn.hidden = !user;
    if (user) {
      loadDashboard(db, user.uid);
    } else {
      showState('signedOut');
    }
  });
}

init();
