// src/scoring/problemMapV2_2.js

/**
 * Define tu taxonomía canónica.
 * findingCode viene de tus detectores (ej: POSSIBLE_HUMIDITY_STAIN)
 * problemType es el tipo de riesgo (manda en scoring).
 */
export const FINDING_TO_PROBLEM_V22 = {
  // Humedad / filtración
  POSSIBLE_HUMIDITY_STAIN: "HUMIDITY_FILTRATION",
  ACTIVE_LEAK_SUSPECTED: "HUMIDITY_FILTRATION",
  SEAL_FAILURE: "HUMIDITY_FILTRATION",
  HUMIDITY_SIGNS: "HUMIDITY_FILTRATION",
  WATER_STAIN_PATTERN: "HUMIDITY_FILTRATION",

  // Cañerías
  POSSIBLE_PIPE_LEAK: "PIPE_LEAK_CORROSION",
  PIPE_CORROSION: "PIPE_LEAK_CORROSION",

  // Electricidad
  ELECTRICAL_EXPOSED_WIRING: "ELECTRICAL_RISK",
  ELECTRICAL_OVERHEAT_MARKS: "ELECTRICAL_RISK",
  ELECTRICAL_PANEL_RISK: "ELECTRICAL_RISK",

  // Estructura
  STRUCTURAL_CRACK_SUSPECTED: "STRUCTURAL_CRACK",

  // Desprendimiento
  MATERIAL_DETACHMENT: "MATERIAL_DETACHMENT",

  // Sanitario
  MOLD_SUSPECTED: "SANITARY_RISK",
  MOLD_POSSIBLE: "SANITARY_RISK",

  // Cosmético
  COSMETIC_WEAR: "COSMETIC",

  // QA / validaciones técnicas del MVP actual (penaliza como COSMETIC)
  NOT_PROPERTY_IMAGE: "COSMETIC",
  NOT_BATHROOM_IMAGE: "COSMETIC",
  PHOTO_TOO_DARK: "COSMETIC",
  PHOTO_TOO_SMALL: "COSMETIC",
  PHOTO_TOO_BLURRY: "COSMETIC",
};

export function mapFindingToProblemType(findingCode) {
  if (!findingCode) return null;
  return FINDING_TO_PROBLEM_V22[findingCode] || null;
}

