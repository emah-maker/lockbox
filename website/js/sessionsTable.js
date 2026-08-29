/* =========================================================================
   sessionsTable.js -- owns the "Recent sessions" table: the most-recent-N
   row cap, the per-row relabel picker, and its own "No sessions yet." empty
   row. Split out of dashboard.js for the same reason calendarPanel.js is --
   one bounded render living in its own file rather than padding out
   dashboard.js, which stays the composition root.

   No write of its own: a relabel goes through sessionLabelPicker.js exactly
   as it did in dashboard.js, via ctx.labelPickerCtx() below.

   ctx (rebuilt fresh by dashboard.js on every call, since dashDb/dashUid/
   calCustomLabels/themeMode change under it) = {
     labelPickerCtx(),  // -> a fresh sessionLabelPicker.js ctx; called once
                         //    per row, same as dashboard.js did
   }
   ========================================================================= */
import { formatDuration } from './focusStats.js';
import { createLabelPicker } from './sessionLabelPicker.js';
import { clear } from './dom.js';

const RECENT_LIMIT = 25;

export function renderSessionsTable(sessions, els, ctx) {
  clear(els.sessionsBody);
  const recent = sessions.slice().sort((a, b) => b.startedAt - a.startedAt).slice(0, RECENT_LIMIT);
  // Every other data panel (breakdown, facts, labels list, goals list, the
  // calendar's day list) has its own "nothing here yet" message -- this table
  // didn't, so a brand-new account saw a header row sitting over a blank
  // body with no explanation, indistinguishable from a render that silently
  // failed. dashEmptyHint (rendered above the fold) already covers the
  // account-wide empty state, but this card is far enough down the page that
  // its own empty row still matters.
  if (recent.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'dash__cal-empty';
    td.textContent = 'No sessions yet.';
    tr.appendChild(td);
    els.sessionsBody.appendChild(tr);
    return;
  }
  for (const s of recent) {
    const tr = document.createElement('tr');
    tr.dataset.sessionId = s.id;

    const date = document.createElement('td');
    date.textContent = new Date(s.startedAt).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });

    const label = document.createElement('td');
    label.appendChild(createLabelPicker(s, ctx.labelPickerCtx()));

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
