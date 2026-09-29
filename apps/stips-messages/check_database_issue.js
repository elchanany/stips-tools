const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('stips_data.db');

const userActivity = db.prepare("SELECT * FROM user_activity WHERE userid = 429305").all();
console.log('--- USER ACTIVITY FOR ID 429305 ---');
console.log(userActivity);

const questionActivity = db.prepare("SELECT * FROM user_activity WHERE itemid = 19457133").all();
console.log('\n--- ACTIVITY FOR QUESTION ID 19457133 ---');
console.log(questionActivity);
