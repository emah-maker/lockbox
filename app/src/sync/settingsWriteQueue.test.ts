// settingsWriteQueue.test.ts -- the ordering guarantees firestoreSync leans
// on so its two settings writers (the two-way merge and the incremental
// bridge push) can never be in flight against users/{uid}/settings/app at the
// same time. See settingsWriteQueue.ts's header for the write this used to
// lose.
import { queueSettingsWrite, resetSettingsWriteQueue } from './settingsWriteQueue';

/** A write whose completion the test controls, recording when it STARTED --
 * which is the moment the real one reads live store state. */
function deferred() {
  let settle!: (err?: Error) => void;
  const started: { value: boolean } = { value: false };
  const done = new Promise<void>((resolve, reject) => {
    settle = (err) => (err ? reject(err) : resolve());
  });
  const write = jest.fn(() => {
    started.value = true;
    return done;
  });
  return { write, started, settle };
}

/** Let every already-resolved promise in the chain run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetSettingsWriteQueue();
});

describe('serialization', () => {
  it('does not start a second write while the first is in flight', async () => {
    const a = deferred();
    const b = deferred();

    const first = queueSettingsWrite('uid-a', a.write);
    // A different key, so it queues rather than coalescing -- this is about
    // ordering, not about merging.
    const second = queueSettingsWrite('uid-b', b.write);
    await flush();

    expect(a.started.value).toBe(true);
    expect(b.started.value).toBe(false);

    a.settle();
    await first;
    await flush();
    expect(b.started.value).toBe(true);

    b.settle();
    await second;
  });

  // The whole reason the queue exists: the second writer's payload is read
  // when it starts, so "starts last" has to mean "reads last" has to mean
  // "lands last".
  it('runs queued writes in the order they were queued', async () => {
    const order: string[] = [];
    const run = (name: string) => async () => {
      order.push(name);
    };

    const all = [
      queueSettingsWrite('uid-a', run('a')),
      queueSettingsWrite('uid-b', run('b')),
      queueSettingsWrite('uid-c', run('c')),
    ];
    await Promise.all(all);

    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('starts the next write even when the previous one failed', async () => {
    const a = deferred();
    const b = deferred();

    const first = queueSettingsWrite('uid-a', a.write);
    const second = queueSettingsWrite('uid-b', b.write);
    await flush();

    a.settle(new Error('offline'));
    await expect(first).rejects.toThrow('offline');
    await flush();

    expect(b.started.value).toBe(true);
    b.settle();
    await expect(second).resolves.toBeUndefined();
  });
});

describe('coalescing', () => {
  // Every write for one account sends the same thing -- whatever the store
  // holds when it runs -- so a burst of setting changes behind an in-flight
  // write needs exactly one write to catch up, not one per change.
  it('collapses writes that pile up behind an in-flight one for the same account', async () => {
    const inFlight = deferred();
    const queued = deferred();

    const first = queueSettingsWrite('uid-a', inFlight.write);
    await flush();
    expect(inFlight.started.value).toBe(true);

    const second = queueSettingsWrite('uid-a', queued.write);
    const third = queueSettingsWrite('uid-a', jest.fn());
    const fourth = queueSettingsWrite('uid-a', jest.fn());
    expect(second).toBe(third);
    expect(third).toBe(fourth);

    inFlight.settle();
    await first;
    await flush();

    // The one queued write ran; the two that joined it contributed no
    // round trip of their own.
    expect(queued.write).toHaveBeenCalledTimes(1);
    queued.settle();
    await Promise.all([second, third, fourth]);
  });

  it('does not coalesce writes for different accounts', async () => {
    const inFlight = deferred();
    const a = jest.fn(async () => {});
    const b = jest.fn(async () => {});

    const first = queueSettingsWrite('uid-a', inFlight.write);
    await flush();

    const second = queueSettingsWrite('uid-a', a);
    const third = queueSettingsWrite('uid-b', b);
    expect(second).not.toBe(third);

    inFlight.settle();
    await Promise.all([first, second, third]);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  // A write that has already started has already read its state, so it
  // cannot stand in for a change made after it started.
  it('gives a write that arrives after the queued one started its own run', async () => {
    const inFlight = deferred();
    const queued = deferred();
    const late = deferred();

    const first = queueSettingsWrite('uid-a', inFlight.write);
    await flush();
    const second = queueSettingsWrite('uid-a', queued.write);

    inFlight.settle();
    await first;
    await flush();
    expect(queued.started.value).toBe(true);

    const third = queueSettingsWrite('uid-a', late.write);
    expect(third).not.toBe(second);
    expect(late.started.value).toBe(false);

    queued.settle();
    await second;
    await flush();
    expect(late.started.value).toBe(true);

    late.settle();
    await third;
  });
});
