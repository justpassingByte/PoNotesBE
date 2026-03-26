import cv2
import sys
from engine import CardDetector

detector = CardDetector("templates")
img = cv2.imread("ocrtestMain.png")

# Crop the same as action_parser does for the river column
bh, bw = img.shape[:2]
action_x = int(bw * 0.45)
river_x = int(bw * 0.65)
river_crop = img[:, river_x:]

# Save river crop to check what it looks like
cv2.imwrite("debug_river_crop.png", river_crop)

# Run detection
rects = detector._detect_card_rects(river_crop)
print(f"Detected {len(rects)} card rects")
for i, rect in enumerate(rects):
    x, y, w, h = rect['x'], rect['y'], rect['w'], rect['h']
    print(f"Rect {i}: {w}x{h} at x={x}, y={y}")
    card_img = river_crop[y:y+h, x:x+w]
    cv2.imwrite(f"debug_river_rect_{i}.png", card_img)

# Also dump the raw threshold to see why clubs fail
scale = 1.5
upscaled = cv2.resize(river_crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
gray = cv2.cvtColor(upscaled, cv2.COLOR_BGR2GRAY)
thresh = cv2.adaptiveThreshold(
    gray, 255,
    cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv2.THRESH_BINARY, 15, -5
)
cv2.imwrite("debug_thresh.png", thresh)

contours, _ = cv2.findContours(thresh, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
out_img = upscaled.copy()
for i, c in enumerate(contours):
    x, y, w, h = cv2.boundingRect(c)
    aspect = w / float(h)
    # The filter logic
    if w >= 25 and w <= 80 and h >= 40 and h <= 120 and 0.6 <= aspect <= 0.85:
        cv2.rectangle(out_img, (x, y), (x + w, y + h), (0, 255, 0), 2)
    else:
        cv2.rectangle(out_img, (x, y), (x + w, y + h), (0, 0, 255), 1)
cv2.imwrite("debug_contours.png", out_img)

