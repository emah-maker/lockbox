// users/{uid}/pushTokens/{tokenId} and users/{uid}/scheduledSessions/{planId}
// -- the two collections the push backend reads (functions/src/index.ts).
//
// These carry a different risk from the rest of this file's collections: a
// push token is an ADDRESS the server will send to, and a scheduled session
// is what it sends. A rule that let one user write into another's paths
// would let them aim notifications at a stranger's phone, so the
// cross-account cases below are the point of this suite, not an afterthought.
import { assertFails, assertSucceeds, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv } from './helpers';

let testEnv: RulesTestEnvironment;

const OWNER = 'user-a';
const OTHER = 'user-b';

const validToken = () => ({
  transport: 'expo',
  token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
  platform: 'ios',
  localReminderIds: ['sched_1', 'sched_2'],
  suppressedReminderIds: ['sched_7'],
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
});

const validPlan = () => ({
  date: '2026-09-01',
  time: '09:00',
  fireAtMs: 1_800_000_000_000,
  timeLabel: '9:00 AM',
  tz: 'America/New_York',
  topic: null,
  leadMinutes: 10,
  done: false,
  notifiedAt: null,
  updatedAt: 1_700_000_000_000,
});

beforeAll(async () => {
  testEnv = await createRulesTestEnv('push-reminders');
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv?.clearFirestore();
});

describe('users/{uid}/pushTokens/{tokenId}', () => {
  const path = (uid: string, id = 'device-1') => `users/${uid}/pushTokens/${id}`;

  it('lets the owner register, read, update and delete their own device', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(setDoc(doc(db, path(OWNER)), validToken()));
    await assertSucceeds(getDoc(doc(db, path(OWNER))));
    await assertSucceeds(updateDoc(doc(db, path(OWNER)), { localReminderIds: ['sched_3'], updatedAt: 1 }));
    await assertSucceeds(deleteDoc(doc(db, path(OWNER))));
  });

  // The one that actually matters: a push token is an address, so writing
  // into someone else's collection would be aiming notifications at their
  // phone.
  it('denies writing a token into another account', async () => {
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await assertFails(setDoc(doc(db, path(OWNER)), validToken()));
    await assertFails(getDoc(doc(db, path(OWNER))));
  });

  it('denies an unauthenticated write', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, path(OWNER)), validToken()));
  });

  it('rejects an unknown transport, an empty token, and an unknown field', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(setDoc(doc(db, path(OWNER)), { ...validToken(), transport: 'sms' }));
    await assertFails(setDoc(doc(db, path(OWNER)), { ...validToken(), token: '' }));
    await assertFails(setDoc(doc(db, path(OWNER)), { ...validToken(), uid: OTHER }));
  });

  // Bounds, so a token document can't be used as free storage. Both lists
  // are bounded, and independently: a device reports what it scheduled AND
  // what it silenced for quiet hours (functions/src/reminders.ts's
  // PushTokenDoc), so a rule that only capped the first would leave the
  // second as unbounded storage.
  it('rejects an over-long token and an over-long coverage list', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    const tooMany = Array.from({ length: 51 }, (_, i) => `sched_${i}`);
    await assertFails(setDoc(doc(db, path(OWNER)), { ...validToken(), token: 'x'.repeat(513) }));
    await assertFails(setDoc(doc(db, path(OWNER)), { ...validToken(), localReminderIds: tooMany }));
    await assertFails(setDoc(doc(db, path(OWNER)), { ...validToken(), suppressedReminderIds: tooMany }));
  });

  // The write the app actually makes after every reconcile: both lists at
  // once, on a document that already exists. Written together on purpose --
  // reporting one without the other describes a device that either silences
  // reminders it is showing, or shows ones it silenced.
  it('accepts a coverage report carrying both lists, and a token that omits them', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(setDoc(doc(db, path(OWNER)), validToken()));
    await assertSucceeds(
      updateDoc(doc(db, path(OWNER)), {
        localReminderIds: ['sched_3'],
        suppressedReminderIds: ['sched_4'],
        updatedAt: 2,
      }),
    );
    // Absent is legal, and means "silenced nothing" -- what a token document
    // written by an older client build looks like.
    const { suppressedReminderIds: _omitted, ...withoutSuppressed } = validToken();
    await assertSucceeds(setDoc(doc(db, path(OWNER, 'device-2')), withoutSuppressed));
  });

  // The same coverage write, against a device that never registered -- which
  // is not a hypothetical: it is every iOS build. plugins/
  // withoutPushEntitlement.js strips `aps-environment`, so
  // getExpoPushTokenAsync never mints a token, so registerPushToken never
  // writes a document, while local reminders (and therefore coverage
  // reports) keep working normally.
  //
  // setDoc(..., { merge: true }) is an UPSERT, not an update. Against a
  // document that does not exist it is evaluated as a CREATE carrying
  // exactly the merged fields -- here two coverage lists and an updatedAt,
  // with no `transport` and no `token`. The rule above then reads
  // request.resource.data.transport off a map that has no such key, which
  // RAISES rather than evaluating to false, and a rules error evaluates to
  // deny (the same trap settings/app's own comment records). So the write
  // cannot land; it can only cost a permission-denied round trip plus an SDK
  // console error, on every single reconcile, forever.
  //
  // This rule is NOT the thing to loosen. A pushTokens document with no
  // transport or token is an address the server cannot send to, so accepting
  // one would mean storing rows that can never do anything but cost reads.
  // The fix belongs on the client, which is why the second half of this test
  // matters as much as the first: the very same merge is legal the moment a
  // real token document exists, so all reportLocalCoverage has to know is
  // whether it does.
  it('denies a coverage-only merge that would have to create the document', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    const coverageOnly = {
      localReminderIds: ['sched_1'],
      suppressedReminderIds: ['sched_7'],
      updatedAt: 1_700_000_000_000,
    };
    await assertFails(
      setDoc(doc(db, path(OWNER, 'never-registered')), coverageOnly, { merge: true }),
    );
    await assertSucceeds(setDoc(doc(db, path(OWNER)), validToken()));
    await assertSucceeds(setDoc(doc(db, path(OWNER)), coverageOnly, { merge: true }));
  });
});

