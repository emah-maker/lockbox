#!/usr/bin/env node
// seed-demo-account.js -- creates and populates the account Apple's reviewers
// sign in with during Beta App Review.
//
// Guideline 2.1 requires demo account info for any app with a login, and an
// EMPTY demo account is the most common way that requirement is failed: an app
// with no stats, no goals, no calendar history and no box to connect to reads
// as incomplete. The seeded data (scripts/lib/demo-seed-data.js) is what makes
// this app demonstrable on a device that has no Phone Box hardware.
//
// See docs/handoff/testflight-demo-account-handoff.md and
// docs/app-store/testflight-external-testing.md. This is a committed,
// re-runnable script rather than a hand-clicked setup because Guideline
// 5.1.1(v) means the reviewer may test account deletion -- which permanently
// destroys this account, so the next submission round needs a fresh one.
//
// NO CREDENTIALS IN THIS FILE, EVER. They come from PHONEBOX_DEMO_EMAIL /
// PHONEBOX_DEMO_PASSWORD or an interactive prompt.
//
//   node scripts/seed-demo-account.js --dry-run   # print the plan, write nothing
//   node scripts/seed-demo-account.js --create    # create the auth user, then seed
//   node scripts/seed-demo-account.js             # sign in to an existing one, then seed
//
// Set FIREBASE_AUTH_EMULATOR_HOST + FIRESTORE_EMULATOR_HOST to rehearse
// against the emulators instead of the real project. Worth doing before any
// change to the payloads, because a session document can never be deleted
// (firestore.rules' sessions block ends `allow delete: if false`) -- a
// malformed seed is permanent for that account. The command is in
// docs/app-store/testflight-external-testing.md.
//
// WHY THE CLIENT SDK, NOT THE ADMIN SDK: this signs in as the demo user and
// writes THROUGH app/firestore.rules rather than around them, so a seed that
// succeeds proves the shape is one a real client could have produced. It also
// needs no service-account key -- app/.env's EXPO_PUBLIC_FIREBASE_* values are
// the same public project identifiers the shipped app already carries.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import {
  DISPLAY_NAME,
  DEVICE_ID,
  LABELS,
  buildGoals,
  buildPlans,
  buildSessions,
  buildSettings,
  dayKey,
  goalProgressReport,
  sessionDocId,
} from './lib/demo-seed-data.js';

const APP_DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'app');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run') || args.has('-n');
const CREATE = args.has('--create');
for (const a of args) {
  if (!['--dry-run', '-n', '--create'].includes(a)) {
    console.error(`Unknown flag: ${a} -- see the usage block at the top of this file.`);
    process.exit(2);
  }
}

// -- Firebase config -------------------------------------------------------

/** Minimal KEY=VALUE reader for app/.env -- not a dotenv clone, it only has to
 * read the EXPO_PUBLIC_FIREBASE_* lines this repo writes there. An ambient
 * environment variable always wins, so CI (or an emulator run) can supply
 * them without a file. */
function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    const eq = line.indexOf('=');
    if (!line || line.startsWith('#') || eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] === undefined) {
      process.env[key] = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}
loadDotEnv(join(APP_DIR, '.env'));

// Mirrors app/src/auth/firebaseConfig.ts, minus storageBucket and
// messagingSenderId -- nothing here touches Storage or messaging.
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};
const missingConfig = Object.entries(firebaseConfig)
  .filter(([, v]) => !v || String(v).startsWith('REPLACE_ME'))
  .map(([k]) => k);
if (missingConfig.length && !DRY_RUN) {
  console.error(
    `Firebase config is incomplete (${missingConfig.join(', ')}).\n` +
      'Fill in app/.env from Firebase console -> Project settings -> General -> Your apps.',
  );
  process.exit(1);
}

// -- Credentials -----------------------------------------------------------

function prompt(question, { hidden = false } = {}) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // readline echoes as it writes; swallow everything but the question
      // itself so the password never reaches a scrollback buffer or a CI log.
      const write = rl._writeToOutput?.bind(rl);
      rl._writeToOutput = (s) => {
        if (s.includes(question)) write?.(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      res(answer.trim());
    });
  });
}

async function readCredentials() {
  const email = process.env.PHONEBOX_DEMO_EMAIL || (await prompt('Demo account email: '));
  const password =
    process.env.PHONEBOX_DEMO_PASSWORD || (await prompt('Demo account password: ', { hidden: true }));
  if (!email || !password) {
    console.error('Both an email and a password are required.');
    process.exit(1);
  }
  // MIN_PASSWORD_LENGTH in screens/account/EmailPasswordFields.tsx, enforced
  // client-side before Firebase ever sees it -- a shorter password would be
  // created here and then refused by the app's own sign-in form, which is a
  // uniquely confusing way for this to fail.
  if (password.length < 6) {
    console.error('Password must be at least 6 characters (the app enforces this client-side).');
    process.exit(1);
  }
  return { email, password };
}

