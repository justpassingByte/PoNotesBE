"""
Manual rank extraction: Precisely crops rank characters from board cards.
Produces binary templates (white char on black bg) matching existing templates.

Board in ocr1.png: J♣  7♣  7♥  10♦  K♠
Contour data from first pass:
  Card 0(J):  ~x=62, y=47, w=89, h=125
  Card 1(7):  x=163, y=47, w=89, h=125
  Card 2(7):  x=264, y=47, w=89, h=125
  Card 3(10): x=366, y=47, w=88, h=124
  Card 4(K):  x=467, y=47, w=91, h=125  (but 10 is at 467, K at 568)
Actually let me re-check with contours.
"""
import cv2
import numpy as np
import os

def extract_rank_char(card_img, debug_path=None):
    """
    From a single card image, extract just the rank character
    from the top-left corner. Returns binary white-on-black image.
    """
    h, w = card_img.shape[:2]
    
    # Rank character is in the top-left of the card
    # Typically top ~40% height, left ~45% width
    rank_region = card_img[0:int(h*0.42), 0:int(w*0.50)]
    
    if debug_path:
        cv2.imwrite(debug_path.replace('.png', '_region.png'), rank_region)
    
    # Convert to grayscale
    gray = cv2.cvtColor(rank_region, cv2.COLOR_BGR2GRAY) if len(rank_region.shape) == 3 else rank_region
    
    # The rank text is white/light on colored card background
    # Use Otsu threshold to separate
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    
    if debug_path:
        cv2.imwrite(debug_path.replace('.png', '_otsu.png'), binary)
    
    # Determine if we need to invert (rank should be white, bg black)
    # The rank character is smaller than the background, so the minority color is the text
    white_ratio = np.sum(binary == 255) / binary.size
    if white_ratio > 0.5:
        binary = cv2.bitwise_not(binary)
    
    if debug_path:
        cv2.imwrite(debug_path.replace('.png', '_corrected.png'), binary)
    
    # Find the bounding box of the rank character via contours
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    
    # Filter: rank chars should be reasonably sized
    valid = []
    for c in contours:
        x, y, cw, ch = cv2.boundingRect(c)
        # Rank char should be at least 8px and not tiny noise
        if cw >= 6 and ch >= 10:
            valid.append((x, y, cw, ch))
    
    if not valid:
        return None
    
    # Merge all valid contours into one bounding box (handles multi-part chars like 10)
    x_min = min(v[0] for v in valid)
    y_min = min(v[1] for v in valid)
    x_max = max(v[0] + v[2] for v in valid)
    y_max = max(v[1] + v[3] for v in valid)
    
    # Add small padding
    pad = 2
    x_min = max(0, x_min - pad)
    y_min = max(0, y_min - pad)
    x_max = min(binary.shape[1], x_max + pad)
    y_max = min(binary.shape[0], y_max + pad)
    
    char_crop = binary[y_min:y_max, x_min:x_max]
    
    if debug_path:
        cv2.imwrite(debug_path, char_crop)
    
    return char_crop


