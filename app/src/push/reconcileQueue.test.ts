// Unit tests for reconcileQueue.ts's serializeLatest -- locks down the two
// properties that file's own header describes: an in-flight run is never
// re-entered by a caller that arrives while it's running, and everything
// that piles up behind it coalesces down to (and settles with) the single
// latest call, not a growing queue. Run with `npm test`.
import { serializeLatest } from './reconcileQueue';

// A promise this file can resolve/reject from outside the async fn under
// test, so a test can pause a "run" mid-flight and observe state in between.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('serializeLatest', () => {
  it('never re-enters the wrapped fn before the in-flight run resolves', async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const gate = deferred<void>();
    const run = jest.fn(async (_arg: string) => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await gate.promise;
      inFlight -= 1;
    });
    const wrapped = serializeLatest(run);

    const p1 = wrapped('a');
    const p2 = wrapped('b'); // arrives while the first call is still running

    // Still only the first run has actually started -- a naive
    // implementation that didn't serialize would call `run` again here.
    expect(run).toHaveBeenCalledTimes(1);

    gate.resolve();
    await p1;
    await p2;

    expect(maxConcurrent).toBe(1);
  });

  it('coalesces calls that pile up behind an in-flight run down to the latest one', async () => {
    const gate = deferred<void>();
    const run = jest.fn(async (arg: string) => {
      if (arg === 'A') await gate.promise;
      return `${arg}-result`;
    });
    const wrapped = serializeLatest(run);

    const pA = wrapped('A');
    const pB = wrapped('B'); // superseded before it ever runs
    const pC = wrapped('C'); // the one call that actually runs after A

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('A');

    gate.resolve();
    await pA;
    const [resultB, resultC] = await Promise.all([pB, pC]);

    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenNthCalledWith(1, 'A');
    expect(run).toHaveBeenNthCalledWith(2, 'C'); // B was dropped, never invoked
    // Every caller coalesced together resolves with the run that actually
    // happened -- B's own promise settles with C's result, not its own.
    expect(resultB).toBe('C-result');
    expect(resultC).toBe('C-result');
  });

  it('lets the queued run proceed after the in-flight run rejects, unaffected by that rejection', async () => {
    const run = jest.fn(async (arg: string) => {
      if (arg === 'A') throw new Error('boom');
      return `${arg}-ok`;
    });
    const wrapped = serializeLatest(run);

    const pA = wrapped('A');
    const pB = wrapped('B');

    await expect(pA).rejects.toThrow('boom');
    await expect(pB).resolves.toBe('B-ok');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('fully resets its queue state once everything settles, so a later call runs immediately', async () => {
    const gate = deferred<void>();
    const run = jest.fn((arg: string) => (arg === 'A' ? gate.promise.then(() => 'A-done') : Promise.resolve(`${arg}-done`)));
    const wrapped = serializeLatest(run);

    const pA = wrapped('A');
    const pB = wrapped('B'); // coalesced behind A, the only pending call

    gate.resolve();
    await pA;
    await pB;

    // If `running`/the pending-args slot/the pending promise weren't fully
    // cleared after B settled, this next call would either coalesce into
    // stale leftover state or never resolve at all.
    const pC = wrapped('C');
    await expect(pC).resolves.toBe('C-done');
    expect(run).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenNthCalledWith(3, 'C');
  });
});
