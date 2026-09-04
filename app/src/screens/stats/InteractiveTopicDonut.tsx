// InteractiveTopicDonut.tsx -- a tappable variant of ui/TopicDonut.tsx for
// the Stats screen's "By topic" card: selecting a slice filters the whole
// screen to that topic (StatsScreen.tsx's `selectedTopic` state), tapping
// the selected slice again (or the "All" chip beside the card) clears the
// filter. Forked into this screen's own folder rather than adding an
// onPress prop to ui/TopicDonut.tsx -- that file is out of this task's
// ownership, and react-native-svg's shapes accept onPress natively, so
// duplicating the small per-segment arc-math here (unchanged from
// TopicDonut's own comment on the strokeDashoffset "growing arc" trick) is
// cheaper than threading a new prop through a file this task can't edit.
//
// A selected slice's arc gets a slightly larger stroke width so "which one
// is picked" reads at a glance even before a caption line confirms it;
// unselected slices dim toward the track color instead of disappearing, so
// the ring's overall proportions stay legible while one topic is singled
// out.
import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useReducedMotion } from '../../ui/useReducedMotion';
import { withAlpha } from '../../theme/color';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface DonutSegment {
  key: string;
  focusS: number;
  color: string;
}

export function InteractiveTopicDonut({
  segments,
  selectedKey,
  onSelect,
  size = 132,
  strokeWidth = 18,
}: {
  segments: DonutSegment[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  size?: number;
  strokeWidth?: number;
}) {
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const total = segments.reduce((sum, s) => sum + s.focusS, 0);

  const compositionKey = segments.map((s) => `${s.key}:${s.focusS}`).join('|');
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastKeyRef.current === compositionKey) return;
    lastKeyRef.current = compositionKey;
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [compositionKey, reducedMotion, progress]);

  if (total <= 0) return null;

  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;

  let cumBefore = 0;
  const arcs = segments.map((s) => {
    const segLen = (s.focusS / total) * circumference;
    const finalOffset = -cumBefore;
    const startOffset = finalOffset + segLen;
    cumBefore += segLen;
    return { key: s.key, color: s.color, segLen, finalOffset, startOffset };
  });

  const select = (key: string) => {
    Haptics.selectionAsync();
    onSelect(selectedKey === key ? null : key);
  };

  return (
    <Svg width={size} height={size}>
      <G rotation={-90} originX={cx} originY={cy}>
        {arcs.map((a) => {
          const dimmed = selectedKey !== null && selectedKey !== a.key;
          const active = selectedKey === a.key;
          return (
            <AnimatedCircle
              key={a.key}
              cx={cx}
              cy={cy}
              r={r}
              stroke={dimmed ? withAlpha(a.color, 0.25) : a.color}
              strokeWidth={active ? strokeWidth + 4 : strokeWidth}
              fill="none"
              strokeDasharray={`${a.segLen} ${circumference - a.segLen}`}
              strokeDashoffset={progress.interpolate({
                inputRange: [0, 1],
                outputRange: [a.startOffset, a.finalOffset],
              })}
              onPress={() => select(a.key)}
            />
          );
        })}
      </G>
    </Svg>
  );
}
