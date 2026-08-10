(function () {
  const TOKEN_KEY = "postventa_session";

  function getStoredToken() {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  }

  function setStoredToken(token) {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* ignore */
    }
  }

  function clearStoredToken() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }

  function portalFetch(url, opts) {
    opts = opts || {};
    const headers = new Headers(opts.headers || {});
    const token = getStoredToken();
    if (token) headers.set("x-postventa-session", token);
    if (opts.body && !headers.has("Content-Type") && typeof opts.body === "string") {
      headers.set("Content-Type", "application/json");
    }
    let finalUrl = url;
    if (!opts.method || String(opts.method).toUpperCase() === "GET") {
      const sep = String(url).indexOf("?") >= 0 ? "&" : "?";
      finalUrl = url + sep + "_ts=" + Date.now();
    }
    return fetch(finalUrl, {
      ...opts,
      credentials: "same-origin",
      cache: "no-store",
      headers
    });
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function qs(name, fallback) {
    const u = new URL(location.href);
    return u.searchParams.get(name) || fallback || "";
  }

  function statusPillClass(s) {
    if (s === "terminado" || s === "closed") return "ok";
    if (s === "en_ejecucion" || s === "programado" || s === "asignada") return "warn";
    if (s === "rejected") return "bad";
    return "info";
  }

  function fmtSchedule(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    return d.toLocaleString("es-CL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  async function ensureAuth() {
    const res = await portalFetch("/api/postventa/portal/me");
    if (res.status === 401) {
      clearStoredToken();
      const next = encodeURIComponent(location.pathname + location.search);
      location.replace("/postventa/inspector/login?next=" + next);
      return null;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      location.replace("/postventa/inspector/login");
      return null;
    }
    return data;
  }

  async function login(email, password) {
    const res = await portalFetch("/api/postventa/portal/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return { ok: false, message: data.message || "No se pudo ingresar" };
    }
    if (data.token) setStoredToken(data.token);
    return { ok: true, data };
  }

  async function logout() {
    try {
      await portalFetch("/api/postventa/portal/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    clearStoredToken();
    location.replace("/postventa/inspector/login");
  }

  function authPhotoUrl(url) {
    if (!url) return "";
    const token = getStoredToken();
    if (!token) return url;
    const sep = url.indexOf("?") >= 0 ? "&" : "?";
    return url + sep + "token=" + encodeURIComponent(token);
  }

  /**
   * Comprime la foto de cámara (max 1280px, JPEG ~0.7) para no exceder bodyLimit.
   */
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Imagen inválida"));
        img.onload = () => {
          const maxSide = 1280;
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          if (!w || !h) {
            reject(new Error("No se pudo medir la imagen"));
            return;
          }
          const scale = Math.min(1, maxSide / Math.max(w, h));
          w = Math.round(w * scale);
          h = Math.round(h * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
          const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
          resolve({ base64, mimeType: "image/jpeg", dataUrl });
        };
        img.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });
  }

  window.PvInspector = {
    portalFetch,
    ensureAuth,
    login,
    logout,
    escapeHtml,
    qs,
    statusPillClass,
    fmtSchedule,
    authPhotoUrl,
    fileToBase64,
    getStoredToken,
    downloadOtPdf
  };

  async function downloadOtPdf(shortId, filename) {
    const id = String(shortId || "").trim();
    if (!id) throw new Error("Falta el ticket");
    const res = await portalFetch(
      "/api/postventa/portal/tickets/" + encodeURIComponent(id) + "/ot.pdf"
    );
    const ct = String(res.headers.get("content-type") || "");
    if (!res.ok || !ct.includes("pdf")) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || data.error || "No se pudo generar la OT");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "OT-" + id + ".pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
})();
