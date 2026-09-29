const fs = require('fs');
const path = 'C:/Users/elchanan yehuda/Documents/understand_stips/main_stips_real.js';
const t = fs.readFileSync(path, 'utf8');
const rx = /localStorage\.getItem\(['"]([a-zA-Z0-9_\-]+)['"]\)/g;
let match;
const keys = new Set();
while ((match = rx.exec(t)) !== null) {
    keys.add(match[1]);
}
console.log(JSON.stringify(Array.from(keys), null, 2));
