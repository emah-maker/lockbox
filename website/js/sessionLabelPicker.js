/* =========================================================================
   sessionLabelPicker.js -- owns the per-session relabel chip<->picker
   control end-to-end: rendering (three chip states: resolved / one-time
   free-text tag / untagged), the swap to a <select>, and the Firestore
   write that commits a new topic. Split out of dashboard.js (which used to
   own this as a single ~70-line function) so that one bounded feature's
   render + write logic live together in one file, mirroring how
   app/src/screens/CustomLabelsSection.tsx owns its section's render + store
   actions end-to-end rather than splitting UI from persistence across
   files.

   Firestore write shape is unchanged from the pre-split implementation:
   a scoped `updateDoc` of just {topic, topicUpdatedAt} (or `topic:
   deleteField()` to untag) -- app/src/sync/sessionMerge.ts's last-write-wins
   merge (keyed on topicUpdatedAt) depends on this exact shape, so it is not
   touched here.
   ========================================================================= */
import {
  updateDoc,
  doc,
  deleteField,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { resolveTopic, allLabelChoices, TOPIC_KEYS } from './focusStats.js';
import { clear } from './dom.js';


/** True when `topic` is a raw one-time free-text tag -- typed via the app's
 * TopicPicker "Type a label for this session..." field -- rather than a
 * built-in key, a live custom-label id, or a deleted custom-label id (which
 * stays "Untagged" here, matching resolveTopic's own null-on-not-found
 * behavior). focusStats.js's resolveTopic has no such fallback (it is
 * out of scope to change), so this reclassifies the same cases locally
 * against its exported TOPIC_KEYS instead. */
export function isOneTimeTag(topic, customLabels) {
  if (!topic) return false;
  if (topic.startsWith('custom:')) return false;
  return !TOPIC_KEYS.includes(topic);
}

/** Builds the swap container for one session's label. `ctx` is rebuilt
 * fresh by the caller (dashboard.js's renderCalDayList/renderSessionsTable)
 * on every render pass, so its `customLabels`/`themeMode` are always
 * current -- no live-binding trick needed here, unlike labelsPanel.js's
 * longer-lived mount-once ctx.
 *   ctx = {
 *     db, uid,
 *     customLabels, themeMode,
 *     onCommitted(),         // re-renders the data views after a successful write
 *     onError(err),          // surfaces the write-error banner (dashboard.js's showWriteError)
 *   }
 * Note: `onError` is an addition beyond the spec's literal ctx sketch --
 * required so this module can surface the top-of-page error banner without
 * reaching back into dashboard.js's private `els`/showWriteError. Flagged
 * in the implementer's handoff.
 */
export function createLabelPicker(session, ctx) {
  const container = document.createElement('span');
  container.className = 'dash__label-picker';

  // Shared swap-in technique (mirrors dashboard.js's showState()): remove
  // any prior child, append the new one, then flush layout before adding
  // .is-in so the .dash__pick-fade transition actually fires instead of
  // snapping straight to the end state.
  function mount(el) {
    clear(container);
    container.appendChild(el);
    el.classList.add('dash__pick-fade');
    void el.offsetHeight;
    el.classList.add('is-in');
  }

  function renderChip() {
    const resolved = resolveTopic(session.topic, ctx.customLabels, ctx.themeMode);
    const oneTime = !resolved && isOneTimeTag(session.topic, ctx.customLabels);

    const btn = document.createElement('button');
    btn.type = 'button';
    // Always this class pair, in every state -- .dash__chip owns the pill
    // shape/padding, .dash__chip-btn owns the interactive caret/affordance,
    // so even "Untagged" reads as a clickable control.
    btn.className = 'dash__chip dash__chip-btn';

    if (resolved) {
      btn.style.background = resolved.color;
      btn.style.color = resolved.textColor;
      btn.style.border = 'none';
      btn.textContent = resolved.label;
      btn.title = resolved.label;
      btn.setAttribute('aria-label', `Change label, currently ${resolved.label}`);
    } else if (oneTime) {
      // A raw string typed once in the app, never added to the catalog --
      // shown as-typed (not "Untagged") so the two are distinguishable.
      btn.style.background = 'transparent';
      btn.style.color = 'var(--text)';
      btn.style.border = '1px dashed var(--text-2)';
      btn.textContent = session.topic;
      btn.title = `One-time tag (typed in the app): "${session.topic}"`;
      btn.setAttribute('aria-label', `Change label, currently a one-time tag: ${session.topic}`);
    } else {
      btn.style.background = 'transparent';
      btn.style.color = 'var(--text-2)';
      btn.style.border = '1px dashed var(--border-soft)';
      btn.textContent = 'Untagged';
      btn.title = 'Untagged';
      btn.setAttribute('aria-label', 'Change label, currently untagged');
    }

    btn.addEventListener('click', renderSelect);
    mount(btn);
    return btn;
  }

  function renderSelect() {
    const resolved = resolveTopic(session.topic, ctx.customLabels, ctx.themeMode);
    const oneTime = !resolved && isOneTimeTag(session.topic, ctx.customLabels);

    const select = document.createElement('select');
    select.className = 'dash__chip-select';
    select.setAttribute('aria-label', "Change this session's label");

    if (oneTime) {
      // Shown-but-not-offered: a disabled option can still be the
      // pre-selected one (disabled only blocks *choosing* it from the open
      // dropdown), so the raw typed string stays visible without risking
      // being silently re-committed as a catalog id if left untouched.
      const cur = document.createElement('option');
      cur.value = session.topic;
      cur.textContent = `${session.topic} (typed once, not saved)`;
      cur.disabled = true;
      select.appendChild(cur);
    }

    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = 'Untagged';
    select.appendChild(noneOpt);
    for (const choice of allLabelChoices(ctx.customLabels, ctx.themeMode)) {
      const opt = document.createElement('option');
      opt.value = choice.id;
      opt.textContent = choice.label;
      select.appendChild(opt);
    }
    select.value = session.topic || '';

    select.addEventListener('change', () => commit(select.value || undefined, select));
    select.addEventListener('blur', () => renderChip());
    select.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        const btn = renderChip();
        btn.focus();
      }
    });

    mount(select);
    select.focus();
  }

  async function commit(topic, select) {
    const topicUpdatedAt = Date.now();
    select.disabled = true;
    select.classList.add('dash__chip-select--saving');
    try {
      await updateDoc(doc(ctx.db, 'users', ctx.uid, 'sessions', session.id), {
        topic: topic || deleteField(),
        topicUpdatedAt,
      });
      session.topic = topic;
      session.topicUpdatedAt = topicUpdatedAt;
      // ctx.onCommitted() (renderDataViews) tears down and rebuilds the
      // entire sessions table + calendar day list synchronously, so the
      // <select>/container above is discarded. Look the fresh chip up by
      // the row's stable data-session-id hook (set by dashboard.js's
      // renderSessionsTable/renderCalDayList) rather than holding a stale
      // reference, so focus + the success flash land on the real,
      // currently-attached node instead of silently doing nothing.
      ctx.onCommitted();
      const fresh = document.querySelector(`[data-session-id="${session.id}"] .dash__chip-btn`);
      if (fresh) {
        fresh.classList.add('dash__save-flash');
        fresh.focus();
      }
    } catch (err) {
      if (ctx.onError) ctx.onError(err);
      // No rerender happened on this path -- the container is still
      // mounted where it was, so the freshly-rendered chip is a real,
      // live node; no DOM re-query needed.
      const btn = renderChip();
      btn.classList.add('dash__save-flash', 'dash__save-flash--err');
      btn.focus();
    }
  }

  renderChip();
  return container;
}
