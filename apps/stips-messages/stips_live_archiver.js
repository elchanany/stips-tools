const { DatabaseSync } = require('node:sqlite');
const https = require('https');

const DB_FILE = 'stips_data.db';
const db = new DatabaseSync(DB_FILE);

// Setup schema
db.exec(`
  CREATE TABLE IF NOT EXISTS archived_questions (
    id INTEGER PRIMARY KEY,
    title TEXT,
    content TEXT,
    asker_id INTEGER,
    asker_name TEXT,
    time TEXT,
    anonflg BOOLEAN,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS archived_answers (
    id INTEGER PRIMARY KEY,
    question_id INTEGER,
    user_id INTEGER,
    user_name TEXT,
    content TEXT,
    time TEXT,
    anonflg BOOLEAN,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(question_id) REFERENCES archived_questions(id)
  );
`);

// Prepared statements
const insertQuestion = db.prepare(`
  INSERT INTO archived_questions (id, title, content, asker_id, asker_name, time, anonflg)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    content = excluded.content,
    asker_id = excluded.asker_id,
    asker_name = excluded.asker_name,
    time = excluded.time,
    anonflg = excluded.anonflg,
    last_updated = CURRENT_TIMESTAMP
`);

const insertAnswer = db.prepare(`
  INSERT INTO archived_answers (id, question_id, user_id, user_name, content, time, anonflg)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    content = excluded.content,
    time = excluded.time,
    anonflg = excluded.anonflg,
    last_updated = CURRENT_TIMESTAMP
`);

const checkQuestionExists = db.prepare(`
  SELECT 1 FROM archived_questions WHERE id = ?
`);

const insertDiscoveredUser = db.prepare(`
  INSERT INTO users (id, nickname, active, is_deleted_ui)
  VALUES (?, ?, 1, 0)
  ON CONFLICT(id) DO UPDATE SET
    nickname = excluded.nickname,
    active = 1,
    is_deleted_ui = 0
`);

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
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function archiveQuestionAnswers(qId) {
  const ansUrl = `https://stips.co.il/api?name=objectlist&api_params=%7B%22method%22:%22ans.for_item%22,%22itemid%22:${qId}%7D`;
  try {
    const res = await fetchJson(ansUrl);
    if (res.status === 'ok' && Array.isArray(res.data)) {
      let count = 0;
      for (const item of res.data) {
        const aData = item.data || {};
        const ansId = aData.id;
        if (!ansId) continue;

        const profile = item.extra?.item_profile || {};
        const userId = profile.userid || null;
        const userName = profile.nickname || (aData.anonflg ? 'אנונימי/ת' : null);
        const content = aData.text_content || '';
        const time = aData.time || '';
        const anonflg = aData.anonflg ? 1 : 0;

        insertAnswer.run(
          ansId,
          qId,
          userId,
          userName,
          content,
          time,
          anonflg
        );

        if (userId && profile.nickname && !aData.anonflg) {
          insertDiscoveredUser.run(userId, profile.nickname);
        }
        count++;
      }
      console.log(`  └─ Archived ${count} answers for question ID ${qId}`);
    }
  } catch (e) {
    console.error(`  └─ Failed to fetch answers for question ID ${qId}: ${e.message}`);
  }
}

async function run() {
  console.log('Starting Stips Live Feed Archiver (Press Ctrl+C to stop)...');
  
  while (true) {
    try {
      const feedUrl = 'https://stips.co.il/api?name=objectlist&api_params=%7B%22method%22:%22ask.new%22%7D';
      const res = await fetchJson(feedUrl);
      
      if (res.status === 'failed' && (res.error_code === 'IP_RATE_LIMIT' || (res.msg || '').includes('rate limit'))) {
        console.warn('⚠️ [Rate Limit] Feed archiver rate limited. Sleeping 2 minutes...');
        await sleep(2 * 60 * 1000);
        continue;
      }

      if (res.status === 'ok' && Array.isArray(res.data)) {
        let newQuestionsCount = 0;
        
        for (const item of res.data) {
          const qData = item.data || {};
          const qId = qData.id;
          if (!qId) continue;

          // Check if already processed
          const exists = checkQuestionExists.get(qId);
          if (!exists) {
            newQuestionsCount++;
            
            const profile = item.extra?.item_profile || {};
            const title = qData.q || '';
            const content = qData.text_content || '';
            const askerId = profile.userid || null;
            const askerName = profile.nickname || (qData.anonflg ? 'אנונימי/ת' : null);
            const time = qData.time || '';
            const anonflg = qData.anonflg ? 1 : 0;

            console.log(`[NEW QUESTION] ID: ${qId} | Title: "${title.substring(0, 50)}..." | Asker: ${askerName}`);
            
            insertQuestion.run(
              qId,
              title,
              content,
              askerId,
              askerName,
              time,
              anonflg
            );

            if (askerId && profile.nickname && !qData.anonflg) {
              insertDiscoveredUser.run(askerId, profile.nickname);
            }

            // Fetch and archive answers for this question
            await archiveQuestionAnswers(qId);
            await sleep(500); // 500ms delay between questions
          }
        }
        
        if (newQuestionsCount > 0) {
          console.log(`Processed ${newQuestionsCount} new questions.`);
        }
      }
    } catch (e) {
      console.error('Error in live feed loop:', e.message);
    }

    // Poll every 25 seconds
    await sleep(25000);
  }
}

run().catch(err => console.error('Fatal live archiver error:', err));
