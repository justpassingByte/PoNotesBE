import os
import hashlib
from fastapi import FastAPI, UploadFile, File, HTTPException
from celery_worker import celery_app
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

# Initialize API
app = FastAPI(title="VillainVault OCR Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)



# ─── Pydantic Models ─────────────────────────────────────────────────────────

class JobResponse(BaseModel):
    status: str
    job_id: str
    cached: bool = False
    result: Optional[dict] = None

class FeedbackRequest(BaseModel):
    image_hex: str
    card_name: str
    action: str              # "confirm" | "edit" | "reject"
    corrected_name: str = ""
    card_index: Optional[int] = None

@app.post("/ocr")
async def extract_hand_data(file: UploadFile = File(...)):
    """
    Receives image, queues it into Celery for processing.
    """
    if not file:
        raise HTTPException(status_code=400, detail="No file uploaded")
    
    image_bytes = await file.read()
    image_hash = hashlib.md5(image_bytes).hexdigest()
    image_hex = image_bytes.hex()
    
    job = celery_app.send_task(
        "tasks.process_hand",
        args=[image_hex, image_hash]
    )
    
    return {"status": "queued", "job_id": job.id}


@app.get("/result/{job_id}", response_model=JobResponse)
async def get_ocr_result(job_id: str):
    """
    Polls Celery for the task status.
    """
    from celery.result import AsyncResult
    res = AsyncResult(job_id, app=celery_app)
    
    if res.state == "PENDING":
        return JobResponse(status="pending", job_id=job_id)
    elif res.state == "SUCCESS":
        return JobResponse(status="success", job_id=job_id, result=res.result)
    elif res.state == "FAILURE":
        return JobResponse(status="error", job_id=job_id, result={"error": str(res.info)})
    
    return JobResponse(status=res.state.lower(), job_id=job_id)

@app.post("/feedback")
async def submit_feedback(req: FeedbackRequest):
    """
    Task 4.1/4.2: User feedback endpoint for OCR Confirmation UI.
    Queues apply_feedback Celery task.
    """
    if req.action not in ("confirm", "edit", "reject"):
        raise HTTPException(status_code=400, detail='action must be "confirm", "edit", or "reject".')
    if req.action == "edit" and not req.corrected_name:
        raise HTTPException(status_code=400, detail='"corrected_name" is required for edit action.')

    job = celery_app.send_task(
        "tasks.apply_feedback",
        args=[req.image_hex, req.card_name, req.action, req.corrected_name, req.card_index]
    )
    return {"status": "queued", "job_id": job.id, "action": req.action}

@app.get("/templates")
async def list_templates():
    """List all saved card and anchor templates."""
    templates_dir = os.path.join(os.path.dirname(__file__), "templates")
    cards_dir = os.path.join(templates_dir, "cards")
    anchors_dir = os.path.join(templates_dir, "anchors")
    
    cards = []
    if os.path.exists(cards_dir):
        cards = [{"name": f, "type": "card"} for f in os.listdir(cards_dir) if f.endswith(".png")]
        
    anchors = []
    if os.path.exists(anchors_dir):
        anchors = [{"name": f, "type": "anchor"} for f in os.listdir(anchors_dir) if f.endswith(".png")]
        
    return {"status": "ok", "templates": cards + anchors}

@app.delete("/templates/{template_type}/{filename}")
async def delete_template(template_type: str, filename: str):
    """Delete a specific template file."""
    if template_type not in ["cards", "anchors"]:
        raise HTTPException(status_code=400, detail="Invalid template type")
        
    # Prevent directory traversal
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(os.path.dirname(__file__), "templates", template_type, safe_filename)
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Template not found")
        
    try:
        os.remove(file_path)
        return {"status": "ok", "message": f"Deleted {safe_filename}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
