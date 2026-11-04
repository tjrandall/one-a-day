window.OAD = window.OAD || {};

// Tell me about a day. The model judges the shape of the day and which
// existing threads fit. A route lookup measures the miles. Nothing is
// written until Yes. Appointments are ordinary threads (ARCHITECTURE_RULES.md
// Rule 1) with day_impact windshield, partial, or full.

OAD.DayBrief = OAD.DayBrief || {};
OAD.DayBrief.pending = null;
OAD.DayBrief.expanded = false;
OAD.DayBrief._geoCache = {};

OAD.DayBrief.systemPrompt = function () {
  var home = (OAD.Config && OAD.Config.homeLabel) || 'Plymouth, MA';
  var areas = (OAD.LIFE_AREAS && OAD.LIFE_AREAS.length)
    ? OAD.LIFE_AREAS.join(', ')
    : 'Career, Housing, Personal Growth, Family, Health, Finances';
  return [
    'You read one description of a day for T.J. Randall.',
    'Home is ' + home + '. The app adds home to both ends of the drive and measures the miles. You do not invent mileage.',
    'A thread is a real commitment: an appointment, a pickup, a visit. Driving, traffic, and the name of a town are not threads.',
    'Collapse one errand into one thread. Picking someone up, collecting something for them, and dropping them off is one thread. A later appointment is a second thread.',
    'kind windshield: the day is the car and the stops. Desk work does not fit. Calls, dictation, and audio do.',
    'kind gone: the day cannot hold work, such as a move, surgery, or an all-day trip.',
    'kind chipped: a block of hours is gone and the rest of the day is still a desk.',
    'schedule and keep_off may contain only uuids from the open thread list. Do not invent a uuid.',
    'Ask one question only when a clock time would change the kind. Otherwise question is null.',
    'Titles contain no dates. life_area is one of: ' + areas + '.',
    'because is two sentences on why this kind of day and what work fits. Do not state miles, minutes, or hours.',
    'Return one JSON object and no other text:',
    '{"date":"YYYY-MM-DD","kind":"windshield","stops":["Town, ST"],"question":null,"creates":[{"title":"","life_area":"Family"}],"schedule":[],"keep_off":[],"because":""}'
  ].join(' ');
};

