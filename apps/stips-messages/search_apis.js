const fs = require('fs');
const content = fs.readFileSync('main_stips_real.js', 'utf8');

const regex = /['"](ask\.[a-zA-Z0-9_]+|ans\.[a-zA-Z0-9_]+)['"]/g;
let match;
const methods = new Set();
while ((match = regex.exec(content)) !== null) {
  methods.add(match[1]);
}

console.log('--- ASK/ANS METHODS ---');
console.log(Array.from(methods).sort().join('\n'));
