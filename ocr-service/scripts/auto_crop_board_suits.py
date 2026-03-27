import cv2
import sys
import os
import numpy as np

sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from engine import LayoutEngine, CardDetector

def main():
    base_dir = os.path.join(os.path.dirname(__file__), "..")
    img_path = os.path.join(base_dir, "ocr6.png") # ocr6 has club on board
    
    img = cv2.imread(img_path)
    layout_engine = LayoutEngine(os.path.join(base_dir, "layout_config.json"))
    card_detector = CardDetector(os.path.join(base_dir, "templates"))
    
    match = layout_engine.match_layout(img)
    if not match:
        print("Layout match failed.")
        return
        
    layout = match[0]
    board_rect = layout['regions']['board_cards']
    board_img = layout_engine.crop_region(img, board_rect)
    
    gray = cv2.cvtColor(board_img, cv2.COLOR_BGR2GRAY)
    
    # Use larger scales suitable for board cards
    ranks = card_detector._detect_symbols(gray, card_detector.rank_templates, threshold=0.7, binarize=True, scales=[1.0, 1.1])
    
    out_dir = os.path.join(base_dir, "debug_crops", "auto_board_suits")
    os.makedirs(out_dir, exist_ok=True)
    
    # Sort ranks left-to-right to easily match with what we see
    ranks.sort(key=lambda r: r['x'])
    
    for i, r in enumerate(ranks):
        r_label = r['label']
        x, y, w, h = r['x'], r['y'], r['w'], r['h']
        
        # In board cards, suit is right below rank, usually wider and taller
        suit_y1 = y + h - 5
        suit_y2 = y + h + int(h * 1.8)
        suit_x1 = x - 10
        suit_x2 = x + w + 10
        
        # Clamp
        h_img, w_img = board_img.shape[:2]
        suit_y1 = max(0, suit_y1)
        suit_y2 = min(h_img, suit_y2)
        suit_x1 = max(0, suit_x1)
        suit_x2 = min(w_img, suit_x2)
        
        suit_crop = gray[suit_y1:suit_y2, suit_x1:suit_x2]
        
        if suit_crop.size == 0: continue
        
        # Otsu threshold it
        _, binary = cv2.threshold(suit_crop, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        white_ratio = np.sum(binary == 255) / binary.size
        # The background of the card is white, so in OTSU, card bg becomes White (255)
        # We want the symbol to be White, so we need to INVERT it
        if white_ratio > 0.5:
             binary = cv2.bitwise_not(binary)
             
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours: continue
        
        c = max(contours, key=cv2.contourArea)
        cx, cy, cw, ch = cv2.boundingRect(c)
        if cw < 10 or ch < 10: continue
        
        # Add 2px padding for board suits
        binary_padded = np.zeros((ch+4, cw+4), dtype=np.uint8)
        binary_padded[2:2+ch, 2:2+cw] = binary[cy:cy+ch, cx:cx+cw]
        
        out_path = os.path.join(out_dir, f"{i}_{r_label}_board_suit.png")
        cv2.imwrite(out_path, binary_padded)
        print(f"Saved {out_path}")

if __name__ == '__main__':
    main()
