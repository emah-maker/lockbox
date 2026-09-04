// RecentSessionsRow.tsx -- the horizontal "jump to a recent session" strip
// above the month grid. Extracted verbatim out of CalendarScreen.tsx (see
// this project's 500-line file guideline) with no behavior change.
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { AnimatedPressable } from '../AnimatedPressable';
import { ThemeColors } from '../../theme/theme';
import { typeScale } from '../../theme/tokens';
import { formatDuration } from '../../stats/stats';
import { dayKey, LoggedSession } from '../../stats/sessionHistory';
import { resolveTopic } from '../../stats/customLabels';
import { useSettingsStore } from '../../store/useSettingsStore';

export function RecentSessionsRow({
  sessions,
  selectedKey,
  theme,
  customLabels,
  themeMode,
  onSelect,
}: {
  sessions: LoggedSession[];
  selectedKey: string;
  theme: ThemeColors;
  customLabels: ReturnType<typeof useSettingsStore.getState>['customLabels'];
  themeMode: ReturnType<typeof useSettingsStore.getState>['themeMode'];
  onSelect: (session: LoggedSession) => void;
}) {
  if (sessions.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={[styles.h2, { color: theme.text }]}>Recent sessions</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {sessions.map((sess) => {
          const resolved = resolveTopic(sess.topic, customLabels, themeMode);
          const active = dayKey(sess.startedAt) === selectedKey;
          const started = new Date(sess.startedAt);
          return (
            <AnimatedPressable
              key={`${sess.startedAt}:${sess.plannedS}`}
              accessibilityRole="button"
              // Spelled out rather than left to RN's collect-the-child-Text
              // default, which would read the abbreviated "Aug 3" / "45m"
              // pair with no indication of what either number means. The
              // active chip is marked visually by a border only, so
              // `selected` is the sole a11y signal for it.
              accessibilityLabel={`${started.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}, ${formatDuration(sess.actualS)} focused${resolved ? `, ${resolved.label}` : ''}`}
              accessibilityState={{ selected: active }}
              style={[
                styles.chip,
                { backgroundColor: theme.surface },
                active && { borderColor: theme.accent, borderWidth: 1.5 },
              ]}
              onPress={() => onSelect(sess)}
            >
              <View style={styles.chipTop}>
                {resolved && <View style={[styles.dotInline, { backgroundColor: resolved.color }]} />}
                <Text style={[styles.chipDate, { color: theme.text }]}>
                  {new Date(sess.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </Text>
              </View>
              <Text style={[styles.chipDuration, { color: theme.textDim }]}>{formatDuration(sess.actualS)}</Text>
            </AnimatedPressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 4 },
  h2: { ...typeScale.sectionTitle, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, paddingRight: 4 },
  chip: { borderRadius: 12, borderWidth: 1.5, borderColor: 'transparent', padding: 10, minWidth: 84 },
  chipTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  chipDate: { fontSize: 13, fontWeight: '600', letterSpacing: typeScale.label.letterSpacing },
  chipDuration: { fontSize: 12, marginTop: 2, letterSpacing: typeScale.caption.letterSpacing },
  dotInline: { width: 8, height: 8, borderRadius: 4 },
});
