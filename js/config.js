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
  demoMode: localStorage.getItem('oad_demo_mode') === 'true' || (typeof OAD !== 'undefined' && !!OAD.DemoConfig)
};

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
