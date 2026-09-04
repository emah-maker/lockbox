// goalTopicWiring.daySheetRetag.test.tsx -- component-level regression check
// for the user report "goals do not update with the topic": retagging a past
// session from Calendar's DaySheet (calendar/DaySheet.tsx) -> LabelPickerSheet
// must move a topic-scoped goal's rendered progress, not merely the
// underlying array reference.
//
// Drives the REAL DaySheet + LabelPickerSheet it renders, through
// react-test-renderer -- not applyTopicUpdate/computeGoalProgress directly
// (already unit-tested and verified correct elsewhere: see this repo's
// goalProgress.ts/sessionHistory.ts test files). `sessions`/`goals`/
// `customLabels`/`excludedTopicKeys` are held in a single parent component's
// state/module scope, the same stable-reference discipline
// home/useHomeGoalRing.test.tsx documents -- an inline `[]`/`[goal]` literal
// recreated every render would mask exactly the class of wiring bug this
// file is hunting.
import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DaySheet } from './calendar/DaySheet';
import { applyTopicUpdate, dayKey, LoggedSession } from '../stats/sessionHistory';
import { computeGoalProgress } from '../goals/goalProgress';
import type { Goal } from '../goals/goals';
import { resolveTheme } from '../theme/theme';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
// Same stand-in GoalForm.test.tsx uses -- an opaque leaf as far as this test
// is concerned, and jest-expo's font-loaded check trips over the real
// @expo/vector-icons module outside a native runtime.
jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather', Ionicons: 'Ionicons', MaterialIcons: 'MaterialIcons' }));

const theme = resolveTheme('dark', 'mint');
const SAFE_AREA_FRAME = { x: 0, y: 0, width: 320, height: 640 };
const SAFE_AREA_INSETS = { top: 0, left: 0, right: 0, bottom: 0 };

const mounted: TestRenderer.ReactTestRenderer[] = [];
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  act(() => {
    mounted.forEach((t) => t.unmount());
  });
  mounted.length = 0;
  jest.clearAllTimers();
  jest.useRealTimers();
});

const DAY_KEY = '2026-01-15';
const dayMs = new Date(2026, 0, 15, 10, 0, 0).getTime();
const nowMs = new Date(2026, 0, 15, 20, 0, 0).getTime();

function session(startedAt: number, topic?: string): LoggedSession {
  return { startedAt, plannedS: 1800, actualS: 1800, outcome: 'completed', topic };
}

const readingGoal: Goal = {
  id: 'goal:reading',
  topic: 'reading',
  period: 'daily',
  targetS: 1800,
  createdAt: 0,
  updatedAt: 0,
  archived: false,
};

/** Parent harness: owns the ONE stable `sessions` array (mirrors
 * useStore's `sessions` + useStore.retagSession), renders both a goal
 * progress readout and the real DaySheet, and wires DaySheet's `onRetag`
 * to the same applyTopicUpdate pure transform useStore.ts's own
 * retagSession calls before persisting. */
function Harness() {
  const [sessions, setSessions] = React.useState<LoggedSession[]>([session(dayMs, undefined)]);
  const daySessions = sessions.filter((s) => dayKey(s.startedAt) === DAY_KEY);
  const progress = computeGoalProgress([readingGoal], sessions, nowMs, [], []);
  const focusS = progress[0]?.focusS ?? 0;

  return (
    <SafeAreaProvider initialMetrics={{ frame: SAFE_AREA_FRAME, insets: SAFE_AREA_INSETS }}>
      <Text testID="reading-goal-focus">{String(focusS)}</Text>
      <DaySheet
        visible
        onClose={() => {}}
        dateKey={DAY_KEY}
        sessions={daySessions}
        goalsMet={[]}
        goals={[readingGoal]}
        theme={theme}
        customLabels={[]}
        excludedTopicKeys={[]}
        themeMode="dark"
        onRetag={(target, topic) => setSessions((prev) => applyTopicUpdate(prev, target, topic))}
      />
    </SafeAreaProvider>
  );
}

function focusText(tree: TestRenderer.ReactTestRenderer): string {
  return String(tree.root.findByProps({ testID: 'reading-goal-focus' }).props.children);
}

describe('DaySheet retag -> topic-scoped goal progress', () => {
  it('updates a "reading" goal\'s rendered focus once an untagged session is retagged to reading', () => {
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Harness />);
    });
    mounted.push(tree!);

    // Before retag: the untagged session doesn't count toward the
    // topic-scoped goal.
    expect(focusText(tree!)).toBe('0');

    // Tap the session's own tag affordance to open the retag picker.
    const tagBtn = tree!.root.findByProps({ accessibilityLabel: 'Untagged. Tap to tag this session.' });
    act(() => {
      tagBtn.props.onPress();
    });

    // Pick "Reading" from the built-in topic list.
    const readingRow = tree!.root.findByProps({ accessibilityLabel: 'Reading' });
    act(() => {
      readingRow.props.onPress();
    });

    // The goal's rendered focus must now reflect the retag.
    expect(focusText(tree!)).toBe('1800');
  });
});
