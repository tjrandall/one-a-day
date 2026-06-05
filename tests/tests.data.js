window.OAD = window.OAD || {};

OAD._seedData = function () {
  OAD.DB.threads  = [];
  OAD.DB.cadences = [];
  OAD.DB.habits   = [];
  OAD.DB.ideas    = [];

  // t1 — VR&E Equipment (Amanda)
  OAD.addThread(OAD.makeThread({
    id: 't1',
    title: 'VR&E Equipment (Amanda)',
    life_area: 'vre',
    status: 'waiting',
    priority: 'high',
    closing_condition: 'Dell XPS 15 received and in use',
    closing_condition_type: 'outcome',
    closing_condition_met: false,
    current_assumption: 'Equipment ordered mid-May — no tracking number, no vendor name, no ETA',
    assumption_verified: false,
    next_action: 'Email Amanda at eva@va.gov asking for order status, delivery date, and tracking number',
    next_action_date: '2026-05-31',
    next_action_channel: 'email',
    next_action_contact: 'Amanda (eva@va.gov)',
    contingency_trigger_date: '2026-06-05',
    contingency_action: 'Call 857-352-4771 and ask for vendor contact directly',
    contingency_escalation: '',
    connections: [
      { to_label: 'VR&E service plan', edge_type: 'blocks' },
      { to_label: 'Northeastern fall 2026 ArcGIS', edge_type: 'enables' }
    ],
    evolution_log: [
      { date: '2026-05-01', note: 'Early May — Amanda agreed to request equipment.' },
      { date: '2026-05-12', note: 'Equipment list submitted: Dell XPS 15, monitor, headphones (~$2,267).' },
      { date: '2026-05-15', note: 'Mid-May — Amanda confirmed ordered. No tracking number, no ETA.' },
      { date: '2026-05-29', note: 'No equipment received. Email queued for Saturday.' }
    ],
    ai_insights: []
  }));

  // t2 — SAM.gov legal business name correction
  OAD.addThread(OAD.makeThread({
    id: 't2',
    title: 'SAM.gov Legal Business Name Correction',
    life_area: 'business',
    status: 'waiting',
    priority: 'critical',
    closing_condition: 'CAGE code assigned under Randall Advisory Group LLC; SDVOSB VetCert can begin',
    closing_condition_type: 'outcome',
    closing_condition_met: false,
    current_assumption: 'EVS correction path will eventually work',
    assumption_verified: false,
    next_action: 'Upload CP575/147C EIN letter + written explanation + MA SOS Business Entity Summary to ticket INC-GSAFSD21130255',
    next_action_date: '2026-06-04',
    next_action_channel: 'portal',
    next_action_contact: 'GSA EVS (INC-GSAFSD21130255)',
    contingency_trigger_date: '2026-06-05',
    contingency_action: 'Escalate above EVS — GSA ombudsman, congressional inquiry, or direct contracting officer',
    contingency_escalation: 'Six tickets over two months suggests standard path may be broken',
    connections: [
      { to_label: 'SDVOSB VetCert', edge_type: 'blocks' },
      { to_label: 'Federal consulting revenue', edge_type: 'blocks' }
    ],
    evolution_log: [
      { date: '2026-04-01', note: 'April 2026 — first ticket opened.' },
      { date: '2026-05-01', note: 'May 2026 — five subsequent tickets opened, none resolved.' },
      { date: '2026-05-26', note: 'Current ticket submitted.' },
      { date: '2026-05-28', note: 'EVS rejected MA SOS doc — requires CP575 and written explanation.' },
      { date: '2026-05-29', note: 'Deadline June 4: call IRS 800-829-4933 for 147C letter.' }
    ],
    ai_insights: []
  }));

  // t3 — DCMA GS-1515-13 referral
  OAD.addThread(OAD.makeThread({
    id: 't3',
    title: 'DCMA GS-1515-13 Referral',
    life_area: 'job_search',
    status: 'waiting',
    priority: 'high',
    closing_condition: 'Job offer received and accepted from DCMA',
    closing_condition_type: 'outcome',
    closing_condition_met: false,
    current_assumption: 'Referred means application is moving forward',
    assumption_verified: false,
    next_action: 'Monitor USAJobs status',
    next_action_date: '2026-06-05',
    next_action_channel: 'portal',
    next_action_contact: 'DCMA HR',
    contingency_trigger_date: '2026-06-12',
    contingency_action: 'Call DCMA HR 614-692-2048',
    contingency_escalation: '',
    connections: [
      { to_label: 'November 2026 employment deadline', edge_type: 'relates' }
    ],
    evolution_log: [
      { date: '2026-05-08', note: 'Applied.' },
      { date: '2026-05-19', note: 'Status updated to REFERRED to hiring manager.' }
    ],
    ai_insights: []
  }));

  // t4 — Semco Maritime Operations Manager
  OAD.addThread(OAD.makeThread({
    id: 't4',
    title: 'Semco Maritime Operations Manager',
    life_area: 'job_search',
    status: 'open',
    priority: 'high',
    closing_condition: 'Application submitted before June 12 deadline',
    closing_condition_type: 'outcome',
    closing_condition_met: false,
    current_assumption: 'Dutch/European HQ hook will resonate with Danish employer',
    assumption_verified: false,
    next_action: 'Monitor for response',
    next_action_date: '2026-06-12',
    next_action_channel: 'email',
    next_action_contact: 'Semco Maritime Hiring',
    contingency_trigger_date: '2026-06-12',
    contingency_action: 'Hard deadline — no contingency',
    contingency_escalation: '',
    connections: [],
    evolution_log: [
      { date: '2026-05-26', note: 'Resume and cover letter built. Video script drafted.' },
      { date: '2026-05-30', note: 'Video recorded. Application submitted with video cover letter.' }
    ],
    ai_insights: []
  }));

  // t5 — CISA Schedule A 30% Disabled Veteran Repository
  OAD.addThread(OAD.makeThread({
    id: 't5',
    title: 'CISA Schedule A 30% Disabled Veteran Repository',
    life_area: 'job_search',
    status: 'waiting',
    priority: 'medium',
    closing_condition: 'Application reviewed and contacted for position',
    closing_condition_type: 'outcome',
    closing_condition_met: false,
    current_assumption: 'Schedule A pathway will result in contact from CISA',
    assumption_verified: false,
    next_action: 'Email veterans@cisa.dhs.gov with resume and Schedule A letter',
    next_action_date: '2026-06-01',
    next_action_channel: 'email',
    next_action_contact: 'veterans@cisa.dhs.gov',
    contingency_trigger_date: '',
    contingency_action: 'No hard contingency — repository is open through September 30',
    contingency_escalation: '',
    connections: [],
    evolution_log: [
      { date: '2026-05-30', note: 'Submitted via USAJobs announcement 869613100 with DD-214, Schedule A letter, and claim letter.' }
    ],
    ai_insights: []
  }));

  // t6 — ENV-118 Student Presentation
  OAD.addThread(OAD.makeThread({
    id: 't6',
    title: 'ENV-118 Student Presentation',
    life_area: 'education',
    status: 'open',
    priority: 'high',
    closing_condition: 'Presentation submitted by June 18 and Professor Etter confirms approval with 100 grade on forum',
    closing_condition_type: 'outcome',
    closing_condition_met: false,
    current_assumption: 'Topic "Glacial Origins of Cape Cod and Environmental Legacy" will be approved',
    assumption_verified: false,
    next_action: 'Check forum for Professor Etter grade on intro post confirming topic approval',
    next_action_date: '2026-06-02',
    next_action_channel: 'portal',
    next_action_contact: 'Professor Etter',
    contingency_trigger_date: '2026-06-03',
    contingency_action: 'If topic not approved, select backup topic immediately',
    contingency_escalation: '',
    connections: [
      { to_label: 'ENV-118 course completion', edge_type: 'relates' }
    ],
    evolution_log: [
      { date: '2026-05-31', note: 'Topic submitted in forum intro post.' },
      { date: '2026-05-31', note: 'Resource saved: https://www.youtube.com/watch?v=cWbtdJP1v08&t=1s' }
    ],
    ai_insights: []
  }));

  // t7 — ENV-118 Full Course Completion
  OAD.addThread(OAD.makeThread({
    id: 't7',
    title: 'ENV-118 Full Course Completion',
    life_area: 'education',
    status: 'open',
    priority: 'high',
    closing_condition: 'All assignments submitted by July 2, 2026 absolute deadline with grade of A',
    closing_condition_type: 'outcome',
    closing_condition_met: false,
    current_assumption: 'Biweekly cadence is manageable alongside eCornell Python',
    assumption_verified: false,
    next_action: 'Complete Week 2 eco-footprint forum, Ocean Temperature lab, and Quiz Ch1',
    next_action_date: '2026-06-03',
    next_action_channel: 'portal',
    next_action_contact: 'Professor Etter',
    contingency_trigger_date: '',
    contingency_action: 'If falling behind, contact Professor Etter immediately — she accepts early work and has optional extra credit',
    contingency_escalation: '',
    connections: [
      { to_label: 'Northeastern GIS certificate fall 2026 enrollment', edge_type: 'blocks' },
      { to_label: 'GS-1350/1301 OPM qualification', edge_type: 'enables' }
    ],
    evolution_log: [
      { date: '2026-06-01', note: 'Course started.' },
      { date: '2026-06-01', note: 'Week 1 complete — safety lab, forum intro, and glossary terms all submitted.' }
    ],
    ai_insights: []
  }));

  // t8 — eCornell Python for Data Science (final presentation June 26)
  OAD.addThread(OAD.makeThread({
    id: 't8',
    title: 'eCornell Python for Data Science',
    life_area: 'Education',
    status: 'open',
    priority: 'high',
    closing_condition: 'Certificate earned and VR&E subsistence payments confirmed through course completion',
    closing_condition_type: 'outcome',
    closing_condition_met: false,
    current_assumption: 'Course load manageable alongside ENV-118 biweekly cadence — syllabus not yet reviewed',
    assumption_verified: false,
    next_action: 'Review syllabus and map remaining assignments against June 26 final presentation deadline',
    next_action_date: '2026-06-05',
    next_action_channel: 'portal',
    next_action_contact: 'eCornell / Amanda (eva@va.gov)',
    contingency_trigger_date: '2026-06-19',
    contingency_action: 'If presentation is not prepared by June 19, contact Amanda before missing submission',
    contingency_escalation: '',
    deadline: '2026-06-26',
    effortEstimate: 4,
    weeklyCommitment: 1,
    effortLogged: 0,
    connections: [
      { to_label: 'Northeastern GIS certificate', edge_type: 'enables' },
      { to_label: 'VR&E service plan', edge_type: 'relates' }
    ],
    evolution_log: [
      { date: '2026-05-31', note: 'Orientation completed.' },
      { date: '2026-06-03', note: 'Course starts per VR&E plan.' },
      { date: '2026-06-04', note: 'Deadline tracking enabled. Final presentation due June 26. Estimating 4 sessions at 1/week minimum — currently behind by 1 session.' }
    ],
    ai_insights: []
  }));

  // t9 — COBRA Abigail inclusion confirmation
  OAD.addThread(OAD.makeThread({
    id: 't9',
    title: 'COBRA Abigail Inclusion Confirmation',
    life_area: 'finances',
    status: 'stalled',
    priority: 'critical',
    closing_condition: 'Written confirmation from Rachele that Abigail is enrolled in COBRA coverage',
    closing_condition_type: 'outcome',
    closing_condition_met: false,
    current_assumption: 'Abigail was actually included when Andrea and Cydney were enrolled May 13',
    assumption_verified: false,
    next_action: 'Follow up with Rachele at Harbor Compliance — overdue since May 13',
    next_action_date: '2026-06-01',
    next_action_channel: 'email',
    next_action_contact: 'Rachele (Harbor Compliance)',
    contingency_trigger_date: '2026-06-02',
    contingency_action: 'Escalate to Harbor Compliance HR director directly',
    contingency_escalation: 'If Abigail is not covered and a medical claim is filed, the gap is a serious financial and legal problem',
    connections: [],
    evolution_log: [
      { date: '2026-05-13', note: 'Enrolled Andrea, Cydney, and Abigail via Rippling.' },
      { date: '2026-05-13', note: 'Email sent to Rachele awaiting confirmation.' },
      { date: '2026-05-31', note: 'Still no confirmation as of May 31.' }
    ],
    ai_insights: []
  }));

  // t10 — IRS lien $40,850.73
  OAD.addThread(OAD.makeThread({
    id: 't10',
    title: 'IRS Lien $40,850.73',
    life_area: 'finances',
    status: 'waiting',
    priority: 'critical',
    closing_condition: 'Robin has an active plan with IRS; lien resolved or payment arrangement confirmed in writing',
    closing_condition_type: 'outcome',
    closing_condition_met: false,
    current_assumption: 'Robin is actively working this — not just receiving emails',
    assumption_verified: false,
    next_action: 'Call Robin Monday June 2 if no response to May 29 email',
    next_action_date: '2026-06-02',
    next_action_channel: 'phone',
    next_action_contact: 'Robin (CPA)',
    contingency_trigger_date: '2026-06-09',
    contingency_action: 'Escalate to Jackie (financial advisor) to coordinate',
    contingency_escalation: '',
    connections: [
      { to_label: 'Financial stability', edge_type: 'relates' },
      { to_label: 'Randall Advisory Group LLC consulting pipeline', edge_type: 'relates' }
    ],
    evolution_log: [
      { date: '2026-05-28', note: 'Discovered IRS lien/levy threat of $40,850.73.' },
      { date: '2026-05-29', note: 'Email sent to Robin (CPA).' },
      { date: '2026-06-01', note: 'Voicemail planned if no response.' }
    ],
    ai_insights: []
  }));

  OAD.addCadence(OAD.makeCadence({
    title: 'Pay the Bills (1st)',
    life_area: 'finances',
    recurrence: 'monthly-1st',
    last_completed: '2026-05-01',
    next_due: '2026-06-01',
    notes: 'Review all bills: credit cards, utilities, subscriptions',
    consequences: 'Late fees, service disruption'
  }));

  OAD.addCadence(OAD.makeCadence({
    title: 'Pay the Bills (15th)',
    life_area: 'finances',
    recurrence: 'monthly-15th',
    last_completed: '2026-05-15',
    next_due: '2026-06-15',
    notes: 'Mid-month bill review and payments',
    consequences: 'Late fees, service disruption'
  }));

  OAD.DB.persona.life_context.pressure_level = 'high';
  OAD.DB.persona.life_context.hard_deadline = '2026-11-30';
  OAD.DB.persona.life_context.hard_deadline_context = 'Must secure full-time employment or contract work by end of November 2026. Financial cascade: no CAGE → no SDVOSB → no contracts → serious trouble by December.';
  OAD.DB.persona.assumption_tendencies = [
    'Assumes bureaucratic processes are moving even without confirmation',
    'Tends to wait longer than necessary before escalating',
    'Assumes parallel course loads are manageable without reviewing syllabi first'
  ];
  OAD.DB.persona.what_is_working = [
    'Documenting everything in writing',
    'Setting contingency dates with specific escalation paths',
    'Using video cover letters to differentiate applications'
  ];
  OAD.DB.persona.what_is_not_working = [
    'Following up assertively enough with government agencies',
    'Getting written confirmation before assuming enrollment or action is complete'
  ];
  OAD.DB.persona.tone_calibration.current_mode = 'problem-solving';
  OAD.DB.persona.tone_calibration.challenge_tolerance = 'medium';

  OAD._seedHabits();
  OAD._seedIdeas();
};

