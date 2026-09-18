# Usamos una imagen base con CUDA para tener soporte de GPU
FROM nvidia/cuda:11.8.0-devel-ubuntu22.04

# Evitar prompts interactivos durante la instalación
ENV DEBIAN_FRONTEND=noninteractive

# Instalar dependencias del sistema
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3-pip \
    python3.10-venv \
    git \
    wget \
    curl \
    build-essential \
    ninja-build \
    && rm -rf /var/lib/apt/lists/*

# Configurar Python
RUN ln -s /usr/bin/python3.10 /usr/bin/python
RUN pip3 install --upgrade pip setuptools wheel

# Instalar dependencias de Python (PyTorch con soporte CUDA)
RUN pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
RUN pip3 install google-cloud-storage pillow numpy tqdm plyfile opencv-python-headless

# Clonar e instalar el optimizador de Gaussian Splatting
WORKDIR /workspace
RUN git clone --recursive https://github.com/graphdeco-inria/gaussian-splatting
WORKDIR /workspace/gaussian-splatting
# Instalar submodulos que requieren compilación CUDA
# Asegurarnos de que pip vea a torch durante el build
ENV TORCH_CUDA_ARCH_LIST="7.5 8.0 8.6 8.9 9.0"
# Usamos pip install directo desde el directorio para forzar la compilación local
RUN cd submodules/diff-gaussian-rasterization && python3 setup.py install
RUN cd submodules/simple-knn && python3 setup.py install

# Copiar nuestro script de orquestación
WORKDIR /app
COPY train_splat.py .

# Ejecutar nuestro script
ENTRYPOINT ["python", "train_splat.py"]