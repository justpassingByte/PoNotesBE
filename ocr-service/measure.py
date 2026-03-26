import cv2
import numpy as np

img = cv2.imread("ocrtestMain.png")
h, w = img.shape[:2]
print(f"Image: {w}x{h}, ratio={w/h:.4f}")

# Let me check key Y coordinates by looking at horizontal bands
# Table ends / action log begins at the header row (BLINDS & ANTE, PRE-FLOP, etc.)
# By visual inspection:
# - Hand ID bar: y=0-20 
# - Table (poker felt): y=20 ~ 440
# - Timestamp: y=428-445
# - Action log header: y=460-500
# - Action log body: y=500 to bottom

# Key measurements (pixel -> ratio):
print(f"\n--- Key Y ratios ---")
for py in [20, 100, 190, 215, 265, 350, 410, 440, 460, 500, 1200]:
    print(f"  y={py}px -> {py/h:.4f}")

print(f"\n--- Key X ratios ---")
for px in [0, 160, 320, 480, 640, 800, 960, 1120, 1280]:
    print(f"  x={px}px -> {px/w:.4f}")

# Verify board card positions
# Board cards appear at roughly y=200-260, x=235-580
print(f"\n--- Board cards region ---")
print(f"  x1={235/w:.3f}, y1={200/h:.4f}")
print(f"  x2={580/w:.3f}, y2={265/h:.4f}")

# Action log region
print(f"\n--- Action log region ---")
print(f"  header y={460/h:.4f}")
print(f"  body start y={475/h:.4f}")

# Pot area  
print(f"\n--- Pot area ---")
print(f"  'Total pot' at roughly y={185/h:.4f} to {200/h:.4f}")

# River column (rightmost column with player hands)
print(f"\n--- River column ---")
print(f"  x from ~{660/w:.3f} to ~{800/w:.3f} (right edge)")
