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


def test_health_panel_opens_the_thread(page):
    """A calendar appointment stays off the lead-time list, and the title opens the thread."""
    print("\ntest_health_panel_opens_the_thread")
    result = page.evaluate("""() => {
        const origThreads = OAD.DB.threads;
        const origAlerts = OAD.DB.health_alerts;
        const origSuppress = OAD._suppressSaveDB;
        const origPersist = OAD._DB_PERSIST;
        const origActive = OAD._activeId;
        OAD._suppressSaveDB = true;
        OAD._DB_PERSIST = false;
        try {
            const cap = OAD.makeThread({
                id: 9001,
                uuid: 'ui-cap-appt',
                title: 'UI Cap Appointment',
                status: 'open',
                day_impact: 'partial',
                next_action_date: '2026-11-24',
                deadline: '2026-11-24'
            });
            const work = OAD.makeThread({
                id: 9002,
                uuid: 'ui-capstone',
                title: 'UI Capstone Milestone',
                status: 'open',
                day_impact: '',
                next_action_date: '2026-12-15',
                deadline: '2026-12-15'
            });
            const dupA = OAD.makeThread({
                id: 9003,
                uuid: 'ui-dup-a',
                title: 'UI Dentist Appointment Cap prep',
                status: 'open',
                day_impact: 'partial',
                next_action_date: '2026-11-24',
                deadline: '2026-11-24'
            });
            const dupB = OAD.makeThread({
                id: 9004,
                uuid: 'ui-dup-b',
                title: 'UI Dentist Appointment Cap prep',
                status: 'open',
                day_impact: 'partial',
                next_action_date: '2026-12-08',
                deadline: '2026-12-08'
            });
            OAD.DB.threads = [cap, work, dupA, dupB];
            OAD.DB.health_alerts = [];
            const alerts = OAD.visibleHealthAlerts();
            const che002Titles = alerts.filter(a => a.type === 'CHE-002').map(a => a.thread_title);
            OAD.openHealthPanel();
            const modal = document.querySelector('#modal-overlay .modal');
            const text = modal ? modal.innerText : '';
            const buttons = modal ? Array.from(modal.querySelectorAll('button')) : [];
            const capstoneBtn = buttons.find(b => b.textContent.indexOf('UI Capstone Milestone') !== -1);
            if (capstoneBtn) capstoneBtn.click();
            const opened = OAD.getThread(OAD._activeId);
            const overlay = document.getElementById('modal-overlay');
            const modalHidden = !overlay || overlay.classList.contains('hidden');
            return {
                che002Titles: che002Titles,
                textHasCapstone: text.indexOf('UI Capstone Milestone') !== -1,
                textHasCapAppt: text.indexOf('UI Cap Appointment') !== -1,
                textHasOther: text.indexOf('Open the other copy') !== -1,
                openedTitle: opened ? opened.title : null,
                modalHidden: modalHidden
            };
        } finally {
            OAD.DB.threads = origThreads;
            OAD.DB.health_alerts = origAlerts;
            OAD._suppressSaveDB = origSuppress;
            OAD._DB_PERSIST = origPersist;
            OAD._activeId = origActive;
            OAD.closeModal();
        }
    }""")
    _assert_eq(result["che002Titles"], ["UI Capstone Milestone"], "only the capstone is missing lead time")
    _assert(result["textHasCapstone"], "the panel names the capstone")
    _assert(result["textHasCapAppt"] is False, "the panel leaves the cap appointment off the lead-time list")
    _assert(result["textHasOther"], "a duplicate offers the other copy")
    _assert_eq(result["openedTitle"], "UI Capstone Milestone", "the title opens that thread")
    _assert(result["modalHidden"], "opening the thread closes the health panel")


