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
    page.goto(f"{BASE_URL}/?tests=true")
    page.wait_for_selector("#test-overlay")


def _dismiss_overlay(page):
    """Click 'Launch App' if the test overlay is visible."""
    btn = page.query_selector("#test-overlay button")
    if btn:
        btn.click()
        page.wait_for_selector("#test-overlay", state="detached")


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


def test_day_brief_box(page):
    """The Daily box shows a measured reply, and Yes is what writes the threads."""
    print("\ntest_day_brief_box")
    result = page.evaluate("""async () => {
        OAD._DB_PERSIST = false;
        if (OAD.supabase) OAD.supabase = null;
        const before = (OAD.DB.threads || []).slice();
        const call = OAD.addThread(OAD.makeThread({
            title: '__day_brief_call__',
            status: 'open',
            next_action: 'Call the bank',
            next_action_date: '2026-11-10'
        }));
        const proposal = await OAD.DayBrief.propose('Monday loop', {
            today: '2026-11-04',
            threads: OAD.DB.threads,
            complete: async () => ({
                date: '2026-11-09',
                kind: 'windshield',
                stops: ['Norwood, MA', 'Brockton, MA'],
                question: null,
                creates: [{ title: '__day_brief_abigail__', life_area: 'Family' }],
                schedule: [call.uuid],
                keep_off: [],
                because: 'The desk is gone. Calls fit in the car.'
            }),
            measure: async () => ({ miles: 110, minutes: 180 })
        });
        OAD.DayBrief.pending = proposal;
        const host = document.createElement('div');
        host.innerHTML = OAD.DayBrief.boxHtml();
        document.body.appendChild(host);
        const reply = host.querySelector('.day-brief-reply');
        const yes = host.querySelector('#day-brief-yes');
        const replyText = reply ? reply.textContent : '';
        const yesDisabled = !!(yes && yes.disabled);
        yes.click();
        const created = (OAD.DB.threads || []).find(t => t.title === '__day_brief_abigail__');
        const scheduled = OAD.getThread(call.id);
        const snapshot = {
            reply: replyText,
            yesDisabled: yesDisabled,
            impact: created ? created.day_impact : null,
            miles: created ? created.travel_miles : null,
            deadline: created ? created.deadline : 'missing',
            callDate: scheduled ? scheduled.next_action_date : null,
            pendingCleared: OAD.DayBrief.pending === null,
            hasBox: !!host.querySelector('#day-brief')
        };
        OAD.DB.threads = before;
        OAD.DayBrief.pending = null;
        host.remove();
        return snapshot;
    }""")
    _assert(result["hasBox"], "the day brief box renders")
    _assert("110 miles" in result["reply"], "the reply states the measured miles")
    _assert("windshield" in result["reply"], "the reply names a windshield day")
    _assert(result["yesDisabled"] is False, "Yes is enabled when the brief is complete")
    _assert_eq(result["impact"], "windshield", "Yes stores the appointment as windshield")
    _assert_eq(result["miles"], 110, "Yes stores the measured miles")
    _assert(result["deadline"] in (None, ""), "Yes does not set a deadline")
    _assert_eq(result["callDate"], "2026-11-09", "Yes parks the call on Monday")
    _assert(result["pendingCleared"], "Yes clears the proposal")


