// users/{uid}/sessions/{sessionId} (app/firestore.rules:29-64): create-only
// event-log fields, plus the one deliberate exception -- a scoped "topic"
// relabel -- and its diff().affectedKeys() guard against sneaking other
// field changes in alongside a legitimate relabel.
import { assertFails, assertSucceeds, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { createRulesTestEnv } from './helpers';

let testEnv: RulesTestEnvironment;

const OWNER = 'user-a';

const validSession = () => ({
  startedAt: 1_700_000_000,
  plannedS: 1500,
  actualS: 1480,
  outcome: 'completed',
});

beforeAll(async () => {
  testEnv = await createRulesTestEnv('sessions');
});

afterEach(async () => {
  await testEnv?.clearFirestore();
});

afterAll(async () => {
  await testEnv?.cleanup();
});

async function seedSession(id: string, extra: Record<string, unknown> = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `users/${OWNER}/sessions/${id}`), {
      ...validSession(),
      ...extra,
    });
  });
}

describe('sessions create', () => {
  it('allows a valid create', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(setDoc(doc(db, `users/${OWNER}/sessions/s1`), validSession()));
  });

  it('denies a topic over the 200-char cap (mirrors TopicPicker.tsx maxLength)', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/sessions/s2`), {
        ...validSession(),
        topic: 'x'.repeat(201),
      }),
    );
  });
});

describe('sessions update -- relabel-only', () => {
  it(
    'denies an update that touches startedAt/outcome alongside a legit topic edit ' +
      '(diff().affectedKeys() guard against smuggling event-log changes in with a relabel)',
    async () => {
      await seedSession('s3');
      const db = testEnv.authenticatedContext(OWNER).firestore();
      await assertFails(
        updateDoc(doc(db, `users/${OWNER}/sessions/s3`), {
          topic: 'Deep work',
          topicUpdatedAt: 2,
          outcome: 'overridden',
        }),
      );
    },
  );

  it('denies a topicUpdatedAt that does not strictly increase (stale-write guard)', async () => {
    await seedSession('s4', { topic: 'Old label', topicUpdatedAt: 5 });
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      updateDoc(doc(db, `users/${OWNER}/sessions/s4`), {
        topic: 'Stale label',
        topicUpdatedAt: 5,
      }),
    );
    await assertFails(
      updateDoc(doc(db, `users/${OWNER}/sessions/s4`), {
        topic: 'Older label',
        topicUpdatedAt: 4,
      }),
    );
  });

  it('allows a scoped topic-only relabel with a strictly increasing topicUpdatedAt', async () => {
    await seedSession('s5', { topic: 'Old label', topicUpdatedAt: 5 });
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(
      updateDoc(doc(db, `users/${OWNER}/sessions/s5`), {
        topic: 'New label',
        topicUpdatedAt: 6,
      }),
    );
  });
});

/** The parent users/{uid} doc is what gates session deletion, so these tests
 * control it directly rather than through the app's deletion flow. */
async function seedUserDoc() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `users/${OWNER}`), { email: 'a@example.com' });
  });
}

describe('sessions delete', () => {
  it('denies delete while the account exists -- relabel yes, erase no', async () => {
    await seedUserDoc();
    await seedSession('s6');
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(deleteDoc(doc(db, `users/${OWNER}/sessions/s6`)));
  });

  it('allows delete once the parent user doc is gone -- the account-deletion window', async () => {
    // No seedUserDoc(): absent parent is the state firestoreSync.ts's
    // deleteAllUserData creates by deleting users/{uid} before its sweep.
    await seedSession('s7');
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(deleteDoc(doc(db, `users/${OWNER}/sessions/s7`)));
  });

  it('still denies a stranger in that window', async () => {
    await seedSession('s8');
    const db = testEnv.authenticatedContext('user-b').firestore();
    await assertFails(deleteDoc(doc(db, `users/${OWNER}/sessions/s8`)));
  });

  it('sweeps a batch far larger than the 20-call access limit', async () => {
    // The rule calls exists() on users/{uid} per delete, and Firestore caps a
    // batched write at 20 document access calls. This passes only because all
    // of them hit the SAME path and cached accesses are not charged -- so the
    // real sweep costs one call, not one per session. If that ever stopped
    // being true the break would show up only on accounts with more than 20
    // sessions, i.e. exactly the long-standing users, and never in a small
    // fixture. 25 > 20 with room to spare.
    const ids = Array.from({ length: 25 }, (_, i) => `bulk-${i}`);
    for (const id of ids) await seedSession(id);

    const db = testEnv.authenticatedContext(OWNER).firestore();
    const batch = writeBatch(db);
    for (const id of ids) batch.delete(doc(db, `users/${OWNER}/sessions/${id}`));

    await assertSucceeds(batch.commit());
  });
});
