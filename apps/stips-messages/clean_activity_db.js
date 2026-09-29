const { DatabaseSync } = require('node:sqlite');

console.log('Cleaning up user_activity table...');
try {
  const db = new DatabaseSync('stips_data.db');
  
  // Get count before
  const countBefore = db.prepare("SELECT COUNT(*) as count FROM user_activity").get().count;
  console.log(`Current user_activity rows: ${countBefore}`);
  
  // Delete all rows
  db.exec("DELETE FROM user_activity;");
  console.log('Cleared user_activity table.');
  
  // Get count after
  const countAfter = db.prepare("SELECT COUNT(*) as count FROM user_activity").get().count;
  console.log(`User_activity rows after cleanup: ${countAfter}`);
  
  console.log('Database cleanup completed successfully!');
} catch (e) {
  console.error('Error cleaning database:', e);
  process.exit(1);
}
