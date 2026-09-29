const fs = require('fs');
const content = fs.readFileSync('main_stips_real.js', 'utf8');

console.log('Searching for profile/user related API calls in main_stips_real.js...');

// Search for any string like "name: '...'" or 'name: "..."'
const apiRegex = /name\s*:\s*['"]([a-zA-Z0-9_\.]+)['"]/gi;
let match;
const apis = new Set();
while ((match = apiRegex.exec(content)) !== null) {
  apis.add(match[1]);
}

console.log('--- ALL APIS FOUND ---');
console.log(Array.from(apis).sort().join('\n'));

console.log('\n--- SEARCHING FOR LINES WITH profile. OR user. ---');
const lines = content.split('\n');
lines.forEach((line, index) => {
  if (line.includes('profile.') || line.includes('user.') || line.includes('omniobj')) {
    if (line.length < 200) {
      console.log(`Line ${index + 1}: ${line.trim()}`);
    } else {
      console.log(`Line ${index + 1}: (Long line) ${line.trim().substring(0, 200)}...`);
    }
  }
});
