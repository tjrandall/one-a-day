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
