// Unit tests for the call -> box alert-through gate. Run with `npm test`.
//
// The behaviour these exist to pin down is the poll path. CXCallObserver's
// delegate does not fire while iOS has the app suspended, which is its normal
// state with the phone shut in the box, so the alert cannot depend on the
// event alone -- it has to come from a snapshot taken whenever the app is
// woken (about once a second, by the box's own BLE status notify). That makes
// de-duplication load-bearing rather than a nicety: without it one ring would
// be re-alerted on every tick for as long as it rang.
import { CallMonitor } from './CallMonitor';
import { addCallListener, getCurrentCalls, CallEvent } from '../../modules/call-observer';
import { recordTick, recordCallEvent } from './callDiagnostics';
import type { BoxClient } from '../ble/BoxClient';
import type { BoxState } from '../ble/protocol';

jest.mock('../../modules/call-observer', () => ({
  isCallObserverAvailable: jest.fn(() => true),
  addCallListener: jest.fn(() => ({ remove: jest.fn() })),
  getCurrentCalls: jest.fn(() => []),
}));

// Mocked rather than exercised: callDiagnostics keeps module-level counters
// that would leak between tests here. Its own behaviour is covered in
// callDiagnostics.test.ts; what matters in this file is that CallMonitor
// reports the right things to it.
jest.mock('./callDiagnostics', () => ({
  recordTick: jest.fn(),
  recordCallEvent: jest.fn(),
}));

const mockAddCallListener = addCallListener as jest.Mock;
const mockGetCurrentCalls = getCurrentCalls as jest.Mock;
const mockRecordTick = recordTick as jest.Mock;
const mockRecordCallEvent = recordCallEvent as jest.Mock;

/** Every diagnostic kind recorded so far, in order. */
const recordedKinds = () => mockRecordCallEvent.mock.calls.map((c) => c[0]);

const ringing = (uuid = 'call-1'): CallEvent => ({ state: 'incoming', outgoing: false, uuid });

/** Lets the floating `void this.checkNow()` inside start() settle. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(overrides: { boxState?: BoxState; enabled?: boolean; connected?: boolean } = {}) {
  const cfg = {
    boxState: overrides.boxState ?? ('running' as BoxState),
    enabled: overrides.enabled ?? true,
    connected: overrides.connected ?? true,
  };
  const alertCall = jest.fn().mockResolvedValue(undefined);
  const client = {
    get connected() {
      return cfg.connected;
    },
    alertCall,
  } as unknown as BoxClient;
  const onAlertSent = jest.fn();
  const monitor = new CallMonitor({
    getClient: () => client,
    getBoxState: () => cfg.boxState,
    isEnabled: () => cfg.enabled,
    onAlertSent,
  });
  return { monitor, alertCall, onAlertSent, cfg };
}

/** The listener CallMonitor handed to addCallListener, i.e. the event path. */
const firedListener = (): ((e: CallEvent) => void) =>
  mockAddCallListener.mock.calls[mockAddCallListener.mock.calls.length - 1][0];

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCurrentCalls.mockReturnValue([]);
});

describe('event path', () => {
  it('alerts the box once when a call starts ringing', async () => {
    const { monitor, alertCall, onAlertSent } = setup();
    monitor.start();
    await flush();

    firedListener()(ringing());
    await flush();

    expect(alertCall).toHaveBeenCalledTimes(1);
    expect(alertCall).toHaveBeenCalledWith('Call');
    expect(onAlertSent).toHaveBeenCalledWith('Call');
  });

  it.each([
    ['a connected call', { state: 'connected', outgoing: false, uuid: 'c' }],
    ['an ended call', { state: 'ended', outgoing: false, uuid: 'c' }],
    ['a call being dialled out', { state: 'dialing', outgoing: true, uuid: 'c' }],
    ['an outgoing call mislabelled incoming', { state: 'incoming', outgoing: true, uuid: 'c' }],
  ] as [string, CallEvent][])('ignores %s', async (_label, event) => {
    const { monitor, alertCall } = setup();
    monitor.start();
    await flush();

    firedListener()(event);
    await flush();

    expect(alertCall).not.toHaveBeenCalled();
  });
});

