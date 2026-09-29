const http = require('http');

const body = JSON.stringify({
  delay: 450 // Set a slightly faster delay (450ms instead of 600ms) since we have proxy rotation!
});

const options = {
  hostname: 'localhost',
  port: 3005,
  path: '/api/crawler/start',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }
};

const req = http.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => { responseData += chunk; });
  res.on('end', () => {
    console.log('Status code:', res.statusCode);
    console.log('Response:', responseData);
  });
});

req.on('error', (e) => {
  console.error('Error triggering crawler:', e.message);
});

req.write(body);
req.end();
