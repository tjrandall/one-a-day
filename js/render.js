window.OAD = window.OAD || {};

OAD._activeId = null;

OAD.renderList = function () {
  const query   = (document.getElementById('search-input')?.value || '').toLowerCase();
  const threads = OAD.DB.threads
    .filter(t => !query || t.title.toLowerCase().includes(query) || t.life_area.toLowerCase().includes(query))
    .map(t => ({ ...t, _score: OAD.pressure(t) }))
    .sort((a, b) => b._score - a._score);

  const container = document.getElementById('thread-list');
  if (!container) return;

  if (!threads.length) {
    container.innerHTML = '<div style="padding:24px;color:var(--text-muted);text-align:center;font-size:14px;">No threads yet. Add one above.</div>';
    return;
  }

  container.innerHTML = threads.map(t => {
    const pc = OAD.pressureClass(t._score);
    const active = t.id === OAD._activeId ? ' active' : '';
    return `
      <div class="thread-item${active}" data-id="${t.id}" onclick="OAD.selectThread(${t.id})">
        <div class="thread-item-top">
          <div class="thread-title">${OAD.esc(t.title)}</div>
          <div class="pressure-badge ${pc}">${t._score}</div>
        </div>
        <div class="thread-item-meta">
          <span class="pill ${OAD.esc(t.status)}">${OAD.esc(t.status)}</span>
          <span class="pill ${OAD.esc(t.priority)}">${OAD.esc(t.priority)}</span>
          <span>${OAD.esc(t.life_area)}</span>
        </div>
      </div>`;
  }).join('');

  OAD.renderPersonaBar();
};

OAD.renderPersonaBar = function () {
  const bar = document.getElementById('persona-bar');
  if (!bar) return;

  const threads = OAD.DB.threads;
  const open    = threads.filter(t => t.status !== 'closed').length;
  const stalled = threads.filter(t => t.status === 'stalled').length;
  const scores  = threads.map(t => OAD.pressure(t));
  const avg     = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const avgCls  = avg >= 60 ? 'pressure-high' : avg >= 30 ? 'pressure-mid' : 'pressure-low';
  const p = OAD.DB.persona;
  const dl = p.life_context.hard_deadline ? OAD.formatDate(p.life_context.hard_deadline) : '—';

  bar.innerHTML = `
    <div class="persona-stat"><span class="text-muted text-sm">Active</span><span class="val">${open}</span></div>
    <div class="persona-stat"><span class="text-muted text-sm">Stalled</span><span class="val" style="color:var(--stalled)">${stalled}</span></div>
    <div class="persona-stat"><span class="text-muted text-sm">Avg Pressure</span><span class="val ${avgCls}">${avg}</span></div>
    <div class="persona-stat"><span class="text-muted text-sm">Pressure Level</span><span class="val">${OAD.esc(p.life_context.pressure_level)}</span></div>
    <div class="persona-stat"><span class="text-muted text-sm">Hard Deadline</span><span class="val">${OAD.esc(dl)}</span></div>
    <div style="margin-left:auto">
      <button class="ghost" style="font-size:12px;padding:5px 10px" onclick="OAD.openPersonaModal()">Edit Persona</button>
    </div>`;
};

OAD.selectThread = function (id) {
  OAD._activeId = id;
  OAD.renderList();
  OAD.renderDetail(id);
};

