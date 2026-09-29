const fs = require('fs');
const content = fs.readFileSync('main_stips_real.js', 'utf8');

// Let's search for "ask.user_activity"
let index = 0;
while (true) {
  index = content.indexOf('ask.user_activity', index);
  if (index === -1) break;
  console.log(`\n--- Match at index ${index} ---`);
  // Print 500 characters around it
  console.log(content.substring(index - 200, index + 300));
  index += 1;
}
