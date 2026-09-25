"""Extract one JSON record per page; OCR empty pages when optional tools exist."""
import json, os, shutil, subprocess, sys, tempfile
from pypdf import PdfReader

pdf_path = sys.argv[1]
tesseract = os.environ.get("EESAN_TESSERACT")
pdftoppm = os.environ.get("EESAN_PDFTOPPM")

def ocr_page(page_number):
    if not (tesseract and pdftoppm and os.path.isfile(tesseract) and os.path.isfile(pdftoppm)):
        return None
    temp_dir = tempfile.mkdtemp(prefix="eesan-ocr-")
    try:
        prefix = os.path.join(temp_dir, "page")
        subprocess.run([pdftoppm, "-f", str(page_number), "-l", str(page_number), "-r", "200", "-png", pdf_path, prefix], check=True, capture_output=True)
        image = prefix + "-" + str(page_number) + ".png"
        return subprocess.run([tesseract, image, "stdout", "-l", "eng"], check=True, capture_output=True, text=True).stdout.strip()
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

reader = PdfReader(pdf_path)
pages = []
for number, page in enumerate(reader.pages, start=1):
    text = (page.extract_text() or "").strip()
    source = "pdf" if text else "needs_ocr"
    if not text:
        text = ocr_page(number) or ""
        if text: source = "ocr"
    pages.append({"pageNumber": number, "text": text, "textSource": source})

print(json.dumps({"pageCount": len(pages), "ocrAvailable": bool(tesseract and pdftoppm), "pages": pages}))

