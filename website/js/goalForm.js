/* =========================================================================
   goalForm.js -- the add/edit form for one focus goal, split out of
   goalsPanel.js so both stay under this project's 500-line file guideline.

   One builder serves BOTH create and edit: a goal's editable surface (topic,
   period, target, and the "flexible goals" extension fields below) is
   exactly its creatable surface, so a second copy would only be two places
   to keep the same behavior correct. goalsPanel.js mounts the returned form
   either in #dashGoalFormSlot (create) or in place of the row being edited.

   Owns no persistence and no validation: it hands a full values snapshot
   (topic, period, targetS, daysOfWeek, targetSessions, notify, notifyAt) to
   its `onSubmit` and renders whatever that throws -- goals.js is the only
   authority on whether those values are acceptable. The one thing encoded
   here is the inputs' own SELECTABLE range, and even that is derived from
   goals.js's constants (see PERIOD_MAX_HOURS below).

   1:1 with app/src/screens/GoalForm.tsx + GoalFormExtras.tsx, which are the
   same split of the same form on the app side -- see goalsPanel.js's header
   for the hand-port contract these two surfaces are under. The one
   intentional divergence (unchanged from before this pass) is input
   granularity: the app uses WheelPickers (5-minute-step target, 24h clock
   dial for the reminder time), this uses plain number/time inputs. Both
   still produce the exact same stored shape, so nothing about the Goal
   fields or sync semantics differs -- only the widget. A goal's own
   daysOfWeek/targetSessions/notify/notifyAt fields, their bounds, and their
   "undefined vs null vs a value" patch semantics are confirmed field-for-
   field against GoalForm.tsx/GoalFormExtras.tsx and goals.ts.
   ========================================================================= */
import { MAX_DAILY_TARGET_S, MAX_WEEKLY_TARGET_S, MAX_MONTHLY_TARGET_S, MAX_TARGET_SESSIONS } from './goals.js';
import { allLabelChoices } from './focusStats.js';
import { showMessage, describeWriteError } from './dashMessage.js';

// The form's selectable hour range, DERIVED from goals.js's own bounds
// rather than typed out as 24/168/744 -- same reasoning as GoalForm.tsx's
// PERIOD_MAX_HOURS: raising MAX_MONTHLY_TARGET_S there must not leave this
// input silently unable to express a target the model would accept.
const PERIOD_MAX_HOURS = {
  daily: Math.floor(MAX_DAILY_TARGET_S / 3600),
  weekly: Math.floor(MAX_WEEKLY_TARGET_S / 3600),
  monthly: Math.floor(MAX_MONTHLY_TARGET_S / 3600),
};

// Sentinel for the "all focus time" choice. A goal's own `topic: null` is
// what actually gets stored (goals.js) -- this exists only because a
// <select> option needs a non-empty value string to be distinguishable, and
// the empty string would collide with goals.js's own "Goal topic is
// required." rejection of a falsy topic. Same sentinel, same reason, as
// GoalForm.tsx's ALL_TOPICS_ID.
const ALL_TOPICS_VALUE = '__all__';

// Every weekday selected is data-equivalent to Goal.daysOfWeek's own
// "undefined = every day" (see that field's comment in goals.js) -- seeded
// as all-on so the row of chips reads as "every day" rather than as nothing
// chosen at all. Same constant/reasoning as GoalForm.tsx's ALL_WEEKDAYS.
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DEFAULT_NOTIFY_AT = '09:00';

/** Maps a <select> value back to what actually gets stored: the sentinel
 * becomes `null` (goals.js's "all focus time"), everything else passes
 * through as the raw topic id. Module-private -- the sentinel exists only
 * for this form's own select, so nothing outside this file (goalsPanel.js
 * included) has to know the string. */
function topicIdToStored(value) {
  return value === ALL_TOPICS_VALUE ? null : value;
}

/** Label for the extra <option> kept for a goal whose topic isn't in
 * allLabelChoices -- a since-deleted saved custom label, or a one-time
 * free-text tag typed in the app's TopicPicker. Same two-case split
 * goalsPanel.js's describeTopic makes for the row itself (and
 * GoalForm.tsx's own orphanLabel makes on the app side), kept local so this
 * module needs nothing from the panel that mounts it. */
