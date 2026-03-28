import cv2
import os
import json
import numpy as np
from paddleocr import PaddleOCR

def crop_region(img, region):
    h, w = img.shape[:2]
    x1, y1 = int(region["x1"] * w), int(region["y1"] * h)
    x2, y2 = int(region["x2"] * w), int(region["y2"] * h)
    return img[y1:y2, x1:x2]

def extract_ranks_from_crop(ocr, crop, prefix, ranks_dir, collected):
    """Use PaddleOCR to detect rank text from board/showdown card areas."""
    if crop is None or crop.size == 0:
        print(f"  Skipping {prefix}: empty crop")
        return

    results = ocr.ocr(crop, cls=False)
    if not results or not results[0]:
        print(f"  No text detected in {prefix}")
        return

    # Map OCR text to standard rank names
    rank_map = {
        "A": "A", "a": "A",
        "K": "K", "k": "K",
        "Q": "Q", "q": "Q",
        "J": "J", "j": "J",
        "10": "T", "T": "T", "t": "T",
        "9": "9", "8": "8", "7": "7", "6": "6",
        "5": "5", "4": "4", "3": "3", "2": "2",
    }

    for line in results[0]:
        box, (text, confidence) = line
        text = text.strip()

        rank = rank_map.get(text)
        if not rank:
            continue

        # Crop the detected text region
        pts = np.array(box, dtype=np.int32)
        x, y, w, h = cv2.boundingRect(pts)
        rank_crop = crop[y:y+h, x:x+w]

        if rank_crop.size == 0:
            continue

        # Convert to binary: white text on black background
        gray_crop = cv2.cvtColor(rank_crop, cv2.COLOR_BGR2GRAY) if len(rank_crop.shape) == 3 else rank_crop
        _, binary = cv2.threshold(gray_crop, 180, 255, cv2.THRESH_BINARY)

        # Save ALL with unique names: rank_source_idx.png
        idx = len([f for f in os.listdir(ranks_dir) if f.startswith(f"{rank}_")]) 
        out_name = f"{rank}_{prefix}_{idx}.png"
        out_path = os.path.join(ranks_dir, out_name)
        cv2.imwrite(out_path, binary)
        collected.add(rank)
        print(f"    Saved {out_name} (text='{text}', conf={confidence:.2f}, {w}x{h})")


def main():
    templates_dir = os.path.join(os.path.dirname(__file__), "..", "templates")
    ranks_dir = os.path.join(templates_dir, "ranks")
    os.makedirs(ranks_dir, exist_ok=True)

    # Check which ranks already exist
    all_ranks = {"A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"}
    collected = set()
    for f in os.listdir(ranks_dir):
        if f.endswith("_rank.png"):
            label = f.split("_")[0]
            if label in all_ranks:
                collected.add(label)
    if collected:
        print(f"Already have: {sorted(collected)}")
        missing = all_ranks - collected
        if missing:
            print(f"Missing: {sorted(missing)}")
        else:
            print("All 13 ranks already collected!")
            return

    config_path = os.path.join(os.path.dirname(__file__), "..", "layout_config.json")
    with open(config_path, "r") as f:
        config = json.load(f)

    layout = next((l for l in config["layouts"] if l["name"] == "PC"), None)
    if not layout:
        print("Error: PC layout not found")
        return

    regions = layout["regions"]
    base_dir = os.path.join(os.path.dirname(__file__), "..")

    print("Initializing PaddleOCR...")
    ocr = PaddleOCR(use_angle_cls=False, lang="en", show_log=False)

    screenshots = [
        
        "ocr3.png",
    ]

    crop_regions = ["board_cards", "showdown_area"]

    for img_file in screenshots:
        if collected == all_ranks:
            print("\nAll 13 ranks collected!")
            break

        img_path = os.path.join(base_dir, img_file)
        if not os.path.exists(img_path):
            print(f"Skipping {img_file}: not found")
            continue

        img = cv2.imread(img_path)
        if img is None:
            print(f"Skipping {img_file}: could not load")
            continue

        print(f"\nProcessing {img_file} ({img.shape[1]}x{img.shape[0]})")
        for region_name in crop_regions:
            if collected == all_ranks:
                break
            if region_name not in regions:
                continue
            crop = crop_region(img, regions[region_name])
            # Save debug crop
            debug_dir = os.path.join(base_dir, "debug_crops")
            os.makedirs(debug_dir, exist_ok=True)
            debug_name = f"{os.path.splitext(img_file)[0]}_{region_name}.png"
            cv2.imwrite(os.path.join(debug_dir, debug_name), crop)
            print(f"  Saved debug crop: debug_crops/{debug_name} ({crop.shape[1]}x{crop.shape[0]})")
            extract_ranks_from_crop(ocr, crop, f"{os.path.splitext(img_file)[0]}_{region_name}", ranks_dir, collected)

    print(f"\n{'='*50}")
    print(f"Collected ranks: {sorted(collected)} ({len(collected)}/13)")
    missing = all_ranks - collected
    if missing:
        print(f"Missing: {sorted(missing)}")
    else:
        print("ALL 13 RANKS COLLECTED!")
    print(f"Saved to: {os.path.abspath(ranks_dir)}")
    print(f"Suits folder NOT touched.")


if __name__ == "__main__":
    main()