def main():
    base_dir = os.path.join(os.path.dirname(__file__), "..")
    img_path = os.path.join(base_dir, "ocr1.png")
    ranks_dir = os.path.join(base_dir, "templates", "ranks")
    debug_dir = os.path.join(base_dir, "debug_crops")
    os.makedirs(debug_dir, exist_ok=True)
    os.makedirs(ranks_dir, exist_ok=True)

    img = cv2.imread(img_path)
    if img is None:
        print(f"Error: Could not load {img_path}")
        return

    h, w = img.shape[:2]
    print(f"Image size: {w}x{h}")

    # PC layout board_cards region
    bx1, by1 = int(0.18 * w), int(0.11 * h)
    bx2, by2 = int(0.82 * w), int(0.22 * h)
    board = img[by1:by2, bx1:bx2]
    bh, bw = board.shape[:2]
    print(f"Board crop: {bw}x{bh}")
    
    # Find individual card contours
    gray_board = cv2.cvtColor(board, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray_board, 50, 150)
    
    # Dilate to connect edges
    kernel = np.ones((3, 3), np.uint8)
    dilated = cv2.dilate(edges, kernel, iterations=2)
    
    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    # Filter for card-sized rectangles (approx 80-100px wide, 110-140px tall)
    card_rects = []
    for c in contours:
        x, y, cw, ch = cv2.boundingRect(c)
        if 60 <= cw <= 150 and 80 <= ch <= 180:
            card_rects.append((x, y, cw, ch))
    
    card_rects.sort(key=lambda r: r[0])  # Sort left to right
    
    print(f"\nDetected {len(card_rects)} card-sized rectangles:")
    for i, (x, y, cw, ch) in enumerate(card_rects):
        print(f"  Card {i}: x={x}, y={y}, w={cw}, h={ch}")
    
    # Map: index -> rank label (what we know from the image)
    # Board: J♣  7♣  7♥  10♦  K♠
    card_labels = ["J", "7", "7", "T", "K"]
    
    # Need: J, 7, K (we already have T)
    needed = {"J", "7", "K"}
    
    if len(card_rects) < 5:
        print(f"\nWARNING: Expected 5 cards, found {len(card_rects)}")
        print("Falling back to manual positions based on first-pass contour data")
        # Use positions from first debug run
        card_rects = [
            (62, 47, 89, 125),   # J
            (163, 47, 89, 125),  # 7
            (264, 47, 89, 125),  # 7
            (366, 47, 88, 124),  # 10
            (467, 47, 91, 125),  # K - wait, contours showed 467 and 568
        ]
        # Actually from contours: 163, 264, 366, 467, 568
        # So card 0 should be around x=62 (163-101)
        card_rects = [
            (62, 47, 89, 125),   # J (estimated)
            (163, 47, 89, 125),  # 7
            (264, 47, 89, 125),  # 7
            (366, 47, 88, 124),  # 10
            (568, 47, 88, 125),  # K
        ]
    
    # Get reference size from existing A_rank.png
    a_ref = cv2.imread(os.path.join(ranks_dir, "A_rank.png"), cv2.IMREAD_GRAYSCALE)
    ref_h, ref_w = a_ref.shape[:2] if a_ref is not None else (51, 28)
    print(f"\nReference rank size (A_rank): {ref_w}x{ref_h}")
    
    saved = []
    for i, (x, y, cw, ch) in enumerate(card_rects[:5]):
        if i >= len(card_labels):
            break
        label = card_labels[i]
        
        # Crop the individual card from board
        card_img = board[y:y+ch, x:x+cw]
        cv2.imwrite(os.path.join(debug_dir, f"card_{i}_{label}.png"), card_img)
        
        # Extract rank character
        debug_path = os.path.join(debug_dir, f"rank_char_{i}_{label}.png")
        rank_char = extract_rank_char(card_img, debug_path)
        
        if rank_char is None:
            print(f"  Card {i} ({label}): FAILED to extract rank")
            continue
        
        rh, rw = rank_char.shape[:2]
        print(f"  Card {i} ({label}): extracted {rw}x{rh}")
        
        # Resize to match reference template size
        resized = cv2.resize(rank_char, (ref_w, ref_h), interpolation=cv2.INTER_AREA)
        # Re-threshold after resize to keep it clean binary
        _, resized = cv2.threshold(resized, 127, 255, cv2.THRESH_BINARY)
        
        cv2.imwrite(os.path.join(debug_dir, f"rank_final_{i}_{label}.png"), resized)
        
        # Save as template only if needed
        if label in needed:
            # Use first occurrence for 7
            out_name = f"{label}_rank.png"
            out_path = os.path.join(ranks_dir, out_name)
            if not os.path.exists(out_path):
                cv2.imwrite(out_path, resized)
                saved.append(out_name)
                print(f"    -> Saved template: {out_name} ({ref_w}x{ref_h})")
            else:
                print(f"    -> Already exists: {out_name}")
    
    print(f"\n{'='*50}")
    print(f"Saved {len(saved)} new templates: {saved}")
    
    # Verify all ranks now exist
    all_ranks = {"A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"}
    existing = set()
    for f in os.listdir(ranks_dir):
        if f.endswith("_rank.png"):
            existing.add(f.split("_")[0])
    
    missing = all_ranks - existing
    if missing:
        print(f"Still missing: {sorted(missing)}")
    else:
        print("ALL 13 RANKS NOW COMPLETE!")


if __name__ == "__main__":
    main()
