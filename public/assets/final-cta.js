(function () {
  "use strict";

  var section = document.querySelector(".final-cta");
  if (!section) return;

  document.querySelectorAll(".final-cta__diagram-line, .final-cta__diagram-ring").forEach(function (el) {
    if (typeof el.getTotalLength === "function") {
      var length = el.getTotalLength();
      el.style.strokeDasharray = String(length);
      el.style.strokeDashoffset = String(length);
    }
  });

  var ghostBtn = section.querySelector('[href="#soluciones"]');
  var soluciones = document.getElementById("soluciones");
  if (ghostBtn && soluciones) {
    ghostBtn.addEventListener("click", function (e) {
      e.preventDefault();
      soluciones.scrollIntoView({ behavior: "smooth", block: "start" });
      soluciones.focus({ preventScroll: true });
    });
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    section.classList.add("is-visible");
    return;
  }

  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            section.classList.add("is-visible");
            observer.disconnect();
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -6% 0px" }
    );
    observer.observe(section);
  } else {
    section.classList.add("is-visible");
  }
})();
