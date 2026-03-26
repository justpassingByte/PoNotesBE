"""
Extract board-sized suit symbols using detected rank positions as anchors.
Since rank templates already match reliably, we use rank positions to find
exactly where each card is, then crop the large suit symbol below it.
"""
import cv2
import os
import json
import numpy as np

def crop_region(img, region):
    h, w = img.shape[:2]
    x1, y1 = int(region["x1"] * w), int(region["y1"] * h)
    x2, y2 = int(region["x2"] * w), int(region["y2"] * h)
    return img[y1:y2, x1:x2]

def match_ranks(gray, ranks_dir, threshold=0.7):
    """Find rank positions using multi-scale template matching."""
    _, binary = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY)
    binary_inv = cv2.bitwise_not(binary)
    
    results = []
    for f in os.listdir(ranks_dir):
        if not f.endswith('.png'):
            continue
        tmpl_orig = cv2.imread(os.path.join(ranks_dir, f), 0)
        if tmpl_orig is None:
            continue
        label = f.split('_')[0]
        
        # Try multiple scales to handle different image resolutions
        for scale in [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.5]:
            tmpl = cv2.resize(tmpl_orig, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
            th, tw = tmpl.shape[:2]
            if th < 5 or tw < 5:
                continue
            
            for search_img in [binary, binary_inv]:
                if th > search_img.shape[0] or tw > search_img.shape[1]:
                    continue
                res = cv2.matchTemplate(search_img, tmpl, cv2.TM_CCOEFF_NORMED)
                loc = np.where(res >= threshold)
                for pt in zip(*loc[::-1]):
                    score = float(res[pt[1], pt[0]])
                    results.append({
                        'label': label, 'score': score,
                        'x': pt[0], 'y': pt[1], 'w': tw, 'h': th,
                        'scale': scale
                    })
    
    # NMS
    results.sort(key=lambda x: x['score'], reverse=True)
    keep = []
    for det in results:
        overlap = False
        for k in keep:
            if abs(det['x'] - k['x']) < 30 and abs(det['y'] - k['y']) < 30:
                overlap = True
                break
        if not overlap:
            keep.append(det)
    
    keep.sort(key=lambda x: x['x'])
    return keep


def extract_suits_from_ranks(board_crop, ranks, suits_dir, counter):
    """For each detected rank, crop the suit symbol below it."""
    gray = cv2.cvtColor(board_crop, cv2.COLOR_BGR2GRAY)
    bh, bw = board_crop.shape[:2]
    
    for i, rank in enumerate(ranks):
        # The rank is at the top-left of the card.
        # The large center suit is roughly:
        #   - Horizontally: centered on the card (rank_x to rank_x + card_width)
        #   - Vertically: starts about 1.2x rank height below rank top, extends ~2x rank height
        rx, ry, rw, rh = rank['x'], rank['y'], rank['w'], rank['h']
        
        # Estimate card center X from rank position
        card_cx = rx + rw // 2
        
        # Suit crop: below the rank, centered on card
        suit_w = int(rw * 2.5)  # Suit symbol is wider than rank text
        suit_h = int(rh * 2.0)  # And taller
        suit_x1 = max(0, card_cx - suit_w // 2)
        suit_x2 = min(bw, card_cx + suit_w // 2)
        suit_y1 = min(bh, ry + int(rh * 1.3))  # Start below rank
        suit_y2 = min(bh, suit_y1 + suit_h)
        
        suit_crop = gray[suit_y1:suit_y2, suit_x1:suit_x2]
        if suit_crop.size == 0:
            continue
        
        # Binarize
        _, binary = cv2.threshold(suit_crop, 180, 255, cv2.THRESH_BINARY)
        
        # Find biggest contour = the suit symbol
        conts, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not conts:
            _, binary = cv2.threshold(suit_crop, 150, 255, cv2.THRESH_BINARY)
            conts, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        if conts:
            biggest = max(conts, key=cv2.contourArea)
            sx, sy, sw, sh = cv2.boundingRect(biggest)
            
            if sw > 8 and sh > 8:
                suit_img = binary[sy:sy+sh, sx:sx+sw]
                out_path = os.path.join(suits_dir, f"board_{counter}_suit.png")
                cv2.imwrite(out_path, suit_img)
                print(f"    Rank '{rank['label']}' at ({rx},{ry}) -> board_{counter}_suit.png ({sw}x{sh})")
                counter += 1
            else:
                print(f"    Rank '{rank['label']}' at ({rx},{ry}) -> suit too small ({sw}x{sh}), skipped")
        else:
            print(f"    Rank '{rank['label']}' at ({rx},{ry}) -> no suit contour found")
    
    return counter


def main():
    templates_dir = os.path.join(os.path.dirname(__file__), "..", "templates")
    ranks_dir = os.path.join(templates_dir, "ranks")
    suits_dir = os.path.join(templates_dir, "suits")
    os.makedirs(suits_dir, exist_ok=True)
    
    # Clean old board_ suit files
    for f in os.listdir(suits_dir):
        if f.startswith("board_") and f.endswith(".png"):
            os.remove(os.path.join(suits_dir, f))
    
    config_path = os.path.join(os.path.dirname(__file__), "..", "layout_config.json")
    with open(config_path, "r") as f:
        config = json.load(f)
    
    base_dir = os.path.join(os.path.dirname(__file__), "..")
    
    screenshots = ["ocrtestMain.png", "ocrtest4.png", "ocr1.png", "ocr2.png", "ocr3.png"]
    counter = 0
    
    for img_file in screenshots:
        img_path = os.path.join(base_dir, img_file)
        if not os.path.exists(img_path):
            continue
        
        img = cv2.imread(img_path)
        if img is None:
            continue
        
        h, w = img.shape[:2]
        print(f"\nProcessing {img_file} ({w}x{h})")
        
        # Force PC layout for all screenshots
        best_layout = next((l for l in config["layouts"] if l["name"] == "PC"), None)
        if not best_layout:
            print("  PC layout not found, skipping")
            continue
        
        print(f"  Using layout: {best_layout['name']}")
        
        board_region = best_layout["regions"].get("board_cards")
        if not board_region:
            print("  No board_cards region, skipping")
            continue
            
        board_crop = crop_region(img, board_region)
        gray = cv2.cvtColor(board_crop, cv2.COLOR_BGR2GRAY)
        
        # Find rank positions
        ranks = match_ranks(gray, ranks_dir)
        rank_strs = [r['label'] + "@s" + str(r['scale']) for r in ranks]
        print(f"  Found {len(ranks)} rank positions: {rank_strs}")
        
        counter = extract_suits_from_ranks(board_crop, ranks, suits_dir, counter)
    
    print(f"\n{'='*50}")
    print(f"Extracted {counter} board suit crops")
    print(f"Saved to: {os.path.abspath(suits_dir)}")
    print("Rename to: board_heart_suit.png, board_diamond_suit.png, etc.")


if __name__ == "__main__":
    main()
