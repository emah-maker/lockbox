// TotalFocusCard.tsx -- the "Total focus time" card, extracted verbatim
// (AnimatedTotal/MiniStat/StreakStat included) from StatsScreen.tsx so that
// file stays under this project's 500-line guideline as it grows the new
// interactive/goals work. No behavior change from the original: same
// minHeight reservation, same pop-on-change/pulse-on-new-streak animations,
// same reduced-motion gating.
import React, { useEffect, useRef } from 'react';
import { Animated, View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { formatDuration, completionRate, Stats } from '../../stats/stats';
import { getJSON, setJSON } from '../../storage/storage';
import { typeScale, elevation, springs } from '../../theme/tokens';

const BEST_STREAK_KEY = 'bestStreakSeen';

export function TotalFocusCard({
  stats,
  unwindowedStreak,
  reducedMotion,
}: {
  stats: Stats;
  unwindowedStreak: number;
  reducedMotion: boolean;
}) {
  const c = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: c.surface, minHeight: 150 }]}>
      <Text style={[styles.label, { color: c.textDim }]}>Total focus time</Text>
      <AnimatedTotal text={formatDuration(stats.foc)} color={c.accent} reducedMotion={reducedMotion} />
      <Text style={[styles.sub, { color: c.textDim }]}>
        across {stats.n} session{stats.n === 1 ? '' : 's'}
      </Text>
      {stats.n > 0 && (
        <View style={styles.miniRow}>
          <MiniStat label="Completed" value={`${completionRate(stats)}%`} color={c} />
          <StreakStat value={unwindowedStreak} color={c} reducedMotion={reducedMotion} />
          <MiniStat label="Longest" value={formatDuration(stats.lng)} color={c} />
        </View>
      )}
    </View>
  );
}

function AnimatedTotal({ text, color, reducedMotion }: { text: string; color: string; reducedMotion: boolean }) {
  const pop = useRef(new Animated.Value(1)).current;
  const prevText = useRef(text);

  useEffect(() => {
    if (prevText.current === text) return;
    prevText.current = text;
    if (reducedMotion) return;
    pop.setValue(0.92);
    Animated.spring(pop, { toValue: 1, ...springs.default, useNativeDriver: true }).start();
  }, [text, reducedMotion]);

  return <Animated.Text style={[styles.big, { color, transform: [{ scale: pop }] }]}>{text}</Animated.Text>;
}

function MiniStat({ label, value, color }: { label: string; value: string; color: ReturnType<typeof useTheme> }) {
  return (
    <View style={styles.miniStat}>
      <Text style={[styles.miniValue, { color: color.text }]}>{value}</Text>
      <Text style={[styles.miniLabel, { color: color.textDim }]}>{label}</Text>
    </View>
  );
}

function StreakStat({
  value,
  color,
  reducedMotion,
}: {
  value: number;
  color: ReturnType<typeof useTheme>;
  reducedMotion: boolean;
}) {
  const pulse = useRef(new Animated.Value(1)).current;
  const checkedValueRef = useRef<number | null>(null);

  useEffect(() => {
    if (value <= 0 || checkedValueRef.current === value) return;
    checkedValueRef.current = value;
    let cancelled = false;
    getJSON<number>(BEST_STREAK_KEY, 0).then((best) => {
      if (cancelled || value <= best) return;
      setJSON(BEST_STREAK_KEY, value);
      if (reducedMotion) return;
      pulse.setValue(1.4);
      Animated.spring(pulse, { toValue: 1, ...springs.default, useNativeDriver: true }).start();
    });
    return () => {
      cancelled = true;
    };
  }, [value, reducedMotion, pulse]);

  return (
    <View style={styles.miniStat}>
      <Animated.Text style={[styles.miniValue, { color: color.text, transform: [{ scale: pulse }] }]}>
        {value}
      </Animated.Text>
      <Text style={[styles.miniLabel, { color: color.textDim }]}>Streak</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 16, gap: 6, ...elevation.card },
  label: { fontSize: 13, letterSpacing: typeScale.label.letterSpacing, lineHeight: typeScale.label.lineHeight },
  big: { ...typeScale.display },
  sub: { ...typeScale.body },
  miniRow: { flexDirection: 'row', gap: 20, marginTop: 8 },
  miniStat: { alignItems: 'flex-start' },
  miniValue: { fontSize: 18, fontWeight: '700', letterSpacing: typeScale.sectionTitle.letterSpacing, lineHeight: 22 },
  miniLabel: { fontSize: 12, marginTop: 2, letterSpacing: typeScale.caption.letterSpacing, lineHeight: typeScale.caption.lineHeight },
});
