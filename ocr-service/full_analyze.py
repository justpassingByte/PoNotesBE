import cv2
import numpy as np
import json
from paddleocr import PaddleOCR

def analyze_full_screenshot(img_path="ocrtestMain.png"):
    ocr = PaddleOCR(use_angle_cls=False, lang='ch', show_log=False)
    img = cv2.imread(img_path)
    h, w = img.shape[:2]
    
    results = ocr.ocr(img, cls=False)
    
    print(f"Image Size: {w}x{h}")
    print("\n--- OCR Text Locations ---")
    for res in results[0]:
        text = res[1][0]
        conf = res[1][1]
        box = res[0]
        y_min = min(p[1] for p in box)
        y_max = max(p[1] for p in box)
        x_min = min(p[0] for p in box)
        x_max = max(p[0] for p in box)
        
        # Look for key markers
        if any(kw in text.lower() for kw in ["total pot", "hand id", "blind", "pre-flop", "flop", "turn", "river"]):
            print(f"[{text}] y={y_min:.1f}-{y_max:.1f}, x={x_min:.1f}-{x_max:.1f} (conf={conf:.2f})")
            
    # Also look for card-like contours in the board area (approx y=200-300)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    print("\n--- Card Candidate Contours ---")
    for c in contours:
        x, y, cw, ch = cv2.boundingRect(c)
        if 40 < cw < 150 and 60 < ch < 200:
            print(f"  Rect: {cw}x{ch} at ({x}, {y}) aspect={cw/ch:.2f}")

if __name__ == "__main__":
    analyze_full_screenshot()
