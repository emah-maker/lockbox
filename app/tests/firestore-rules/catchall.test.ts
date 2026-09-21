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
  await testEnv?.cleanup();
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

  // pushTickets is a real collection this backend writes to
  // (functions/src/index.ts's recordTickets), deliberately left OUT of the
  // rules: the admin SDK bypasses them, and no client has any business here.
  // Each document maps an Expo ticket id to the uid and push token it was
  // sent to, and a receipt against it can delete that token -- so a client
  // able to write one could aim a deletion at another account's device, and a
  // client able to read them could enumerate a user's push addresses. Pinned
  // as a test because "denied because nobody wrote a rule" is a guarantee
  // that a future rule added nearby could quietly withdraw.
  it('denies clients any access to the backend-only push ticket collection', async () => {
    const owner = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(getDoc(doc(owner, 'pushTickets/ticket-1')));
    await assertFails(setDoc(doc(owner, 'pushTickets/ticket-1'), { uid: 'user-a', token: 'x', tokenId: 'd', createdAt: 1 }));
    // Including one aimed at the writer's own uid, which is the shape a rule
    // written by analogy with the rest of this file might have allowed.
    await assertFails(setDoc(doc(owner, 'pushTickets/ticket-2'), { uid: 'user-b', token: 'x', tokenId: 'd', createdAt: 1 }));

    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'pushTickets/ticket-1')));
    await assertFails(setDoc(doc(anon, 'pushTickets/ticket-1'), { uid: 'user-a', token: 'x', tokenId: 'd', createdAt: 1 }));
  });
});
