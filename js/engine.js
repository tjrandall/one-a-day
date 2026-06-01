window.OAD = window.OAD || {};

OAD.pressure = function (thread) {
  let score = 0;

  if (thread.status === 'stalled')  score += 30;
  else if (thread.status === 'waiting') score += 15;

  if (!thread.assumption_verified && thread.current_assumption) score += 20;

  if (thread.priority === 'critical') score += 30;
  else if (thread.priority === 'high')   score += 20;
  else if (thread.priority === 'medium') score += 10;

  const blocking = (thread.connections || []).filter(c => c.edge_type === 'blocks').length;
  score += blocking * 10;

  if (thread.contingency_trigger_date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const ctg = new Date(thread.contingency_trigger_date);
    const days = Math.ceil((ctg - today) / 86400000);
    if (days < 3)        score += 25;
    else if (days < 7)   score += 15;
    else if (days < 14)  score += 5;
  }

  if (thread.deadline) {
    const ds = OAD.deadlineState(thread);
    if (ds && !ds.onTrack) {
      if (ds.daysRemaining <= 7)       score += 30;
      else if (ds.daysRemaining <= 14) score += 20;
      else if (ds.daysRemaining <= 30) score += 10;
      if (ds.behindBy >= 2)            score += 15;
    }
  }

  return Math.min(score, 100);
};

OAD.suggestArea = function (title) {
  const lower = title.toLowerCase();
  if (/job|work|career|employ|hire|interview|resume/.test(lower)) return 'Career';
  if (/health|doctor|medical|therapy|mental|physical/.test(lower)) return 'Health';
  if (/money|finance|bank|debt|loan|tax|budget|invest/.test(lower)) return 'Finance';
  if (/friend|family|partner|relationship|social/.test(lower)) return 'Relationships';
  if (/school|class|degree|cert|course|learn|study/.test(lower)) return 'Education';
  if (/house|rent|lease|mortgage|apartment|move/.test(lower)) return 'Housing';
  if (/legal|court|law|attorney|contract|va |vr&e|vre/.test(lower)) return 'Legal';
  return 'Personal Growth';
};

OAD.esc = function (str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

OAD.pressureClass = function (score) {
  if (score >= 60) return 'p-high';
  if (score >= 30) return 'p-mid';
  return 'p-low';
};

OAD.daysUntil = function (dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  return Math.ceil((target - today) / 86400000);
};

OAD.formatDate = function (dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

OAD.deadlineState = function (thread) {
  if (!thread.deadline) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dl = new Date(thread.deadline + 'T00:00:00');
  const daysRemaining = Math.ceil((dl - today) / 86400000);
  const weeksRemaining = Math.floor(Math.max(0, daysRemaining) / 7);

  const effortEstimate   = thread.effortEstimate;
  const effortLogged     = thread.effortLogged     || 0;
  const weeklyCommitment = thread.weeklyCommitment || 1;

  if (effortEstimate == null) {
    return { daysRemaining: daysRemaining, weeksRemaining: weeksRemaining, sessionsRemaining: null, onTrack: true, behindBy: 0 };
  }

  const sessionsRemaining = Math.max(0, effortEstimate - effortLogged);
  const capacity = weeksRemaining * weeklyCommitment;
  const onTrack  = sessionsRemaining <= capacity;
  const behindBy = onTrack ? 0 : sessionsRemaining - capacity;

  return { daysRemaining: daysRemaining, weeksRemaining: weeksRemaining, sessionsRemaining: sessionsRemaining, onTrack: onTrack, behindBy: behindBy };
};

OAD.nextCadenceDue = function (recurrence, fromDate) {
  const ref = fromDate ? new Date(fromDate + 'T00:00:00') : new Date();
  ref.setHours(0, 0, 0, 0);
  const y = ref.getFullYear();
  const m = ref.getMonth();

  if (recurrence === 'monthly-1st')  return new Date(y, m + 1, 1).toISOString().slice(0, 10);
  if (recurrence === 'monthly-15th') {
    const candidate = new Date(y, m, 15);
    return (candidate > ref ? candidate : new Date(y, m + 1, 15)).toISOString().slice(0, 10);
  }
  if (recurrence === 'monthly-last') return new Date(y, m + 2, 0).toISOString().slice(0, 10);
  if (recurrence === 'weekly') {
    const next = new Date(ref);
    next.setDate(next.getDate() + 7);
    return next.toISOString().slice(0, 10);
  }
  return null;
};

OAD.prevCadenceDue = function (recurrence) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();

  if (recurrence === 'monthly-1st')  return new Date(y, m, 1).toISOString().slice(0, 10);
  if (recurrence === 'monthly-15th') {
    return d >= 15
      ? new Date(y, m, 15).toISOString().slice(0, 10)
      : new Date(y, m - 1, 15).toISOString().slice(0, 10);
  }
  if (recurrence === 'monthly-last') return new Date(y, m, 0).toISOString().slice(0, 10);
  return null;
};

OAD.cadenceOverdue = function (cadence) {
  if (!cadence.next_due) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(cadence.next_due + 'T00:00:00');
  return due < today;
};
