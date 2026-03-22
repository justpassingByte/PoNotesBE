import requests
import time
import os
import sys

# Configuration
BASE_URL = os.getenv("OCR_SERVICE_URL", "http://localhost:8000")
TEST_IMG = "ocrtest2.png" 

def submit_ocr(file_path):
    """Submits an image and returns the job_id"""
    if not os.path.exists(file_path):
        print(f"Error: {file_path} not found")
        return None
        
    start = time.time()
    with open(file_path, "rb") as f:
        # Provide filename and content type to satisfy FastAPI validation
        files = {"file": (os.path.basename(file_path), f, "image/png")}
        try:
            # Corrected endpoint to match main.py
            r = requests.post(f"{BASE_URL}/ocr", files=files)
            r.raise_for_status()
            data = r.json()
            duration = time.time() - start
            print(f"[SUBMITTED] JobID: {data['job_id']} ({duration:.2f}s)")
            return data['job_id']
        except Exception as e:
            print(f"Submission failed: {e}")
            return None

def check_status(job_id):
    """Polls for the result of a job"""
    max_retries = 30
    for i in range(max_retries):
        try:
            # Corrected endpoint to match main.py
            r = requests.get(f"{BASE_URL}/result/{job_id}")
            data = r.json()
            
            if data['status'] == 'success' or data['status'] == 'completed':
                print(f"\n[SUCCESS] Result for {job_id}:")
                # Handle both result nesting styles
                res = data.get('result', data)
                hand_data = res.get('data', res)
                print(f"Pot: {hand_data.get('pot', 'N/A')}")
                print(f"Board: {hand_data.get('board', '[]')}")
                print(f"Players: {hand_data.get('players', {})}")
                print(f"Actions extracted: {hand_data.get('actions', [])}")
                confidence = res.get('confidence', {}).get('total', '0.0')
                print(f"Confidence: {confidence}")
                return hand_data
            elif data['status'] == 'error' or data['status'] == 'failed':
                print(f"\n[FAILED] Job {job_id} failed: {data.get('detail') or data.get('error')}")
                return None
            
            print(".", end="", flush=True)
            time.sleep(2)
        except Exception as e:
            print(f"Polling failed: {e}")
            break
    print("\n[TIMEOUT] Polling took too long")
    return None

if __name__ == "__main__":
    print(f"Testing OCR Service at {BASE_URL}...")
    
    # Check health first
    try:
        health_resp = requests.get(f"{BASE_URL}/health")
        health = health_resp.json()
        print(f"Service Health: {health['status']}")
    except Exception as e:
        print(f"Service is UNREACHABLE: {e}")
        sys.exit(1)

    # Use first argument as image if provided
    img_to_test = sys.argv[1] if len(sys.argv) > 1 else TEST_IMG
    
    jid = submit_ocr(img_to_test)
    if jid:
        check_status(jid)
