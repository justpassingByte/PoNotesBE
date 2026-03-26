import cv2
import json
import os

def debug_crops(img_path="ocrtestMain.png", layout_name="PC"):
    if not os.path.exists(img_path):
        print(f"Error: {img_path} not found")
        return

    img = cv2.imread(img_path)
    h, w = img.shape[:2]

    with open("layout_config.json", "r") as f:
        config = json.load(f)

    layout = next((l for l in config["layouts"] if l["name"] == layout_name), None)
    if not layout:
        print(f"Error: Layout {layout_name} not found")
        return

    regions = layout["regions"]
    for name, reg in regions.items():
        if isinstance(reg, dict) and "x1" in reg:
            x1, y1 = int(reg["x1"] * w), int(reg["y1"] * h)
            x2, y2 = int(reg["x2"] * w), int(reg["y2"] * h)
            crop = img[y1:y2, x1:x2]
            out_path = f"debug_crop_{name}.png"
            cv2.imwrite(out_path, crop)
            print(f"Saved {out_path}: {crop.shape[1]}x{crop.shape[0]} (y={y1}-{y2}, x={x1}-{x2})")
            
            # Special crop for River column
            if name == "action_log":
                river_x1 = int(x1 + (x2 - x1) * 0.8)
                river_crop = img[y1:y2, river_x1:x2]
                cv2.imwrite("debug_crop_river_column.png", river_crop)
                print(f"Saved debug_crop_river_column.png: {river_crop.shape[1]}x{river_crop.shape[0]}")

if __name__ == "__main__":
    debug_crops()
