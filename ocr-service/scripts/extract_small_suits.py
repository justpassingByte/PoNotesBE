"""
Extract small suit symbols from showdown cards in river crop.
Uses rank template positions as anchors, then crops the suit icon below each rank.
"""
import cv2
import numpy as np
import os

def main():
    base = os.path.join(os.path.dirname(__file__), "..")
    suits_dir = os.path.join(base, "templates", "suits")
    ranks_dir = os.path.join(base, "templates", "ranks")
    os.makedirs(suits_dir, exist_ok=True)

    # Clean old small_suit_ files
    for f in os.listdir(suits_dir):
        if f.startswith("small_suit_") and f.endswith(".png"):
            os.remove(os.path.join(suits_dir, f))

    river_path = os.path.join(base, "debug_crops", "layout_river_crop.png")
    if not os.path.exists(river_path):
        print(f"ERROR: {river_path} not found. Run test_pipeline.py first.")
        return

    img = cv2.imread(river_path)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    print(f"River crop: {w}x{h}")

    # Binarize for rank matching
    _, binary = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY)
    binary_inv = cv2.bitwise_not(binary)

    # Find all rank positions at small scales (0.4-0.7)
    rank_hits = []
    for f in sorted(os.listdir(ranks_dir)):
        if not f.endswith('.png'):
            continue
        tmpl = cv2.imread(os.path.join(ranks_dir, f), 0)
        if tmpl is None:
            continue
        label = f.split('_')[0]

        for scale in [0.5, 0.6]:
            t = cv2.resize(tmpl, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            th, tw = t.shape[:2]
            if th < 5 or tw < 5 or th > h or tw > w:
                continue
            for search in [binary, binary_inv]:
                res = cv2.matchTemplate(search, t, cv2.TM_CCOEFF_NORMED)
                loc = np.where(res >= 0.70)
                for pt in zip(*loc[::-1]):
                    score = float(res[pt[1], pt[0]])
                    rank_hits.append({
                        'label': label, 'x': pt[0], 'y': pt[1],
                        'w': tw, 'h': th, 'score': score, 'scale': scale
                    })

    # NMS on rank hits
    rank_hits.sort(key=lambda r: -r['score'])
    kept = []
    for r in rank_hits:
        overlap = False
        for k in kept:
            if abs(r['x'] - k['x']) < 10 and abs(r['y'] - k['y']) < 10:
                overlap = True
                break
        if not overlap:
            kept.append(r)
    
    print(f"Found {len(kept)} rank positions (after NMS)")
    
    # Extract suit below each rank
    counter = 0
    for r in kept:
        # Suit icon is right below the rank text
        suit_y1 = r['y'] + r['h'] - 2  # start at bottom of rank
        suit_h = int(r['h'] * 0.8)  # suit is slightly smaller than rank
        suit_y2 = suit_y1 + suit_h
        suit_x1 = r['x'] - 1
        suit_x2 = r['x'] + r['w'] + 1
        
        suit_y1 = max(0, suit_y1)
        suit_y2 = min(h, suit_y2)
        suit_x1 = max(0, suit_x1)
        suit_x2 = min(w, suit_x2)
        
        suit_crop = gray[suit_y1:suit_y2, suit_x1:suit_x2]
        if suit_crop.size == 0 or suit_crop.shape[0] < 5 or suit_crop.shape[1] < 5:
            continue
        
        out_name = f"small_suit_{counter}_{r['label']}.png"
        cv2.imwrite(os.path.join(suits_dir, out_name), suit_crop)
        print(f"  {out_name} ({suit_crop.shape[1]}x{suit_crop.shape[0]}) rank={r['label']}@({r['x']},{r['y']})")
        counter += 1

    print(f"\nExtracted {counter} small suit crops to {suits_dir}")
    print("Rename best ones to: heart_small.png, diamond_small.png, club_small.png, spade_small.png")

if __name__ == "__main__":
    main()
