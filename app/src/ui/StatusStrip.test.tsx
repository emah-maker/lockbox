// StatusStrip.test.tsx -- the box-state pill has to say something a person
// wrote, for every state the box can actually be in.
//
// This row rendered `status.st.toUpperCase()`: the raw wire token, shouted.
// That reads acceptably while the union happens to be four English words
// (IDLE/CLOSED/RUNNING/DONE), which is exactly why it survived -- but the
// firmware owns that union, and when it grew 'picking'/'confirming' (the
// box's own pre-session tag picker, which has no timeout, so a user can sit
// in it indefinitely) the strip started shouting PICKING and CONFIRMING at
// them. Routing through useStore's BOX_STATE_LABELS instead makes the
// mapping a total Record<BoxState, string>, so the NEXT state the firmware
// adds can't reach a release without someone choosing its wording -- the
// build fails until they do. See that map's own doc comment.
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('react-native-ble-plx', () => ({
  BleManager: class {
    onStateChange() {
      return { remove: jest.fn() };
    }
    startDeviceScan() {}
    stopDeviceScan() {}
    async state() {
      return 'PoweredOn';
    }
    async connectToDevice() {
      return {};
    }
    async cancelDeviceConnection() {}
  },
  State: {},
}));
jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(() => ({ currentUser: null })),
  onAuthStateChanged: jest.fn(() => jest.fn()),
  signInWithCredential: jest.fn(),
  GoogleAuthProvider: { credential: jest.fn() },
  OAuthProvider: class {},
  signOut: jest.fn(),
  linkWithCredential: jest.fn(),
  unlink: jest.fn(),
  deleteUser: jest.fn(),
  reauthenticateWithCredential: jest.fn(),
}));
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

import { StatusStrip } from './StatusStrip';
import { useStore, BOX_STATE_LABELS, CONN_LABELS } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import type { BoxState } from '../ble/protocol';

const frame = { x: 0, y: 0, width: 390, height: 844 };
const insets = { top: 47, left: 0, right: 0, bottom: 34 };

const mounted: TestRenderer.ReactTestRenderer[] = [];

function mount() {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={{ frame, insets }}>
        <StatusStrip />
      </SafeAreaProvider>,
    );
  });
  mounted.push(tree!);
  return tree!;
}

/** The state pill: the first Text in the row (dot, pill, spacer, ...), with
 * the demo banner switched off in beforeEach so nothing precedes it. */
function pillText(tree: TestRenderer.ReactTestRenderer): string {
  return tree.root.findAll((n) => (n.type as unknown) === 'Text')[0].props.children;
}

/** What VoiceOver reads for the whole row -- the same wording problem lives
 * here independently, and this one was never even uppercased, so it read
 * the bare wire token out loud. */
function rowA11yLabel(tree: TestRenderer.ReactTestRenderer): string {
  return tree.root.findAll(
    (n) => typeof n.type === 'string' && n.props?.accessibilityRole === 'button',
  )[0].props.accessibilityLabel;
}

beforeEach(() => {
  jest.useFakeTimers();
  useStore.setState({ conn: 'connected', status: null } as never);
  useSettingsStore.setState({ hydrated: true, demoMode: false } as never);
});

afterEach(() => {
  act(() => {
    mounted.forEach((t) => t.unmount());
  });
  mounted.length = 0;
  jest.useRealTimers();
});

describe('box state pill', () => {
  it.each(Object.keys(BOX_STATE_LABELS) as BoxState[])('shows a written label for %s', (st) => {
    act(() => {
      useStore.setState({ status: { st, set: 1800, rem: 900, bat: 72 } } as never);
    });
    const tree = mount();

    expect(pillText(tree)).toBe(BOX_STATE_LABELS[st]);
  });

  it('never leaks a raw wire token for the box\'s tag-picker states', () => {
    // The two that made this a user-visible bug rather than a latent one --
    // named explicitly so a future map edit that drops them back to
    // pass-through has to fail here, not just in the loop above.
    for (const st of ['picking', 'confirming'] as BoxState[]) {
      act(() => {
        useStore.setState({ status: { st, set: 1800, rem: 900, bat: 72 } } as never);
      });
      const tree = mount();

      expect(pillText(tree)).toBe('Tagging');
      expect(pillText(tree)).not.toBe(st.toUpperCase());
      expect(rowA11yLabel(tree)).toContain('Box Tagging');
      expect(rowA11yLabel(tree)).not.toContain(st);
    }
  });

  it('still falls back to the connection label with no status frame yet', () => {
    // The other half of the same ternary: before the first status frame
    // lands there is no BoxState to name, and the row shows how the
    // CONNECTION is going instead. Untouched by the fix, pinned so it
    // stays that way.
    act(() => {
      useStore.setState({ conn: 'scanning', status: null } as never);
    });
    const tree = mount();

    expect(pillText(tree)).toBe(CONN_LABELS.scanning);
  });
});
