window.OAD = window.OAD || {};

OAD._demoClients = null;

// Removed CSV loader logic. Data is now loaded via Settings > Import JSON.

OAD._seedDemoThreads = async function(clients) {
  try {
    const res = await fetch('config/rules/hc_admission.json');
    const payload = await res.json();
    OAD.DB.threads = [];
    OAD.DB.cadences = [];
    
    const active = clients.filter(c => c.checkout_type === 'Active');
    active.forEach(c => {
      const admissionDate = new Date(c.check_in_date);
      const daysStay = 28;
      
      payload.triggers.forEach(trigger => {
        if (trigger.type === 'thread' || trigger.type === 'escalation') {
           let due = new Date(admissionDate);
           if (trigger.anchor === 'admission') {
             if (trigger.offset_days) due.setDate(due.getDate() + trigger.offset_days);
             if (trigger.offset_hours) due.setHours(due.getHours() + trigger.offset_hours);
           } else if (trigger.anchor === 'discharge') {
             due.setDate(due.getDate() + daysStay);
             if (trigger.offset_days) due.setDate(due.getDate() + trigger.offset_days);
             if (trigger.offset_hours) due.setHours(due.getHours() + trigger.offset_hours);
           }
           
           OAD.DB.threads.push({
             id: OAD.nextId(),
             uuid: 'u-' + Math.random().toString(36).substr(2, 9),
             title: `[${trigger.owner_role}] ${trigger.name} - ${c.name}`,
             status: 'open',
             priority: trigger.priority || 'Normal',
             life_area: trigger.owner_role,
             pressure: trigger.priority === 'High' ? 8 : 5,
             next_action: trigger.mandatory ? 'Complete mandatory requirement.' : 'Complete task.',
             next_action_date: due.toISOString().split('T')[0],
             closing_condition: 'Documentation submitted.',
             evolution_log: [],
             created_at: admissionDate.toISOString(),
             updated_at: admissionDate.toISOString()
           });
        } else if (trigger.type === 'cadence' && trigger.interval_days) {
           let iteration = 1;
           for (let i = trigger.interval_days; i <= daysStay; i += trigger.interval_days) {
             let due = new Date(admissionDate);
             due.setDate(due.getDate() + i);
             
             OAD.DB.threads.push({
               id: OAD.nextId(),
               uuid: 'u-' + Math.random().toString(36).substr(2, 9),
               title: `[${trigger.owner_role}] ${trigger.name} (Part ${iteration}) - ${c.name}`,
               status: 'open',
               priority: trigger.priority || 'Normal',
               life_area: trigger.owner_role,
               pressure: trigger.priority === 'High' ? 8 : 5,
               next_action: trigger.mandatory ? 'Complete mandatory requirement.' : 'Complete task.',
               next_action_date: due.toISOString().split('T')[0],
               closing_condition: 'Documentation submitted.',
               evolution_log: [],
               created_at: admissionDate.toISOString(),
               updated_at: admissionDate.toISOString()
             });
             iteration++;
           }
        }
      });
    });
    OAD.saveData();
    OAD.renderCommandCenter();
  } catch (e) {
    console.error('Failed to auto-seed threads:', e);
  }
};

OAD.maskName = function(fullName, role) {
  if (role && role.startsWith('Counselor')) return fullName; // Counselors see full names
  if (!fullName) return "***";
  const parts = fullName.split(' ');
  if (parts.length === 1) return parts[0].substring(0, 3) + "***";
  return parts[0] + ' ' + parts[parts.length-1].substring(0, 2) + "*****";
};

OAD._demoRole = localStorage.getItem('oad_demo_role') || 'CCO';
OAD.changeDemoRole = function(role) {
  if (role === 'Operations (CIC)') {
    window.location.href = 'modules/cic/index.html';
    return;
  }
  OAD._demoRole = role;
  localStorage.setItem('oad_demo_role', role);
  document.body.className = 'role-' + role.replace(/ /g, '-').toLowerCase();
  OAD.renderCommandCenter();
};

