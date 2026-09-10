// debounce.ts -- one trailing-edge debouncer, because two different modules
// had independently written the same one.
//
// goals/goalNotificationBridge.ts and store/useScheduleStore.ts each kept a
// module-level `resyncTimer`, the same clear-then-reset-then-fire body, the
// same 400ms constant, and the same "cancel a pending call in the teardown"
// clause. Both exist for the identical reason -- a burst of store emissions
// (a drained box-history batch, a settings change that emits several times in
// a tick) would otherwise trigger a full cancel-and-reschedule pass against
// the OS notification scheduler per emission.
//
// `cancel()` is not optional convenience: both call sites are started and
// stopped by a watch whose teardown must not leave a timer armed to fire
// against a torn-down subscription.
export interface Debouncer {
  /** Restart the timer. The wrapped function runs once, `delayMs` after the
   * most recent call. */
  run: () => void;
  /** Drop a pending call, if any. Safe to call when nothing is pending. */
  cancel: () => void;
}

export function createDebouncer(fn: () => void, delayMs: number): Debouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return {
    run: () => {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, delayMs);
    },
    cancel,
  };
}
