const { fetchJsonThroughProxy } = require('./proxy_agent');
const fs = require('fs');

async function testAll() {
  const proxies = JSON.parse(fs.readFileSync('working_proxies.json', 'utf8'));
  console.log(`Testing ${proxies.length} proxies with actual request to Stips...`);
  
  const testUrl = 'https://stips.co.il/api?name=omniobj&rest_action=GET&omniobj=%7B%22objType%22:%22user%22,%22data%22:%7B%22id%22:123%7D%7D';
  
  for (const proxy of proxies) {
    const [ip, portStr] = proxy.split(':');
    const port = parseInt(portStr, 10);
    console.log(`Testing proxy: ${proxy}...`);
    try {
      const start = Date.now();
      const res = await fetchJsonThroughProxy(testUrl, ip, port, 5000);
      console.log(`  ✅ SUCCESS! Time: ${Date.now() - start}ms | Response Status: ${res.status}`);
    } catch (e) {
      console.log(`  ❌ FAILED: ${e.message}`);
    }
  }
}

testAll();