OAD.renderCommandCenter = function () {
  OAD._lastView = 'CommandCenter';
  OAD.highlightNav('renderCommandCenter');
  
  const panel = document.getElementById('detail-content');
  if (!panel) return;

  let clients = (OAD.DB.threads || []).filter(t => t.life_area === 'Patient').map(t => {
      const meta = t.metadata || {};
      return {
        name: t.title.replace('[Patient] ', ''),
        counselor: meta.counselor || 'Counselor 1',
        checkout_type: meta.checkout_type || 'Active',
        check_in_date: meta.check_in_date || new Date().toISOString().split('T')[0],
        discharge_date: meta.discharge_date,
        total_planned_days: parseInt(meta.total_planned_days) || 28,
        total_stay_days: parseInt(meta.total_stay_days) || 0
      };
  });

  if (clients.length === 0) {
    panel.innerHTML = `
      <div class="ds-panel" role="main" style="max-width: 900px; display:flex; flex-direction:column; align-items:center; justify-content:center; height:60vh">
        <h2>No Demo Data Loaded</h2>
        <p style="margin-top: 1rem; color: var(--text-muted);">Total Threads in memory: ${OAD.DB.threads ? OAD.DB.threads.length : 'undefined'}</p>
        <p style="color: var(--text-muted);">OAD.DB keys: ${Object.keys(OAD.DB || {}).join(', ')}</p>
        <p style="color: var(--text-muted);">Demo Role: ${OAD._demoRole || 'undefined'}</p>
        ${OAD.DB.lastError ? `<div style="background: rgba(255,0,0,0.1); border: 1px solid red; color: red; padding: 10px; margin-top: 20px; max-width: 800px; text-align: left; overflow-x: auto;"><pre>${OAD.DB.lastError}</pre></div>` : ''}
      </div>
    `;
    return;
  }

  // Filter based on demo role
  if (OAD._demoRole && OAD._demoRole.startsWith('Counselor')) {
    clients = clients.filter(c => c.counselor === OAD._demoRole);
  }

  const dischargedClients = clients.filter(c => c.checkout_type !== 'Active');
  const activeCount = clients.filter(c => c.checkout_type === 'Active').length;
  
  let totalPlanned = 0;
  let totalRetained = 0;
  clients.forEach(c => {
    if (c.checkout_type === 'Active') {
      const checkInDt = new Date(c.check_in_date + "T00:00:00");
      const todayDt = new Date(); todayDt.setHours(0, 0, 0, 0);
      let currentDay = Math.round((todayDt - checkInDt) / 86400000) + 1;
      if (currentDay < 1) currentDay = 1;
      if (currentDay > c.total_planned_days) currentDay = c.total_planned_days;
      
      totalPlanned += currentDay;
      totalRetained += currentDay;
    } else {
      totalPlanned += c.total_planned_days;
      totalRetained += c.total_stay_days;
    }
  });
  
  const tryScore = totalPlanned === 0 ? 0 : Math.round((totalRetained / totalPlanned) * 100);
  const tryColor = tryScore >= 80 ? 'var(--success)' : tryScore >= 60 ? 'orange' : 'var(--critical)';

  // Build the breakdown (by Director for CCO, by Counselor for Directors)
  const breakdown = {};
  clients.forEach(c => {
    let groupName = c.counselor;
    if (OAD._demoRole === 'CCO') {
      groupName = 'Director Alpha';
    }

    if (!breakdown[groupName]) breakdown[groupName] = { active: 0, planned: 0, retained: 0, aca: 0, bnc: 0, standard: 0 };
    
    if (c.checkout_type === 'Active') {
      breakdown[groupName].active++;
      const checkInDt = new Date(c.check_in_date + "T00:00:00");
      const todayDt = new Date(); todayDt.setHours(0, 0, 0, 0);
      let currentDay = Math.round((todayDt - checkInDt) / 86400000) + 1;
      if (currentDay < 1) currentDay = 1;
      if (currentDay > c.total_planned_days) currentDay = c.total_planned_days;
      
      breakdown[groupName].planned += currentDay;
      breakdown[groupName].retained += currentDay;
    } else {
      breakdown[groupName].planned += c.total_planned_days;
      breakdown[groupName].retained += c.total_stay_days;
      if (c.checkout_type === 'Standard') {
        breakdown[groupName].standard++;
      } else if (c.checkout_type === 'ACA') {
        breakdown[groupName].aca++;
      } else if (c.checkout_type === 'BNC') {
        breakdown[groupName].bnc++;
      }
    }
  });

  const breakdownHtml = Object.keys(breakdown).map(name => {
    const data = breakdown[name];
    const score = data.planned === 0 ? 0 : Math.round((data.retained / data.planned) * 100);
    const color = score >= 80 ? 'var(--success)' : score >= 60 ? 'orange' : 'var(--critical)';
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:16px; border-bottom:1px solid var(--border)">
        <div>
          <div style="font-weight:600; font-size:15px; margin-bottom:4px;">${OAD.esc(name)}</div>
          <div style="font-size:12px; color:var(--text-muted)">Active (${data.active}) - Discharges in last 24h: ${data.standard} Standard | ${data.aca} ACA | ${data.bnc} BNC</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:20px; font-weight:700; color:${color}">${score}%</div>
          <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px">TRY Score</div>
        </div>
      </div>
    `;
  }).join('');

  panel.innerHTML = `
    <div class="ds-panel" role="main" style="max-width: 900px;">
      <header class="ds-header" style="display:flex; justify-content:space-between; align-items:center">
        <div>
          <h2 style="display:flex; align-items:center; gap:16px; margin-bottom:8px">
            My Team Command Center
            <button class="ghost" style="cursor:pointer; font-size:12px; padding:4px 8px; border:1px solid var(--border); font-weight:normal; border-radius:4px; margin-left:8px" onclick="OAD.openSchedulesModal()">
              📅 Schedules
            </button>
            <button class="primary" style="cursor:pointer; font-size:12px; padding:4px 12px; border:none; font-weight:600; border-radius:4px; margin-left:8px" onclick="OAD.openAdmitClientModal()">
              🏥 Admit Client
            </button>
          </h2>
          <div style="display:flex; align-items:center; gap:12px">
            <span class="ds-date" style="margin:0">Demo Role:</span>
            <select id="role-select" onchange="OAD.changeDemoRole(this.value)" style="padding:4px; border-radius:4px; border:1px solid var(--border); font-size:12px; background:var(--surface2); color:var(--text)">
              <option value="CCO" ${OAD._demoRole === 'CCO' ? 'selected' : ''}>CCO (All Data)</option>
              <option value="Director Alpha" ${OAD._demoRole === 'Director Alpha' ? 'selected' : ''}>Director Alpha (All Counselors)</option>
              <option value="Counselor 1" ${OAD._demoRole === 'Counselor 1' ? 'selected' : ''}>Counselor 1</option>
              <option value="Counselor 2" ${OAD._demoRole === 'Counselor 2' ? 'selected' : ''}>Counselor 2</option>
              <option value="Counselor 3" ${OAD._demoRole === 'Counselor 3' ? 'selected' : ''}>Counselor 3</option>
              <option value="Counselor 4" ${OAD._demoRole === 'Counselor 4' ? 'selected' : ''}>Counselor 4</option>
              <option value="Counselor 5" ${OAD._demoRole === 'Counselor 5' ? 'selected' : ''}>Counselor 5</option>
              <option value="Counselor 6" ${OAD._demoRole === 'Counselor 6' ? 'selected' : ''}>Counselor 6</option>
              <option value="Counselor 7" ${OAD._demoRole === 'Counselor 7' ? 'selected' : ''}>Counselor 7</option>
              <option value="Counselor 8" ${OAD._demoRole === 'Counselor 8' ? 'selected' : ''}>Counselor 8</option>
              <option value="Counselor 9" ${OAD._demoRole === 'Counselor 9' ? 'selected' : ''}>Counselor 9</option>
              <option value="Counselor 10" ${OAD._demoRole === 'Counselor 10' ? 'selected' : ''}>Counselor 10</option>
              <option disabled>──────────</option>
              <option value="Operations (CIC)">Operations & Logistics (Map View)</option>
            </select>
          </div>
        </div>
        <div style="background:var(--surface); padding:20px 32px; border-radius:4px; border:1px solid var(--border); display:flex; flex-direction:column; align-items:center; min-width:340px">
          <div style="font-size:20px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; line-height:1">${OAD._demoRole.startsWith('Counselor') ? 'PERSONAL TRY' : 'TEAM TRY'}</div>
          <div style="font-size:14px; color:var(--text-muted); font-style:italic; margin-bottom:16px; font-weight:400">Total Retention Yield</div>
          <div style="font-size:56px; font-weight:800; color:${tryColor}; line-height:1; margin-bottom:20px">${tryScore}%</div>
          
          <div style="display:flex; width:100%; align-items:center; justify-content:center; gap:24px">
            <div style="text-align:center">
              <div style="font-size:28px; font-weight:700; color:${tryColor}; line-height:1; margin-bottom:4px">${activeCount}</div>
              <div style="font-size:16px; color:${tryColor}; font-weight:600; line-height:1">clients</div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-start; gap:6px">
              <div style="font-size:12px; color:${tryColor}; font-weight:600">${totalRetained} Treatment Days Delivered</div>
              <div style="width:100%; border-bottom:1px dashed ${tryColor}; opacity:0.6"></div>
              <div style="font-size:12px; color:${tryColor}; font-weight:600">${totalPlanned} Treatment Days Contracted</div>
            </div>
          </div>
        </div>
      </header>

      ${OAD._demoRole.startsWith('Counselor') ? '' : `
      <div style="margin-top:24px; padding:24px; background:var(--surface); border:1px solid var(--border); border-radius:12px;">
        <h3 style="margin-top:0; margin-bottom:8px; font-size:18px; display:flex; align-items:center; gap:8px">
          🎯 Targeted Retention Yield (TRY)
        </h3>
        <p style="font-size:14px; color:var(--text-muted); margin-bottom:24px; line-height:1.5;">
          The primary "Moneyball Metric" measuring the percentage of contracted clinical depth successfully retained. 
          Currently tracking <strong>${totalRetained}</strong> retained days out of <strong>${totalPlanned}</strong> planned days across <strong>${dischargedClients.length}</strong> discharges.
        </p>
        <div style="background:var(--surface2); border-radius:12px; overflow:hidden; border:1px solid var(--border)">
          ${breakdownHtml}
        </div>
      </div>
      `}

      <div style="margin-top:24px; padding:24px; background:var(--surface); border:1px solid var(--border); border-radius:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
          <h3 style="margin:0; font-size:18px; display:flex; align-items:center; gap:8px">
            🛡️ Active Clients
          </h3>
          ${OAD._demoRole.startsWith('Counselor') ? '' : '<span style="font-size:11px; background:var(--surface2); padding:4px 8px; border-radius:4px; color:var(--text-muted); font-weight:600; letter-spacing:0.5px">MINIMUM NECESSARY VIEW</span>'}
        </div>
        
        <table style="width:100%; border-collapse:collapse; font-size:14px;">
          <tr style="text-align:left; border-bottom:1px solid var(--border); color:var(--text-muted)">
            <th style="padding-bottom:12px; font-weight:600">Patient</th>
            <th style="padding-bottom:12px; font-weight:600">Counselor</th>
            <th style="padding-bottom:12px; font-weight:600">Timeline</th>
            <th style="padding-bottom:12px; text-align:right; font-weight:600">Action</th>
          </tr>
          ${clients.filter(c => c.checkout_type === 'Active').map(c => {
            const checkInDt = new Date(c.check_in_date + "T00:00:00");
            const todayDt = new Date(); todayDt.setHours(0, 0, 0, 0);
            let currentDay = Math.round((todayDt - checkInDt) / 86400000) + 1;
            if (currentDay < 1) currentDay = 1;
            return `
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:16px 0; font-family:var(--mono); color:var(--text-main); font-weight:500">${OAD.esc(OAD.maskName(c.name, OAD._demoRole))}</td>
            <td style="padding:16px 0; color:var(--text-main)">${OAD.esc(c.counselor)}</td>
            <td style="padding:16px 0; color:var(--text-main)">Day ${currentDay} of ${c.total_planned_days}</td>
            <td style="padding:16px 0; text-align:right">
              ${OAD._demoRole.startsWith('Counselor') 
                ? `<button class="ghost" style="font-size:12px; padding:6px 12px; color:var(--primary); font-weight:600; border:1px solid rgba(var(--primary-rgb), 0.2)" onclick="alert('Loading clinical workspace for ${OAD.esc(c.name)}... (Full EHR integration arriving in Q3)')">View Details</button>`
                : `<button class="ghost" style="font-size:12px; padding:6px 12px; color:var(--accent); font-weight:600; border:1px solid rgba(var(--accent-rgb), 0.2)" onclick="alert('AUDIT LOG: User broken glass to view record for ${OAD.esc(c.name)}.')">🔓 Break Glass</button>`
              }
            </td>
          </tr>
          `;
          }).join('')}
        </table>
      </div>

      <div style="margin-top:24px; padding:24px; background:var(--surface); border:1px solid var(--border); border-radius:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
          <h3 style="margin:0; font-size:18px; display:flex; align-items:center; gap:8px">
            ⏳ Recently Discharged (Last 30 Days)
          </h3>
        </div>
        
        <table style="width:100%; border-collapse:collapse; font-size:14px;">
          <tr style="text-align:left; border-bottom:1px solid var(--border); color:var(--text-muted)">
            <th style="padding-bottom:12px; font-weight:600">Patient</th>
            <th style="padding-bottom:12px; font-weight:600">Discharged On</th>
            <th style="padding-bottom:12px; font-weight:600">Reason</th>
            <th style="padding-bottom:12px; text-align:right; font-weight:600">Impact</th>
          </tr>
          ${clients.filter(c => {
            if (c.checkout_type === 'Active' || !c.discharge_date) return false;
            const dischargeDt = new Date(c.discharge_date + "T00:00:00");
            const todayDt = new Date(); todayDt.setHours(0, 0, 0, 0);
            const daysAgo = Math.round((todayDt - dischargeDt) / 86400000);
            return daysAgo >= 0 && daysAgo <= 30;
          }).sort((a, b) => b.discharge_date.localeCompare(a.discharge_date)).map(c => {
            const lostDays = c.total_planned_days - c.total_stay_days;
            const isEarly = lostDays > 0;
            const reasonColor = c.checkout_type === 'Standard' ? 'var(--text-muted)' : (c.checkout_type === 'ACA' ? 'var(--critical)' : 'orange');
            const impactHtml = isEarly 
              ? `<span style="color:var(--critical); font-weight:600; display:flex; align-items:center; gap:4px; justify-content:flex-end">⚠ ${lostDays} days lost</span>`
              : `<span style="color:var(--text-muted)">0 days lost</span>`;
            
            return `
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:16px 0; font-family:var(--mono); color:var(--text-main); font-weight:500">${OAD.esc(OAD.maskName(c.name, OAD._demoRole))}</td>
            <td style="padding:16px 0; color:var(--text-main)">${OAD.formatDate(c.discharge_date)}</td>
            <td style="padding:16px 0; color:${reasonColor}; font-weight:600">${OAD.esc(c.checkout_type)}</td>
            <td style="padding:16px 0; text-align:right">${impactHtml}</td>
          </tr>
          `;
          }).join('') || '<tr style="border-bottom:1px solid var(--border)"><td colspan="4" style="padding:16px 0; color:var(--text-muted); text-align:center">No recent discharges</td></tr>'}
        </table>
      </div>

    </div>
  `;
};
