const fs = require('fs');
const readline = require('readline');

const fileStream = fs.createReadStream('C:/Users/elchanan yehuda/.gemini/antigravity/brain/31a2ffd3-8e59-42cb-9986-3415840e08dd/.system_generated/logs/transcript.jsonl');

const rl = readline.createInterface({
  input: fileStream,
  crlfDelay: Infinity
});

let lineNum = 0;
rl.on('line', (line) => {
  lineNum++;
  if (lineNum === 112 || lineNum === 113 || lineNum === 217 || line.includes('"id": 14065259')) {
    console.log(`Line ${lineNum}: ${line.substring(0, 1500)}`);
  }
});
