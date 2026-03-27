import cv2
import sys
import os
import numpy as np

sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from engine import LayoutEngine, CardDetector

def main():
    base_dir = os.path.join(os.path.dirname(__file__), "..")
    img_path = os.path.join(base_dir, "ocr2.png")
    
    img = cv2.imread(img_path)
    layout_engine = LayoutEngine(os.path.join(base_dir, "layout_config.json"))
    card_detector = CardDetector(os.path.join(base_dir, "templates"))
    
    match = layout_engine.match_layout(img)
    if not match:
        print("Layout match failed.")
        return
        
    layout = match[0]
    action_log_rect = layout['regions']['action_log']
    action_img = layout_engine.crop_region(img, action_log_rect)
    
    # We also want to only look at the right side of the action_img (river col)
    # to avoid false positives in chat area.
    ah, aw = action_img.shape[:2]
    action_img = action_img[:, int(aw*0.6):]
    
    gray = cv2.cvtColor(action_img, cv2.COLOR_BGR2GRAY)
    ranks = card_detector._detect_symbols(gray, card_detector.rank_templates, threshold=0.7, binarize=True, scales=[0.5, 0.6])
    
    out_dir = os.path.join(base_dir, "debug_crops", "auto_suits")
    os.makedirs(out_dir, exist_ok=True)
    
    for i, r in enumerate(ranks):
        r_label = r['label']
        x, y, w, h = r['x'], r['y'], r['w'], r['h']
        
        # In showdown cards, suit is right below rank
        suit_y1 = y + h - 2
        suit_y2 = y + h + int(h * 1.5)
        suit_x1 = x - 4
        suit_x2 = x + w + 4
        
        # Clamp
        h_img, w_img = action_img.shape[:2]
        suit_y1 = max(0, suit_y1)
        suit_y2 = min(h_img, suit_y2)
        suit_x1 = max(0, suit_x1)
        suit_x2 = min(w_img, suit_x2)
        
        suit_crop = gray[suit_y1:suit_y2, suit_x1:suit_x2]
        
        if suit_crop.size == 0: continue
        
        # Otsu threshold it
        _, binary = cv2.threshold(suit_crop, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        white_ratio = np.sum(binary == 255) / binary.size
        if white_ratio > 0.5:
             binary = cv2.bitwise_not(binary)
             
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours: continue
        
        c = max(contours, key=cv2.contourArea)
        cx, cy, cw, ch = cv2.boundingRect(c)
        if cw < 6 or ch < 6: continue
        
        # Add 1px padding
        binary_padded = np.zeros((ch+2, cw+2), dtype=np.uint8)
        binary_padded[1:1+ch, 1:1+cw] = binary[cy:cy+ch, cx:cx+cw]
        
        out_path = os.path.join(out_dir, f"{i}_{r_label}_suit.png")
        cv2.imwrite(out_path, binary_padded)
        print(f"Saved {out_path}")

if __name__ == '__main__':
    main()
