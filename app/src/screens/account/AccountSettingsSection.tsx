// AccountSettingsSection.tsx -- Account page's "Account settings" subsection
// (spec §3): the one real, wired setting this page has beyond identity/sync
// -- "Sync automatically" (useSettingsStore.autoSyncEnabled), a local-only
// per-device preference (see that store's own field comment for why it's
// deliberately not a SyncableSettings field). When off, useAuthStore.init's
// onAuthStateChanged handler skips its automatic syncNow() call; the manual
// "Sync now" button (SyncStatusSection, above this one on the page) is
// unaffected by this toggle either way.
import { Switch } from 'react-native';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTheme } from '../../theme/useTheme';
import { Row, Section } from '../SettingsPrimitives';

export function AccountSettingsSection({ color }: { color: ReturnType<typeof useTheme> }) {
  const autoSyncEnabled = useSettingsStore((s) => s.autoSyncEnabled);
  const setAutoSyncEnabled = useSettingsStore((s) => s.setAutoSyncEnabled);

  return (
    <Section title="Account settings" color={color}>
      <Row label="Sync automatically" color={color}>
        <Switch value={autoSyncEnabled} onValueChange={setAutoSyncEnabled} accessibilityLabel="Sync automatically" />
      </Row>
    </Section>
  );
}
