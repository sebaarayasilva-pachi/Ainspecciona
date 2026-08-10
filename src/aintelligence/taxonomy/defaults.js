/** Catálogo inicial — editable desde Admin → Taxonomía. */

export const TAXONOMY_KPIS = [
  'TERMINACIONES',
  'SANITARIOS',
  'ELECTRICIDAD',
  'HUMEDAD',
  'PISOS',
  'VENTANAS_CERRAMIENTOS',
  'PUERTAS_HERRAJES',
  'MOBILIARIO_FIJO',
  'ESTRUCTURA',
  'GAS',
  'FACHADAS_EXTERIORES',
  'CLIMATIZACION',
  'IMPERMEABILIZACION',
  'DOCUMENTOS_CUMPLIMIENTO',
  'AREAS_COMUNES',
  'OTROS'
];

export const TAXONOMY_MIRADAS = [
  { id: 'EJECUCION_OBRA', label: 'Ejecución de obra (Entrega / Postventa)' },
  { id: 'DETERIORO_USO', label: 'Deterioro en el tiempo (Ainspecciona / Property-chk)' }
];

export const DEFAULT_TAXONOMY_ENTRIES = [
  {
    id: 'terminaciones.pintura_muro',
    kpi: 'TERMINACIONES',
    subfamilia: 'pintura_muro',
    label: 'Pintura en muros y cielos',
    miradas: ['EJECUCION_OBRA', 'DETERIORO_USO'],
    aliasAinspecciona: 'MUROS_PINTURA',
    aliasPostventa: 'pintura_muros_cielos',
    aliasEntregaKpi: 'Terminaciones',
    aliasEntregaEspecialidades: 'Pintor, Yesero',
    notasEjecucion: 'Defecto de aplicación, adherencia o terminación en obra nueva.',
    notasDeterioro: 'Desgaste por uso, rayados o manchas; considerar antigüedad del inmueble.',
    status: 'draft'
  },
  {
    id: 'terminaciones.guardapolvo',
    kpi: 'TERMINACIONES',
    subfamilia: 'guardapolvo',
    label: 'Guardapolvo / zócalo',
    miradas: ['EJECUCION_OBRA'],
    aliasAinspecciona: '',
    aliasPostventa: '',
    aliasEntregaKpi: 'Terminaciones',
    aliasEntregaEspecialidades: 'Instalador de guardapolvos, Carpintero terminaciones',
    notasEjecucion: 'Faltante, mal cortado o despegado en entrega.',
    notasDeterioro: '',
    status: 'draft'
  },
  {
    id: 'humedad.filtracion',
    kpi: 'HUMEDAD',
    subfamilia: 'filtracion',
    label: 'Filtración / humedad',
    miradas: ['EJECUCION_OBRA', 'DETERIORO_USO'],
    aliasAinspecciona: 'HUMEDAD',
    aliasPostventa: 'humedad_filtracion',
    aliasEntregaKpi: 'Instalaciones Sanitarias',
    aliasEntregaEspecialidades: 'Gasfiter, Impermeabilizador',
    notasEjecucion: 'Filtración por mala ejecución de sellos, impermeabilización o instalación.',
    notasDeterioro: 'Humedad por falta de mantenimiento, condensación o uso prolongado.',
    status: 'draft'
  },
  {
    id: 'sanitarios.griferia_filtracion',
    kpi: 'SANITARIOS',
    subfamilia: 'griferia_filtracion',
    label: 'Grifería y filtraciones sanitarias',
    miradas: ['EJECUCION_OBRA', 'DETERIORO_USO'],
    aliasAinspecciona: 'SANITARIOS',
    aliasPostventa: 'sanitarios',
    aliasEntregaKpi: 'Instalaciones Sanitarias',
    aliasEntregaEspecialidades: 'Gasfiter',
    notasEjecucion: 'Goteo, mala conexión o instalación defectuosa en entrega.',
    notasDeterioro: 'Desgaste de empaquetaduras o grifería por uso.',
    status: 'draft'
  },
  {
    id: 'electricidad.instalacion_visible',
    kpi: 'ELECTRICIDAD',
    subfamilia: 'instalacion_visible',
    label: 'Instalación eléctrica visible',
    miradas: ['EJECUCION_OBRA', 'DETERIORO_USO'],
    aliasAinspecciona: 'ELECTRICIDAD',
    aliasPostventa: 'electricidad_visible',
    aliasEntregaKpi: 'Instalaciones Eléctricas',
    aliasEntregaEspecialidades: 'Electricista',
    notasEjecucion: 'Enchufe suelto, cableado mal terminado, placa mal fijada.',
    notasDeterioro: 'Desgaste por uso; evaluar si es mantenimiento del propietario.',
    status: 'draft'
  },
  {
    id: 'pisos.revestimiento',
    kpi: 'PISOS',
    subfamilia: 'revestimiento',
    label: 'Pisos y revestimientos',
    miradas: ['EJECUCION_OBRA', 'DETERIORO_USO'],
    aliasAinspecciona: 'PISOS',
    aliasPostventa: 'pisos',
    aliasEntregaKpi: 'Terminaciones',
    aliasEntregaEspecialidades: 'Instalador de cerámica, Instalador de porcelanato, Instalador de piso flotante',
    notasEjecucion: 'Trizadura, hueco, desnivel o mala colocación en entrega.',
    notasDeterioro: 'Rayado o desgaste por tránsito y antigüedad.',
    status: 'draft'
  },
  {
    id: 'ventanas.sello_cerramiento',
    kpi: 'VENTANAS_CERRAMIENTOS',
    subfamilia: 'sello_cerramiento',
    label: 'Ventanas, sellos y cerramientos',
    miradas: ['EJECUCION_OBRA', 'DETERIORO_USO'],
    aliasAinspecciona: 'VENTANAS_CERRAMIENTOS',
    aliasPostventa: 'ventanas_sellos',
    aliasEntregaKpi: 'Ventanas y Cerramientos',
    aliasEntregaEspecialidades: 'Aluminiero, Sellador de juntas y silicona',
    notasEjecucion: 'Sello deficiente, marco mal instalado, filtración en entrega.',
    notasDeterioro: 'Degradación de sellos por sol y tiempo.',
    status: 'draft'
  },
  {
    id: 'puertas.cerradura_herraje',
    kpi: 'PUERTAS_HERRAJES',
    subfamilia: 'cerradura_herraje',
    label: 'Puertas, cerraduras y herrajes',
    miradas: ['EJECUCION_OBRA', 'DETERIORO_USO'],
    aliasAinspecciona: 'PUERTAS_HERRAJES',
    aliasPostventa: 'puertas_cerraduras',
    aliasEntregaKpi: 'Terminaciones',
    aliasEntregaEspecialidades: 'Instalador de quincallería, Carpintero terminaciones',
    notasEjecucion: 'Puerta desajustada, cerradura mal instalada en entrega.',
    notasDeterioro: 'Desgaste mecánico por uso.',
    status: 'draft'
  },
  {
    id: 'mobiliario.fijo_cocina',
    kpi: 'MOBILIARIO_FIJO',
    subfamilia: 'fijo_cocina',
    label: 'Mobiliario fijo y cocina',
    miradas: ['EJECUCION_OBRA', 'DETERIORO_USO'],
    aliasAinspecciona: 'MOBILIARIO_FIJO',
    aliasPostventa: 'muebles_closets_cocina',
    aliasEntregaKpi: 'Terminaciones',
    aliasEntregaEspecialidades: 'Mueblista, Instalador de cubiertas',
    notasEjecucion: 'Rayado en cubierta, mueble mal anclado, acabado defectuoso.',
    notasDeterioro: 'Desgaste normal de superficies por uso.',
    status: 'draft'
  },
  {
    id: 'impermeabilizacion.terraza',
    kpi: 'IMPERMEABILIZACION',
    subfamilia: 'terraza',
    label: 'Impermeabilización',
    miradas: ['EJECUCION_OBRA'],
    aliasAinspecciona: '',
    aliasPostventa: 'impermeabilizacion',
    aliasEntregaKpi: 'Fachadas y Terminaciones Exteriores',
    aliasEntregaEspecialidades: 'Impermeabilizador',
    notasEjecucion: 'Falla de membrana o detalle constructivo en entrega.',
    notasDeterioro: '',
    status: 'draft'
  }
];

export function emptyCatalog() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    kpis: [...TAXONOMY_KPIS],
    miradas: [...TAXONOMY_MIRADAS],
    entries: DEFAULT_TAXONOMY_ENTRIES.map((e) => ({ ...e }))
  };
}
