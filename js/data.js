window.OAD = window.OAD || {};

OAD.DB = {
  threads: [],

  persona: {
    assumption_tendencies: [],
    counsel_history: [],
    what_is_working: [],
    what_is_not_working: [],
    life_context: {
      pressure_level: 'moderate',
      hard_deadline: null,
      hard_deadline_context: ''
    },
    tone_calibration: {
      challenge_tolerance: 'medium',
      current_mode: 'problem-solving',
      avoid_patterns: []
    }
  }
};

OAD.LIFE_AREAS = [
  'Career', 'Health', 'Finance', 'Relationships',
  'Education', 'Housing', 'Legal', 'Personal Growth', 'Other'
];

OAD.STATUSES   = ['open', 'waiting', 'stalled', 'closed'];
OAD.PRIORITIES = ['critical', 'high', 'medium', 'low'];
OAD.EDGE_TYPES = ['blocks', 'enables', 'relates'];

OAD.CLOSING_TYPES = ['outcome', 'action'];

OAD.nextId = function () {
  const ids = OAD.DB.threads.map(t => t.id);
  return ids.length ? Math.max(...ids) + 1 : 1;
};

OAD.getThread = function (id) {
  return OAD.DB.threads.find(t => t.id === id) || null;
};

OAD.addThread = function (thread) {
  thread.id = OAD.nextId();
  thread.evolution_log  = thread.evolution_log  || [];
  thread.ai_insights    = thread.ai_insights    || [];
  thread.connections    = thread.connections    || [];
  OAD.DB.threads.push(thread);
  return thread;
};

OAD.updateThread = function (id, patch) {
  const t = OAD.getThread(id);
  if (!t) return null;
  Object.assign(t, patch);
  return t;
};

OAD.deleteThread = function (id) {
  const idx = OAD.DB.threads.findIndex(t => t.id === id);
  if (idx === -1) return false;
  OAD.DB.threads.splice(idx, 1);
  return true;
};

OAD.addEvolution = function (id, note) {
  const t = OAD.getThread(id);
  if (!t) return;
  t.evolution_log.push({ date: new Date().toISOString().slice(0, 10), note });
};

OAD.addInsight = function (id, insight) {
  const t = OAD.getThread(id);
  if (!t) return;
  t.ai_insights.push(insight);
  OAD.DB.persona.counsel_history.push({
    thread_id: id,
    thread_title: t.title,
    insight,
    date: new Date().toISOString().slice(0, 10)
  });
};

OAD.makeThread = function (overrides) {
  return Object.assign({
    id: null,
    title: '',
    life_area: 'Other',
    status: 'open',
    priority: 'medium',
    closing_condition: '',
    closing_condition_type: 'outcome',
    closing_condition_met: false,
    current_assumption: '',
    assumption_verified: false,
    next_action: '',
    next_action_date: '',
    next_action_channel: '',
    next_action_contact: '',
    contingency_trigger_date: '',
    contingency_action: '',
    contingency_escalation: '',
    connections: [],
    evolution_log: [],
    ai_insights: []
  }, overrides);
};