OAD._seedHabits = function () {
  OAD.addHabit(OAD.makeHabit({
    title: 'Morning Offering',
    frequency: 'daily', time_of_day: 'morning', life_area: 'Personal Growth',
    why: 'Consecrate the day to God before it begins.'
  }));
  OAD.addHabit(OAD.makeHabit({
    title: 'Reading and Prayer',
    frequency: 'daily', time_of_day: 'morning', life_area: 'Personal Growth',
    why: '20 minutes of lectio divina or spiritual reading — 6:30am.'
  }));
  OAD.addHabit(OAD.makeHabit({
    title: 'Prayer to St. Joseph',
    frequency: 'daily', time_of_day: 'morning', life_area: 'Personal Growth',
    why: 'Patron of workers and fathers — 7:30am.'
  }));
  OAD.addHabit(OAD.makeHabit({
    title: 'Morning Prayers',
    frequency: 'daily', time_of_day: 'morning', life_area: 'Personal Growth',
    why: 'Full morning prayer routine — Lauds, intentions, day offering.'
  }));
  OAD.addHabit(OAD.makeHabit({
    title: 'Ave Maris Stella',
    frequency: 'daily', time_of_day: 'morning', life_area: 'Personal Growth',
    why: 'Marian hymn as part of the morning routine.'
  }));
  OAD.addHabit(OAD.makeHabit({
    title: 'Prayer before work',
    frequency: 'every workday', time_of_day: 'morning', life_area: 'Personal Growth',
    why: 'Ask for grace and focus before beginning work.'
  }));
  OAD.addHabit(OAD.makeHabit({
    title: 'Daily Rosary',
    frequency: 'daily', time_of_day: 'flexible', life_area: 'Personal Growth',
    why: 'Core Marian practice. The most important habit in the list.'
  }));
  OAD.addHabit(OAD.makeHabit({
    title: 'Litany of Humility',
    frequency: 'every-other-day', time_of_day: 'morning', life_area: 'Personal Growth',
    why: 'Counter-formation against pride and self-seeking.'
  }));
  OAD.addHabit(OAD.makeHabit({
    title: 'Attend Mass',
    frequency: 'weekly', time_of_day: 'morning', life_area: 'Personal Growth',
    why: 'Thursday Mass — source and summit of the Christian life.'
  }));
  OAD.addHabit(OAD.makeHabit({
    title: 'Evening Examen',
    frequency: 'daily', time_of_day: 'evening', life_area: 'Personal Growth',
    why: 'Ignatian review of the day — gratitude, awareness, resolution. 8pm.'
  }));
  OAD.addHabit(OAD.makeHabit({
    title: 'Consecration to Sacred Heart',
    frequency: 'weekly', time_of_day: 'morning', life_area: 'Personal Growth',
    why: 'Sunday renewal of consecration to the Sacred Heart of Jesus.'
  }));

};

