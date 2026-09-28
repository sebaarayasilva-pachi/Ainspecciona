(function () {
  var loginForm = document.getElementById("tenantLoginForm");
  var loginEmail = document.getElementById("tenantEmail");
  var loginPass = document.getElementById("tenantPass");
  var loginModal = document.getElementById("loginModal");
  var loginModalClose = document.getElementById("loginModalClose");
  var loginNote = document.getElementById("loginNote");

  function safeNext(raw) {
    var n = String(raw || "").trim();
    if (!n.startsWith("/") || n.startsWith("//")) return "/app";
    return n;
  }

  function destinationAfterLogin(data) {
    var next = safeNext(new URLSearchParams(location.search).get("next"));
    var isAdmin = !!(data && data.context && data.context.user && data.context.user.isPlatformAdmin);
    if (isAdmin && (next === "/app" || next === "/")) return "/control";
    if (next === "/control" || next.indexOf("/control?") === 0 || next.indexOf("/control/") === 0) return next;
    if (next === "/app" || next.indexOf("/app?") === 0 || next.indexOf("/app/") === 0) return next;
    return next;
  }

  if (loginModalClose && loginModal) {
    loginModalClose.addEventListener("click", function () {
      loginModal.classList.remove("open");
      loginModal.setAttribute("aria-hidden", "true");
    });
  }

  if (!loginForm) return;

  loginForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (loginNote) loginNote.textContent = "";
    var identifier = loginEmail.value.trim();
    var password = loginPass.value;
    if (!identifier || !password) {
      if (loginNote) loginNote.textContent = "Completa email/RUT y clave.";
      return;
    }
    try {
      var res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: identifier, identifier: identifier, rut: identifier, password: password }),
        credentials: "include"
      });
      var data = await res.json().catch(function () { return {}; });
      if (res.ok && data.ok) {
        if (data.token) {
          try { sessionStorage.setItem("platform_session", data.token); } catch (_) {}
        }
        try {
          localStorage.removeItem("tenant_session");
          localStorage.removeItem("tenant_id");
          sessionStorage.removeItem("entrega_session");
          sessionStorage.removeItem("postventa_session");
          sessionStorage.removeItem("inout_session");
        } catch (_) {}
        loginModal.classList.remove("open");
        window.location.replace(destinationAfterLogin(data));
        return;
      }
      if (loginNote) loginNote.textContent = data.message || "Email/RUT o clave incorrectos.";
    } catch (err) {
      if (loginNote) loginNote.textContent = "Error de conexión. Intenta más tarde.";
    }
  });
})();
