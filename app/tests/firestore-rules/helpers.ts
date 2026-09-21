// Shared Firestore Rules emulator harness for app/firestore.rules.
//
// Each *.test.ts file in this directory calls createRulesTestEnv(<suiteName>)
// in its own beforeAll/afterAll -- Jest runs test files in separate worker
// processes, so nothing here is actually shared across files at runtime; the
// per-suite name just keeps each file's emulator project distinct so two
// files running in parallel can't see each other's seeded documents.
//
// Requires the Firestore emulator already running on 127.0.0.1:8080 (port
// pinned in firebase.json's "emulators" block) -- this suite does not, and
// cannot, start the emulator itself. From the repo root:
//   npm run test:rules
import { readFileSync } from 'fs';
import { connect } from 'net';
import { resolve } from 'path';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';

// Every test here is a real round trip to an emulator process: connecting,
// seeding through withSecurityRulesDisabled, then asserting an allow/deny.
// Jest's 5s default is not a budget that survives a cold emulator, and the
// per-file beforeAll below is charged against it too. Set here rather than
// via a `testTimeout` in package.json's jest config, where it silently did
// nothing: `testTimeout` is absent from jest-config's initialProjectOptions
// schema, so inside a `projects` entry Jest rejects it as an unknown option
// (printing a validation warning on every run) and the suite kept the 5s
// default. Every file in this directory imports this module, so setting it
// at module scope covers all of them without a setup file that would exist
// only to hold this one line.
jest.setTimeout(20000);

const RULES_PATH = resolve(__dirname, '../../firestore.rules');

const HOST = '127.0.0.1';
const PORT = 8080;

// initializeTestEnvironment retries a closed port forever rather than
// rejecting, so without this the suite hangs until Jest's timeout and then
// afterAll throws "Cannot read properties of undefined (reading 'cleanup')"
// -- an error that says nothing about the actual cause. Probe the socket
// first so a missing emulator fails in milliseconds with the fix in hand.
async function assertEmulatorReachable(): Promise<void> {
  const reachable = await new Promise<boolean>((done) => {
    const socket = connect({ host: HOST, port: PORT });
    const settle = (ok: boolean) => {
      socket.destroy();
      done(ok);
    };
    socket.setTimeout(2000);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
  if (reachable) return;
  throw new Error(
    `No Firestore emulator on ${HOST}:${PORT}. This suite cannot start one itself. ` +
      'Run it through the emulator from the repo root: npm run test:rules',
  );
}

export async function createRulesTestEnv(suiteName: string): Promise<RulesTestEnvironment> {
  await assertEmulatorReachable();
  return initializeTestEnvironment({
    projectId: `phonebox-rules-test-${suiteName}`,
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
}