def test_day_note_can_close_without_a_thread(page):
    """After the log is saved, thanks-for-listening keeps the sentence and makes no thread."""
    print("\ntest_day_note_can_close_without_a_thread")
    result = page.evaluate("""() => {
        const origThreads = OAD.DB.threads;
        const origNotes = OAD.DB.day_notes;
        const origDays = OAD.DB.matrix_days;
        const origSuppress = OAD._suppressSaveDB;
        const origPersist = OAD._DB_PERSIST;
        const origToday = OAD.todayStr;
        const panel = document.getElementById('detail-content');
        const origHtml = panel ? panel.innerHTML : '';
        OAD._suppressSaveDB = true;
        OAD._DB_PERSIST = false;
        OAD.todayStr = function () { return '2026-11-05'; };
        try {
            OAD.DB.threads = [{ uuid: 'ui-uncovered', title: 'UI Uncovered', status: 'open', evolution_log: [] }];
            OAD.DB.matrix_days = { '2026-11-04': { asked: ['ui-uncovered'], recorded_at: '2026-11-04T12:00:00.000Z' } };
            OAD.DB.day_notes = [];
            OAD.DayNote.save('2026-11-04', 'Worked the short sale instead.');
            const before = OAD.DB.threads.length;
            const host = document.createElement('div');
            host.id = 'day-note-test-host';
            host.innerHTML = OAD.DayNote.barHtml();
            document.body.appendChild(host);
            const thanks = Array.from(host.querySelectorAll('button')).find(b => b.textContent.indexOf('No, but thanks for listening') !== -1);
            const make = Array.from(host.querySelectorAll('button')).find(b => b.textContent.indexOf('Make this a thread') !== -1);
            if (thanks) thanks.click();
            const note = OAD.DayNote.noteFor('2026-11-04');
            const barGone = OAD.DayNote.barHtml() === '';
            host.remove();
            return {
                hadMake: !!make,
                hadThanks: !!thanks,
                threadCount: OAD.DB.threads.length,
                before: before,
                note: note ? note.note : '',
                declined: !!(note && note.declined),
                barGone: barGone
            };
        } finally {
            OAD.DB.threads = origThreads;
            OAD.DB.day_notes = origNotes;
            OAD.DB.matrix_days = origDays;
            OAD._suppressSaveDB = origSuppress;
            OAD._DB_PERSIST = origPersist;
            OAD.todayStr = origToday;
            if (panel) panel.innerHTML = origHtml;
            var host = document.getElementById('day-note-test-host');
            if (host) host.remove();
        }
    }""")
    _assert(result["hadMake"], "a saved log still offers a thread")
    _assert(result["hadThanks"], "a saved log offers thanks for listening")
    _assert_eq(result["threadCount"], result["before"], "thanks for listening creates no thread")
    _assert_eq(result["note"], "Worked the short sale instead.", "the sentence stays")
    _assert(result["declined"], "the offer is closed")
    _assert(result["barGone"], "the log prompt goes away")


def test_capacity_banner_opens_the_thread(page):
    """A thread named in the conflicts notice opens, instead of sending him to List."""
    print("\ntest_capacity_banner_opens_the_thread")
    result = page.evaluate("""() => {
        const origThreads = OAD.DB.threads;
        const origSuppress = OAD._suppressSaveDB;
        const origPersist = OAD._DB_PERSIST;
        const origActive = OAD._activeId;
        const panel = document.getElementById('detail-content');
        const list = document.getElementById('thread-list');
        const origHtml = panel ? panel.innerHTML : '';
        const origList = list ? list.innerHTML : '';
        OAD._suppressSaveDB = true;
        OAD._DB_PERSIST = false;
        try {
            const lost = OAD.makeThread({
                id: 9101,
                uuid: 'ui-lost-day',
                title: 'UI Lost Day',
                status: 'open',
                day_impact: 'full',
                next_action_date: '2026-11-06'
            });
            const late = OAD.makeThread({
                id: 9102,
                uuid: 'ui-late-work',
                title: 'UI Late Work',
                status: 'open',
                deadline: '2026-11-08',
                next_action_date: '2026-11-08'
            });
            OAD.DB.threads = [lost, late];
            const html = OAD.Capacity.bannerHtml(OAD.DB.threads, '2026-11-05');
            const host = document.createElement('div');
            host.id = 'capacity-test-host';
            host.innerHTML = html;
            document.body.appendChild(host);
            const lateBtn = host.querySelector('button.capacity-thread[onclick*="ui-late-work"]');
            const lostBtn = host.querySelector('button.capacity-thread[onclick*="ui-lost-day"]');
            if (lateBtn) lateBtn.click();
            const opened = OAD.getThread(OAD._activeId);
            host.remove();
            return {
                hasBanner: html.indexOf('capacity-banner') !== -1,
                hasLate: !!lateBtn,
                hasLost: !!lostBtn,
                openedTitle: opened ? opened.title : null
            };
        } finally {
            OAD.DB.threads = origThreads;
            OAD._suppressSaveDB = origSuppress;
            OAD._DB_PERSIST = origPersist;
            OAD._activeId = origActive;
            if (panel) panel.innerHTML = origHtml;
            if (list) list.innerHTML = origList;
            var host = document.getElementById('capacity-test-host');
            if (host) host.remove();
        }
    }""")
    _assert(result["hasBanner"], "the notice renders")
    _assert(result["hasLate"], "the late thread is a control")
    _assert(result["hasLost"], "the lost day is a control")
    _assert_eq(result["openedTitle"], "UI Late Work", "the notice opens that thread")


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
        const loadEl = modal.querySelector('.ds-week-load-form');
        const load = modal.textContent.indexOf("This Week's Load") !== -1;
        const loadClosed = !!(loadEl && !loadEl.open);
        if (loadEl) loadEl.open = true;
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
            loadClosed: loadClosed,
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
    _assert(result["loadClosed"], "the week load starts closed")
    _assert_eq(result["dateValue"], result["iso"], "clicking a day sets By Date")
    _assert(result["marked"], "the chosen day is marked")


