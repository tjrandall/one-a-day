window.OAD = window.OAD || {};

OAD._seedData = function () {
  OAD.DB.threads = [];

  OAD.addThread(OAD.makeThread({
    title: 'VR&E Equipment Request',
    life_area: 'Legal',
    status: 'waiting',
    priority: 'high',
    closing_condition: 'VA VR&E confirms equipment order placed and estimated delivery date received in writing',
    closing_condition_type: 'outcome',
    closing_condition_met: false,
    current_assumption: 'Counselor received my equipment list email and is processing it',
    assumption_verified: false,
    next_action: 'Follow up with VR&E counselor if no response by trigger date',
    next_action_date: '2026-06-06',
    next_action_channel: 'email',
    next_action_contact: 'VR&E Counselor',
    contingency_trigger_date: '2026-06-06',
    contingency_action: 'Call the VA VR&E office directly and request supervisor escalation',
    contingency_escalation: 'File Congressional inquiry if no movement in 2 weeks',
    connections: [],
    evolution_log: [
      { date: '2026-05-15', note: 'Submitted equipment list to VR&E counselor via email.' },
      { date: '2026-05-22', note: 'No response yet. Sent a follow-up email.' },
      { date: '2026-05-30', note: 'Still waiting. Set contingency trigger for June 6.' }
    ],
    ai_insights: []
  }));

  OAD.DB.persona.life_context.pressure_level = 'moderate';
  OAD.DB.persona.assumption_tendencies = [
    'Assumes bureaucratic processes are moving even without confirmation',
    'Tends to wait longer than necessary before escalating'
  ];
  OAD.DB.persona.what_is_working = [
    'Documenting everything in writing',
    'Setting contingency dates'
  ];
  OAD.DB.persona.what_is_not_working = [
    'Following up assertively enough with government agencies'
  ];
  OAD.DB.persona.tone_calibration.current_mode = 'problem-solving';
  OAD.DB.persona.tone_calibration.challenge_tolerance = 'medium';
};
