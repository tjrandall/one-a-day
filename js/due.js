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
 * "Overdue" specifically means deadline-overdue (OAD.TemporalStatus.isOverdue — a hard external
 * deadline has passed), NOT action-overdue (a scheduled next_action_date has passed). Per
 * ticket-overdue-filter-fix.md: a `waiting` thread's next_action_date passing is normal and
 * expected (blocked on someone else's response), not a sign the thread is actually overdue —
 * routing this bucket through next_action_date produced ~20 false positives against real data
 * (22 shown, only 2 genuinely had a passed deadline). Week/NoDate below are unaffected — still
 * next_action_date-based directly, which is correct for "what's on my plate this week" (This
 * Week's actual definition confirmed unchanged, per ticket-flowqueue-temporal-and-schema.md
 * Phase 1's explicit "report back before changing it" requirement).
 *
 * overdue/today call OAD.TemporalStatus (js/threadTemporalStatus.js) — the single source of
 * truth for this comparison, per ticket-flowqueue-temporal-and-schema.md Phase 1. `new Date()`
 * is constructed once per call, here at the consumer boundary, not inside the pure module
 * itself — TemporalStatus never reads the clock on its own.
 */
OAD.Due.buckets = function (visibleThreads, todayStr, in7Str) {
  var now = new Date();
  return {
    overdue: visibleThreads.filter(function (t) { return OAD.TemporalStatus.isOverdue(t, now); }),
    today:   visibleThreads.filter(function (t) { return OAD.TemporalStatus.isDueToday(t, now); }),
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
// Excludes closed/dormant and waiting+user_action_complete ("ball in their court," nothing left
// for the user to do) — both now enforced inside OAD.TemporalStatus.isStalled itself
// (js/threadTemporalStatus.js), per ticket-flowqueue-temporal-and-schema.md Phase 1. Does NOT
// exclude inbox — the ticket's formula was explicit (status NOT IN (closed, dormant) only) and
// no real inbox thread currently has a past next_action_date to test this against.
//
// Sorted oldest-first BY next_action_date, per the ticket's explicit acceptance criteria — note
// this does NOT actually match TOAT's real tie-break convention (TOAT sorts by thread id /
// creation age, js/data.js:775/781), despite the ticket's own claim that it does. Implemented
// as explicitly requested; flagging the mismatch as a factual correction, not silently
// "fixing" it to id-order without confirming that's wanted.
//
// No longer takes a todayStr override (removed during this migration) — the actual isStalled
// comparison needs the real current moment for same-day time-of-day precision (next_action_time
// set), not just a calendar day. An end-of-day approximation of an arbitrary todayStr was tried
// and rejected: for a thread due later TODAY at a specific time, it would have registered as
// stalled the instant today began, before that time ever arrived — worse than the original bare
// date-string comparison, not equivalent to it. Nothing in this app ever actually called this
// with anything other than real "now" anyway (verified — every prior call site derived it from
// OAD.todayStr()), so this isn't a real capability loss, just a name that stops implying one.
OAD.Due.stalledThreads = function () {
  var now = new Date();
  return (OAD.getVisibleThreads() || [])
    .filter(function (t) { return OAD.TemporalStatus.isStalled(t, now); })
    .sort(function (a, b) { return a.next_action_date < b.next_action_date ? -1 : (a.next_action_date > b.next_action_date ? 1 : 0); });
};

// Replaces the "Avg Pressure" dashboard metric — per
// ticket-pressure-propagation-and-critical-load.md, a single blended average is mathematically
// incapable of representing "many simultaneous fires plus a long dormant/low tail," which is the
// actual shape of this data (confirmed against the live export: 6 threads at 80+ pressure sitting
// in the same average as 18 threads at 0-19). Critical Load — a count, not an average — is the
// number meant to answer "how much fire am I under right now."
//
// Threshold defaults to OAD.Config.pressureThresholds.high (the SAME value that already colors
// a thread's pressure badge red/orange everywhere else in the app) rather than introducing a
// second, separately-configurable "what counts as high" — this is the exact "N independent
// definitions of the same concept silently drift" problem this app has hit repeatedly (Overdue,
// Stalled, temporal status) if a thread could show a "high" badge without counting toward
// Critical Load, or vice versa.
//
// Operates on OAD.Due.activeThreadsRaw() (open/waiting only) — dormant/inbox/closed are excluded
// by that function already, which is also true of the "Avg Pressure" calculation it replaces;
// this isn't a new exclusion, just confirmed and preserved.
OAD.Due.criticalLoad = function (threshold) {
  var t = threshold != null ? threshold : ((OAD.Config && OAD.Config.pressureThresholds && OAD.Config.pressureThresholds.high) || 60);
  var active = OAD.Due.activeThreads();
  var critical = active.filter(function (th) { return th._score >= t; });
  return { threshold: t, count: critical.length, threadUUIDs: critical.map(function (th) { return th.uuid; }) };
};

// The literal distribution kept available on demand alongside Critical Load's headline count, so
// "8 threads at critical" doesn't collapse right back into a single soft-sounding figure — per
// the ticket's explicit "keep a distribution available, don't just relabel the same average."
// Tier boundaries are fixed (80+/50-79/20-49/0-19), not derived from pressureThresholds, since
// they're describing four buckets for a histogram, not a single high/not-high decision the way
// criticalLoad's threshold is.
OAD.Due.pressureDistribution = function () {
  var active = OAD.Due.activeThreads();
  var tiers = { '80+': 0, '50-79': 0, '20-49': 0, '0-19': 0 };
  active.forEach(function (th) {
    var s = th._score;
    if (s >= 80) tiers['80+']++;
    else if (s >= 50) tiers['50-79']++;
    else if (s >= 20) tiers['20-49']++;
    else tiers['0-19']++;
  });
  return tiers;
};

// Load Overview — per ticket-enterprise-mode-and-load-overview.md Part 2. Replaces the single
// "Critical Load" headline (previously pressureDist['80+'] + pressureDist['50-79'], one number
// standing in for four different kinds of urgency) with four independent counts pulled from a
// single source, so every surface that shows them (persona bar, daily dashboard, list view, DEV
// export) can't drift from each other the way Critical Load itself already drifted from its own
// tier breakdown once (a live report: headline read 16, tiers summed to 22). These four are
// deliberately allowed to overlap — a thread can be both Stalled and Critical Pressure — this is
// not a de-duplicated total, it's four shapes shown side by side.
//
// Overdue/Due This Week are pulled from OAD.Due.dashboardData's own suppression-filtered bucket
// pipeline (not re-filtered here) so this can never disagree with the actual Overdue Tasks/This
// Week lists rendered right next to it. Critical Pressure is 80+ ONLY (not 80+ + 50-79 like the
// old Critical Load) — the ticket's explicit definition of "the actual high-stakes-right-now
// signal," distinct from Stalled/Overdue/Due This Week, which already exist as their own real,
// browsable buckets elsewhere in the app.
OAD.Due.loadOverview = function () {
  var todayDt = new Date(); todayDt.setHours(0, 0, 0, 0);
  var todayStr = todayDt.toISOString().slice(0, 10);
  var in7Dt = new Date(todayDt); in7Dt.setDate(in7Dt.getDate() + 7);
  var in7Str = in7Dt.toISOString().slice(0, 10);

  var due = OAD.Due.dashboardData(todayStr, in7Str);
  var stalled = OAD.Due.stalledThreads();
  var critical = OAD.Due.criticalLoad(80);

  return {
    overdue:          { count: due.overdue.length, threadUUIDs: due.overdue.map(function (t) { return t.uuid; }) },
    stalled:          { count: stalled.length,      threadUUIDs: stalled.map(function (t) { return t.uuid; }) },
    dueThisWeek:      { count: due.week.length,     threadUUIDs: due.week.map(function (t) { return t.uuid; }) },
    criticalPressure: { count: critical.count,      threadUUIDs: critical.threadUUIDs }
  };
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
    if (OAD.isActionOverdue(child) || OAD.TemporalStatus.isDueToday(child, new Date())) {
      issues.push({ type: 'overdue_or_today_suppressed', child: child.title, childUUID: child.uuid });
    }
  });

  if (data.focusUUID && data.suppressedUUIDs.has(data.focusUUID)) {
    issues.push({ type: 'focus_pick_suppressed', uuid: data.focusUUID });
  }

  return { ok: issues.length === 0, issues: issues };
};
