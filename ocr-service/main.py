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


# ─── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "healthy", "service": "ocr-api"}


@app.post("/ocr", response_model=JobResponse)
async def submit_ocr(file: UploadFile = File(...)):
    # 1. Basic File Validation
    content_type = file.content_type or "image/png"
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Invalid file type. Only images allowed.")

    content: bytes = await file.read()
    if len(content) > 100 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Max 100MB.")

    # 2. SHA256 Caching Layer
    image_hash = hashlib.sha256(content).hexdigest()
    # OCR Cache Disabled per user request (Self-learning engine requirement)
    '''
    cached_result = cache.get(f"hash:{image_hash}")
    if cached_result:
        return {
            "status": "success",
            "job_id": f"cached:{image_hash}",
            "cached": True,
            "result": json.loads(cached_result)
        }
    '''

    # 3. Queue Task to Celery
    job = celery_app.send_task("tasks.process_hand", args=[content.hex(), image_hash])

    return {
        "status": "pending",
        "job_id": job.id,
        "cached": False
    }


@app.get("/result/{job_id}")
async def get_result(job_id: str):
    if job_id.startswith("cached:"):
        image_hash = job_id.replace("cached:", "")
        res = cache.get(f"hash:{image_hash}")
        if res:
            return {"status": "success", "result": json.loads(res)}
        return {"status": "error", "detail": "Cache expired or missing"}

    res = celery_app.AsyncResult(job_id)
    if res.ready():
        if res.failed():
            return {"status": "error", "detail": str(res.result)}
        return {"status": "success", "result": res.result}

    return {"status": "pending"}


@app.get("/status/{image_hash}")
async def get_status(image_hash: str):
    """Check if a processed image has a cached result."""
    cached = cache.get(f"hash:{image_hash}")
    if cached:
        return {"status": "cached", "result": json.loads(cached)}
    return {"status": "not_found"}


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
        args=[req.image_hex, req.card_name, req.action, req.corrected_name]
    )
    return {"status": "queued", "job_id": job.id, "action": req.action}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
