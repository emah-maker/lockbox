"""Runs every firmware test in tests/, each in its own interpreter.

WHY A RUNNER AND NOT `python -m unittest discover`. These are plain scripts,
not unittest cases -- each one installs its own stand-ins for the
CircuitPython modules the firmware imports (board, storage, displayio, ...)
and then exercises real behaviour against them. Those stand-ins differ by
file, deliberately: the log tests want a `storage` that records what was
written, while the controller tests only need `import storage` to succeed.

sys.modules is per-interpreter, and the first import wins. So running them all
in ONE process means whichever file imports lock_log first binds it to that
file's stubs, and every later file silently measures the wrong thing --
`unittest discover` has been reporting six failures in test_lock_log_queue.py
for exactly this reason, while the same file passes on its own. That is the
worst shape for a test suite to be in: green one way, red the other, with the
red one wrong.

One process per file is what each file's own docstring already tells you to do
("Run: python tests/test_x.py"). This just does it for all of them and adds up
the results.

Run: python tests/run_firmware_tests.py
"""
import glob
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def _clear_bytecode():
    """Delete any cached firmware bytecode before running.

    CPython caches .pyc by (mtime, size), and an edit that changes neither --
    flipping `<` to `>`, say -- can leave a stale cache in play. That bit
    during a mutation check: the source said one thing, the loaded module did
    another, and the run was quietly measuring code that no longer existed on
    disk. A mutation test that silently passes because it never loaded the
    mutation is worse than no mutation test.
    """
    import shutil
    for d in (os.path.join(os.path.dirname(HERE), "firmware", "lib", "__pycache__"),
              os.path.join(HERE, "__pycache__")):
        shutil.rmtree(d, ignore_errors=True)


def main():
    _clear_bytecode()
    files = sorted(glob.glob(os.path.join(HERE, "test_*.py")))
    if not files:
        print("no firmware tests found in " + HERE)
        return 1

    failed_files = []
    total_passed = 0
    total_failed = 0

    for path in files:
        name = os.path.basename(path)
        proc = subprocess.run(
            [sys.executable, path],
            capture_output=True,
            text=True,
            cwd=os.path.dirname(HERE),
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        # Each file ends with "N passed, M failed"; fall back to the exit code
        # if it died before printing that (an import error, say).
        passed = failed = None
        for line in reversed(out.strip().splitlines()):
            if " passed, " in line and line.strip().endswith("failed"):
                try:
                    parts = line.replace(" passed,", "").replace(" failed", "").split()
                    passed, failed = int(parts[0]), int(parts[1])
                except (ValueError, IndexError):
                    pass
                break

        if passed is None:
            print("{:<44} DID NOT REPORT (exit {})".format(name, proc.returncode))
            print(out.strip()[-1500:])
            failed_files.append(name)
            continue

        total_passed += passed
        total_failed += failed
        status = "ok" if (failed == 0 and proc.returncode == 0) else "FAILED"
        print("{:<44} {:>4} passed {:>3} failed  {}".format(name, passed, failed, status))
        if failed or proc.returncode != 0:
            failed_files.append(name)
            for line in out.splitlines():
                if line.startswith("FAIL"):
                    print("      " + line)

    print("\n{} files, {} checks passed, {} failed".format(len(files), total_passed, total_failed))
    if failed_files:
        print("failing files: " + ", ".join(failed_files))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
