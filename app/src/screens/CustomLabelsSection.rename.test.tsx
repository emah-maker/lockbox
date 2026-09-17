// CustomLabelsSection.rename.test.tsx -- the rename field has to start from
// the name the label has NOW, not the one it had when the row first
// rendered.
//
// CustomLabelRow seeds its `draft` from `label.name` in a useState
// initializer, which runs once. The row is keyed by `label.id`, so it
// survives any change to the label's name -- and the name can change
// underneath it: settings sync (sync/firestoreSync.ts) writes the whole
// customLabels array back into useSettingsStore whenever another device
// edits it, and Settings is exactly the screen a user leaves open. After
// that the row DISPLAYS the new name (it renders label.name) while the
// stale one is still sitting in draft, so opening the editor shows the old
// name in the field and saving pushes it back over the remote rename --
// a silent revert of an edit the user never even saw.
//
// Cancel already resets draft to label.name; entering the editor did not.
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));
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

import { CustomLabelsSection } from './CustomLabelsSection';
import { useSettingsStore } from '../store/useSettingsStore';
import { resolveTheme } from '../theme/theme';

const theme = resolveTheme('dark', 'mint');
const LABEL = { id: 'custom:reading', name: 'Reading', color: '#2563eb' };

const mounted: TestRenderer.ReactTestRenderer[] = [];

function mount() {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<CustomLabelsSection color={theme} />);
  });
  mounted.push(tree!);
  return tree!;
}

function pressByLabel(tree: TestRenderer.ReactTestRenderer, accessibilityLabel: string) {
  const node = tree.root.find(
    (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === accessibilityLabel,
  );
  act(() => node.props.onPress());
}

/** The rename field's current value. It is the only TextInput on screen
 * with a non-empty value -- the "new label" field below it starts blank. */
function renameFieldValue(tree: TestRenderer.ReactTestRenderer): string | undefined {
  return tree.root
    .findAll((n) => typeof n.props?.onChangeText === 'function')
    .map((n) => n.props.value as string)
    .find((v) => !!v);
}

function storedName() {
  return useSettingsStore.getState().customLabels[0]?.name;
}

/** What settings sync does when another device renames this label: the
 * whole array is replaced in the store. The row is keyed by id, so it is
 * NOT remounted -- which is the entire point. */
function remoteRenameTo(name: string) {
  act(() => {
    useSettingsStore.setState({ customLabels: [{ ...LABEL, name }] } as never);
  });
}

beforeEach(() => {
  useSettingsStore.setState({
    hydrated: true,
    customLabels: [{ ...LABEL }],
    excludedTopicKeys: [],
  } as never);
});

afterEach(() => {
  act(() => {
    mounted.forEach((t) => t.unmount());
  });
  mounted.length = 0;
});

describe('renaming a label that changed underneath the row', () => {
  it('opens the editor on the current name', () => {
    const tree = mount();
    remoteRenameTo('Books');

    pressByLabel(tree, 'Rename Books');

    expect(renameFieldValue(tree)).toBe('Books');
  });

  it('does not push the pre-sync name back over the remote rename', () => {
    // The consequence, and the reason this is worth fixing rather than
    // just noting: the user opens the editor, sees a name, changes
    // nothing, and taps Save. Nothing about that gesture says "undo what
    // my other device just did", but that is what it did.
    const tree = mount();
    remoteRenameTo('Books');

    pressByLabel(tree, 'Rename Books');
    pressByLabel(tree, 'Save name for Books');

    expect(storedName()).toBe('Books');
  });

  it('tells a screen reader what the field is for', () => {
    // The rename field was the only TextInput in the app with neither an
    // accessibilityLabel nor a placeholder -- every other one has at least
    // one (see EmailPasswordFields, SessionReminderForm, TopicPicker, and
    // the "New label name" field in this very component, twenty lines up).
    // A placeholder would not have been enough here anyway: this field is
    // pre-filled with the current name, so a placeholder never shows and
    // never gets announced. VoiceOver landing on it read the value and
    // nothing else -- "Reading, text field" -- with no indication that
    // editing it renames the label rather than, say, filtering the list.
    const tree = mount();
    pressByLabel(tree, 'Rename Reading');

    const field = tree.root.find(
      (n) => typeof n.props?.onChangeText === 'function' && n.props?.value === 'Reading',
    );
    expect(field.props.accessibilityLabel).toBe('New name for Reading');
  });

  it('still offers a plain local rename', () => {
    // The ordinary path, pinned so the reset above cannot be implemented as
    // something that also discards what the user is typing.
    const tree = mount();
    pressByLabel(tree, 'Rename Reading');

    const field = tree.root.find(
      (n) => typeof n.props?.onChangeText === 'function' && n.props?.value === 'Reading',
    );
    act(() => field.props.onChangeText('Deep work'));
    pressByLabel(tree, 'Save name for Reading');

    expect(storedName()).toBe('Deep work');
  });
});
