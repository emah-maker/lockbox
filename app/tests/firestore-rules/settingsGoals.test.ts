// users/{uid}/settings/app and users/{uid}/goals/config
// (app/firestore.rules:66-138). Both docs split read from create/update/
// delete for the same reason, documented in both rule blocks: request.resource
// is null on delete, so a shape-validated condition on that verb always
// raises (and rules errors evaluate to deny). Two real bugs are the reason
// these tests exist: a combined read+write rule made getDoc() permission-
// denied for the owner (firestoreSync.ts's sync path), and a shape-validated
// delete condition made the doc permanently undeletable, breaking
// deleteAllUserData()'s account-deletion cleanup.
import { assertFails, assertSucceeds, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv } from './helpers';

let testEnv: RulesTestEnvironment;

const OWNER = 'user-a';

beforeAll(async () => {
  testEnv = await createRulesTestEnv('settings-goals');
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

async function seedSettings() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `users/${OWNER}/settings/app`), {
      themeMode: 'dark',
      updatedAt: 1,
    });
  });
}

async function seedGoalsConfig() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `users/${OWNER}/goals/config`), {
      goals: [],
      updatedAt: 1,
    });
  });
}

describe('settings/app', () => {
  it("allows the owner's read (regression guard: a combined read+write rule denied this)", async () => {
    await seedSettings();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(getDoc(doc(db, `users/${OWNER}/settings/app`)));
  });

  it('allows the owner to create/update with the field allow-list', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(
      setDoc(doc(db, `users/${OWNER}/settings/app`), {
        themeMode: 'light',
        accent: 'blue',
        callAlertsEnabled: true,
        customLabels: [],
        updatedAt: 2,
      }),
    );
  });

  it('denies customLabels over the 40-entry cap', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/settings/app`), {
        customLabels: Array.from({ length: 41 }, (_, i) => ({ id: `l${i}`, name: `Label ${i}` })),
        updatedAt: 1,
      }),
    );
  });

  it(
    "allows the owner's delete (regression guard: a shape-validated delete condition " +
      "made this doc undeletable and broke deleteAllUserData()'s account-deletion cleanup)",
    async () => {
      await seedSettings();
      const db = testEnv.authenticatedContext(OWNER).firestore();
      await assertSucceeds(deleteDoc(doc(db, `users/${OWNER}/settings/app`)));
    },
  );
});

describe('goals/config', () => {
  it("allows the owner's read (same read/write verb split as settings/app)", async () => {
    await seedGoalsConfig();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(getDoc(doc(db, `users/${OWNER}/goals/config`)));
  });

  it('allows the owner to create/update with the field allow-list', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(
      setDoc(doc(db, `users/${OWNER}/goals/config`), {
        goals: [{ id: 'goal:1', topic: 'Deep work' }],
        updatedAt: 2,
      }),
    );
  });

  it('denies more than 20 goals', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/goals/config`), {
        goals: Array.from({ length: 21 }, (_, i) => ({ id: `goal:${i}` })),
        updatedAt: 1,
      }),
    );
  });

  it(
    "allows the owner's delete (same account-deletion path as settings/app, " +
      'app/firestore.rules:137 -- delete kept as its own verb for the same reason)',
    async () => {
      await seedGoalsConfig();
      const db = testEnv.authenticatedContext(OWNER).firestore();
      await assertSucceeds(deleteDoc(doc(db, `users/${OWNER}/goals/config`)));
    },
  );
});
