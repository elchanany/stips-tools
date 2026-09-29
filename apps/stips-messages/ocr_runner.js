const Tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');

const imgDir = path.join(__dirname, 'pdf_images');
const outPath = path.join(__dirname, 'ocr_result.txt');

fs.writeFileSync(outPath, '--- OCR Results ---\n');

async function processAll() {
  const worker = await Tesseract.createWorker('heb');
  
  for (let i = 0; i < 22; i++) {
    const imgFile = path.join(imgDir, `page_${i}.png`);
    if (fs.existsSync(imgFile)) {
      console.log(`Processing page ${i}...`);
      const { data: { text } } = await worker.recognize(imgFile);
      fs.appendFileSync(outPath, `\n\n--- Page ${i} ---\n${text}`);
    }
  }
  
  await worker.terminate();
  console.log('All done!');
}

processAll().catch(err => console.error(err));
