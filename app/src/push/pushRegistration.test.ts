// pushRegistration.test.ts -- the two rules that decide whether this device
// is a target for a SERVER-SENT reminder, both of which are load-bearing in a
// way that isn't obvious from either function's body.
//
// The backend pushes a reminder to every registered token that does not
// report handling it (functions/src/index.ts). That inverts the usual
// direction of a bug here: the dangerous failure is not "we forgot to
// register", it is "we registered, and then said we cover nothing" -- which
// reads to the server as "deliver everything to this phone". Both tests below
// are about states where the user has asked for LESS notification and the
// mechanism could quietly produce more.
//
// Firebase and expo-notifications are mocked at the module boundary: this
// file is about which writes happen, not about what Firestore does with them.
import { doc, setDoc } from 'firebase/firestore';
import * as Notifications from 'expo-notifications';
import { useSettingsStore } from '../store/useSettingsStore';
import { getGoalNotificationPermission } from '../goals/goalNotifications';
import { registerPushToken, reportLocalCoverage, unregisterPushToken } from './pushRegistration';

jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  setDoc: jest.fn(async () => {}),
  deleteDoc: jest.fn(async () => {}),
}));

jest.mock('../auth/firebase', () => ({
  getDb: () => ({}),
  getFirebaseAuth: () => ({ currentUser: { uid: 'uid-a' } }),
}));

jest.mock('../goals/goalNotifications', () => ({
  getGoalNotificationPermission: jest.fn(async () => 'granted'),
}));

jest.mock('expo-notifications', () => ({
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[abc]' })),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'proj-1' } } } },
}));

const setDocMock = setDoc as jest.MockedFunction<typeof setDoc>;
const permissionMock = getGoalNotificationPermission as jest.MockedFunction<typeof getGoalNotificationPermission>;
const tokenMock = Notifications.getExpoPushTokenAsync as jest.MockedFunction<typeof Notifications.getExpoPushTokenAsync>;

/** The payload of the single setDoc this module made. */
function writtenData(): Record<string, unknown> {
  expect(setDocMock).toHaveBeenCalledTimes(1);
  return setDocMock.mock.calls[0][1] as Record<string, unknown>;
}

beforeEach(async () => {
  // Clears the module's in-memory "last coverage written" key as a documented
  // side effect (see unregisterPushToken's `finally`), so each test below
  // starts from a device that has reported nothing -- without reaching into
  // module internals or resetting the registry.
  await unregisterPushToken('uid-a');
  jest.clearAllMocks();
  permissionMock.mockResolvedValue('granted');
  tokenMock.mockResolvedValue({ data: 'ExponentPushToken[abc]' } as Awaited<ReturnType<typeof tokenMock>>);
  useSettingsStore.setState({ notificationsEnabled: true });
});

describe('registerPushToken', () => {
  it('registers this device when notifications are on and permission is granted', async () => {
    await registerPushToken();
    expect(doc).toHaveBeenCalledWith(expect.anything(), 'users', 'uid-a', 'pushTokens', expect.any(String));
    expect(writtenData()).toMatchObject({ transport: 'expo', token: 'ExponentPushToken[abc]' });
  });

  // The regression that matters. A registered token whose device reports
  // covering nothing is an instruction to the server to deliver every
  // reminder here by push -- so registering while the master switch is OFF
  // doesn't merely fail to help, it turns reminders back ON, in the one form
  // the user cannot silence from inside the app.
  it('does not register at all while the notification master switch is off', async () => {
    useSettingsStore.setState({ notificationsEnabled: false });
    await registerPushToken();
    expect(setDocMock).not.toHaveBeenCalled();
    // Not even a token is minted: the switch is checked before anything
    // native is touched, so this costs nothing on a device that will never
    // register.
    expect(tokenMock).not.toHaveBeenCalled();
  });

  it('does not register when OS permission has not been granted', async () => {
    permissionMock.mockResolvedValue('denied');
    await registerPushToken();
    expect(setDocMock).not.toHaveBeenCalled();
  });
});

describe('reportLocalCoverage', () => {
  it('writes both what this device scheduled and what it silenced', async () => {
    await reportLocalCoverage({ scheduled: ['plan-1'], suppressed: ['plan-2'] });
    expect(writtenData()).toMatchObject({
      localReminderIds: ['plan-1'],
      suppressedReminderIds: ['plan-2'],
    });
  });

  it('skips the write when nothing has changed since the last report', async () => {
    await reportLocalCoverage({ scheduled: ['plan-1'], suppressed: [] });
    setDocMock.mockClear();
    await reportLocalCoverage({ scheduled: ['plan-1'], suppressed: [] });
    expect(setDocMock).not.toHaveBeenCalled();
  });

  // The suppressed half has to participate in that comparison. A user turning
  // quiet hours ON changes only this list -- the scheduled list shrinks to
  // exclude the silenced plan, but a device whose plans are ALL inside the
  // window goes from (scheduled: [], suppressed: []) to (scheduled: [],
  // suppressed: [...]), and a key built from the scheduled list alone would
  // call that unchanged and never tell the server to stop pushing.
  it('rewrites when only the suppressed list changed', async () => {
    await reportLocalCoverage({ scheduled: [], suppressed: [] });
    setDocMock.mockClear();
    await reportLocalCoverage({ scheduled: [], suppressed: ['plan-2'] });
    expect(writtenData()).toMatchObject({ localReminderIds: [], suppressedReminderIds: ['plan-2'] });
  });

  // Not merely pointless but actively denied: with the switch off there is no
  // token document, so this write is a merge that would have to CREATE one
  // carrying nothing but coverage lists -- which the rules reject for having
  // no transport or token. Every plan edit would spend a round trip on it.
  it('does not report at all while the notification master switch is off', async () => {
    useSettingsStore.setState({ notificationsEnabled: false });
    await reportLocalCoverage({ scheduled: ['plan-1'], suppressed: [] });
    expect(setDocMock).not.toHaveBeenCalled();
  });

  // Two lists whose concatenations are equal but whose split differs --
  // ['a'] scheduled vs ['a'] suppressed. These mean opposite things ("I am
  // showing this" vs "the user silenced this"), so a key that simply joined
  // the two lists together would treat the second as a no-op write.
  it('rewrites when an id moves from scheduled to suppressed', async () => {
    await reportLocalCoverage({ scheduled: ['plan-1'], suppressed: [] });
    setDocMock.mockClear();
    await reportLocalCoverage({ scheduled: [], suppressed: ['plan-1'] });
    expect(writtenData()).toMatchObject({ localReminderIds: [], suppressedReminderIds: ['plan-1'] });
  });
});
