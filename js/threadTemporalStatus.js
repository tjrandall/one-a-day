window.OAD = window.OAD || {};
OAD.TemporalStatus = {};

// ── Single source of truth for "is this thread overdue / due today / stalled" ──────────────
// Per ticket-flowqueue-temporal-and-schema.md, Phase 1: in one session, "what counts as
// overdue" was independently reimplemented (and silently diverged) four separate times —
// Overdue Tasks (wrongly keyed on next_action_date, then fixed to deadline), Due Today
// (next_action_date), Stalled Tasks (a dead status flag, then fixed to live next_action_date
// drift), and a thread card's "remaining" countdown (deadline-based, but sitting next to an
// unrelated, unlabeled next_action_date with no indication they're different fields). This
// module is the fourth and last definition — every consumer calls it instead of inlining its
// own deadline/next_action_date comparison again.
//
// Pure functions, zero DOM references, zero hidden global state (no reads of Date.now(),
// OAD.DB, OAD._userId, or anything else global) — every function takes exactly the thread,
// the reference moment, and (optionally) an owner scope as explicit arguments, so this file
// is fully unit-testable with the app not running and produces identical output regardless of
// when or where it's called. This is what makes it reusable later as an AI-abstraction-layer
// input or a real API endpoint (Architectural Hooks #3).
//
// `today` is a real Date object, not a bare 'YYYY-MM-DD' string, despite the ticket's own
// example formulas reading as pure date comparisons. Deliberate: this app already has tested,
// deliberately-built time-of-day precision (next_action_time/deadline_time — e.g. "meet Amy at
// 09:30 today" is overdue by 10am even though the date alone says "today, not yet overdue").
// A bare date string can't express that. A Date object can represent either a precise moment
// (real usage: `new Date()`) or a whole day (tests: `new Date('2026-07-11T23:59:59')`), so it's
// a strict superset of what the ticket's string-based examples needed — "not hardcoded to
// new Date()" is satisfied by it being an explicit argument, not by its type being a string.
//
// `ownerId` is the multi-tenancy hook (Architectural Hooks #1) — see OAD.DEFAULT_OWNER_ID's
// comment in js/data.js for why this is a different concern than Supabase's account-level RLS.
// If provided and it doesn't match the thread's own owner_id, every function returns its "safe
// negative" (false / null / empty array), as if the thread weren't visible to that caller at
// all — exactly the shape a real multi-tenant API endpoint would need.

// Local-calendar-day string from a Date — mirrors OAD.todayStr() (js/engine.js) exactly: zero
// local hours first, THEN read the components, avoiding the UTC-rollover bug this app hit
// repeatedly before that fix (a naive toISOString().slice(0,10) drifts a day ahead in the
// evening for negative-UTC-offset zones). Duplicated here rather than calling OAD.todayStr()
// so this module has zero load-order dependency on js/engine.js — it can be required/tested
// completely standalone.
function _localDateStr(dt) {
  var d = new Date(dt.getTime());
  d.setHours(0, 0, 0, 0);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Combines a date-only string with an optional 'HH:MM' time into a real Date. No time set
// defaults to 23:59:59 of that date (not overdue until the whole day has passed). Mirrors
// OAD._combineDateTime (js/engine.js) exactly — duplicated, not imported, for the same
// zero-dependency reason as _localDateStr above.
function _combineDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  var t = (timeStr && /^\d{2}:\d{2}$/.test(timeStr)) ? timeStr + ':00' : '23:59:59';
  return new Date(dateStr + 'T' + t);
}

function _ownerMismatch(thread, ownerId) {
  return ownerId != null && thread && thread.owner_id != null && thread.owner_id !== ownerId;
}

function _excludedStatus(thread) {
  return !thread || thread.status === 'closed' || thread.status === 'dormant';
}

function _strings() {
  return (window.OAD && OAD.Config && OAD.Config.temporalStatusStrings) || {};
}

// "There is a hard external deadline, and it has passed." Distinct from isStalled below — a
// thread can be blocked on someone else's response (status waiting) with a stale
// next_action_date and NOT be overdue by this definition, because there's no deadline it's
// actually missing.
OAD.TemporalStatus.isOverdue = function (thread, today, ownerId) {
  if (_excludedStatus(thread) || _ownerMismatch(thread, ownerId)) return false;
  var dt = _combineDateTime(thread.deadline, thread.deadline_time);
  if (!dt) return false;
  return dt < today;
};

OAD.TemporalStatus.isDueToday = function (thread, today, ownerId) {
  if (_excludedStatus(thread) || _ownerMismatch(thread, ownerId)) return false;
  return thread.next_action_date === _localDateStr(today);
};

// "My own intended next action has drifted into the past." Excludes a waiting thread with
// user_action_complete set ("ball in their court" — nothing left for the user to do; a stale
// next_action_date there is expected, not a sign of neglect), matching the exclusion TOAT's own
// tier 3 already had before this module existed.
OAD.TemporalStatus.isStalled = function (thread, today, ownerId) {
  if (_excludedStatus(thread) || _ownerMismatch(thread, ownerId)) return false;
  if (thread.status === 'waiting' && thread.user_action_complete) return false;
  var dt = _combineDateTime(thread.next_action_date, thread.next_action_time);
  if (!dt) return false;
  return dt < today;
};

