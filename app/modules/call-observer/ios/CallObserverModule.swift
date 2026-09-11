// CallObserverModule.swift -- native iOS call detection for the PhoneBox app.
//
// Uses CallKit's CXCallObserver, which reports call state changes (incoming /
// connected / ended). IMPORTANT and verified per the RFC: CXCallObserver does
// NOT expose the caller's number/identity (Apple privacy). So this supports
// Tier 1 "any-call alert-through" -- the box lights up when ANY call rings
// while it is locked. True per-contact greenlist is impossible for a
// third-party app on a cellular call; that idea is cancelled, not deferred
// (see background-wake/index.ts's header).
//
// Why there are TWO ways to read call state here, an event AND a getter:
// CXCallObserver's delegate only fires while this process is actually running.
// The moment iOS suspends the app -- which is the normal state of affairs when
// the phone is shut in the box -- the `callChanged` transition happens with
// nobody home to hear it, and it is never replayed on resume. Apple documents
// no background mode that keeps a plain call observer alive, and Expo does not
// buffer events sent before a JS listener attaches.
//
// `calls`, though, is a live snapshot property, not a transition. So the app
// also polls getCurrentCalls() every time it happens to be awake -- and while
// the box is connected it is woken about once a second by the box's own status
// notify (Box-code/lib/lock_ble.py's _push_outbound) under the
// bluetooth-central background mode. A call rings for ~20-30s, so a
// once-a-second poll catches it comfortably. See app/src/calls/CallMonitor.ts.
import ExpoModulesCore
import CallKit

/// The JS-facing `CallState`. Shared by the delegate callback and
/// getCurrentCalls() so a polled call and an evented one can never disagree
/// about what state the same call is in.
private func callState(_ call: CXCall) -> String {
  if call.hasEnded { return "ended" }
  if call.hasConnected { return "connected" }
  return call.isOutgoing ? "dialing" : "incoming"
}

/// Matches the `CallEvent` shape in app/modules/call-observer/index.ts.
private func callPayload(_ call: CXCall) -> [String: Any] {
  return [
    "state": callState(call),
    "outgoing": call.isOutgoing,
    "uuid": call.uuid.uuidString,
  ]
}

public class CallObserverModule: Module {
  private let callObserver = CXCallObserver()
  // Keeps the delegate proxy alive for as long as the module is; CXCallObserver
  // only holds a weak reference to its delegate.
  private var delegateProxy: CallObserverDelegateProxy?

  public func definition() -> ModuleDefinition {
    Name("CallObserver")

    Events("onCall")

    OnCreate {
      let proxy = CallObserverDelegateProxy { [weak self] call in
        self?.sendEvent("onCall", callPayload(call))
      }
      self.delegateProxy = proxy
      // nil queue means the delegate is called on the main queue. Passing a
      // queue here would be a mistake: CXCallObserver holds the queue weakly,
      // so a locally-scoped one is deallocated and delivery silently stops.
      self.callObserver.setDelegate(proxy, queue: nil)
    }

    // CXCallObserver is available on all supported iOS versions; kept as a
    // capability probe so JS can degrade gracefully.
    Function("isAvailable") { () -> Bool in
      return true
    }

    // Synchronous snapshot of every call iOS currently knows about. This is
    // the half that survives suspension -- see the file header. Cheap enough
    // to call on every BLE status tick: it's an array read, no I/O.
    Function("getCurrentCalls") { () -> [[String: Any]] in
      return self.callObserver.calls.map { callPayload($0) }
    }
  }
}

// CXCallObserverDelegate extends NSObjectProtocol, which Expo's `Module` base
// class can't verifiably conform to across the module boundary (Swift error:
// "cannot declare conformance to 'NSObjectProtocol'; should inherit 'NSObject'
// instead"). So the delegate lives on this plain NSObject proxy instead.
private class CallObserverDelegateProxy: NSObject, CXCallObserverDelegate {
  private let onChange: (CXCall) -> Void

  init(onChange: @escaping (CXCall) -> Void) {
    self.onChange = onChange
  }

  func callObserver(_ callObserver: CXCallObserver, callChanged call: CXCall) {
    onChange(call)
  }
}
