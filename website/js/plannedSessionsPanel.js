/* =========================================================================
   plannedSessionsPanel.js -- the "Planned" block inside the focus calendar
   card: the sessions scheduled for the selected day, and the form to add or
   edit one. Split out of calendarPanel.js the same way goalsPanel.js and
   labelsPanel.js are split out of dashboard.js -- one bounded feature's
   render logic in one file, and calendarPanel.js stays under the project's
   500-line guideline.

   The counterpart of the app's screens/calendar/PlannedSessions.tsx, but with
   one structural difference that is the whole point of the feature: a browser
   tab can't schedule a local notification for a session hours away, because
   it may not be open then. Every plan written here is delivered by the
   backend instead (functions/src/index.ts) -- to the phone app, and to this
   browser if it has been granted permission (webPush.js).

   Owns no Firestore path of its own: scheduledSessionsSync.js is the one
   module that knows the collection, over shapes scheduledSessions.js
   defines, and this file calls both. Same division goalsPanel.js has with
   goals.js.

   ctx = {
     getDb(), getUid(),      // resolved after sign-in, so read live
     getPlans(),             // every plan for this user (dashboard.js caches)
     getCustomLabels(),      // for the label <select>
     getThemeMode(),         // resolveTopic needs it for per-mode colors
     getFirebaseConfig(),    // for webPush.js's VAPID key
     onChanged(),            // reload plans from Firestore, then rerender
     onError(err),           // dashboard.js's showWriteError
   }
   ========================================================================= */
import { clear } from './dom.js';
import { allLabelChoices, resolveTopic, formatDuration } from './focusStats.js';
import { showMessage } from './dashMessage.js';
import {
  DURATION_OPTIONS_S,
  LEAD_MINUTE_OPTIONS,
  MAX_NOTE_LENGTH,
  formatClockTime,
  leadLabel,
  makeScheduledSessionId,
  sessionsOnDay,
  validatePlan,
} from './scheduledSessions.js';
import { removeScheduledSession, writeScheduledSession } from './scheduledSessionsSync.js';
import { disableWebPush, enableWebPush, webPushRegistered, webPushStatus } from './webPush.js';

let els = null;
let ctx = null;
/** The day the calendar currently has selected -- pushed in by
 * calendarPanel.js on every draw, since it owns that state privately. */
let currentDateKey = null;
/** null = the form is closed. '' = adding. An id = editing that plan. One
 * piece of state for both, so the form can never be open in two conflicting
 * modes at once (the same shape the app's PlannedSessions.tsx uses). */
let formFor = null;

const DEFAULT_TIME = '09:00';
const DEFAULT_LEAD = 10;

/* ---------- Rendering ---------- */