def test_cadence_recurrence_edit_round_trip(page):
    """
    Edit an existing cadence via the shared repeat panel:
      - set the unit to weeks
      - select Mon, Wed, Fri
      - save
    Assert the repeat rule, days, and label.
    """
    print("\ntest_cadence_recurrence_edit_round_trip")
    result = page.evaluate("""() => {
        const c = OAD.addCadence(OAD.makeCadence({
            title: '__ui_test_recurrence_edit__',
            recurrence: 'monthly-1st',
            days_of_week: []
        }));

        OAD.openEditCadenceModal(c.id);

        const unit = document.getElementById('cd-unit');
        const boxes = document.querySelectorAll('.cd-dow');
        if (!unit) return { error: 'no cd-unit select in modal' };
        if (document.getElementById('cd-recurrence')) return { error: 'the old recurrence token select is still in the modal' };
        if (boxes.length !== 7) return { error: 'expected 7 dow checkboxes, got ' + boxes.length };

        unit.value = 'week';
        OAD.Repeat.syncFields('cd');
        boxes.forEach(b => { b.checked = false; });
        boxes[1].checked = true;
        boxes[3].checked = true;
        boxes[5].checked = true;

        OAD._saveEditCadence(c.id);
        OAD.closeModal();

        const after = OAD.getCadence(c.id);
        const unitAfter = after.repeat && after.repeat.unit;
        const afterDays = (after.days_of_week || []).slice();
        const displayLabel = OAD.formatRecurrence(after);

        OAD.deleteCadence(c.id);

        return { unitAfter, afterDays, displayLabel };
    }""")

    if "error" in (result or {}):
        _assert(False, f"setup: {result['error']}")
        return

    _assert_eq(result["unitAfter"], "week",
               "repeat unit updated to week")
    _assert_eq(result["afterDays"], [1, 3, 5],
               "days_of_week saved as [Mon, Wed, Fri]")
    _assert_eq(result["displayLabel"], "Every Mon, Wed, Fri",
               "repeat label correct")


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


