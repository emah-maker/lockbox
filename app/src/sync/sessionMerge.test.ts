// Unit tests for sessionMerge.ts's pure session-merge step (used by
// firestoreSync.ts's syncSessions, which itself talks to Firebase and isn't
// unit-tested -- same as the rest of sync/). Run with `npm test`.
import { mergeSessionsPreferLocalTopic, sessionDocId } from './sessionMerge';
import { LoggedSession } from '../stats/sessionHistory';

const session = (startedAt: number, actualS: number, topic?: string, topicUpdatedAt?: number): LoggedSession => ({
  startedAt,
  plannedS: actualS,
  actualS,
  outcome: 'completed',
  topic,
  topicUpdatedAt,
});

const DEVICE = 'device-1';

describe('mergeSessionsPreferLocalTopic', () => {
  it('falls back to local-wins with no topicUpdatedAt stamped on either side (pre-LWW records)', () => {
    const local = [session(1, 60, 'custom:abc')];
    const remoteId = sessionDocId(DEVICE, local[0]);
    const remote = [{ id: remoteId, session: session(1, 60, 'work') }];

    const { merged, toUpload, toRetag } = mergeSessionsPreferLocalTopic(local, remote, DEVICE);

    expect(merged).toHaveLength(1);
    expect(merged[0].topic).toBe('custom:abc');
    expect(toUpload).toEqual([]); // already on the remote side -- never re-uploaded
    expect(toRetag).toEqual([]); // tie (both unstamped) doesn't count as a genuine newer edit
  });

  it('keeps a local retag with a newer topicUpdatedAt, and queues it for pushing', () => {
    const local = [session(1, 60, 'custom:abc', 2000)];
    const remoteId = sessionDocId(DEVICE, local[0]);
    const remote = [{ id: remoteId, session: session(1, 60, 'work', 1000) }];

    const { merged, toRetag } = mergeSessionsPreferLocalTopic(local, remote, DEVICE);

    expect(merged[0].topic).toBe('custom:abc');
    expect(toRetag).toEqual([{ id: remoteId, topic: 'custom:abc', topicUpdatedAt: 2000 }]);
  });

  it('prefers a remote relabel (e.g. from the dashboard) with a newer topicUpdatedAt, and does not queue a push', () => {
    const local = [session(1, 60, 'custom:abc', 1000)];
    const remoteId = sessionDocId(DEVICE, local[0]);
    const remote = [{ id: remoteId, session: session(1, 60, 'work', 2000) }];

    const { merged, toRetag } = mergeSessionsPreferLocalTopic(local, remote, DEVICE);

    expect(merged[0].topic).toBe('work');
    expect(toRetag).toEqual([]);
  });

  it('clearing a local tag (topic undefined) also wins over a remote topic', () => {
    const local = [session(1, 60, undefined)];
    const remoteId = sessionDocId(DEVICE, local[0]);
    const remote = [{ id: remoteId, session: session(1, 60, 'work') }];

    const { merged } = mergeSessionsPreferLocalTopic(local, remote, DEVICE);

    expect(merged[0].topic).toBeUndefined();
  });

  it('uploads a session that only exists locally, unmodified', () => {
    const local = [session(1, 60, 'work')];
    const { merged, toUpload } = mergeSessionsPreferLocalTopic(local, [], DEVICE);

    expect(merged).toEqual(local);
    expect(toUpload).toEqual([{ id: sessionDocId(DEVICE, local[0]), session: local[0] }]);
  });

  it('keeps a session that only exists remotely (e.g. logged from another device)', () => {
    const remote = [{ id: 'other-device_1_60', session: session(1, 60, 'study') }];
    const { merged, toUpload } = mergeSessionsPreferLocalTopic([], remote, DEVICE);

    expect(merged).toEqual([remote[0].session]);
    expect(toUpload).toEqual([]);
  });

  it('sorts the merged result by startedAt', () => {
    const local = [session(3, 10), session(1, 10)];
    const { merged } = mergeSessionsPreferLocalTopic(local, [], DEVICE);
    expect(merged.map((s) => s.startedAt)).toEqual([1, 3]);
  });

  describe('same-millisecond tiebreak (both sides stamped, equal topicUpdatedAt, different topics)', () => {
    it('breaks a genuine tie deterministically by topic string, and pushes a retag when local is the winner, bumping the clock past the tie', () => {
      const local = [session(1, 60, 'zzz', 1500)];
      const remoteId = sessionDocId(DEVICE, local[0]);
      const remote = [{ id: remoteId, session: session(1, 60, 'aaa', 1500) }];

      const { merged, toRetag } = mergeSessionsPreferLocalTopic(local, remote, DEVICE);

      expect(merged[0].topic).toBe('zzz'); // 'zzz' > 'aaa' wins the tiebreak
      // The old code applied the local winner locally but never pushed it
      // (it only pushed when localAt > remoteAt strictly) -- the remote doc
      // stayed wrong forever. A tie win must still queue a push.
      //
      // The pushed (and merged) timestamp can't be the tied 1500 itself:
      // firestore.rules' sessions `update` rule requires topicUpdatedAt to
      // strictly increase, so a retag at the tied value would be rejected by
      // the server and retried forever. The winner bumps the clock instead.
      expect(merged[0].topicUpdatedAt).toBe(1501);
      expect(toRetag).toEqual([{ id: remoteId, topic: 'zzz', topicUpdatedAt: 1501 }]);
      expect(toRetag[0].topicUpdatedAt).toBeGreaterThan(1500); // the invariant the server rule enforces
    });

    it('the same tie resolves with no retag push when local is the loser (remote already holds the winning topic)', () => {
      const local = [session(1, 60, 'aaa', 1500)];
      const remoteId = sessionDocId(DEVICE, local[0]);
      const remote = [{ id: remoteId, session: session(1, 60, 'zzz', 1500) }];

      const { merged, toRetag } = mergeSessionsPreferLocalTopic(local, remote, DEVICE);

      expect(merged[0].topic).toBe('zzz');
      expect(toRetag).toEqual([]);
    });

    it('converges on the same winning topic regardless of which device calls itself local, so the two devices stop ping-ponging retags', () => {
      const stampedAt = (topic: string) => session(1, 60, topic, 1500);

      const deviceALocal = [stampedAt('zzz')];
      const deviceARemote = [{ id: sessionDocId(DEVICE, deviceALocal[0]), session: stampedAt('aaa') }];
      const fromDeviceA = mergeSessionsPreferLocalTopic(deviceALocal, deviceARemote, DEVICE);

      // Same two records, but with local/remote swapped -- as device B (the
      // one holding 'aaa' locally) would see them.
      const deviceBLocal = [stampedAt('aaa')];
      const deviceBRemote = [{ id: sessionDocId(DEVICE, deviceBLocal[0]), session: stampedAt('zzz') }];
      const fromDeviceB = mergeSessionsPreferLocalTopic(deviceBLocal, deviceBRemote, DEVICE);

      expect(fromDeviceA.merged[0].topic).toBe(fromDeviceB.merged[0].topic);
      expect(fromDeviceA.merged[0].topic).toBe('zzz');
    });

    it('equal topicUpdatedAt of exactly 0 on both sides is not a genuine tie -- falls back to local-wins with no retag (legacy pre-field records)', () => {
      const local = [session(1, 60, 'custom:abc', 0)];
      const remoteId = sessionDocId(DEVICE, local[0]);
      const remote = [{ id: remoteId, session: session(1, 60, 'work', 0) }];

      const { merged, toRetag } = mergeSessionsPreferLocalTopic(local, remote, DEVICE);

      expect(merged[0].topic).toBe('custom:abc');
      expect(toRetag).toEqual([]);
    });

    it('equal non-zero timestamps with the same topic on both sides is not a conflict -- no retag pushed', () => {
      const local = [session(1, 60, 'work', 1500)];
      const remoteId = sessionDocId(DEVICE, local[0]);
      const remote = [{ id: remoteId, session: session(1, 60, 'work', 1500) }];

      const { merged, toRetag } = mergeSessionsPreferLocalTopic(local, remote, DEVICE);

      expect(merged[0].topic).toBe('work');
      expect(toRetag).toEqual([]);
    });
  });
});
