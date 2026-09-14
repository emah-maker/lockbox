// demoSessionMarker.test.tsx -- demonstration-mode sessions have to say so
// wherever they are listed.
//
// sync/sessionsSync.ts already keeps them off Firestore, which is the
// irreversible half. The reversible half is still real: demo sessions stay
// in the LOCAL log after demo mode is switched off, counting toward the
// day's total, the heat map, stats and goal progress. The banner is
// conditioned on the toggle, not on the sessions, so once the toggle goes
// off there is nothing left to distinguish an invented session from focus
// time that actually happened -- while LoggedSession.demo has recorded which
// is which all along. An app that knows and does not say is worse than one
// that never knew.
//
// So this renders the two surfaces that list individual sessions -- the
// Calendar tab's day sheet and the Stats tab's session list -- each holding
// one real session and one demo session, and pins that exactly one of them
// is marked. Aggregates (today's total, the topic donut) are deliberately
// left unmarked: a total has no room to qualify itself, and the rows behind
// it are one tap away.
import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DaySheet } from './calendar/DaySheet';
import { SessionListSheet } from './stats/SessionListSheet';
import type { LoggedSession } from '../stats/sessionHistory';
import { resolveTheme } from '../theme/theme';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
// Opaque leaves -- jest-expo's font-loaded check trips over the real
// @expo/vector-icons outside a native runtime. Same stand-in
// goalTopicWiring.daySheetRetag.test.tsx uses for the same component tree.
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

const theme = resolveTheme('dark', 'mint');
const SAFE_AREA_FRAME = { x: 0, y: 0, width: 320, height: 640 };
const SAFE_AREA_INSETS = { top: 0, left: 0, right: 0, bottom: 0 };

const DAY_KEY = '2026-01-15';
const at = (hour: number) => new Date(2026, 0, 15, hour, 0, 0).getTime();

const realSession: LoggedSession = { startedAt: at(9), plannedS: 1800, actualS: 1800, outcome: 'completed' };
const demoSession: LoggedSession = { startedAt: at(11), plannedS: 300, actualS: 300, outcome: 'completed', demo: true };
const sessions = [realSession, demoSession];

const mounted: TestRenderer.ReactTestRenderer[] = [];
beforeEach(() => {
  // Sheet animates in; same fake-timer discipline every other test that
  // mounts one uses.
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

function render(node: React.ReactElement): TestRenderer.ReactTestRenderer {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={{ frame: SAFE_AREA_FRAME, insets: SAFE_AREA_INSETS }}>{node}</SafeAreaProvider>,
    );
  });
  mounted.push(tree!);
  return tree!;
}

/** How many <Text> nodes render exactly `content`. */
const countText = (tree: TestRenderer.ReactTestRenderer, content: string) =>
  tree.root.findAll((n) => n.type === Text && n.props.children === content).length;

describe("the Calendar tab's day sheet", () => {
  it('marks the demo session and leaves the real one alone', () => {
    const tree = render(
      <DaySheet
        visible
        onClose={() => {}}
        dateKey={DAY_KEY}
        sessions={sessions}
        goalsMet={[]}
        goals={[]}
        theme={theme}
        customLabels={[]}
        excludedTopicKeys={[]}
        themeMode="dark"
        onRetag={() => {}}
      />,
    );

    expect(countText(tree, 'DEMO')).toBe(1);
    // Both rows are still there, and the demo one keeps its own outcome --
    // the marker is additional information, not a replacement for it.
    expect(countText(tree, 'Completed')).toBe(2);
  });
});

describe("the Stats tab's session list", () => {
  it('marks the demo session and leaves the real one alone', () => {
    const tree = render(
      <SessionListSheet sessions={sessions} customLabels={[]} themeMode="dark" onOpenCalendarDay={() => {}} />,
    );

    expect(countText(tree, 'DEMO')).toBe(1);
    expect(countText(tree, 'Completed')).toBe(2);
  });
});
