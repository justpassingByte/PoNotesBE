import os
import hashlib
import redis
import json
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

# Initialize Cache DB (Redis /1)
redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379/1')
cache = redis.from_url(redis_url)


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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
