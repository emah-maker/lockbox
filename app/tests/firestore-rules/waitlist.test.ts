// Regression suite for the waitlist rule (app/firestore.rules:196), the
// only unauthenticated write path in the whole rules file. See that rule's
// own comment block for the reasoning each test below is guarding against.
import { assertFails, assertSucceeds, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  collection,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { createRulesTestEnv } from './helpers';

let testEnv: RulesTestEnvironment;

// serverTimestamp() is the FieldValue sentinel that Firestore Rules
// resolves to request.time at commit -- a plain client Timestamp (even
// Timestamp.now()) never equals request.time exactly, so it's what the
// rule's createdAt == request.time check is actually testing for.
const validSignup = () => ({
  email: 'visitor@example.com',
  createdAt: serverTimestamp(),
  source: 'website',
});

beforeAll(async () => {
  testEnv = await createRulesTestEnv('waitlist');
});

afterEach(async () => {
  await testEnv?.clearFirestore();
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe('waitlist create', () => {
  it('allows an unauthenticated signup with exactly {email, createdAt, source}', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(setDoc(doc(db, 'waitlist/visitor1'), validSignup()));
  });

  it('denies a 4th field smuggled alongside the valid three (hasOnly allow-list)', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, 'waitlist/visitor2'), { ...validSignup(), utmSource: 'twitter' }),
    );
  });

  it('denies a client-forged/backdated createdAt (must equal request.time, not a client Timestamp)', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, 'waitlist/visitor3'), {
        email: 'visitor@example.com',
        createdAt: Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')),
        source: 'website',
      }),
    );
  });

  it('denies a malformed email', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, 'waitlist/visitor4'), { ...validSignup(), email: 'not-an-email' }),
    );
  });

  it('denies an email over the 254-char length cap', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const longLocalPart = 'a'.repeat(250); // + "@b.co" pushes this past 254 chars
    await assertFails(
      setDoc(doc(db, 'waitlist/visitor5'), { ...validSignup(), email: `${longLocalPart}@b.co` }),
    );
  });

  it('denies source other than "website"', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'waitlist/visitor6'), { ...validSignup(), source: 'app' }));
  });
});

describe('waitlist update -- the duplicate-signup rate limit', () => {
  it(
    'denies update on an existing waitlist doc: this IS the rate limit on repeat ' +
      'signups (the rule comment says DO NOT relax update -- script.js derives the ' +
      "doc ID from a SHA-256 of the email, so a repeat signup arrives as an update, " +
      'not a second create)',
    async () => {
      // Seed the doc the way a real first signup would leave it, bypassing
      // rules so the seed itself isn't what's under test here.
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'waitlist/repeat-signup'), {
          email: 'repeat@example.com',
          createdAt: Timestamp.now(),
          source: 'website',
        });
      });

      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(updateDoc(doc(db, 'waitlist/repeat-signup'), { source: 'website' }));
    },
  );
});

describe('waitlist read/delete', () => {
  it('denies read, even for a signed-in user', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'waitlist/somebody'), {
        email: 'somebody@example.com',
        createdAt: Timestamp.now(),
        source: 'website',
      });
    });

    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anonDb, 'waitlist/somebody')));

    const authedDb = testEnv.authenticatedContext('some-user').firestore();
    await assertFails(getDoc(doc(authedDb, 'waitlist/somebody')));
    await assertFails(getDocs(collection(authedDb, 'waitlist')));
  });

  it('denies delete', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'waitlist/deleteme'), {
        email: 'deleteme@example.com',
        createdAt: Timestamp.now(),
        source: 'website',
      });
    });

    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(deleteDoc(doc(db, 'waitlist/deleteme')));
  });
});
