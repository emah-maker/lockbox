// CallObserverModule.swift -- native iOS call detection for the PhoneBox app.
//
// Uses CallKit's CXCallObserver, which reports call state changes (incoming /
// connected / ended) even when the app is backgrounded. IMPORTANT and verified
// per the RFC: CXCallObserver does NOT expose the caller's number/identity
// (Apple privacy). So this supports Tier 1 "any-call alert-through" -- the box
// lights up when ANY call rings while it is locked. True per-contact greenlist
// requires routing the call through the app as VoIP (PushKit + CallKit); that is
// a later phase and is stubbed in JS (see CallMonitor.ts).
import ExpoModulesCore
import CallKit

public class CallObserverModule: Module, CXCallObserverDelegate {
  private let callObserver = CXCallObserver()

  public func definition() -> ModuleDefinition {
    Name("CallObserver")

    Events("onCall")

    OnCreate {
      self.callObserver.setDelegate(self, queue: nil)
    }

    // CXCallObserver is available on all supported iOS versions; kept as a
    // capability probe so JS can degrade gracefully.
    Function("isAvailable") { () -> Bool in
      return true
    }
  }

  public func callObserver(_ callObserver: CXCallObserver, callChanged call: CXCall) {
    let state: String
    if call.hasEnded {
      state = "ended"
    } else if call.hasConnected {
      state = "connected"
    } else if !call.isOutgoing {
      state = "incoming"
    } else {
      state = "dialing"
    }
    sendEvent("onCall", [
      "state": state,
      "outgoing": call.isOutgoing,
      "uuid": call.uuid.uuidString,
    ])
  }
}
