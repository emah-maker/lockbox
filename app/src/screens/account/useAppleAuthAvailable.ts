// useAppleAuthAvailable.ts -- "can this device offer Sign in with Apple?",
// asked once per mount.
//
// A runtime capability check, deliberately not `Platform.OS === 'ios'`:
// isAvailableAsync() is false on Android and also on iOS versions/devices
// where Sign in with Apple isn't offered, which keeps the button from ever
// being shown somewhere it would just fail. That reasoning, the
// cancelled-flag cleanup, and the initial `false` were written out twice --
// once in SignedOutAccount.tsx for the sign-in button, once in
// SignInMethodsSection.tsx for the "Link Apple" action -- so a fix to either
// (the cleanup was the kind of thing that gets added to one and not the
// other) applied to only half the app.
//
// Starts false rather than null/undefined: "not yet known" and "not
// available" render identically here (no Apple affordance), so a tri-state
// would buy nothing but an extra branch at both call sites.
import React from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';

export function useAppleAuthAvailable(): boolean {
  const [available, setAvailable] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    // .catch, not a bare .then: isAvailableAsync() rejects outright (rather
    // than resolving false) when the native module isn't linked into the
    // build at all -- Expo Go, or a dev client built before
    // expo-apple-authentication was added. Unhandled, that surfaces as a red
    // RN warning box over the Account page about a promise nobody awaited,
    // for a condition whose correct answer is simply "no Apple button here".
    AppleAuthentication.isAvailableAsync()
      .catch(() => false)
      .then((isAvailable) => {
        if (!cancelled) setAvailable(isAvailable);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return available;
}
