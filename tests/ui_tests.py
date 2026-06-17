#!/usr/bin/env python3
"""
One-A-Day Playwright UI tests.

Run via:
  python3 -m http.server 8099 &
  python3 tests/ui_tests.py
  kill %1

The /verify skill runs these automatically — see .claude/skills/verify/SKILL.md.
"""
import sys
import os
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8099")
_passes = []
_failures = []


# ── Helpers ────────────────────────────────────────────────────────────────────

def _assert(condition, label):
    if condition:
        _passes.append(label)
        print(f"  PASS  {label}")
    else:
        _failures.append(label)
        print(f"  FAIL  {label}")


def _assert_eq(actual, expected, label):
    if actual == expected:
        _passes.append(label)
        print(f"  PASS  {label}")
    else:
        _failures.append(label)
        print(f"  FAIL  {label}")
        print(f"        expected: {expected!r}")
        print(f"        actual:   {actual!r}")


def _boot(page):
    """Load the app and bypass the test overlay."""
    page.add_init_script("window.OAD = window.OAD || {}; window.OAD.supabase = null;")
    page.goto(BASE_URL)
    page.wait_for_timeout(2000)


def _dismiss_overlay(page):
    """Click 'Launch App' if the test overlay is visible."""
    btn = page.query_selector("#test-overlay button")
    if btn:
        btn.click()
        page.wait_for_timeout(1000)


# ── Tests ──────────────────────────────────────────────────────────────────────

def test_raptor_gate(page):
    """All JS unit tests must pass before the UI renders (Raptor Principle)."""
    print("\ntest_raptor_gate")
    full_text = page.evaluate("() => document.body.innerText")
    lines = full_text.split("\n")
    page_errors = []
    passed = sum(1 for l in lines if l.strip().startswith("✓"))
    failed_lines = [l for l in lines if l.strip().startswith(("✗", "✕", "×"))]
    _assert(not page_errors, "no JS page errors on load")
    _assert(passed >= 84, f"at least 84 unit tests pass (got {passed})")
    if failed_lines:
        print("  Failing unit tests:")
        for fl in failed_lines:
            print(f"    {fl}")
    _assert(len(failed_lines) == 0, f"no unit test failures (got {len(failed_lines)})")


def test_cadence_recurrence_edit_round_trip(page):
    """
    Edit an existing cadence via the UI:
      - change recurrence to weekly-days
      - select Mon, Wed, Fri
      - save
    Assert the cadence's recurrence, days_of_week, and formatRecurrence label
    are all correct in OAD.DB.
    """
    print("\ntest_cadence_recurrence_edit_round_trip")
    result = page.evaluate("""() => {
        const cadences = OAD.DB.cadences;
        if (!cadences.length) return { error: 'no cadences in DB' };

        const c = cadences[0];
        const before = { recurrence: c.recurrence, days_of_week: (c.days_of_week || []).slice() };

        OAD.openEditCadenceModal(c.id);

        const select = document.getElementById('cd-recurrence');
        const boxes = document.querySelectorAll('.cd-dow');
        if (!select) return { error: 'no cd-recurrence select in modal' };
        if (boxes.length !== 7) return { error: `expected 7 dow checkboxes, got ${boxes.length}` };

        // Uncheck all, then select Mon (1), Wed (3), Fri (5)
        boxes.forEach(b => { b.checked = false; });
        select.value = 'weekly-days';
        boxes[1].checked = true;
        boxes[3].checked = true;
        boxes[5].checked = true;

        OAD._saveEditCadence(c.id);
        OAD.closeModal();

        const after = OAD.getCadence(c.id);
        // Snapshot primitives before restore — getCadence returns a live reference.
        const afterRecurrence = after.recurrence;
        const afterDays = after.days_of_week.slice();
        const displayLabel = OAD.formatRecurrence(after);

        // Restore to original so test is non-destructive
        OAD.updateCadence(c.id, { recurrence: before.recurrence, days_of_week: before.days_of_week });

        return { afterRecurrence, afterDays, displayLabel };
    }""")

    if "error" in (result or {}):
        _assert(False, f"setup: {result['error']}")
        return

    _assert_eq(result["afterRecurrence"], "weekly-days",
               "recurrence updated to weekly-days")
    _assert_eq(result["afterDays"], [1, 3, 5],
               "days_of_week saved as [Mon, Wed, Fri]")
    _assert_eq(result["displayLabel"], "weekly-days (Mon, Wed, Fri)",
               "formatRecurrence label correct")


def test_mark_cadence_done_advances_next_due(page):
    """
    markCadenceDone should set last_completed to today and advance next_due
    to the next occurrence per the cadence's recurrence rule.

    Uses a temporary weekly-days cadence targeting Wednesdays so the expected
    next_due weekday is deterministic regardless of when the test runs.
    """
    print("\ntest_mark_cadence_done_advances_next_due")
    result = page.evaluate("""() => {
        const c = OAD.addCadence(OAD.makeCadence({
            title: '__ui_test_mark_done__',
            recurrence: 'weekly-days',
            days_of_week: [3]   // Wednesday
        }));

        OAD.markCadenceDone(c.id);

        const after = OAD.getCadence(c.id);
        const lastCompleted = after.last_completed;
        const nextDue = after.next_due;
        const nextDueDay = nextDue
            ? new Date(nextDue + 'T00:00:00').getDay()
            : null;

        OAD.deleteCadence(c.id);

        return { lastCompleted, nextDue, nextDueDay };
    }""")

    _assert(result["lastCompleted"] is not None,
            "last_completed set to a date string")
    _assert(result["nextDue"] is not None,
            "next_due is not null after marking done")
    _assert(result["nextDue"] > result["lastCompleted"],
            f"next_due ({result['nextDue']}) is after last_completed ({result['lastCompleted']})")
    _assert_eq(result["nextDueDay"], 3,
               "next_due lands on a Wednesday (days_of_week: [3])")


# ── Harness ────────────────────────────────────────────────────────────────────

def run_tests():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page_errors = []
        page.on("pageerror", lambda exc: page_errors.append(str(exc)))

        _boot(page)

        # 1. Run raptor gate tests while overlay is visible
        test_raptor_gate(page)

        # 2. Dismiss overlay to enter main app
        _dismiss_overlay(page)

        # 3. Run UI tests
        test_cadence_recurrence_edit_round_trip(page)
        test_mark_cadence_done_advances_next_due(page)

        browser.close()

    total = len(_passes) + len(_failures)
    print(f"\n{'─' * 40}")
    print(f"{len(_passes)}/{total} assertions passed")
    if _failures:
        print("Failed:")
        for f in _failures:
            print(f"  • {f}")
        sys.exit(1)
    else:
        print("All assertions passed.")


if __name__ == "__main__":
    run_tests()
