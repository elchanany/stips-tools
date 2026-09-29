const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('stips_data.db');

const checkpoint = db.prepare("SELECT value FROM progress WHERE key = 'last_scanned_id'").get();
const minUser = db.prepare("SELECT MIN(id) as id FROM users").get();
const maxUser = db.prepare("SELECT MAX(id) as id FROM users").get();
const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users").get();
const activeUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE active = 1").get();
const deletedUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE is_deleted_ui = 1").get();

console.log('=== Database Status ===');
console.log('Checkpoint:', checkpoint ? checkpoint.value : 'None');
console.log('Min User ID in DB:', minUser ? minUser.id : 'None');
console.log('Max User ID in DB:', maxUser ? maxUser.id : 'None');
console.log('Total Users in DB:', totalUsers ? totalUsers.count : 0);
console.log('Active Users in DB:', activeUsers ? activeUsers.count : 0);
console.log('Deleted Users in DB:', deletedUsers ? deletedUsers.count : 0);
