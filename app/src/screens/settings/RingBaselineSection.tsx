// RingBaselineSection.tsx -- the settings hub's "Focus ring" sheet: what the
// Home hero ring's idle arc measures. Originally just the best-day baseline
// window (still here, for the 'auto' source's fallback when no daily goal is
// set -- see screens/home/idleRingState.ts for that precedence rule and
// DashboardScreen.tsx for how the daily goal is resolved); extended here
// (manager brief: "more things you can put on the focus ring") with a ring
// SOURCE picker covering idleRingState.ts's full RingSourceKind set, plus a
// goal picker that only appears for the 'chosenGoal' source.
//
// SettingsScreen.tsx (which mounts this in a Sheet) only ever passes
// `color`/`ringBaselineWindow`/`setRingBaselineWindow` -- unchanged from
// before this extension, and deliberately left alone (SettingsScreen.tsx
// belongs to a different file's ownership than this one). The new source/
// goal state below is read straight from useSettingsStore/useGoalsStore
// inside this component instead of threading two more prop pairs through a
// parent this file can't touch -- same "a Section reads its own store slice"
// shape AccountSettingsSection.tsx and friends already use elsewhere in
// Settings, just not one this file itself had needed until now.
import { View, Text, StyleSheet, Switch } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useGoalsStore } from '../../store/useGoalsStore';
import { goalTopicLabel } from '../../goals/goalTopicDisplay';
import { Section, Row, rowLabelStyle, captionStyle } from '../SettingsPrimitives';
import { Chip } from './ChipPicker';
import {
  RingBaselineWindow,
  ringBaselineWindowLabel,
  RING_SOURCE_KINDS,
  ringSourceKindLabel,
} from '../home/idleRingState';

const WINDOWS: RingBaselineWindow[] = ['week', 'month', 'year', 'all'];
const WINDOW_CHIP_LABELS: Record<RingBaselineWindow, string> = {
  week: 'Week',
  month: 'Month',
  year: 'Year',
  all: 'All',
};

export function RingBaselineSection({
  color,
  ringBaselineWindow,
  setRingBaselineWindow,
}: {
  color: ReturnType<typeof useTheme>;
  ringBaselineWindow: RingBaselineWindow;
  setRingBaselineWindow: (w: RingBaselineWindow) => void;
}) {
  const ringSourceKind = useSettingsStore((s) => s.ringSourceKind);
  const setRingSourceKind = useSettingsStore((s) => s.setRingSourceKind);
  const ringGoalId = useSettingsStore((s) => s.ringGoalId);
  const setRingGoalId = useSettingsStore((s) => s.setRingGoalId);
  const customLabels = useSettingsStore((s) => s.customLabels);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const ringShowTopicMix = useSettingsStore((s) => s.ringShowTopicMix);
  const setRingShowTopicMix = useSettingsStore((s) => s.setRingShowTopicMix);
  const goals = useGoalsStore((s) => s.goals);
  const activeGoals = goals.filter((g) => !g.archived);
  // The two newest sources both read off the untopic'd DAILY goal -- 'pace'
  // needs its target to know what to expect by now, 'sessionCount' needs its
  // Goal.targetSessions. Neither invents a number when it's missing (see
  // idleRingSources.ts), so the ring would just sit empty; saying so here is
  // better than letting the user pick a source that silently shows nothing.
  const dailyGoal = activeGoals.find((g) => g.period === 'daily' && g.topic === null);

  return (
    <Section title="Focus ring" subtitle="What the Home ring fills toward while nothing is running" color={color}>
      <Text style={[styles.label, { color: color.textDim, marginBottom: 8 }]}>What should the ring show?</Text>
      <View style={styles.chipRow}>
        {RING_SOURCE_KINDS.map((k) => (
          <Chip key={k} active={ringSourceKind === k} onPress={() => setRingSourceKind(k)} color={color}>
            {ringSourceKindLabel(k)}
          </Chip>
        ))}
      </View>

      {ringSourceKind === 'auto' ? (
        <View>
          <Text style={[styles.label, { color: color.textDim, marginBottom: 8, marginTop: 4 }]}>
            With no daily goal set, compare today to your best day this...
          </Text>
          <View style={styles.chipRow}>
            {WINDOWS.map((w) => (
              <Chip key={w} active={ringBaselineWindow === w} onPress={() => setRingBaselineWindow(w)} color={color}>
                {WINDOW_CHIP_LABELS[w]}
              </Chip>
            ))}
          </View>
        </View>
      ) : null}

      {ringSourceKind === 'pace' && !dailyGoal ? (
        <Text style={[styles.hint, { color: color.textDim, marginTop: 4 }]}>
          Pace needs a daily goal for all focus time -- add one on the Stats tab and this will start filling.
        </Text>
      ) : null}

      {ringSourceKind === 'sessionCount' && !dailyGoal?.targetSessions ? (
        <Text style={[styles.hint, { color: color.textDim, marginTop: 4 }]}>
          Session count needs a daily goal with "Also track session count" turned on -- set that on the goal itself.
        </Text>
      ) : null}

      {ringSourceKind === 'chosenGoal' ? (
        activeGoals.length > 0 ? (
          <View>
            <Text style={[styles.label, { color: color.textDim, marginBottom: 8, marginTop: 4 }]}>Which goal?</Text>
            <View style={styles.chipRow}>
              {activeGoals.map((g) => (
                <Chip key={g.id} active={ringGoalId === g.id} onPress={() => setRingGoalId(g.id)} color={color}>
                  {goalTopicLabel(g.topic, customLabels, themeMode)}
                </Chip>
              ))}
            </View>
          </View>
        ) : (
          <Text style={[styles.hint, { color: color.textDim, marginTop: 4 }]}>
            Add a goal on the Stats tab first, then pick it here.
          </Text>
        )
      ) : null}
      <Row label="Show today's topic mix" color={color}>
        <Switch
          value={ringShowTopicMix}
          onValueChange={setRingShowTopicMix}
          accessibilityLabel="Show today's topic mix on the ring"
        />
      </Row>
      <Text style={[styles.hint, { color: color.textDim }]}>
        Draws a second, thinner arc inside the ring, split by what today's focus time was actually spent on. It's
        independent of the choice above -- the mix answers a different question from whatever the outer ring measures.
      </Text>
    </Section>
  );
}

/** One-line hub summary for the Focus ring row -- deliberately still just the
 * baseline-window phrasing regardless of the actual ringSourceKind:
 * SettingsScreen.tsx's hub row calls this with only `w` (its own call site
 * predates the source picker and is out of this file's ownership to change),
 * so this keeps that exact one-argument signature working rather than
 * silently going stale for one source while describing another incorrectly.
 * The sheet this opens (above) always shows the real, current state. */
export function ringBaselineSummary(w: RingBaselineWindow): string {
  return `Best day ${ringBaselineWindowLabel(w)}`;
}

const styles = StyleSheet.create({
  label: rowLabelStyle,
  hint: captionStyle,
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