function planRow(plan) {
  const li = document.createElement('li');
  li.className = 'dash__plan';
  if (plan.done) li.classList.add('dash__plan--done');

  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'dash__plan-check';
  doneBtn.setAttribute('aria-pressed', String(!!plan.done));
  doneBtn.setAttribute(
    'aria-label',
    `${formatClockTime(plan.time)} session, ${plan.done ? 'done' : 'not done'}`,
  );
  doneBtn.textContent = plan.done ? '✓' : '○';
  doneBtn.addEventListener('click', () => void toggleDone(plan));

  const main = document.createElement('div');
  main.className = 'dash__plan-main';

  const top = document.createElement('div');
  top.className = 'dash__plan-top';
  const time = document.createElement('strong');
  time.textContent = formatClockTime(plan.time);
  top.appendChild(time);
  if (plan.plannedS) {
    const dur = document.createElement('span');
    dur.className = 'dash__plan-meta';
    dur.textContent = formatDuration(plan.plannedS);
    top.appendChild(dur);
  }
  const resolved = plan.topic ? resolveTopic(plan.topic, ctx.getCustomLabels(), ctx.getThemeMode()) : null;
  if (resolved) {
    const dot = document.createElement('span');
    dot.className = 'dash__cal-dot';
    dot.style.background = resolved.color;
    const name = document.createElement('span');
    name.className = 'dash__plan-meta';
    name.textContent = resolved.label;
    top.append(dot, name);
  }
  main.appendChild(top);

  if (plan.note) {
    const note = document.createElement('div');
    note.className = 'dash__plan-meta';
    note.textContent = plan.note;
    main.appendChild(note);
  }

  const lead = document.createElement('div');
  lead.className = 'dash__plan-meta';
  // Says what will actually happen. A done plan reports that instead of a
  // lead time that no longer means anything, and a plan the backend has
  // already pushed says so -- otherwise "10 min before" on a past reminder
  // reads as though it is still coming.
  lead.textContent = plan.done
    ? 'Done'
    : plan.notifiedAt
      ? 'Reminder sent'
      : leadLabel(plan.leadMinutes);
  main.appendChild(lead);

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'dash__plan-action';
  editBtn.textContent = 'Edit';
  editBtn.setAttribute('aria-label', `Edit the ${formatClockTime(plan.time)} planned session`);
  editBtn.addEventListener('click', () => {
    formFor = plan.id;
    render(currentDateKey);
  });

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'dash__plan-action dash__plan-action--danger';
  delBtn.textContent = 'Delete';
  delBtn.setAttribute('aria-label', `Delete the ${formatClockTime(plan.time)} planned session`);
  delBtn.addEventListener('click', () => void remove(plan));

  li.append(doneBtn, main, editBtn, delBtn);
  return li;
}

/** The add/edit form. Built fresh on every open rather than shown/hidden, so
 * it can never carry a previous plan's values into a new one -- the DOM
 * equivalent of the remount-key the app's own form needs for the same
 * reason. */
function buildForm(editing) {
  const form = document.createElement('form');
  form.className = 'dash__plan-form';
  form.noValidate = true;

  const field = (labelText, control) => {
    const wrap = document.createElement('label');
    wrap.className = 'dash__plan-field';
    const span = document.createElement('span');
    span.textContent = labelText;
    wrap.append(span, control);
    return wrap;
  };

  const time = document.createElement('input');
  time.type = 'time';
  time.required = true;
  // step=300 makes the native picker offer 5-minute stops, matching the
  // wheel grid every minute picker in the app snaps to.
  time.step = '300';
  time.value = editing ? editing.time : DEFAULT_TIME;

  const lead = document.createElement('select');
  for (const minutes of LEAD_MINUTE_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = String(minutes);
    opt.textContent = leadLabel(minutes);
    lead.appendChild(opt);
  }
  lead.value = String(editing ? editing.leadMinutes : DEFAULT_LEAD);

  const duration = document.createElement('select');
  const noDuration = document.createElement('option');
  noDuration.value = '';
  noDuration.textContent = 'Not set';
  duration.appendChild(noDuration);
  for (const seconds of DURATION_OPTIONS_S) {
    const opt = document.createElement('option');
    opt.value = String(seconds);
    opt.textContent = formatDuration(seconds);
    duration.appendChild(opt);
  }
  duration.value = editing?.plannedS ? String(editing.plannedS) : '';

  const label = document.createElement('select');
  const noLabel = document.createElement('option');
  noLabel.value = '';
  noLabel.textContent = 'No label';
  label.appendChild(noLabel);
  for (const choice of allLabelChoices(ctx.getCustomLabels(), ctx.getThemeMode())) {
    const opt = document.createElement('option');
    opt.value = choice.id;
    opt.textContent = choice.label;
    label.appendChild(opt);
  }
  // An edit whose plan targets a since-deleted custom label keeps that value
  // selectable, so re-saving doesn't silently retag it at whatever option
  // happens to be first -- the same orphan handling goalForm.js does.
  if (editing?.topic && !Array.from(label.options).some((o) => o.value === editing.topic)) {
    const orphan = document.createElement('option');
    orphan.value = editing.topic;
    orphan.textContent = 'Deleted label';
    label.appendChild(orphan);
  }
  label.value = editing?.topic ?? '';

  const note = document.createElement('input');
  note.type = 'text';
  note.maxLength = MAX_NOTE_LENGTH;
  note.placeholder = "What's this session for?";
  note.value = editing?.note ?? '';

  const actions = document.createElement('div');
  actions.className = 'dash__plan-form-actions';
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn btn--sm';
  save.textContent = editing ? 'Save session' : 'Add session';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn--sm btn--ghost';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    formFor = null;
    render(currentDateKey);
  });
  actions.append(save, cancel);

  form.append(
    field('Start time', time),
    field('Remind me', lead),
    field('Planned length', duration),
    field('Label', label),
    field('Note', note),
    actions,
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void save_({
      id: editing ? editing.id : makeScheduledSessionId(),
      date: currentDateKey,
      time: time.value,
      leadMinutes: Number(lead.value),
      plannedS: duration.value ? Number(duration.value) : undefined,
      topic: label.value || null,
      note: note.value.trim() || undefined,
      done: editing ? !!editing.done : false,
    }, editing?.id);
  });

  return form;
}

