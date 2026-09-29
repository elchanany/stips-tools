const http = require('http');

http.get('http://localhost:3005/api/stats', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    console.log('Response:', data);
  });
}).on('error', (err) => {
  console.error('Error connecting to local server:', err.message);
});