// -- Plan --------------------------------------------------------------------

/** Prints what will be written, and asserts the one property a reviewer's
 * screen depends on. Runs for --dry-run and for a real seed alike. */
function reportPlan(email, { sessions, plans, progress }) {
  const days = new Set(sessions.map((s) => dayKey(s.startedAt)));
  const hours = (sessions.reduce((n, s) => n + s.actualS, 0) / 3600).toFixed(1);
  const fmt = (s) => `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;

  console.log(`\nPlan for ${email}:`);
  console.log(`  sessions        ${sessions.length} across ${days.size} days (${hours}h total)`);
  console.log(`  custom labels   ${LABELS.map((l) => l.name).join(', ')}`);
  console.log(`  planned         ${plans.map((p) => `${p.date} ${p.plan.time}`).join(', ')}`);
  console.log(`  device id       ${DEVICE_ID}`);
  console.log('  goals');
  for (const g of progress) {
    const state = g.met ? 'MET        ' : 'in progress';
    const name = g.id.replace('goal:demo-', '').padEnd(16);
    console.log(`    ${state} ${name} ${g.period.padEnd(7)} ${fmt(g.doneS)} / ${fmt(g.targetS)}`);
  }
  // The handoff's bar: a reviewer must see at least one goal already met and
  // one still in progress, or the goal ring and streak surfaces read as either
  // empty or finished. Both targets are derived from the seeded history, so
  // this can only fail when today is genuinely still empty -- which is worth
  // saying out loud rather than shipping quietly.
  if (!progress.some((g) => g.met)) {
    console.warn('  WARNING: no goal is met. Re-run later today, once more of the day has elapsed.');
  }
  if (!progress.some((g) => !g.met)) {
    console.warn('  WARNING: every goal is met, so nothing shows partial progress.');
  }
}

// -- Write -------------------------------------------------------------------

async function main() {
  const { email, password } = await readCredentials();
  const nowMs = Date.now();

  const sessions = buildSessions(nowMs);
  const goals = buildGoals(sessions, nowMs);
  const plans = buildPlans(nowMs);
  const progress = goalProgressReport(goals, sessions, nowMs);
  reportPlan(email, { sessions, plans, progress });

  if (DRY_RUN) {
    console.log('\n--dry-run: nothing written.\n');
    return;
  }

  // Resolved out of app/node_modules: this script has no dependencies of its
  // own, and the repo root deliberately has none (its package.json is a test
  // harness, not a build target). Same `firebase` 10.x the app is pinned to.
  const appRequire = createRequire(join(APP_DIR, 'package.json'));
  const { initializeApp } = appRequire('firebase/app');
  const auth = appRequire('firebase/auth');
  const fs = appRequire('firebase/firestore');

  const app = initializeApp(firebaseConfig);
  const authInstance = auth.getAuth(app);
  const db = fs.getFirestore(app);
  // Unlike the Admin SDK, the client SDK does not read these variables itself.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    auth.connectAuthEmulator(authInstance, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, {
      disableWarnings: true,
    });
  }
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    fs.connectFirestoreEmulator(db, host, Number(port));
  }

  const cred = await signIn(auth, authInstance, email, password);
  const uid = cred.user.uid;
  console.log(`  uid ${uid}`);
  if (cred.user.displayName !== DISPLAY_NAME) {
    await auth.updateProfile(cred.user, { displayName: DISPLAY_NAME });
  }

  await writeProfile(fs, db, uid, email);
  await writeSessions(fs, db, uid, sessions);

  await fs.setDoc(fs.doc(db, 'users', uid, 'settings', 'app'), buildSettings(nowMs));
  console.log('  settings/app written');

  await fs.setDoc(fs.doc(db, 'users', uid, 'goals', 'config'), { goals, updatedAt: nowMs });
  console.log('  goals/config written');

  await writePlans(fs, db, uid, plans, nowMs);

  await auth.signOut(authInstance).catch(() => {});
  await fs.terminate(db).catch(() => {});
  console.log('\nDone. Verify on a clean install before submitting the build.\n');
}

async function signIn(auth, authInstance, email, password) {
  if (!CREATE) {
    const cred = await auth.signInWithEmailAndPassword(authInstance, email, password).catch((e) => {
      throw describeAuthError(e);
    });
    console.log('\nSigned in.');
    return cred;
  }
  try {
    const cred = await auth.createUserWithEmailAndPassword(authInstance, email, password);
    console.log('\nCreated the auth user.');
    return cred;
  } catch (e) {
    // Not an error worth stopping for: --create is also how you re-seed an
    // account you already made, so fall through to signing in.
    if (e?.code !== 'auth/email-already-in-use') throw describeAuthError(e);
    const cred = await auth.signInWithEmailAndPassword(authInstance, email, password).catch((e2) => {
      throw describeAuthError(e2);
    });
    console.log('\nAccount already existed; signed in instead.');
    return cred;
  }
}

/** users/{uid}, whose rule pins createdAt to request.time on create and to its
 * existing value on update -- so these are genuinely two different writes
 * rather than one idempotent set(). Fields are limited to the rule's own
 * allow-list: email, displayName, photoURL, createdAt, updatedAt. */
async function writeProfile(fs, db, uid, email) {
  const ref = fs.doc(db, 'users', uid);
  const snap = await fs.getDoc(ref);
  await fs.setDoc(ref, {
    email,
    displayName: DISPLAY_NAME,
    photoURL: null,
    createdAt: snap.exists() ? snap.data().createdAt : fs.serverTimestamp(),
    updatedAt: fs.serverTimestamp(),
  });
  console.log(`  users/${uid} ${snap.exists() ? 'updated' : 'created'}`);
}

/**
 * Writes only the sessions that are not already there, and that is a
 * correctness requirement rather than an optimization.
 *
 * firestore.rules allows `update` on a session document for `topic` and
 * `topicUpdatedAt` only, and requires topicUpdatedAt to STRICTLY INCREASE (it
 * is what stops a client replaying a stale relabel over a newer one). So
 * re-setting a byte-identical record is rejected outright, not a harmless
 * no-op -- and since `allow delete: if false`, there is no cleaning up after
 * getting this wrong.
 */
async function writeSessions(fs, db, uid, sessions) {
  const existing = new Set(
    (await fs.getDocs(fs.collection(db, 'users', uid, 'sessions'))).docs.map((d) => d.id),
  );
  const toWrite = sessions.filter((s) => !existing.has(sessionDocId(s)));
  // Firestore batches cap at 500 writes; chunk defensively.
  for (let i = 0; i < toWrite.length; i += 400) {
    const batch = fs.writeBatch(db);
    for (const s of toWrite.slice(i, i + 400)) {
      batch.set(fs.doc(db, 'users', uid, 'sessions', sessionDocId(s)), s);
    }
    await batch.commit();
  }
  console.log(`  sessions ${toWrite.length} written, ${existing.size} already present`);
}

/** The planned sessions, plus a sweep of the demo plans an earlier run left
 * behind whose day has passed. Unlike sessions, scheduledSessions ARE
 * deletable, so this collection can stay tidy across re-runs instead of
 * showing the reviewer stale rows. Scoped to the `sched_demo_` prefix so it
 * can never touch a plan created in the app. */
async function writePlans(fs, db, uid, plans, nowMs) {
  const col = fs.collection(db, 'users', uid, 'scheduledSessions');
  const batch = fs.writeBatch(db);
  for (const { id, plan } of plans) batch.set(fs.doc(col, id), plan);
  const todayKey = dayKey(nowMs);
  const stale = (await fs.getDocs(col)).docs.filter(
    (d) => d.id.startsWith('sched_demo_') && String(d.data().date ?? '') < todayKey,
  );
  for (const d of stale) batch.delete(d.ref);
  await batch.commit();
  console.log(`  scheduledSessions ${plans.length} written, ${stale.length} stale removed`);
}

/**
 * Firebase Auth error -> something actionable.
 *
 * auth/invalid-credential deliberately does not distinguish a wrong password
 * from a nonexistent account: Email Enumeration Protection is enabled on this
 * project (see app/src/auth/emailAuth.ts's signInWithEmail). Do not try to
 * infer which one happened from the code -- you will conclude the wrong thing.
 */
function describeAuthError(e) {
  const code = e?.code ?? '';
  if (code === 'auth/invalid-credential') {
    return new Error(
      'auth/invalid-credential -- either the password is wrong OR no account exists for that email.\n' +
        'Email Enumeration Protection makes those two indistinguishable by design.\n' +
        'Pass --create to create the account if you believe it does not exist yet.',
    );
  }
  if (code === 'auth/operation-not-allowed') {
    return new Error(
      'auth/operation-not-allowed -- Email/Password is not enabled for this project.\n' +
        'Turn it on: Firebase console -> Authentication -> Sign-in method -> Email/Password.',
    );
  }
  if (code === 'auth/weak-password') {
    return new Error('auth/weak-password -- Firebase wants at least 6 characters.');
  }
  return e instanceof Error ? e : new Error(String(e));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`\n${e?.message ?? e}\n`);
    process.exit(1);
  },
);
