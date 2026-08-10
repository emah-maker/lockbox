// Unit tests for sessionHistory.ts's pure retag transform. The storage-backed
// wrappers (retagSession, appendSessions, etc.) aren't unit-tested here, same
// as the rest of this file -- only the pure logic is. Run with `npm test`.
import { applyTopicUpdate, LoggedSession } from './sessionHistory';

const session = (startedAt: number, plannedS: number, actualS: number, topic?: string): LoggedSession => ({
  startedAt,
  plannedS,
  actualS,
  outcome: 'completed',
  topic,
});

describe('applyTopicUpdate', () => {
  it('retags only the session matching the startedAt+plannedS+actualS triple', () => {
    const sessions = [session(1, 60, 60, 'work'), session(2, 120, 120, 'study')];
    const next = applyTopicUpdate(sessions, { startedAt: 2, plannedS: 120, actualS: 120 }, 'custom:abc');
    expect(next[0].topic).toBe('work');
    expect(next[1].topic).toBe('custom:abc');
  });

  it('clears a tag when given undefined', () => {
    const sessions = [session(1, 60, 60, 'work')];
    const next = applyTopicUpdate(sessions, { startedAt: 1, plannedS: 60, actualS: 60 }, undefined);
    expect(next[0].topic).toBeUndefined();
  });

  it('leaves the array unchanged (a same-length copy) when no session matches', () => {
    const sessions = [session(1, 60, 60, 'work')];
    const next = applyTopicUpdate(sessions, { startedAt: 999, plannedS: 1, actualS: 1 }, 'study');
    expect(next).toEqual(sessions);
    expect(next).not.toBe(sessions);
  });

  it('does not mutate the input array', () => {
    const sessions = [session(1, 60, 60, 'work')];
    applyTopicUpdate(sessions, { startedAt: 1, plannedS: 60, actualS: 60 }, 'study');
    expect(sessions[0].topic).toBe('work');
  });
});