/** Redraws the block for `dateKey`. Called by calendarPanel.js on every day
 * change and every repaint, and by this module after its own writes. */
export function renderPlannedSessions(dateKey) {
  currentDateKey = dateKey;
  render(dateKey);
}

function render(dateKey) {
  if (!els || !ctx || !dateKey) return;
  const plans = sessionsOnDay(ctx.getPlans(), dateKey);

  clear(els.planList);
  if (plans.length === 0 && formFor === null) {
    const li = document.createElement('li');
    li.className = 'dash__cal-empty';
    li.textContent = 'Nothing planned. Schedule a session to get a reminder before it starts.';
    els.planList.appendChild(li);
  } else {
    for (const plan of plans) els.planList.appendChild(planRow(plan));
  }

  clear(els.planFormSlot);
  if (formFor !== null) {
    els.planFormSlot.appendChild(buildForm(formFor ? plans.find((p) => p.id === formFor) : null));
  }
  els.planAdd.hidden = formFor !== null;
}

/* ---------- Writes ---------- */

async function save_(plan, editingId) {
  try {
    validatePlan(plan, ctx.getPlans(), editingId);
  } catch (err) {
    // Client-side bounds mirror the Firestore rules, so this is a friendlier
    // version of a rejection that would happen server-side anyway -- never
    // the only thing standing between bad input and the database.
    showMessage(els.planMsg, err.message, { kind: 'err' });
    return;
  }
  try {
    await writeScheduledSession(ctx.getDb(), ctx.getUid(), plan);
    formFor = null;
    showMessage(els.planMsg, 'Session scheduled.', { kind: 'ok', autoDismissMs: 2500 });
    await ctx.onChanged();
  } catch (err) {
    ctx.onError(err);
  }
}

async function toggleDone(plan) {
  try {
    await writeScheduledSession(ctx.getDb(), ctx.getUid(), { ...plan, done: !plan.done });
    await ctx.onChanged();
  } catch (err) {
    ctx.onError(err);
  }
}

async function remove(plan) {
  // The copy says what actually happens: a plan carries a pending server-side
  // reminder, so "the reminder is cancelled" is the part worth stating.
  const ok = window.confirm(
    `Delete the ${formatClockTime(plan.time)} planned session? Its reminder will be cancelled. Logged sessions are not affected.`,
  );
  if (!ok) return;
  try {
    await removeScheduledSession(ctx.getDb(), ctx.getUid(), plan.id);
    if (formFor === plan.id) formFor = null;
    await ctx.onChanged();
  } catch (err) {
    ctx.onError(err);
  }
}

/* ---------- Browser-reminder opt-in ---------- */

