/* =========================================================================
   goalsPanel.js -- owns the "Focus goals" panel end-to-end: the goal list
   with its current-period progress bars, the add/edit form (topic select +
   period select + hours/minutes target), the inline delete confirmation,
   the at-capacity state, and every createGoal/updateGoal/archiveGoal call.
   Split out of dashboard.js so this one bounded feature's render + write
   logic live together in one file -- the same rationale (and the same
   mount-once + ctx-getter shape) as labelsPanel.js and
   sessionLabelPicker.js. The form itself is one further split out, into
   goalForm.js, so both files stay under the 500-line guideline.

   Unlike labelsPanel.js, the Firestore write itself is NOT owned here:
   dashboard.js's writeGoals() already existed for this doc (it prunes
   tombstones, stamps the client logical clock, does the whole-doc setDoc,
   surfaces errors via showWriteError, and re-renders), so this module calls
   it through ctx.writeGoals rather than importing firebase-firestore and
   duplicating that path. That is also why there is no `getDb`/`getUid`
   getter in this module's ctx.

   1:1 with app/src/screens/GoalsSection.tsx by intent -- the two are hand-
   ports of each other the same way focusStats.js is of app/src/stats/*
   (see docs/rfcs/google-signin-cross-device-sync-architecture.md). The
   progress-bar geometry, the over-target treatment, the topic/period/target
   fields, and the copy are all deliberately the same; if one changes,
   change both. The one intentional divergence is input granularity: the app
   sets minutes on a 5-minute WheelPicker stop (matching its lock-duration
   wheels), this uses a plain number input, so a target set here can land on
   a minute the app's wheel then snaps for display. Both still produce a
   whole-minute targetS, so nothing about the STORED shape or the sync
   semantics differs -- only the widget.
   ========================================================================= */
import { createGoal, updateGoal, archiveGoal, goalWindow, isGoalDueOn, MAX_GOALS } from './goals.js';
import { resolveTopic, formatDuration } from './focusStats.js';
import { showMessage } from './dashMessage.js';
import { buildGoalForm } from './goalForm.js';

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}


// Module-scoped: exactly one form (add OR edit) can be open at a time for
// the page -- a second one would write through the same message slot as the
// first and read as one form's error appearing under the other. `null` means
// no form is open; otherwise the id of the goal being edited, or
// ADD_FORM_KEY for the create form.
const ADD_FORM_KEY = '__add__';
let openFormKey = null;

/** Display name for a goal's stored topic string. Mirrors
 * GoalsSection.tsx's describeTopic exactly, including its fallbacks:
 * `null` is the all-focus-time goal; a since-deleted saved custom label
 * still has a working goal (goals.js matches on the raw id) so it gets an
 * explicit name rather than an empty row; and a raw one-time free-text tag
 * renders as itself. focusStats.js's resolveTopic has no one-time-tag
 * fallback of its own (the app's does), so the two cases are told apart
 * here by the `custom:` prefix -- the same local reclassification
 * sessionLabelPicker.js's isOneTimeTag does, and for the same reason. */
function describeTopic(topic, customLabels, themeMode) {
  if (topic === null || topic === undefined) return 'All focus time';
  const resolved = resolveTopic(topic, customLabels, themeMode);
  if (resolved) return resolved.label;
  return topic.startsWith('custom:') ? 'Deleted label' : topic;
}

function topicColor(topic, customLabels, themeMode) {
  if (topic === null || topic === undefined) return 'var(--unlocked)';
  const resolved = resolveTopic(topic, customLabels, themeMode);
  return resolved ? resolved.color : 'var(--text-3)';
}

/** Progress bar geometry, handling the over-target case explicitly instead
 * of letting a >100% ratio silently saturate at a full bar (goals.js leaves
 * `ratio` unclamped for exactly this reason). Byte-for-byte the same math as
 * GoalsSection.tsx's barGeometry: the track's full width represents
 * max(1, ratio), so an over-target goal fills the bar completely AND grows a
 * target notch that slides leftward as the overshoot grows -- 180% of target
 * reads as a full bar with the notch at 55% of its width, i.e. you can see
 * how far past the line you went. Under target the notch would sit at the
 * track's own end, where it's redundant, so it isn't drawn. */
function barGeometry(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return { fillPct: 0, targetPct: null };
  const denom = Math.max(1, ratio);
  return { fillPct: (ratio / denom) * 100, targetPct: ratio > 1 ? (1 / denom) * 100 : null };
}

