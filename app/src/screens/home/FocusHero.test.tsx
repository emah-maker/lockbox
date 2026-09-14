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
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { FocusHero } from './FocusHero';
import type { IdleRingState } from './idleRingState';
import type { Status } from '../../ble/protocol';

// Icons/haptics are opaque leaves as far as this test is concerned -- same
// stand-in GoalForm.test.tsx/SettingsScreen.test.tsx use, needed here
// because AnimatedPressable/BatteryBadge pull in @expo/vector-icons'
// font-loaded check, which trips jest-expo's expo-font mock outside a real
// native runtime.
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

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

/** `over` exists for the hardware-wording cases below, which are the only
 * ones that care about anything other than the ring: every goal-window test
 * above renders the same connected, idle, non-demo hero. */
function renderHero(
  idleRing: IdleRingState,
  todayFocusS: number,
  over: {
    status?: Status | null;
    connected?: boolean;
    demoMode?: boolean;
    offerDemoMode?: boolean;
    onStartDemoMode?: () => void;
  } = {},
) {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <FocusHero
        status={over.status ?? null}
        connected={over.connected ?? true}
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
        demoMode={over.demoMode ?? false}
        offerDemoMode={over.offerDemoMode ?? true}
        onStartDemoMode={over.onStartDemoMode ?? (() => {})}
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

// The two states that say something about a physical object, and the App
// Store Review Guideline 2.1(a) rejection behind them: a reviewer with no
// box was "unable to successfully access all or part of the app". Demo mode
// is the remedy, and neither of these states may undercut it -- one by
// instructing someone to press a button they do not have, the other by
// dead-ending with no route to the remedy at all.
describe('states that talk about hardware', () => {
  const emptyRing: IdleRingState = { progress: 0, source: 'empty' };
  const closedStatus: Status = { st: 'closed', rem: 0, set: 300, bat: 87, tp: '', fw: 'demo' };

  /** The outermost pressable carrying `label`, or null when nothing does.
   * First-of-findAll rather than the list itself: AnimatedPressable renders
   * the same props down a short stack of nodes, so a count assertion would
   * be pinning an implementation detail of that component. */
  const pressableFor = (tree: TestRenderer.ReactTestRenderer, label: string) =>
    tree.root.findAll((n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === label)[0] ??
    null;

  it('does not tell a demo user to press a button on a box they do not have', () => {
    const tree = renderHero(emptyRing, 0, { status: closedStatus, demoMode: true });

    expect(findText(tree, 'Press LOCK on the box to start')).toHaveLength(0);
    expect(findText(tree, 'The simulated box is starting the session')).toHaveLength(1);
    // The state itself still shows -- `closed` is real and worth seeing.
    expect(findText(tree, 'Closed')).toHaveLength(1);
  });

  it('still says press LOCK when the box is a real one', () => {
    const tree = renderHero(emptyRing, 0, { status: closedStatus, demoMode: false });

    expect(findText(tree, 'Press LOCK on the box to start')).toHaveLength(1);
  });

  it('offers a way into demo mode from the no-box dead end', () => {
    const onStartDemoMode = jest.fn();
    const tree = renderHero(emptyRing, 0, { connected: false, onStartDemoMode });

    expect(findText(tree, 'Connect your box')).toHaveLength(1);
    const cta = pressableFor(tree, 'No box? Try demo mode');
    expect(cta).not.toBeNull();

    act(() => cta!.props.onPress());
    expect(onStartDemoMode).toHaveBeenCalledTimes(1);
  });

  // `offerDemoMode` false is what DashboardScreen computes for a device that
  // already remembers a box and is mid-scan or mid-reconnect -- and for demo
  // mode already being on. Someone reaching for the box they own must not be
  // told to try the fake one.
  it('drops the offer when the caller says this is not a no-box situation', () => {
    const tree = renderHero(emptyRing, 0, { connected: false, offerDemoMode: false });

    expect(findText(tree, 'Connect your box')).toHaveLength(1);
    expect(pressableFor(tree, 'No box? Try demo mode')).toBeNull();
  });

  it('keeps the offer out of the way of a connected box', () => {
    const tree = renderHero(emptyRing, 0, { connected: true });

    expect(pressableFor(tree, 'No box? Try demo mode')).toBeNull();
  });
});
