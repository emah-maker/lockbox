// Guards patches/expo-apple-authentication+57.0.2.patch.
//
// expo-apple-authentication 57.0.2 ships this, in the delegate callback UIKit
// invokes to ask where to present the Sign in with Apple sheet:
//
//   guard let window = UIApplication.shared.keyWindow else {
//     fatalError("Unable to present authentication modal because ...")
//   }
//
// `UIApplication.shared.keyWindow` is deprecated as of iOS 13 and returns nil
// during scene transitions. `fatalError()` is not an error -- it is a SIGTRAP,
// so no `try`/`catch` in appleAuth.ts can see it and no JS-side workaround is
// possible. The app simply dies, mid-sign-in.
//
// The patch is a backport of the fix expo shipped in expo-apple-authentication
// 58.0.0, verbatim apart from that version's Swift-6 `@unchecked Sendable`
// conformances (which 57's sibling exception classes do not carry): resolve the
// window up front via ExpoModulesCore's `SceneGeometry.keyWindow()`, throw a normal
// `WindowUnavailableException` if there isn't one -- which reaches JS as a
// catchable error like any other -- and make the delegate callback total.
// Backported rather than taken by upgrading the package, because 58.x belongs
// to the SDK 58 line and `expo install --check` would flag it against this
// project's SDK 57; the two versions' podspecs are identical
// (`s.dependency 'ExpoModulesCore'`, unversioned, swift 5.9) and
// `SceneGeometry.keyWindow()` exists in the installed expo-modules-core 57.0.18.
// The helper is on `SceneGeometry`, not `Utilities` -- naming the wrong type
// compiles here and fails only on an EAS builder, with
// `type 'Utilities' has no member 'keyWindow'`, so the assertions below check
// the call site and the declaring type together.
//
// WHY A TEST AND NOT JUST A PATCH FILE: the patch only takes effect through
// `postinstall: patch-package`. An `npm install --no-scripts`, a lockfile
// surgery, or a future bump of expo-apple-authentication (patch-package skips a
// patch whose version no longer matches, with only a warning) all silently
// restore the crash. Nothing else in this repo would notice -- there is no iOS
// runtime here (see docs and the notes in metroFirebaseResolution.test.ts about
// build-level invariants Jest cannot otherwise reach), so this reads the
// installed FILE, which is the thing that actually gets compiled.
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const appDir = join(__dirname, '..');
const iosDir = join(appDir, 'node_modules', 'expo-apple-authentication', 'ios');
const requestSwift = () => readFileSync(join(iosDir, 'AppleAuthenticationRequest.swift'), 'utf8');

describe('the Sign in with Apple crash patch is applied', () => {
  it('leaves no fatalError anywhere in the module, since nothing in JS can catch one', () => {
    // The whole class of defect, not just the one line: any fatalError on this
    // path is an uncatchable crash during sign-in.
    expect(requestSwift()).not.toMatch(/fatalError/);
  });

  it('resolves the presentation window before presenting, and throws instead of crashing', () => {
    const source = requestSwift();
    expect(source).toMatch(/guard let window = SceneGeometry\.keyWindow\(\) else \{/);
    expect(source).toMatch(/throw WindowUnavailableException\(\)/);
  });

  it('makes the presentation-anchor callback total, so UIKit can never trip it', () => {
    // UIKit calls this synchronously and does not expect it to fail; returning
    // a fallback window is what 58.0.0 does.
    expect(requestSwift()).toMatch(/return presentationAnchorWindow \?\? UIWindow\(\)/);
  });

  it('declares the exception the guard throws, or the module would not compile', () => {
    const exceptions = readFileSync(join(iosDir, 'AppleAuthenticationExceptions.swift'), 'utf8');
    expect(exceptions).toMatch(/final class WindowUnavailableException: Exception \{/);
  });

  it('calls the keyWindow helper on the type that actually declares it', () => {
    // The one thing the backport depends on that the package does not ship
    // itself. If a future expo-modules-core drops, renames or moves it, the
    // build breaks at compile time -- catching it here names the reason
    // instead. Matching the owning type matters as much as the file: the first
    // draft of this patch said `Utilities.keyWindow()` and only the EAS build
    // caught it, because the file existed and the member did not.
    const helper = join(appDir, 'node_modules', 'expo-modules-core', 'ios', 'Utilities', 'SceneGeometry.swift');
    expect(existsSync(helper)).toBe(true);
    const source = readFileSync(helper, 'utf8');
    expect(source).toMatch(/public enum SceneGeometry \{/);
    expect(source).toMatch(/public static func keyWindow\(/);

    // And nothing named keyWindow hangs off `Utilities`, the type the broken
    // draft reached for.
    const utilities = readFileSync(
      join(appDir, 'node_modules', 'expo-modules-core', 'ios', 'Utilities', 'Utilities.swift'),
      'utf8'
    );
    expect(utilities).not.toMatch(/func keyWindow\(/);
  });
});

describe('the patch is wired to survive a fresh install', () => {
  const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));

  it('keeps the patch file next to the version it was generated against', () => {
    // patch-package matches on the exact version in the filename and silently
    // skips a patch that no longer matches -- so a bump of this dependency
    // must regenerate the patch, and this assertion is what says so.
    const version = pkg.dependencies['expo-apple-authentication'].replace(/^[~^]/, '');
    expect(existsSync(join(appDir, 'patches', `expo-apple-authentication+${version}.patch`))).toBe(true);
  });

  it('runs patch-package on install, which is the only thing that applies it on an EAS builder', () => {
    expect(pkg.scripts.postinstall).toBe('patch-package');
    expect(pkg.devDependencies['patch-package']).toEqual(expect.any(String));
  });
});
