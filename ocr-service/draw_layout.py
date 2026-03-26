import cv2
import json

def draw_layout(img_path="ocrtestMain.png", layout_name="PC"):
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
            cv2.rectangle(img, (x1, y1), (x2, y2), (0, 255, 0), 3)
            cv2.putText(img, name, (x1, y1-10), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2)
    
    cv2.imwrite("debug_layout_overlay.png", img)
    print("Saved debug_layout_overlay.png")

if __name__ == "__main__":
    draw_layout()
