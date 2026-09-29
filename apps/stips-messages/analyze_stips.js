const fs = require('fs');
const content = fs.readFileSync('C:/Users/elchanan yehuda/Documents/understand_stips/main_stips_real.js', 'utf8');

const regexes = {
    apiNames: /name\s*:\s*['"]([a-zA-Z0-9_\.]+)['"]/g,
    objTypes: /objType\s*:\s*['"]([a-zA-Z0-9_\.]+)['"]/g,
    routes: /path\s*:\s*['"]([a-zA-Z0-9_\/\-\*]+)['"]/g,
    mentions: /\b(senior|moderator|admin|super|internal|ban|restore|report)\b/gi
};

const results = {
    apiNames: new Set(),
    objTypes: new Set(),
    routes: new Set(),
    mentions: new Set()
};

for (const [key, regex] of Object.entries(regexes)) {
    let match;
    while ((match = regex.exec(content)) !== null) {
        results[key].add(match[1] || match[0]);
    }
}

console.log('--- API NAMES ---');
console.log(Array.from(results.apiNames).filter(n => n.includes('.')).join(', '));
console.log('\n--- OBJ TYPES ---');
console.log(Array.from(results.objTypes).join(', '));
console.log('\n--- ROUTES ---');
console.log(Array.from(results.routes).filter(r => r.length > 2).join(', '));
console.log('\n--- MENTIONS COUNT ---');
console.log(results.mentions.size);
