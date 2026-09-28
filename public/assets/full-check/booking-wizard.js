import { CHILE_REGIONS, communesForRegion, DEFAULT_REGION_CODE } from './chileRegions.js';

const PROPERTY_TYPE_OPTIONS = [
  { value: 'departamento', label: 'Departamento' },
  { value: 'casa', label: 'Casa' },
];

const OPERATION_TYPE_OPTIONS = [
  { value: '', label: '—' },
  { value: 'venta', label: 'Venta' },
  { value: 'arriendo', label: 'Arriendo' },
  { value: 'tasacion', label: 'Tasación' },
  { value: 'otro', label: 'Otro' },
];

const TZ = 'America/Santiago';
const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function tierFromBedrooms(bedrooms) {
  if (bedrooms <= 1) return '1D';
  if (bedrooms === 2) return '2D';
  if (bedrooms === 3) return '3D';
  return '4D';
}

function formatClp(n) {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(n);
}

function chileDateKey(iso) {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function chileTodayKey() {
  return chileDateKey(new Date());
}

function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { year: y, month: m, day: d };
}

function formatMonthTitle(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function formatDateLabel(dateKey) {
  const { year, month, day } = parseDateKey(dateKey);
  const d = new Date(Date.UTC(year, month - 1, day, 15, 0, 0));
  return d.toLocaleDateString('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TZ,
  });
}

function formatSlotTime(iso) {
  return new Date(iso).toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  });
}

function formatSlotLabel(slot) {
  return new Date(slot.startAt).toLocaleString('es-CL', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  });
}

function groupSlotsByDate(slots) {
  const map = new Map();
  for (const slot of slots) {
    const key = chileDateKey(slot.startAt);
    const list = map.get(key) ?? [];
    list.push(slot);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.startAt.localeCompare(b.startAt));
  }
  return map;
}

function buildMonthGrid(year, month) {
  const cells = [];
  const first = new Date(year, month - 1, 1);
  let pad = first.getDay() - 1;
  if (pad < 0) pad = 6;
  const start = new Date(year, month - 1, 1 - pad);
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({
      dateKey: chileDateKey(d),
      day: d.getDate(),
      inMonth: d.getMonth() === month - 1,
    });
  }
  return cells;
}

function shiftMonth(year, month, delta) {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

async function parseJson(res) {
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json && json.message ? String(json.message) : `Error ${res.status}`);
  }
  return json;
}

async function fetchInspectionTiers() {
  const res = await fetch('/api/booking?action=tiers');
  const json = await parseJson(res);
  return json.tiers;
}

async function fetchAggregatedSlots(commune) {
  const q = new URLSearchParams({ action: 'slots', commune });
  const res = await fetch(`/api/booking?${q}`);
  const json = await parseJson(res);
  return json.slots;
}

