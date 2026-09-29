const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('stips_data.db');

const getVal = db.prepare("SELECT value FROM progress WHERE key = 'last_scanned_id'");
const setVal = db.prepare("UPDATE progress SET value = ? WHERE key = 'last_scanned_id'");

const checkpoint = getVal.get();
console.log('Current checkpoint in DB:', checkpoint);

if (checkpoint && parseInt(checkpoint.value, 10) > 430652) {
  setVal.run('430652');
  console.log('Checkpoint rewound successfully to 430652 (will start from 430653 next)!');
} else {
  console.log('No rewind needed.');
}
