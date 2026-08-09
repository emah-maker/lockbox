// BackgroundWakeModule.swift -- JS-facing half of the background-wake
// foundation. The other half -- launch-reason detection -- has to run
// natively before JS boots and lives in
// BackgroundWakeAppDelegateSubscriber.swift; this module surfaces that
// already-captured state (BackgroundWakeState) to JS, following the same
// thin-Swift-wrapper convention as
// app/modules/call-observer/ios/CallObserverModule.swift.
//
// This module previously also exposed PushKit VoIP token/payload events for
// a planned call-greenlist feature; that feature was cancelled (see
// BackgroundWakeState.swift's header comment), so this module is now just a
// single function plus a single replay-buffered event.
import ExpoModulesCore

public class BackgroundWakeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BackgroundWake")

    Events("onBackgroundWake")

    Function("getLaunchReason") { () -> String in
      BackgroundWakeState.launchReason.rawValue
    }

    // Replays the launch reason to the first listener that starts observing
    // -- the native side captures it in AppDelegate, before the JS bundle
    // even finishes booting, so without this replay a listener attached
    // from App.tsx's initial render would miss an event that already fired.
    OnStartObserving("onBackgroundWake") {
      if BackgroundWakeState.launchReason != .normal {
        self.sendEvent("onBackgroundWake", ["reason": BackgroundWakeState.launchReason.rawValue])
      }
    }
  }
}