def test_connection_picker_scrolls(page):
    """Add Connection lists threads in a tall, scrollable box with the full title visible."""
    print("\ntest_connection_picker_scrolls")
    seeded = page.evaluate("""() => {
        var host = OAD.addThread(OAD.makeThread({ title: 'Connection host', status: 'open', life_area: 'Housing' }));
        var ids = [host.id];
        for (var i = 0; i < 40; i++) {
            var t = OAD.addThread(OAD.makeThread({
                title: 'Picker option ' + i + ' with a long title that must stay readable while cleaning data',
                status: i % 2 === 0 ? 'open' : 'dormant',
                life_area: 'Housing'
            }));
            ids.push(t.id);
        }
        OAD.openConnectionModal(host.id);
        return { hostId: host.id, ids: ids };
    }""")
    page.wait_for_selector("#f-edge-results .autocomplete-item")
    measured = page.evaluate("""() => {
        var box = document.querySelector('#modal-overlay .modal');
        var results = document.getElementById('f-edge-results');
        var title = results.querySelector('.item-title');
        var addBtn = document.querySelector('#modal-overlay .modal-footer button:last-child');
        var addRect = addBtn.getBoundingClientRect();
        var style = getComputedStyle(results);
        var titleStyle = getComputedStyle(title);
        return {
            hasClass: box.classList.contains('modal-connection'),
            position: style.position,
            clientHeight: results.clientHeight,
            scrollHeight: results.scrollHeight,
            whiteSpace: titleStyle.whiteSpace,
            addVisible: addRect.top >= 0 && addRect.bottom <= window.innerHeight,
            count: document.getElementById('f-edge-count').textContent
        };
    }""")
    _assert(measured["hasClass"], "connection modal keeps the list in the dialog")
    _assert_eq(measured["position"], "static", "results list is in normal flow, not a floating dropdown")
    _assert(measured["clientHeight"] >= 240, f"results box is at least 240px tall (got {measured['clientHeight']})")
    _assert(measured["scrollHeight"] > measured["clientHeight"], f"results list scrolls (scroll {measured['scrollHeight']} > box {measured['clientHeight']})")
    _assert_eq(measured["whiteSpace"], "normal", "option titles wrap")
    _assert(measured["addVisible"], "Add stays on screen while the list scrolls")
    _assert("of" not in measured["count"] and measured["count"].endswith("threads"), f"unfiltered count names the whole list (got {measured['count']!r})")

    picked = page.evaluate("""() => {
        var results = document.getElementById('f-edge-results');
        results.scrollTop = results.scrollHeight;
        var moved = results.scrollTop > 0;
        var items = results.querySelectorAll('.autocomplete-item');
        var last = items[items.length - 1];
        var title = last.getAttribute('data-title');
        last.click();
        return {
            moved: moved,
            uuid: document.getElementById('f-edge-uuid').value,
            display: getComputedStyle(results).display,
            selected: !!results.querySelector('.autocomplete-item.selected'),
            title: title
        };
    }""")
    _assert(picked["moved"], "the list can be scrolled to the last option")
    _assert(bool(picked["uuid"]), "clicking a row selects that thread")
    _assert_eq(picked["display"], "flex", "the list stays open after a selection")
    _assert(picked["selected"], "the selected row stays marked")

    page.evaluate("""(ids) => {
        OAD.closeModal();
        ids.forEach(function (id) { OAD.deleteThread(id); });
    }""", seeded["ids"])


