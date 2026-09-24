# Skill - expo-react-native-dev

Build the `app/` companion app's actual screens, state, and native feel — the
day-to-day Expo/React Native UI work, not store submission and not post-build
validation. `fraim/ai-employee/skills/mobile/expo-react-native-mobile-dev-validation.md`
(synced, read-only) owns confirming a change loads on an emulator/EAS build;
this skill owns writing the change in the first place. Guidance here is
anchored to what `app/` (Expo SDK 52, React Native 0.76.5, TypeScript) actually
does today, not generic Expo boilerplate — where a general Expo convention
doesn't match this codebase's real stack, that's called out explicitly rather
than forced in.

For general design taste, anti-generic checks, and the website side of this
project, see the `ui-design-consultant` skill
(`fraim/personalized-employee/skills/ux-design/`); for motion/animation
values on either surface, see the sibling `motion-and-animation` skill in
that same directory. This skill owns *this app's* component/library/file
conventions, not design taste or motion values.

### Skill Input
- A request to add or change a screen, component, native-feeling control,
  data/sync behavior, or feedback UI (toast/alert) in `app/`.
- The relevant existing files under `app/src/` — always read the peer file
  for the area being touched before writing (see Skill Steps §1).

### Skill Output
- Code that matches this app's existing conventions: hand-rolled tab
  navigation (not Expo Router), `theme/tokens.ts` design tokens, RN core
  `Animated` (not Reanimated/gesture-handler — neither is a dependency),
  zustand stores, and Firestore/BLE as the app's real "data fetching" layers.
- A plain statement of any convention the change deliberately deviates from,
  and why.

### Skill Steps

1. **Grep the peer screen/component first.** Before writing new UI, open the
   nearest existing file in `app/src/screens/` or `app/src/ui/` and match its
   patterns (imports, theming, animation, styling). This app's own file-header
   comments (e.g. `AnimatedPressable.tsx`, `useStore.ts`) explain *why* a
   convention exists — read them; they usually preempt "why not use library X"
   with a real reason (see §3).

2. **Navigation — this app has no router; know when that's still correct.**
   - `App.tsx` is the entire navigation layer: a `useState<Tab>` + a
     `SCREENS: Record<Tab, Component>` lookup, four flat tabs (Dashboard,
     Stats, Calendar, Settings), tab switches wrapped in
     `LayoutAnimation.configureNext(...)`. There is no `expo-router` or
     `@react-navigation/*` dependency in `app/package.json`, and the app's own
     comment states this is deliberate: *"four flat screens don't need a
     router."*
   - For a new flat top-level tab or an in-screen sub-view (e.g.
     `CustomLabelsSection.tsx` inside Settings), keep following this pattern —
     add to `SCREENS`/`TABS` in `App.tsx`, or a local `useState` switch inside
     the screen, exactly as `SettingsScreen.tsx` already composes
     `SettingsPrimitives.tsx` sections.
   - Only reach for Expo Router if navigation actually grows beyond flat tabs —
     nested stacks, a detail screen pushed with params, deep links, or a modal
     presented over the tab bar. That is a real migration (introducing an
     `app/` routes directory alongside the existing `app/src/` — this project
     already uses `app/App.tsx` as its root, not `app/index.tsx` routes, so
     adopting Expo Router means restructuring the entry point, not adding a
     file). Don't reach for it to solve a one-off "go to this screen" need;
     a local state flag or a prop callback down to the tab screen is cheaper
     and matches how `DashboardScreen`/`SettingsScreen` already pass callbacks.
   - If that migration does happen: follow the installed `expo-router` skill's
     conventions (kebab-case route files, `_layout.tsx` stacks, `Link` with
     previews/context menus, `NativeTabs` for the tab bar) rather than
     inventing a parallel router pattern.

