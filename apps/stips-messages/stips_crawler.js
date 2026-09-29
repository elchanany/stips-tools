const { DatabaseSync } = require('node:sqlite');
const https = require('https');
const fs = require('fs');
const { fetchJsonThroughProxy } = require('./proxy_agent');

// Configuration and arguments
const args = process.argv.slice(2);
let startId = null;
let endId = null;
let delayMs = 600; 
let consecutiveLimit = 500; 
let concurrency = 15; 

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--start' && args[i + 1]) startId = parseInt(args[i + 1], 10);
  if (args[i] === '--end' && args[i + 1]) endId = parseInt(args[i + 1], 10);
  if (args[i] === '--delay' && args[i + 1]) delayMs = parseInt(args[i + 1], 10);
  if (args[i] === '--limit' && args[i + 1]) consecutiveLimit = parseInt(args[i + 1], 10);
  if (args[i] === '--concurrency' && args[i + 1]) concurrency = parseInt(args[i + 1], 10);
}

// Database setup
const DB_FILE = 'stips_data.db';
const db = new DatabaseSync(DB_FILE);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    nickname TEXT,
    gender INTEGER,
    has_photo BOOLEAN,
    photo_updated_stamp TEXT,
    points INTEGER,
    active BOOLEAN,
    permanently_blocked BOOLEAN,
    questions_count INTEGER,
    answers_count INTEGER,
    flowers_count INTEGER,
    active_since TEXT,
    age INTEGER,
    bio_text TEXT,
    bio_text_modified TEXT,
    is_deleted_ui BOOLEAN DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS progress (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS user_activity (
    userid INTEGER,
    itemid INTEGER,
    type TEXT,
    title TEXT,
    url TEXT,
    time TEXT,
    PRIMARY KEY (userid, itemid, type)
  );
`);

// SQL statements
const insertUser = db.prepare(`
  INSERT INTO users (
    id, nickname, gender, has_photo, photo_updated_stamp, points, active, permanently_blocked,
    questions_count, answers_count, flowers_count, active_since, age, bio_text, bio_text_modified,
    is_deleted_ui, last_updated
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, ?,
    ?, CURRENT_TIMESTAMP
  ) ON CONFLICT(id) DO UPDATE SET
    nickname=excluded.nickname,
    gender=excluded.gender,
    has_photo=excluded.has_photo,
    photo_updated_stamp=excluded.photo_updated_stamp,
    points=excluded.points,
    active=excluded.active,
    permanently_blocked=excluded.permanently_blocked,
    questions_count=excluded.questions_count,
    answers_count=excluded.answers_count,
    flowers_count=excluded.flowers_count,
    active_since=excluded.active_since,
    age=excluded.age,
    bio_text=excluded.bio_text,
    bio_text_modified=excluded.bio_text_modified,
    is_deleted_ui=excluded.is_deleted_ui,
    last_updated=CURRENT_TIMESTAMP
`);

const insertActivity = db.prepare(`
  INSERT INTO user_activity (userid, itemid, type, title, url, time)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(userid, itemid, type) DO UPDATE SET
    title=excluded.title,
    url=excluded.url,
    time=excluded.time
`);

const getCheckpoint = db.prepare("SELECT value FROM progress WHERE key = 'last_scanned_id'");
const setCheckpoint = db.prepare("INSERT INTO progress (key, value) VALUES ('last_scanned_id', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");

// Live state logging and status reporting
const STATUS_FILE = 'crawler_status.json';
const maxLogLines = 30;
const logLines = [];

function writeStatus(status, currentId, consecutiveCount) {
  let total = 0, active = 0, deleted = 0;
  try {
    total = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
    active = db.prepare("SELECT COUNT(*) as count FROM users WHERE active = 1").get().count;
    deleted = db.prepare("SELECT COUNT(*) as count FROM users WHERE is_deleted_ui = 1").get().count;
  } catch (e) {}

  const state = {
    status,
    currentId,
    consecutiveNonExistent: consecutiveCount,
    lastUpdated: new Date().toISOString(),
    totalCrawled: total,
    activeCount: active,
    deletedCount: deleted,
    logs: logLines
  };

  fs.writeFileSync(STATUS_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function logStatus(message) {
  const timeStr = new Date().toLocaleTimeString();
  const formatted = `[${timeStr}] ${message}`;
  console.log(formatted);
  logLines.push(formatted);
  if (logLines.length > maxLogLines) logLines.shift();
}

let proxiesList = [];
let proxyIndex = 0;
let isHarvesting = false;

const cp = require('child_process');
function runHarvester() {
  return new Promise((resolve) => {
    cp.exec('node fetch_free_proxies.js', (err, stdout, stderr) => {
      if (err) {
        logStatus(`❌ Failed to run proxy harvester: ${err.message}`);
      } else {
        logStatus(`✅ Proxy harvester completed.`);
      }
      resolve();
    });
  });
}

function loadProxies() {
  try {
    if (fs.existsSync('working_proxies.json')) {
      proxiesList = JSON.parse(fs.readFileSync('working_proxies.json', 'utf8'));
    }
  } catch (e) {
    proxiesList = [];
  }
}
loadProxies();

// Helper to make HTTPS requests returning JSON (with proxy rotation & direct fallback)
async function fetchJson(url) {
  if (Math.random() < 0.05) loadProxies(); // reload periodically

  if (proxiesList.length === 0) {
    if (!isHarvesting) {
      isHarvesting = true;
      logStatus('⚠️ Proxy list depleted! Spawning proxy harvester asynchronously...');
      await runHarvester();
      loadProxies();
      logStatus(`🔄 Loaded ${proxiesList.length} fresh proxies.`);
      isHarvesting = false;
    } else {
      logStatus('⏳ Proxy harvester is currently active. Waiting 5s...');
      await sleep(5000);
      loadProxies();
    }

    if (proxiesList.length === 0) {
      logStatus('⚠️ No proxies found. Sleeping for 20s before falling back to direct IP...');
      await sleep(20000);
      return fetchJsonDirect(url);
    }
  }

  const maxAttempts = Math.min(5, proxiesList.length);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (proxiesList.length === 0) break;
    // If the list was shrunk, adjust index
    if (proxyIndex >= proxiesList.length) proxyIndex = 0;
    
    const proxy = proxiesList[proxyIndex];
    if (!proxy) {
      proxyIndex = 0;
      continue;
    }
    
    const [ip, portStr] = proxy.split(':');
    const port = parseInt(portStr, 10);

    try {
      const data = await fetchJsonThroughProxy(url, ip, port, 3000); // 3s timeout for fast pruning
      
      // Check if Stips returned a rate limit JSON response through this proxy
      if (data && data.status === 'failed' && (data.error_code === 'IP_RATE_LIMIT' || (data.error_msg || '').includes('rate limit') || (data.msg || '').includes('rate limit'))) {
        const idx = proxiesList.indexOf(proxy);
        if (idx !== -1) {
          proxiesList.splice(idx, 1);
        }
        continue; // Try next proxy
      }

      if (proxiesList.length > 0) {
        proxyIndex = (proxyIndex + 1) % proxiesList.length;
      } else {
        proxyIndex = 0;
      }
      return data;
    } catch (e) {
      // Proxy failed! Prune it from the in-memory list
      const idx = proxiesList.indexOf(proxy);
      if (idx !== -1) {
        proxiesList.splice(idx, 1);
      }
    }
  }

  logStatus('⚠️ All proxy attempts failed in this batch. Throwing proxy error to force retry...');
  throw new Error('All proxies failed');
}

function fetchJsonDirect(url) {
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
    }).on('error', reject);
  });
}

// Sleep helper with random jitter
function sleep(ms) {
  const jitter = Math.floor(Math.random() * 200) - 100; // +/- 100ms jitter
  return new Promise(resolve => setTimeout(resolve, Math.max(100, ms + jitter)));
}

async function startCrawler() {
  // Determine starting ID
  if (startId === null) {
    const checkpoint = getCheckpoint.get();
    if (checkpoint && checkpoint.value) {
      startId = parseInt(checkpoint.value, 10) + 1;
    } else {
      startId = 1;
    }
  }

  logStatus(`Starting Stips User Crawler...`);
  logStatus(`Start ID: ${startId} | End ID: ${endId !== null ? endId : 'until done'}`);
  logStatus(`Base Delay: ${delayMs}ms (with jitter)`);
  logStatus(`Concurrency: ${concurrency} parallel workers`);

  let currentId = startId;
  let consecutiveNonExistent = 0;
  let running = true;

  // Sliding window checkpoint variables
  const completedIds = new Set();
  let lastSavedCheckpoint = startId - 1;

  function markCompleted(id, exists) {
    completedIds.add(id);
    if (exists) {
      consecutiveNonExistent = 0;
    } else {
      consecutiveNonExistent++;
    }

    // Advance checkpoint sliding window
    let advanced = false;
    while (completedIds.has(lastSavedCheckpoint + 1)) {
      lastSavedCheckpoint++;
      completedIds.delete(lastSavedCheckpoint);
      advanced = true;
    }

    if (advanced) {
      setCheckpoint.run(lastSavedCheckpoint.toString());
    }
  }

  // Handle process shutdown gracefully
  function handleExit() {
    running = false;
    logStatus('Received shutdown signal. Exiting crawler gracefully...');
    setTimeout(() => {
      writeStatus('stopped', lastSavedCheckpoint, consecutiveNonExistent);
      process.exit(0);
    }, 1500);
  }

  process.on('SIGTERM', handleExit);
  process.on('SIGINT', handleExit);

  async function worker(workerId) {
    let pendingId = null;

    while (running) {
      if (endId === null && consecutiveNonExistent >= consecutiveLimit) {
        logStatus(`[Worker ${workerId}] Reached limit of ${consecutiveLimit} consecutive empty users. Worker stopping.`);
        running = false;
        break;
      }

      const id = pendingId !== null ? pendingId : currentId++;
      if (endId !== null && id > endId) {
        break;
      }
      pendingId = null; // Reset pending state

      writeStatus('running', lastSavedCheckpoint, consecutiveNonExistent);

      let userExists = false;
      try {
        const omniobjUrl = `https://stips.co.il/api?name=omniobj&rest_action=GET&omniobj=%7B%22objType%22:%22user%22,%22data%22:%7B%22id%22:${id}%7D%7D`;
        const profileUrl = `https://stips.co.il/api?name=profile.page_data&api_params=%7B%22userid%22:${id}%7D`;

        // 1. Fetch omniobj
        const omniRes = await fetchJson(omniobjUrl);
        
        if (omniRes.status === 'failed') {
          const errorCode = omniRes.error_code || '';
          const errorMsg = omniRes.error_msg || omniRes.msg || '';
          
          if (errorCode === 'IP_RATE_LIMIT' || errorMsg.includes('rate limit')) {
            logStatus(`⚠️ [Rate Limit] Worker ${workerId} IP rate limit reached! Msg: ${errorMsg}`);
            logStatus(`Worker ${workerId} sleeping for 3 minutes before retrying ID ${id}...`);
            pendingId = id; // retry this ID later
            await sleep(3 * 60 * 1000); // 3 minutes sleep
            continue; 
          }

          if (errorMsg.includes('item does not exits')) {
            logStatus(`ID ${id}: Does not exist (${consecutiveNonExistent}/${consecutiveLimit})`);
          } else if (errorMsg.includes('not an active user')) {
            // Inactive / deleted user
            insertUser.run(
              id,
              null, // nickname
              null, // gender
              null, // has_photo
              null, // photo_updated_stamp
              null, // points
              0,    // active
              null, // permanently_blocked
              null, // questions_count
              null, // answers_count
              null, // flowers_count
              null, // active_since
              null, // age
              null, // bio_text
              null, // bio_text_modified
              1     // is_deleted_ui
            );
            logStatus(`ID ${id}: Deleted / Inactive user`);
          } else {
            logStatus(`ID ${id}: Failed with error: ${errorMsg}`);
          }
        } else if (omniRes.status === 'ok') {
          userExists = true;
          const userObj = omniRes.data.omniOmniObj.data;
          const extraObj = omniRes.data.omniOmniObj.extra || {};
          
          // 2. Fetch profile data
          let profData = {};
          try {
            const profRes = await fetchJson(profileUrl);
            if (profRes.status === 'ok') {
              profData = profRes.data || {};
            } else if (profRes.status === 'failed' && (profRes.error_code === 'IP_RATE_LIMIT' || (profRes.msg || '').includes('rate limit'))) {
              const errorMsg = profRes.error_msg || profRes.msg || '';
              logStatus(`⚠️ [Rate Limit] Worker ${workerId} Profile API rate limit reached! Msg: ${errorMsg}`);
              logStatus(`Worker ${workerId} sleeping for 3 minutes before retrying ID ${id}...`);
              pendingId = id; // retry this ID later
              await sleep(3 * 60 * 1000); // 3 minutes sleep
              continue;
            }
          } catch (pe) {
            logStatus(`[Warning] Worker ${workerId} failed to fetch profile details for active user ID ${id}: ${pe.message}`);
          }

          const bioObj = profData.user_profile_page?.data || {};

          insertUser.run(
            id,
            userObj.nickname || null,
            userObj.gender !== undefined ? userObj.gender : null,
            userObj.has_photo ? 1 : 0,
            userObj.photo_updated_stamp || null,
            userObj.points !== undefined ? userObj.points : null,
            userObj.active ? 1 : 0,
            extraObj.permanentlyBlocked ? 1 : 0,
            profData.questions !== undefined ? profData.questions : null,
            profData.answers !== undefined ? profData.answers : null,
            profData.flowers !== undefined ? profData.flowers : null,
            profData.hebrew_active_since || null,
            profData.age !== undefined ? profData.age : null,
            bioObj.text_status || null,
            bioObj.text_status_modified || null,
            0 // is_deleted_ui
          );

          logStatus(`ID ${id}: Active user "${userObj.nickname}" | points: ${userObj.points} | Q: ${profData.questions || 0} | A: ${profData.answers || 0}`);
        }

        markCompleted(id, userExists);

      } catch (e) {
        logStatus(`Error processing ID ${id} in Worker ${workerId}: ${e.message}`);
        pendingId = id; // retry this ID later
        await sleep(delayMs * 3);
      }

      await sleep(delayMs);
    }
  }

  // Spawn parallel workers
  const workerPromises = [];
  for (let w = 1; w <= concurrency; w++) {
    workerPromises.push(worker(w));
  }

  await Promise.all(workerPromises);
  writeStatus('stopped', lastSavedCheckpoint, consecutiveNonExistent);
  logStatus('All workers completed. Crawler stopped.');
}

startCrawler().catch(err => {
  console.error('Fatal crawler error:', err);
  writeStatus('stopped', 0, 0);
});
