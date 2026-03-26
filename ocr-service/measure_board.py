import cv2
import numpy as np

img = cv2.imread("ocrtestMain.png")
h, w = img.shape[:2]

# Board cards region
y1, y2 = int(h*0.085), int(h*0.125)
x1, x2 = int(w*0.15), int(w*0.65)
board_img = img[y1:y2, x1:x2]

gray = cv2.cvtColor(board_img, cv2.COLOR_BGR2GRAY)
# Try adaptive threshold for better results on varying colors
thresh = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 11, 2)
contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

print(f"Board area size: {board_img.shape[1]}x{board_img.shape[0]} at y={y1}-{y2}")
rects = []
for c in contours:
    rx, ry, rw, rh = cv2.boundingRect(c)
    if rw > 30 and rh > 50:
        rects.append((rx, ry, rw, rh))
        print(f"  Card: {rw}x{rh} at ({rx}, {ry})")

cv2.imwrite("debug_board_area_v2.png", board_img)
