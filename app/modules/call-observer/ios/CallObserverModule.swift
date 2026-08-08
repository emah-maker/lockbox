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

public class CallObserverModule: Module {
  private let callObserver = CXCallObserver()
  // Keeps the delegate proxy alive for as long as the module is; CXCallObserver
  // only holds a weak reference to its delegate.
  private var delegateProxy: CallObserverDelegateProxy?

  public func definition() -> ModuleDefinition {
    Name("CallObserver")

    Events("onCall")

    OnCreate {
      let proxy = CallObserverDelegateProxy { [weak self] state, call in
        self?.sendEvent("onCall", [
          "state": state,
          "outgoing": call.isOutgoing,
          "uuid": call.uuid.uuidString,
        ])
      }
      self.delegateProxy = proxy
      self.callObserver.setDelegate(proxy, queue: nil)
    }

    // CXCallObserver is available on all supported iOS versions; kept as a
    // capability probe so JS can degrade gracefully.
    Function("isAvailable") { () -> Bool in
      return true
    }
  }
}

// CXCallObserverDelegate extends NSObjectProtocol, which Expo's `Module` base
// class can't verifiably conform to across the module boundary (Swift error:
// "cannot declare conformance to 'NSObjectProtocol'; should inherit 'NSObject'
// instead"). So the delegate lives on this plain NSObject proxy instead.
private class CallObserverDelegateProxy: NSObject, CXCallObserverDelegate {
  private let onChange: (String, CXCall) -> Void

  init(onChange: @escaping (String, CXCall) -> Void) {
    self.onChange = onChange
  }

  func callObserver(_ callObserver: CXCallObserver, callChanged call: CXCall) {
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
    onChange(state, call)
  }
}
