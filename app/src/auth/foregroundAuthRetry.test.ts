// foregroundAuthRetry.test.ts -- regression tests for the "the app keeps
// signing me out" bug foregroundAuthRetry.ts's own header describes: iOS can
// cold-launch this app in the BACKGROUND, screen off, to hand back a restored
// bluetooth-central. If that happens between a reboot and the owner's first
// unlock, the Keychain refuses and useAuthStore's one-shot init() (run once,
// from App.tsx's mount effect) never gets another chance -- auth stays down
// for the life of the process even after the owner unlocks and opens the app.
//
// useAuthStore is mocked wholesale: the subject here is the subscription/gate
// logic (when does a retry happen, and does a failed one ever escape), not
// init()'s own behavior, which authInitGate.test.ts already covers.
import { AppState } from 'react-native';
import { startForegroundAuthRetry } from './foregroundAuthRetry';
import { useAuthStore } from './useAuthStore';

jest.mock('./useAuthStore', () => ({
  useAuthStore: { getState: jest.fn() },
}));

const mockGetState = useAuthStore.getState as jest.Mock;

/** Grabs the 'change' handler startForegroundAuthRetry() registered, so a
 * test can simulate an AppState transition the same way the real emitter
 * would invoke it -- the jest-preset mock (@react-native/jest-preset's
 * mocks/AppState.js) never fires it on its own. Same technique as
 * useNowMs.test.tsx's latestAppStateHandler. */
function latestAppStateHandler(): (state: string) => void {
  const addEventListener = AppState.addEventListener as jest.Mock;
  const call = addEventListener.mock.calls[addEventListener.mock.calls.length - 1];
  return call[1];
}

/** Microtask drain for the `.init().catch(...)` chain below a handler
 * invocation. init() is mocked directly here (no real sign-in chain to wait
 * out), so a handful of ticks is provably enough -- but this follows the same
 * named-helper shape as loginSimulation.audit.test.ts/SignedOutAccount.test.tsx's
 * own flush(), rather than a bare unexplained await. */
async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  // The bug this module fixes was silent; these tests assert on console.warn
  // rather than letting it print during a normal test run.
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('startForegroundAuthRetry', () => {
  it('re-runs init() when the app becomes active while initError is set', () => {
    const init = jest.fn().mockResolvedValue(undefined);
    mockGetState.mockReturnValue({ initError: "Couldn't start sign-in.", init });

    startForegroundAuthRetry();
    // Confirms latestAppStateHandler() below is actually reading the
    // listener this module registered, not some other 'change' subscriber.
    expect(AppState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    latestAppStateHandler()('active');

    expect(init).toHaveBeenCalledTimes(1);
  });

  it('does not re-run init() on an ordinary foreground with no initError', () => {
    // The gate that keeps this fix from becoming a performance bug: a
    // healthy session must never re-run init() just because the app was
    // switched back to, which happens far more often than a failed init.
    const init = jest.fn().mockResolvedValue(undefined);
    mockGetState.mockReturnValue({ initError: null, init });

    startForegroundAuthRetry();
    latestAppStateHandler()('active');

    expect(init).not.toHaveBeenCalled();
  });

  it.each(['background', 'inactive'])(
    'does nothing on a transition to %s, even while initError is set',
    (state) => {
      const init = jest.fn().mockResolvedValue(undefined);
      mockGetState.mockReturnValue({ initError: 'still down', init });

      startForegroundAuthRetry();
      latestAppStateHandler()(state);

      expect(init).not.toHaveBeenCalled();
    },
  );

  it('swallows a rejected retry instead of letting it escape as an unhandled rejection', async () => {
    const init = jest.fn().mockRejectedValue(new Error('Keychain unavailable'));
    mockGetState.mockReturnValue({ initError: 'still down', init });
    startForegroundAuthRetry();

    // The AppState callback itself is synchronous and has no caller to await
    // it or catch its rejection -- if the retry's failure weren't handled
    // internally, this is where it would surface as an unhandled rejection.
    expect(() => latestAppStateHandler()('active')).not.toThrow();
    await flush();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[foregroundAuthRetry]'),
      expect.anything(),
    );
  });

  it('does not overwrite the specific message init() already wrote into initError', async () => {
    // init() itself decides what the Account page shows (it sets initError
    // before its caller ever sees the rejection) -- a generic message
    // written here on top of it would either blank out or genericize a
    // diagnosis that was already specific (e.g. the Keychain-unavailable
    // string), which is exactly the case this whole module exists for.
    const specificMessage =
      "Couldn't open secure storage on this phone. Open Phone Box again once it's unlocked.";
    const state = { initError: specificMessage, init: jest.fn().mockRejectedValue(new Error('still locked')) };
    mockGetState.mockReturnValue(state);
    startForegroundAuthRetry();

    latestAppStateHandler()('active');
    await flush();

    expect(state.initError).toBe(specificMessage);
  });

  it("returns AppState's own subscription, so the caller's remove() actually unsubscribes", () => {
    const removeSpy = jest.fn();
    (AppState.addEventListener as jest.Mock).mockReturnValueOnce({ remove: removeSpy });
    mockGetState.mockReturnValue({ initError: null, init: jest.fn() });

    const subscription = startForegroundAuthRetry();
    subscription.remove();

    // Not "does the mock's remove fire when called" (that's circular) but
    // "is the object this function returned the SAME one AppState produced" --
    // a wrapper that returned some other object would leave the real listener
    // permanently attached however many times the caller calls remove().
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying on every foreground while the error persists', () => {
    // The owner can unlock and reopen the app more than once before a retry
    // finally succeeds (e.g. still offline) -- only the first attempt would
    // ship a fix that "sometimes" recovers.
    const init = jest.fn().mockResolvedValue(undefined);
    mockGetState.mockReturnValue({ initError: 'still down', init });
    startForegroundAuthRetry();
    const handler = latestAppStateHandler();

    handler('active');
    handler('active');
    handler('active');

    expect(init).toHaveBeenCalledTimes(3);
  });
});