/** What the row's single button currently does -- 'enable' or 'disable'.
 * Read by the click handler, written by paintPushStatus, so the two can never
 * disagree about which action the label is offering. */
let pushMode = 'enable';

async function paintPushStatus() {
  const status = await webPushStatus();
  const hasVapid = !!ctx.getFirebaseConfig()?.vapidKey;
  // Hidden outright rather than shown disabled when this browser (or this
  // project) can't do web push at all -- a button whose only possible
  // outcome is an apology is worse than no button.
  const possible = status !== 'unsupported' && hasVapid;
  els.webPushRow.hidden = !possible;
  if (!possible) return;

  if (status === 'granted') {
    // Permission granted is not the same as registered. Once given, browser
    // permission stays 'granted' for good, so treating it as the whole
    // answer left this row saying "reminders will also appear here" with no
    // way to make them stop -- an opt-in with no opt-out, where the only
    // escape was the browser's own site settings. What the backend actually
    // pushes to is the token document, so that is what the control operates
    // on and what its label has to reflect.
    const registered = await webPushRegistered({ db: ctx.getDb(), uid: ctx.getUid() });
    pushMode = registered ? 'disable' : 'enable';
    els.webPushBtn.hidden = false;
    els.webPushBtn.textContent = registered ? 'Turn off browser reminders' : 'Enable browser reminders';
    els.webPushStatus.textContent = registered
      ? 'Reminders will also appear in this browser.'
      : 'Reminders go to your phone. Enable them here too?';
  } else if (status === 'denied') {
    els.webPushBtn.hidden = true;
    els.webPushStatus.textContent =
      'This browser is blocking notifications. Allow them in your browser settings to get reminders here too.';
  } else {
    pushMode = 'enable';
    els.webPushBtn.hidden = false;
    els.webPushBtn.textContent = 'Enable browser reminders';
    els.webPushStatus.textContent = 'Reminders go to your phone. Enable them here too?';
  }
}

/**
 * Repaints the browser-reminder opt-in. Exported because mount() runs at the
 * top of dashboard.js's init(), BEFORE the Hosting-served Firebase config has
 * been fetched -- so the first paint always sees a null config, decides web
 * push is impossible, and hides the row permanently. dashboard.js calls this
 * again once the config is in hand. (Found by rendering the dashboard against
 * the mock-preview harness, not by reading the code.)
 *
 * And a THIRD time, from loadDashboard, once there is a signed-in uid: the
 * config-time repaint above still has no database handle, so it cannot tell
 * an already-registered browser from a fresh one and would offer to enable
 * what is already enabled.
 */
export async function refreshWebPushRow() {
  await paintPushStatus();
}

/** One-time wiring. Call from dashboard.js's init(), after `els` resolves. */
export function mountPlannedSessionsPanel(elements, context) {
  els = elements;
  ctx = context;

  els.planAdd.addEventListener('click', () => {
    formFor = ''; // '' = adding, as opposed to null (closed) or an id (editing)
    render(currentDateKey);
  });

  els.webPushBtn.addEventListener('click', async () => {
    els.webPushBtn.disabled = true;
    if (pushMode === 'disable') {
      // No confirmation step: this is reversible with the same button, and
      // the reminders themselves are still on the phone.
      await disableWebPush({ db: ctx.getDb(), uid: ctx.getUid() });
    } else {
      const result = await enableWebPush({
        config: ctx.getFirebaseConfig(),
        db: ctx.getDb(),
        uid: ctx.getUid(),
      });
      if (result === 'error') {
        showMessage(els.planMsg, 'Could not enable browser reminders. Reminders still go to your phone.', {
          kind: 'err',
        });
      }
    }
    els.webPushBtn.disabled = false;
    await paintPushStatus();
  });

  // First paint. Almost always resolves to "hidden" -- see refreshWebPushRow
  // above for why, and for who paints it properly.
  void paintPushStatus();
}
