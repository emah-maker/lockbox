/* =========================================================================
   calendarPanel.js -- owns the focus calendar end-to-end: the month grid
   (heatmap cells + selected-day outline + today marker), the prev/next month
   cursor, the selected day's session list, and the per-cell/per-row wiring
   that reads live off it. Split out of dashboard.js for the same reason
   goalsPanel.js/labelsPanel.js/accountPanel.js already are -- one bounded
   feature's render logic living together in one file, kept out of
   dashboard.js so that file doesn't grow past the project's 500-line
   guideline.

   Unlike those three panels, this one owns no Firestore write of its own --
   a day-list row's relabel goes through sessionLabelPicker.js exactly as it
   did in dashboard.js, via ctx.labelPickerCtx() below -- and it keeps its
   own month-cursor/selected-day state internally rather than exposing it to
   dashboard.js, the same way labelsPanel.js's popover-open state and
   goalsPanel.js's open-form state are private to those modules. That is why
   navigating months or picking a day only repaints this card (calling this
   module's own internal `draw`), not the whole page via renderDataViews --
   matching dashboard.js's original renderCalendar behavior exactly.

   `resetCalendarView` is the one crack in that privacy: renderAll (a fresh
   sign-in or reload, in dashboard.js) needs to snap the cursor back to the
   current month and the selection back to today, the same way it always
   did, rather than leaving whatever month a *previous* signed-in user (or a
   long-idle tab) had scrolled to.

   ctx (rebuilt fresh by dashboard.js on every renderCalendar call, since
   theme/themeMode change under it) = {
     theme,             // resolved theme object -- for the heatmap fill/text
     themeMode,         // 'dark' | 'light' -- for dominantTopicWithCustom
     labelPickerCtx(),  // -> a fresh sessionLabelPicker.js ctx; called once
                         //    per day-list row, same as dashboard.js did
   }
   ========================================================================= */
import {
  dayKey,
  dayKeyToDate,
  groupByDay,
  buildMonthGrid,
  dominantTopicWithCustom,
  formatDuration,
  readableTextColor,
  startOfMonth,
  heatmapLevel,
  ALPHA_FOR_LEVEL,
} from './focusStats.js';
import { compositeHex } from './theme.js';
import { createLabelPicker } from './sessionLabelPicker.js';
import { clear } from './dom.js';

// ---------- Calendar state (month cursor + selected day) ----------
// Private to this module -- see the header comment above for why
// dashboard.js only ever reaches in via resetCalendarView, never directly.
let calCursor = startOfMonth(new Date());
let calSelectedKey = dayKey(Date.now());

// Cached from the most recent renderCalendar call so the prev/next buttons
// and a day-cell click can repaint (`draw`) without dashboard.js having to
// re-supply sessions/customLabels/ctx for a change that never touches them.
let calSessions = [];
let calCustomLabels = [];
let calEls = null;
let calCtx = null;