OAD.DayBrief.openThreads = function (threads, today) {
  return (threads || []).filter(function (thread) {
    return thread && thread.status === 'open' && thread.uuid &&
      thread.thread_kind !== 'habit' && thread.thread_kind !== 'idea' && thread.thread_kind !== 'cadence';
  }).sort(function (a, b) {
    function key(thread) {
      var date = thread.next_action_date || thread.deadline || '';
      if (!date) return '2';
      if (today && date < today) return '0' + date;
      return '1' + date;
    }
    var ka = key(a);
    var kb = key(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  }).slice(0, 80);
};

OAD.DayBrief.messages = function (text, threads, today, previous) {
  var home = (OAD.Config && OAD.Config.homeLabel) || 'Plymouth, MA';
  var lines = OAD.DayBrief.openThreads(threads, today).map(function (thread) {
    return [
      thread.uuid,
      thread.title || '',
      thread.next_action || '',
      thread.next_action_channel || '',
      thread.next_action_date || '',
      thread.deadline || ''
    ].join(' | ');
  }).join('\n');
  var user = 'Today is ' + today + '.\nHome is ' + home + '.\n\nOpen threads (uuid | title | next action | channel | next action date | deadline):\n' +
    (lines || '(none)') + '\n\n';
  if (previous) {
    user += 'Previous brief JSON:\n' + JSON.stringify(previous) + '\n\nThe user is correcting it:\n' + text;
  } else {
    user += 'The user said:\n' + text;
  }
  return { system: OAD.DayBrief.systemPrompt(), user: user };
};

OAD.DayBrief.complete = async function (packet) {
  return OAD._llmCall([{ role: 'user', content: packet.user }], packet.system);
};

OAD.DayBrief._normalizeDate = function (iso, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  if (!today || iso >= today) return iso;
  var bumped = today.slice(0, 4) + iso.slice(4);
  if (bumped >= today) return bumped;
  return String(Number(today.slice(0, 4)) + 1) + iso.slice(4);
};

OAD.DayBrief._withoutMileage = function (text) {
  var parts = String(text || '').match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  return parts.filter(function (sentence) {
    return !/\bmiles?\b/i.test(sentence) && !/\bminutes?\b/i.test(sentence) && !/\bhours?\b/i.test(sentence);
  }).join(' ').replace(/\s+/g, ' ').trim();
};

OAD.DayBrief._isHome = function (stop) {
  var text = String(stop || '').toLowerCase();
  var home = String((OAD.Config && OAD.Config.homeLabel) || 'Plymouth, MA').toLowerCase();
  if (text === home) return true;
  return text.indexOf('plymouth') !== -1;
};

OAD.DayBrief.parse = function (raw, today) {
  var obj = raw;
  if (typeof raw === 'string') {
    var start = raw.indexOf('{');
    var end = raw.lastIndexOf('}');
    if (start === -1 || end < start) throw new Error('The day brief was not readable.');
    obj = JSON.parse(raw.slice(start, end + 1));
  }
  if (!obj || typeof obj !== 'object') throw new Error('The day brief was not readable.');
  var kind = obj.kind === 'gone' || obj.kind === 'chipped' || obj.kind === 'windshield' ? obj.kind : 'windshield';
  var date = OAD.DayBrief._normalizeDate(String(obj.date || ''), today);
  if (!date) throw new Error('No day was found in that description.');
  var stops = [];
  (Array.isArray(obj.stops) ? obj.stops : []).forEach(function (stop) {
    var clean = String(stop || '').trim();
    if (!clean || OAD.DayBrief._isHome(clean)) return;
    if (stops.length && stops[stops.length - 1].toLowerCase() === clean.toLowerCase()) return;
    stops.push(clean);
  });
  var areas = (OAD.LIFE_AREAS && OAD.LIFE_AREAS.length) ? OAD.LIFE_AREAS : ['Career', 'Housing', 'Personal Growth', 'Family', 'Health', 'Finances'];
  var fallbackArea = (OAD.Config && OAD.Config.defaultLifeArea) || areas[0];
  var creates = [];
  (Array.isArray(obj.creates) ? obj.creates : []).forEach(function (row) {
    var title = String((row && row.title) || '').trim();
    if (!title) return;
    var area = areas.indexOf(row.life_area) !== -1 ? row.life_area : fallbackArea;
    creates.push({ title: title, life_area: area });
  });
  function uuids(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (uuid) {
      var clean = String(uuid || '').trim();
      if (clean && out.indexOf(clean) === -1) out.push(clean);
    });
    return out;
  }
  var question = obj.question == null ? '' : String(obj.question).trim();
  return {
    date: date,
    kind: kind,
    stops: stops,
    question: question,
    creates: creates,
    schedule: uuids(obj.schedule),
    keep_off: uuids(obj.keep_off),
    because: OAD.DayBrief._withoutMileage(obj.because)
  };
};

OAD.DayBrief.geocode = async function (place) {
  var key = String(place || '').trim().toLowerCase();
  if (OAD.DayBrief._geoCache[key]) return OAD.DayBrief._geoCache[key];
  var query = place;
  if (!/massachusetts|\bma\b|\busa\b/i.test(place)) query = place + ', Massachusetts, USA';
  var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(query);
  var res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Could not locate ' + place);
  var rows = await res.json();
  if (!rows || !rows.length || rows[0].lat == null || rows[0].lon == null) throw new Error('Could not locate ' + place);
  var hit = { lat: String(rows[0].lat), lon: String(rows[0].lon) };
  OAD.DayBrief._geoCache[key] = hit;
  return hit;
};

OAD.DayBrief.measure = async function (stops) {
  var home = (OAD.Config && OAD.Config.homeLabel) || 'Plymouth, MA';
  var places = [home].concat(stops || [], [home]);
  var coords = [];
  var i;
  for (i = 0; i < places.length; i++) {
    coords.push(await OAD.DayBrief.geocode(places[i]));
  }
  var path = coords.map(function (hit) { return hit.lon + ',' + hit.lat; }).join(';');
  var res = await fetch('https://router.project-osrm.org/route/v1/driving/' + path + '?overview=false');
  if (!res.ok) throw new Error('The route could not be measured.');
  var data = await res.json();
  var route = data && data.routes && data.routes[0];
  if (!route || !route.distance) throw new Error('The route could not be measured.');
  return {
    miles: Math.round(route.distance / 1609.344),
    minutes: Math.round(route.duration / 60),
    places: places
  };
};

