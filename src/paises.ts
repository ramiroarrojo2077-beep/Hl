export interface Pais {
  codigo: string; // ISO 3166-1 alfa-2
  nombre: string;
  moneda: string; // ISO 4217
  zonaHoraria: string;
}

export const PAISES: Pais[] = [
  { codigo: "AR", nombre: "Argentina", moneda: "ARS", zonaHoraria: "America/Argentina/Buenos_Aires" },
  { codigo: "BO", nombre: "Bolivia", moneda: "BOB", zonaHoraria: "America/La_Paz" },
  { codigo: "BR", nombre: "Brasil", moneda: "BRL", zonaHoraria: "America/Sao_Paulo" },
  { codigo: "CL", nombre: "Chile", moneda: "CLP", zonaHoraria: "America/Santiago" },
  { codigo: "CO", nombre: "Colombia", moneda: "COP", zonaHoraria: "America/Bogota" },
  { codigo: "CR", nombre: "Costa Rica", moneda: "CRC", zonaHoraria: "America/Costa_Rica" },
  { codigo: "EC", nombre: "Ecuador", moneda: "USD", zonaHoraria: "America/Guayaquil" },
  { codigo: "SV", nombre: "El Salvador", moneda: "USD", zonaHoraria: "America/El_Salvador" },
  { codigo: "ES", nombre: "España", moneda: "EUR", zonaHoraria: "Europe/Madrid" },
  { codigo: "US", nombre: "Estados Unidos", moneda: "USD", zonaHoraria: "America/New_York" },
  { codigo: "GT", nombre: "Guatemala", moneda: "GTQ", zonaHoraria: "America/Guatemala" },
  { codigo: "HN", nombre: "Honduras", moneda: "HNL", zonaHoraria: "America/Tegucigalpa" },
  { codigo: "MX", nombre: "México", moneda: "MXN", zonaHoraria: "America/Mexico_City" },
  { codigo: "NI", nombre: "Nicaragua", moneda: "NIO", zonaHoraria: "America/Managua" },
  { codigo: "PA", nombre: "Panamá", moneda: "USD", zonaHoraria: "America/Panama" },
  { codigo: "PY", nombre: "Paraguay", moneda: "PYG", zonaHoraria: "America/Asuncion" },
  { codigo: "PE", nombre: "Perú", moneda: "PEN", zonaHoraria: "America/Lima" },
  { codigo: "PR", nombre: "Puerto Rico", moneda: "USD", zonaHoraria: "America/Puerto_Rico" },
  { codigo: "DO", nombre: "República Dominicana", moneda: "DOP", zonaHoraria: "America/Santo_Domingo" },
  { codigo: "UY", nombre: "Uruguay", moneda: "UYU", zonaHoraria: "America/Montevideo" },
  { codigo: "VE", nombre: "Venezuela", moneda: "VES", zonaHoraria: "America/Caracas" },
  { codigo: "CA", nombre: "Canadá", moneda: "CAD", zonaHoraria: "America/Toronto" },
  { codigo: "GB", nombre: "Reino Unido", moneda: "GBP", zonaHoraria: "Europe/London" },
  { codigo: "DE", nombre: "Alemania", moneda: "EUR", zonaHoraria: "Europe/Berlin" },
  { codigo: "FR", nombre: "Francia", moneda: "EUR", zonaHoraria: "Europe/Paris" },
  { codigo: "IT", nombre: "Italia", moneda: "EUR", zonaHoraria: "Europe/Rome" },
  { codigo: "PT", nombre: "Portugal", moneda: "EUR", zonaHoraria: "Europe/Lisbon" },
  { codigo: "CN", nombre: "China", moneda: "CNY", zonaHoraria: "Asia/Shanghai" },
  { codigo: "IN", nombre: "India", moneda: "INR", zonaHoraria: "Asia/Kolkata" },
  { codigo: "JP", nombre: "Japón", moneda: "JPY", zonaHoraria: "Asia/Tokyo" },
  { codigo: "AU", nombre: "Australia", moneda: "AUD", zonaHoraria: "Australia/Sydney" },
];

export function buscarPais(codigo: string): Pais | undefined {
  return PAISES.find((p) => p.codigo === codigo.toUpperCase());
}
