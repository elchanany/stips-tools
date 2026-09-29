const fs = require('fs');
const content = fs.readFileSync('main_stips_real.js', 'utf8');

// Find references to objectlist api calls
let index = 0;
const matches = [];
while (true) {
  index = content.indexOf('objectlist', index);
  if (index === -1) break;
  matches.push(index);
  index += 1;
}

console.log(`Found ${matches.length} occurrences of "objectlist".`);
matches.slice(0, 10).forEach((idx, i) => {
  console.log(`\n--- Match ${i+1} at index ${idx} ---`);
  console.log(content.substring(idx - 150, idx + 250));
});
