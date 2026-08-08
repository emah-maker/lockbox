// jest.setup.js -- registers the AsyncStorage jest mock. The package ships
// jest/async-storage-mock.js as a plain module export, not a self-installing
// mock, so it has to be wired up via jest.mock() here rather than just listed
// in "setupFiles" (which only runs a file, it doesn't intercept the import).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
