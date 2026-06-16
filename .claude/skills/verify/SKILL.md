---
name: verify
description: Verify One-A-Day UI behavior with Playwright. Use when asked to verify, test, or confirm a feature works in the browser.
---

# Verify — One-A-Day

## How to run

```bash
cd /home/tjrandall/code/one-a-day
python3 -m http.server 8099 &
SERVER_PID=$!
sleep 1
python3 tests/ui_tests.py
kill $SERVER_PID
```

## What the test suite covers

`tests/ui_tests.py` boots the app in a headless Chromium browser via Playwright and verifies:

1. **Raptor gate** — all JS unit tests pass (OAD.boot() runs tests before rendering).
2. **Cadence recurrence edit round-trip** — opens the Edit modal for an existing cadence, switches recurrence to `weekly-days`, checks Mon / Wed / Fri, saves, and asserts that `recurrence`, `days_of_week`, and the formatted display label are all correct in OAD.DB.

## Interpreting results

- `PASS` lines mean assertions held.
- `FAIL` lines print the expected vs. actual values.
- Any `PAGE ERROR` indicates a JS syntax or runtime error that needs fixing before the UI tests mean anything.

## Adding new tests

Add functions to `tests/ui_tests.py` prefixed with `test_`. The `run_tests()` harness at the bottom discovers and calls them in order, collects pass/fail counts, and exits with code 1 if any fail.
