window.OAD = window.OAD || {};
OAD.Due = {};

// This module is plain functions, not a class, deliberately — it has no per-call state worth
// keeping between invocations (every render wants a fresh computation from current data), and
// every other file in this codebase uses the same flat OAD.foo = function(){} idiom. An
// earlier pass through this file introduced a QueueManager class here that was instantiated
// fresh on every single call, almost always with an EMPTY constructor (`new QueueManager([],
// [])`) while the real data was passed in as method arguments anyway — pure allocation
// overhead with zero encapsulation benefit, and an actively misleading API (looks stateful,
// wasn't). Removed; this file is the single implementation again, not a facade over one.

// Status-filtered, demo-scoped, NOT pressure-scored. Safe to call from anywhere, including
// from inside OAD.pressure()'s own call chain via getDayLoad — never calls OAD.pressure(),
// so it can't recurse.
OAD.Due.activeThreadsRaw = function () {
  return (OAD.getVisibleThreads() || [])
    .filter(function (t) { return t.status !== 'closed' && t.status !== 'dormant' && t.status !== 'inbox'; });
};

// Pressure-scored + sorted convenience wrapper for surfaces that display/rank threads.
// NOT safe to call from within OAD.pressure() itself (see getDayLoad in engine.js) — this is
// the layer that must stay separate from activeThreadsRaw to avoid infinite recursion:
// OAD.pressure() (unsuppressed) calls OAD.getDayLoad(), which must not turn around and call
// this function, since this function calls OAD.pressure() on every thread.
OAD.Due.activeThreads = function () {
  return OAD.Due.activeThreadsRaw()
    .map(function (t) { return Object.assign({}, t, { _score: typeof t.getPressure === 'function' ? t.getPressure() : OAD.pressure(t) }); })
    .sort(function (a, b) { return b._score - a._score; });
};

// The activeByUUID/childrenByParentUUID/computeSuppressedChildUUIDs block that used to be
// copy-pasted identically across renderTodayView/renderDailyView/renderMatrixView.
OAD.Due.suppressionContext = function (activeThreads, todayStr, focusUUID, horizonStr) {
  var activeByUUID = {};
  activeThreads.forEach(function (t) { activeByUUID[t.uuid] = t; });

  var childrenByParentUUID = {};
  activeThreads.forEach(function (t) {
    if (t.parent_uuid && activeByUUID[t.parent_uuid]) {
      (childrenByParentUUID[t.parent_uuid] = childrenByParentUUID[t.parent_uuid] || []).push(t);
    }
  });

  var suppressedUUIDs = OAD.computeSuppressedChildUUIDs(childrenByParentUUID, activeByUUID, todayStr, focusUUID, horizonStr);
  var visibleThreads = activeThreads.filter(function (t) { return !suppressedUUIDs.has(t.uuid); });

  return { activeByUUID: activeByUUID, childrenByParentUUID: childrenByParentUUID, suppressedUUIDs: suppressedUUIDs, visibleThreads: visibleThreads };
};

/**
 * Groups visible threads into mutually exclusive-except-overdue temporal buckets: Overdue,
 * Today, Week (up to 7 days out), and No Date. "Today" intentionally does NOT exclude threads
 * also caught by "Overdue" — a thread due today whose specific next_action_time has already
 * passed is legitimately both, and hiding it from "Today" once it crosses into "Overdue" would
 * make it disappear from the list a user is actively looking at right when it became urgent.
 * This is deliberate, tested behavior — see the exclusivity test in tests.js — not an oversight.
 *
 * "Overdue" specifically means deadline-overdue (OAD.isDeadlineOverdue — a hard external
 * deadline has passed), NOT action-overdue (a scheduled next_action_date has passed). Per
 * ticket-overdue-filter-fix.md: a `waiting` thread's next_action_date passing is normal and
 * expected (blocked on someone else's response), not a sign the thread is actually overdue —
 * routing this bucket through next_action_date produced ~20 false positives against real data
 * (22 shown, only 2 genuinely had a passed deadline). Today/Week/NoDate below are unaffected —
 * they're still next_action_date-based, which is correct for "what's on my plate this week."
 */
