/**
 * Photo Plan para In & Out — mismos slotCodes reutilizados en visita OUT.
 * Subconjunto orientado a documentación de arriendo (alineado con STI).
 */

function slot(slotCode, title, instructions, required = true) {
  return { slotCode, title, instructions, required };
}

/**
 * @param {{
 *   propertyType?: string,
 *   bedroomsCount?: number,
 *   bathroomsCount?: number,
 *   hasPatio?: boolean,
 *   hasLaundry?: boolean,
 *   hasParking?: boolean,
 *   hasElevator?: boolean,
 *   hasEntranceGrille?: boolean
 * }} input
 */
export function buildInOutPhotoPlan(input = {}) {
  const plan = [];
  const bathCount = Math.max(1, Number(input.bathroomsCount || 1));
  const bedCount = Math.max(0, Number(input.bedroomsCount || 0));
  const propType = String(input.propertyType || 'DEPARTMENT').toUpperCase();
  const isDept = propType === 'DEPARTMENT';
  const isHouse = propType === 'HOUSE';

  if (isHouse && input.hasEntranceGrille) {
    plan.push(slot('REJA_ENTRADA', 'Reja de entrada', 'Reja o cerramiento del acceso.', false));
  }

  if (isDept && input.hasElevator) {
    plan.push(slot('ASCENSOR_CABINA', 'Ascensor – cabina', 'Interior de la cabina del ascensor.', false));
  }

  plan.push(slot('LIVING_GENERAL', 'Living – vista general', 'Vista general del living desde la entrada del recinto.'));
  plan.push(slot('LIVING_FLOOR', 'Living – piso', 'Piso del living; enfoca rayaduras o manchas visibles.'));
  plan.push(slot('LIVING_WALLS', 'Living – muros', 'Muros del living; busca perforaciones, manchas o golpes.'));

  plan.push(slot('KITCHEN_GENERAL', 'Cocina – vista general', 'Vista general de la cocina.'));
  plan.push(slot('KITCHEN_COUNTER', 'Cocina – mesón', 'Mesón y cubierta; estado de sellos y superficies.'));
  plan.push(slot('KITCHEN_CABINETS', 'Cocina – muebles', 'Muebles bajos/altos; puertas, bisagras y frentes.'));
  plan.push(slot('KITCHEN_APPLIANCES', 'Cocina – artefactos', 'Cocina, campana, lavaplatos u otros artefactos fijos.'));

  for (let i = 1; i <= bedCount; i++) {
    plan.push(slot(`BEDROOM_${i}_GENERAL`, `Dormitorio ${i} – general`, `Vista general del dormitorio ${i}.`));
    plan.push(slot(`BEDROOM_${i}_FLOOR`, `Dormitorio ${i} – piso`, `Piso del dormitorio ${i}.`));
    plan.push(slot(`BEDROOM_${i}_CLOSET`, `Dormitorio ${i} – closet`, `Closet o clóset del dormitorio ${i}.`, false));
  }

  for (let i = 1; i <= bathCount; i++) {
    plan.push(slot(`BATHROOM_${i}_VANITY`, `Baño ${i} – vanitorio`, `Vanitorio, espejo y grifería del baño ${i}.`));
    plan.push(slot(`BATHROOM_${i}_SHOWER`, `Baño ${i} – ducha/tina`, 'Zona de ducha o tina; sellos y cerámica.'));
  }

  if (input.hasLaundry) {
    plan.push(slot('LAUNDRY_GENERAL', 'Loggia / lavadero', 'Vista general del lavadero o loggia.', false));
  }

  if (input.hasPatio) {
    plan.push(slot('PATIO_GENERAL', 'Patio / terraza', 'Vista general del patio o terraza.', false));
  }

  if (input.hasParking) {
    plan.push(slot('PARKING_GENERAL', 'Estacionamiento', 'Estacionamiento asignado.', false));
  }

  return plan.map((s, idx) => ({ ...s, sortOrder: idx }));
}
