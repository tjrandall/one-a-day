const fs = require('fs');

const counselors = Array.from({length: 10}, (_, i) => `Counselor ${i+1}`);
const now = new Date('2026-06-22T12:00:00Z');

let clients = [];
let id = 1;

// Helper to add days
const addDays = (d, days) => {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + days);
  return nd.toISOString().split('T')[0];
};

const getRandomCounselor = () => counselors[Math.floor(Math.random() * counselors.length)];

// 1. 2 ACA in past week
clients.push({ name: `ACA Client 1`, counselor: getRandomCounselor(), checkout_type: 'ACA', check_in: addDays(now, -20), checkout: addDays(now, -6), stay: 14 });
clients.push({ name: `ACA Client 2`, counselor: getRandomCounselor(), checkout_type: 'ACA', check_in: addDays(now, -18), checkout: addDays(now, -4), stay: 14 });

// 2. 1 BNC in past week
clients.push({ name: `BNC Client 1`, counselor: getRandomCounselor(), checkout_type: 'BNC', check_in: addDays(now, -15), checkout: addDays(now, -5), stay: 10 });

// 3. 24 Standard discharged in past 30 days
for(let i=0; i<24; i++) {
  let stay = 28;
  let check_out_days_ago = Math.floor(Math.random() * 20) + 1; // 1 to 20 days ago
  let check_in = addDays(now, -(check_out_days_ago + stay));
  let checkout = addDays(now, -check_out_days_ago);
  clients.push({ name: `Standard Client ${i+1}`, counselor: getRandomCounselor(), checkout_type: 'Standard', check_in, checkout, stay });
}

// 4. 20 Active clients (checking in between today and 28 days ago)
for(let i=0; i<20; i++) {
  let check_in_days_ago = Math.floor(Math.random() * 28);
  let check_in = addDays(now, -check_in_days_ago);
  let stay = check_in_days_ago;
  // Ensure we have some exactly 13-15 days ago for the "Day 13 note" overdue tasks
  if (i < 8) check_in_days_ago = 14; 
  check_in = addDays(now, -check_in_days_ago);
  stay = check_in_days_ago;
  
  clients.push({ name: `Active Client ${i+1}`, counselor: counselors[i % 10], checkout_type: 'Active', check_in, checkout: '', stay });
}

// Write CSV
let csv = 'Name,Counselor,Projected Days,Total Planned Days,Check-in Date,First Paperwork Due Date,First Paperwork Completed Date,Paperwork Extension Due Date,Paperwork Extension Completed Date,Checkout Date,Checkout Type,Total Stay Days,Notes\n';

clients.forEach(c => {
  csv += `${c.name},${c.counselor},28,28,${c.check_in},,,,,,${c.checkout},${c.checkout_type},${c.stay},\n`;
});

fs.writeFileSync('demo/demo_data.csv', csv);
console.log('Created demo_data.csv with ' + clients.length + ' clients.');
