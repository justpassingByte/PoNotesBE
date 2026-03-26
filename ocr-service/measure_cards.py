import cv2
import numpy as np

img = cv2.imread("ocrtestMain.png")
h, w = img.shape[:2]

# Action log region y=0.19 to bottom
action_img = img[int(h*0.19):, :]
ah, aw = action_img.shape[:2]

# River column (rightmost)
col_width = aw / 5.0
river_x1 = int(4 * col_width)
river_col = action_img[:, river_x1:]

# Basic contour detection to see what sizes we get for cards
gray = cv2.cvtColor(river_col, cv2.COLOR_BGR2GRAY)
_, thresh = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)
contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

print(f"Detected contours in River column ({river_col.shape[1]}x{river_col.shape[0]}):")
for c in contours:
    x, y, cw, ch = cv2.boundingRect(c)
    if cw > 5 and ch > 5:
        print(f"  Rect: {cw}x{ch} at ({x}, {y}) aspect={cw/ch:.2f}")

cv2.imwrite("debug_river_col.png", river_col)
