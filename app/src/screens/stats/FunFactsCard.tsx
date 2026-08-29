// FunFactsCard.tsx -- "Fun facts" card, extracted from StatsScreen.tsx (same
// 500-line-guideline split as the other screens/stats/*.tsx files) and
// trimmed to a fixed-height one-fact strip with a "More" sheet for the rest,
// instead of an unbounded inline list -- part of this task's "every period
// fits one screen with no scrolling" requirement (TOP_N used to render up to
// 5 comparison rows directly into the scroll; this then held 2 inline before
// the no-scroll layout's tighter per-card budget trimmed it to 1).
//
// Bug fix (Stats page glitching once a period has real focus time): this
// card used to mount an ENTIRELY different, taller subtree once `hasFocus`
// flipped true -- a highlighted "best day" callout box plus a fact row plus
// a "see more" link, in place of a single placeholder line -- which grew
// this card by ~70-90px exactly when TrendCard/TopicCard below it (sharing a
// tightly-budgeted flex:1 region, see TrendCard's own header) could least
// afford to give that space up. That state-dependent height swing, not any
// wrong number, is what actually overflowed/clipped the trend bars and topic
// donut once a period had logged sessions. Fixed the same way
// TotalFocusCard.tsx fixes its own analogous mini-stats row: the "best
// day"/fact/"see more" block is now ALWAYS mounted (hidden via opacity, not
// removed, when `!hasFocus`), and the two Texts that can vary in wrapped
// height (the best-day sentence, the fact sentence) are capped to one line
// -- so this card's height is a constant regardless of which period is
// selected, and Trend/Topic's shared budget never shrinks out from under
// them.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { withAlpha } from '../../theme/color';
import { formatDuration } from '../../stats/stats';
import { BestDay } from '../../stats/trend';
import { Comparison, formatComparison } from '../../stats/comparisons';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { elevation, hitSlop, typeScale } from '../../theme/tokens';
import { a11yHidden } from '../../ui/a11y';

const INLINE_COUNT = 1;

export function FunFactsCard({
  hasFocus,
  best,
  comparisons,
  onSeeMore,
}: {
  hasFocus: boolean;
  best: BestDay | null;
  comparisons: Comparison[];
  onSeeMore: () => void;
}) {
  const c = useTheme();
  const inline = comparisons.slice(0, INLINE_COUNT);
  const more = comparisons.length - inline.length;
  // Only ever used for sizing an invisible placeholder (see header comment)
  // -- never rendered while `!hasFocus`, so the exact date/duration here
  // doesn't matter, just that a best-day box of the right shape reserves the
  // right amount of height. `best` is otherwise always non-null whenever
  // `hasFocus` is true (any period with real focus time has a best day
  // somewhere in its own history), so this fallback is purely defensive.
  const bestOrPlaceholder = best ?? { dateMs: 0, focusS: 0 };

  return (
    <View style={[styles.card, { backgroundColor: c.surface, minHeight: 90 }]}>
      <Text style={[styles.h2, { color: c.text }]}>Fun facts</Text>
      {/* Always mounted, hidden via opacity rather than swapped out, so this
          card's height doesn't depend on whether the selected period has
          real focus time -- see header comment. */}
      {/* opacity:0 (see header) hides these from eyes but NOT from
          VoiceOver/TalkBack, which read both branches regardless -- so a
          period with no focus time announced the placeholder AND a best-day
          sentence built from `bestOrPlaceholder`, i.e. "Best day: Thu, Jan 1
          -- 0m." a11yHidden mutes whichever branch is
          currently invisible, without touching the layout-reserving trick
          this card depends on. */}
      <Text
        numberOfLines={1}
        style={[styles.sub, { color: c.textDim }, hasFocus && styles.hidden]}
        {...a11yHidden(hasFocus)}
      >
        Start a focus session to see how it stacks up.
      </Text>
      <View
        style={!hasFocus && styles.hidden}
        pointerEvents={hasFocus ? 'auto' : 'none'}
        {...a11yHidden(!hasFocus)}
      >
        <View style={[styles.bestDay, { backgroundColor: withAlpha(c.accent, 0.12) }]}>
          <Feather name="award" size={16} color={c.accent} />
          {/* "Best day:" rather than "Your best day was ... focused." -- the
              longer phrasing routinely pushed the actual date/duration (the
              one part of this sentence that's the whole point of it) past
              the numberOfLines={1} cutoff, so the value itself got
              truncated ("...7h 15...") instead of anything droppable. This
              card's height has to stay fixed (see header comment on why 2
              lines here isn't an option), so the fix is a shorter fixed
              prefix rather than a taller box. */}
          <Text numberOfLines={1} style={[styles.fact, styles.bestDayText, { color: c.text }]}>
            Best day:{' '}
            {new Date(bestOrPlaceholder.dateMs).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
            {' -- '}
            {formatDuration(bestOrPlaceholder.focusS)}
          </Text>
        </View>
        {inline.map((cmp) => (
          <View key={cmp.ref.key} style={styles.factRow}>
            <Feather name="zap" size={14} color={c.textDim} />
            <Text numberOfLines={1} style={[styles.fact, { color: c.text }]}>{formatComparison(cmp)}</Text>
          </View>
        ))}
        {more > 0 ? (
          <AnimatedPressable
            onPress={onSeeMore}
            accessibilityRole="button"
            accessibilityLabel={`See ${more} more fun facts`}
            hitSlop={hitSlop.text}
          >
            <Text style={[styles.more, { color: c.accent }]}>See {more} more</Text>
          </AnimatedPressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 12, gap: 6, ...elevation.card },
  h2: { ...typeScale.sectionTitle, marginBottom: 4 },
  sub: { ...typeScale.body },
  fact: { fontSize: 15, letterSpacing: typeScale.body.letterSpacing, lineHeight: typeScale.body.lineHeight, flex: 1 },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  bestDay: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, padding: 10, marginBottom: 6 },
  bestDayText: { fontWeight: '600' },
  more: { ...typeScale.label, marginTop: 4 },
  // opacity, not display:'none' -- see header comment on why the hidden
  // block still needs to occupy its layout space.
  hidden: { opacity: 0 },
});
