// Unit tests for the JSON storage wrapper's corrupt-value contract. Run with
// `npm test` (jest-expo); AsyncStorage is the package's own jest mock, wired
// up in jest.setup.js.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getJSON, setJSON } from './storage';

const PREFIX = 'phonebox:';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('getJSON', () => {
  it('round-trips a value through setJSON', async () => {
    await setJSON('k', { a: 1 });
    expect(await getJSON('k', {})).toEqual({ a: 1 });
  });

  it('returns the fallback for a missing key', async () => {
    expect(await getJSON('missing', 'default')).toBe('default');
  });

  it('returns the fallback for unparseable JSON', async () => {
    await AsyncStorage.setItem(`${PREFIX}k`, '{not json');
    expect(await getJSON('k', ['x'])).toEqual(['x']);
  });

  it('returns the fallback when the stored value parses to the wrong shape', async () => {
    // The half that used to slip through: `JSON.parse` succeeds, so the value
    // was cast to T and returned. A `sessionHistory` key holding a string
    // reached loadSessions as one and threw on `.filter`, inside a promise
    // nothing awaits -- so the app never finished initializing.
    await AsyncStorage.setItem(`${PREFIX}k`, JSON.stringify('a string'));
    expect(await getJSON<string[]>('k', [])).toEqual([]);

    await AsyncStorage.setItem(`${PREFIX}k`, JSON.stringify({ 0: 'a' }));
    expect(await getJSON<string[]>('k', [])).toEqual([]);

    await AsyncStorage.setItem(`${PREFIX}k`, JSON.stringify([1, 2]));
    expect(await getJSON('k', { a: 1 })).toEqual({ a: 1 });

    await AsyncStorage.setItem(`${PREFIX}k`, JSON.stringify('nope'));
    expect(await getJSON('k', true)).toBe(true);
  });

  it('accepts a stored null and any shape when the caller declared a nullable default', async () => {
    // These callers (lastDeviceId, lastSyncedAt) have no shape to compare
    // against, so the check deliberately opts out rather than guessing.
    await AsyncStorage.setItem(`${PREFIX}k`, JSON.stringify(null));
    expect(await getJSON<string | null>('k', null)).toBeNull();

    await AsyncStorage.setItem(`${PREFIX}k`, JSON.stringify('abc'));
    expect(await getJSON<string | null>('k', null)).toBe('abc');
  });

  it('keeps a legitimately empty array rather than confusing it with a missing key', async () => {
    await setJSON('k', []);
    expect(await getJSON('k', ['fallback'])).toEqual([]);
  });

  it('keeps a legitimate false/0, which a truthiness-based check would drop', async () => {
    await setJSON('flag', false);
    expect(await getJSON('flag', true)).toBe(false);
    await setJSON('n', 0);
    expect(await getJSON('n', 42)).toBe(0);
  });
});
