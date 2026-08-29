// Deny-by-default catch-all (app/firestore.rules:209): anything not
// explicitly matched above -- any other top-level collection, any other
// user's uid path, any unauthenticated request -- must be denied. This is
// the backstop for every rule this suite doesn't otherwise cover.
import { assertFails, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { createRulesTestEnv } from './helpers';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await createRulesTestEnv('catchall');
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('deny-by-default', () => {
  it('denies read and write on an unmatched top-level collection, even for a signed-in user', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(getDoc(doc(db, 'analytics/summary')));
    await assertFails(setDoc(doc(db, 'analytics/summary'), { total: 1 }));
  });

  it('denies the same unmatched collection for an unauthenticated request', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'analytics/summary')));
    await assertFails(setDoc(doc(db, 'analytics/summary'), { total: 1 }));
  });
});
