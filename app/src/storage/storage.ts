// storage.ts -- thin JSON wrapper over AsyncStorage. Every persisted slice in
// the app (session history, theme choice, behaviors, last-known device) goes
// through this so there is one place that knows the key prefix and handles a
// corrupt/missing value the same way (fall back to the caller's default).
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'phonebox:';

/** The coarse runtime shape of a value, for the sanity check in getJSON.
 * Arrays are their own kind rather than 'object', which is the whole point --
 * `[]` and `{}` are the pair that actually get confused. */
function kindOf(v: unknown): string {
  if (v === null || v === undefined) return 'nullish';
  return Array.isArray(v) ? 'array' : typeof v;
}

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    // A value that parses but isn't the shape the caller asked for is corrupt
    // too, and this wrapper's whole job (see the header) is to hand back the
    // default for corrupt data. Only the unparseable half of that was handled:
    // `JSON.parse` succeeding meant the result was cast to T and returned
    // unchecked, so a `sessionHistory` key holding, say, a string reached
    // loadSessions as one and threw on `.filter` -- inside useStore.init()'s
    // Promise.all, which is fire-and-forget from App.tsx, so `initialized`
    // simply never flipped and the app sat on its loading state with an
    // unhandled rejection as the only trace.
    //
    // The check is deliberately coarse -- this wrapper is generic and cannot
    // know T's fields -- and it opts out entirely when the caller's default is
    // null/undefined, since those callers have declared a nullable T and there
    // is no shape to compare against. Per-slice field validation stays where
    // it already lives (sessionHistory's loadSessions, customLabels'
    // sanitizeCustomLabels, goalSanitize).
    const expected = kindOf(fallback);
    if (expected !== 'nullish' && kindOf(parsed) !== expected) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

export async function setJSON<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // best-effort: a failed write just means this value doesn't persist
  }
}
