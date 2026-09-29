const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3005;
const DB_FILE = 'stips_data.db';
const STATUS_FILE = 'crawler_status.json';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database connection helper
let db = null;
function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_FILE);
  }
  return db;
}

// Ensure database table exist
try {
  const connection = getDb();
  connection.exec(`
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
  connection.exec(`
    CREATE TABLE IF NOT EXISTS progress (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  connection.exec(`
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
} catch (e) {
  console.error("Database initialization error:", e);
}

// Child process reference for crawler
let crawlerProcess = null;
let crawlerParams = null;

// Read crawler_status.json
function getCrawlerStatus() {
  let state = {
    status: 'stopped',
    currentId: 0,
    consecutiveNonExistent: 0,
    lastUpdated: null,
    totalCrawled: 0,
    activeCount: 0,
    deletedCount: 0,
    logs: []
  };

  if (fs.existsSync(STATUS_FILE)) {
    try {
      const data = fs.readFileSync(STATUS_FILE, 'utf8');
      state = JSON.parse(data);
    } catch (e) {}
  }

  // Override status with live child process state
  if (crawlerProcess && !crawlerProcess.killed) {
    state.status = 'running';
  } else if (state.status === 'running') {
    state.status = 'stopped';
  }

  return state;
}

// API: Get current crawler status
app.get('/api/crawler/status', (req, res) => {
  const status = getCrawlerStatus();
  res.json({
    ...status,
    activeProcess: !!(crawlerProcess && !crawlerProcess.killed),
    params: crawlerParams
  });
});

// API: Start crawler
app.post('/api/crawler/start', (req, res) => {
  if (crawlerProcess && !crawlerProcess.killed) {
    return res.status(400).json({ error: 'Crawler is already running.' });
  }

  const { start, end, delay, concurrency } = req.body;
  const args = [];
  if (start) args.push('--start', start.toString());
  if (end) args.push('--end', end.toString());
  if (delay) args.push('--delay', delay.toString());
  if (concurrency) args.push('--concurrency', concurrency.toString());

  crawlerParams = { start, end, delay, concurrency };
  
  // Spawn crawler script as a child process
  crawlerProcess = spawn('node', ['stips_crawler.js', ...args]);
  console.log(`[Server] Spawned crawler with arguments: ${args.join(' ')}`);

  crawlerProcess.stdout.on('data', (data) => {
    // Process stdout if needed (currently crawler writes status file)
  });

  crawlerProcess.stderr.on('data', (data) => {
    console.error(`[Crawler Error] ${data}`);
  });

  crawlerProcess.on('close', (code) => {
    console.log(`[Server] Crawler process exited with code ${code}`);
    crawlerProcess = null;
  });

  res.json({ success: true, message: 'Crawler started successfully.' });
});

// API: Stop crawler
app.post('/api/crawler/stop', (req, res) => {
  if (!crawlerProcess || crawlerProcess.killed) {
    return res.status(400).json({ error: 'Crawler is not running.' });
  }

  // Send SIGINT for graceful shutdown (saves checkpoint and updates status)
  crawlerProcess.kill('SIGINT');
  res.json({ success: true, message: 'Shutdown signal sent to crawler.' });
});

// API: Get crawl statistics
app.get('/api/stats', (req, res) => {
  try {
    const connection = getDb();
    const total = connection.prepare("SELECT COUNT(*) as count FROM users").get().count;
    const active = connection.prepare("SELECT COUNT(*) as count FROM users WHERE active = 1").get().count;
    const deleted = connection.prepare("SELECT COUNT(*) as count FROM users WHERE is_deleted_ui = 1").get().count;
    const deletedWithNames = connection.prepare("SELECT COUNT(*) as count FROM users WHERE is_deleted_ui = 1 AND nickname IS NOT NULL").get().count;
    const minId = connection.prepare("SELECT MIN(id) as id FROM users").get().id || 0;
    const maxId = connection.prepare("SELECT MAX(id) as id FROM users").get().id || 0;

    res.json({
      total,
      active,
      deleted,
      deletedWithNames,
      range: { min: minId, max: maxId }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// API: Search users
app.get('/api/search', (req, res) => {
  const searchTerm = req.query.q || '';
  const filterType = req.query.type || 'all'; // all, active, deleted
  
  try {
    const connection = getDb();
    let queryStr = "SELECT * FROM users WHERE (nickname LIKE ? OR id = ?)";
    const params = [`%${searchTerm}%`, parseInt(searchTerm, 10) || -1];

    if (filterType === 'active') {
      queryStr += " AND active = 1";
    } else if (filterType === 'deleted') {
      queryStr += " AND is_deleted_ui = 1";
    }

    queryStr += " ORDER BY points DESC LIMIT 100";
    const rows = connection.prepare(queryStr).all(...params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// API: Get user profile details
app.get('/api/user/:id', (req, res) => {
  const userId = parseInt(req.params.id, 10);
  try {
    const connection = getDb();
    const row = connection.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    if (!row) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// API: Get user activity (questions/answers)
app.get('/api/user/:id/activity', (req, res) => {
  const userId = parseInt(req.params.id, 10);
  try {
    const connection = getDb();
    const rows = connection.prepare("SELECT * FROM user_activity WHERE userid = ? ORDER BY time DESC").all(userId);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// API: Get list of deleted users with names
app.get('/api/deleted-users', (req, res) => {
  try {
    const connection = getDb();
    const rows = connection.prepare("SELECT * FROM users WHERE is_deleted_ui = 1 AND nickname IS NOT NULL ORDER BY id DESC").all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Start Express server
app.listen(PORT, () => {
  console.log(`[Server] Web Dashboard API listening at http://localhost:${PORT}`);
});
