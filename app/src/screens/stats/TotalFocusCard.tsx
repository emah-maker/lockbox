// TotalFocusCard.tsx -- the "Total focus time" card, extracted verbatim
// (AnimatedTotal/MiniStat/StreakStat included) from StatsScreen.tsx so that
// file stays under this project's 500-line guideline as it grows the new
// interactive/goals work.
//
// The mini-stats row (Completed/Streak/Longest) used to be conditionally
// MOUNTED only once `stats.n > 0` -- which is exactly the reported "Stats
// page is glitchy once a period has real focus time" bug: TrendCard and
// TopicCard below this one share a tightly-budgeted flex:1 region (see
// TrendCard's own header, "~185px total for both cards"), sized assuming
// this card's height stays put. Mounting an entire extra row the instant a
// period's focus time went from 0 to something real grew this card by
// ~25-30px right when Trend/Topic could least afford to give it up, which
// is what actually overflowed/clipped their bars and donut -- not a bad
// number anywhere, a layout budget quietly stolen by a sibling that was
// allowed to change size depending on the very data being displayed. Now
// always mounted (so this card's height is a constant, independent of
// `stats.n`) and merely made invisible via opacity when there's nothing to
// show -- same empty-state look as before, just reserved rather than
// removed, so switching between an empty and a real period never reflows
// anything below it.
import { useEffect, useRef } from 'react';
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
    <View style={[styles.card, { backgroundColor: c.surface, minHeight: 176 }]}>
      <Text style={[styles.label, { color: c.textDim }]}>Total focus time</Text>
      <AnimatedTotal text={formatDuration(stats.foc)} color={c.accent} reducedMotion={reducedMotion} />
      <Text style={[styles.sub, { color: c.textDim }]}>
        across {stats.n} session{stats.n === 1 ? '' : 's'}
      </Text>
      {/* Always mounted -- see header comment. Invisible (not absent) when
          there's nothing to show, so this row's height is reserved rather
          than the whole card growing the moment `stats.n` clears 0. */}
      <View style={[styles.miniRow, stats.n === 0 && styles.hidden]} pointerEvents={stats.n > 0 ? 'auto' : 'none'}>
        <MiniStat label="Completed" value={`${completionRate(stats)}%`} color={c} />
        <StreakStat value={unwindowedStreak} color={c} reducedMotion={reducedMotion} />
        <MiniStat label="Longest" value={formatDuration(stats.lng)} color={c} />
      </View>
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
  // opacity, not display:'none' -- the box still needs to occupy layout
  // space while hidden (see this file's header comment on why it's always
  // mounted); pointerEvents:'none' alongside it (set at the call site) keeps
  // an invisible StreakStat from swallowing a touch that lands on top of it.
  hidden: { opacity: 0 },
  miniStat: { alignItems: 'flex-start' },
  miniValue: { fontSize: 18, fontWeight: '700', letterSpacing: typeScale.sectionTitle.letterSpacing, lineHeight: 22 },
  miniLabel: { fontSize: 12, marginTop: 2, letterSpacing: typeScale.caption.letterSpacing, lineHeight: typeScale.caption.lineHeight },
});
