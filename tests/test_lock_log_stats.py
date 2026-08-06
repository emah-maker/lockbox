"""Host tests for the pure stats logic in Box-code/lib/lock_log.py.

Only the aggregation (parse_rows / compute_stats) is hardware-independent, so
that is all that can run off-device. The SD mount, record(), and the stats view
render are on-device-only (see the evidence doc). lock_log guards its board /
storage / sdioio imports, so importing it under CPython works and exercises the
real production functions -- no reimplementation.

Run: python tests/test_lock_log_stats.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "Box-code", "lib"))

from lock_log import parse_rows, compute_stats, HEADER, COMPLETED, OVERRIDDEN

_passed = 0
_failed = 0


def check(name, cond):
    global _passed, _failed
    if cond:
        _passed += 1
        print("PASS", name)
    else:
        _failed += 1
        print("FAIL", name)


# --- parse_rows: header, blanks, and malformed lines are dropped ---
lines = [
    HEADER,
    "",
    "300,300,completed",
    "600,120,overridden",
    "garbage line",
    "abc,def,completed",      # non-int -> dropped
    "300,300",                # too few fields -> dropped
    "900,900,completed",
]
rows = parse_rows(lines)
check("parse drops header/blank/malformed -> 3 rows", len(rows) == 3)
check("parse first row values", rows[0] == (300, 300, COMPLETED))
check("parse outcome normalized to overridden", rows[1][2] == OVERRIDDEN)

# --- compute_stats: aggregates over a mixed history (oldest-first order) ---
st = compute_stats(rows)
check("available True for parsed rows", st.available is True)
check("sessions counted", st.sessions == 3)
check("completed counted", st.completed == 2)
check("overridden counted", st.overridden == 1)
check("focus_s summed (300+120+900)", st.focus_s == 1320)
check("longest_s is max actual", st.longest_s == 900)
# newest is last (900,completed); previous is overridden -> streak breaks at 1
check("streak = trailing completed only", st.streak == 1)

# --- streak: a run of trailing completed sessions ---
rows2 = parse_rows([
    "60,10,overridden",
    "300,300,completed",
    "300,300,completed",
    "300,300,completed",
])
st2 = compute_stats(rows2)
check("streak counts 3 trailing completed", st2.streak == 3)
check("streak stops at the earlier override", st2.completed == 3)

# --- all overridden -> zero streak ---
st3 = compute_stats(parse_rows(["300,50,overridden", "300,90,overridden"]))
check("all overridden -> streak 0", st3.streak == 0)
check("all overridden -> completed 0", st3.completed == 0)

# --- empty log (mounted card, no sessions) -> available, all zero ---
st4 = compute_stats(parse_rows([HEADER]))
check("empty log available with zeros", st4.available and st4.sessions == 0
      and st4.focus_s == 0 and st4.streak == 0)

print("\n{} passed, {} failed".format(_passed, _failed))
sys.exit(1 if _failed else 0)
