from celery import Celery
import os

# Configuration for Celery using Redis as broker and backend
broker_url = os.getenv('CELERY_BROKER_URL', 'redis://localhost:6379/0')
result_backend = os.getenv('CELERY_RESULT_BACKEND', 'redis://localhost:6379/0')

celery_app = Celery(
    'ocr_tasks',
    broker=broker_url,
    backend=result_backend,
    include=['tasks']
)

# Optional configuration: Serialization, timeouts, etc.
celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    task_track_started=True,
    # Worker micro-batching support (can be custom implemented in task)
    worker_prefetch_multiplier=1,
)
