window.OAD = window.OAD || {};
OAD.CIC = OAD.CIC || {};

OAD.CIC.Config = {
  facilities: [
    {
      id: "fac-a",
      name: "Facility A",
      address: "558 W Falmouth Hwy, Falmouth, MA 02540",
      coords: [41.5515, -70.6150]
    },
    {
      id: "fac-b",
      name: "Facility B",
      address: "50 Indian Neck Rd, Wareham, MA 02571",
      coords: [41.7630, -70.7200]
    }
  ],

  dischargeLocations: [
    {
      id: "loc-1",
      name: "Cape Heritage Rehabilitation & Health Care Center",
      address: "37 MA-6A, Sandwich, MA 02563",
      coords: [41.7590, -70.4930]
    },
    {
      id: "loc-2",
      name: "Plymouth Rehabilitation & Health Care Center",
      address: "123 South St, Plymouth, MA 02360",
      coords: [41.9580, -70.6670]
    },
    {
      id: "loc-3",
      name: "Spaulding Rehabilitation Hospital (Boston)",
      address: "300 1st Ave, Charlestown, MA 02129",
      coords: [42.3780, -71.0500]
    },
    {
      id: "loc-4",
      name: "Quaboag Rehabilitation & Skilled Care Center",
      address: "47 E Main St, West Brookfield, MA 01585",
      coords: [42.2340, -72.1430]
    }
  ],

  vehicles: [
    {
      id: "veh-1",
      name: "Van 1",
      homeBaseId: "fac-a" // 558 W Falmouth Hwy
    },
    {
      id: "veh-2",
      name: "Car 1",
      homeBaseId: "fac-a" // 558 W Falmouth Hwy
    },
    {
      id: "veh-3",
      name: "Van 3",
      homeBaseId: "fac-b" // 50 Indian Neck Rd
    }
  ]
};

// --- CIC ESCALATION RULE OVERRIDE ---
// This hook intercepts the core engine's pressure calculation
OAD.CIC.checkDischargeReadiness = function(thread) {
  var target = thread;
  if (!target.metadata || !target.metadata.discharge_date) {
    if (thread.parent_uuid && window.OAD && OAD.DB && OAD.DB.threads) {
      var parent = OAD.DB.threads.find(function(t) { return t.uuid === thread.parent_uuid; });
      if (parent && parent.metadata && parent.metadata.discharge_date) {
        target = parent;
      }
    }
  }

  if (!target.metadata || !target.metadata.discharge_date) return 0;
  
  // Calculate days until discharge
  var todayStr = new Date().toISOString().slice(0, 10);
  var dischargeDate = new Date(target.metadata.discharge_date + 'T00:00:00');
  var todayDt = new Date(todayStr + 'T00:00:00');
  var daysUntil = Math.ceil((dischargeDate - todayDt) / 86400000);
  
  // Escalation: T-5 days and missing location
  if (daysUntil <= 5 && !target.metadata.discharge_location) {
    return 60; // Huge penalty
  }
  return 0;
};
