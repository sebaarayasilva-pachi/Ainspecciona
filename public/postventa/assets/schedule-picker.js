/**
 * Selector de fecha/hora: calendario + listado de horas.
 * Uso: PvSchedulePicker.mount(el, { initialIso, disabled, name })
 *      → { getIso(), setIso(iso), destroy() }
 */
(function () {
  const WEEKDAYS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
  const MONTHS = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre"
  ];

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function sameDay(a, b) {
    return (
      a &&
      b &&
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function buildSlots(startHour, endHour, stepMinutes) {
    const slots = [];
    for (let h = startHour; h <= endHour; h++) {
      for (let m = 0; m < 60; m += stepMinutes) {
        if (h === endHour && m > 0) break;
        slots.push(`${pad(h)}:${pad(m)}`);
      }
    }
    return slots;
  }

  function parseIso(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  function fmtSummary(d) {
    if (!d) return "Elige fecha y hora";
    return d.toLocaleString("es-CL", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  /**
   * @param {HTMLElement} root
   * @param {{
   *   initialIso?: string|null,
   *   disabled?: boolean,
   *   name?: string,
   *   startHour?: number,
   *   endHour?: number,
   *   stepMinutes?: number,
   *   onChange?: (iso: string|null) => void
   * }} [opts]
   */
  function mount(root, opts) {
    opts = opts || {};
    if (!root) throw new Error("PvSchedulePicker: root required");

    const disabled = Boolean(opts.disabled);
    const slots = buildSlots(
      opts.startHour != null ? opts.startHour : 8,
      opts.endHour != null ? opts.endHour : 21,
      opts.stepMinutes != null ? opts.stepMinutes : 60
    );

    let selected = parseIso(opts.initialIso);
    let viewYear = (selected || new Date()).getFullYear();
    let viewMonth = (selected || new Date()).getMonth();
    const today = startOfDay(new Date());

    const selectedHour = selected
      ? `${pad(selected.getHours())}:${pad(selected.getMinutes())}`
      : "";
    // Snap to nearest slot if needed
    let hourValue = slots.includes(selectedHour)
      ? selectedHour
      : selected
        ? slots.find((s) => s >= selectedHour) || slots[0]
        : "";

    root.classList.add("pv-sched");
    root.innerHTML = `
      <input type="hidden" class="pv-sched-iso" name="${escapeAttr(opts.name || "scheduledAt")}" value="" />
      <div class="pv-sched-summary" aria-live="polite"></div>
      <div class="pv-sched-layout">
        <div class="pv-sched-cal">
          <div class="pv-sched-cal-head">
            <button type="button" class="pv-sched-nav" data-nav="-1" aria-label="Mes anterior">‹</button>
            <div class="pv-sched-month"></div>
            <button type="button" class="pv-sched-nav" data-nav="1" aria-label="Mes siguiente">›</button>
          </div>
          <div class="pv-sched-weekdays">${WEEKDAYS.map((w) => `<span>${w}</span>`).join("")}</div>
          <div class="pv-sched-grid" role="grid"></div>
        </div>
        <div class="pv-sched-hours">
          <div class="pv-sched-hours-label">Hora</div>
          <div class="pv-sched-hours-list" role="listbox" aria-label="Horas disponibles"></div>
        </div>
      </div>
    `;

    const isoInput = root.querySelector(".pv-sched-iso");
    const summaryEl = root.querySelector(".pv-sched-summary");
    const monthEl = root.querySelector(".pv-sched-month");
    const gridEl = root.querySelector(".pv-sched-grid");
    const hoursEl = root.querySelector(".pv-sched-hours-list");

    if (disabled) {
      root.classList.add("is-disabled");
      root.querySelectorAll("button").forEach((b) => {
        b.disabled = true;
      });
    }

    function getIso() {
      if (!selected || !hourValue) return null;
      const [hh, mm] = hourValue.split(":").map(Number);
      const d = new Date(
        selected.getFullYear(),
        selected.getMonth(),
        selected.getDate(),
        hh,
        mm,
        0,
        0
      );
      return d.toISOString();
    }

    function syncHidden() {
      const iso = getIso();
      isoInput.value = iso || "";
      summaryEl.textContent = iso ? fmtSummary(new Date(iso)) : "Elige fecha y hora";
      summaryEl.classList.toggle("is-empty", !iso);
      if (typeof opts.onChange === "function") opts.onChange(iso);
    }

    function renderMonth() {
      monthEl.textContent = `${MONTHS[viewMonth]} ${viewYear}`;
      const first = new Date(viewYear, viewMonth, 1);
      // Monday-first: JS Sunday=0 → shift
      let startPad = (first.getDay() + 6) % 7;
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
      const cells = [];
      for (let i = 0; i < startPad; i++) cells.push(`<button type="button" class="pv-sched-day is-empty" disabled></button>`);
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(viewYear, viewMonth, day);
        const isPast = startOfDay(d) < today;
        const isSel = selected && sameDay(d, selected);
        const isToday = sameDay(d, today);
        cells.push(
          `<button type="button" class="pv-sched-day${isSel ? " is-selected" : ""}${isToday ? " is-today" : ""}${
            isPast ? " is-past" : ""
          }" data-day="${day}" ${disabled || isPast ? "disabled" : ""}>${day}</button>`
        );
      }
      gridEl.innerHTML = cells.join("");
    }

    function renderHours() {
      hoursEl.innerHTML = slots
        .map((s) => {
          const active = s === hourValue;
          return `<button type="button" class="pv-sched-hour${active ? " is-selected" : ""}" data-hour="${s}" role="option" aria-selected="${
            active ? "true" : "false"
          }" ${disabled ? "disabled" : ""}>${s}</button>`;
        })
        .join("");
    }

    function render() {
      renderMonth();
      renderHours();
      syncHidden();
    }

    root.querySelectorAll("[data-nav]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (disabled) return;
        const delta = Number(btn.getAttribute("data-nav"));
        viewMonth += delta;
        if (viewMonth < 0) {
          viewMonth = 11;
          viewYear -= 1;
        } else if (viewMonth > 11) {
          viewMonth = 0;
          viewYear += 1;
        }
        renderMonth();
      });
    });

    gridEl.addEventListener("click", (e) => {
      if (disabled) return;
      const btn = e.target.closest("[data-day]");
      if (!btn || btn.disabled) return;
      const day = Number(btn.getAttribute("data-day"));
      selected = new Date(viewYear, viewMonth, day);
      if (!hourValue) hourValue = "09:00";
      render();
    });

    hoursEl.addEventListener("click", (e) => {
      if (disabled) return;
      const btn = e.target.closest("[data-hour]");
      if (!btn || btn.disabled) return;
      hourValue = btn.getAttribute("data-hour");
      if (!selected) selected = new Date(today);
      viewYear = selected.getFullYear();
      viewMonth = selected.getMonth();
      render();
    });

    // If we have a date but no matching hour, still show date; require hour pick
    if (selected && !hourValue && selectedHour) {
      // keep selected date, leave hour empty until user picks
    }

    render();

    return {
      getIso,
      setIso(iso) {
        selected = parseIso(iso);
        if (selected) {
          viewYear = selected.getFullYear();
          viewMonth = selected.getMonth();
          const hv = `${pad(selected.getHours())}:${pad(selected.getMinutes())}`;
          hourValue = slots.includes(hv) ? hv : slots.find((s) => s >= hv) || "";
        } else {
          hourValue = "";
        }
        render();
      },
      destroy() {
        root.innerHTML = "";
        root.classList.remove("pv-sched", "is-disabled");
      },
      el: root
    };
  }

  function escapeAttr(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  /**
   * Modal promise → ISO string | null
   */
  function openModal(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "pv-sched-overlay";
      overlay.innerHTML = `
        <div class="pv-sched-modal" role="dialog" aria-modal="true" aria-label="Programar reparación">
          <h3>${opts.title || "Programar reparación"}</h3>
          <p class="pv-sched-modal-hint">${opts.hint || "Elige el día y la hora acordados con el cliente."}</p>
          <div class="pv-sched-mount"></div>
          <div class="pv-sched-modal-actions">
            <button type="button" class="pv-sched-btn" data-cancel>Cancelar</button>
            <button type="button" class="pv-sched-btn primary" data-ok>Confirmar</button>
          </div>
          <div class="pv-sched-modal-err" hidden></div>
        </div>`;
      document.body.appendChild(overlay);
      const mountEl = overlay.querySelector(".pv-sched-mount");
      const picker = mount(mountEl, { initialIso: opts.initialIso });
      const errEl = overlay.querySelector(".pv-sched-modal-err");
      const close = (val) => {
        picker.destroy();
        overlay.remove();
        resolve(val);
      };
      overlay.querySelector("[data-cancel]").onclick = () => close(null);
      overlay.querySelector("[data-ok]").onclick = () => {
        const iso = picker.getIso();
        if (!iso) {
          errEl.hidden = false;
          errEl.textContent = "Selecciona fecha y hora.";
          return;
        }
        close(iso);
      };
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close(null);
      });
    });
  }

  window.PvSchedulePicker = { mount, openModal, fmtSummary };
})();
