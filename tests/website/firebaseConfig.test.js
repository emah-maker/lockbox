// Unit tests for website/js/firebaseConfig.js -- the bootstrap both
// dashboard.js and login.js await before anything else can render.
//
// Unlike this directory's other subjects, this module CAN be imported under
// `node --test`: it deliberately has no imports at all (it is what runs
// before any Firebase SDK exists), so a plain `fetch` stub is enough to
// drive it.
//
// Each case imports the module through a fresh URL query so it gets its own
// copy of the module-scoped `configPromise` cache -- otherwise one test's
// resolved config would be handed to the next one.
//
// Run with `npm test` from the repo root (node --test).
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.join(__dirname, '..', '..', 'website', 'js', 'firebaseConfig.js');

let freshCount = 0;
const freshModule = () => import(`${pathToFileURL(modulePath).href}?case=${++freshCount}`);

const VALID_CONFIG = { apiKey: 'AIza-test', projectId: 'phonebox-test' };

/** A `fetch` that never answers -- the exact failure this guards: a request
 * that is accepted and then simply never completes (a hung proxy, a captive
 * portal swallowing the connection). It rejects ONLY if the caller hands it
 * an AbortSignal and that signal fires, so a caller with no timeout wired up
 * hangs here forever, just as the real one did. */
function stallingFetch() {
  const fn = (url, opts = {}) => {
    fn.calls.push({ url, opts });
    return new Promise((_resolve, reject) => {
      const { signal } = opts;
      if (!signal) return; // no way out -- the bug
      const fail = () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
      if (signal.aborted) fail();
      else signal.addEventListener('abort', fail, { once: true });
    });
  };
  fn.calls = [];
  return fn;
}

const PENDING = Symbol('still pending');

/** Resolves to the promise's settled value/error, or PENDING if it has not
 * settled once the microtask queue is drained. Lets a test assert "this
 * never answers" without actually hanging the suite. */
async function settledOr(promise, hops = 100) {
  let out = PENDING;
  promise.then((v) => { out = { value: v }; }, (e) => { out = { error: e }; });
  for (let i = 0; i < hops; i += 1) await Promise.resolve();
  return out;
}

describe('loadFirebaseConfig timeout', () => {
  it('gives up on a stalled config fetch instead of awaiting it forever', async (t) => {
    // The bug: /__/firebase/init.json had no timeout and no AbortController,
    // so init() awaited a hung request indefinitely. Every dashboard.html
    // state starts `hidden`, so the page never even reached
    // showState('loading') -- the main region rendered nothing at all, no
    // spinner and no error, permanently. The Firestore reads downstream
    // already got a 15s guard for this same failure mode
    // (dashboardData.js's LOAD_TIMEOUT_MS).
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fetchStub = stallingFetch();
    t.mock.method(globalThis, 'fetch', fetchStub);

    const { loadFirebaseConfig } = await freshModule();
    const inFlight = loadFirebaseConfig();
    inFlight.catch(() => {}); // asserted below; keep the rejection handled
    assert.equal(await settledOr(inFlight), PENDING, 'should still be waiting before the deadline');

    t.mock.timers.tick(60_000);
    const settled = await settledOr(inFlight);
    assert.notEqual(settled, PENDING, 'a stalled config fetch must not hang forever');
    assert.ok(settled.error, 'it should reject rather than resolve to a bogus config');
    assert.equal(settled.error.code, 'timeout', "tagged like dashboardData.js's own timeout");
  });

  it('actually cancels the request rather than just ignoring it', async (t) => {
    // An AbortController, not a bare Promise.race: racing would leave the
    // real request in flight holding a connection open, with its response
    // parsed into a promise nobody will ever read.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fetchStub = stallingFetch();
    t.mock.method(globalThis, 'fetch', fetchStub);

    const { loadFirebaseConfig } = await freshModule();
    const inFlight = loadFirebaseConfig();
    inFlight.catch(() => {});
    assert.equal(fetchStub.calls.length, 1);
    const { signal } = fetchStub.calls[0].opts;
    assert.ok(signal, 'fetch should be given an AbortSignal');
    assert.equal(signal.aborted, false);

    t.mock.timers.tick(60_000);
    assert.equal(signal.aborted, true, 'the deadline should abort the request');
    await settledOr(inFlight);
  });

  it('resolves to null through loadFirebaseConfigOrNull, so the page can show its "not connected" state', async (t) => {
    // This is what makes the fix user-visible: both pages already answer a
    // null config with showState('notConfigured'), so the timeout needs no
    // new branch in dashboard.js or login.js -- it only has to reject.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(globalThis, 'fetch', stallingFetch());

    const { loadFirebaseConfigOrNull } = await freshModule();
    const warn = t.mock.method(console, 'warn', () => {});
    const inFlight = loadFirebaseConfigOrNull();
    t.mock.timers.tick(60_000);

    const settled = await settledOr(inFlight);
    assert.notEqual(settled, PENDING, 'must settle');
    assert.equal(settled.value, null, 'a timeout should read as "no config available"');
    assert.equal(warn.mock.callCount(), 1, 'and should say so in the console');
  });

  it('does not cache the timeout -- a retry issues a fresh request', async (t) => {
    // Preserves the module's existing "never cache a rejection" invariant:
    // a transient stall must not block every retry for the page session.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fetchStub = stallingFetch();
    t.mock.method(globalThis, 'fetch', fetchStub);

    const { loadFirebaseConfig } = await freshModule();
    const first = loadFirebaseConfig();
    first.catch(() => {});
    t.mock.timers.tick(60_000);
    await settledOr(first);

    const second = loadFirebaseConfig();
    second.catch(() => {});
    assert.equal(fetchStub.calls.length, 2, 'the second call should re-fetch, not reuse the failed promise');
  });
});

describe('loadFirebaseConfig success path is unchanged', () => {
  it('still returns the config, and leaves no timer running behind it', async (t) => {
    // The guard must not change the normal case, and must clear its own
    // timer -- a 60s tick after a successful load should neither reject the
    // settled promise nor abort anything.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fetchStub = mock.fn(async () => ({ ok: true, status: 200, json: async () => VALID_CONFIG }));
    t.mock.method(globalThis, 'fetch', fetchStub);

    const { loadFirebaseConfig } = await freshModule();
    const settled = await settledOr(loadFirebaseConfig());
    assert.deepEqual(settled.value, VALID_CONFIG);

    t.mock.timers.tick(60_000);
    const again = await settledOr(loadFirebaseConfig());
    assert.deepEqual(again.value, VALID_CONFIG, 'the cached config should survive the deadline passing');
    assert.equal(fetchStub.mock.callCount(), 1, 'and should still be cached, not re-fetched');
  });

  it('still rejects a non-OK response and a response that is not a Firebase config', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 404, json: async () => ({}) }));
    const notOk = await settledOr((await freshModule()).loadFirebaseConfig());
    assert.match(notOk.error.message, /404/);

    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const notConfig = await settledOr((await freshModule()).loadFirebaseConfig());
    assert.match(notConfig.error.message, /did not contain a Firebase config/);
  });
});
