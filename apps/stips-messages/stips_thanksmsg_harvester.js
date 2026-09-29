const { DatabaseSync } = require('node:sqlite');
const https = require('https');

const DB_FILE = 'stips_data.db';
if (!require('fs').existsSync(DB_FILE)) {
  console.error(`Database ${DB_FILE} does not exist. Please run the crawler first.`);
  process.exit(1);
}

const db = new DatabaseSync(DB_FILE);

// SQL Statements
const getActiveUsers = db.prepare("SELECT id, nickname, points FROM users WHERE active = 1 AND is_deleted_ui = 0 ORDER BY points DESC LIMIT ?");
const getUserById = db.prepare("SELECT id, nickname, is_deleted_ui FROM users WHERE id = ?");
const updateDeletedUsername = db.prepare("UPDATE users SET nickname = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?");

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP status ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON response: ${e.message}`));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms + Math.floor(Math.random() * 100)));
}

async function harvestDeletedUsernames() {
  console.log(`Starting ThanksMsg Username Harvester...`);
  
  // Get top 100 active users by points (as they are more likely to have received wall messages)
  // We can adjust this limit or add options
  const limit = 100;
  const activeUsers = getActiveUsers.all(limit);
  console.log(`Scanning wall messages of top ${activeUsers.length} active users...\n`);

  let harvestedCount = 0;

  for (let u = 0; u < activeUsers.length; u++) {
    const activeUser = activeUsers[u];
    console.log(`[${u+1}/${activeUsers.length}] Scanning wall of "${activeUser.nickname}" (ID: ${activeUser.id}, Points: ${activeUser.points})...`);

    try {
      const url = `https://stips.co.il/api?name=objectlist&api_params=%7B%22page%22:1,%22objType%22:%22thanksmsg%22,%22userid%22:${activeUser.id}%7D`;
      const res = await fetchJson(url);

      if (res.status === 'ok' && Array.isArray(res.data)) {
        for (const msg of res.data) {
          const senderProfile = msg.extra?.item_profile || {};
          const senderId = senderProfile.userid;
          const senderNickname = senderProfile.nickname;

          if (senderId && senderNickname) {
            // Check if this sender is a deleted user in our database
            const dbUser = getUserById.get(senderId);
            
            if (dbUser) {
              // If the user in DB is marked as deleted/inactive and has no nickname (or we can update it)
              if (dbUser.is_deleted_ui === 1 && !dbUser.nickname) {
                updateDeletedUsername.run(senderNickname, senderId);
                console.log(`  🎉 [HARVESTED] Found name for deleted user ID ${senderId}: "${senderNickname}"`);
                harvestedCount++;
              }
            } else {
              // If the user doesn't exist in DB at all, we can proactively create their record as active!
              // (This helps map users that our main crawler hasn't reached yet!)
              db.exec(`
                INSERT INTO users (id, nickname, active, is_deleted_ui)
                VALUES (${senderId}, '${senderNickname.replace(/'/g, "''")}', ${senderProfile.active ? 1 : 0}, ${senderProfile.active ? 0 : 1})
                ON CONFLICT(id) DO NOTHING
              `);
            }
          }
        }
      }
    } catch (e) {
      console.warn(`  [Warning] Failed to scan wall of user ID ${activeUser.id}: ${e.message}`);
    }

    await sleep(800); // Respectful delay between users
  }

  console.log(`\nHarvest complete! Total new usernames recovered/mapped: ${harvestedCount}`);
}

harvestDeletedUsernames().catch(err => console.error(err));
