/* =========================================================================
   statsCards.js -- owns the four top-of-page stat cards: the "Total focus
   time" summary tile row, the fun-facts card (best day + comparisons), the
   7-day trend bars, and the label breakdown bars. Split out of
   dashboard.js for the same reason calendarPanel.js/sessionsTable.js are --
   grouped together here (rather than four separate files) because all four
   are pure "given today's aggregated numbers, paint a card" renders with no
   state, no writes, and no wiring of their own, unlike the calendar or the
   sessions table (both of which own click handlers).

   dashboard.js's renderDataViews still owns the miniRow/emptyHint/factsCard
   `hidden` toggles that gate these cards on first paint -- those depend on
   `stats.n` and on more than one card at once, so they stay in the
   orchestrator rather than being duplicated into two of these four
   functions.
   ========================================================================= */
import {
  formatDuration,
  completionRate,
  bestDay,
  topComparisons,
  formatComparison,
} from './focusStats.js';
import { compositeHex } from './theme.js';
import { clear } from './dom.js';

const TOP_FACTS = 5;

// ---------- Summary card ----------
// Mirrors StatsScreen.tsx's single "Total focus time" card exactly (big
// accent total + sub-copy + a borderless Completed/Streak/Longest row)
// rather than five separately-boxed tiles.
export function renderSummary(stats, els) {
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

/** `labels`/`excludedTopicKeys` are the same two lists renderDataViews
 * hands aggregate(), and must stay the same two: `totalFocusS` above is
 * aggregate's own excluded total, so bestDay has to be measured against the
 * identical session set or the banner can name a day bigger than the total
 * printed above it. Defaulted to `[]` only so the signature degrades to the
 * old behavior rather than throwing; every real caller passes both. */
export function renderFacts(sessions, totalFocusS, els, labels = [], excludedTopicKeys = []) {
  clear(els.facts);
  if (totalFocusS <= 0) {
    const p = document.createElement('p');
    p.className = 'dash__facts-empty';
    p.textContent = 'Finish a focus session to see how it stacks up.';
    els.facts.appendChild(p);
    return;
  }
  const best = bestDay(sessions, labels, excludedTopicKeys);
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
export function renderTrend(trend, els) {
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
export function renderBreakdown(topics, theme, els) {
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
