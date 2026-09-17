// index.test.ts -- the entry point must LOAD. Not a behaviour test: the only
// question asked here is whether requiring this module in a cold process gets
// all the way through its body without throwing.
//
// That question has teeth because of how this backend ships. `firebase deploy
// --only functions` discovers WHAT to deploy by loading lib/index.js in a bare
// node process and reading its exports, and every cold start loads it the same
// way. So a single throwing statement at module scope does not break one job,
// it means none of the three exist -- and it happens at deploy time, with
// nothing wrong in any handler and no way to tell from the handler code which
// line did it.
//
// The specific failure this exists to catch is an ordering one, which is the
// kind nothing else here can see. pushReceipts.ts held a module-scope
// `const db = getFirestore()`; index.ts imports that file above its own
// `initializeApp()` call, and an import runs the imported module's body to
// completion before any of the importing module's own statements -- so the
// handle was built against an app that did not exist yet. `tsc` is perfectly
// happy, because the ordering is a runtime fact and not a type; and no other
// test imported pushReceipts.ts, so the suite stayed green while nothing could
// be deployed at all. Hence a test whose entire job is to require the thing.
//
// Importing the TypeScript source rather than the built lib/index.js is
// deliberate. ts-jest emits the same commonjs requires in the same order tsc
// does, so the ordering is reproduced faithfully, and the test does not
// silently depend on a build having been run first -- lib/ is gitignored, so
// on a fresh clone there would be nothing there to require and the check would
// quietly become a no-op.
describe('the functions entry point', () => {
  it('loads without a firebase initialization error', () => {
    // `require` inside the assertion rather than an import at the top of the
    // file, so a throw is reported as THIS expectation failing with the
    // firebase error attached, rather than as an opaque "test suite failed to
    // run" that names no rule.
    expect(() => require('./index')).not.toThrow();
  });

  it('exports every job firebase is meant to deploy', () => {
    // Firebase deploys by exported NAME, so a job that stops being exported
    // stops existing in production while everything still compiles and every
    // other test still passes -- the hazard index.ts's own header calls out
    // about the collectPushReceipts re-export. Checking the exact set also
    // catches the opposite mistake, a helper accidentally exported from here
    // and deployed as a function of its own.
    const entry = require('./index');
    expect(Object.keys(entry).sort()).toEqual([
      'collectPushReceipts',
      'pruneOldReminders',
      'sendDueReminders',
    ]);
  });
});
