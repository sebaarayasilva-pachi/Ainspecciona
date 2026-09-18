FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV QT_QPA_PLATFORM=offscreen
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    colmap \
    python3 \
    python3-pip \
    python3-numpy \
    python3-pil \
    sqlite3 \
    ca-certificates \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libgomp1 \
    && pip3 install --no-cache-dir google-cloud-storage==2.19.0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY colmap_poses.py ply_to_glb.py texture_mesh.py run_recon.py plane_detection.py run_luma.py requirements.txt /app/

RUN pip3 install --no-cache-dir -r requirements.txt

# Cloud Run expects a web server to listen on PORT, but run_recon.py is a one-off script
# Usually Cloud Run Jobs are used for one-off scripts, not Cloud Run Services.
# If this is deployed as a Service, we need a dummy server or we should deploy it as a Job.
# Let's check how it was deployed originally.
CMD ["python3", "/app/run_luma.py"]
