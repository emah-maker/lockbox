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
import { doc, setDoc, getDoc } from 'firebase/firestore';
import * as Notifications from 'expo-notifications';
import { useSettingsStore } from '../store/useSettingsStore';
import { getGoalNotificationPermission } from '../goals/goalNotifications';
import { registerPushToken, reportLocalCoverage, unregisterPushToken } from './pushRegistration';

jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  setDoc: jest.fn(async () => {}),
  deleteDoc: jest.fn(async () => {}),
  // reportLocalCoverage asks once per run whether this device's token
  // document is actually there before merging coverage into it. The default
  // here is "it is", because that is the only state in which a coverage
  // report is a legal write at all; the tests that care about the other
  // state override it.
  getDoc: jest.fn(async () => ({ exists: () => true })),
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
const getDocMock = getDoc as jest.MockedFunction<typeof getDoc>;
const permissionMock = getGoalNotificationPermission as jest.MockedFunction<typeof getGoalNotificationPermission>;
const tokenMock = Notifications.getExpoPushTokenAsync as jest.MockedFunction<typeof Notifications.getExpoPushTokenAsync>;

/** A document snapshot stub carrying the one thing this module asks of it.
 * Cast rather than built, because constructing a real DocumentSnapshot needs
 * a Firestore instance -- exactly what this file mocks away. */
function snapshot(exists: boolean) {
  return { exists: () => exists } as unknown as Awaited<ReturnType<typeof getDocMock>>;
}

/** The payload of the single setDoc this module made. */
function writtenData(): Record<string, unknown> {
  expect(setDocMock).toHaveBeenCalledTimes(1);
  return setDocMock.mock.calls[0][1] as Record<string, unknown>;
}

beforeEach(async () => {
  // Resets this module's in-memory state through its own public API rather
  // than by reaching inside it. The uid here is deliberately NOT uid-a:
  // unregisterPushToken clears the "last coverage written" key
  // unconditionally (its `finally`), but it also records that the document
  // it just deleted is gone -- and recording that about uid-a would
  // pre-answer the very question the last block of tests is here to ask.
  // Unregistering a DIFFERENT account clears the key while leaving uid-a's
  // token document existence genuinely unknown, which is what a fresh app
  // run looks like. That the two are scoped separately at all is itself the
  // point: one device signs in and out of more than one account.
  await unregisterPushToken('uid-other');
  jest.clearAllMocks();
  permissionMock.mockResolvedValue('granted');
  tokenMock.mockResolvedValue({ data: 'ExponentPushToken[abc]' } as Awaited<ReturnType<typeof tokenMock>>);
  getDocMock.mockResolvedValue(snapshot(true));
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
  // Every case below describes a device that IS a push target -- it
  // registered, so there is a token document for a coverage merge to merge
  // INTO. That is a precondition, not set dressing: a merge against a
  // missing document is a CREATE, and the rules reject a create carrying no
  // transport/token (tests/firestore-rules/pushReminders.test.ts pins that).
  // The outer beforeEach deliberately leaves the device unregistered, so
  // this one puts it back; the last three tests take it away again, because
  // the unregistered state is what they are about.
  beforeEach(async () => {
    await registerPushToken();
    jest.clearAllMocks();
  });

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

// The block above is about a registered device. This one is about the state
// the master-switch check does NOT cover: the switch is on, permission is
// granted, local reminders are being scheduled -- and there is still no
// token document, because minting the token failed. That is not an edge
// case, it is the permanent condition of every iOS build (see below), and
// it is where the denied-write loop lived.
describe('reportLocalCoverage without a registered token document', () => {
  // iOS never registers, by design -- plugins/withoutPushEntitlement.js
  // strips `aps-environment`, so getExpoPushTokenAsync always fails -- while
  // local reminders, and therefore coverage reports, go on working exactly
  // as normal. The resulting write is a merge with nothing to merge into,
  // i.e. a create carrying no transport and no token, which the rules deny
  // (tests/firestore-rules/pushReminders.test.ts pins that denial). Before
  // this check existed the app spent one such round trip, plus an SDK
  // console error, on every single reconcile, indefinitely.
  //
  // The read count is part of the assertion, not a bonus: trading a denied
  // write per reconcile for a READ per reconcile would be a quieter version
  // of the same bug.
  it('does not report while this device has no token document to merge into', async () => {
    getDocMock.mockResolvedValue(snapshot(false));
    await reportLocalCoverage({ scheduled: ['plan-1'], suppressed: [] });
    await reportLocalCoverage({ scheduled: ['plan-2'], suppressed: [] });
    expect(setDocMock).not.toHaveBeenCalled();
    expect(getDocMock).toHaveBeenCalledTimes(1);
  });

  // ...and a skipped report must not be recorded as a delivered one. The
  // unchanged-since-last-time shortcut is keyed off what was actually
  // WRITTEN, so a skip may not advance it -- otherwise an Android device
  // whose registration merely hadn't landed yet would swallow the first real
  // coverage report it ever had a document for, and the server would keep
  // pushing copies of reminders the phone is already showing.
  it('reports once registration gives it a document to merge into', async () => {
    getDocMock.mockResolvedValue(snapshot(false));
    await reportLocalCoverage({ scheduled: ['plan-1'], suppressed: [] });
    expect(setDocMock).not.toHaveBeenCalled();

    await registerPushToken();
    setDocMock.mockClear();

    await reportLocalCoverage({ scheduled: ['plan-1'], suppressed: [] });
    expect(writtenData()).toMatchObject({ localReminderIds: ['plan-1'], suppressedReminderIds: [] });
  });

  // A read that FAILS means "don't know", not "no document". Offline is the
  // ordinary way to get here, and offline is exactly when a device is most
  // likely to have fallen behind on reporting -- so this has to stay
  // retryable rather than latch into silence for the rest of the run.
  it('retries on the next reconcile when the existence read itself fails', async () => {
    getDocMock.mockRejectedValueOnce(new Error('offline'));
    await reportLocalCoverage({ scheduled: ['plan-1'], suppressed: [] });
    expect(setDocMock).not.toHaveBeenCalled();

    await reportLocalCoverage({ scheduled: ['plan-1'], suppressed: [] });
    expect(writtenData()).toMatchObject({ localReminderIds: ['plan-1'] });
  });
});