OAD.Due.buckets = function (visibleThreads, todayStr, in7Str) {
  return {
    // Calls the OAD.isDeadlineOverdue wrapper directly, not a t.isDeadlineOverdue-first ternary
    // like the other predicates here — Thread.isDeadlineOverdue() and OAD.isDeadlineOverdue()
    // share a name (unlike isOverdue()/OAD.isActionOverdue's deliberately different names), so
    // a ternary would always resolve to the instance method and make OAD.isDeadlineOverdue
    // unmockable in tests. The wrapper already dispatches to the instance method itself.
    overdue: visibleThreads.filter(function (t) { return OAD.isDeadlineOverdue(t); }),
    today:   visibleThreads.filter(function (t) { return t.next_action_date === todayStr; }),
    week:    visibleThreads.filter(function (t) { return t.next_action_date > todayStr && t.next_action_date <= in7Str; })
               .sort(function (a, b) { return a.next_action_date.localeCompare(b.next_action_date); }),
    noDate:  visibleThreads.filter(function (t) { return !t.next_action_date; })
  };
};

// Whether a cadence counts as "due" on a specific calendar day — not overdue (relative to
// actual today, not dateStr), its next_due matches dateStr exactly, and it hasn't already
// been completed for this period. This is the one true predicate for "does this cadence
// belong on day X" — cadenceBuckets below is just this applied to today/the week window, and
// any other per-day tally (e.g. This Week's Load's daily heatmap) must go through this too
// rather than re-deriving its own `next_due === dateStr` check, which silently double-counts
// already-completed cadences (confirmed bug: a cadence due today but already marked done
// today was still being tallied into that day's item count by a hand-rolled check that skipped
// this exclusion).
OAD.Due.isCadenceDueOn = function (cadence, dateStr) {
  var overdue = typeof cadence.isOverdue === 'function' ? cadence.isOverdue() : OAD.cadenceOverdue(cadence);
  var done = typeof cadence.isDoneThisPeriod === 'function' ? cadence.isDoneThisPeriod() : OAD.cadenceDoneThisPeriod(cadence);
  return !overdue && cadence.next_due === dateStr && !done;
};

// Cadence overdue/today/week split — mirrors the cadence filter that used to be duplicated
// 3x in render.js.
OAD.Due.cadenceBuckets = function (cadences, todayStr, in7Str) {
  return {
    overdue: cadences.filter(function (c) { return typeof c.isOverdue === 'function' ? c.isOverdue() : OAD.cadenceOverdue(c); }),
    today:   cadences.filter(function (c) { return OAD.Due.isCadenceDueOn(c, todayStr); }),
    week:    cadences.filter(function (c) {
               var overdue = typeof c.isOverdue === 'function' ? c.isOverdue() : OAD.cadenceOverdue(c);
               var done = typeof c.isDoneThisPeriod === 'function' ? c.isDoneThisPeriod() : OAD.cadenceDoneThisPeriod(c);
               return !overdue && c.next_due > todayStr && c.next_due <= in7Str && !done;
             }).sort(function (a, b) { return a.next_due.localeCompare(b.next_due); })
  };
};

