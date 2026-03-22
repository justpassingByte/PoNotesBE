import sys
import os
import cv2
import numpy as np
import base64
import json
import logging

# Add current dir to path to import local modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from tasks import process_hand, apply_feedback

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

def run_real_test(image_path, label):
    logger.info(f"\n--- Testing REAL IMAGE: {label} ({image_path}) ---")
    
    if not os.path.exists(image_path):
        logger.error(f"Image not found: {image_path}")
        return

    # 1. Read and Convert to Data URL (Base64)
    with open(image_path, "rb") as f:
        img_bytes = f.read()
    img_b64 = base64.b64encode(img_bytes).decode('utf-8')
    image_hash = "test_hash_" + label.lower()

    # 2. Run initial OCR detection
    logger.info(f"1. Running process_hand for {label}...")
    # process_hand(image_hex, image_hash)
    # image_hex can be actual hex or base64 (my tasks.py now handles both)
    result = process_hand(img_b64, image_hash)
    
    if result.get("status") == "error":
        logger.error(f"OCR Fail: {result.get('error')}")
        return

    board = result.get('data', {}).get('board', [])
    decision = result.get('decision')
    conf = result.get('confidence', {}).get('total', 0)
    
    logger.info(f"RESULT: Board={board} | Decision={decision} | Conf={conf:.2f}")
    if result.get('decision_reason'):
        logger.info(f"REASONS: {result['decision_reason']}")

    # 3. Test Feedback - Confirm All
    logger.info(f"2. Simulating User 'Confirm All' for {label}...")
    fb_res = apply_feedback(
        image_hex=img_b64,
        card_name="all_board",
        action="confirm"
    )
    logger.info(f"Feedback Result: {fb_res}")

    # 4. Test Feedback - Manual Edit of first card
    if board and len(board) > 0:
        first_card = board[0]
        logger.info(f"3. Simulating User 'Edit' for {first_card} -> 'As'...")
        edit_res = apply_feedback(
            image_hex=img_b64,
            card_name=first_card,
            action="edit",
            corrected_name="As"
        )
        logger.info(f"Edit Result: {edit_res}")

def main():
    # Make sure we have a clean dummy config if needed
    # But usually, the real one in ocr-service is better.
    
    run_real_test("ocrtest.png", "PC_DESKTOP")
    run_real_test("ocrtest2.png", "MOBILE")

if __name__ == "__main__":
    main()
