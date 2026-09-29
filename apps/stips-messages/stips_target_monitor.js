const https = require('https');

const args = process.argv.slice(2);
let targetId = null;
let pollIntervalMs = 12000; // 12 seconds default

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--target' && args[i + 1]) targetId = parseInt(args[i + 1], 10);
  if (args[i] === '--interval' && args[i + 1]) pollIntervalMs = parseInt(args[i + 1], 10);
}

if (!targetId) {
  console.error('Usage: node stips_target_monitor.js --target <user_id> [--interval <ms>]');
  process.exit(1);
}

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

async function getProfileCounts(userId) {
  const profileUrl = `https://stips.co.il/api?name=profile.page_data&api_params=%7B%22userid%22:${userId}%7D`;
  const res = await fetchJson(profileUrl);
  if (res.status === 'ok') {
    return {
      nickname: res.data?.user_profile_page?.data?.nickname || `משתמש ${userId}`,
      questions: parseInt(res.data?.questions, 10) || 0,
      answers: parseInt(res.data?.answers, 10) || 0,
      points: parseInt(res.data?.points, 10) || 0
    };
  } else {
    throw new Error(res.error_msg || res.msg || 'API returned failed status');
  }
}

async function getAnswersForQuestion(qId) {
  const ansUrl = `https://stips.co.il/api?name=objectlist&api_params=%7B%22method%22:%22ans.for_item%22,%22itemid%22:${qId}%7D`;
  try {
    const res = await fetchJson(ansUrl);
    if (res.status === 'ok' && Array.isArray(res.data)) {
      return res.data;
    }
  } catch (e) {}
  return [];
}

async function run() {
  console.log(`Initialising Target Monitor for user ID: ${targetId}...`);
  
  let currentCounts = null;
  while (!currentCounts) {
    try {
      currentCounts = await getProfileCounts(targetId);
      console.log(`\n🎯 TARGET LOCKED: "${currentCounts.nickname}" (ID: ${targetId})`);
      console.log(`📊 Current stats: Points: ${currentCounts.points} | Questions: ${currentCounts.questions} | Answers: ${currentCounts.answers}`);
    } catch (e) {
      console.error(`Failed to lock target: ${e.message}. Retrying in 10 seconds...`);
      await sleep(10000);
    }
  }

  console.log(`\nMonitoring started. Polling every ${pollIntervalMs / 1000}s. Standing by...`);

  while (true) {
    await sleep(pollIntervalMs);

    try {
      const newCounts = await getProfileCounts(targetId);
      
      // 1. Check if new question was asked
      if (newCounts.questions > currentCounts.questions) {
        const diff = newCounts.questions - currentCounts.questions;
        console.log(`\n🚨 [ALERT] Target "${newCounts.nickname}" asked ${diff} new question(s)!`);
        
        // Fetch new questions to correlate
        console.log('Fetching latest questions for correlation...');
        const feedUrl = 'https://stips.co.il/api?name=objectlist&api_params=%7B%22method%22:%22ask.new%22%7D';
        const feedRes = await fetchJson(feedUrl);
        
        if (feedRes.status === 'ok' && Array.isArray(feedRes.data)) {
          // Get the newest 'diff' questions
          const candidates = feedRes.data.slice(0, Math.max(diff, 3));
          console.log('--- POTENTIAL MATCHES (NEWEST FIRST) ---');
          candidates.forEach((c, idx) => {
            const q = c.data || {};
            console.log(`  [${idx + 1}] ID: ${q.id} | Title: "${q.q}" | Asker: ${q.anonflg ? 'אנונימי/ת 🔒' : c.extra?.item_profile?.nickname} | Time: ${q.time}`);
          });
        }
        currentCounts.questions = newCounts.questions;
      }

      // 2. Check if new answer was posted
      if (newCounts.answers > currentCounts.answers) {
        const diff = newCounts.answers - currentCounts.answers;
        console.log(`\n🚨 [ALERT] Target "${newCounts.nickname}" posted ${diff} new answer(s)!`);
        
        // Fetch latest active questions to find where they answered
        console.log('Fetching latest active questions to locate the answer...');
        const feedUrl = 'https://stips.co.il/api?name=objectlist&api_params=%7B%22method%22:%22ask.new%22%7D';
        const feedRes = await fetchJson(feedUrl);
        
        if (feedRes.status === 'ok' && Array.isArray(feedRes.data)) {
          // Scan answers of the top 8 latest questions
          const activeQuestions = feedRes.data.slice(0, 8);
          console.log('Scanning answers of recent questions for target/anonymous posts...');
          
          for (const item of activeQuestions) {
            const q = item.data || {};
            const qId = q.id;
            if (!qId) continue;

            const answers = await getAnswersForQuestion(qId);
            const targetAnswers = answers.filter(a => {
              const profile = a.extra?.item_profile || {};
              // If the answer is from our target user ID
              if (profile.userid === targetId) return true;
              // If it's anonymous and was posted very recently (in the last 30 seconds)
              if (a.data?.anonflg) {
                // Here we could verify the time difference if we parse the timestamp
                return true; 
              }
              return false;
            });

            if (targetAnswers.length > 0) {
              console.log(`\n👉 MATCH FOUND IN QUESTION ID: ${qId}`);
              console.log(`   Question: "${q.q}"`);
              targetAnswers.forEach(ta => {
                const isAnon = ta.data?.anonflg;
                console.log(`   Answer ID: ${ta.data?.id} | Author: ${isAnon ? 'אנונימי/ת 🔒 (זיהוי קורלטיבי)' : newCounts.nickname} | Text: "${ta.data?.text_content}"`);
              });
            }
          }
        }
        currentCounts.answers = newCounts.answers;
      }

      // Sync other stats
      currentCounts.nickname = newCounts.nickname;
      currentCounts.points = newCounts.points;

    } catch (e) {
      if (e.message.includes('IP_RATE_LIMIT') || e.message.includes('rate limit')) {
        console.warn('⚠️ [Rate Limit] Profile request rate limited. Sleeping 45 seconds...');
        await sleep(45000);
      } else {
        console.error(`Error in monitor loop: ${e.message}`);
        await sleep(5000);
      }
    }
  }
}

run().catch(err => console.error(err));
