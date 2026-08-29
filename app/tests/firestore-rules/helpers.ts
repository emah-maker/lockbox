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
//   firebase emulators:exec --only firestore "npm --prefix app test -- tests/firestore-rules"
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';

const RULES_PATH = resolve(__dirname, '../../firestore.rules');

export async function createRulesTestEnv(suiteName: string): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: `phonebox-rules-test-${suiteName}`,
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
}
