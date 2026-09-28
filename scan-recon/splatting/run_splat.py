"""Entrena un Gaussian Splatting sobre la salida de COLMAP y publica el PLY en GCS.

La malla de OpenMVS no puede representar superficies cuyo aspecto cambia con el angulo
de vista: reflejos, negros brillantes, pantallas encendidas. El splatting si, porque
guarda color direccional por gaussiana, y por eso es el camino para el tour fotoreal.

Los hiperparametros y el orden del bucle siguen a examples/simple_trainer.py de gsplat
v1.5.3, pero sin sus dependencias (viser, nerfview, fused-ssim, pycolmap): leemos el
COLMAP en texto que ya genera run_recon.py y calculamos el SSIM aca mismo.

    SCAN_ID / ORG_ID / GCS_BUCKET   obligatorios
    SPLAT_STEPS                     pasos de entrenamiento (def. 15000)
    SPLAT_DOWNSCALE                 divisor de resolucion (def. 1)
    SPLAT_PUBLISH                   1 = pasa el visor a splat (def. 0, no toca la malla)
"""
import json
import math
import os
import shutil
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from google.cloud import storage
from PIL import Image

from gsplat import export_splats
from gsplat.rendering import rasterization
from gsplat.strategy import DefaultStrategy

SH_DEGREE = 3
SH_DEGREE_INTERVAL = 1000
SSIM_LAMBDA = 0.2
INIT_OPACITY = 0.1


def env(key):
    return os.environ.get(key)


def env_int(key, default):
    raw = (env(key) or "").strip()
    return int(raw) if raw else default


def log(msg):
    print(f"[SPLAT] {msg}", flush=True)


class Gcs:
    def __init__(self, bucket_name):
        self.client = storage.Client()
        self.bucket = self.client.bucket(bucket_name)

    def download_dir(self, prefix, local_dir):
        count = 0
        for blob in self.bucket.list_blobs(prefix=prefix):
            if blob.name.endswith("/"):
                continue
            local_path = Path(local_dir) / blob.name[len(prefix):].lstrip("/")
            local_path.parent.mkdir(parents=True, exist_ok=True)
            blob.download_to_filename(str(local_path))
            count += 1
        return count

    def upload_file(self, local_path, blob_name, content_type=None):
        self.bucket.blob(blob_name).upload_from_filename(str(local_path), content_type=content_type)

    def upload_json(self, blob_name, data):
        self.bucket.blob(blob_name).upload_from_string(json.dumps(data), content_type="application/json")

    def read_json(self, blob_name):
        blob = self.bucket.blob(blob_name)
        return json.loads(blob.download_as_string()) if blob.exists() else {}


# --- lectura del COLMAP en texto -------------------------------------------------

def read_cameras(path):
    cams = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        parts = line.split()
        cam_id, model = int(parts[0]), parts[1]
        w, h = int(parts[2]), int(parts[3])
        p = [float(x) for x in parts[4:]]
        if model == "PINHOLE":
            fx, fy, cx, cy = p[0], p[1], p[2], p[3]
        elif model in ("SIMPLE_PINHOLE", "SIMPLE_RADIAL"):
            fx = fy = p[0]
            cx, cy = p[1], p[2]
        else:
            raise RuntimeError(f"modelo de camara no soportado: {model}")
        cams[cam_id] = {"w": w, "h": h, "fx": fx, "fy": fy, "cx": cx, "cy": cy}
    return cams


def read_images(path):
    """Devuelve (nombre, camera_id, world-to-camera 4x4) por imagen registrada."""
    out = []
    lines = [l for l in path.read_text().splitlines() if l.strip() and not l.startswith("#")]
    # El formato alterna una linea de pose y una de puntos 2D, que no necesitamos.
    for line in lines[::2]:
        parts = line.split()
        qw, qx, qy, qz = (float(x) for x in parts[1:5])
        tx, ty, tz = (float(x) for x in parts[5:8])
        cam_id, name = int(parts[8]), parts[9]
        w2c = np.eye(4)
        w2c[:3, :3] = quat_to_rot(qw, qx, qy, qz)
        w2c[:3, 3] = [tx, ty, tz]
        out.append((name, cam_id, w2c))
    return out


def quat_to_rot(w, x, y, z):
    n = math.sqrt(w * w + x * x + y * y + z * z)
    w, x, y, z = w / n, x / n, y / n, z / n
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])