OAD.DayBrief._impactFor = function (kind) {
  if (kind === 'gone') return 'full';
  if (kind === 'chipped') return 'partial';
  return 'windshield';
};

OAD.DayBrief._label = function (date) {
  return (OAD.Capacity && OAD.Capacity._label) ? OAD.Capacity._label(date) : date;
};

OAD.DayBrief._deskDestination = function (thread, date, impact, threads) {
  if (!thread || thread.next_action_date !== date) return null;
  if (!thread.deadline || !OAD.Capacity || !OAD.Capacity._isDate(thread.deadline)) return '';
  var stub = { status: 'open', day_impact: impact, next_action_date: date, title: 'day' };
  var lost = OAD.Capacity._lostDays((threads || []).concat([stub]));
  var load = OAD.Capacity._loadDays(thread.deadline, lost);
  var dest = load.length ? load[0] : '';
  if (dest === date) dest = load.length > 1 ? load[1] : '';
  if (dest && dest === thread.deadline) dest = OAD.Capacity._addDays(dest, -1);
  if (dest === date) dest = '';
  return dest || '';
};

OAD.DayBrief.assemble = function (parsed, route, threads) {
  var impact = OAD.DayBrief._impactFor(parsed.kind);
  var byUuid = {};
  (threads || []).forEach(function (thread) {
    if (thread && thread.uuid) byUuid[thread.uuid] = thread;
  });
  var openByTitle = {};
  (threads || []).forEach(function (thread) {
    if (thread && thread.status === 'open' && thread.title) openByTitle[thread.title.trim().toLowerCase()] = thread;
  });
  var miles = route && route.miles != null ? route.miles : null;
  var minutes = route && route.minutes != null ? route.minutes : null;
  var changes = [];
  var heldOff = {};

  (parsed.keep_off || []).forEach(function (uuid) {
    var thread = byUuid[uuid];
    if (!thread || thread.status !== 'open') return;
    heldOff[uuid] = true;
    if (thread.next_action_date !== parsed.date) return;
    var dest = OAD.DayBrief._deskDestination(thread, parsed.date, impact, threads);
    var fromLabel = OAD.DayBrief._label(parsed.date);
    if (dest) {
      changes.push({
        op: 'move',
        uuid: uuid,
        title: thread.title,
        patch: { next_action_date: dest },
        text: 'Move ' + thread.title + ' from ' + fromLabel + ' to ' + OAD.DayBrief._label(dest) + '.'
      });
    } else {
      changes.push({
        op: 'move',
        uuid: uuid,
        title: thread.title,
        patch: { next_action_date: '' },
        text: 'Take ' + thread.title + ' off ' + fromLabel + '.'
      });
    }
  });

  (parsed.schedule || []).forEach(function (uuid) {
    if (heldOff[uuid]) return;
    var thread = byUuid[uuid];
    if (!thread || thread.status !== 'open') return;
    if (thread.deadline && thread.deadline === parsed.date) {
      changes.push({
        op: 'skip',
        uuid: uuid,
        title: thread.title,
        text: 'Left ' + thread.title + ' alone. ' + OAD.DayBrief._label(parsed.date) + ' is its deadline.'
      });
      return;
    }
    changes.push({
      op: 'schedule',
      uuid: uuid,
      title: thread.title,
      patch: { next_action_date: parsed.date, day_fit: 'windshield' },
      text: 'Put ' + thread.title + ' on ' + OAD.DayBrief._label(parsed.date) + '.'
    });
  });

  parsed.creates.forEach(function (row) {
    var existing = openByTitle[row.title.toLowerCase()];
    if (existing) {
      var patch = {
        day_impact: impact,
        travel_miles: miles,
        travel_minutes: minutes,
        next_action_date: parsed.date
      };
      if (existing.deadline && existing.deadline === parsed.date) patch.deadline = null;
      changes.push({
        op: 'update',
        uuid: existing.uuid,
        title: existing.title,
        patch: patch,
        text: 'Update ' + existing.title + ' on ' + OAD.DayBrief._label(parsed.date) + '.'
      });
      return;
    }
    changes.push({
      op: 'create',
      title: row.title,
      life_area: row.life_area,
      day_impact: impact,
      next_action_date: parsed.date,
      travel_miles: miles,
      travel_minutes: minutes,
      text: 'Create ' + row.title + ' on ' + OAD.DayBrief._label(parsed.date) + '.'
    });
  });

  var writable = changes.filter(function (change) { return change.op !== 'skip'; });
  var proposal = {
    date: parsed.date,
    kind: parsed.kind,
    impact: impact,
    stops: parsed.stops,
    miles: miles,
    minutes: minutes,
    routeError: (route && route.error) || '',
    question: parsed.question,
    because: parsed.because,
    changes: changes,
    parsed: parsed,
    canApply: !parsed.question && writable.length > 0
  };
  proposal.reply = OAD.DayBrief.replyText(proposal);
  return proposal;
};

