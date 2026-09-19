// settingsDoc.test.js -- users/{uid}/settings/app is written by THREE
// independent writers that never import from each other: the app
// (app/src/sync/firestoreSync.ts's localSettingsPayload), the dashboard's
// label catalog (website/js/labelsPanel.js's writeCustomLabels), and the
// dashboard's appearance controls (website/js/accountPanel.js's
// writeAppearance). It is a WHOLE-DOCUMENT setDoc on every one of those
// paths -- settings/app has no scoped `update` rule -- so a writer that
// omits a field does not leave it alone, it DELETES it.
//
// Nothing caught that, because the one server-side check is
// app/firestore.rules' `hasOnly`, which bounds the keys a payload MAY carry
// and says nothing about the ones it MUST. A short document is perfectly
// legal, lands with a newer `updatedAt`, and app/src/sync/settingsSyncPlan.ts
// then reads that newer clock, answers 'apply', and copies the loss down to
// the phone. Measured: excluding the built-in `exercise` topic in the app and
// then merely switching the dashboard to Light theme put exercise time back
// into the phone's totals and goal progress.
//
// Both website payloads are read as TEXT rather than imported, for the same
// reason tests/contracts/bleUuids.test.js reads its two sides as text: these
// modules import the Firebase SDK from `https://www.gstatic.com/...`, which
// the default ESM loader refuses outright, so they cannot be imported under
// `node --test` at all. The app side is read as text for the same reason
// bleUuids.test.js does -- importing it pulls in React Native.
//
// Run with `npm test` from the repo root (node --test).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..');
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), 'utf8');

const labelsPanel = read('website', 'js', 'labelsPanel.js');
const accountPanel = read('website', 'js', 'accountPanel.js');
const dashboard = read('website', 'js', 'dashboard.js');
const appSync = read('app', 'src', 'sync', 'firestoreSync.ts');
const rules = read('app', 'firestore.rules');

/** The keys of the object literal starting at `source[openBrace]`, matched
 * by counting braces so a nested object (there are none today, but a future
 * field could add one) can't end the scan early. Accepts both `key: value`
 * and ES shorthand `key,` -- accountPanel.js's payload uses the shorthand
 * for themeMode/accent. */
function objectLiteralBody(source, openBrace) {
  let depth = 0;
  let i = openBrace;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(openBrace + 1, i);
}

function objectLiteralKeys(source, openBrace) {
  const body = objectLiteralBody(source, openBrace);
  // Top level of this literal only: strip anything nested one level deeper.
  const flat = body.replace(/\{[\s\S]*?\}/g, '');
  return [...flat.matchAll(/^\s*(\w+)\s*[,:]/gm)].map((m) => m[1]).sort();
}

/** Every `setDoc(doc(..., 'settings', 'app'), { ... })` payload's key set in
 * one website module -- one entry per call site, so a THIRD writer added to
 * either file later is checked by this suite automatically instead of
 * silently escaping it. */
function settingsAppPayloadKeys(source) {
  const out = [];
  const marker = /'settings',\s*'app'\)\s*,\s*\{/g;
  let m;
  while ((m = marker.exec(source)) !== null) {
    out.push(objectLiteralKeys(source, m.index + m[0].length - 1));
  }
  return out;
}

/** The app's own payload -- the reference implementation both website
 * writers are hand-ported from. */
