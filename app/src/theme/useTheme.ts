// useTheme.ts -- resolves the persisted theme choice (useSettingsStore) into
// a concrete ThemeColors object for screens to render.
import { useSettingsStore } from '../store/useSettingsStore';
import { resolveTheme, ThemeColors } from './theme';

export function useTheme(): ThemeColors {
  const mode = useSettingsStore((s) => s.themeMode);
  const accent = useSettingsStore((s) => s.accent);
  return resolveTheme(mode, accent);
}