describe('gating', () => {
  it('stays quiet when the user has call alerts switched off', async () => {
    const { monitor, alertCall } = setup({ enabled: false });
    monitor.start();
    firedListener()(ringing());
    await flush();
    expect(alertCall).not.toHaveBeenCalled();
  });

  it('stays quiet when the box is not locked -- there is nothing to alert through', async () => {
    const { monitor, alertCall } = setup({ boxState: 'idle' });
    monitor.start();
    firedListener()(ringing());
    await flush();
    expect(alertCall).not.toHaveBeenCalled();
  });

  it('stays quiet when the radio is not connected', async () => {
    const { monitor, alertCall } = setup({ connected: false });
    monitor.start();
    firedListener()(ringing());
    await flush();
    expect(alertCall).not.toHaveBeenCalled();
  });
});

describe('poll path (the half that survives suspension)', () => {
  it('alerts on a call that was already ringing before start() subscribed', async () => {
    // The event for this ring fired while the app was suspended, and Expo
    // does not replay it, so the listener alone would never hear about it.
    mockGetCurrentCalls.mockReturnValue([ringing()]);
    const { monitor, alertCall } = setup();

    monitor.start();
    await flush();

    expect(alertCall).toHaveBeenCalledTimes(1);
  });

  it('alerts exactly once for a call still ringing across 20 status ticks', async () => {
    mockGetCurrentCalls.mockReturnValue([ringing()]);
    const { monitor, alertCall } = setup();
    monitor.start();
    await flush();

    for (let i = 0; i < 20; i += 1) await monitor.checkNow();

    expect(alertCall).toHaveBeenCalledTimes(1);
  });

  it('does not touch the native snapshot before start()', async () => {
    const { monitor } = setup();
    await monitor.checkNow();
    expect(mockGetCurrentCalls).not.toHaveBeenCalled();
  });

  it('skips the native snapshot on ticks where it could not act anyway', async () => {
    // checkNow runs ~1/s for the whole length of every lock; when the feature
    // is off or the box is open there is nothing worth a JSI hop.
    const { monitor, cfg } = setup();
    monitor.start();
    await flush();
    mockGetCurrentCalls.mockClear();

    cfg.enabled = false;
    await monitor.checkNow();
    cfg.enabled = true;
    cfg.boxState = 'idle';
    await monitor.checkNow();

    expect(mockGetCurrentCalls).not.toHaveBeenCalled();
  });

  it('retries on the next tick when the BLE write fails', async () => {
    // A failed write must not consume the call: it is probably still ringing,
    // and the next notify is only a second away.
    mockGetCurrentCalls.mockReturnValue([ringing()]);
    const { monitor, alertCall, onAlertSent } = setup();
    alertCall.mockRejectedValueOnce(new Error('radio busy'));

    monitor.start();
    await flush();
    expect(alertCall).toHaveBeenCalledTimes(1);
    expect(onAlertSent).not.toHaveBeenCalled();

    await monitor.checkNow();

    expect(alertCall).toHaveBeenCalledTimes(2);
    expect(onAlertSent).toHaveBeenCalledTimes(1);
  });

  it('alerts separately for a second, different call', async () => {
    mockGetCurrentCalls.mockReturnValue([ringing('first')]);
    const { monitor, alertCall } = setup();
    monitor.start();
    await flush();

    mockGetCurrentCalls.mockReturnValue([ringing('first'), ringing('second')]);
    await monitor.checkNow();

    expect(alertCall).toHaveBeenCalledTimes(2);
  });

  it('forgets calls iOS no longer reports, so the dedupe set cannot grow unbounded', async () => {
    mockGetCurrentCalls.mockReturnValue([ringing()]);
    const { monitor, alertCall } = setup();
    monitor.start();
    await flush();
    expect(alertCall).toHaveBeenCalledTimes(1);

    mockGetCurrentCalls.mockReturnValue([]);
    await monitor.checkNow();

    // The same uuid coming back is proof the entry was pruned, not kept.
    mockGetCurrentCalls.mockReturnValue([ringing()]);
    await monitor.checkNow();

    expect(alertCall).toHaveBeenCalledTimes(2);
  });
});

