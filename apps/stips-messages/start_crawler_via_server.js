const http = require('http');

const payload = JSON.stringify({
  start: 429300,
  end: 429400,
  delay: 300
});

const req = http.request({
  hostname: 'localhost',
  port: 3005,
  path: '/api/crawler/start',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': payload.length
  }
}, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    console.log('Response:', data);
  });
});

req.on('error', (err) => {
  console.error('Error starting crawler:', err.message);
});

req.write(payload);
req.end();