OAD._seedIdeas = function () {
  OAD.addIdea(OAD.makeIdea({
    title: 'NaNoWriMo: Book idea — Enemy',
    type: 'creative', energy_required: 'high',
    notes: 'A novel. The enemy is the premise.',
    added_date: '2026-01-01'
  }));
  OAD.addIdea(OAD.makeIdea({
    title: 'Hailstone Sequence — trackback to Adam and Eve',
    type: 'creative', energy_required: 'medium',
    notes: 'The Collatz conjecture as metaphor for the human condition. Every sequence eventually returns.',
    added_date: '2026-01-01'
  }));
  OAD.addIdea(OAD.makeIdea({
    title: 'Zen of Tommy notes',
    type: 'creative', energy_required: 'low',
    notes: 'Personal observations, aphorisms, the slow accumulation of a worldview.',
    added_date: '2026-01-01'
  }));
  OAD.addIdea(OAD.makeIdea({
    title: 'T-shirt: G-Man / Dirty Dozen — apostles as movie poster headshots',
    type: 'creative', energy_required: 'medium',
    notes: 'Twelve apostles in the style of a heist-film poster. Cast of characters.',
    added_date: '2026-01-01'
  }));

  // Read later — books
  OAD.addIdea(OAD.makeIdea({
    title: 'The New Economics for Industry, Government, Education',
    source: 'W. Edwards Deming',
    type: 'book', energy_required: 'high',
    added_date: '2026-01-01'
  }));
  OAD.addIdea(OAD.makeIdea({
    title: 'Five Dysfunctions of a Team',
    source: 'Patrick Lencioni',
    type: 'book', energy_required: 'low',
    added_date: '2026-01-01'
  }));
  OAD.addIdea(OAD.makeIdea({
    title: 'Heroic Leadership',
    source: 'Chris Lowney',
    type: 'book', energy_required: 'medium',
    added_date: '2026-01-01'
  }));
  OAD.addIdea(OAD.makeIdea({
    title: 'Safety at the Sharp End',
    source: 'Rhona Flin',
    type: 'book', energy_required: 'high',
    added_date: '2026-01-01'
  }));
  OAD.addIdea(OAD.makeIdea({
    title: 'Managing the Unexpected',
    source: 'Weick',
    type: 'book', energy_required: 'high',
    added_date: '2026-01-01'
  }));
  OAD.addIdea(OAD.makeIdea({
    title: 'The Human Contribution',
    source: 'James Reason',
    type: 'book', energy_required: 'high',
    added_date: '2026-01-01'
  }));
  OAD.addIdea(OAD.makeIdea({
    title: 'Sources of Power',
    source: 'Gary Klein',
    type: 'book', energy_required: 'medium',
    added_date: '2026-01-01'
  }));
  OAD.addIdea(OAD.makeIdea({
    title: 'Trauma and Recovery',
    source: 'Judith Herman',
    type: 'book', energy_required: 'high',
    added_date: '2026-01-01'
  }));
  OAD.addIdea(OAD.makeIdea({
    title: 'The Body Keeps the Score',
    source: 'Bessel van der Kolk',
    type: 'book', energy_required: 'high',
    added_date: '2026-01-01'
  }));
  OAD.addIdea(OAD.makeIdea({
    title: 'The Heart of Change',
    source: 'John Kotter',
    type: 'book', energy_required: 'medium',
    added_date: '2026-01-01'
  }));
};