describe('stop', () => {
  it('unsubscribes and stops polling', async () => {
    const remove = jest.fn();
    mockAddCallListener.mockReturnValueOnce({ remove });
    mockGetCurrentCalls.mockReturnValue([ringing()]);
    const { monitor, alertCall } = setup();
    monitor.start();
    await flush();

    monitor.stop();
    mockGetCurrentCalls.mockClear();
    await monitor.checkNow();

    expect(remove).toHaveBeenCalledTimes(1);
    expect(mockGetCurrentCalls).not.toHaveBeenCalled();
    expect(alertCall).toHaveBeenCalledTimes(1);
  });

  it('clears dedupe so a reconnect can alert a call that is still ringing', async () => {
    // stop()/start() is the disconnect/reconnect path, and a call that
    // outlived the drop has never been alerted to *this* box connection.
    mockGetCurrentCalls.mockReturnValue([ringing()]);
    const { monitor, alertCall } = setup();
    monitor.start();
    await flush();

    monitor.stop();
    monitor.start();
    await flush();

    expect(alertCall).toHaveBeenCalledTimes(2);
  });
});

describe('diagnostics', () => {
  it('counts a tick for every status notify, before any gating', async () => {
    // Counted even on ticks the feature ignores -- the number is a measure of
    // whether iOS wakes the app at all, not of feature eligibility.
    const { monitor, cfg } = setup();
    monitor.start();
    await flush();
    mockRecordTick.mockClear();

    cfg.enabled = false;
    await monitor.checkNow();
    cfg.boxState = 'idle';
    await monitor.checkNow();

    expect(mockRecordTick).toHaveBeenCalledTimes(2);
  });

  it('records the monitor starting and stopping', async () => {
    const { monitor } = setup();
    monitor.start();
    await flush();
    monitor.stop();

    expect(recordedKinds()).toEqual(['monitor-started', 'monitor-stopped']);
  });

  it('records seeing a call and alerting on it', async () => {
    mockGetCurrentCalls.mockReturnValue([ringing()]);
    const { monitor } = setup();
    monitor.start();
    await flush();

    expect(recordedKinds()).toEqual(['monitor-started', 'saw-call', 'alert-sent']);
  });

  it('records a failed write distinctly from a missed call', async () => {
    mockGetCurrentCalls.mockReturnValue([ringing()]);
    const { monitor, alertCall } = setup();
    alertCall.mockRejectedValueOnce(new Error('radio busy'));
    monitor.start();
    await flush();

    expect(recordedKinds()).toContain('write-failed');
  });

  it('logs a blocked call once, not once per tick', async () => {
    // 20 ticks of the same ineligible ring would otherwise evict every other
    // entry from a 40-entry buffer.
    mockGetCurrentCalls.mockReturnValue([ringing()]);
    const { monitor } = setup({ connected: false });
    monitor.start();
    await flush();
    for (let i = 0; i < 20; i += 1) await monitor.checkNow();

    const kinds = recordedKinds();
    expect(kinds.filter((k) => k === 'saw-call')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'skipped')).toHaveLength(1);
    expect(mockRecordCallEvent).toHaveBeenCalledWith('skipped', 'box not connected');
  });

  it('logs a later call again after the earlier one is gone', async () => {
    mockGetCurrentCalls.mockReturnValue([ringing('first')]);
    const { monitor } = setup({ connected: false });
    monitor.start();
    await flush();

    mockGetCurrentCalls.mockReturnValue([ringing('second')]);
    await monitor.checkNow();

    expect(recordedKinds().filter((k) => k === 'saw-call')).toHaveLength(2);
  });
});
