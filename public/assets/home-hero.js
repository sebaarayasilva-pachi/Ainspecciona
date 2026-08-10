(function () {
  "use strict";

  var hero = document.querySelector(".home-hero");
  if (hero && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              hero.classList.add("is-visible");
              observer.disconnect();
            }
          });
        },
        { threshold: 0.12 }
      );
      observer.observe(hero);
    } else {
      hero.classList.add("is-visible");
    }
  } else if (hero) {
    hero.classList.add("is-visible");
  }

  var explorarBtn = document.getElementById("explorarSolucionesBtn");
  var soluciones = document.getElementById("soluciones");
  if (explorarBtn && soluciones) {
    explorarBtn.addEventListener("click", function (e) {
      e.preventDefault();
      soluciones.scrollIntoView({ behavior: "smooth", block: "start" });
      soluciones.focus({ preventScroll: true });
    });
  }
})();
