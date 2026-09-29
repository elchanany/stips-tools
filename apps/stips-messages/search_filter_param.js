const fs = require('fs');
const content = fs.readFileSync('main_stips_real.js', 'utf8');

// Find all matches for filterSection or similar terms
const regex = /["']([a-zA-Z0-9_]*filter[a-zA-Z0-9_]*)["']/gi;
let match;
const matches = new Set();
while ((match = regex.exec(content)) !== null) {
  matches.add(match[1]);
}
console.log('Matches:', Array.from(matches));

// Also let's print context for filterSections to see where it gets mapped to apiParams
const idx = content.indexOf('filterSections');
if (idx !== -1) {
  console.log('Context of filterSections:');
  console.log(content.substring(idx - 200, idx + 400));
}
