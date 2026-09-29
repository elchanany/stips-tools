const https = require('https');

https.get('https://stips.co.il/profile/424885', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('--- STATUS ---');
    console.log(res.statusCode);
    console.log('--- HEADERS ---');
    console.log(JSON.stringify(res.headers, null, 2));
    console.log('--- TITLE MATCH ---');
    const titleMatch = data.match(/<title>([\s\S]*?)<\/title>/i);
    console.log(titleMatch ? titleMatch[1].trim() : 'No title tag found');
    console.log('--- BODY LENGTH ---');
    console.log(data.length);
  });
}).on('error', (err) => {
  console.error('Error:', err.message);
});
