(function () {
  "use strict";

  var section = document.querySelector(".solutions-section");
  if (!section) return;

  var navItems = section.querySelectorAll(".solutions-nav__item");
  var panels = section.querySelectorAll(".solutions-panel__slide");
  var states = section.querySelectorAll(".solutions-building__state");
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var activeIndex = 0;

  function reveal(el) {
    el.classList.add("is-visible");
  }

  function setStage(index) {
    if (index < 0 || index >= navItems.length) return;
    activeIndex = index;

    section.setAttribute("data-sol-active", String(index));

    navItems.forEach(function (item, i) {
      var isActive = i === index;
      item.classList.toggle("is-active", isActive);
      item.setAttribute("aria-selected", isActive ? "true" : "false");
      item.tabIndex = isActive ? 0 : -1;
    });

    panels.forEach(function (panel, i) {
      var isActive = i === index;
      panel.classList.toggle("is-active", isActive);
      if (isActive) {
        panel.removeAttribute("hidden");
      } else {
        panel.setAttribute("hidden", "");
      }
    });

    states.forEach(function (state, i) {
      var isActive = i === index;
      state.classList.toggle("is-active", isActive);
      if (isActive) {
        state.removeAttribute("hidden");
      } else {
        state.setAttribute("hidden", "");
      }
    });
  }

  navItems.forEach(function (item) {
    item.addEventListener("click", function () {
      var index = parseInt(item.getAttribute("data-sol-index"), 10);
      if (!isNaN(index)) setStage(index);
    });

    item.addEventListener("keydown", function (e) {
      var index = parseInt(item.getAttribute("data-sol-index"), 10);
      if (isNaN(index)) return;

      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        setStage((index + 1) % navItems.length);
        navItems[(index + 1) % navItems.length].focus();
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        var prev = (index - 1 + navItems.length) % navItems.length;
        setStage(prev);
        navItems[prev].focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        setStage(0);
        navItems[0].focus();
      } else if (e.key === "End") {
        e.preventDefault();
        setStage(navItems.length - 1);
        navItems[navItems.length - 1].focus();
      }
    });
  });

  setStage(0);

  if (reducedMotion) {
    reveal(section);
    return;
  }

  if (!("IntersectionObserver" in window)) {
    reveal(section);
    return;
  }

  var sectionObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          reveal(entry.target);
          sectionObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
  );

  sectionObserver.observe(section);
})();
