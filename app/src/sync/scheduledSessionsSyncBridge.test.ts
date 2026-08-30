// scheduledSessionsSyncBridge.test.ts -- which store changes reach Firestore,
// and which must not.
//
// This is not a "does the wiring fire" test. The push rewrites whole plan
// documents including `notifiedAt: null`, and `notifiedAt` is the field the
// reminder job writes to record that it has already sent a reminder
// (functions/src/index.ts). A write is therefore NOT idempotent against a
// document the backend has marked: it re-arms it, and the reminder is
// delivered again. Everything below is about not doing that by accident --
// which the bridge did on hydration, on a remote merge landing, and to every
// untouched plan whenever one was edited.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setJSON } from '../storage/storage';
import { pushScheduledSessions, deleteRemoteScheduledSession } from './scheduledSessionsSync';
import { useScheduleStore } from '../store/useScheduleStore';
import { startScheduledSessionsSyncBridge } from './scheduledSessionsSyncBridge';
import type { ScheduledSession, ScheduledSessionInput } from '../schedule/scheduledSessions';

jest.mock('./scheduledSessionsSync', () => ({
  pushScheduledSessions: jest.fn(async () => {}),
  deleteRemoteScheduledSession: jest.fn(async () => {}),
}));

// The reconcile is the schedule store's business, not this file's -- stubbed
// so no native notifications module is needed and every persist() resolves
// the same way.
jest.mock('../schedule/sessionReminders', () => ({
  syncSessionReminders: jest.fn(async () => ({ scheduled: [], suppressed: [] })),
}));

jest.mock('../push/pushRegistration', () => ({
  reportLocalCoverage: jest.fn(async () => {}),
  registerPushToken: jest.fn(async () => {}),
  unregisterPushToken: jest.fn(async () => {}),
}));

jest.mock('../auth/firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: { uid: 'uid-a' } }),
}));

jest.mock('../auth/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ user: { uid: 'uid-a' } }), subscribe: () => () => {} },
}));

const pushMock = pushScheduledSessions as jest.MockedFunction<typeof pushScheduledSessions>;
const deleteMock = deleteRemoteScheduledSession as jest.MockedFunction<typeof deleteRemoteScheduledSession>;

const input = (over: Partial<ScheduledSessionInput> = {}): ScheduledSessionInput => ({
  date: '2126-09-01',
  time: '10:00',
  topic: null,
  leadMinutes: 10,
  ...over,
});

const storedPlan = (over: Partial<ScheduledSession> = {}): ScheduledSession => ({
  id: 'sched_1',
  date: '2126-09-01',
  time: '10:00',
  topic: null,
  leadMinutes: 10,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

/** The plan ids handed to the most recent push. */
function pushedIds(): string[] {
  expect(pushMock).toHaveBeenCalled();
  const last = pushMock.mock.calls[pushMock.mock.calls.length - 1][0];
  return last.map((p) => p.id);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  useScheduleStore.setState({ hydrated: true, scheduled: [], deletedIds: {}, localWrites: 0 });
  startScheduledSessionsSyncBridge(); // idempotent; the first test starts it
});

describe('what gets pushed', () => {
  it('pushes a newly added plan', () => {
    useScheduleStore.getState().addScheduledSession(input());
    expect(pushedIds()).toEqual(useScheduleStore.getState().scheduled.map((p) => p.id));
  });

  // The one that caused duplicate reminders. Editing plan B rewrote plan A
  // too, clearing the mark the backend had put on A when it sent A's
  // reminder -- so A's reminder went out again on the next tick.
  it('pushes only the edited plan, not the untouched ones', () => {
    const store = useScheduleStore.getState();
    store.addScheduledSession(input({ time: '10:00' }));
    store.addScheduledSession(input({ time: '11:00' }));
    const [a, b] = useScheduleStore.getState().scheduled;
    pushMock.mockClear();

    useScheduleStore.getState().editScheduledSession(b.id, input({ time: '12:00' }));
    expect(pushedIds()).toEqual([b.id]);
    expect(pushedIds()).not.toContain(a.id);
  });

  it('pushes the plan whose done state changed, and nothing else', () => {
    const store = useScheduleStore.getState();
    store.addScheduledSession(input({ time: '10:00' }));
    store.addScheduledSession(input({ time: '11:00' }));
    const [a, b] = useScheduleStore.getState().scheduled;
    pushMock.mockClear();

    useScheduleStore.getState().setDone(a.id, true);
    expect(pushedIds()).toEqual([a.id]);
    expect(pushedIds()).not.toContain(b.id);
  });

  it('removes a deleted plan remotely without pushing the survivors', () => {
    const store = useScheduleStore.getState();
    store.addScheduledSession(input({ time: '10:00' }));
    store.addScheduledSession(input({ time: '11:00' }));
    const [a] = useScheduleStore.getState().scheduled;
    pushMock.mockClear();

    useScheduleStore.getState().removeScheduledSession(a.id);
    expect(deleteMock).toHaveBeenCalledWith(a.id);
    // The surviving plan is unchanged, so there is nothing to write for it.
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe('what must NOT get pushed', () => {
  // Opening the app is not an edit. Hydration replaces the plan array with
  // the contents of storage, which used to look exactly like a mutation --
  // so every reminder already sent got re-armed on every app start, and any
  // still inside the backend's grace window was delivered a second time.
  it('does not push on hydration', async () => {
    // Through the app's own writer, so the key prefix storage.ts owns stays
    // its business rather than being restated here.
    await setJSON('scheduledSessions', [storedPlan()]);
    useScheduleStore.setState({ hydrated: false, scheduled: [], deletedIds: {}, localWrites: 0 });

    await useScheduleStore.getState().hydrate();

    expect(useScheduleStore.getState().scheduled).toHaveLength(1);
    expect(pushMock).not.toHaveBeenCalled();
  });

  // A remote merge has already reconciled both sides and pushed whatever the
  // server was missing (scheduledSessionsSync.ts). Echoing it back would
  // rewrite the very documents just pulled, clearing the sent-mark on each.
  it('does not push a remote merge back to the server', () => {
    useScheduleStore.getState().applyRemoteScheduledSessions([storedPlan({ id: 'sched_9', updatedAt: 5 })]);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('does not push an account wipe', () => {
    useScheduleStore.getState().addScheduledSession(input());
    pushMock.mockClear();
    useScheduleStore.getState().resetScheduledSessions();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe('a push that fails', () => {
  // Pushing the whole set made every mutation an implicit retry of the last
  // failed one. Pushing only what changed removes that, so an outstanding
  // plan has to be carried forward explicitly or a plan created offline sits
  // local-only until the next sign-in.
  it('is retried alongside the next mutation', async () => {
    pushMock.mockRejectedValueOnce(new Error('offline'));
    useScheduleStore.getState().addScheduledSession(input({ time: '10:00' }));
    const [a] = useScheduleStore.getState().scheduled;
    await Promise.resolve(); // let the rejection be observed
    pushMock.mockClear();

    useScheduleStore.getState().addScheduledSession(input({ time: '11:00' }));
    const ids = pushedIds();
    expect(ids).toContain(a.id);
    expect(ids).toHaveLength(2);
  });
});