OAD.DayBrief.replyText = function (proposal) {
  var label = OAD.DayBrief._label(proposal.date);
  var line;
  if (proposal.impact === 'full') line = label + ' is gone.';
  else if (proposal.impact === 'partial') line = label + ' is partly gone.';
  else line = label + ' is a windshield day.';
  if (proposal.miles != null) {
    line += ' The loop is ' + proposal.miles + ' miles';
    var phrase = OAD.Capacity && OAD.Capacity._drivePhrase(proposal.minutes);
    if (phrase) line += ' and about ' + phrase + ' of driving before traffic';
    line += '.';
  } else if (proposal.routeError) {
    line += ' The driving distance could not be measured, so no mileage is claimed.';
  }
  if (proposal.because) line += ' ' + proposal.because;
  return line;
};

OAD.DayBrief.propose = async function (text, opts) {
  opts = opts || {};
  var today = opts.today || (typeof OAD.todayStr === 'function' ? OAD.todayStr() : '');
  var threads = opts.threads || (OAD.DB && OAD.DB.threads) || [];
  var complete = opts.complete || OAD.DayBrief.complete;
  var measure = opts.measure || OAD.DayBrief.measure;
  var raw = await complete(OAD.DayBrief.messages(String(text || '').trim(), threads, today, opts.previous || null));
  var parsed = OAD.DayBrief.parse(raw, today);
  var route = { miles: null, minutes: null, error: '' };
  if (parsed.stops.length) {
    try {
      route = await measure(parsed.stops);
    } catch (err) {
      route = { miles: null, minutes: null, error: (err && err.message) || 'Route lookup failed' };
    }
  }
  return OAD.DayBrief.assemble(parsed, route, threads);
};

OAD.DayBrief.apply = function (proposal) {
  if (!proposal || !proposal.canApply) return { created: [], scheduled: [], moved: [], error: 'Nothing to save.' };
  var created = [];
  var scheduled = [];
  var moved = [];
  OAD._suppressSaveDB = true;
  try {
    (proposal.changes || []).forEach(function (change) {
      if (change.op === 'create') {
        var thread = OAD.addThread(OAD.makeThread({
          title: change.title,
          life_area: change.life_area,
          status: 'open',
          priority: 'medium',
          next_action: change.title,
          next_action_date: change.next_action_date,
          deadline: null,
          day_impact: change.day_impact,
          travel_miles: change.travel_miles,
          travel_minutes: change.travel_minutes
        }));
        OAD.addEvolution(thread.id, 'Added from a day brief.');
        created.push(thread);
      } else if (change.op === 'update' || change.op === 'schedule' || change.op === 'move') {
        var existing = OAD.getThreadByUUID(change.uuid);
        if (!existing) return;
        OAD.updateThread(existing.id, change.patch);
        OAD.addEvolution(existing.id, 'Dated from a day brief.');
        if (change.op === 'schedule') scheduled.push(existing);
        else moved.push(existing);
      }
    });
  } finally {
    OAD._suppressSaveDB = false;
  }
  if (typeof OAD.saveDB === 'function') OAD.saveDB();
  if (OAD.Capacity && typeof OAD.Capacity.syncEdges === 'function') OAD.Capacity.syncEdges();
  return { created: created, scheduled: scheduled, moved: moved };
};

