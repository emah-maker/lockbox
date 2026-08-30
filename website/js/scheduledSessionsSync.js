/* =========================================================================
   scheduledSessionsSync.js -- the Firestore read/write path for
   users/{uid}/scheduledSessions/{planId}.

   Split out of scheduledSessions.js so that module stays pure and therefore
   testable under `node --test` -- see its header. Mirrors the app's own
   schedule/ vs sync/ split. Everything here is I/O over shapes that module
   defines; nothing here decides anything.
   ========================================================================= */
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { fromRemote, toRemote } from './scheduledSessions.js';

/** Every plan for this user, malformed documents dropped. */
export async function loadScheduledSessions(db, uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'scheduledSessions'));
  return snap.docs.map((d) => fromRemote(d.id, d.data())).filter(Boolean);
}

/** Creates or replaces one plan. Whole-document writes, not merges: the
 * rules validate the complete shape (`hasOnly` plus per-field checks), and a
 * partial merge could leave a document that satisfies the rule on its own
 * delta while being incoherent overall. */
export async function writeScheduledSession(db, uid, plan) {
  await setDoc(doc(db, 'users', uid, 'scheduledSessions', plan.id), toRemote(plan));
}

export async function removeScheduledSession(db, uid, planId) {
  await deleteDoc(doc(db, 'users', uid, 'scheduledSessions', planId));
}