def test_parent_field_makes_a_bollard(page):
    """The thread form can place a task under a parent, and the parent lists it."""
    print("\ntest_parent_field_makes_a_bollard")
    seeded = page.evaluate("""() => {
        var move = OAD.addThread(OAD.makeThread({
            title: 'May 2027 move',
            status: 'dormant',
            life_area: 'Housing',
            dormant_trigger: 'Move in May 2027'
        }));
        var task = OAD.addThread(OAD.makeThread({
            title: 'Book the truck',
            status: 'open',
            life_area: 'Housing'
        }));
        var ids = [move.id, task.id];
        for (var i = 0; i < 24; i++) {
            var extra = OAD.addThread(OAD.makeThread({
                title: 'Parent option ' + i + ' with a long title that must stay readable',
                status: 'open',
                life_area: 'Housing'
            }));
            ids.push(extra.id);
        }
        OAD.openEditModal(task.id);
        return { moveId: move.id, taskId: task.id, moveUuid: move.uuid, taskUuid: task.uuid, ids: ids };
    }""")
    page.wait_for_selector("#f-parent-open")
    closed = page.evaluate("""() => {
        var picker = document.querySelector('.parent-picker');
        var chooser = document.getElementById('f-parent-chooser');
        return {
            hidden: !!(chooser && chooser.hidden),
            hint: picker.textContent.indexOf('Where this thread lives') !== -1,
            label: document.getElementById('f-parent-open').textContent
        };
    }""")
    _assert(closed["hidden"], "the parent list stays closed until asked")
    _assert(closed["hint"] is False, "the parent field does not explain itself")
    _assert_eq(closed["label"], "Add parent", "an empty parent is one button")
    page.evaluate("() => document.getElementById('f-parent-open').click()")
    page.wait_for_selector("#f-parent-results .autocomplete-item")
    measured = page.evaluate("""() => {
        var results = document.getElementById('f-parent-results');
        var title = results.querySelector('.item-title');
        var style = getComputedStyle(results);
        return {
            position: style.position,
            clientHeight: results.clientHeight,
            scrollHeight: results.scrollHeight,
            whiteSpace: getComputedStyle(title).whiteSpace,
            hasNone: !!results.querySelector('.autocomplete-item[data-uuid=""]')
        };
    }""")
    _assert_eq(measured["position"], "static", "parent list is in the form, not a floating menu")
    _assert(measured["clientHeight"] >= 160, f"parent list is tall enough to scroll (got {measured['clientHeight']})")
    _assert(measured["scrollHeight"] > measured["clientHeight"], f"parent list scrolls (scroll {measured['scrollHeight']} > box {measured['clientHeight']})")
    _assert_eq(measured["whiteSpace"], "normal", "parent option titles wrap")
    _assert(measured["hasNone"], "the list offers No parent")

    saved = page.evaluate("""(moveUuid) => {
        var results = document.getElementById('f-parent-results');
        results.scrollTop = results.scrollHeight;
        var moved = results.scrollTop > 0;
        var row = results.querySelector('.autocomplete-item[data-uuid="' + moveUuid + '"]');
        if (row) row.click();
        return { moved: moved, picked: document.getElementById('f-parent-uuid').value };
    }""", seeded["moveUuid"])
    _assert(saved["moved"], "the parent list can be scrolled")
    _assert_eq(saved["picked"], seeded["moveUuid"], "clicking a row selects that parent")

    applied = page.evaluate("""(ids) => {
        OAD._saveEditThread(ids.taskId);
        var task = OAD.getThread(ids.taskId);
        var move = OAD.getThread(ids.moveId);
        var edge = (move.connections || []).some(function (c) {
            return c.to_uuid === task.uuid && c.rule === 'ADE-002' && c.edge_type === 'enables';
        });
        var note = (task.evolution_log || []).some(function (e) { return e.note.indexOf('Parent → May 2027 move') !== -1; });
        OAD.renderDetail(task.id);
        var under = document.getElementById('thread-parent-link');
        OAD.renderDetail(move.id);
        var kids = document.getElementById('thread-children');
        OAD.openEditModal(move.id);
        document.getElementById('f-parent-open').click();
        var childOffered = !!document.querySelector('#f-parent-results .autocomplete-item[data-uuid="' + task.uuid + '"]');
        OAD.closeModal();
        return {
            parent: task.parent_uuid,
            edge: edge,
            note: note,
            under: under ? under.textContent : '',
            kids: kids ? kids.textContent : '',
            childOffered: childOffered
        };
    }""", {"taskId": seeded["taskId"], "moveId": seeded["moveId"]})
    _assert_eq(applied["parent"], seeded["moveUuid"], "saving the form stores the parent")
    _assert(applied["edge"], "the parent gains the structural enables edge")
    _assert(applied["note"], "the log records the parent")
    _assert("May 2027 move" in applied["under"], f"the task says which thread it is under (got {applied['under']!r})")
    _assert("Book the truck" in applied["kids"], "the parent lists the thread under it")
    _assert(not applied["childOffered"], "the parent cannot be placed under its own child")

    cleared = page.evaluate("""(taskId) => {
        OAD.openEditModal(taskId);
        var startedClosed = document.getElementById('f-parent-chooser').hidden;
        var current = document.getElementById('f-parent-current').textContent;
        document.getElementById('f-parent-open').click();
        var none = document.querySelector('#f-parent-results .autocomplete-item[data-uuid=""]');
        if (none) none.click();
        var closedAfter = document.getElementById('f-parent-chooser').hidden;
        var backToAdd = document.getElementById('f-parent-open').textContent;
        OAD._saveEditThread(taskId);
        var task = OAD.getThread(taskId);
        return {
            parent: task.parent_uuid,
            cleared: (task.evolution_log || []).some(function (e) { return e.note.indexOf('Parent cleared') !== -1; }),
            startedClosed: startedClosed,
            current: current,
            closedAfter: closedAfter,
            backToAdd: backToAdd
        };
    }""", seeded["taskId"])
    _assert(cleared["startedClosed"], "a set parent does not open the list")
    _assert("May 2027 move" in cleared["current"], "a set parent keeps the current line")
    _assert(cleared["closedAfter"], "picking a row closes the list")
    _assert_eq(cleared["backToAdd"], "Add parent", "clearing the parent returns to one button")
    _assert(cleared["parent"] in (None, ""), f"clearing the parent stores none (got {cleared['parent']!r})")
    _assert(cleared["cleared"], "the log records that the parent was cleared")

    page.evaluate("""(ids) => {
        OAD.closeModal();
        ids.forEach(function (id) { OAD.deleteThread(id); });
    }""", seeded["ids"])


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
        test_health_panel_opens_the_thread(page)
        test_day_note_can_close_without_a_thread(page)
        test_capacity_banner_opens_the_thread(page)
        test_ai_provider_dropdown(page)
        test_daily_work_surface(page)

        # 2. Dismiss overlay to enter main app
        _dismiss_overlay(page)

        # 3. Run UI tests
        test_cadence_recurrence_edit_round_trip(page)
        test_mark_cadence_done_advances_next_due(page)
        test_connection_picker_scrolls(page)
        test_parent_field_makes_a_bollard(page)
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
