const https = require('https');

function testUrl(url, label, callback) {
  https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        const ids = (parsed.data || []).map(item => item.data?.id);
        console.log(`${label}: Count=${ids.length}, IDs=${ids.slice(0, 10).join(', ')}`);
      } catch (e) {
        console.log(`${label}: Failed to parse JSON`);
      }
      callback();
    });
  }).on('error', (err) => {
    console.error(err);
    callback();
  });
}

const tests = [
  { url: 'https://stips.co.il/api?name=objectlist&api_params=%7B%22method%22:%22ask.user_activity%22,%22userid%22:429329%7D', label: 'Default' },
  { url: 'https://stips.co.il/api?name=objectlist&api_params=%7B%22method%22:%22ask.user_activity%22,%22userid%22:429329,%22filter%22:%22asked%22%7D', label: 'Filter=asked' },
  { url: 'https://stips.co.il/api?name=objectlist&api_params=%7B%22method%22:%22ask.user_activity%22,%22userid%22:429329,%22filter%22:%22ansed%22%7D', label: 'Filter=ansed' },
  { url: 'https://stips.co.il/api?name=objectlist&api_params=%7B%22method%22:%22ask.user_activity%22,%22userid%22:429329,%22filter%22:%22pinned%22%7D', label: 'Filter=pinned' },
  { url: 'https://stips.co.il/api?name=objectlist&api_params=%7B%22method%22:%22ask.user_activity%22,%22userid%22:429329,%22section%22:%22asked%22%7D', label: 'Section=asked' },
  { url: 'https://stips.co.il/api?name=objectlist&api_params=%7B%22method%22:%22ask.user_activity%22,%22userid%22:429329,%22section%22:%22ansed%22%7D', label: 'Section=ansed' }
];

let index = 0;
function runNext() {
  if (index < tests.length) {
    const t = tests[index++];
    testUrl(t.url, t.label, runNext);
  }
}
runNext();