def test_ai_provider_dropdown(page):
    """Settings selects one provider, then shows that provider's key. The day box stays quiet."""
    print("\ntest_ai_provider_dropdown")
    result = page.evaluate("""() => {
        OAD._DB_PERSIST = false;
        if (OAD.supabase) OAD.supabase = null;
        const orig = OAD.AI_PROVIDER;
        OAD.AI_PROVIDER = 'anthropic';
        OAD.openSettingsModal();
        const modal = document.getElementById('modal-overlay');
        const text = modal ? modal.innerText : '';
        const provider = document.getElementById('f-ai-provider');
        const options = provider ? Array.from(provider.options).map(o => o.value) : [];
        function shown() {
            return {
                claude: document.getElementById('f-claude-key-container').style.display,
                gemini: document.getElementById('f-gemini-key-container').style.display,
                xai: document.getElementById('f-xai-key-container').style.display
            };
        }
        const claude = shown();
        provider.value = 'xai';
        provider.onchange();
        const xai = shown();
        const model = document.getElementById('f-xai-model').value;
        provider.value = 'gemini';
        provider.onchange();
        const gemini = shown();
        OAD.closeModal();
        OAD.AI_PROVIDER = orig;
        const box = OAD.DayBrief.boxHtml();
        return {
            options: options,
            claude: claude,
            xai: xai,
            gemini: gemini,
            model: model,
            lecture: text.indexOf('Tell me about a day') !== -1 || text.indexOf('Nothing is sent') !== -1,
            boxLecture: box.indexOf('API key') !== -1 || box.indexOf('Nothing is sent') !== -1 || box.indexOf('localStorage') !== -1
        };
    }""")
    _assert_eq(result["options"], ["anthropic", "gemini", "xai"], "the provider list is Claude, Gemini, and xAI")
    _assert_eq(result["claude"]["claude"], "block", "Claude shows its own key")
    _assert_eq(result["claude"]["gemini"], "none", "Claude hides the Gemini key")
    _assert_eq(result["claude"]["xai"], "none", "Claude hides the xAI key")
    _assert_eq(result["xai"]["xai"], "block", "xAI shows its own key")
    _assert_eq(result["xai"]["claude"], "none", "xAI hides the Claude key")
    _assert_eq(result["xai"]["gemini"], "none", "xAI hides the Gemini key")
    _assert_eq(result["model"], "grok-4.7", "xAI offers the Grok model")
    _assert_eq(result["gemini"]["gemini"], "block", "Gemini shows its own key")
    _assert_eq(result["gemini"]["xai"], "none", "Gemini hides the xAI key")
    _assert(result["lecture"] is False, "Settings does not explain the day box")
    _assert(result["boxLecture"] is False, "the day box does not explain keys")


def test_daily_work_surface(page):
    """Daily opens the day box on demand, and the edit form keeps the week load."""
    print("\ntest_daily_work_surface")
    result = page.evaluate("""() => {
        OAD._DB_PERSIST = false;
        if (OAD.supabase) OAD.supabase = null;
        const before = (OAD.DB.threads || []).slice();
        const expanded = OAD.DayBrief.expanded;
        const pending = OAD.DayBrief.pending;
        OAD.DB.threads = [];
        const today = OAD.todayStr();
        const dated = OAD.addThread(OAD.makeThread({
            title: '__daily_dated__',
            status: 'open',
            next_action: 'Do the work',
            next_action_date: today
        }));
        OAD.addThread(OAD.makeThread({ title: '__daily_undated__', status: 'open' }));
        OAD.DayBrief.expanded = false;
        OAD.DayBrief.pending = null;
        OAD.renderDailyView();
        const closed = !document.getElementById('day-brief');
        document.getElementById('day-brief-open').click();
        const opened = !!document.getElementById('day-brief');
        document.getElementById('day-brief-open').click();
        const closedAgain = !document.getElementById('day-brief');
        const text = document.getElementById('detail-content').innerText;
        OAD.openEditModal(dated.id);
        const modal = document.getElementById('modal-overlay');
        const load = modal.textContent.indexOf("This Week's Load") !== -1;
        const row = modal.querySelectorAll('.load-row[data-date]')[1];
        const iso = row.getAttribute('data-date');
        row.click();
        const dateValue = document.getElementById('f-next-date').value;
        const marked = row.classList.contains('load-row-selected');
        OAD.closeModal();
        OAD.DB.threads = before;
        OAD.DayBrief.expanded = expanded;
        OAD.DayBrief.pending = pending;
        return {
            closed: closed,
            opened: opened,
            closedAgain: closedAgain,
            dated: text.indexOf('__daily_dated__') !== -1,
            undated: text.indexOf('__daily_undated__') !== -1,
            counters: text.indexOf('Load Overview') !== -1,
            heat: text.indexOf('Life Areas Heat') !== -1,
            loadOnDaily: text.indexOf("This Week's Load") !== -1,
            load: load,
            dateValue: dateValue,
            iso: iso,
            marked: marked
        };
    }""")
    _assert(result["closed"], "the day box starts closed")
    _assert(result["opened"], "Tell me about a day opens the box")
    _assert(result["closedAgain"], "the button closes the box")
    _assert(result["dated"], "dated work stays on Daily")
    _assert(result["undated"] is False, "undated work stays off Daily")
    _assert(result["counters"] is False, "the counter cards stay off Daily")
    _assert(result["heat"] is False, "Life Areas Heat stays off Daily")
    _assert(result["loadOnDaily"] is False, "This Week's Load stays off Daily")
    _assert(result["load"], "edit keeps This Week's Load")
    _assert_eq(result["dateValue"], result["iso"], "clicking a day sets By Date")
    _assert(result["marked"], "the chosen day is marked")


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
        // Self-sufficient (creates its own cadence), matching the sibling
        // test_mark_cadence_done_advances_next_due — cadences are Threads now
        // (ARCHITECTURE_RULES.md Rule 1), and OAD.DB.threads is intentionally reset after the
        // unit-test suite runs (so unit-test debris can't leak into the real rendered page), so
        // this can no longer rely on a leftover cadence fixture surviving that reset the way the
        // old, separate OAD.DB.cadences array incidentally let it.
        const c = OAD.addCadence(OAD.makeCadence({
            title: '__ui_test_recurrence_edit__',
            recurrence: 'monthly-1st',
            days_of_week: []
        }));
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
        // Snapshot primitives before cleanup — getCadence returns a live reference.
        const afterRecurrence = after.recurrence;
        const afterDays = after.days_of_week.slice();
        const displayLabel = OAD.formatRecurrence(after);

        // Delete the temporary cadence so the test is non-destructive (own fixture, own cleanup).
        OAD.deleteCadence(c.id);

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