// Live-computed "Stalled" view — per ticket-stalled-metric-fix.md. Replaces the dead
// status === 'stalled' status value, which was never set on any real thread (grep-confirmed:
// no automated promotion path exists anywhere, and across the full live export literally zero
// threads have ever used it). Mirrors the "my own next action has drifted" concept TOAT's own
// tiers 2/3 already compute (js/data.js, OAD.getDailyToat) — deliberately does NOT touch TOAT's
// own logic (correct as shipped, out of scope) — but surfaces every drifted thread as a browsable
// list, not just the single oldest one TOAT picks. This closes a real visibility gap: a thread
// whose deadline is still fine (correctly excluded from Overdue Tasks) and whose next_action_date
// has passed, but whose pressure score is too low to win the single Focus Now slot, was
// previously invisible everywhere in the app — confirmed with a real example against the 7/11
// export (ENV-125 Assignment — Week of July 6, pressure 93, only visible because it happened to
// win Focus Now that day).
//
// Excludes closed/dormant (the ticket's literal formula) and waiting+user_action_complete —
// "ball in their court," nothing left for the user to do, matching TOAT tier 3's own exclusion
// (js/data.js:767) which the ticket's prose formula omitted but its stated intent ("same shape
// as tiers 2/3") implies. Does NOT exclude inbox — the ticket's formula is explicit
// (status NOT IN (closed, dormant) only) and no real inbox thread currently has a past
// next_action_date to test this against; worth confirming if it ever matters in practice.
//
// Sorted oldest-first BY next_action_date, per the ticket's explicit acceptance criteria — note
// this does NOT actually match TOAT's real tie-break convention (TOAT sorts by thread id /
// creation age, js/data.js:775/781), despite the ticket's own claim that it does. Implemented
// as explicitly requested; flagging the mismatch as a factual correction, not silently
// "fixing" it to id-order without confirming that's wanted.
OAD.Due.stalledThreads = function (todayStr) {
  todayStr = todayStr || OAD.todayStr();
  return (OAD.getVisibleThreads() || [])
    .filter(function (t) {
      if (t.status === 'closed' || t.status === 'dormant') return false;
      if (t.status === 'waiting' && t.user_action_complete) return false;
      return !!t.next_action_date && t.next_action_date < todayStr;
    })
    .sort(function (a, b) { return a.next_action_date < b.next_action_date ? -1 : (a.next_action_date > b.next_action_date ? 1 : 0); });
};

// One call for the full dashboard pipeline. Scores the active list exactly once — getFocusUUID
// and the suppression/bucket pipeline below all reuse this same scored array.
OAD.Due.dashboardData = function (todayStr, in7Str) {
  var active = OAD.Due.activeThreads();
  var focusUUID = OAD.getFocusUUID(active);
  var ctx = OAD.Due.suppressionContext(active, todayStr, focusUUID, in7Str);
  var buckets = OAD.Due.buckets(ctx.visibleThreads, todayStr, in7Str);
  return Object.assign({ active: active, focusUUID: focusUUID }, ctx, buckets);
};

// Self-diagnostic, callable from the console (OAD.Due.selfCheck()) against live data. Checks
// invariants rather than diffing parallel implementations:
//   A. No suppressed child is orphaned — its parent must actually be visible in the active
//      set, so the child-summary badge is reachable. A parent with no next_action_date
//      renders in no date bucket, so a suppressed child under it would otherwise vanish with
//      zero trace.
//   B. Focus Now's current pick is never in the suppressed set.
//   C. Every overdue-or-due-today thread is never in the suppressed set.
OAD.Due.selfCheck = function () {
  var todayStr = OAD.todayStr();
  var in7Dt = new Date(); in7Dt.setHours(0, 0, 0, 0); in7Dt.setDate(in7Dt.getDate() + 7);
  var in7Str = in7Dt.toISOString().slice(0, 10);
  var data = OAD.Due.dashboardData(todayStr, in7Str);
  var issues = [];

  data.suppressedUUIDs.forEach(function (uuid) {
    var child = data.activeByUUID[uuid];
    if (!child) return;
    var parent = data.activeByUUID[child.parent_uuid];
    var parentVisible = parent && !data.suppressedUUIDs.has(parent.uuid);
    if (!parentVisible) {
      issues.push({ type: 'orphaned_suppression', child: child.title, childUUID: child.uuid, parent: parent ? parent.title : '(missing)' });
    }
    if (OAD.isActionOverdue(child) || child.next_action_date === todayStr) {
      issues.push({ type: 'overdue_or_today_suppressed', child: child.title, childUUID: child.uuid });
    }
  });

  if (data.focusUUID && data.suppressedUUIDs.has(data.focusUUID)) {
    issues.push({ type: 'focus_pick_suppressed', uuid: data.focusUUID });
  }

  return { ok: issues.length === 0, issues: issues };
};
