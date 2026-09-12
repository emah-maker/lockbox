// goalTopicWiring.statsRetag.test.tsx -- component-level regression check
// for "goals do not update with the topic", Stats-screen flow: retagging a
// session from the session-list sheet's own LabelPickerSheet (the same
// picker + retagSession path StatsScreen.tsx wires at its
// SessionListSheet/LabelPickerSheet pair, ~line 408) must move a
// topic-scoped goal's rendered progress.
//
// Drives the REAL SessionListSheet (screens/stats/SessionListSheet.tsx) and
// LabelPickerSheet (ui/calendar/LabelPickerSheet.tsx) through
// react-test-renderer, wired the same way StatsScreen.tsx wires them
// (onRetag -> open picker -> onPick/onClear -> retagSession), rather than
// calling applyTopicUpdate/computeGoalProgress directly (already unit-tested
// elsewhere). `sessions`/`goals`/`customLabels`/`excludedTopicKeys` are held
// in one parent component's state/module scope -- the stable-reference
// discipline home/useHomeGoalRing.test.tsx documents -- so a fresh-literal-
// every-render bug can't hide here.
import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionListSheet } from './stats/SessionListSheet';
import { LabelPickerSheet } from '../ui/calendar/LabelPickerSheet';
import { allLabelChoices, resolveTopic } from '../stats/customLabels';
import { applyTopicUpdate, LoggedSession } from '../stats/sessionHistory';
import { computeGoalProgress } from '../goals/goalProgress';
import type { Goal } from '../goals/goals';
import { resolveTheme } from '../theme/theme';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

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

const nowMs = new Date(2026, 0, 15, 20, 0, 0).getTime();
const startedAt = new Date(2026, 0, 15, 10, 0, 0).getTime();

function session(topic?: string): LoggedSession {
  return { startedAt, plannedS: 1800, actualS: 1800, outcome: 'completed', topic };
}

const studyGoal: Goal = {
  id: 'goal:study',
  topic: 'study',
  period: 'daily',
  targetS: 1800,
  createdAt: 0,
  updatedAt: 0,
  archived: false,
};

/** Parent harness mirroring StatsScreen.tsx's own retag wiring: a
 * `retagTarget` local to the sheet interaction, and the ONE stable
 * `sessions` array the goal-progress readout and the session list both
 * read from. */
function Harness() {
  const [sessions, setSessions] = React.useState<LoggedSession[]>([session(undefined)]);
  const [retagTarget, setRetagTarget] = React.useState<LoggedSession | null>(null);
  const progress = computeGoalProgress([studyGoal], sessions, nowMs, [], []);
  const focusS = progress[0]?.focusS ?? 0;

  const retagSession = (target: LoggedSession, topic: string | undefined) => {
    setSessions((prev) => applyTopicUpdate(prev, target, topic));
  };

  return (
    <SafeAreaProvider initialMetrics={{ frame: SAFE_AREA_FRAME, insets: SAFE_AREA_INSETS }}>
      <Text testID="study-goal-focus">{String(focusS)}</Text>
      <SessionListSheet
        sessions={sessions}
        customLabels={[]}
        themeMode="dark"
        onOpenCalendarDay={() => {}}
        onRetag={setRetagTarget}
      />
      <LabelPickerSheet
        visible={retagTarget !== null}
        choices={allLabelChoices([], 'dark', [])}
        current={retagTarget ? resolveTopic(retagTarget.topic, [], 'dark')?.id : undefined}
        theme={theme}
        onClose={() => setRetagTarget(null)}
        onPick={(id) => {
          if (retagTarget) retagSession(retagTarget, id);
          setRetagTarget(null);
        }}
        onClear={
          retagTarget?.topic
            ? () => {
                retagSession(retagTarget, undefined);
                setRetagTarget(null);
              }
            : undefined
        }
      />
    </SafeAreaProvider>
  );
}

function focusText(tree: TestRenderer.ReactTestRenderer): string {
  return String(tree.root.findByProps({ testID: 'study-goal-focus' }).props.children);
}

describe('Stats session-list retag -> topic-scoped goal progress', () => {
  it('updates a "study" goal\'s rendered focus once a session is retagged to study from the Stats sheet', () => {
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Harness />);
    });
    mounted.push(tree!);

    expect(focusText(tree!)).toBe('0');

    // Tap the row's own "Tag" affordance (SessionListSheet.tsx's onRetag).
    const tagBtn = tree!.root.findByProps({ accessibilityLabel: 'Change the label on this 30m session' });
    act(() => {
      tagBtn.props.onPress();
    });

    // Pick "Study" from the built-in topic list.
    const studyRow = tree!.root.findByProps({ accessibilityLabel: 'Study' });
    act(() => {
      studyRow.props.onPress();
    });

    expect(focusText(tree!)).toBe('1800');
  });
});
