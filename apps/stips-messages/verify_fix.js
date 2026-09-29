const http = require('http');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${data}`));
        }
      });
    });
    
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function verify() {
  console.log('--- VERIFICATION START ---');
  
  // 1. Check user activity API
  console.log('Checking /api/user/429305/activity...');
  const activity = await getJson('http://localhost:3005/api/user/429305/activity');
  console.log('Activity response:', activity);
  if (Array.isArray(activity) && activity.length === 0) {
    console.log('✅ Success: user_activity is empty!');
  } else {
    console.error('❌ Error: user_activity is not empty or not an array!');
    process.exit(1);
  }

  // 2. Start crawler for a small range
  console.log('\nStarting crawler for IDs 430700-430702...');
  const startRes = await postJson('http://localhost:3005/api/crawler/start', {
    start: 430700,
    end: 430702,
    delay: 300
  });
  console.log('Start crawler response:', startRes);
  
  if (!startRes.success) {
    console.error('❌ Error starting crawler!');
    process.exit(1);
  }

  // Wait 6 seconds for crawler to process these 3 IDs
  console.log('Waiting 6 seconds for crawling to complete...');
  await new Promise(r => setTimeout(r, 6000));

  // Check crawler status
  const statusRes = await getJson('http://localhost:3005/api/crawler/status');
  console.log('Crawler status:', {
    status: statusRes.status,
    currentId: statusRes.currentId,
    totalCrawled: statusRes.totalCrawled,
    logs: statusRes.logs?.slice(-3)
  });

  // Verify that database user_activity table is still empty
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('stips_data.db');
  const count = db.prepare("SELECT COUNT(*) as count FROM user_activity").get().count;
  console.log(`\nChecking database: user_activity row count is ${count}`);
  if (count === 0) {
    console.log('✅ Success: No incorrect user activities were created during crawl!');
  } else {
    console.error('❌ Error: Activities were added to user_activity table!');
    process.exit(1);
  }

  // Stop crawler to be safe
  console.log('\nStopping crawler...');
  const stopRes = await postJson('http://localhost:3005/api/crawler/stop', {});
  console.log('Stop response:', stopRes);

  console.log('\n--- VERIFICATION SUCCESSFUL ---');
}

verify().catch(e => {
  console.error('Verification failed with error:', e);
  process.exit(1);
});
