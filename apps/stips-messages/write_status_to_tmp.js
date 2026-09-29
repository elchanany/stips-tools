const http = require('http');
const fs = require('fs');

http.get('http://localhost:3005/api/crawler/status', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      let output = '=== Crawler Live Status ===\n';
      output += `Status:            ${parsed.status}\n`;
      output += `Current Scanning:  ID ${parsed.currentId}\n`;
      output += `Total Scanned:     ${parsed.totalCrawled}\n`;
      output += `Active Count:      ${parsed.activeCount}\n`;
      output += `Deleted Count:     ${parsed.deletedCount}\n`;
      output += '\n--- Recent Logs ---\n';
      (parsed.logs || []).slice(-10).forEach(line => {
        output += line + '\n';
      });
      
      fs.writeFileSync('C:/tmp/terminal_output.txt', output, 'utf8');
      console.log('Status saved to C:/tmp/terminal_output.txt successfully.');
    } catch (e) {
      const errorMsg = 'Error parsing JSON: ' + e.message;
      fs.writeFileSync('C:/tmp/terminal_output.txt', errorMsg, 'utf8');
      console.error(errorMsg);
    }
  });
}).on('error', (err) => {
  const errorMsg = 'Error querying status API: ' + err.message;
  fs.writeFileSync('C:/tmp/terminal_output.txt', errorMsg, 'utf8');
  console.error(err);
});
