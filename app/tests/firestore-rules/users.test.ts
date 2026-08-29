// Cross-user isolation for users/{uid} and its subcollections
// (app/firestore.rules:17-143). Every rule in this whole match block is
// gated on isOwner(uid); these tests are the regression guard that nobody
// ever loosens that gate to "any signed-in user" by accident.
import { assertFails, assertSucceeds, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { createRulesTestEnv } from './helpers';

let testEnv: RulesTestEnvironment;

const OWNER = 'user-a';
const OTHER = 'user-b';

beforeAll(async () => {
  testEnv = await createRulesTestEnv('users');
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

async function seedOwnerData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `users/${OWNER}`), {
      email: 'owner@example.com',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await setDoc(doc(db, `users/${OWNER}/sessions/session1`), {
      startedAt: 1000,
      plannedS: 1500,
      actualS: 1500,
      outcome: 'completed',
    });
    await setDoc(doc(db, `users/${OWNER}/settings/app`), {
      themeMode: 'dark',
      updatedAt: 1,
    });
    await setDoc(doc(db, `users/${OWNER}/goals/config`), {
      goals: [],
      updatedAt: 1,
    });
  });
}

describe('users/{uid} owner access', () => {
  it('allows the owner to create their own user doc', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(
      setDoc(doc(db, `users/${OWNER}`), {
        email: 'owner@example.com',
        createdAt: serverTimestamp(),
      }),
    );
  });

  it('allows the owner to read their own user doc', async () => {
    await seedOwnerData();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(getDoc(doc(db, `users/${OWNER}`)));
  });
});

describe('cross-user denial', () => {
  it('denies user B reading or writing users/{userA}', async () => {
    await seedOwnerData();
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await assertFails(getDoc(doc(db, `users/${OWNER}`)));
    await assertFails(updateDoc(doc(db, `users/${OWNER}`), { displayName: 'hijacked' }));
    await assertFails(deleteDoc(doc(db, `users/${OWNER}`)));
  });

  it('denies user B reading or writing users/{userA}/sessions/*', async () => {
    await seedOwnerData();
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await assertFails(getDoc(doc(db, `users/${OWNER}/sessions/session1`)));
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/sessions/session2`), {
        startedAt: 1,
        plannedS: 1,
        actualS: 1,
        outcome: 'completed',
      }),
    );
  });

  it('denies user B reading or writing users/{userA}/settings/app', async () => {
    await seedOwnerData();
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await assertFails(getDoc(doc(db, `users/${OWNER}/settings/app`)));
    await assertFails(updateDoc(doc(db, `users/${OWNER}/settings/app`), { themeMode: 'light' }));
  });

  it('denies user B reading or writing users/{userA}/goals/config', async () => {
    await seedOwnerData();
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await assertFails(getDoc(doc(db, `users/${OWNER}/goals/config`)));
    await assertFails(updateDoc(doc(db, `users/${OWNER}/goals/config`), { goals: [] }));
  });
});

describe('unauthenticated denial', () => {
  it('denies anonymous access to users/{uid} and every subcollection under it', async () => {
    await seedOwnerData();
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `users/${OWNER}`)));
    await assertFails(getDoc(doc(db, `users/${OWNER}/sessions/session1`)));
    await assertFails(getDoc(doc(db, `users/${OWNER}/settings/app`)));
    await assertFails(getDoc(doc(db, `users/${OWNER}/goals/config`)));
    await assertFails(setDoc(doc(db, `users/${OWNER}`), { email: 'x@example.com' }));
  });
});
