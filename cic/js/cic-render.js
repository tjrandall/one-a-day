window.CIC = window.CIC || {};

CIC.map = null;
CIC.markers = [];
CIC.currentOffset = 0;

CIC.init = function() {
  if (window.OAD && typeof OAD.loadDB === 'function') {
    OAD.loadDB();
  }

  // Wait for OAD DB to be ready
  if (!window.OAD || !OAD.DB || !OAD.DB.threads || OAD.DB.threads.length === 0) {
    setTimeout(CIC.init, 50);
    return;
  }
  
  // Set up Leaflet Map centered roughly on MA
  CIC.map = L.map('cic-map').setView([41.8, -70.8], 10);
  
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(CIC.map);
  
  // Draw Facility Bases
  OAD.CIC.Config.facilities.forEach(fac => {
    const marker = L.circleMarker(fac.coords, {
      color: '#cba6f7', // Catppuccin Mauve
      fillColor: '#cba6f7',
      fillOpacity: 0.5,
      radius: 12
    }).addTo(CIC.map);
    marker.bindPopup(`<b>${fac.name}</b><br/>${fac.address}<br/><i>Operations Base</i>`);
  });
  
  CIC.setDayOffset(0);
  CIC.renderBedChecks();
};

CIC.setDayOffset = function(offset) {
  CIC.currentOffset = offset;
  
  // Update active button
  document.querySelectorAll('.day-btn').forEach((btn, idx) => {
    btn.classList.toggle('active', offset === [0, 1, 2, 5][idx]);
  });
  
  // Calculate target date
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + offset);
  const targetDateStr = targetDate.getFullYear() + '-' + 
                        String(targetDate.getMonth() + 1).padStart(2, '0') + '-' + 
                        String(targetDate.getDate()).padStart(2, '0');
  
  // Clear old markers
  CIC.markers.forEach(m => CIC.map.removeLayer(m));
  CIC.markers = [];
  
  // Find discharges for this date
  const threads = OAD.DB.threads || [];
  const discharges = threads.filter(t => t.life_area === 'Patient' && t.metadata && t.metadata.discharge_date === targetDateStr);
  
  discharges.forEach(t => {
    const locName = t.metadata.discharge_location;
    if (!locName) {
      // Missing location!
      console.warn("Missing discharge location for", t.title);
      return;
    }
    
    // Look up location coords
    const locConfig = OAD.CIC.Config.dischargeLocations.find(l => l.name === locName || l.id === locName) || 
                      OAD.CIC.Config.facilities.find(f => f.name === locName);
                      
    if (locConfig) {
      // Pick a random vehicle for demo
      const veh = OAD.CIC.Config.vehicles[Math.floor(Math.random() * OAD.CIC.Config.vehicles.length)];
      
      const marker = L.marker(locConfig.coords).addTo(CIC.map);
      marker.bindPopup(`
        <div style="font-family:'Inter',sans-serif;">
          <h3 style="margin:0 0 5px 0;font-size:14px;color:#f38ba8;">Discharge</h3>
          <b>${t.title}</b><br/>
          Destination: ${locConfig.name}<br/>
          Assigned Transport: <b>${veh.name}</b>
        </div>
      `);
      CIC.markers.push(marker);
    }
  });
};

CIC.renderBedChecks = function() {
  const container = document.getElementById('bed-check-container');
  // Mock 3 bed checks for the MVP
  const checks = [
    { id: 1, client: "Client 5", room: "Room 102A" },
    { id: 2, client: "Client 7", room: "Room 105B" },
    { id: 3, client: "Client 12", room: "Room 201A" }
  ];
  
  let html = '';
  checks.forEach(c => {
    html += `
      <div class="bed-check-card" id="bc-${c.id}">
        <div>
          <h3>${c.client}</h3>
          <p>${c.room}</p>
        </div>
        <button class="scan-btn" onclick="CIC.scanWristband(${c.id}, '${c.client}')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg>
          Scan Wristband
        </button>
      </div>
    `;
  });
  
  container.innerHTML = html;
};

CIC.scanWristband = function(id, clientName) {
  const btn = document.querySelector(`#bc-${id} .scan-btn`);
  btn.innerHTML = '✓ Scanned & Logged';
  btn.classList.add('success');
  
  // Show Toast
  const toast = document.getElementById('toast');
  toast.innerText = `Wristband scan for ${clientName} logged in MyEvolv`;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
    // Hide the card
    document.getElementById(`bc-${id}`).style.display = 'none';
  }, 2500);
};

// Start when DOM is loaded
document.addEventListener('DOMContentLoaded', CIC.init);
