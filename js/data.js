window.OAD = window.OAD || {};

OAD.DB = {
  threads: [],
  cadences: [],
  habits: [],
  ideas: [],

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

// ── Habit data model ─────────────────────────────────────────────────

OAD.makeHabit = function (overrides) {
  return Object.assign({
    id: null,
    title: '',
    life_area: 'Personal Growth',
    frequency: 'daily',       // daily | weekly | every-other-day | custom
    time_of_day: 'morning',   // morning | evening | flexible
    current_streak: 0,
    longest_streak: 0,
    last_checked_in: null,    // ISO date string
    last_check_in_done: null, // boolean — true=yes, false=no
    last_check_in_note: '',
    phase: 'active',          // active | check-in | dormant
    why: ''
  }, overrides);
};

OAD.nextHabitId = function () {
  const ids = OAD.DB.habits.map(function (h) { return h.id; });
  return ids.length ? Math.max.apply(null, ids) + 1 : 1;
};

OAD.addHabit = function (habit) {
  habit.id = OAD.nextHabitId();
  OAD.DB.habits.push(habit);
  OAD.saveDB();
  return habit;
};

OAD.getHabit = function (id) {
  return OAD.DB.habits.find(function (h) { return h.id === id; }) || null;
};

OAD.updateHabit = function (id, patch) {
  const h = OAD.getHabit(id);
  if (!h) return null;
  Object.assign(h, patch);
  OAD.saveDB();
  return h;
};

OAD.checkInHabit = function (id, done, note) {
  const h = OAD.getHabit(id);
  if (!h) return null;
  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const alreadyToday = h.last_checked_in === today;

  if (done) {
    if (!alreadyToday) {
      if (h.last_checked_in === yesterday && h.last_check_in_done) {
        h.current_streak = (h.current_streak || 0) + 1;
      } else {
        h.current_streak = 1;
      }
    } else if (!h.last_check_in_done) {
      // Was no today, flipping to yes — restart from 1
      h.current_streak = 1;
    }
    // Already yes today → streak unchanged
    h.longest_streak = Math.max(h.longest_streak || 0, h.current_streak);
  } else {
    if (alreadyToday && h.last_check_in_done) {
      // Flipping yes→no today — undo the increment
      h.current_streak = Math.max(0, (h.current_streak || 0) - 1);
    } else if (!alreadyToday) {
      h.current_streak = 0;
    }
    // Already no today → no change
  }

  h.last_checked_in    = today;
  h.last_check_in_done = done;
  h.last_check_in_note = note != null ? note : '';
  OAD.saveDB();
  return h;
};

// ── Idea data model ───────────────────────────────────────────────────

OAD.makeIdea = function (overrides) {
  return Object.assign({
    id:             null,
    title:          '',
    notes:          '',
    source:         '',
    added_date:     new Date().toISOString().slice(0, 10),
    last_surfaced:  null,
    type:           'other',   // book | article | creative | project-seed | other
    energy_required: 'medium', // low | medium | high
    tags:           []
  }, overrides);
};

OAD.nextIdeaId = function () {
  const ids = OAD.DB.ideas.map(function (i) { return i.id; });
  return ids.length ? Math.max.apply(null, ids) + 1 : 1;
};

OAD.addIdea = function (idea) {
  idea.id = OAD.nextIdeaId();
  OAD.DB.ideas.push(idea);
  OAD.saveDB();
  return idea;
};

OAD.getIdea = function (id) {
  return OAD.DB.ideas.find(function (i) { return i.id === id; }) || null;
};

OAD.updateIdea = function (id, patch) {
  const idea = OAD.getIdea(id);
  if (!idea) return null;
  Object.assign(idea, patch);
  OAD.saveDB();
  return idea;
};

OAD.deleteIdea = function (id) {
  const idx = OAD.DB.ideas.findIndex(function (i) { return i.id === id; });
  if (idx === -1) return false;
  OAD.DB.ideas.splice(idx, 1);
  OAD.saveDB();
  return true;
};

// Returns the same idea all week, cycling through the list week-over-week.
OAD.ideaOfTheWeek = function () {
  const ideas = OAD.DB.ideas || [];
  if (!ideas.length) return null;
  const weekIndex = Math.floor(Date.now() / (7 * 86400000));
  return ideas[weekIndex % ideas.length];
};

// Ensures all expected arrays exist after loading from storage (handles old data missing new fields).
OAD._normalizeDB = function () {
  OAD.DB.threads  = OAD.DB.threads  || [];
  OAD.DB.cadences = OAD.DB.cadences || [];
  OAD.DB.habits   = OAD.DB.habits   || [];
  OAD.DB.ideas    = OAD.DB.ideas    || [];
};

// ── Persistence ───────────────────────────────────────────────────────

OAD._DB_KEY     = 'oad_db';
OAD._DB_PERSIST = false; // set true by _initApp after tests pass; keeps test suite writes out of localStorage
OAD._userId     = null;  // set on successful Supabase sign-in

// ── localStorage (sync, used by tests and as local cache) ──────────────

OAD.saveDB = function () {
  if (!OAD._DB_PERSIST) return;
  try {
    localStorage.setItem(OAD._DB_KEY, JSON.stringify(OAD.DB));
  } catch (e) {
    console.warn('[OAD] saveDB failed:', e);
  }
  // Also push to Supabase when authenticated (fire and forget)
  if (OAD.supabase && OAD._userId) OAD._saveToCloud();
};

OAD.loadDB = function () {
  try {
    var raw = localStorage.getItem(OAD._DB_KEY);
    if (!raw) return false;
    var data = JSON.parse(raw);
    if (!data || !Array.isArray(data.threads)) return false;
    OAD.DB = data;
    OAD._normalizeDB();
    return true;
  } catch (e) {
    console.warn('[OAD] loadDB failed:', e);
    return null; // null = corrupt data present (distinct from false = no data)
  }
};

OAD.clearDB = function () {
  localStorage.removeItem(OAD._DB_KEY);
};

// ── Supabase cloud persistence ──────────────────────────────────────────

OAD._saveToCloud = async function () {
  try {
    var { error } = await OAD.supabase
      .from('user_data')
      .upsert({ user_id: OAD._userId, db: OAD.DB });
    if (error) console.warn('[OAD] cloud save failed:', error.message);
  } catch (e) {
    console.warn('[OAD] cloud save error:', e);
  }
};

OAD._loadFromCloud = async function () {
  try {
    var { data, error } = await OAD.supabase
      .from('user_data')
      .select('db')
      .eq('user_id', OAD._userId)
      .single();
    if (error && error.code !== 'PGRST116') { // PGRST116 = row not found
      console.warn('[OAD] cloud load failed:', error.message);
      return false;
    }
    if (data && data.db && Array.isArray(data.db.threads)) {
      OAD.DB = data.db;
      OAD._normalizeDB();
      // Keep localStorage in sync as local cache
      OAD.saveDB();
      return true;
    }
    return false; // no cloud data yet
  } catch (e) {
    console.warn('[OAD] cloud load error:', e);
    return false;
  }
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
