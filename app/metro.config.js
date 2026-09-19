// metro.config.js -- exists for exactly one reason: to stop Metro bundling two
// separate copies of @firebase/app, which broke sign-in on every built iOS app.
//
// Expo enables `unstable_enablePackageExports` by default (SDK 53+), so Metro
// resolves through each package's `exports` map instead of its `main`/`browser`/
// `react-native` fields. @firebase/app's exports map answers `require` and
// `import` with DIFFERENT files:
//
//   "require": "./dist/index.cjs.js"        <- CommonJS
//   "default": "./dist/esm/index.esm2017.js" <- ESM
//
// and @firebase/auth's React Native build (dist/rn/index.js) is CommonJS, so it
// `require`s the first while app/src/auth/firebase.ts `import`s the second.
// Firebase's component registry is module-level state, so two copies are two
// registries: registerAuth() files the 'auth' component under the CJS copy,
// initializeApp() builds its FirebaseApp from the ESM copy's, and the lookup
// inside initializeAuth() finds nothing --
//
//   Error: Component auth has not been registered yet
//
// A plain Error with no `.code`, thrown synchronously, which useAuthStore
// reported on screen as "Couldn't start sign-in. Check your connection and try
// again. (stage: initialize-auth, Error)" -- see initFailureTag there. Nothing
// about it is a connection problem, and it is invisible locally: Jest compiles
// every module to CommonJS, so both specifiers collapse onto one copy and the
// whole auth suite passes against a build that cannot sign in.
//
// Turning package exports off sends Metro back to resolverMainFields
// (react-native, browser, main), which are single-valued -- `require` and
// `import` of @firebase/app both land on dist/esm/index.esm2017.js, one copy,
// one registry. @firebase/auth and @firebase/firestore still get their React
// Native builds through their own `react-native` fields, the same ones their
// exports maps were pointing at.
//
// Verify with:  npx expo export -p ios --source-maps external
// then check the .map's `sources` for a single @firebase/app entry. Two entries
// means this regressed. tests/metroFirebaseResolution.test.ts asserts it.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enablePackageExports = false;

module.exports = config;
