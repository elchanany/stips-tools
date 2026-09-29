const fs = require('fs');
const readline = require('readline');

const fileStream = fs.createReadStream('C:/Users/elchanan yehuda/.gemini/antigravity/brain/31a2ffd3-8e59-42cb-9986-3415840e08dd/.system_generated/logs/transcript.jsonl');

const rl = readline.createInterface({
  input: fileStream,
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  try {
    const parsed = JSON.parse(line);
    const idx = parsed.step_index;
    if (idx >= 253 && idx <= 265) {
      console.log(`\n=== STEP ${idx} (${parsed.type}) ===`);
      console.log(JSON.stringify(parsed, null, 2).substring(0, 1500));
    }
  } catch (e) {}
});
