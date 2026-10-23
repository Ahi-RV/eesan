"""Extract positioned text from PDFs and OCR JPG/JPEG engineering drawings."""
import csv, io, json, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image, ImageOps
from pypdf import PdfReader
import pdfplumber

source_path = sys.argv[1]
extension = Path(source_path).suffix.lower()
tesseract = os.environ.get("EESAN_TESSERACT")
pdftoppm = os.environ.get("EESAN_PDFTOPPM")
force_ocr = os.environ.get("EESAN_FORCE_OCR") == "1"
tesseract_ready = bool(tesseract and os.path.isfile(tesseract))

def detected_manholes(text):
    return list(dict.fromkeys(re.sub(r"[\s:._]+", "", value.upper()) for value in re.findall(r"\b(?:MH|MANHOLE)[\s:._-]*\d{2,}\b", text, re.I)))

def ocr_image(image_path, psm=None, minimum_confidence=0):
    if not tesseract_ready:
        return "", []
    process = subprocess.run(
        [tesseract, image_path, "stdout", "-l", "eng"] + (["--psm", str(psm)] if psm else []) + ["tsv"],
        check=True, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    words = []
    for row in csv.DictReader(io.StringIO(process.stdout), delimiter="\t"):
        text = (row.get("text") or "").strip()
        if not text:
            continue
        if float(row.get("conf", -1)) < minimum_confidence:
            continue
        try:
            left, top = float(row["left"]), float(row["top"])
            width, height = float(row["width"]), float(row["height"])
        except (TypeError, ValueError):
            continue
        words.append({"text": text, "x0": left, "x1": left + width, "top": top, "bottom": top + height})
    return " ".join(word["text"] for word in words), words

def page_record(number, text, source, width, height, words):
    return {
        "pageNumber": number, "text": text, "textSource": source,
        "pageWidth": width, "pageHeight": height, "words": words,
        "drawingTypes": [], "classificationStatus": "pending",
        "detectedManholeNumbers": detected_manholes(text)
    }

def extract_image():
    with Image.open(source_path) as image:
        width, height = image.size
    text, words = ocr_image(source_path)
    # Photographed cards often have their only useful label below the diagram.
    if not text and tesseract_ready:
        with tempfile.TemporaryDirectory(prefix="mandresh-card-ocr-") as directory:
            with Image.open(source_path) as image:
                top = int(height * .88)
                strip = ImageOps.autocontrast(image.crop((0, top, width, height)).convert("L"))
                strip_path = os.path.join(directory, "label.png")
                strip.save(strip_path)
            text, words = ocr_image(strip_path, psm=6, minimum_confidence=85)
            for word in words:
                word["top"] += top
                word["bottom"] += top
    return {"pageCount": 1, "ocrAvailable": tesseract_ready,
            "pages": [page_record(1, text, "ocr" if text else "needs_ocr", width, height, words)]}

def ocr_pdf_page(page_number, page_width=None, page_height=None):
    if not (tesseract_ready and pdftoppm and os.path.isfile(pdftoppm)):
        return "", [], False
    temp_dir = tempfile.mkdtemp(prefix="eesan-ocr-")
    try:
        prefix = os.path.join(temp_dir, "page")
        subprocess.run([pdftoppm, "-f", str(page_number), "-l", str(page_number), "-r", "200", "-png", "-singlefile", source_path, prefix], check=True, capture_output=True)
        with Image.open(prefix + ".png") as image:
            image_width, image_height = image.size
            extrema = image.convert("L").getextrema()
            blank = extrema[0] >= 250
        text, words = ocr_image(prefix + ".png")
        if page_width and page_height:
            for word in words:
                for key in ("x0", "x1"):
                    word[key] *= page_width / image_width
                for key in ("top", "bottom"):
                    word[key] *= page_height / image_height
        return text, words, blank
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

def extract_pdf():
    reader = PdfReader(source_path)
    pages = []
    with pdfplumber.open(source_path) as plumber:
        for number, (page, visual_page) in enumerate(zip(reader.pages, plumber.pages), start=1):
            text, words, source, extraction_error = "", [], "pdf", None
            if not force_ocr:
                try:
                    text = (page.extract_text() or "").strip()
                    words = [{"text": word["text"], "x0": word["x0"], "x1": word["x1"], "top": word["top"], "bottom": word["bottom"]} for word in visual_page.extract_words()]
                except Exception as error:
                    # Complex/oversized content streams must not prevent raster OCR.
                    extraction_error = f"{type(error).__name__}: {error}"
                    text, words = "", []
            if force_ocr or not text or extraction_error:
                ocr_text, ocr_words, blank = ocr_pdf_page(number, visual_page.width, visual_page.height)
                if ocr_text:
                    text, words, source = ocr_text, ocr_words, "ocr"
                elif not text:
                    source = "blank" if blank else "needs_ocr"
            pages.append(page_record(number, text, source, visual_page.width, visual_page.height, words))
            if extraction_error:
                pages[-1]["extractionWarning"] = extraction_error
            visual_page.close()
    return {"pageCount": len(pages), "ocrAvailable": bool(tesseract_ready and pdftoppm), "pages": pages}

if extension in (".jpg", ".jpeg"):
    result = extract_image()
elif extension == ".pdf":
    result = extract_pdf()
else:
    raise SystemExit("Unsupported document format: " + extension)

# Retain reviewed, source-backed transcriptions across future reindexing.
# Never represent manually reviewed labels as successful OCR output.
review_file = Path(__file__).resolve().parent.parent / "data" / "reviewed-page-text.json"
root_folder = os.environ.get("EESAN_ROOT")
if review_file.exists() and root_folder:
    try:
        relative = Path(source_path).resolve().relative_to(Path(root_folder).resolve()).as_posix()
        reviewed = json.loads(review_file.read_text(encoding="utf-8")).get(relative, {})
        for page in result["pages"]:
            correction = reviewed.get(str(page["pageNumber"]))
            if correction and page["textSource"] == "needs_ocr":
                page["text"] = correction["text"]
                page["textSource"] = "reviewed"
                page["reviewNote"] = correction["note"]
                page["reviewedAt"] = correction["reviewedAt"]
                page["detectedManholeNumbers"] = detected_manholes(page["text"])
    except (ValueError, OSError, json.JSONDecodeError):
        pass

print(json.dumps(result))
