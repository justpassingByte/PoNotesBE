FROM python:3.10-slim

# System dependencies for OpenCV & PaddleOCR
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Optimization: Pre-install core ML libs to avoid long rebuilds
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create directories for models and logs
RUN mkdir -p /root/.paddleocr /app/logs

COPY . .

# Set environment variables for better CPU performance
ENV PADDLE_NUM_THREADS=4
ENV OMP_NUM_THREADS=4
ENV MKL_NUM_THREADS=4
ENV FLAGS_use_mkldnn=1

# Default command (overridden in docker-compose for worker)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
