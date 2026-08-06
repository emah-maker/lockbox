// storage.ts -- thin JSON wrapper over AsyncStorage. Every persisted slice in
// the app (session history, theme choice, behaviors, last-known device) goes
// through this so there is one place that knows the key prefix and handles a
// corrupt/missing value the same way (fall back to the caller's default).
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'phonebox:';

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
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
