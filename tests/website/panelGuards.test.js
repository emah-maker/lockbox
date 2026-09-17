// Source-form guards for the two dashboard panels that cannot be imported
// under `node --test`. Both reach the Firebase SDK from
// `https://www.gstatic.com/...` (calendarPanel.js transitively, via
// sessionLabelPicker.js), which the default ESM loader refuses outright, and
// both also need a live DOM. So they are asserted on as TEXT, the same
// precedent tests/contracts/bleUuids.test.js and tests/website/settingsDoc.js
// follow for the same reason.
//
// What these cases protect is narrow but specific: in each module an
// invariant currently holds only because of something OUTSIDE the module --
// a CSS rule in one case, an event-ordering accident in the other. A text
// assertion is a poor substitute for exercising the code, but it is the only
// thing available here, and it is strictly better than the nothing that was
// covering these paths before.
//
// Run with `npm test` from the repo root (node --test).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');

/** Index of the first of `needles` to appear in `src`, or Infinity if none
 * do. Plain indexOf rather than a regex so nothing here depends on escaping. */
const firstIndexOf = (src, needles) =>
  Math.min(...needles.map((n) => {
    const i = src.indexOf(n);
    return i < 0 ? Infinity : i;
  }));

/** Blanks out block and line comments, preserving offsets so an index into
 * the result still lines up with the original. Needed because this repo
 * comments heavily and those comments naturally quote the very identifiers
 * these cases search for -- an ordering assertion run over raw source
 * measures prose, not code. */
const codeOnly = (src) => {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (src.startsWith('//', i)) {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else {
      out += src[i];
      i += 1;
    }
  }
  return out;
};

describe('calendarPanel draw() null guard', () => {
  const calendarPanel = read('website', 'js', 'calendarPanel.js');
  const drawBody = calendarPanel.slice(
    calendarPanel.indexOf('function draw()'),
    calendarPanel.indexOf('/** Repaints the calendar'),
  );

  it('the slice under test really is draw()', () => {
    assert.ok(drawBody.length > 0, 'draw() body not found -- the anchors below moved');
    assert.ok(drawBody.includes('buildMonthGrid(calCursor)'), 'sliced the wrong function');
  });

  // mountCalendarPanel() wires the prev/next click handlers from
  // dashboard.js's init(), which runs long before the first renderCalendar
  // populates `calEls`/`calCtx`. A click in that window reaches draw() with
  // both still null and throws on `const { theme, themeMode } = calCtx`.
  //
  // Not reachable today, and deliberately asserted anyway: the only reason
  // it is unreachable is that the buttons live inside #dashContent, which
  // styles.css's `[hidden] { display: none !important; }` keeps
  // unclickable and out of the tab order until showState('content') -- and
  // that call happens after renderAll(), in the same synchronous task. Every
  // link in that chain is in a different file from this one. The module
  // itself holds no such guarantee, so it should hold its own guard.
  it('returns early instead of dereferencing a not-yet-populated calEls/calCtx', () => {
    // Comments stripped first: the guard's own explanation quotes the
    // destructure it is guarding, which would otherwise register as the
    // "first use" and put the guard after it.
    const code = codeOnly(drawBody);
    const guardAt = code.indexOf('if (!calEls || !calCtx) return;');
    assert.ok(guardAt >= 0, 'draw() should bail out before touching calEls/calCtx');

    const firstUse = firstIndexOf(code, ['} = calCtx', 'calCtx.', 'calEls.']);
    assert.ok(firstUse < Infinity, 'draw() is expected to use calEls/calCtx at all');
    assert.ok(guardAt < firstUse, 'the guard must come before the first dereference');
  });

  // The guard must not have been "achieved" by unwiring the buttons.
  it('keeps both month-cursor buttons wired', () => {
    assert.ok(calendarPanel.includes("els.calPrev.addEventListener('click'"), 'prev button should stay wired');
    assert.ok(calendarPanel.includes("els.calNext.addEventListener('click'"), 'next button should stay wired');
  });
});

describe('sessionLabelPicker commit/blur race', () => {
  const picker = read('website', 'js', 'sessionLabelPicker.js');
  const code = codeOnly(picker);

  // commit() sets `select.disabled = true` while the <select> still holds
  // focus. Measured in Chromium (Playwright, a focused <select> disabled
  // programmatically): no blur fires synchronously, and none after a
  // setTimeout(0) macrotask -- document.activeElement is still the select --
  // but by the next animation frame `blur` and `focusout` both fire and
  // focus lands on BODY. A Firestore updateDoc spans many frames, so that
  // blur reliably arrives DURING the await.
  //
  // Unguarded, it ran renderChip(), which mount()s a fresh chip over the
  // <select>. Three consequences, all mid-write: the
  // `dash__chip-select--saving` class commit() had just set was now on a
  // detached node, so the saving affordance vanished; the new chip read
  // `session.topic`, which commit() does not update until after the await,
  // so it showed the OLD label; and on the failure path the catch rendered
  // a second chip over that one, discarding the first. The net effect on a
  // slow connection was a control that looked like the edit had simply not
  // taken.
  it('ignores the blur that commit() itself causes by disabling the control', () => {
    const at = code.indexOf("addEventListener('blur'");
    assert.ok(at >= 0, 'the blur handler should still exist');
    const end = code.indexOf("addEventListener('keydown'", at);
    assert.ok(end > at, 'could not bound the blur handler');
    const handler = code.slice(at, end);

    const guardAt = handler.indexOf('select.disabled');
    const rerenderAt = handler.indexOf('renderChip()');
    assert.ok(guardAt >= 0, 'the blur handler should tell a commit-induced blur from a real one');
    assert.ok(rerenderAt >= 0, 'a real blur should still swap back to the chip');
    assert.ok(guardAt < rerenderAt, 'the check must come before the re-render, not after it');
  });

  // The guard is only correct because `disabled` is set in exactly one
  // place. If a second site starts disabling the control, "disabled" stops
  // meaning "a commit is in flight" and this guard silently over-suppresses.
  it('still disables the control during the write, and only there', () => {
    const disables = code.split('select.disabled = true').length - 1;
    assert.equal(disables, 1, 'exactly one place should disable the select');
    const commitAt = code.indexOf('async function commit(');
    assert.ok(commitAt >= 0 && code.indexOf('select.disabled = true') > commitAt, 'that place should be commit()');
  });
});
