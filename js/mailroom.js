window.OAD = window.OAD || {};
OAD.Mailroom = OAD.Mailroom || {};

// Regex patterns for parsing dates
OAD.Mailroom.DATE_PATTERNS = [
  /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, // YYYY-MM-DD
  /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/ // MM/DD/YYYY or MM/DD/YY
];

OAD.Mailroom.MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
};

OAD.Mailroom.parseText = function (text) {
  if (!text) return { dates: [], money: [], suggestedTitle: '', suggestedLifeArea: 'Other' };
  
  const results = {
    dates: [],
    money: [],
    suggestedTitle: '',
    suggestedLifeArea: 'Other'
  };

  // 1. Extract dates
  OAD.Mailroom.DATE_PATTERNS.forEach(pat => {
    let match;
    const regex = new RegExp(pat, 'g');
    while ((match = regex.exec(text)) !== null) {
      let y, m, d;
      if (match[1].length === 4) { // YYYY-MM-DD
        y = parseInt(match[1]);
        m = parseInt(match[2]) - 1;
        d = parseInt(match[3]);
      } else { // MM/DD/YYYY or MM/DD/YY
        m = parseInt(match[1]) - 1;
        d = parseInt(match[2]);
        let yearStr = match[3];
        if (yearStr.length === 2) {
          y = 2000 + parseInt(yearStr);
        } else {
          y = parseInt(yearStr);
        }
      }
      try {
        const dateObj = new Date(y, m, d);
        if (!isNaN(dateObj.getTime())) {
          const iso = dateObj.toISOString().slice(0, 10);
          if (results.dates.indexOf(iso) === -1) {
            results.dates.push(iso);
          }
        }
      } catch (e) {}
    }
  });

  // Month words: e.g. "June 24, 2026" or "24 June 2026"
  const wordMonthRegex = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s+|\s+)(\d{4})\b/ig;
  let wmMatch;
  while ((wmMatch = wordMonthRegex.exec(text)) !== null) {
    const monthName = wmMatch[1].toLowerCase();
    const day = parseInt(wmMatch[2]);
    const year = parseInt(wmMatch[3]);
    const monthIndex = OAD.Mailroom.MONTHS[monthName];
    if (monthIndex !== undefined) {
      try {
        const dateObj = new Date(year, monthIndex, day);
        if (!isNaN(dateObj.getTime())) {
          const iso = dateObj.toISOString().slice(0, 10);
          if (results.dates.indexOf(iso) === -1) {
            results.dates.push(iso);
          }
        }
      } catch (e) {}
    }
  }

  // Sort dates ascending
  results.dates.sort();

  // 2. Extract money
  const moneyRegex = /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\b/g;
  let moneyMatch;
  while ((moneyMatch = moneyRegex.exec(text)) !== null) {
    const val = parseFloat(moneyMatch[1].replace(/,/g, ''));
    if (!isNaN(val) && results.money.indexOf(val) === -1) {
      results.money.push(val);
    }
  }

  // 3. Extract title: first non-empty line of text, stripped
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5);
  if (lines.length > 0) {
    results.suggestedTitle = lines[0].slice(0, 50);
  } else {
    results.suggestedTitle = 'New Mail Document';
  }

  // 4. Heuristic Life Area detection
  const textLower = text.toLowerCase();
  const areaKeywords = {
    Finance: ['bill', 'invoice', 'statement', 'tax', 'payment', 'balance', 'fee', 'charge', 'due', 'amount', 'pay', 'bank', 'finance', 'debt', 'irs', 'lien'],
    Career: ['job', 'resume', 'offer', 'employment', 'employer', 'salary', 'manager', 'corporation', 'company', 'meeting', 'contract'],
    Health: ['doctor', 'medical', 'hospital', 'clinic', 'health', 'insurance', 'patient', 'prescription', 'pharmacy', 'care', 'benefit'],
    Education: ['school', 'college', 'university', 'ecornell', 'course', 'class', 'assignment', 'grade', 'student', 'tuition', 'enrollment'],
    Housing: ['rent', 'landlord', 'lease', 'home', 'house', 'apartment', 'property', 'mortgage', 'utility', 'electric', 'water', 'gas'],
    Legal: ['court', 'law', 'lawyer', 'legal', 'agreement', 'notice', 'official', 'summons', 'appeal', 'resolution', 'claim']
  };

  let bestArea = 'Other';
  let maxMatches = 0;
  for (const [area, keywords] of Object.entries(areaKeywords)) {
    let matches = 0;
    keywords.forEach(kw => {
      const idx = textLower.indexOf(kw);
      if (idx !== -1) {
        matches++;
        if (textLower.lastIndexOf(kw) !== idx) matches++;
      }
    });
    if (matches > maxMatches) {
      maxMatches = matches;
      bestArea = area;
    }
  }
  results.suggestedLifeArea = bestArea;

  return results;
};

OAD.Mailroom.getRecommendations = function (text) {
  if (!text) return [];
  const textLower = text.toLowerCase();
  
  const textWords = textLower.match(/\b[a-z]{3,}\b/g) || [];
  const textWordsSet = new Set(textWords);

  const activeThreads = (OAD.DB.threads || []).filter(t => t.status !== 'closed');
  
  const scored = activeThreads.map(t => {
    let score = 0;
    
    const titleWords = (t.title || '').toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    titleWords.forEach(w => {
      if (textWordsSet.has(w)) {
        score += 5;
      }
    });

    const descWords = (t.description || '').toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    descWords.forEach(w => {
      if (textWordsSet.has(w)) {
        score += 1;
      }
    });

    return { thread: t, score: score };
  });

  return scored
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
};