def read_points(path):
    xyz, rgb = [], []
    for line in path.read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        p = line.split()
        xyz.append([float(p[1]), float(p[2]), float(p[3])])
        rgb.append([int(p[4]), int(p[5]), int(p[6])])
    return np.array(xyz, dtype=np.float32), np.array(rgb, dtype=np.float32)


# --- utilidades de entrenamiento -------------------------------------------------

def knn_mean_dist(points, k=4):
    """Distancia media a los k-1 vecinos mas cercanos, por trozos para no explotar la RAM."""
    out = torch.empty(points.shape[0], device=points.device)
    chunk = 4096
    for i in range(0, points.shape[0], chunk):
        block = points[i:i + chunk]
        d = torch.cdist(block, points)
        # El primer vecino es el propio punto, con distancia 0.
        near = d.topk(k, largest=False).values[:, 1:]
        out[i:i + chunk] = (near ** 2).mean(dim=-1).sqrt()
    return out


def rgb_to_sh(rgb):
    return (rgb - 0.5) / 0.28209479177387814


def gaussian_window(size, sigma, device):
    coords = torch.arange(size, dtype=torch.float32, device=device) - size // 2
    g = torch.exp(-(coords ** 2) / (2 * sigma ** 2))
    return (g / g.sum()).unsqueeze(0)


