const http = require('http');

http.get('http://localhost:3005/api/crawler/status', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      console.log('=== Crawler Live Status ===');
      console.log(`Status:            ${parsed.status}`);
      console.log(`Current Scanning:  ID ${parsed.currentId}`);
      console.log(`Total Scanned:     ${parsed.totalCrawled}`);
      console.log(`Active Count:      ${parsed.activeCount}`);
      console.log(`Deleted Count:     ${parsed.deletedCount}`);
      console.log('\n--- Recent Logs ---');
      (parsed.logs || []).slice(-5).forEach(line => console.log(line));
    } catch (e) {
      console.log('Error parsing JSON:', e.message);
    }
  });
}).on('error', (err) => {
  console.error(err);
});
