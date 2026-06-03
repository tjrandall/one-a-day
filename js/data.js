window.OAD = window.OAD || {};

OAD.DB = {
  threads: [],
  cadences: [],

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
  OAD.saveDB();
  return thread;
};

OAD.updateThread = function (id, patch) {
  const t = OAD.getThread(id);
  if (!t) return null;
  Object.assign(t, patch);
  OAD.saveDB();
  return t;
};

OAD.deleteThread = function (id) {
  const idx = OAD.DB.threads.findIndex(t => t.id === id);
  if (idx === -1) return false;
  OAD.DB.threads.splice(idx, 1);
  OAD.saveDB();
  return true;
};

OAD.addEvolution = function (id, note) {
  const t = OAD.getThread(id);
  if (!t) return;
  t.evolution_log.push({ date: new Date().toISOString().slice(0, 10), note });
  OAD.saveDB();
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
  OAD.saveDB();
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
    deadline: null,
    effortEstimate: null,
    weeklyCommitment: null,
    effortLogged: 0,
    connections: [],
    evolution_log: [],
    ai_insights: []
  }, overrides);
};

OAD.nextCadenceId = function () {
  const ids = OAD.DB.cadences.map(function (c) { return c.id; });
  return ids.length ? Math.max.apply(null, ids) + 1 : 1;
};

OAD.makeCadence = function (overrides) {
  return Object.assign({
    id: null,
    title: '',
    life_area: 'finances',
    recurrence: 'monthly-1st',
    last_completed: null,
    next_due: null,
    notes: '',
    consequences: ''
  }, overrides);
};

OAD.addCadence = function (cadence) {
  cadence.id = OAD.nextCadenceId();
  OAD.DB.cadences.push(cadence);
  OAD.saveDB();
  return cadence;
};

OAD.getCadence = function (id) {
  return OAD.DB.cadences.find(function (c) { return c.id === id; }) || null;
};

// Maps the camelCase JSON seed schema to the snake_case thread model.
// Accepts "task" as a closing_condition_type alias for "action".
OAD.bulkImport = function (arr) {
  var CLOSING_TYPE = { task: 'action', outcome: 'outcome', action: 'action' };
  var count = 0;
  arr.forEach(function (r) {
    OAD.addThread(OAD.makeThread({
      title:                    r.title                || r.title                || '',
      life_area:               (r.lifeArea             || r.life_area            || 'Other').toLowerCase(),
      status:                   r.status               || 'open',
      priority:                 r.priority             || 'medium',
      closing_condition:        r.closingCondition     || r.closing_condition    || '',
      closing_condition_type:   CLOSING_TYPE[r.closingType || r.closing_condition_type] || 'outcome',
      current_assumption:       r.currentAssumption    || r.current_assumption   || '',
      next_action:              r.nextAction           || r.next_action          || '',
      next_action_date:         r.byDate               || r.next_action_date     || '',
      next_action_channel:      r.channel              || r.next_action_channel  || '',
      next_action_contact:      r.contact              || r.next_action_contact  || '',
      contingency_trigger_date: r.contingencyTriggerDate || r.contingency_trigger_date || '',
      contingency_action:       r.contingencyAction    || r.contingency_action   || '',
      contingency_escalation:   r.escalation           || r.contingency_escalation || ''
    }));
    count++;
  });
  return count;
};

// ── Persistence ───────────────────────────────────────────────────────

OAD._DB_KEY     = 'oad_db';
OAD._DB_PERSIST = false; // set true by _initApp after tests pass; keeps test suite writes out of localStorage

OAD.saveDB = function () {
  if (!OAD._DB_PERSIST) return;
  try {
    localStorage.setItem(OAD._DB_KEY, JSON.stringify(OAD.DB));
  } catch (e) {
    console.warn('[OAD] saveDB failed:', e);
  }
};

OAD.loadDB = function () {
  try {
    var raw = localStorage.getItem(OAD._DB_KEY);
    if (!raw) return false;
    var data = JSON.parse(raw);
    if (!data || !Array.isArray(data.threads)) return false;
    OAD.DB = data;
    return true;
  } catch (e) {
    console.warn('[OAD] loadDB failed:', e);
    return false;
  }
};

OAD.clearDB = function () {
  localStorage.removeItem(OAD._DB_KEY);
};

// Fetches both course seed files and loads them. Call from console: OAD.importCourseData()
OAD.importCourseData = function () {
  return Promise.all([
    fetch('data/ecornell_cac101_thread_seeds.json').then(function (r) { return r.json(); }),
    fetch('data/env118_thread_seeds.json').then(function (r) { return r.json(); })
  ]).then(function (files) {
    var total = files.reduce(function (sum, arr) { return sum + OAD.bulkImport(arr); }, 0);
    if (typeof OAD.renderList === 'function') OAD.renderList();
    console.log('[OAD] Imported ' + total + ' threads.');
    return total;
  });
};
