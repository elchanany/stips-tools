const fs = require('fs');
const content = fs.readFileSync('main_stips_real.js', 'utf8');

let index = 0;
while (true) {
  index = content.indexOf('profile.actions_chart', index);
  if (index === -1) break;
  console.log(`\n--- Match at index ${index} ---`);
  console.log(content.substring(index - 200, index + 300));
  index += 1;
}
