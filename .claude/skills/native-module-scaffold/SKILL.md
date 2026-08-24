---
name: native-module-scaffold
description: Scaffold a new Expo native module in app/modules/ following the existing background-wake / call-observer pattern (iOS/Swift only, autolinked via expo-module.config.json). Use when the user asks to add a new native module, native capability, or Swift-backed feature to the Phone Box app.
disable-model-invocation: true
---

# Adding a native module

This app autolinks local native modules from `app/modules/` (see `app/package.json`'s `expo.autolinking.nativeModulesDir`). Two exist today, both iOS-only, Swift, no Android side: [background-wake](../../../app/modules/background-wake) and [call-observer](../../../app/modules/call-observer).

## File layout to create under `app/modules/<name>/`

```
<name>/
  package.json              # name, version, main: "index.ts"
  expo-module.config.json   # declares the iOS module for autolinking
  <Name>.podspec            # CocoaPods spec, mirrors package.json name/version
  index.ts                  # requireNativeModule('<Name>') + typed JS API
  ios/
    <Name>Module.swift       # Module { Name("<Name>") ... } definition
    <Name>AppDelegateSubscriber.swift  # only if it needs app-lifecycle hooks
```

Use `background-wake` as the template if the feature needs app-delegate lifecycle hooks (it has a subscriber + a `State.swift` for shared state); use `call-observer` as the template for a simpler single-module case.

## Steps

1. Copy the closest existing module's `package.json`, `expo-module.config.json`, and `.podspec`, renaming to the new module.
2. Write the Swift module in `ios/<Name>Module.swift` using the Expo Modules API (`Function`, `AsyncFunction`, `Events` as needed).
3. Write `index.ts` as a thin typed wrapper over `requireNativeModule`.
4. Run `npx expo prebuild --clean` (the `prebuild` script in `app/package.json`) so the new pod gets linked into the iOS project.
5. Add a jest test if the JS-side wrapper has any logic beyond a passthrough (see existing test files under `app/src/**/*.test.ts` for this repo's testing style).

## Constraints specific to this repo

- iOS only -- there is no Android native code here today; don't scaffold `android/` unless explicitly asked.
- Keep the JS-facing API in `index.ts` small and typed; put logic in Swift only when it needs OS APIs (background execution, CallKit, etc.) that can't be done from JS.
- If the new module touches call/telephony state or background execution, flag it to the user for App Store review-risk (both existing modules already sit in that category).
