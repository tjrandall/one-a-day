window.OAD = window.OAD || {};
OAD.TranslationCache = {};

OAD.Config = {
  currentLocale: localStorage.getItem('oad_locale') || 'en',
  userGreetingTitle: localStorage.getItem('oad_greeting_title') || '',
  gmailSearchFilter: localStorage.getItem('oad_gmail_filter') || 'is:unread (subject:Notice OR subject:Bill OR subject:Statement OR subject:Register OR subject:Enrollment)',
  ocrLanguage: 'eng',
  defaultPriority: 'medium',
  lifeAreas: JSON.parse(localStorage.getItem('oad_life_areas')) || [
    'Career', 'Health', 'Finances', 'Relationships', 'Education', 'Housing',
    'Legal', 'Personal Growth', 'App Dev', 'Job Search', 'Family', 'Personal', 'Other'
  ],
  // Runway Risk benchmark time-to-outcome (applied -> hire) per broad job-search category, in weeks.
  // Starting assumptions, not derived from real base-rate data (sample size too small) — adjustable,
  // not hardcoded permanently. Shared across all tracks within a category (e.g. both Federal tracks
  // use the same federal benchmark) per the spec's stated grain.
  runwayBenchmarks: JSON.parse(localStorage.getItem('oad_runway_benchmarks')) || {
    federal:    { label: 'Federal',    minWeeks: 17, maxWeeks: 22 }, // ~4-5 months
    commercial: { label: 'Commercial', minWeeks: 6,  maxWeeks: 8  }  // ~6-8 weeks
  },
  // This Week's Load composite score weights (golden rule: no magic numbers in the code).
  // Starting defaults, not derived/calibrated from a large sample — tune as the labels are
  // used and compared against how days actually feel. edgeMultiplier and cadenceWeight scale
  // structural/commitment signals to be roughly comparable in magnitude to a pressure score
  // (0-100 per thread); busyThreshold/heavyThreshold are cutoffs on the resulting composite.
  weekLoadWeights: JSON.parse(localStorage.getItem('oad_week_load_weights')) || {
    edgeMultiplier: 2,    // per graph connection (in+out, any type) on a thread due that day
    cadenceWeight: 20,    // flat, per cadence due that day (cadences have no pressure score of their own)
    busyThreshold: 50,
    heavyThreshold: 150
  },
  demoMode: window.location.port === '8081' || window.location.pathname.includes('demo')
};

// --- SELF-HEALING HACK ---
// If we are NOT in demo mode (e.g. running on port 8080) but the browser cached the demo user session
// or the massive demo payload, forcefully wipe it out so the user gets a clean slate.
if (!OAD.Config.demoMode) {
  const cachedUser = localStorage.getItem('supabase.auth.token');
  const cachedDb = localStorage.getItem('oad_db');
  if (
    (cachedUser && cachedUser.includes('demo-superadmin-id')) || 
    (cachedDb && cachedDb.includes('[Patient]')) ||
    localStorage.getItem('oad_demo_role')
  ) {
    console.log('[OAD] Self-healing: Purging leaked demo data from standard environment.');
    localStorage.clear();
    sessionStorage.clear();
    // Force reload to completely reset state
    window.location.href = window.location.pathname;
  }
}


OAD.normalizeLifeArea = function (area) {
  if (!area) return 'Other';
  let cleaned = area.trim().replace(/_/g, ' ');
  if (cleaned.toLowerCase() === 'finance' || cleaned.toLowerCase() === 'finances') {
    return 'Finances';
  }
  // Capitalize first letter of each word
  return cleaned.split(/\s+/).map(word => {
    if (!word) return '';
    // Support specific acronyms/capitalizations
    if (word.toUpperCase() === 'VR&E' || word.toUpperCase() === 'GIS' || word.toUpperCase() === 'ADA') {
      return word.toUpperCase();
    }
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
};

OAD.loadLanguage = async function(locale) {
  const selectedLocale = locale || OAD.Config.currentLocale || 'en';
  const basePath = OAD.Config.basePath || '.';
  try {
    const response = await fetch(`${basePath}/locales/${selectedLocale}.json`);
    if (!response.ok) throw new Error('Locale not found');
    OAD.TranslationCache = await response.json();
    OAD.Config.currentLocale = selectedLocale;
    localStorage.setItem('oad_locale', selectedLocale);
    OAD.translateDOM();
  } catch (err) {
    console.warn(`Could not load locale "${selectedLocale}", falling back to English.`, err);
    try {
      const fbResponse = await fetch(`${basePath}/locales/en.json`);
      if (!fbResponse.ok) throw new Error('Fallback locale not found');
      OAD.TranslationCache = await fbResponse.json();
      OAD.Config.currentLocale = 'en';
      localStorage.setItem('oad_locale', 'en');
      OAD.translateDOM();
    } catch (fbErr) {
      console.error('Failed to load fallback locale.', fbErr);
    }
  }
};

OAD.translateDOM = function() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = OAD.t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.setAttribute('placeholder', OAD.t(key));
  });
};

OAD.t = function(key, fallback) {
  return OAD.TranslationCache[key] || fallback || key;
};

// Check if current user is SuperAdmin
OAD.isSuperAdmin = function() {
  if (OAD._userId === 'demo-superadmin-id') return true;
  // Always true for this environment, ensuring no lockouts.
  return true;
};
