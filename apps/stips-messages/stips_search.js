const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');

const DB_FILE = 'stips_data.db';
if (!fs.existsSync(DB_FILE)) {
  console.log(`Database ${DB_FILE} does not exist. Please run the crawler first.`);
  process.exit(1);
}

const db = new DatabaseSync(DB_FILE);

// Parse arguments
const args = process.argv.slice(2);
const searchCmd = args[0];
const searchVal = args[1];

function formatGender(g) {
  if (g === 1) return 'זכר';
  if (g === 2) return 'נקבה';
  return 'לא ידוע';
}

function showHelp() {
  console.log('=== Stips Database Search Utility ===');
  console.log('Usage:');
  console.log('  node stips_search.js --stats                  Show crawl statistics');
  console.log('  node stips_search.js --find <name>            Search users by nickname');
  console.log('  node stips_search.js --id <number>            Get user by ID');
  console.log('  node stips_search.js --deleted                Show all deleted/inactive users with known names');
  console.log('  node stips_search.js --top-points [N]         Show top N users by points');
  console.log('  node stips_search.js --top-flowers [N]        Show top N users by flowers');
  console.log('  node stips_search.js --export <filename.csv>  Export database to CSV');
}

if (!searchCmd || searchCmd === '--help' || searchCmd === '-h') {
  showHelp();
  process.exit(0);
}

if (searchCmd === '--stats') {
  const total = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
  const active = db.prepare("SELECT COUNT(*) as count FROM users WHERE active = 1").get().count;
  const deleted = db.prepare("SELECT COUNT(*) as count FROM users WHERE is_deleted_ui = 1").get().count;
  const deletedWithNames = db.prepare("SELECT COUNT(*) as count FROM users WHERE is_deleted_ui = 1 AND nickname IS NOT NULL").get().count;
  const minId = db.prepare("SELECT MIN(id) as id FROM users").get().id || 0;
  const maxId = db.prepare("SELECT MAX(id) as id FROM users").get().id || 0;

  console.log('=== STIPS CRAWL STATISTICS ===');
  console.log(`Total Crawled Users in DB: ${total}`);
  console.log(`Active Users:              ${active}`);
  console.log(`Deleted/Inactive Users:    ${deleted}`);
  console.log(`Deleted Users with Names:  ${deletedWithNames} (Recovered via wall messages!)`);
  console.log(`Scanned Range:             ID ${minId} to ${maxId}`);
}

else if (searchCmd === '--find') {
  if (!searchVal) {
    console.error('Error: Please specify a nickname to search for.');
    process.exit(1);
  }
  const query = db.prepare("SELECT * FROM users WHERE nickname LIKE ? ORDER BY points DESC LIMIT 100");
  const rows = query.all(`%${searchVal}%`);
  
  console.log(`\nSearch results for "${searchVal}" (${rows.length} matches):`);
  console.table(rows.map(r => ({
    ID: r.id,
    Name: r.nickname,
    Gender: formatGender(r.gender),
    Points: r.points !== null ? r.points : 'N/A',
    Flowers: r.flowers_count !== null ? r.flowers_count : 'N/A',
    Age: r.age || 'N/A',
    Active: r.active ? 'Yes' : 'No',
    Deleted: r.is_deleted_ui ? 'Yes' : 'No'
  })));
}

else if (searchCmd === '--id') {
  if (!searchVal) {
    console.error('Error: Please specify a user ID.');
    process.exit(1);
  }
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(parseInt(searchVal, 10));
  if (!row) {
    console.log(`User with ID ${searchVal} not found in database.`);
  } else {
    console.log(`\n=== User Profile ID: ${row.id} ===`);
    console.log(`Nickname:           ${row.nickname || 'N/A'}`);
    console.log(`Gender:             ${formatGender(row.gender)}`);
    console.log(`Points:             ${row.points !== null ? row.points : 'N/A'}`);
    console.log(`Flowers:            ${row.flowers_count !== null ? row.flowers_count : 'N/A'}`);
    console.log(`Questions:          ${row.questions_count !== null ? row.questions_count : 'N/A'}`);
    console.log(`Answers:            ${row.answers_count !== null ? row.answers_count : 'N/A'}`);
    console.log(`Age:                ${row.age || 'N/A'}`);
    console.log(`Active since:       ${row.active_since || 'N/A'}`);
    console.log(`Status:             ${row.active ? 'Active' : 'Inactive'} | Permanently Blocked: ${row.permanently_blocked ? 'Yes' : 'No'}`);
    console.log(`Deleted from UI:    ${row.is_deleted_ui ? 'Yes' : 'No'}`);
    console.log(`Bio/Status text:    \n${row.bio_text || 'None'}`);
    console.log(`\nLast Updated:       ${row.last_updated}`);
  }
}

else if (searchCmd === '--deleted') {
  const rows = db.prepare("SELECT * FROM users WHERE is_deleted_ui = 1 AND nickname IS NOT NULL ORDER BY id DESC").all();
  console.log(`\nRecovered Deleted Users list (${rows.length} users):`);
  console.table(rows.map(r => ({
    ID: r.id,
    Name: r.nickname,
    Status: 'Deleted (Recovered name)'
  })));
}

else if (searchCmd === '--top-points') {
  const limit = parseInt(searchVal || '10', 10);
  const rows = db.prepare("SELECT * FROM users WHERE active = 1 ORDER BY points DESC LIMIT ?").all(limit);
  console.log(`\nTop ${limit} Users by Points:`);
  console.table(rows.map(r => ({
    ID: r.id,
    Name: r.nickname,
    Points: r.points,
    Flowers: r.flowers_count,
    Age: r.age || 'N/A'
  })));
}

else if (searchCmd === '--top-flowers') {
  const limit = parseInt(searchVal || '10', 10);
  const rows = db.prepare("SELECT * FROM users WHERE active = 1 ORDER BY flowers_count DESC LIMIT ?").all(limit);
  console.log(`\nTop ${limit} Users by Flowers:`);
  console.table(rows.map(r => ({
    ID: r.id,
    Name: r.nickname,
    Flowers: r.flowers_count,
    Points: r.points,
    Age: r.age || 'N/A'
  })));
}

else if (searchCmd === '--export') {
  const csvFile = searchVal || 'stips_export.csv';
  console.log(`Exporting all data to ${csvFile}...`);
  
  const rows = db.prepare("SELECT * FROM users ORDER BY id ASC").all();
  const headers = [
    'id', 'nickname', 'gender', 'has_photo', 'photo_updated_stamp', 'points', 'active',
    'permanently_blocked', 'questions_count', 'answers_count', 'flowers_count',
    'active_since', 'age', 'bio_text', 'bio_text_modified', 'is_deleted_ui', 'last_updated'
  ];

  const writeStream = fs.createWriteStream(csvFile, 'utf8');
  writeStream.write(headers.join(',') + '\n');

  for (const row of rows) {
    const line = headers.map(header => {
      let val = row[header];
      if (val === null || val === undefined) return '';
      // Escape strings for CSV
      if (typeof val === 'string') {
        val = val.replace(/"/g, '""');
        return `"${val}"`;
      }
      return val;
    }).join(',');
    writeStream.write(line + '\n');
  }

  writeStream.end();
  console.log(`Successfully exported ${rows.length} rows to ${csvFile}!`);
}

else {
  console.log('Unknown command.');
  showHelp();
}