3. **Native-feeling UI — extend the app's own primitives, don't import a new
   animation/UI library.**
   - `app/package.json` has neither `react-native-reanimated` nor
     `react-native-gesture-handler` nor `@expo/ui`. This is intentional (see
     `AnimatedPressable.tsx`'s header comment). Build new tappables on
     `AnimatedPressable` (`app/src/ui/AnimatedPressable.tsx` — a
     `Pressable` wrapped in `Animated.createAnimatedComponent`, press-scale via
     a critically-damped spring, respects `useReducedMotion()`); build new
     draggable controls the way `SettingsPrimitives.tsx`'s `SliderRow` does,
     with core RN `PanResponder`, not a new gesture library — `SliderRow` is a
     uniform-step `min`/`max`/`step` slider (it used to also snap to a
     discrete, non-uniform `options` array for the firmware's old OVR_OPTIONS
     staircase; that mode was removed once Override presses became a flat
     step, since a non-uniform staircase is what made the slider feel
     "inconsistent" in the first place — check SliderRow's own header comment
     before reintroducing anything like it). For a value that also needs an
     escape hatch beyond the slider's range or granularity, see
     `SettingsScreen.tsx`'s `OverrideCustomEntry` — a small inline `TextInput`
     shown behind a "Custom…" toggle, deliberately not `Alert.prompt` (iOS-only).
   - `AnimatedPressable`'s scale-down-on-press is a uniformly-applied
     iOS-style treatment; there's no `Platform.select` branching for touch
     feedback today. The Android-native equivalent is `Pressable`'s
     `android_ripple` prop — a contained `Platform.select` addition inside
     `AnimatedPressable` (ripple on Android, spring-scale on iOS) if Android
     parity is ever a stated goal. Don't add it speculatively.
   - Draw colors, spacing, radius, type, and shadow from
     `app/src/theme/tokens.ts` (`spacing`, `radius`, `typeScale`, `elevation`)
     and `app/src/theme/theme.ts` (`useTheme()` → `ThemeColors`: `bg`,
     `surface`, `text`, `textDim`, `accent`, `accentText`, `danger`, `warn`).
     This app resolves its own light/dark + 5-accent palette from
     `useSettingsStore`, as plain hex strings — it does **not** use
     `PlatformColor`/the `Color` API from `expo-router` (not a dependency).
     Use `withAlpha(hex, alpha)` (`theme.ts`) for a tinted variant (e.g. an
     unfilled slider track) instead of a second hardcoded color. Don't
     introduce a second color system; add new roles to `ThemeColors`/
     `MODES`/`ACCENTS` in `theme.ts` if a new semantic color is genuinely
     needed.
   - RN does not auto-scale text with the device's accessibility font-size
     setting the way SwiftUI/Dynamic Type does, and `typeScale` in
     `tokens.ts` is fixed-px — a real, currently-unaddressed gap. If a
     screen genuinely needs to respect the system font-scale setting, use
     `PixelRatio.getFontScale()`/`useWindowDimensions().fontScale`
     explicitly; don't assume RN handles it for free.
   - Icons: the app uses `@expo/vector-icons` (`Feather`, see `App.tsx`), not
     `expo-image` with `sf:` SF Symbol sources. Stay with `Feather` for
     consistency unless a manager explicitly asks for the SF Symbols look —
     that's a broader icon-system swap, not a drop-in per-icon change.
   - Shadows: `elevation.card` in `tokens.ts` uses the legacy RN shadow props
     (`shadowColor`/`shadowOffset`/`shadowOpacity`/`shadowRadius`/`elevation`),
     not the CSS `boxShadow` style prop that Expo's native-UI guidance now
     recommends. Keep using `elevation.card` for consistency with existing
     cards; `boxShadow` is a reasonable choice for genuinely new surfaces but
     confirm the New Architecture is enabled before relying on it, and don't
     rewrite `elevation.card` itself as a drive-by change.
   - Safe areas: the app already does this correctly — `SafeAreaProvider`/
     `SafeAreaView` from `react-native-safe-area-context` in `App.tsx`, never
     RN core's `SafeAreaView`. Keep doing that.
   - For anything genuinely missing from this app's own primitives (a native
     grouped settings form, a native date/time picker, a native menu), check
     the installed `expo-ui` skill's universal components before hand-rolling
     one — but note `@expo/ui` isn't installed yet, so pulling it in is a new
     dependency decision, not a drop-in. Its universal (`Host`/`Column`/`Row`)
     layer needs SDK 56+; this app is SDK 52, so only the older
     platform-specific trees (`@expo/ui/swift-ui`, `@expo/ui/jetpack-compose`)
     apply pre-upgrade, isolated in `.ios.tsx`/`.android.tsx` files under
     `src/ui/` or `src/screens/`.

4. **"Data fetching" here means Firestore sync and the BLE protocol — there is
   no REST client.**
   - `app/package.json` has no `@tanstack/react-query`, `swr`, or bare
     `fetch`-to-a-backend usage. The app's two real data channels are:
     - **Cloud sync** (`app/src/sync/firestoreSync.ts`,
       `sessionsSyncBridge.ts`, `settingsSyncBridge.ts`): Firestore reads/writes
       gated behind Google sign-in (`app/src/auth/`), additive and non-blocking
       — sync failures must never gate core app function (see
       `firestoreSync.ts`'s own `requireUid` pattern and `App.tsx`'s
       `.catch()` around `useAuthStore.getState().init()`). Follow that
       fail-open convention for any new sync code.
     - **The box itself, over BLE** (`app/src/ble/PhoneBoxClient.ts` +
       `protocol.ts`, via `react-native-ble-plx`): this *is* this app's
       "network" — scan → connect → subscribe to status/history
       notifications → read/write characteristics. `protocol.ts`'s wire format
       must stay in lockstep with the firmware contract in
       `firmware/lib/lock_config.py`; treat that pairing as the source of
       truth, not something to redefine app-side.
   - Local persistence: `app/src/storage/storage.ts` (`getJSON`/`setJSON` over
     `AsyncStorage`) for non-sensitive local state, `expo-secure-store` for
     auth tokens (`app/src/auth/secureStorePersistence.ts`,
     `secureStoreKeys.ts`) — never the reverse.
   - If a feature genuinely needs a REST API call to some third-party service
     (not Firestore, not the box), then the installed `expo-data-fetching`
     skill's `fetch` + typed-error + `EXPO_PUBLIC_` env var conventions apply
     normally — this app just hasn't needed that yet.