/** The window's own date range, so "this week"/"this month" is never
 * ambiguous about which one. goalWindow is Sunday-start for weekly (see its
 * comment in goals.js and app/src/goals/goalProgress.ts's weeklyWindow) --
 * do not introduce a Monday-start label here. */
function describeWindow(period, nowMs) {
  const { startMs } = goalWindow(period, nowMs);
  if (period === 'daily') return new Date(startMs).toLocaleDateString(undefined, { weekday: 'long' });
  if (period === 'monthly') return new Date(startMs).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return `Week of ${new Date(startMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/** Period label for the row's pill tag -- confirmed against
 * GoalsSection.tsx's own PERIOD_LABEL / GoalsProgressView.tsx's
 * PERIOD_LABELS. */
function periodLabel(period) {
  if (period === 'daily') return 'Daily';
  if (period === 'monthly') return 'Monthly';
  return 'Weekly';
}

/** Compact "Sun, Wed, Fri" summary for a day-restricted daily goal's
 * daysOfWeek -- `null` when there's nothing to show (unset, empty, or the
 * "every weekday selected" case the form already collapses to `undefined`
 * on submit). Confirmed against GoalsSection.tsx's own
 * weekdayRestrictionLabel / GoalsProgressView.tsx's identical helper. */
function weekdayRestrictionLabel(goal) {
  const days = goal.daysOfWeek;
  if (!days || days.length === 0 || days.length >= 7) return null;
  const abbr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days.map((d) => abbr[d] ?? '?').join(', ');
}


/* ---------------------------------------------------------------------------
   One goal's row: identity + progress + actions, with an inline delete
   confirmation swapped in for the main face (same two-face `swap()`
   technique labelsPanel.js's label rows use).
   --------------------------------------------------------------------------- */
function buildGoalRow(goal, result, els, ctx) {
  const customLabels = ctx.getCustomLabels();
  const themeMode = ctx.getThemeMode();
  const name = describeTopic(goal.topic, customLabels, themeMode);
  const swatchColor = topicColor(goal.topic, customLabels, themeMode);
  const focusS = result ? result.focusS : 0;
  const ratio = result ? result.ratio : 0;
  const met = result ? result.met : false;
  const remainingS = result ? result.remainingS : goal.targetS;
  const sessionCount = result ? result.sessionCount : 0;
  const dueToday = result ? result.dueToday : isGoalDueOn(goal, Date.now());
  const restriction = weekdayRestrictionLabel(goal);
  const { fillPct, targetPct } = barGeometry(ratio);
  const percent = Math.round(ratio * 100);

  const li = document.createElement('li');
  li.className = 'dash__goals-row';
  li.dataset.goalId = goal.id;

  const main = document.createElement('div');
  main.className = 'dash__goals-row-main dash__pick-fade is-in';

  const head = document.createElement('div');
  head.className = 'dash__goals-head';
  const swatch = document.createElement('span');
  swatch.className = 'dash__goals-swatch';
  swatch.style.background = swatchColor;
  const nameEl = document.createElement('span');
  nameEl.className = 'dash__goals-name';
  nameEl.textContent = name;
  const periodTag = document.createElement('span');
  periodTag.className = 'dash__goals-period';
  periodTag.textContent = periodLabel(goal.period);
  head.append(swatch, nameEl, periodTag);
  if (restriction) {
    const restrictionTag = document.createElement('span');
    restrictionTag.className = 'dash__goals-period';
    restrictionTag.textContent = restriction;
    head.appendChild(restrictionTag);
  }
  if (!dueToday) {
    const dueTag = document.createElement('span');
    dueTag.className = 'dash__goals-period';
    dueTag.textContent = 'Not due today';
    head.appendChild(dueTag);
  }

  const track = document.createElement('div');
  track.className = 'dash__goals-track';
  // Announced as one unit rather than leaving a bare decorative bar -- same
  // approach as the app row's accessibilityLabel, and as dashboard.js's own
  // one-summary-per-chart treatment of the trend/heatmap.
  track.setAttribute('role', 'img');
  track.setAttribute(
    'aria-label',
    `${name}, ${goal.period} goal: ${formatDuration(focusS)} of ${formatDuration(goal.targetS)}, ${percent} percent`,
  );
  const fill = document.createElement('div');
  fill.className = 'dash__goals-fill';
  if (met) fill.classList.add('dash__goals-fill--met');
  // Scale via transform, not `width` -- same convention (and reason) as
  // dashboard.js's .dash__trend-bar/.dash__breakdown-fill: transform and
  // opacity skip layout on change.
  fill.style.setProperty('--w', fillPct / 100);
  if (!met) fill.style.background = swatchColor;
  track.appendChild(fill);
  if (targetPct !== null) {
    const notch = document.createElement('div');
    notch.className = 'dash__goals-notch';
    notch.style.left = `${targetPct}%`;
    track.appendChild(notch);
  }

  const meta = document.createElement('div');
  meta.className = 'dash__goals-meta';
  const metaText = document.createElement('span');
  const sessionsPart = goal.targetSessions !== undefined ? ` · ${sessionCount}/${goal.targetSessions} sessions` : '';
  metaText.textContent = met
    ? `${formatDuration(focusS)} of ${formatDuration(goal.targetS)}${sessionsPart}`
    : `${formatDuration(focusS)} of ${formatDuration(goal.targetS)} · ${formatDuration(remainingS)} to go${sessionsPart}`;
  const metaPct = document.createElement('span');
  metaPct.className = met ? 'dash__goals-pct dash__goals-pct--met' : 'dash__goals-pct';
  metaPct.textContent = `${percent}%`;
  meta.append(metaText, metaPct);

  const actions = document.createElement('div');
  actions.className = 'dash__goals-actions';
  const windowEl = document.createElement('span');
  windowEl.className = 'dash__goals-window';
  windowEl.textContent = describeWindow(goal.period, Date.now());
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'dash__goals-action';
  edit.textContent = 'Edit';
  edit.setAttribute('aria-label', `Edit ${name} goal`);
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'dash__goals-action dash__goals-action--danger';
  del.textContent = 'Delete';
  del.setAttribute('aria-label', `Delete ${name} goal`);
  actions.append(windowEl, edit, del);

  main.append(head, track, meta, actions);

  // ---------- confirm face ----------
  const confirm = document.createElement('div');
  confirm.className = 'dash__goals-confirm dash__pick-fade';
  confirm.hidden = true;
  const confirmText = document.createElement('span');
  confirmText.className = 'dash__labels-confirm-text';
  // Says what archiveGoal actually does: writes a tombstone for this goal,
  // touching nothing about the sessions it was measured against.
  confirmText.textContent = `Stop tracking "${name}"? Your logged sessions are not affected.`;
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn--sm btn--ghost';
  cancelBtn.textContent = 'Cancel';
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'dash__labels-confirm-delete';
  deleteBtn.textContent = 'Delete';
  confirm.append(confirmText, cancelBtn, deleteBtn);

  function swap(hideEl, showEl) {
    hideEl.hidden = true;
    hideEl.classList.remove('is-in');
    showEl.hidden = false;
    showEl.classList.remove('is-in');
    void showEl.offsetHeight;
    showEl.classList.add('is-in');
  }

  del.addEventListener('click', () => {
    swap(main, confirm);
    cancelBtn.focus(); // the safe default gets focus for a destructive action
  });
  cancelBtn.addEventListener('click', () => {
    swap(confirm, main);
    del.focus();
  });
  confirm.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      swap(confirm, main);
      del.focus();
    }
  });
  deleteBtn.addEventListener('click', async () => {
    // Disable first: a successful delete re-renders this row away anyway,
    // but disabling blocks a double-click from firing two overlapping
    // archiveGoal writes while the first is still in flight -- same
    // reasoning as labelsPanel.js's delete button.
    deleteBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      await ctx.writeGoals(archiveGoal(ctx.getGoals(), goal.id));
      showMessage(els.goalsMsg, 'Goal deleted.', { kind: 'ok', autoDismissMs: 4000 });
    } catch (writeErr) {
      // writeGoals already surfaced the top-of-page banner (showWriteError)
      // before re-throwing; re-enable so the row is usable again, since a
      // failed write left it rendered rather than tearing it down.
      deleteBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  });

  edit.addEventListener('click', () => {
    openFormKey = goal.id;
    const { form, focusFirst } = buildGoalForm({
      initial: goal,
      submitLabel: 'Save goal',
      customLabels,
      themeMode,
      onSubmit: async (topic, period, targetS, extra) => {
        // updateGoal (goals.js) validates the MERGED result and throws a
        // renderable message; the form's own catch renders it. Thrown here,
        // openFormKey is untouched, so the form simply stays open.
        //
        // The form always hands back every extension field's current value
        // (undefined = "not set/toggled off"), mapped here to GoalPatch's own
        // explicit-`null`-clears convention (goals.js/goals.ts) for
        // daysOfWeek/targetSessions/notifyAt -- confirmed against
        // GoalsSection.tsx's own handleSave. `notify` is always a defined
        // boolean, so it needs no such mapping.
        const next = updateGoal(ctx.getGoals(), goal.id, {
          topic,
          period,
          targetS,
          daysOfWeek: extra.daysOfWeek ?? null,
          targetSessions: extra.targetSessions ?? null,
          notify: extra.notify,
          notifyAt: extra.notifyAt ?? null,
        });
        // Cleared BEFORE the write, because a successful writeGoals
        // re-renders this whole panel from inside -- if the flag were still
        // set at that moment, renderGoalsList would rebuild the edit form
        // over the freshly-saved row. Restored on failure, since then no
        // re-render happened and the form is still the live DOM.
        openFormKey = null;
        try {
          await ctx.writeGoals(next);
        } catch (writeErr) {
          openFormKey = goal.id;
          throw writeErr;
        }
        showMessage(els.goalsMsg, 'Goal updated.', { kind: 'ok', autoDismissMs: 4000 });
      },
      onCancel: () => {
        openFormKey = null;
        ctx.rerender();
      },
    });
    clear(li);
    li.appendChild(form);
    void form.offsetHeight;
    form.classList.add('is-in');
    focusFirst();
  });

  li.append(main, confirm);
  return li;
}

/** Re-renders the goal list + the add-form / at-capacity / "New goal" button region.
 * Called from dashboard.js's renderDataViews, right where it already
 * computes `goalsProgress`. `goals` is the sanitized array; `progress` is
 * that array's computeGoalProgress output (passed in rather than recomputed
 * so the panel and the rest of the page can never disagree about "now"). */
export function renderGoalsList(goals, progress, els, ctx) {
  clear(els.goalsList);
  clear(els.goalFormSlot);

  const visible = goals.filter((g) => !g.archived);
  const byId = new Map((progress || []).map((p) => [p.goalId, p]));
  const atCap = visible.length >= MAX_GOALS;

  if (visible.length === 0) {
    const li = document.createElement('li');
    li.className = 'dash__labels-empty';
    li.textContent = "No goals yet -- add one to track how much of your target you've hit this day, week, or month.";
    els.goalsList.appendChild(li);
  } else {
    for (const goal of visible) {
      els.goalsList.appendChild(buildGoalRow(goal, byId.get(goal.id), els, ctx));
    }
  }

  els.goalsCapMsg.hidden = !atCap;
  // An edit form is already mounted inside its own row by buildGoalRow, so
  // the slot below is only ever the CREATE form (or the button that opens
  // it) -- and neither should appear while an edit is open, for the same
  // one-form-at-a-time reason openFormKey exists.
  if (atCap || (openFormKey !== null && openFormKey !== ADD_FORM_KEY)) return;

  if (openFormKey === ADD_FORM_KEY) {
    const { form, focusFirst } = buildGoalForm({
      submitLabel: 'Add goal',
      customLabels: ctx.getCustomLabels(),
      themeMode: ctx.getThemeMode(),
      onSubmit: async (topic, period, targetS, extra) => {
        // Same throw-keeps-the-form-open / clear-before-write ordering as the
        // edit path in buildGoalRow -- see its comment for why. `extra` is
        // handed straight to createGoal as its own GoalCreateExtras-shaped
        // trailing param -- an `undefined` field there simply means "not
        // set", the same as a create call on the app side.
        const next = createGoal(ctx.getGoals(), topic, period, targetS, undefined, extra);
        openFormKey = null;
        try {
          await ctx.writeGoals(next);
        } catch (writeErr) {
          openFormKey = ADD_FORM_KEY;
          throw writeErr;
        }
        showMessage(els.goalsMsg, 'Goal added.', { kind: 'ok', autoDismissMs: 4000 });
      },
      onCancel: () => {
        openFormKey = null;
        ctx.rerender();
      },
    });
    els.goalFormSlot.appendChild(form);
    void form.offsetHeight;
    form.classList.add('is-in');
    focusFirst();
    return;
  }

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn--sm btn--ghost';
  addBtn.textContent = 'New goal';
  addBtn.addEventListener('click', () => {
    openFormKey = ADD_FORM_KEY;
    ctx.rerender();
  });
  els.goalFormSlot.appendChild(addBtn);
}

/** One-time wiring. There is nothing to attach at page init that
 * renderGoalsList doesn't rebuild on every pass (unlike labelsPanel.js,
 * whose 12-swatch add-row and document-level outside-click listener are
 * genuinely mount-once), so this only resets the module's own open-form
 * state -- kept as an explicit export anyway so dashboard.js's init() wires
 * this panel the same way it wires the labels one, rather than this being
 * the one panel with an implicit lifecycle. */
export function mountGoalsPanel() {
  openFormKey = null;
}
