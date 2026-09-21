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
  await testEnv?.cleanup();
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
        excludedTopicKeys: [],
        updatedAt: 2,
      }),
    );
  });

  it('denies customLabels over the 40-entry cap', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/settings/app`), {
        customLabels: Array.from({ length: 41 }, (_, i) => ({ id: `l${i}`, name: `Label ${i}` })),
        excludedTopicKeys: [],
        updatedAt: 1,
      }),
    );
  });

  // customLabels.ts's sanitizeExcludedTopicKeys/MAX_EXCLUDED_TOPIC_KEYS
  // counterpart to the customLabels cap just above -- there are only ever six
  // built-in topics (topics.ts's TOPIC_KEYS) to exclude, so anything past
  // that count could only be a hostile or buggy write.
  it('denies excludedTopicKeys over the 6-entry cap', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/settings/app`), {
        customLabels: [],
        excludedTopicKeys: ['work', 'study', 'reading', 'creative', 'exercise', 'other', 'seventh'],
        updatedAt: 1,
      }),
    );
  });

  // Types, not values. Both clients write this document, so what one puts
  // here the other reads and renders -- and size() being defined on strings
  // meant `customLabels: 'xx'` satisfied the cap above and arrived at both
  // clients as a label catalog that isn't a list. Unrecognized VALUES are
  // deliberately still allowed (a new accent must not need a rules deploy);
  // they are handled on the way in, by theme.ts's normalizeThemeMode and
  // customLabels.ts's sanitizeCustomLabels.
  it('denies a settings document whose fields hold the wrong type', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    const valid = {
      themeMode: 'light',
      accent: 'sky',
      callAlertsEnabled: true,
      customLabels: [],
      excludedTopicKeys: [],
      updatedAt: 3,
    };
    await assertFails(setDoc(doc(db, `users/${OWNER}/settings/app`), { ...valid, customLabels: 'xx' }));
    await assertFails(setDoc(doc(db, `users/${OWNER}/settings/app`), { ...valid, excludedTopicKeys: 'work' }));
    await assertFails(setDoc(doc(db, `users/${OWNER}/settings/app`), { ...valid, themeMode: 7 }));
    await assertFails(setDoc(doc(db, `users/${OWNER}/settings/app`), { ...valid, accent: null }));
    await assertFails(setDoc(doc(db, `users/${OWNER}/settings/app`), { ...valid, callAlertsEnabled: 'yes' }));
    // An accent this build has never heard of is NOT rejected -- that is the
    // forward-compatibility the value checks are deliberately left out for.
    // Same forward-compatibility for an excludedTopicKeys entry this build
    // has never heard of -- unrecognized VALUES are handled on the way in by
    // customLabels.ts's sanitizeExcludedTopicKeys, not rejected by the rule.
    await assertSucceeds(setDoc(doc(db, `users/${OWNER}/settings/app`), { ...valid, accent: 'chartreuse' }));
    await assertSucceeds(setDoc(doc(db, `users/${OWNER}/settings/app`), { ...valid, excludedTopicKeys: ['not-a-real-topic'] }));
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
