const { fetchJsonThroughProxy } = require('./proxy_agent');
const fs = require('fs');

const url = 'https://stips.co.il/api?name=profile.page_data&api_params=%7B%22userid%22:429329%7D';
const proxies = JSON.parse(fs.readFileSync('working_proxies.json', 'utf8'));

async function run() {
  console.log(`Working proxies available: ${proxies.length}`);
  
  for (let i = 0; i < proxies.length; i++) {
    const proxy = proxies[i];
    const [ip, portStr] = proxy.split(':');
    const port = parseInt(portStr, 10);
    
    console.log(`\nTesting proxy ${i+1}: ${proxy}...`);
    try {
      const res = await fetchJsonThroughProxy(url, ip, port);
      console.log('✅ Success! Response status:', res.status);
      console.log('Response keys:', Object.keys(res.data || {}));
      break; // Successfully fetched, we can stop!
    } catch (e) {
      console.error(`❌ Proxy ${proxy} failed:`, e.message);
      if (e.message.includes('Unexpected token')) {
        // Let's print raw response if possible
      }
    }
  }
}

run();