OAD.DayBrief.boxHtml = function () {
  var pending = OAD.DayBrief.pending;
  var placeholder = pending
    ? 'Correct one thing. Leave a call off, or give a time.'
    : 'On Monday, Nov 9th, I have to drive to Norwood and pick up Abigail...';
  var html = '<section class="day-brief" id="day-brief">';
  html += '<h2>Tell me about a day</h2>';
  html += '<textarea id="day-brief-input" placeholder="' + OAD.esc(placeholder) + '"></textarea>';
  html += '<div class="day-brief-actions">';
  html += '<button class="success" id="day-brief-send" type="button" onclick="OAD.DayBrief.submit()">Send</button>';
  if (pending) {
    html += '<button class="secondary" id="day-brief-discard" type="button" onclick="OAD.DayBrief.discard()">Discard</button>';
  }
  html += '</div>';
  if (pending) {
    if (pending.question) html += '<p class="day-brief-question">' + OAD.esc(pending.question) + '</p>';
    html += '<p class="day-brief-reply">' + OAD.esc(pending.reply || '') + '</p>';
    if (pending.changes && pending.changes.length) {
      html += '<ul class="day-brief-changes">';
      pending.changes.forEach(function (change) {
        html += '<li>' + OAD.esc(change.text) + '</li>';
      });
      html += '</ul>';
    }
    html += '<div class="day-brief-actions">';
    html += '<button class="success" id="day-brief-yes" type="button" onclick="OAD.DayBrief.confirm()"' +
      (pending.canApply ? '' : ' disabled') + '>Yes</button>';
    html += '</div>';
  }
  html += '</section>';
  return html;
};

OAD.DayBrief._paint = function () {
  var existing = document.getElementById('day-brief');
  if (!existing) return;
  existing.outerHTML = OAD.DayBrief.boxHtml();
};

OAD.DayBrief.submit = async function () {
  var input = document.getElementById('day-brief-input');
  var status = document.getElementById('day-brief-status');
  if (!input) return;
  var text = input.value.trim();
  if (!text) return;
  if (!status) {
    status = document.createElement('p');
    status.className = 'day-brief-status';
    status.id = 'day-brief-status';
    input.parentNode.appendChild(status);
  }
  status.textContent = 'Reading the day...';
  var send = document.getElementById('day-brief-send');
  if (send) send.disabled = true;
  try {
    var proposal = await OAD.DayBrief.propose(text, {
      previous: OAD.DayBrief.pending ? OAD.DayBrief.pending.parsed : null
    });
    OAD.DayBrief.pending = proposal;
    OAD.DayBrief._paint();
  } catch (err) {
    status.textContent = (err && err.message) || 'The day could not be read.';
    if (send) send.disabled = false;
  }
};

OAD.DayBrief.toggle = function () {
  if (OAD.DayBrief.pending) return;
  OAD.DayBrief.expanded = !OAD.DayBrief.expanded;
  if (OAD._lastView === 'Daily' && typeof OAD.renderDailyView === 'function') OAD.renderDailyView();
  if (OAD.DayBrief.expanded) {
    var input = document.getElementById('day-brief-input');
    if (input) input.focus();
  }
};

OAD.DayBrief.discard = function () {
  OAD.DayBrief.pending = null;
  OAD.DayBrief.expanded = false;
  if (OAD._lastView === 'Daily' && typeof OAD.renderDailyView === 'function') OAD.renderDailyView();
  else OAD.DayBrief._paint();
};

OAD.DayBrief.confirm = function () {
  var pending = OAD.DayBrief.pending;
  if (!pending || !pending.canApply) return null;
  var result = OAD.DayBrief.apply(pending);
  OAD.DayBrief.pending = null;
  OAD.DayBrief.expanded = false;
  if (typeof OAD.refreshActiveView === 'function') OAD.refreshActiveView();
  return result;
};