async function createBookingHold(input) {
  const res = await fetch('/api/booking?action=hold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

async function startBookingCheckout(bookingId) {
  const res = await fetch('/api/booking?action=checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId }),
  });
  return parseJson(res);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function optionList(items, selected) {
  return items
    .map((item) => {
      const value = item.value ?? item.code ?? item;
      const label = item.label ?? item.name ?? item;
      return `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
    })
    .join('');
}

const root = document.getElementById('fc-booking-root');
if (!root) {
  throw new Error('Falta #fc-booking-root');
}

const state = {
  step: 1,
  client: { fullName: '', email: '', phone: '', rut: '' },
  property: {
    street: '',
    streetNumber: '',
    unit: '',
    region: DEFAULT_REGION_CODE,
    commune: '',
    rol: '',
    propertyType: 'departamento',
    operationType: '',
    bathrooms: 1,
    bedrooms: 1,
    surfaceM2: '',
    hasPatio: false,
    hasEntretecho: false,
    hasLoggia: false,
    hasElevator: false,
    hasParking: false,
    greenCertificate: false,
  },
  tiers: [],
  slots: [],
  selectedSlot: null,
  bookingId: null,
  err: null,
  loading: false,
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth() + 1,
  selectedDateKey: null,
};

fetchInspectionTiers()
  .then((tiers) => {
    state.tiers = tiers;
    render();
  })
  .catch((e) => {
    state.err = e instanceof Error ? e.message : 'Error cargando precios';
    render();
  });

function selectedTierQuote() {
  const tier = tierFromBedrooms(state.property.bedrooms);
  return state.tiers.find((t) => t.tier === tier) || null;
}

function readForm() {
  const p = state.property;
  const c = state.client;
  const val = (id) => {
    const el = root.querySelector(`[data-field="${id}"]`);
    return el ? el.value : '';
  };
  const num = (id) => Math.max(0, Number(val(id)) || 0);
  c.fullName = val('fullName');
  c.email = val('email');
  c.phone = val('phone');
  c.rut = val('rut');
  p.street = val('street');
  p.streetNumber = val('streetNumber');
  p.unit = val('unit');
  p.region = val('region') || p.region;
  p.commune = val('commune');
  p.rol = val('rol');
  p.propertyType = val('propertyType') || p.propertyType;
  p.operationType = val('operationType');
  p.bathrooms = num('bathrooms');
  p.bedrooms = num('bedrooms');
  p.surfaceM2 = val('surfaceM2');
}

function onRegionChange(region) {
  readForm();
  state.property.region = region;
  state.property.commune = '';
  render();
}

async function loadSlots() {
  if (!state.property.commune.trim()) {
    state.err = 'Indica comuna en el paso anterior.';
    render();
    return;
  }
  state.loading = true;
  state.err = null;
  render();
  try {
    state.slots = await fetchAggregatedSlots(state.property.commune.trim());
    const keys = [...groupSlotsByDate(state.slots).keys()].sort();
    if (keys.length) {
      state.selectedDateKey = state.selectedDateKey || keys[0];
      const first = parseDateKey(keys[0]);
      state.viewYear = first.year;
      state.viewMonth = first.month;
    }
  } catch (e) {
    state.err = e instanceof Error ? e.message : 'Error cargando agenda';
  } finally {
    state.loading = false;
    render();
  }
}

async function onPay() {
  const quote = selectedTierQuote();
  const tier = tierFromBedrooms(state.property.bedrooms);
  if (!tier || !state.selectedSlot || !quote) return;
  state.loading = true;
  state.err = null;
  render();
  try {
    const hold = await createBookingHold({
      inspectionTier: tier,
      client: state.client,
      property: {
        ...state.property,
        surfaceM2: state.property.surfaceM2
          ? Number(String(state.property.surfaceM2).replace(',', '.'))
          : undefined,
      },
      scheduledStartAt: state.selectedSlot.startAt,
      scheduledEndAt: state.selectedSlot.endAt,
    });
    state.bookingId = hold.bookingId;
    const checkout = await startBookingCheckout(hold.bookingId);
    if (checkout.initPoint) {
      window.location.href = checkout.initPoint;
      return;
    }
    if (checkout.redirectUrl) {
      window.location.href = checkout.redirectUrl;
      return;
    }
    state.err = 'No se recibió URL de pago.';
  } catch (e) {
    state.err = e instanceof Error ? e.message : 'Error al iniciar pago';
  } finally {
    state.loading = false;
    render();
  }
}

function goNext() {
  readForm();
  state.err = null;
  if (state.step === 1 && (!state.client.fullName || !state.client.email || !state.client.phone)) {
    state.err = 'Completa contacto.';
    render();
    return;
  }
  if (
    state.step === 2 &&
    (!state.property.street ||
      !state.property.streetNumber ||
      !state.property.region ||
      !state.property.commune ||
      state.property.bedrooms < 1)
  ) {
    state.err = 'Completa ubicación y al menos 1 dormitorio para calcular el precio.';
    render();
    return;
  }
  if (state.step === 3 && !state.selectedSlot) {
    state.err = 'Elige un horario.';
    render();
    return;
  }
  state.step += 1;
  render();
  if (state.step === 3) void loadSlots();
}

function renderCalendar() {
  const todayKey = chileTodayKey();
  const slotsByDate = groupSlotsByDate(state.slots);
  const grid = buildMonthGrid(state.viewYear, state.viewMonth);
  const daySlots = state.selectedDateKey ? (slotsByDate.get(state.selectedDateKey) ?? []) : [];
  const noSlots = !state.loading && state.slots.length === 0;

  const cells = state.loading
    ? Array.from({ length: 42 }, () => '<div class="pc-agenda__cell pc-agenda__cell--skeleton"></div>').join('')
    : grid.map((cell) => {
        const hasSlots = slotsByDate.has(cell.dateKey);
        const isPast = cell.dateKey < todayKey;
        const isSelected = state.selectedDateKey === cell.dateKey;
        const isToday = cell.dateKey === todayKey;
        const disabled = !cell.inMonth || !hasSlots || isPast;
        const unavailable = cell.inMonth && !isPast && !hasSlots;
        const cls = [
          'pc-agenda__cell',
          !cell.inMonth && 'pc-agenda__cell--outside',
          hasSlots && !isPast && 'pc-agenda__cell--available',
          unavailable && 'pc-agenda__cell--unavailable',
          isSelected && 'pc-agenda__cell--selected',
          isToday && 'pc-agenda__cell--today',
          isPast && 'pc-agenda__cell--past',
        ].filter(Boolean).join(' ');
        return `<button type="button" class="${cls}" data-day="${esc(cell.dateKey)}" ${disabled ? 'disabled' : ''}>
          <span class="pc-agenda__day-num">${cell.day}</span>
          ${hasSlots && !isPast && cell.inMonth ? '<span class="pc-agenda__dot" aria-hidden="true"></span>' : ''}
        </button>`;
      }).join('');

  let times = '';
  if (state.loading) times = '<p class="pc-agenda__times-empty">Cargando agenda…</p>';
  else if (state.slots.length > 0 && !state.selectedDateKey) {
    times = '<p class="pc-agenda__times-empty">Selecciona un día en el calendario.</p>';
  } else if (state.selectedDateKey && daySlots.length > 0) {
    times = `<h4 class="pc-agenda__times-title">${esc(formatDateLabel(state.selectedDateKey))}</h4>
      <ul class="pc-booking__slots">${daySlots.map((slot) => `
        <li>
          <button type="button" class="pc-booking__slot${state.selectedSlot?.startAt === slot.startAt ? ' pc-booking__slot--active' : ''}" data-slot="${esc(slot.startAt)}">
            ${esc(formatSlotTime(slot.startAt))}
            ${slot.capacity > 1 ? `<span class="pc-agenda__capacity">${slot.capacity} cupos</span>` : ''}
          </button>
        </li>`).join('')}</ul>`;
  }

  return `<div class="pc-agenda">
    <p class="pc-agenda__hint">Comuna: <strong>${esc(state.property.commune)}</strong>. Elige un día con disponibilidad y luego un horario.</p>
    <div class="pc-agenda__calendar${noSlots ? ' pc-agenda__calendar--empty' : ''}">
      <div class="pc-agenda__cal-head">
        <button type="button" class="pc-agenda__nav-btn" data-month="-1" aria-label="Mes anterior">‹</button>
        <h3 class="pc-agenda__month">${esc(formatMonthTitle(state.viewYear, state.viewMonth))}</h3>
        <button type="button" class="pc-agenda__nav-btn" data-month="1" aria-label="Mes siguiente">›</button>
      </div>
      <div class="pc-agenda__weekdays" aria-hidden="true">${WEEKDAY_LABELS.map((l) => `<span class="pc-agenda__weekday">${l}</span>`).join('')}</div>
      <div class="pc-agenda__grid${state.loading ? ' pc-agenda__grid--loading' : ''}">${cells}</div>
      <ul class="pc-agenda__legend">
        <li><span class="pc-agenda__legend-dot pc-agenda__legend-dot--available"></span> Con cupo</li>
        <li><span class="pc-agenda__legend-dot pc-agenda__legend-dot--unavailable"></span> Sin cupo</li>
        <li><span class="pc-agenda__legend-dot pc-agenda__legend-dot--selected"></span> Día elegido</li>
      </ul>
    </div>
    <div class="pc-agenda__times${noSlots ? ' pc-agenda__times--empty' : ''}">${times}</div>
  </div>`;
}

function render() {
  const p = state.property;
  const c = state.client;
  const quote = selectedTierQuote();
  const communes = communesForRegion(p.region);
  const steps = ['Contacto', 'Propiedad', 'Agenda', 'Pago']
    .map((label, i) => `<li class="pc-booking__step${state.step === i + 1 ? ' pc-booking__step--active' : ''}">${label}</li>`)
    .join('');

  let body = '';
  if (state.step === 1) {
    body = `<div class="pc-request__grid2">
      <label class="pc-request__field"><span class="pc-request__label">Nombre completo</span>
        <input class="pc-request__input" data-field="fullName" value="${esc(c.fullName)}" required /></label>
      <label class="pc-request__field"><span class="pc-request__label">Email</span>
        <input type="email" class="pc-request__input" data-field="email" value="${esc(c.email)}" required /></label>
      <label class="pc-request__field"><span class="pc-request__label">Teléfono</span>
        <input class="pc-request__input" data-field="phone" value="${esc(c.phone)}" required /></label>
      <label class="pc-request__field"><span class="pc-request__label">RUT (opcional)</span>
        <input class="pc-request__input" data-field="rut" value="${esc(c.rut)}" /></label>
    </div>`;
  } else if (state.step === 2) {
    body = `<div class="pc-booking__property">
      <section class="pc-booking__property-card">
        <h3 class="pc-booking__property-card-title">Ubicación del inmueble</h3>
        <div class="pc-request__grid2">
          <label class="pc-request__field"><span class="pc-request__label">Calle</span>
            <input class="pc-request__input" data-field="street" value="${esc(p.street)}" placeholder="Ej: Av. Providencia" required /></label>
          <label class="pc-request__field"><span class="pc-request__label">Número</span>
            <input class="pc-request__input" data-field="streetNumber" value="${esc(p.streetNumber)}" placeholder="Ej: 1234" required /></label>
        </div>
        <label class="pc-request__field"><span class="pc-request__label">Depto / Interior</span>
          <input class="pc-request__input" data-field="unit" value="${esc(p.unit)}" placeholder="Opcional" /></label>
        <div class="pc-request__grid2">
          <label class="pc-request__field"><span class="pc-request__label">Región</span>
            <select class="pc-request__input" data-field="region">${optionList(CHILE_REGIONS, p.region)}</select></label>
          <label class="pc-request__field"><span class="pc-request__label">Comuna</span>
            <select class="pc-request__input" data-field="commune">
              <option value="">${p.region ? '— Elegir comuna —' : 'Elige región primero'}</option>
              ${communes.map((name) => `<option value="${esc(name)}"${name === p.commune ? ' selected' : ''}>${esc(name)}</option>`).join('')}
            </select></label>
        </div>
        <label class="pc-request__field"><span class="pc-request__label">ROL</span>
          <input class="pc-request__input" data-field="rol" value="${esc(p.rol)}" placeholder="Opcional" /></label>
      </section>
      <section class="pc-booking__property-card">
        <h3 class="pc-booking__property-card-title">Características</h3>
        <div class="pc-request__grid2">
          <label class="pc-request__field"><span class="pc-request__label">Tipo de propiedad</span>
            <select class="pc-request__input" data-field="propertyType">${optionList(PROPERTY_TYPE_OPTIONS, p.propertyType)}</select></label>
          <label class="pc-request__field"><span class="pc-request__label">Tipo operación</span>
            <select class="pc-request__input" data-field="operationType">${optionList(OPERATION_TYPE_OPTIONS, p.operationType)}</select></label>
        </div>
        <div class="pc-request__grid2">
          <label class="pc-request__field"><span class="pc-request__label">Baños</span>
            <input class="pc-request__input" type="number" min="0" data-field="bathrooms" value="${esc(p.bathrooms)}" /></label>
          <label class="pc-request__field"><span class="pc-request__label">Dormitorios</span>
            <input class="pc-request__input" type="number" min="0" data-field="bedrooms" value="${esc(p.bedrooms)}" /></label>
        </div>
        <label class="pc-request__field"><span class="pc-request__label">Superficie (m²)</span>
          <input class="pc-request__input" data-field="surfaceM2" value="${esc(p.surfaceM2)}" placeholder="Ej: 45" /></label>
        ${quote ? `<p class="pc-booking__price-hint">Precio inspección (${p.bedrooms} ${p.bedrooms === 1 ? 'dormitorio' : 'dormitorios'}): <strong>${esc(quote.label)}</strong> — ${esc(formatClp(quote.totalClp))}</p>` : ''}
      </section>
    </div>`;
  } else if (state.step === 3) {
    body = renderCalendar();
  } else if (state.step === 4 && quote && state.selectedSlot) {
    body = `<div class="pc-booking__summary">
      <p><strong>Dormitorios:</strong> ${p.bedrooms} → ${esc(quote.label)} — ${esc(formatClp(quote.totalClp))}</p>
      <p><strong>Visita:</strong> ${esc(formatSlotLabel(state.selectedSlot))}</p>
      <p><strong>Dirección:</strong> ${esc(p.street)} ${esc(p.streetNumber)}, ${esc(p.commune)}</p>
      ${state.bookingId ? `<p class="admin-muted">Reserva <code>${esc(state.bookingId.slice(0, 8))}…</code></p>` : ''}
    </div>`;
  }

  root.innerHTML = `<div class="pc-booking">
    <ol class="pc-booking__steps">${steps}</ol>
    ${state.err ? `<p class="pc-request__error" role="alert">${esc(state.err)}</p>` : ''}
    ${body}
    <div class="pc-booking__nav">
      ${state.step > 1 ? '<button type="button" class="admin-btn admin-btn--ghost" data-nav="back">Atrás</button>' : ''}
      ${state.step < 4 ? '<button type="button" class="admin-btn admin-btn--primary" data-nav="next">Continuar</button>' : ''}
      ${state.step === 4 ? `<button type="button" class="admin-btn admin-btn--primary" data-nav="pay"${state.loading ? ' disabled' : ''}>${state.loading ? 'Redirigiendo…' : 'Pagar con MercadoPago'}</button>` : ''}
    </div>
  </div>`;

  const regionSelect = root.querySelector('[data-field="region"]');
  if (regionSelect) {
    regionSelect.addEventListener('change', (e) => onRegionChange(e.target.value));
  }
  const bedrooms = root.querySelector('[data-field="bedrooms"]');
  if (bedrooms) {
    bedrooms.addEventListener('change', () => {
      readForm();
      render();
    });
  }
  root.querySelector('[data-nav="back"]')?.addEventListener('click', () => {
    readForm();
    state.step -= 1;
    render();
  });
  root.querySelector('[data-nav="next"]')?.addEventListener('click', goNext);
  root.querySelector('[data-nav="pay"]')?.addEventListener('click', () => void onPay());

  root.querySelectorAll('[data-month]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = shiftMonth(state.viewYear, state.viewMonth, Number(btn.getAttribute('data-month')));
      state.viewYear = next.year;
      state.viewMonth = next.month;
      render();
    });
  });
  root.querySelectorAll('[data-day]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-day');
      state.selectedDateKey = key;
      if (state.selectedSlot && chileDateKey(state.selectedSlot.startAt) !== key) {
        state.selectedSlot = null;
      }
      render();
    });
  });
  root.querySelectorAll('[data-slot]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const startAt = btn.getAttribute('data-slot');
      state.selectedSlot = state.slots.find((s) => s.startAt === startAt) || null;
      render();
    });
  });
}

render();