5. **Project structure — this is an established layout; extend it, don't
   restructure it.** The installed `expo-project-structure` skill is explicitly
   for scaffolding a *new* Expo app and says never to restructure an existing
   one to match — moot here anyway, since this app already independently
   follows several of its best practices:
   - Flat `app/src/<domain>/` folders by concern: `auth/`, `ble/`, `calls/`,
     `screens/`, `stats/`, `storage/`, `store/`, `sync/`, `theme/`, `ui/`.
   - Tests colocated next to source as `*.test.ts` (`protocol.test.ts`,
     `sessionMerge.test.ts`, `stats.test.ts`, etc.), not in a separate
     `__tests__/` tree.
   - Local native modules live under `app/modules/<name>/` (`background-wake`,
     `call-observer`), autolinked via `expo.autolinking.nativeModulesDir` in
     `package.json` — not `npx create-expo-module` at the repo root.
   - A new domain gets its own `app/src/<name>/` folder; a new screen-only
     helper that isn't reused goes beside its screen in `screens/`, mirroring
     how `SettingsPrimitives.tsx` and `CustomLabelsSection.tsx` sit next to
     `SettingsScreen.tsx` rather than in a generic `components/`.

6. **Toast/feedback UI — not adopted yet; here's where it would actually fit.**
   `app/package.json` has no toast library (no `sonner`, no
   `react-native-toast-message`) and no `sonner`-web equivalent — this section
   is a recommendation, not documentation of existing usage. Today, transient
   feedback is handled ad hoc (inline error text driven by `useStore`'s
   `error` field on `DashboardScreen`, `ActivityIndicator` swapped in for a
   disabled `Button` in `SettingsPrimitives.tsx`). If a manager asks for
   toast-style feedback (BLE connection drops, sync failures, a settings write
   that fails), that's a real gap this app has: read the installed `ask-sonner`
   skill for the API shape, but note `sonner` itself is a **web/React** toast
   library — on native RN, adopt a Sonner-shaped native equivalent (e.g.
   `sonner-native` or `react-native-toast-message`) or, given this app's
   "don't add a library it doesn't need" bias (see §3), a small themed toast
   built the same way `AnimatedPressable` was: RN core `Animated`, driven from
   `useTheme()`. Flag this explicitly as a new dependency/pattern decision for
   the manager, not a silent addition.

### Skill Guardrails
- **This app deliberately avoids several common RN dependencies** (no router,
  no Reanimated/gesture-handler, no `@expo/ui`, no Tailwind/NativeWind, no
  toast library, no React Query). Don't reach for the "usual" Expo answer to a
  UI problem before checking whether this app's existing hand-rolled primitive
  already solves it — that's almost always true for tap feedback, sliders,
  theming, and navigation.
- **Tailwind/NativeWind guidance does not apply to this app at all** and
  should not be introduced: `app/package.json` has zero `tailwindcss`/
  `nativewind`/`react-native-css` dependencies, and every screen styles with
  inline styles + `StyleSheet.create` + `theme/tokens.ts`. Do not suggest or
  scaffold Tailwind setup here.
- **Never redefine the BLE wire format app-side.** `app/src/ble/protocol.ts`
  is a contract with `firmware/lib/lock_config.py`; a UI change should consume
  that contract, not adjust it to make a screen easier to build.
- **Firestore sync is additive, never a gate.** Nothing in the app should
  block on sign-in or sync completing (§4's fail-open convention) — a UI
  change that makes a core feature wait on network/auth is a regression here,
  not a simplification.
- **Complement, don't duplicate, the validation skill.** This skill ends at
  "the code is written and matches the app's conventions." Confirming it
  actually renders on an emulator/device or shipping it through EAS is
  `fraim/ai-employee/skills/mobile/expo-react-native-mobile-dev-validation.md`'s
  job — hand off to it, don't re-describe Metro/ADB/EAS steps here.