def ssim(a, b, window_size=11):
    """SSIM con ventana gaussiana separable, sobre tensores [B, 3, H, W] en [0, 1]."""
    c = a.shape[1]
    win1d = gaussian_window(window_size, 1.5, a.device)
    win_x = (win1d.unsqueeze(0).unsqueeze(0)).expand(c, 1, 1, window_size)
    win_y = (win1d.t().unsqueeze(0).unsqueeze(0)).expand(c, 1, window_size, 1)

    def blur(t):
        t = F.conv2d(t, win_x, groups=c, padding=(0, window_size // 2))
        return F.conv2d(t, win_y, groups=c, padding=(window_size // 2, 0))

    mu_a, mu_b = blur(a), blur(b)
    mu_a2, mu_b2, mu_ab = mu_a * mu_a, mu_b * mu_b, mu_a * mu_b
    sig_a = blur(a * a) - mu_a2
    sig_b = blur(b * b) - mu_b2
    sig_ab = blur(a * b) - mu_ab
    c1, c2 = 0.01 ** 2, 0.03 ** 2
    num = (2 * mu_ab + c1) * (2 * sig_ab + c2)
    den = (mu_a2 + mu_b2 + c1) * (sig_a + sig_b + c2)
    return (num / den).mean()


def main():
    bucket_name = env("GCS_BUCKET")
    org_id = env("ORG_ID")
    scan_id = env("SCAN_ID")
    if not bucket_name or not org_id or not scan_id:
        raise SystemExit("Faltan GCS_BUCKET, ORG_ID o SCAN_ID")

    max_steps = env_int("SPLAT_STEPS", 15000)
    downscale = max(1, env_int("SPLAT_DOWNSCALE", 1))
    publish = (env("SPLAT_PUBLISH") or "0").strip() == "1"

    prefix = f"scans/{org_id}/{scan_id}"
    gcs = Gcs(bucket_name)
    status_key = f"{prefix}/recon/splat_status.json"

    def status(progress, step):
        gcs.upload_json(status_key, {"status": "PROCESSING", "progress": progress, "step": step})
        log(f"status {progress} {step}")

    if not torch.cuda.is_available():
        raise RuntimeError("se necesita GPU para entrenar el splat")
    device = "cuda"

    work = Path("/tmp/splat")
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    status(5, "downloading_colmap_data")
    colmap_dir = work / "colmap"
    if gcs.download_dir(f"{prefix}/recon/colmap", colmap_dir) == 0:
        raise RuntimeError("No se encontraron datos de COLMAP en GCS")

    sparse = colmap_dir / "sparse" / "0"
    if not (sparse / "cameras.txt").exists():
        sparse = colmap_dir / "sparse"
    cams = read_cameras(sparse / "cameras.txt")
    frames = read_images(sparse / "images.txt")
    pts_xyz, pts_rgb = read_points(sparse / "points3D.txt")
    log(f"{len(frames)} camaras registradas, {len(pts_xyz)} puntos dispersos")
    if len(frames) < 8 or len(pts_xyz) < 100:
        raise RuntimeError("COLMAP dejo muy poca informacion para entrenar")

    status(12, "loading_images")
    images, viewmats, ks_list = [], [], []
    for name, cam_id, w2c in frames:
        img_path = colmap_dir / "images" / name
        if not img_path.exists():
            continue
        cam = cams[cam_id]
        with Image.open(img_path) as im:
            im = im.convert("RGB")
            if downscale > 1:
                im = im.resize((im.width // downscale, im.height // downscale), Image.LANCZOS)
            arr = np.asarray(im, dtype=np.uint8)
        # Las intrinsecas vienen en pixeles, asi que hay que escalarlas igual que la imagen.
        sx = arr.shape[1] / cam["w"]
        sy = arr.shape[0] / cam["h"]
        k = np.array([
            [cam["fx"] * sx, 0.0, cam["cx"] * sx],
            [0.0, cam["fy"] * sy, cam["cy"] * sy],
            [0.0, 0.0, 1.0],
        ], dtype=np.float32)
        images.append(torch.from_numpy(arr))
        viewmats.append(torch.from_numpy(w2c.astype(np.float32)))
        ks_list.append(torch.from_numpy(k))

    if len(images) < 8:
        raise RuntimeError("no se pudieron cargar las imagenes de COLMAP")
    log(f"{len(images)} imagenes a {images[0].shape[1]}x{images[0].shape[0]}")

    viewmats = torch.stack(viewmats)
    ks_all = torch.stack(ks_list).to(device)

    # Centramos la escena en las camaras: mantiene los numeros chicos y le da a la
    # estrategia de densificado una escala con sentido.
    c2w = torch.linalg.inv(viewmats)
    centers = c2w[:, :3, 3]
    offset = centers.mean(dim=0)
    c2w[:, :3, 3] -= offset
    viewmats = torch.linalg.inv(c2w).to(device)
    scene_scale = float((centers - offset).norm(dim=-1).max()) * 1.1
    log(f"escala de escena: {scene_scale:.3f}")

    means = torch.from_numpy(pts_xyz).to(device) - offset.to(device)
    rgbs = torch.from_numpy(pts_rgb).to(device) / 255.0

    status(18, "initializing_gaussians")
    dist_avg = knn_mean_dist(means, 4)
    scales = torch.log(dist_avg).unsqueeze(-1).repeat(1, 3)
    n = means.shape[0]
    quats = torch.rand((n, 4), device=device)
    opacities = torch.logit(torch.full((n,), INIT_OPACITY, device=device))
    colors = torch.zeros((n, (SH_DEGREE + 1) ** 2, 3), device=device)
    colors[:, 0, :] = rgb_to_sh(rgbs)

    splats = torch.nn.ParameterDict({
        "means": torch.nn.Parameter(means),
        "scales": torch.nn.Parameter(scales),
        "quats": torch.nn.Parameter(quats),
        "opacities": torch.nn.Parameter(opacities),
        "sh0": torch.nn.Parameter(colors[:, :1, :]),
        "shN": torch.nn.Parameter(colors[:, 1:, :]),
    }).to(device)

    lrs = {
        "means": 1.6e-4 * scene_scale,
        "scales": 5e-3,
        "quats": 1e-3,
        "opacities": 5e-2,
        "sh0": 2.5e-3,
        "shN": 2.5e-3 / 20,
    }
    optimizers = {
        name: torch.optim.Adam([{"params": splats[name], "lr": lr, "name": name}], eps=1e-15, betas=(0.9, 0.999))
        for name, lr in lrs.items()
    }
    # El learning rate de las posiciones decae hasta el 1% del inicial, como en la referencia.
    scheduler = torch.optim.lr_scheduler.ExponentialLR(optimizers["means"], gamma=0.01 ** (1.0 / max_steps))

    # Los hitos de DefaultStrategy estan calibrados para 30k pasos. Si entrenamos menos y no
    # los escalamos, el densificado no para nunca: el modelo crece hasta el ultimo paso, sin
    # margen para afinarse, y el PLY sale demasiado pesado para servirlo en el visor.
    strategy = DefaultStrategy(
        verbose=False,
        prune_opa=0.05,
        prune_scale3d=0.5
    )
    scaler = max_steps / 30_000
    if scaler != 1.0:
        for attr in ("refine_start_iter", "refine_stop_iter", "reset_every", "refine_every", "pause_refine_after_reset"):
            if hasattr(strategy, attr):
                setattr(strategy, attr, max(1, int(getattr(strategy, attr) * scaler)))
        log(
            f"hitos de densificado escalados x{scaler:.2f}: "
            f"inicio={strategy.refine_start_iter} fin={strategy.refine_stop_iter} cada={strategy.refine_every}"
        )
    strategy.check_sanity(splats, optimizers)
    strategy_state = strategy.initialize_state(scene_scale=scene_scale)

    log(f"entrenando {max_steps} pasos desde {n} gaussianas")
    generator = torch.Generator().manual_seed(42)
    order = []
    for step in range(max_steps):
        if not order:
            order = torch.randperm(len(images), generator=generator).tolist()
        idx = order.pop()

        pixels = (images[idx].to(device, non_blocking=True).float() / 255.0).unsqueeze(0)
        height, width = pixels.shape[1:3]
        sh_degree_to_use = min(step // SH_DEGREE_INTERVAL, SH_DEGREE)

        renders, _, info = rasterization(
            means=splats["means"],
            quats=splats["quats"],
            scales=torch.exp(splats["scales"]),
            opacities=torch.sigmoid(splats["opacities"]),
            colors=torch.cat([splats["sh0"], splats["shN"]], 1),
            viewmats=viewmats[idx: idx + 1],
            Ks=ks_all[idx: idx + 1],
            width=width,
            height=height,
            sh_degree=sh_degree_to_use,
            near_plane=0.01,
            far_plane=1e10,
            packed=False,
            absgrad=strategy.absgrad,
        )

        strategy.step_pre_backward(
            params=splats, optimizers=optimizers, state=strategy_state, step=step, info=info
        )

        l1 = F.l1_loss(renders, pixels)
        ssim_loss = 1.0 - ssim(renders.permute(0, 3, 1, 2), pixels.permute(0, 3, 1, 2))
        loss = l1 * (1.0 - SSIM_LAMBDA) + ssim_loss * SSIM_LAMBDA
        loss.backward()

        for opt in optimizers.values():
            opt.step()
            opt.zero_grad(set_to_none=True)
        scheduler.step()

        strategy.step_post_backward(
            params=splats, optimizers=optimizers, state=strategy_state, step=step, info=info, packed=False
        )

        if step % 500 == 0 or step == max_steps - 1:
            log(f"paso {step}/{max_steps} loss={loss.item():.4f} gaussianas={splats['means'].shape[0]}")
            # El tramo 20-90 de la barra es el entrenamiento.
            status(20 + round(70 * step / max_steps), "training")

    count = splats["means"].shape[0]
    log(f"entrenamiento listo: {count} gaussianas")

    status(90, "filtering_noise")
    log("Filtrando ruido (plumas) por densidad...")
    with torch.no_grad():
        # Calcular distancia media a los 16 vecinos mas cercanos
        dist_avg = knn_mean_dist(splats["means"], k=16)
        
        # Filtrar el 5% de puntos mas aislados (mayor distancia a vecinos)
        # y puntos casi transparentes.
        threshold = torch.quantile(dist_avg, 0.95)
        mask = (dist_avg < threshold) & (torch.sigmoid(splats["opacities"].squeeze(-1)) > 0.05)
        
        for k in splats.keys():
            splats[k] = splats[k][mask]
            
        new_count = splats["means"].shape[0]
        log(f"Filtro aplicado: {count} -> {new_count} gaussianas (eliminado {count - new_count} ruidos)")

    status(92, "exporting_splat")
    splat_path = work / "model.splat"
    export_splats(
        means=splats["means"],
        scales=splats["scales"],
        quats=splats["quats"],
        opacities=splats["opacities"],
        sh0=splats["sh0"],
        shN=splats["shN"],
        format="splat",
        save_to=str(splat_path),
    )
    size_mb = splat_path.stat().st_size / 1024 / 1024
    log(f"SPLAT exportado: {size_mb:.1f} MB")

    status(96, "uploading_model")
    splat_key = f"{prefix}/model.splat"
    gcs.upload_file(splat_path, splat_key, "application/octet-stream")

    # Por defecto NO tocamos result.json: la malla sigue siendo lo que muestra el visor y
    # el splat queda al lado para comparar. SPLAT_PUBLISH=1 hace el cambio.
    if publish:
        result_key = f"{prefix}/recon/result.json"
        result = gcs.read_json(result_key)
        result.update({
            "status": "READY",
            "progress": 100,
            "modelType": "SPLAT",
            "modelKey": splat_key,
            "kind": "gsplat",
            "splatCount": int(count),
        })
        gcs.upload_json(result_key, result)
        log("result.json apunta al splat")

    gcs.upload_json(status_key, {
        "status": "READY",
        "progress": 100,
        "step": "done",
        "splatCount": int(count),
        "modelKey": splat_key,
        "published": publish,
    })
    log(f"READY splats={count} key={splat_key}")


if __name__ == "__main__":
    main()