describe('users/{uid}/scheduledSessions/{planId}', () => {
  const path = (uid: string, id = 'sched_1') => `users/${uid}/scheduledSessions/${id}`;

  it('lets the owner create, read, edit and delete their own plan', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(setDoc(doc(db, path(OWNER)), validPlan()));
    await assertSucceeds(getDoc(doc(db, path(OWNER))));
    await assertSucceeds(updateDoc(doc(db, path(OWNER)), { time: '10:00', timeLabel: '10:00 AM', updatedAt: 2 }));
    await assertSucceeds(deleteDoc(doc(db, path(OWNER))));
  });

  it("denies reading or writing another account's plans", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), path(OWNER)), validPlan());
    });
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await assertFails(getDoc(doc(db, path(OWNER))));
    await assertFails(setDoc(doc(db, path(OWNER)), validPlan()));
    await assertFails(deleteDoc(doc(db, path(OWNER))));
  });

  // Editing a plan legitimately re-arms it, so a client CAN write
  // notifiedAt back to null -- that is not a hole, it is how a rescheduled
  // session gets a fresh reminder. What it may not do is write a shape the
  // backend would choke on.
  it('allows re-arming an already-sent plan, but not a bogus notifiedAt', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(setDoc(doc(db, path(OWNER)), { ...validPlan(), notifiedAt: 1_800_000_000_001 }));
    await assertSucceeds(updateDoc(doc(db, path(OWNER)), { notifiedAt: null, updatedAt: 3 }));
    await assertFails(updateDoc(doc(db, path(OWNER)), { notifiedAt: 'later', updatedAt: 4 }));
  });

  // fireAtMs is the only field the backend queries on, so its type is the
  // one that has to hold.
  it('rejects a malformed fireAtMs, date, or time', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(setDoc(doc(db, path(OWNER)), { ...validPlan(), fireAtMs: 'soon' }));
    await assertFails(setDoc(doc(db, path(OWNER)), { ...validPlan(), date: '1/9/2026' }));
    await assertFails(setDoc(doc(db, path(OWNER)), { ...validPlan(), time: '9:00' }));
  });

  it('rejects out-of-range and over-long fields', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(setDoc(doc(db, path(OWNER)), { ...validPlan(), leadMinutes: -1 }));
    await assertFails(setDoc(doc(db, path(OWNER)), { ...validPlan(), leadMinutes: 1441 }));
    await assertFails(setDoc(doc(db, path(OWNER)), { ...validPlan(), plannedS: 0 }));
    await assertFails(setDoc(doc(db, path(OWNER)), { ...validPlan(), note: 'x'.repeat(121) }));
    await assertFails(setDoc(doc(db, path(OWNER)), { ...validPlan(), topic: 'x'.repeat(201) }));
    // The notification body is built from timeLabel, so it is capped too.
    await assertFails(setDoc(doc(db, path(OWNER)), { ...validPlan(), timeLabel: 'x'.repeat(21) }));
  });

  it('rejects an unknown field smuggled in alongside valid ones', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(setDoc(doc(db, path(OWNER)), { ...validPlan(), uid: OTHER }));
    await assertFails(setDoc(doc(db, path(OWNER)), { ...validPlan(), priority: 'high' }));
  });

  it('denies an unauthenticated create', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, path(OWNER)), validPlan()));
  });
});