OAD.renderDetail = function (id) {
  const panel = document.getElementById('detail-content');
  if (!panel) return;

  const t = OAD.getThread(id);
  if (!t) {
    panel.innerHTML = '<div class="detail-empty">Select a thread to view details</div>';
    return;
  }

  const score   = OAD.pressure(t);
  const pc      = OAD.pressureClass(score);
  const lastInsight = (t.ai_insights || []).slice(-1)[0] || null;

  const contingencyDays = OAD.daysUntil(t.contingency_trigger_date);
  const contingencyClass = contingencyDays !== null && contingencyDays < 3 ? 'contingency-urgent'
    : contingencyDays !== null && contingencyDays < 7 ? 'contingency-warn' : '';

  const connectionsHtml = (t.connections || []).length
    ? `<div class="connection-list">${t.connections.map(c => `
        <div class="connection-item">
          <span class="edge-type ${OAD.esc(c.edge_type)}">${OAD.esc(c.edge_type)}</span>
          <span>${OAD.esc(c.to_label)}</span>
        </div>`).join('')}</div>`
    : '<span class="text-muted text-sm">No connections</span>';

  const evoHtml = (t.evolution_log || []).length
    ? `<div class="evo-log">${[...(t.evolution_log)].reverse().map(e => `
        <div class="evo-entry">
          <span class="evo-date">${OAD.esc(e.date)}</span>
          <span class="evo-note">${OAD.esc(e.note)}</span>
        </div>`).join('')}</div>`
    : '<span class="text-muted text-sm">No history yet</span>';

  const insightHtml = lastInsight
    ? `<div class="insight-text">${OAD.esc(lastInsight.observation)}</div>
       ${lastInsight.blind_spot ? `<div class="mt-8 text-sm text-muted"><strong>Blind spot:</strong> ${OAD.esc(lastInsight.blind_spot)}</div>` : ''}
       ${lastInsight.challenge  ? `<div class="insight-challenge">"${OAD.esc(lastInsight.challenge)}"</div>` : ''}
       ${lastInsight.next_move  ? `<div class="mt-8 text-sm"><strong>Next move:</strong> ${OAD.esc(lastInsight.next_move)}</div>` : ''}
       <div class="text-muted text-sm mt-8">${OAD.esc(lastInsight.date || '')}</div>`
    : '<div class="insight-loading text-muted">No insight yet — click Generate Insight</div>';

  panel.innerHTML = `
    <div class="detail-header">
      <div>
        <div class="detail-title">${OAD.esc(t.title)}</div>
        <div class="detail-badges">
          <span class="pill ${OAD.esc(t.status)}">${OAD.esc(t.status)}</span>
          <span class="pill ${OAD.esc(t.priority)}">${OAD.esc(t.priority)}</span>
          <span class="pill" style="background:var(--surface2);color:var(--text-muted)">${OAD.esc(t.life_area)}</span>
          <span class="pressure-badge ${pc}" style="font-size:13px;padding:3px 8px">Pressure: ${score}</span>
        </div>
      </div>
      <div class="detail-actions">
        <button class="secondary" onclick="OAD.openEditModal(${t.id})">Edit</button>
        <button class="ghost" onclick="OAD.openLogModal(${t.id})">+ Log</button>
        <button onclick="OAD.generateInsight(${t.id})" id="insight-btn-${t.id}">Insight</button>
      </div>
    </div>

    <div class="card next-action-card">
      <div class="card-title">Next Action</div>
      <div class="next-action-text">${OAD.esc(t.next_action) || '<span class="text-muted">Not set</span>'}</div>
      <div class="next-action-meta">
        ${t.next_action_date    ? `<span>By ${OAD.formatDate(t.next_action_date)}</span>` : ''}
        ${t.next_action_channel ? `<span>via ${OAD.esc(t.next_action_channel)}</span>` : ''}
        ${t.next_action_contact ? `<span>with ${OAD.esc(t.next_action_contact)}</span>` : ''}
      </div>
      ${t.next_action_channel && t.next_action_channel.toLowerCase().includes('email')
        ? `<button class="ghost mt-8" style="font-size:12px;padding:5px 10px" onclick="OAD.draftEmailModal(${t.id})">Draft Email</button>`
        : ''}
    </div>

    <div class="card insight-card">
      <div class="insight-header">
        <div class="card-title" style="margin:0">AI Insight</div>
      </div>
      <div id="insight-body-${t.id}">${insightHtml}</div>
    </div>

    <div class="card">
      <div class="card-title">Closing Condition</div>
      <div class="${t.closing_condition_met ? 'closing-met' : 'closing-unmet'}">
        ${t.closing_condition_met ? '✓ Met — ' : '○ '}${OAD.esc(t.closing_condition) || '<span class="text-muted">Not defined</span>'}
      </div>
      <div class="text-muted text-sm mt-8">Type: ${OAD.esc(t.closing_condition_type)}</div>
    </div>

    <div class="card">
      <div class="card-title">Current Assumption</div>
      <div class="${t.assumption_verified ? 'assumption-verified' : 'assumption-unverified'}">
        ${t.assumption_verified ? '✓ Verified — ' : '⚠ Unverified — '}${OAD.esc(t.current_assumption) || '<span class="text-muted">None stated</span>'}
      </div>
    </div>

    <div class="card">
      <div class="card-title">Contingency</div>
      ${t.contingency_trigger_date ? `
        <div class="${contingencyClass}">Trigger: ${OAD.formatDate(t.contingency_trigger_date)}${contingencyDays !== null ? ` (${contingencyDays}d)` : ''}</div>
        <div class="text-sm mt-8">${OAD.esc(t.contingency_action) || '—'}</div>
        ${t.contingency_escalation ? `<div class="text-muted text-sm mt-8">Escalation: ${OAD.esc(t.contingency_escalation)}</div>` : ''}
      ` : '<span class="text-muted text-sm">No contingency set</span>'}
    </div>

    <div class="card">
      <div class="card-title">Connections</div>
      ${connectionsHtml}
      <button class="ghost mt-8" style="font-size:12px;padding:5px 10px" onclick="OAD.openConnectionModal(${t.id})">+ Add Connection</button>
    </div>

    <div class="card">
      <div class="card-title">Evolution Log</div>
      ${evoHtml}
    </div>`;
};

OAD.generateInsight = async function (id) {
  const btn  = document.getElementById(`insight-btn-${id}`);
  const body = document.getElementById(`insight-body-${id}`);
  const t    = OAD.getThread(id);
  if (!t || !body) return;

  if (btn) { btn.disabled = true; btn.textContent = 'Thinking…'; }
  if (body) body.innerHTML = '<div class="insight-loading">Generating insight…</div>';

  try {
    const insight = await OAD.genInsight(t);
    OAD.addInsight(id, insight);
    OAD.renderDetail(id);
  } catch (err) {
    if (body) body.innerHTML = `<div class="insight-loading" style="color:var(--critical)">${OAD.esc(err.message)}</div>`;
    if (btn)  { btn.disabled = false; btn.textContent = 'Insight'; }
  }
};

OAD.draftEmailModal = async function (id) {
  const t = OAD.getThread(id);
  if (!t) return;

  OAD.openModal(`
    <h2>Drafting Email…</h2>
    <p class="text-muted text-sm">Calling Claude to draft an email for <strong>${OAD.esc(t.title)}</strong></p>
    <div id="email-draft-body" style="margin-top:16px;color:var(--text-muted);font-size:14px">Generating…</div>
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.closeModal()">Close</button>
    </div>`);

  try {
    const draft = await OAD.draftEmail(id);
    const el = document.getElementById('email-draft-body');
    if (el) el.innerHTML = `<pre style="white-space:pre-wrap;font-size:13px;font-family:var(--mono);background:var(--surface2);padding:12px;border-radius:8px;line-height:1.6">${OAD.esc(draft)}</pre>`;
  } catch (err) {
    const el = document.getElementById('email-draft-body');
    if (el) el.innerHTML = `<span style="color:var(--critical)">${OAD.esc(err.message)}</span>`;
  }
};
