// settingsWriteQueue.ts -- the single-writer queue that every write to
// users/{uid}/settings/app goes through.
//
// TWO INDEPENDENT WRITERS, ONE DOCUMENT. firestoreSync's syncSettingsTwoWay
// (the sign-in / Sync-now last-write-wins merge) and pushSettingsPatch (the
// per-mutation incremental push settingsSyncBridge fires) both rewrite the
// whole settings/app document, and neither knows the other exists. Before
// this file they could be in flight at the same time, each carrying a payload
// snapshotted at the moment it was issued, and the document was left holding
// whichever one the server happened to apply LAST.
//
// That is a real, if narrow, way to lose a setting. Sign in (or tap Sync
// now); while the merge's setDoc is still crossing the network, change the
// accent. The bridge pushes the new accent; the merge's older snapshot lands
// on top of it. This device still looks right -- the store and AsyncStorage
// were written first and nothing reverts them -- so nothing is visibly wrong
// here. The account, though, now holds the previous accent under a stale
// `updatedAt`, and that is what the user's other phone pulls down, and what
// this phone pulls back if it ever loses the race the other way (its own
// clock having moved on, it usually won't -- the loss just sits there until
// the next local settings change happens to rewrite the document).
//
// THE FIX IS TWO HALVES, and only one of them lives here.
//
//   1. Every writer builds its payload from LIVE store state inside the
//      callback below, not from a snapshot taken before its own await. That
//      is firestoreSync.pushLocalSettings' job, and it is what makes any two
//      queued writes interchangeable: they are all "write whatever this
//      device currently believes", never "write what I saw a moment ago".
//   2. This queue then guarantees they are not in flight at once, so the
//      LAST write to start is the one that read the newest state. Without it,
//      re-reading is not enough on its own: two writes issued microseconds
//      apart both read live state, but if the earlier one's snapshot is
//      older and the server applies it second, the stale bytes still win.
//
// COALESCING. Because of (1), a write that has not STARTED yet is fully
// interchangeable with any later one for the same account -- both will read
// the same live state when they run -- so a caller arriving while one is
// already waiting simply joins it instead of adding another round trip. A
// burst of rapid setting changes therefore costs at most two writes (the one
// in flight, plus one queued behind it) rather than one per keystroke. The
// `key` is what scopes that: writes only merge when they are for the same
// uid, so an account switch mid-queue can never have one account's write
// silently satisfy the other's.
//
// Deliberately free of any Firebase import -- firestoreSync.ts pulls in
// `firebase/firestore` and the whole native BLE store behind it, and this
// ordering logic is the part worth testing directly (settingsWriteQueue.test.ts).

/** The write currently queued but not yet started, if any. Only ever one:
 * see the coalescing note above. */
let pending: { key: string; promise: Promise<void> } | null = null;

/** Resolves when the most recently queued write has settled -- successfully
 * or not. Never rejects, so one failed write does not cancel the next. */
let tail: Promise<void> = Promise.resolve();

/**
 * Runs `write` once every settings write queued before it has settled.
 *
 * `write` MUST read the state it is about to send at call time, not close
 * over a snapshot from before its caller's awaits -- that is the half of the
 * fix this queue cannot enforce, and the half that makes coalescing sound.
 *
 * `key` identifies the account being written. Two calls with the same key
 * that are both still waiting collapse into one run; different keys always
 * get their own.
 *
 * The returned promise settles with the run that actually carried this
 * request -- which, when it coalesced, is a run someone else queued.
 */
export function queueSettingsWrite(key: string, write: () => Promise<void>): Promise<void> {
  if (pending && pending.key === key) return pending.promise;

  const slot: { key: string; promise: Promise<void> } = { key, promise: undefined as never };
  slot.promise = tail.then(() => {
    // Starting now, which means the read inside `write` is about to happen.
    // Anything arriving from here on could carry a change this run will not
    // see, so it must get a run of its own rather than joining this one.
    if (pending === slot) pending = null;
    return write();
  });
  pending = slot;
  // Swallow here rather than at the call site: `tail` is only ever used for
  // ordering, and an unhandled rejection would also surface twice (once to
  // the real caller, once here).
  tail = slot.promise.then(
    () => {},
    () => {},
  );
  return slot.promise;
}

/** Test-only: drop the queue's state between cases. */
export function resetSettingsWriteQueue(): void {
  pending = null;
  tail = Promise.resolve();
}
