const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
db.exec("INSERT INTO test (name) VALUES ('Stips')");
const stmt = db.prepare('SELECT * FROM test');
const row = stmt.get();
console.log('SQLite works!', row);