// Positive = deadline is in the future, 0 = today, negative = past. No status exclusion (unlike
// the three functions above) — this is pure date arithmetic on a fact that's still true
// regardless of whether the thread is currently actionable; a closed thread's deadline is still
// a real historical date.
OAD.TemporalStatus.daysUntilDeadline = function (thread, today, ownerId) {
  if (!thread || _ownerMismatch(thread, ownerId) || !thread.deadline) return null;
  var todayMidnight = new Date(today.getTime()); todayMidnight.setHours(0, 0, 0, 0);
  var dl = new Date(thread.deadline + 'T00:00:00');
  return Math.round((dl - todayMidnight) / 86400000);
};

// Positive = next_action_date was N days ago, 0 = today, negative = still in the future (not
// yet "since" anything). No status exclusion, same reasoning as daysUntilDeadline above.
OAD.TemporalStatus.daysSinceNextActionDate = function (thread, today, ownerId) {
  if (!thread || _ownerMismatch(thread, ownerId) || !thread.next_action_date) return null;
  var todayMidnight = new Date(today.getTime()); todayMidnight.setHours(0, 0, 0, 0);
  var nad = new Date(thread.next_action_date + 'T00:00:00');
  return Math.round((todayMidnight - nad) / 86400000);
};

// The single canonical object a card should render — callers stop picking their own date field
// to display (the ENV-125 bug: a card showed a calm deadline-based "3w remaining" countdown
// while that same thread's next_action_date sat 2 days in the past with zero visual signal).
// Deadline wins when both are set (a hard external commitment is the more load-bearing fact to
// surface first); daysRemaining always means "days until [date]" regardless of which field it
// came from — positive future, 0 today, negative past — so callers never need to know which
// field won to interpret the sign correctly.
OAD.TemporalStatus.cardDateLabel = function (thread, today, ownerId) {
  if (!thread || _ownerMismatch(thread, ownerId)) {
    return { label: 'none', date: null, daysRemaining: null };
  }
  if (thread.deadline) {
    return { label: 'deadline', date: thread.deadline, daysRemaining: OAD.TemporalStatus.daysUntilDeadline(thread, today, ownerId) };
  }
  if (thread.next_action_date) {
    var todayMidnight = new Date(today.getTime()); todayMidnight.setHours(0, 0, 0, 0);
    var nad = new Date(thread.next_action_date + 'T00:00:00');
    return { label: 'next_action_date', date: thread.next_action_date, daysRemaining: Math.round((nad - todayMidnight) / 86400000) };
  }
  return { label: 'none', date: null, daysRemaining: null };
};

// Flags nonsensical states as data-quality issues, not app-logic bugs — the literal precursor
// to real audit logging (Architectural Hooks #4): each warning is a structured event (which
// thread, which rule, checked against what reference date), not a bare string, so it could be
// written to a real log sink later with zero reshaping. Deliberately stays pure — no live
// Date.now()/console output inside — `checked_against` records the injected `today`, not a
// wall-clock read, so results stay fully deterministic and testable.
//
// Excludes closed threads (a finished thread's old, possibly-inconsistent dates aren't an
// actionable data-quality issue) but deliberately does NOT exclude dormant — a dormant
// thread's dates are explicitly expected to be stale ("will be corrected on reactivation," per
// the CAC102 dormant-conversion ticket), and catching an inconsistency NOW is exactly what
// prevents a bad surprise the moment it's reactivated (this is why the real CAC102 Live
// Session — July 13 case, now dormant, still needs to surface here).
OAD.TemporalStatus.dataHygieneWarnings = function (thread, today, ownerId) {
  var warnings = [];
  if (!thread || thread.status === 'closed' || _ownerMismatch(thread, ownerId)) return warnings;
  var strings = _strings();
  var todayStr = today ? _localDateStr(today) : null;

  if (thread.next_action_date && thread.deadline && thread.next_action_date > thread.deadline) {
    warnings.push({
      thread_id: thread.id,
      thread_uuid: thread.uuid,
      thread_title: thread.title,
      rule: 'next_action_after_deadline',
      message: strings.warnNextActionAfterDeadline || 'Next action date is after the deadline',
      checked_against: todayStr
    });
  }

  // Unified with OAD._che006_staleNextAction (js/engine.js) — that rule predates this module and
  // was an independent implementation of nearly the same signal, missed on the first migration
  // pass and found afterward. They intentionally stay two separate CONSUMERS (this one a pure,
  // stateless, audit-log-shaped diagnostic; CHE-006 a persisted, dismissible, auto-fixable alert
  // in OAD.runCHE()) rather than one merged function, but both now compose from isStalled/
  // isOverdue below instead of each reimplementing its own date-string comparison — CHE-006 is
  // deliberately broader (it also fires with no deadline at all, since "stale with nothing else
  // to catch it" is exactly its purpose), this rule stays narrower and specifically named for
  // the masking case a card display needs to know about.
  if (todayStr && thread.next_action_date && thread.deadline &&
      thread.next_action_date < todayStr && thread.deadline >= todayStr) {
    warnings.push({
      thread_id: thread.id,
      thread_uuid: thread.uuid,
      thread_title: thread.title,
      rule: 'drifted_next_action_masked_by_future_deadline',
      message: strings.warnDriftedMaskedByDeadline || 'Next action has drifted into the past behind a comfortable future deadline',
      checked_against: todayStr
    });
  }

  if ((thread.status === 'open' || thread.status === 'waiting') && !thread.next_action_date && !thread.deadline) {
    warnings.push({
      thread_id: thread.id,
      thread_uuid: thread.uuid,
      thread_title: thread.title,
      rule: 'no_dates_set',
      message: strings.warnNoDatesSet || 'No next action date or deadline set',
      checked_against: todayStr
    });
  }

  return warnings;
};
