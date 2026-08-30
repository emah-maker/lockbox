// FocusHero.test.tsx -- regression test for the "goal-window detail caption
// divides the wrong numbers" bug.
//
// FocusHero's third, smaller caption line (`detail`) states the concrete
// amount behind the percentage in `caption` -- how much is left, or how far
// past target. For the 'goal'/'baseline'/'rollingAverage' idle-ring sources,
// idleRing.progress IS todayFocusS / comparison, so dividing todayFocusS by
// progress recovers the comparison exactly. For 'weeklyGoal'/'monthlyGoal'/
// 'chosenGoal' it is NOT -- their ratio's numerator is the WHOLE window's
// focus time (goals/goalProgress.ts), not today's -- so dividing today's
// seconds by that ratio produced a number that means nothing (a 10h weekly
// goal at 6h done this week and 30m logged today reported "20m to go"
// against a real 4h remaining). idleRingState.ts's `goalWindow` now carries
// the real window pair for those three sources; this test pins FocusHero to
// actually using it instead of re-deriving from todayFocusS/progress.
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { FocusHero } from './FocusHero';
import type { IdleRingState } from './idleRingState';

// Icons/haptics are opaque leaves as far as this test is concerned -- same
// stand-in GoalForm.test.tsx/SettingsScreen.test.tsx use, needed here
// because AnimatedPressable/BatteryBadge pull in @expo/vector-icons'
// font-loaded check, which trips jest-expo's expo-font mock outside a real
// native runtime.
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons', Feather: 'Feather', MaterialIcons: 'MaterialIcons' }));

// Every tree this file mounts, unmounted in afterEach. FocusHero starts a
// 220ms opacity timing on mount; it stops that on unmount, but only if
// something unmounts it. Left mounted, the timing fires after Jest tears the
// environment down. Same `mounted`/afterEach shape ui/Sheet.test.tsx and
// ui/WheelPicker.test.tsx use for their own pending animations.
const mounted: TestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  act(() => {
    mounted.forEach((t) => t.unmount());
  });
  mounted.length = 0;
});

function renderHero(idleRing: IdleRingState, todayFocusS: number) {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <FocusHero
        status={null}
        connected
        currentTopic={null}
        customLabels={[]}
        themeMode="dark"
        todayFocusS={todayFocusS}
        idleRing={idleRing}
        ringBaselineWindow="week"
        ringSourceKind="weeklyGoal"
        onCycleRingSource={() => {}}
        onPressIdle={() => {}}
        onPressTag={() => {}}
      />,
    );
  });
  mounted.push(tree!);
  return tree!;
}

/** Finds the exact rendered detail/caption line -- a plain string child of
 * some <Text>, matched by its exact content rather than by style, since
 * styles.detail/.caption are implementation details this test shouldn't
 * need to know about. */
function findText(tree: TestRenderer.ReactTestRenderer, content: string) {
  return tree.root.findAll((n) => n.type === Text && n.props.children === content);
}

describe('goal-window detail caption', () => {
  it('a weekly goal under target states the real remaining time from goalWindow, not todayFocusS/progress', () => {
    // 6h done this week, 10h target, 30m done today -- the old
    // todayFocusS/progress math (1800 / (21600/36000) = 3000s = 50m) would
    // have said "50m to go"; the true remaining is 4h.
    const tree = renderHero(
      {
        progress: 21600 / 36000,
        source: 'weeklyGoal',
        goalWindow: { focusS: 21600, targetS: 36000 },
      },
      1800,
    );
    expect(findText(tree, '4h 00m to go')).toHaveLength(1);
    expect(findText(tree, '50m to go')).toHaveLength(0);
  });

  it('a weekly goal past target states the real overage from goalWindow', () => {
    // 12h done this week (past a 10h target), 30m done today.
    const tree = renderHero(
      {
        progress: 43200 / 36000,
        source: 'weeklyGoal',
        goalWindow: { focusS: 43200, targetS: 36000 },
      },
      1800,
    );
    expect(findText(tree, '2h 00m past 10h 00m')).toHaveLength(1);
  });

  it('a monthly goal under target also uses goalWindow', () => {
    // 1h done this month, target 3h20m (12000s) -> 2h20m remaining.
    const tree = renderHero(
      {
        progress: 3600 / 12000,
        source: 'monthlyGoal',
        goalWindow: { focusS: 3600, targetS: 12000 },
      },
      600,
    );
    expect(findText(tree, '2h 20m to go')).toHaveLength(1);
  });

  it('a chosen goal under target also uses goalWindow, alongside its own name in the caption', () => {
    const tree = renderHero(
      {
        progress: 900 / 1200,
        source: 'chosenGoal',
        chosenGoalName: 'Reading',
        goalWindow: { focusS: 900, targetS: 1200 },
      },
      120,
    );
    expect(findText(tree, '5m to go')).toHaveLength(1);
    expect(findText(tree, '75% of Reading')).toHaveLength(1);
  });

  it('a non-window source (baseline) is unchanged -- still derives the comparison from todayFocusS/progress', () => {
    // progress 0.5 with todayFocusS 1800s (30m) -> comparison = 1800/0.5 =
    // 3600s (1h) -> 30m remaining.
    const tree = renderHero({ progress: 0.5, source: 'baseline' }, 1800);
    expect(findText(tree, '30m to go')).toHaveLength(1);
  });

  it('a non-window source (rollingAverage) is unchanged too', () => {
    // progress 2 (today double the average) with todayFocusS 1200s (20m) ->
    // comparison = 1200/2 = 600s (10m) -> 10m past.
    const tree = renderHero({ progress: 2, source: 'rollingAverage' }, 1200);
    expect(findText(tree, '10m past 10m')).toHaveLength(1);
  });
});
