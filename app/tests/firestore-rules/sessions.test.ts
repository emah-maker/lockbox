// users/{uid}/sessions/{sessionId} (app/firestore.rules:29-64): create-only
// event-log fields, plus the one deliberate exception -- a scoped "topic"
// relabel -- and its diff().affectedKeys() guard against sneaking other
// field changes in alongside a legitimate relabel.
import { assertFails, assertSucceeds, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
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
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
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

describe('sessions delete', () => {
  it('denies delete unconditionally -- a session can be relabeled, never erased', async () => {
    await seedSession('s6');
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(deleteDoc(doc(db, `users/${OWNER}/sessions/s6`)));
  });
});
