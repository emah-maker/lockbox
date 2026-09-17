// DaySheet.keys.test.tsx -- two sessions that look alike must still be two
// rows.
//
// A LoggedSession's identity across this app is the startedAt + plannedS +
// actualS TRIPLE: stats/sessionHistory.ts's retag uses it to pick the one
// entry the user tapped, and screens/stats/SessionListSheet.tsx keys its
// rows on it. This sheet (and ui/calendar/RecentSessionsRow.tsx, the other
// list of sessions on the Calendar tab) keyed on only the first two, which
// is a strictly weaker key for no reason -- two sessions started in the same
// second with the same planned duration and DIFFERENT actual ones collide,
// and React then reconciles two distinct rows as one: a duplicate-key
// warning, and the retag sheet opened from one row rendered against the
// other's data.
//
// Same-second arrivals are not hypothetical here. Sessions logged by a box
// whose clock was never set all arrive stamped from the same moment (see
// buildLoggedSessions), which is why that function now staggers them. That
// staggering fixes NEW batches; a log already on disk from an older build
// still holds the collisions, and this is the screen that lists them.
//
// Keying on the full triple does not make two byte-identical twins
// distinguishable -- nothing in the data can -- but it is what the rest of
// the app already means by "this session", and it costs one field.
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

import { DaySheet } from './DaySheet';
import { RecentSessionsRow } from '../../ui/calendar/RecentSessionsRow';
import { resolveTheme } from '../../theme/theme';
import type { LoggedSession } from '../../stats/sessionHistory';

const theme = resolveTheme('dark', 'mint');

/** The exact shape a clock-less box's batch used to arrive in: one instant,
 * one planned duration, different amounts actually served. */
const STARTED_AT = new Date(2026, 2, 14, 9, 0, 0).getTime();
const TWINS: LoggedSession[] = [
  { startedAt: STARTED_AT, plannedS: 1800, actualS: 1800, outcome: 'completed' },
  { startedAt: STARTED_AT, plannedS: 1800, actualS: 900, outcome: 'overridden' },
];

let consoleError: jest.SpyInstance;

beforeEach(() => {
  // React reports a key collision through console.error and then carries
  // on rendering, so the warning IS the observable -- silenced here only so
  // a failing run reports it as an assertion rather than as wall noise.
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

function duplicateKeyWarnings() {
  return consoleError.mock.calls
    .map((args: unknown[]) => args.map(String).join(' '))
    .filter((msg: string) => msg.includes('same key'));
}

/** DaySheet presents through `Sheet`, which reads safe-area insets, so the
 * provider is not optional here even though nothing under test uses them. */
function render(element: React.ReactElement) {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        {element}
      </SafeAreaProvider>,
    );
  });
  act(() => {
    tree!.unmount();
  });
}

it('gives the day sheet a distinct row per session', () => {
  render(
    <DaySheet
      visible
      onClose={() => {}}
      dateKey="2026-03-14"
      sessions={TWINS}
      goalsMet={[]}
      goals={[]}
      theme={theme}
      customLabels={[]}
      themeMode="dark"
      onRetag={() => {}}
    />,
  );

  expect(duplicateKeyWarnings()).toEqual([]);
});

it('gives the recent-sessions strip a distinct chip per session', () => {
  render(
    <RecentSessionsRow
      sessions={TWINS}
      selectedKey="2026-03-14"
      theme={theme}
      customLabels={[]}
      themeMode="dark"
      onSelect={() => {}}
    />,
  );

  expect(duplicateKeyWarnings()).toEqual([]);
});