function drawDayList(daySessions) {
  calEls.calDayTitle.textContent = dayKeyToDate(calSelectedKey).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
  clear(calEls.calDayList);
  if (daySessions.length === 0) {
    const li = document.createElement('li');
    li.className = 'dash__cal-empty';
    li.textContent = 'No focus sessions logged this day.';
    calEls.calDayList.appendChild(li);
    return;
  }
  for (const s of daySessions.slice().sort((a, b) => a.startedAt - b.startedAt)) {
    const li = document.createElement('li');
    li.dataset.sessionId = s.id;
    const time = document.createElement('span');
    time.textContent = new Date(s.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const dur = document.createElement('span');
    dur.textContent = formatDuration(s.actualS);
    const label = createLabelPicker(s, calCtx.labelPickerCtx());
    const outcome = document.createElement('span');
    outcome.textContent = s.outcome === 'completed' ? 'Completed' : 'Ended early';
    li.append(time, dur, label, outcome);
    calEls.calDayList.appendChild(li);
  }
}

function draw() {
  const byDay = groupByDay(calSessions);
  const grid = buildMonthGrid(calCursor);
  const todayKey = dayKey(Date.now());
  // Busiest day within the on-screen month grid itself, not an all-time
  // global max -- mirrors app/src/screens/calendar/monthGrid.ts's
  // monthHeatLevels (see its doc comment): a legend/heatmap that reads
  // "this is the month's busiest day" should mean the busiest day actually
  // on screen, so paging to a quiet month doesn't leave every cell looking
  // washed-out relative to some other month's record day the user isn't
  // looking at right now.
  const maxFocus = Math.max(
    1,
    ...grid
      .filter(Boolean)
      .map((date) => (byDay.get(dayKey(date.getTime())) || []).reduce((sum, s) => sum + s.actualS, 0)),
  );
  const { theme, themeMode } = calCtx;

  calEls.calMonthLabel.textContent = calCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  clear(calEls.calGrid);

  for (const date of grid) {
    const cell = document.createElement('div');
    if (!date) {
      calEls.calGrid.appendChild(cell);
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
      // Buckets this day's focus time into one of 5 discrete intensity
      // levels (0-4) relative to the busiest day in the on-screen month,
      // then looks up that level's fill alpha -- mirrors
      // app/src/screens/calendar/monthGrid.ts's monthHeatLevels, which
      // routes through app/src/stats/trend.ts's heatmapLevel and
      // app/src/theme/dayHeat.ts's ALPHA_FOR_LEVEL (both ported above in
      // focusStats.js). This app abandoned the old continuous alpha scheme
      // specifically because it can't back a heat legend (a legend needs
      // nameable discrete steps, not an unbounded gradient); the website
      // now uses the same discrete model. Pre-composited against the card
      // surface (rather than a real alpha channel) so the text color below
      // can be picked by measured contrast at this exact resulting shade,
      // instead of assuming the app's fixed accentText clears 4.5:1 at
      // every level/accent/mode combination -- a genuine website-side
      // improvement over the app that this fix preserves.
      const level = heatmapLevel(focusS, maxFocus);
      const fill = compositeHex(theme.accent, theme.surface, ALPHA_FOR_LEVEL[level]);
      btn.style.background = fill;
      btn.style.color = readableTextColor(fill);
    }
    btn.addEventListener('click', () => {
      calSelectedKey = key;
      draw();
    });
    cell.appendChild(btn);

    if (dominant) {
      const dot = document.createElement('span');
      dot.className = 'dash__cal-dot';
      dot.style.background = dominant.color;
      cell.appendChild(dot);
    }
    calEls.calGrid.appendChild(cell);
  }

  drawDayList(byDay.get(calSelectedKey) || []);
}

/** Repaints the calendar from the current (sessions, customLabels) state --
 * called from dashboard.js's renderDataViews on every pass, exactly like the
 * other panels' renderX functions. Caches its arguments so the internal
 * prev/next/day-click handlers can redraw without dashboard.js involved. */
export function renderCalendar(sessions, customLabels, els, ctx) {
  calSessions = sessions;
  calCustomLabels = customLabels;
  calEls = els;
  calCtx = ctx;
  draw();
}

/** Snaps the cursor/selection back to "now" -- called once from
 * dashboard.js's renderAll (a fresh sign-in or reload), never from
 * renderDataViews, so a relabel/goals/labels write never silently scrolls
 * the calendar back to today's month out from under the viewer. */
export function resetCalendarView() {
  calCursor = startOfMonth(new Date());
  calSelectedKey = dayKey(Date.now());
}

/** One-time wiring for the prev/next month buttons. Call once from
 * dashboard.js's init(), after `els` is resolved. */
export function mountCalendarPanel(els) {
  els.calPrev.addEventListener('click', () => {
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
    draw();
  });
  els.calNext.addEventListener('click', () => {
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
    draw();
  });
}
