/* =========================================================================
   goalForm.js -- the add/edit form for one focus goal, split out of
   goalsPanel.js so both stay under this project's 500-line file guideline.

   One builder serves BOTH create and edit: a goal's editable surface (topic,
   period, target) is exactly its creatable surface, so a second copy would
   only be two places to keep the same behavior correct. goalsPanel.js mounts
   the returned form either in #dashGoalFormSlot (create) or in place of the
   row being edited.

   Owns no persistence and no validation: it hands (topic, period, targetS)
   to its `onSubmit` and renders whatever that throws -- goals.js is the only
   authority on whether those values are acceptable. The one thing encoded
   here is the inputs' own SELECTABLE range, and even that is derived from
   goals.js's constants (see PERIOD_MAX_HOURS below).

   1:1 with app/src/screens/GoalForm.tsx, which is the same split of the
   same form on the app side -- see goalsPanel.js's header for the hand-port
   contract these two surfaces are under.
   ========================================================================= */
import { MAX_DAILY_TARGET_S, MAX_WEEKLY_TARGET_S } from './goals.js';
import { allLabelChoices } from './focusStats.js';
import { showMessage, describeWriteError } from './dashMessage.js';

// The form's selectable hour range, DERIVED from goals.js's own bounds
// rather than typed out as 24/168 -- same reasoning as GoalForm.tsx's
// PERIOD_MAX_HOURS: raising MAX_WEEKLY_TARGET_S there must not leave this
// input silently unable to express a target the model would accept.
const PERIOD_MAX_HOURS = {
  daily: Math.floor(MAX_DAILY_TARGET_S / 3600),
  weekly: Math.floor(MAX_WEEKLY_TARGET_S / 3600),
};

// Sentinel for the "all focus time" choice. A goal's own `topic: null` is
// what actually gets stored (goals.js) -- this exists only because a
// <select> option needs a non-empty value string to be distinguishable, and
// the empty string would collide with goals.js's own "Goal topic is
// required." rejection of a falsy topic. Same sentinel, same reason, as
// GoalForm.tsx's ALL_TOPICS_ID.
const ALL_TOPICS_VALUE = '__all__';

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
  });

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
    const targetS = Number(hours.value || 0) * 3600 + Number(minutes.value || 0) * 60;
    try {
      // goals.js throws a caller-renderable Error for every rejection
      // (bounds, cap, bad period) -- shown verbatim, never re-derived here.
      await onSubmit(topic, periodSelect.value, targetS);
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

  form.append(topicField, periodField, targetField, err, actions);
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
