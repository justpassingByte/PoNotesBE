import cv2
import os
import argparse
import numpy as np

def grab_wpt_templates(image_path, output_dir="templates"):
    """
    Auto-extracts snippets from a WPT Global screenshot to populate anchor/card templates.
    Optimized for 2K (2060x1427) or 1080p scaled.
    """
    img = cv2.imread(image_path)
    if img is None:
        print(f"Error: Could not read {image_path}")
        return

    h, w = img.shape[:2]
    print(f"Calibrating Templates for {image_path} ({w}x{h})...")

    # 1. 'Tổng Pot' Anchor - WIDENED LEFT to catch the text
    # In WPT, 'Tổng Pot' label starts earlier
    ay1, ay2 = int(0.12 * h), int(0.17 * h)
    ax1, ax2 = int(0.25 * w), int(0.55 * w) # Wide enough to catch the whole bar
    anchor = img[ay1:ay2, ax1:ax2]
    
    cv2.imwrite(os.path.join(output_dir, "anchors/wpt_pot_label.png"), anchor)
    print(f"Saved: anchors/wpt_pot_label.png ({anchor.shape})")

    # 2. Card 9d - WIDENED to avoid clipping
    cy1, cy2 = int(0.19 * h), int(0.32 * h)
    cx1, cx2 = int(0.21 * w), int(0.30 * w) # Wider
    
    card_9d = img[cy1:cy2, cx1:cx2]
    cv2.imwrite(os.path.join(output_dir, "cards/9d_sample.png"), card_9d)
    print(f"Saved: cards/9d_sample.png ({card_9d.shape})")

    # 3. Suit Diamond color snippet (from center of card)
    # Using a 30x30 snippet from the middle
    ch, cw = card_9d.shape[:2]
    s_dia = card_9d[int(0.3*ch):int(0.6*ch), int(0.2*cw):int(0.5*cw)]
    cv2.imwrite(os.path.join(output_dir, "cards/suit_diamond.png"), s_dia)
    print("Saved Calibrated Snippets.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--img", required=True, help="Path to input image")
    args = parser.parse_args()

    os.makedirs("templates/anchors", exist_ok=True)
    os.makedirs("templates/cards", exist_ok=True)
    
    grab_wpt_templates(args.img)
