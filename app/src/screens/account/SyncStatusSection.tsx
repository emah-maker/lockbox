// SyncStatusSection.tsx -- Account page's sync status (spec §2): a small
// "Synced Xm ago"/"Syncing..."/"Not synced yet" caption, the last sync
// error (if any), and the manual "Sync now" action. Moved out of the old
// (pre-restructure) AccountSection.tsx -- formatRelative itself moved to
// accountDisplay.ts so it's covered by that module's own unit tests instead
// of living untested inline in a UI file.
import { Text, StyleSheet } from 'react-native';
import { useAuthStore } from '../../auth/useAuthStore';
import { formatRelative } from '../../auth/accountDisplay';
import { useTheme } from '../../theme/useTheme';
import { Button, Row, Section, captionStyle } from '../SettingsPrimitives';

export function SyncStatusSection({ color }: { color: ReturnType<typeof useTheme> }) {
  const syncing = useAuthStore((s) => s.syncing);
  const syncError = useAuthStore((s) => s.syncError);
  const lastSyncedAt = useAuthStore((s) => s.lastSyncedAt);
  const syncNow = useAuthStore((s) => s.syncNow);

  const statusLabel = syncing ? 'Syncing...' : lastSyncedAt ? `Synced ${formatRelative(lastSyncedAt)}` : 'Not synced yet';

  return (
    <Section title="Sync" color={color}>
      <Row label="Status" color={color}>
        <Text style={[styles.subtitle, { color: color.textDim }]}>{statusLabel}</Text>
      </Row>
      {syncError ? <Text style={[styles.subtitle, { color: color.danger }]}>{syncError}</Text> : null}
      <Button
        label={syncing ? 'Syncing...' : 'Sync now'}
        onPress={syncNow}
        disabled={syncing}
        loading={syncing}
        color={color}
      />
    </Section>
  );
}

const styles = StyleSheet.create({ subtitle: captionStyle });
