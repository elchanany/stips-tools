const http = require('http');

const req = http.request({
  hostname: 'localhost',
  port: 3005,
  path: '/api/crawler/stop',
  method: 'POST'
}, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    console.log('Response:', data);
  });
});

req.on('error', (err) => {
  console.error(err);
});

req.end();
