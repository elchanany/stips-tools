const http = require('http');

function post(path, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = bodyObj ? JSON.stringify(bodyObj) : '';
    const req = http.request({
      hostname: 'localhost',
      port: 3005,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function run() {
  console.log('Stopping current crawler...');
  try {
    const stopRes = await post('/api/crawler/stop');
    console.log('Stop response:', stopRes);
  } catch (e) {
    console.log('Stop request failed or crawler was not running:', e.message);
  }

  console.log('Waiting 2 seconds...');
  await new Promise(r => setTimeout(r, 2000));

  console.log('Starting concurrent crawler from ID 1 to 500000 with 25 workers and 200ms delay...');
  try {
    const startRes = await post('/api/crawler/start', { start: 1, end: 500000, delay: 200, concurrency: 25 });
    console.log('Start response:', startRes);
  } catch (e) {
    console.error('Failed to start crawler:', e.message);
  }
}

run();