def test_command_center_nav_present_when_demo_module_loaded(page):
    """
    "My Team" (Command Center) is entirely fq-demo-module content (js/dashboard.js was
    relocated to modules/demo/dashboard.js). In the normal case — module present, as it is
    in this harness — the nav button must render and renderCommandCenter() must actually work,
    not just exist.
    """
    print("\ntest_command_center_nav_present_when_demo_module_loaded")
    result = page.evaluate("""() => {
        // renderHeaderActions() is normally called from _bootAfterAuth (tests/tests.js),
        // which this harness's test-mode dismiss flow doesn't route through — call it
        // directly here, same as real boot does.
        OAD.renderHeaderActions();
        var header = document.querySelector('.header-actions');
        var hasButton = header.innerHTML.includes('OAD.renderCommandCenter()');
        var renderOk = true, renderError = null;
        try {
            OAD.renderCommandCenter();
        } catch (e) {
            renderOk = false;
            renderError = e.message;
        }
        return { isFunction: typeof OAD.renderCommandCenter === 'function', hasButton, renderOk, renderError };
    }""")
    _assert(result["isFunction"], "OAD.renderCommandCenter is defined when the demo module loads")
    _assert(result["hasButton"], "the My Team nav button is present in the rendered header")
    _assert(result["renderOk"], f"renderCommandCenter() runs without throwing (error: {result['renderError']})")


def test_app_degrades_gracefully_without_demo_module(browser_type):
    """
    Simulates the fq-demo submodule being entirely absent (e.g. a checkout that skipped
    `git submodule update`, or the module repo being unreachable). The app -- core, not the
    demo module -- must still boot cleanly with zero JS errors, and the My Team nav button
    must simply not render rather than pointing at an undefined function.
    """
    print("\ntest_app_degrades_gracefully_without_demo_module")
    browser = browser_type.launch()
    page = browser.new_page()
    page_errors = []
    page.on("pageerror", lambda exc: page_errors.append(str(exc)))
    page.route("**/modules/demo/*.js", lambda route: route.abort())

    page.goto(f"{BASE_URL}/?tests=true")
    page.wait_for_selector("#test-overlay")
    _dismiss_overlay(page)

    result = page.evaluate("""() => {
        var header = document.querySelector('.header-actions');
        return {
            renderCommandCenterType: typeof OAD.renderCommandCenter,
            demoType: typeof OAD.Demo,
            hasButton: header.innerHTML.includes('OAD.renderCommandCenter()')
        };
    }""")
    browser.close()

    _assert(not page_errors, f"zero JS errors when the demo module fails to load (got: {page_errors})")
    _assert_eq(result["renderCommandCenterType"], "undefined", "OAD.renderCommandCenter is genuinely undefined, not a stub")
    _assert_eq(result["demoType"], "undefined", "OAD.Demo (roles) is also genuinely undefined")
    _assert(not result["hasButton"], "the My Team nav button correctly does not render, rather than pointing at an undefined function")


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
        test_day_brief_box(page)
        test_ai_provider_dropdown(page)
        test_daily_work_surface(page)

        # 2. Dismiss overlay to enter main app
        _dismiss_overlay(page)

        # 3. Run UI tests
        test_cadence_recurrence_edit_round_trip(page)
        test_mark_cadence_done_advances_next_due(page)
        test_command_center_nav_present_when_demo_module_loaded(page)

        browser.close()

        # 4. Separate browser context: demo module deliberately blocked
        test_app_degrades_gracefully_without_demo_module(p.chromium)

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
