(function () {
  "use strict";

  var section = document.querySelector(".founders-section");
  if (!section) return;

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
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    observer.observe(section);
  } else {
    section.classList.add("is-visible");
  }
})();
