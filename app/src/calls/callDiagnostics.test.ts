// Unit tests for the call-path instrumentation.
//
// `backgroundTicks` is the field the whole exercise turns on -- it is the
// evidence for or against iOS resuming the app for a BLE notify -- so the
// counting rules are pinned down here rather than trusted.
import { AppState } from 'react-native';
import { getJSON, setJSON } from '../storage/storage';
import {
  recordTick,
  recordCallEvent,
  getCallDiagnostics,
  hydrateCallDiagnostics,
  resetCallDiagnostics,
  __resetForTests,
} from './callDiagnostics';

jest.mock('../storage/storage', () => ({
  getJSON: jest.fn((_key: string, fallback: unknown) => Promise.resolve(fallback)),
  setJSON: jest.fn(() => Promise.resolve()),
}));

/** react-native/jest/setup.js mocks AppState as a plain object, so the state
 * is set by assignment -- same approach as useNowMs.test.tsx. */
const setAppState = (state: string | undefined) => {
  (AppState as unknown as { currentState: string | undefined }).currentState = state;
};

beforeEach(() => {
  jest.clearAllMocks();
  __resetForTests();
  setAppState('active');
});

describe('tick counting', () => {
  it('counts ticks and remembers the most recent one', () => {
    recordTick(1_000);
    recordTick(2_000);

    expect(getCallDiagnostics()).toMatchObject({ ticks: 2, lastTickAt: 2_000 });
  });

  it('counts only the ticks that arrived while the app was closed', () => {
    recordTick(1_000);
    setAppState('background');
    recordTick(2_000);
    setAppState('inactive');
    recordTick(3_000);

    expect(getCallDiagnostics()).toMatchObject({ ticks: 3, backgroundTicks: 2 });
  });

  it('does not treat an unknown app state as backgrounded', () => {
    // Early in launch currentState can be null; absence of evidence is not
    // evidence of a background wake, and this number is the whole experiment.
    setAppState(undefined);
    recordTick(1_000);

    expect(getCallDiagnostics().backgroundTicks).toBe(0);
  });

  it('tracks the longest silence between two ticks', () => {
    recordTick(0);
    recordTick(1_000);
    recordTick(9_000);
    recordTick(10_000);

    expect(getCallDiagnostics().maxGapMs).toBe(8_000);
  });
});

describe('gap logging', () => {
  it('says nothing at the normal once-a-second cadence', () => {
    recordTick(0);
    recordTick(1_000);
    recordTick(2_000);

    expect(getCallDiagnostics().events).toHaveLength(0);
  });

  it('logs a line when the heartbeat goes quiet', () => {
    recordTick(0);
    recordTick(30_000);

    const [event] = getCallDiagnostics().events;
    expect(event.kind).toBe('gap');
    expect(event.detail).toContain('30s silent');
    expect(event.detail).toContain('in foreground');
  });

  it('says whether the resume happened in the background', () => {
    recordTick(0);
    setAppState('background');
    recordTick(30_000);

    expect(getCallDiagnostics().events[0].detail).toContain('resumed backgrounded');
  });
});

describe('event log', () => {
  it('records a kind with its detail', () => {
    recordCallEvent('alert-sent', 'Call', 1_000);

    expect(getCallDiagnostics().events).toEqual([{ at: 1_000, kind: 'alert-sent', detail: 'Call' }]);
  });

  it('stays bounded, dropping the oldest entries', () => {
    for (let i = 0; i < 45; i += 1) recordCallEvent('saw-call', `e${i}`, 1_000 + i);

    const { events } = getCallDiagnostics();
    expect(events).toHaveLength(40);
    expect(events[0].detail).toBe('e5');
    expect(events[39].detail).toBe('e44');
  });

  it('hands out a snapshot a later event cannot mutate', () => {
    recordCallEvent('alert-sent', 'Call', 1_000);
    const snapshot = getCallDiagnostics();

    recordCallEvent('alert-sent', 'Call', 2_000);

    expect(snapshot.events).toHaveLength(1);
  });
});

describe('hydration', () => {
  it('carries live counters forward on top of the persisted ones', async () => {
    // App.tsx does not await hydrate, so a status tick can legitimately beat
    // it; that tick must not be thrown away by the restore.
    (getJSON as jest.Mock).mockResolvedValueOnce({
      ticks: 10,
      backgroundTicks: 4,
      lastTickAt: 500,
      maxGapMs: 7_000,
      events: [{ at: 1, kind: 'alert-sent' }],
    });
    recordTick(1_000);

    await hydrateCallDiagnostics();

    expect(getCallDiagnostics()).toMatchObject({
      ticks: 11,
      backgroundTicks: 4,
      lastTickAt: 1_000,
      maxGapMs: 7_000,
    });
  });

  it('only reads storage once', async () => {
    await hydrateCallDiagnostics();
    await hydrateCallDiagnostics();

    expect(getJSON).toHaveBeenCalledTimes(1);
  });

  it('falls back to zeros when the persisted copy is corrupt', async () => {
    (getJSON as jest.Mock).mockResolvedValueOnce({
      ticks: 'lots',
      backgroundTicks: -3,
      lastTickAt: 'yesterday',
      maxGapMs: NaN,
      events: 'nope',
    });

    await hydrateCallDiagnostics();

    expect(getCallDiagnostics()).toMatchObject({
      ticks: 0,
      backgroundTicks: 0,
      lastTickAt: null,
      maxGapMs: 0,
      events: [],
    });
  });

  it('drops malformed log entries and keeps the good ones', async () => {
    (getJSON as jest.Mock).mockResolvedValueOnce({
      ticks: 1,
      backgroundTicks: 0,
      lastTickAt: 5,
      maxGapMs: 0,
      events: [{ at: 1, kind: 'alert-sent' }, null, { kind: 'gap' }, { at: 2 }],
    });

    await hydrateCallDiagnostics();

    expect(getCallDiagnostics().events).toEqual([{ at: 1, kind: 'alert-sent' }]);
  });
});

describe('reset', () => {
  it('clears the counters and persists the cleared copy', async () => {
    recordTick(1_000);
    recordCallEvent('alert-sent', 'Call', 1_000);

    await resetCallDiagnostics();

    expect(getCallDiagnostics()).toMatchObject({ ticks: 0, backgroundTicks: 0, events: [] });
    expect(setJSON).toHaveBeenLastCalledWith('callDiagnostics', expect.objectContaining({ ticks: 0 }));
  });
});
