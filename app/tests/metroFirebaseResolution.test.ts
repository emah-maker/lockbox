// Guards metro.config.js -- see the long comment there. Without it Metro
// bundles @firebase/app twice (once via its exports map's `require` branch, for
// @firebase/auth's CommonJS React Native build, and once via `default`, for
// this app's own `import`), which splits Firebase's module-level component
// registry in two and makes initializeAuth() throw "Component auth has not been
// registered yet" on every built iOS app.
//
// The whole point of this test is that nothing else catches that. Jest compiles
// every module to CommonJS, so both specifiers collapse onto one copy here and
// the entire auth suite passes against a bundle that cannot sign in. So these
// assertions read the config FILE and the installed package metadata rather
// than exercising the app: that is the part that actually differs on device.
//
// metro.config.js is read, not require()d, deliberately -- requiring it pulls
// in expo/metro-config, whose TypeScript entry point does not load under the
// jest-expo transform.
import { readFileSync } from 'fs';
import { join } from 'path';

const appDir = join(__dirname, '..');
const readJson = (rel: string) => JSON.parse(readFileSync(join(appDir, rel), 'utf8'));

describe('metro.config.js keeps Firebase to one copy of @firebase/app', () => {
  it('disables package exports so require and import cannot resolve differently', () => {
    const source = readFileSync(join(appDir, 'metro.config.js'), 'utf8');
    expect(source).toMatch(/config\.resolver\.unstable_enablePackageExports\s*=\s*false/);
  });

  it('still resolves @firebase/auth and @firebase/firestore to their React Native builds', () => {
    // With package exports off, Metro falls back to resolverMainFields
    // (react-native, browser, main). Both packages carry a `react-native`
    // field naming the same build their exports maps' `react-native` condition
    // named, so turning exports off costs nothing here -- but only while these
    // fields exist. If either disappears in a Firebase upgrade, the bundle
    // silently gets a browser build instead.
    expect(readJson('node_modules/firebase/node_modules/@firebase/auth/package.json')['react-native']).toBe(
      'dist/rn/index.js',
    );
    expect(readJson('node_modules/@firebase/firestore/package.json')['react-native']).toBe('dist/index.rn.js');
  });

  it('documents the hazard: @firebase/app answers require and import with different files', () => {
    // If this ever stops being true, Firebase has fixed the dual-instance
    // problem upstream and metro.config.js's override can be deleted. Until
    // then, deleting it breaks sign-in on device and nowhere else.
    const exportsMap = readJson('node_modules/@firebase/app/package.json').exports['.'];
    expect(exportsMap.require).toBeDefined();
    expect(exportsMap.default).toBeDefined();
    expect(exportsMap.require).not.toBe(exportsMap.default);
    expect(exportsMap['react-native']).toBeUndefined();
  });
});
