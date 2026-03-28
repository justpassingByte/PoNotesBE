import os
import hashlib
import base64
import logging
from fastapi import FastAPI, UploadFile, File, HTTPException
from celery_worker import celery_app
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel
from typing import Optional

logger = logging.getLogger(__name__)

# Initialize API
app = FastAPI(title="VillainVault OCR Service")

# GZip responses > 500 bytes (saves bandwidth for JSON results)
app.add_middleware(GZipMiddleware, minimum_size=500)

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

class FailedCaseLabelRequest(BaseModel):
    filename: str
    label: str
    is_rank: bool = False
    is_suit: bool = False

@app.post("/ocr")
async def extract_hand_data(file: UploadFile = File(...)):
    """
    Receives image, queues it into Celery for processing.
    Uses base64 instead of hex (33% overhead vs 100%).
    """
    if not file:
        raise HTTPException(status_code=400, detail="No file uploaded")
    
    image_bytes = await file.read()
    image_hash = hashlib.md5(image_bytes).hexdigest()

    try:
        from tasks import process_hand_bytes
        from fastapi.concurrency import run_in_threadpool
        # Run heavy CPU tasks in a threadpool so the main event loop doesn't block
        result = await run_in_threadpool(process_hand_bytes, image_bytes, image_hash)
        return {"status": "success", "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ocr/sync")
async def extract_hand_data_sync(file: UploadFile = File(...)):
    """
    Synchronous OCR — runs task in threadpool, returns result directly.
    Passes raw bytes (skips hex/base64 encode+decode entirely).
    """
    if not file:
        raise HTTPException(status_code=400, detail="No file uploaded")

    image_bytes = await file.read()
    image_hash = hashlib.md5(image_bytes).hexdigest()

    try:
        from tasks import process_hand_bytes
        from fastapi.concurrency import run_in_threadpool
        # Run heavy CPU tasks in a threadpool so the main event loop doesn't block and crash the socket
        result = await run_in_threadpool(process_hand_bytes, image_bytes, image_hash)
        return {"status": "success", "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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

from fastapi import Form

@app.post("/feedback")
async def submit_feedback(
    file: UploadFile = File(...),
    card_name: str = Form(...),
    action: str = Form(...),
    corrected_name: str = Form(""),
    card_index: Optional[int] = Form(None)
):
    """
    User feedback endpoint for OCR Confirmation UI.
    Runs apply_feedback directly as a thread pool task, skipping base64/hex encode.
    """
    if action not in ("confirm", "edit", "reject"):
        raise HTTPException(status_code=400, detail='action must be "confirm", "edit", or "reject".')
    if action == "edit" and not corrected_name:
        raise HTTPException(status_code=400, detail='"corrected_name" is required for edit action.')

    image_bytes = await file.read()

    try:
        from tasks import apply_feedback_bytes
        from fastapi.concurrency import run_in_threadpool
        result = await run_in_threadpool(
            apply_feedback_bytes, image_bytes, card_name, action, corrected_name, card_index
        )
        return {"status": "ok", "action": action, "result": result}
    except Exception as e:
        logger.error(f"[feedback] Failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/templates")
async def list_templates():
    """List all saved symbol and anchor templates."""
    templates_dir = os.path.join(os.path.dirname(__file__), "templates")
    results = []
    for t_type in ["ranks", "suits", "anchors"]:
        d = os.path.join(templates_dir, t_type)
        if os.path.exists(d):
            results.extend([{"name": f, "type": t_type} for f in os.listdir(d) if f.endswith(".png")])
    return {"status": "ok", "templates": results}

from fastapi.responses import FileResponse

@app.get("/templates/{template_type}/{filename}")
async def get_template_image(template_type: str, filename: str):
    """Serve a specific template image file."""
    if template_type not in ["ranks", "suits", "anchors"]:
        raise HTTPException(status_code=400, detail="Invalid template type")
    
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(os.path.dirname(__file__), "templates", template_type, safe_filename)
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Template not found")
        
    return FileResponse(file_path)

@app.delete("/templates/{template_type}/{filename}")
async def delete_template(template_type: str, filename: str):
    """Delete a specific template file."""
    if template_type not in ["ranks", "suits", "anchors"]:
        raise HTTPException(status_code=400, detail="Invalid template type")
        
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(os.path.dirname(__file__), "templates", template_type, safe_filename)
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Template not found")
        
    try:
        os.remove(file_path)
        return {"status": "ok", "message": f"Deleted {safe_filename}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/failed-cases")
async def list_failed_cases():
    failed_dir = os.path.join(os.path.dirname(__file__), "templates_failed", "raw")
    cases = []
    if os.path.exists(failed_dir):
        for f in os.listdir(failed_dir):
            if f.endswith(".png"):
                meta = {}
                meta_path = os.path.join(failed_dir, f.replace(".png", ".json"))
                if os.path.exists(meta_path):
                    import json
                    try:
                        with open(meta_path, "r") as mf:
                            meta = json.load(mf)
                    except: pass
                cases.append({"filename": f, "metadata": meta})
    return {"status": "ok", "failed_cases": cases}

@app.get("/templates_failed/{subfolder}/{filename}")
async def get_failed_image(subfolder: str, filename: str):
    if subfolder not in ["raw", "labeled"]:
        raise HTTPException(status_code=400, detail="Invalid subfolder")
    
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(os.path.dirname(__file__), "templates_failed", subfolder, safe_filename)
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Image not found")
        
    return FileResponse(file_path)

@app.post("/failed-cases/label")
async def label_failed_case(req: FailedCaseLabelRequest):
    failed_dir = os.path.join(os.path.dirname(__file__), "templates_failed", "raw")
    labeled_dir = os.path.join(os.path.dirname(__file__), "templates_failed", "labeled")
    os.makedirs(labeled_dir, exist_ok=True)
    
    safe_filename = os.path.basename(req.filename)
    source_img = os.path.join(failed_dir, safe_filename)
    source_meta = os.path.join(failed_dir, safe_filename.replace(".png", ".json"))
    
    if not os.path.exists(source_img):
        raise HTTPException(status_code=404, detail="Failed case not found")
        
    import shutil
    dest_img = os.path.join(labeled_dir, safe_filename)
    dest_meta = os.path.join(labeled_dir, os.path.basename(source_meta))
    
    shutil.move(source_img, dest_img)
    if os.path.exists(source_meta):
        shutil.move(source_meta, dest_meta)
        
    if req.is_rank:
        t_dir = os.path.join(os.path.dirname(__file__), "templates", "ranks")
        os.makedirs(t_dir, exist_ok=True)
        shutil.copy(dest_img, os.path.join(t_dir, f"{req.label}.png"))
    elif req.is_suit:
        t_dir = os.path.join(os.path.dirname(__file__), "templates", "suits")
        os.makedirs(t_dir, exist_ok=True)
        shutil.copy(dest_img, os.path.join(t_dir, f"{req.label}.png"))
        
    return {"status": "labeled", "message": f"Archived {safe_filename} as {req.label}"}
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
