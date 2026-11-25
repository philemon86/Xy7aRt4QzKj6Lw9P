"""Optional loopback-only OCR service. Run with python server.py."""
import os
import io
import threading
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from paddleocr import PaddleOCR
import uvicorn

app = FastAPI()
origins = os.environ.get("OCR_ALLOWED_ORIGINS", "http://127.0.0.1:8000,http://localhost:8000").split(",")
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in origins if o.strip()], allow_methods=["POST"], allow_headers=["Content-Type"])
lock = threading.Lock()
engine = None
Image.MAX_IMAGE_PIXELS = 20_000_000

@app.post("/ocr")
def recognize(file: UploadFile = File(...)):
    global engine
    data = file.file.read(10 * 1024 * 1024 + 1)
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "Image too large")
    try:
        with Image.open(io.BytesIO(data)) as source:
            if source.width * source.height > 20_000_000:
                raise ValueError("Too many pixels")
            im = ImageOps.exif_transpose(source).convert("RGB")
            im.thumbnail((1800, 1800))
            img = np.asarray(im)[:, :, ::-1].copy()
    except (ValueError, OSError, Image.DecompressionBombError):
        raise HTTPException(400, "Invalid image")
    with lock:
        if engine is None:
            engine = PaddleOCR(lang="chinese_cht", ocr_version="PP-OCRv5", device="cpu", use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=True)
        lines = []
        for item in engine.predict(img):
            for line, score in zip(item["rec_texts"], item["rec_scores"]):
                if float(score) >= 0.35:
                    lines.append(str(line))
    return {"text": "\n".join(lines), "engine": "PP-OCRv5"}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765)