function appPayloadKeys() {
  const m = /function localSettingsPayload\([\s\S]*?return\s*\{/.exec(appSync);
  assert.ok(m, 'localSettingsPayload not found in app/src/sync/firestoreSync.ts');
  return objectLiteralKeys(appSync, m.index + m[0].length - 1);
}

/** firestore.rules' `hasOnly([...])` allowlist for this document. */
function rulesAllowedKeys() {
  const block = /match \/settings\/app[\s\S]*?keys\(\)\.hasOnly\(\s*\[([^\]]*)\]/.exec(rules);
  assert.ok(block, "settings/app's hasOnly allowlist not found in app/firestore.rules");
  return [...block[1].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort();
}

const APP_KEYS = appPayloadKeys();

describe('users/{uid}/settings/app -- every writer sends the whole document', () => {
  // Guards the reference itself: if the app ever stops writing a field this
  // suite pins the website to, that should read as a deliberate contract
  // change here rather than as two mysterious website failures.
  it('the app writes exactly the fields firestore.rules allows', () => {
    assert.deepEqual(APP_KEYS, rulesAllowedKeys());
    assert.ok(APP_KEYS.includes('excludedTopicKeys'), 'excludedTopicKeys is the field this suite exists for');
  });

  // The rename path. labelsPanel.js resends the whole document on every
  // catalog edit, so this fires on a rename, a recolor, an add and a delete.
  it("labelsPanel.js's writeCustomLabels resends every field the app writes", () => {
    const payloads = settingsAppPayloadKeys(labelsPanel);
    assert.equal(payloads.length, 1, 'expected exactly one settings/app writer in labelsPanel.js');
    assert.deepEqual(payloads[0], APP_KEYS);
  });

  // The theme/accent path -- one click on a swatch or a Light/Dark button.
  it("accountPanel.js's writeAppearance resends every field the app writes", () => {
    const payloads = settingsAppPayloadKeys(accountPanel);
    assert.equal(payloads.length, 1, 'expected exactly one settings/app writer in accountPanel.js');
    assert.deepEqual(payloads[0], APP_KEYS);
  });

  // Both writers read the fields they don't own out of dashboard.js's
  // `currentSettings`, so a field missing THERE is missing from both
  // payloads no matter what the two lines above say. customLabels and
  // updatedAt are the two the writers supply themselves (the live catalog,
  // and a clock stamped at write time), so currentSettings is the app's key
  // set minus those.
  // The key-set assertions above prove every field is PRESENT in the payload.
  // They say nothing about where each value came from, which is the other half
  // of the same bug: dashboard.js's `calCustomLabels` is set once by
  // loadDashboard and never refreshed (there is no onSnapshot anywhere in
  // website/js/), so composing an edit against it and writing the result
  // wholesale deletes every label this tab has not seen -- then stamps a newer
  // updatedAt, and settingsSyncPlan.ts copies the deletion down to the phone.
  // The catalog is the one field with no durable copy in the browser to heal
  // from, so the merge has to happen against the transaction's own read.
  it("labelsPanel.js composes the catalog from the transaction's fresh read", () => {
    // `await` anchors this to the call sites; the declaration a few lines
    // above them takes `mutate` as a bare parameter name and would otherwise
    // read as a call passing something that is not a function literal.
    const calls = [...labelsPanel.matchAll(/await writeCustomLabels\(/g)];
    assert.ok(calls.length >= 4, 'expected the add, rename, recolor and delete call sites');
    for (const call of calls) {
      const after = labelsPanel.slice(call.index + call[0].length).trimStart();
      // A mutator, never a finished array: an array argument can only have
      // been built from the stale snapshot before the transaction opened.
      assert.ok(
        after.startsWith('(') || after.startsWith('async'),
        `writeCustomLabels must be passed a mutator function, got: ${after.slice(0, 60)}`,
      );
    }
    assert.match(
      labelsPanel,
      /mutate\(\s*remote\.customLabels/,
      'writeCustomLabels must apply its mutator to the remote catalog read inside the transaction',
    );
  });

  it("dashboard.js's currentSettings carries every resent field", () => {
    const expected = APP_KEYS.filter((k) => k !== 'customLabels' && k !== 'updatedAt');
    const literals = [...dashboard.matchAll(/currentSettings = \{/g)]
      .map((m) => m.index + m[0].length - 1)
      // The `{ ...currentSettings, ... }` partial update in
      // accountCtx.onThemeWritten inherits the rest by spread -- it is not a
      // full rebuild and has nothing to check. Recognised by the spread
      // itself, not by counting its keys: the key count only told the two
      // apart while the partial happened to fit on one line (this file's
      // key regex is line-anchored, so a one-line literal yields none), and
      // reformatting it across several lines turned this assertion on
      // against a literal it was never meant to police.
      .filter((at) => !/\.\.\.\s*currentSettings\b/.test(objectLiteralBody(dashboard, at)))
      .map((at) => objectLiteralKeys(dashboard, at));
    assert.ok(literals.length >= 2, 'expected the initializer and the post-load assignment');
    for (const keys of literals) assert.deepEqual(keys, expected);
  });
});
