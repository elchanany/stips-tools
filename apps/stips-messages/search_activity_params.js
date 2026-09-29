const fs = require('fs');
const content = fs.readFileSync('main_stips_real.js', 'utf8');

const index = content.indexOf('ask.user_activity');
if (index === -1) {
  console.log('Not found');
} else {
  console.log('Found ask.user_activity context:');
  console.log(content.substring(index - 300, index + 300));
}
