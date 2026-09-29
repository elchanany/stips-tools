const https = require('https');
const http = require('http');
const net = require('net');
const tls = require('tls');
const fs = require('fs');

const { fetchJsonThroughProxy } = require('./proxy_agent');

const PROXY_LIST_URLS = [
  'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
  'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt',
  'https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt',
  'https://raw.githubusercontent.com/officialputuid/asd/master/http.txt',
  'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all',
  'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt'
];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Status ${res.statusCode}`));
        } else {
          resolve(data);
        }
      });
    }).on('error', reject);
  });
}

async function testProxy(proxyIp, proxyPort) {
  const testUrl = 'https://stips.co.il/api?name=omniobj&rest_action=GET&omniobj=%7B%22objType%22:%22user%22,%22data%22:%7B%22id%22:123%7D%7D';
  try {
    const res = await fetchJsonThroughProxy(testUrl, proxyIp, proxyPort, 4000); // 4s timeout
    return res && res.status !== undefined;
  } catch (e) {
    return false;
  }
}

async function start() {
  console.log('Fetching free proxy lists...');
  let rawProxies = [];
  
  for (const url of PROXY_LIST_URLS) {
    try {
      const data = await fetchUrl(url);
      const lines = data.split('\n').map(l => l.trim()).filter(l => l && l.includes(':'));
      rawProxies = rawProxies.concat(lines);
      console.log(`Fetched ${lines.length} proxies from ${url}`);
    } catch (e) {
      console.warn(`Failed to fetch from ${url}: ${e.message}`);
    }
  }

  // Remove duplicates
  const uniqueProxies = Array.from(new Set(rawProxies));
  console.log(`Total unique proxies fetched: ${uniqueProxies.length}`);

  // Test them in parallel batches
  console.log('Testing proxies (validating CONNECT to stips.co.il)...');
  const workingProxies = [];
  const batchSize = 100;
  const maxToTest = 2500; // Increase to find at least 15 verified working proxies
  const testPool = uniqueProxies.slice(0, maxToTest);

  for (let i = 0; i < testPool.length; i += batchSize) {
    const batch = testPool.slice(i, i + batchSize);
    console.log(`Testing batch ${i / batchSize + 1}/${Math.ceil(testPool.length / batchSize)} (Size: ${batch.length})...`);
    
    const results = await Promise.all(batch.map(async (p) => {
      const [ip, portStr] = p.split(':');
      const port = parseInt(portStr, 10);
      if (isNaN(port)) return null;
      const ok = await testProxy(ip, port);
      return ok ? p : null;
    }));

    for (const res of results) {
      if (res) {
        workingProxies.push(res);
        console.log(`  🔥 Found working proxy: ${res}`);
      }
    }

    // If we have enough working proxies (e.g. 15), we can stop
    if (workingProxies.length >= 15) {
      console.log('Found enough working proxies (>= 15), stopping test.');
      break;
    }
  }

  console.log(`\nFound ${workingProxies.length} working proxies.`);
  fs.writeFileSync('working_proxies.json', JSON.stringify(workingProxies, null, 2));
  console.log('Saved working proxies to working_proxies.json');
}

start().catch(err => console.error(err));
