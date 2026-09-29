const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('stips_data.db');

const rows = db.prepare("SELECT * FROM user_activity WHERE userid = 429329 LIMIT 5").all();
console.log('--- USER ACTIVITY IN DB ---');
console.log(rows);
