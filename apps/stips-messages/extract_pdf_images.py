import fitz  # PyMuPDF
import os

pdf_path = r"C:\Users\elchanan yehuda\Downloads\moderator-rules.pdf"
out_dir = r"C:\Users\elchanan yehuda\Documents\understand_stips\pdf_images"

if not os.path.exists(out_dir):
    os.makedirs(out_dir)

doc = fitz.open(pdf_path)
print(f"Total pages: {len(doc)}")

# To not take forever, let's extract first 10 pages for now to test, 
# or all if user wants. We'll do all 40 but process them sequentially.
for i in range(len(doc)):
    page = doc.load_page(i)
    pix = page.get_pixmap(dpi=150)  # 150 DPI is usually enough for OCR
    pix.save(os.path.join(out_dir, f"page_{i}.png"))
    print(f"Saved page {i}")

print("Done extracting images.")