function orphanOptionLabel(topic) {
  return topic.startsWith('custom:') ? 'Deleted label' : topic;
}

/* ---------------------------------------------------------------------------
   The add/edit form. Built in JS (not authored in dashboard.html the way
   labelsPanel.js's add-form is) because a goal's editable surface is exactly
   its creatable surface, so the same form is needed twice -- once at the
   bottom of the panel for "New goal", once swapped in place of a row being
   edited. One builder is one behavior to keep correct; two hand-written
   copies in markup would be two.

   `onSubmit` is called as (topic, period, targetS, extra), where `extra` is
   `{ daysOfWeek, targetSessions, notify, notifyAt }` -- every key always
   present, `undefined` meaning "not set" (matching GoalCreateExtras' own
   shape for a create call). goalsPanel.js's edit path maps an `undefined`
   here to GoalPatch's explicit `null` clear -- see its own onSubmit for why
   this form doesn't do that mapping itself (it doesn't know whether it's
   creating or editing).
   --------------------------------------------------------------------------- */
export function buildGoalForm({ initial, submitLabel, customLabels, themeMode, onSubmit, onCancel }) {
  const form = document.createElement('form');
  form.className = 'dash__goal-form dash__pick-fade';

  const topicField = document.createElement('label');
  topicField.className = 'dash__goal-field';
  topicField.append(fieldCaption('Count sessions labeled'));
  const topicSelect = document.createElement('select');
  topicSelect.className = 'dash__chip-select';
  // "All focus time" first, then the same built-ins-then-customs order
  // allLabelChoices returns -- the identical label-choice model the
  // per-session relabel dropdown uses (sessionLabelPicker.js), rather than a
  // second, goals-only picker.
  topicSelect.appendChild(option(ALL_TOPICS_VALUE, 'All focus time'));
  for (const choice of allLabelChoices(customLabels, themeMode)) {
    topicSelect.appendChild(option(choice.id, choice.label));
  }
  const initialTopic = initial && initial.topic !== null && initial.topic !== undefined ? initial.topic : null;
  // An edit whose goal targets a since-deleted custom label (or a one-time
  // free-text tag from the app): keep that exact id selectable, so re-saving
  // the goal can't silently retarget it at whichever option happens to be
  // first. Same guard as GoalForm.tsx's `orphanId`.
  if (initialTopic !== null && !topicSelect.querySelector(`option[value="${CSS.escape(initialTopic)}"]`)) {
    topicSelect.appendChild(option(initialTopic, orphanOptionLabel(initialTopic)));
  }
  topicSelect.value = initialTopic === null ? ALL_TOPICS_VALUE : initialTopic;
  topicField.appendChild(topicSelect);

  const periodField = document.createElement('label');
  periodField.className = 'dash__goal-field';
  periodField.append(fieldCaption('Every'));
  const periodSelect = document.createElement('select');
  periodSelect.className = 'dash__chip-select';
  periodSelect.appendChild(option('daily', 'Day'));
  periodSelect.appendChild(option('weekly', 'Week'));
  periodSelect.appendChild(option('monthly', 'Month'));
  periodSelect.value = initial ? initial.period : 'daily';
  periodField.appendChild(periodSelect);

  const targetField = document.createElement('div');
  targetField.className = 'dash__goal-field dash__goal-target';
  targetField.append(fieldCaption('Target'));
  const targetRow = document.createElement('div');
  targetRow.className = 'dash__goal-target-row';
  const initialS = initial ? initial.targetS : 1500; // 25m, same default as GoalsSection.tsx
  const hours = numberInput('Target hours', 0, PERIOD_MAX_HOURS[periodSelect.value], Math.floor(initialS / 3600));
  const minutes = numberInput('Target minutes', 0, 59, Math.floor((initialS % 3600) / 60));
  targetRow.append(hours, unit('h'), minutes, unit('m'));
  targetField.appendChild(targetRow);

  // Only the input's own selectable range -- goals.js is still the single
  // authority on whether the resulting targetS is acceptable, which is why a
  // 24h05m daily target is left to surface its own thrown message instead of
  // being silently rounded down here.
  periodSelect.addEventListener('change', () => {
    hours.max = String(PERIOD_MAX_HOURS[periodSelect.value]);
    if (Number(hours.value) > PERIOD_MAX_HOURS[periodSelect.value]) {
      hours.value = String(PERIOD_MAX_HOURS[periodSelect.value]);
    }
    syncWeekdaysVisibility();
  });

  // ---------- "On these days" weekday chips (daily goals only) ----------
  // Only meaningful for a daily goal -- a weekly/monthly goal's window
  // already spans its whole period, so "which days count" has no meaning for
  // either (goals.js's isGoalDueOn treats it the same way). Hidden rather
  // than disabled when not applicable, matching GoalForm.tsx's own
  // `period === 'daily' ? ... : null` conditional render.
  const weekdaysField = document.createElement('div');
  weekdaysField.className = 'dash__goal-field dash__goal-field--full';
  weekdaysField.append(fieldCaption('On these days'));
  const weekdaysRow = document.createElement('div');
  weekdaysRow.className = 'dash__goal-weekdays';
  // Seeded all-selected when the goal has no restriction yet (undefined/[]
  // both mean "every day", see ALL_WEEKDAYS' own comment) -- the reading
  // that actually looks like "every day" rather than looking like nothing at
  // all is chosen.
  const initialDays = initial && initial.daysOfWeek && initial.daysOfWeek.length > 0 ? initial.daysOfWeek : ALL_WEEKDAYS;
  const selectedDays = new Set(initialDays);
  const weekdayBtns = WEEKDAY_ABBR.map((label, day) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dash__goal-weekday';
    btn.textContent = label;
    btn.setAttribute('aria-pressed', String(selectedDays.has(day)));
    btn.setAttribute('aria-label', WEEKDAY_FULL[day]);
    btn.addEventListener('click', () => {
      if (selectedDays.has(day)) selectedDays.delete(day);
      else selectedDays.add(day);
      btn.setAttribute('aria-pressed', String(selectedDays.has(day)));
    });
    return btn;
  });
  weekdaysRow.append(...weekdayBtns);
  weekdaysField.appendChild(weekdaysRow);

  function syncWeekdaysVisibility() {
    weekdaysField.hidden = periodSelect.value !== 'daily';
  }
  syncWeekdaysVisibility();

  // ---------- "Also track session count" toggle + stepper ----------
  const sessionsField = document.createElement('div');
  sessionsField.className = 'dash__goal-field dash__goal-field--full';
  const sessionsToggleRow = document.createElement('label');
  sessionsToggleRow.className = 'dash__goal-toggle-row';
  const sessionsToggle = document.createElement('input');
  sessionsToggle.type = 'checkbox';
  sessionsToggle.checked = initial ? initial.targetSessions !== undefined : false;
  const sessionsToggleText = document.createElement('span');
  sessionsToggleText.textContent = 'Also track session count';
  sessionsToggleRow.append(sessionsToggle, sessionsToggleText);
  const sessionsInput = numberInput(
    'Session count target',
    1,
    MAX_TARGET_SESSIONS,
    initial && initial.targetSessions !== undefined ? initial.targetSessions : 1,
  );
  sessionsInput.className = 'dash__goal-num';
  const sessionsRow = document.createElement('div');
  sessionsRow.className = 'dash__goal-sessions-row';
  sessionsRow.append(sessionsInput, unit('sessions'));
  sessionsRow.hidden = !sessionsToggle.checked;
  sessionsToggle.addEventListener('change', () => {
    sessionsRow.hidden = !sessionsToggle.checked;
  });
  sessionsField.append(sessionsToggleRow, sessionsRow);

  // ---------- "Remind me" toggle + time ----------
  const notifyField = document.createElement('div');
  notifyField.className = 'dash__goal-field dash__goal-field--full';
  const notifyToggleRow = document.createElement('label');
  notifyToggleRow.className = 'dash__goal-toggle-row';
  const notifyToggle = document.createElement('input');
  notifyToggle.type = 'checkbox';
  notifyToggle.checked = initial ? initial.notify === true : false;
  const notifyToggleText = document.createElement('span');
  notifyToggleText.textContent = 'Remind me';
  notifyToggleRow.append(notifyToggle, notifyToggleText);
  const notifyTime = document.createElement('input');
  notifyTime.type = 'time';
  notifyTime.className = 'dash__goal-time';
  notifyTime.value = (initial && initial.notifyAt) || DEFAULT_NOTIFY_AT;
  notifyTime.setAttribute('aria-label', 'Reminder time');
  notifyTime.hidden = !notifyToggle.checked;
  notifyToggle.addEventListener('change', () => {
    notifyTime.hidden = !notifyToggle.checked;
    // Turning the toggle on for the first time (no notifyAt yet) seeds
    // DEFAULT_NOTIFY_AT rather than leaving the input on an empty display --
    // same reasoning as NotifyControl's own setToggle in GoalFormExtras.tsx.
    if (notifyToggle.checked && !notifyTime.value) notifyTime.value = DEFAULT_NOTIFY_AT;
  });
  notifyField.append(notifyToggleRow, notifyTime);

  const actions = document.createElement('div');
  actions.className = 'dash__goal-form-actions';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--sm btn--primary';
  submit.textContent = submitLabel;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn--sm btn--ghost';
  cancel.textContent = 'Cancel';
  actions.append(submit, cancel);

  // showMessage() rewrites className wholesale (see dashMessage.js), so this
  // starts with exactly the classes it will end up with -- CSS targets it as
  // `.dash__goal-form .form-msg` rather than via a class showMessage would
  // strip on the first render.
  const err = document.createElement('p');
  err.className = 'form-msg dash__msg';
  err.setAttribute('role', 'status');
  err.hidden = true;

  // A 0h00m target is an inputs-not-valid-yet resting state, not a rejection
  // worth a message -- same call GoalsSection.tsx's `disabled={targetS <= 0}`
  // makes. Every other out-of-range case is deliberately left to goals.js's
  // own thrown message.
  const syncSubmitState = () => {
    submit.disabled = Number(hours.value || 0) * 3600 + Number(minutes.value || 0) * 60 <= 0;
  };
  hours.addEventListener('input', syncSubmitState);
  minutes.addEventListener('input', syncSubmitState);
  syncSubmitState();

  cancel.addEventListener('click', onCancel);
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    const topic = topicIdToStored(topicSelect.value);
    const period = periodSelect.value;
    const targetS = Number(hours.value || 0) * 3600 + Number(minutes.value || 0) * 60;
    // Every weekday selected (or none) is "no restriction at all" -- collapsed
    // to `undefined` here rather than left as a 7-long array, same as
    // GoalForm.tsx's handleSubmit collapsing ALL_WEEKDAYS/[] both to
    // `undefined`. Only meaningful for a daily goal.
    const daysArr = Array.from(selectedDays);
    const daysOfWeek = period === 'daily' && daysArr.length > 0 && daysArr.length < 7 ? daysArr : undefined;
    const targetSessions = sessionsToggle.checked ? Number(sessionsInput.value || 1) : undefined;
    const notify = notifyToggle.checked;
    const notifyAt = notifyToggle.checked ? notifyTime.value || DEFAULT_NOTIFY_AT : undefined;
    try {
      // goals.js throws a caller-renderable Error for every rejection
      // (bounds, cap, bad period) -- shown verbatim, never re-derived here.
      await onSubmit(topic, period, targetS, { daysOfWeek, targetSessions, notify, notifyAt });
    } catch (thrown) {
      // Two shapes land here and both are already renderable: goals.js's own
      // validation Errors (plain `.message`, e.g. "Goal target must be
      // between 60 and 86400 seconds for a daily goal.") and a Firestore
      // rejection re-thrown by dashboard.js's writeGoals (carries `.code`).
      // describeWriteError picks the right one -- nothing is re-derived here.
      showMessage(err, describeWriteError(thrown), { kind: 'err' });
      submit.disabled = false;
    }
  });

  form.append(topicField, periodField, targetField, weekdaysField, sessionsField, notifyField, err, actions);
  return { form, focusFirst: () => topicSelect.focus() };
}

function fieldCaption(text) {
  const span = document.createElement('span');
  span.className = 'dash__goal-field-label';
  span.textContent = text;
  return span;
}

function option(value, label) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  return opt;
}

function unit(text) {
  const span = document.createElement('span');
  span.className = 'dash__goal-unit';
  span.textContent = text;
  return span;
}

function numberInput(ariaLabel, min, max, value) {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'dash__goal-num';
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.value = String(value);
  input.setAttribute('aria-label', ariaLabel);
  return input;
}
