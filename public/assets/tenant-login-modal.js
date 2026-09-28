(function () {
  var loginForm = document.getElementById("tenantLoginForm");
  var loginEmail = document.getElementById("tenantEmail");
  var loginPass = document.getElementById("tenantPass");
  var loginModal = document.getElementById("loginModal");
  var loginModalClose = document.getElementById("loginModalClose");
  var loginNote = document.getElementById("loginNote");

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
      var res = await fetch("/api/tenant/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: identifier, rut: identifier, password: password }),
        credentials: "include"
      });
      if (res.ok) {
        var data = await res.json();
        loginModal.classList.remove("open");
        if (data.token) {
          localStorage.setItem("tenant_session", data.token);
          window.location.replace("/tenant?t=" + encodeURIComponent(data.token));
        } else {
          window.location.replace("/tenant");
        }
        return;
      }
      if (loginNote) loginNote.textContent = "Email/RUT o clave incorrectos.";
    } catch (err) {
      if (loginNote) loginNote.textContent = "Error de conexión. Intenta más tarde.";
    }
  });
})();
