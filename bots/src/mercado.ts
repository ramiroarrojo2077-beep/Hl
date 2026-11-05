// Mercado de habilidades: un catálogo de procedimientos revisados que viene con Gravity (no se descarga
// nada de afuera). Instalar una la copia a las habilidades del usuario, donde se puede editar.

import { guardarHabilidad, listarHabilidades } from "./almacen.ts";

export interface Ficha { id: string; nombre: string; categoria: string; descripcion: string; instrucciones: string }

export const CATALOGO: Ficha[] = [
  { id: "reclamos", categoria: "Atención", nombre: "Responder reclamos de clientes", descripcion: "Contestar un reclamo con empatía, una solución concreta y sin prometer lo que no se puede.",
    instrucciones: "1. Leé el reclamo completo y la conversación previa.\n2. Identificá el problema real y lo que la persona espera.\n3. Respondé: reconocé el problema en una oración, explicá qué vas a hacer y cuándo, y qué necesitás de ella.\n4. Nunca prometas reembolsos, descuentos o plazos que el usuario no autorizó: si hacen falta, derivá.\n5. Tono cálido y corto. Sin culpar a nadie." },
  { id: "propuesta", categoria: "Ventas", nombre: "Preparar una propuesta comercial", descripcion: "Propuesta clara con problema, solución, alcance, precio y próximos pasos.",
    instrucciones: "1. Reuní: cliente, problema, objetivo, plazo y presupuesto (preguntá lo que falte).\n2. Estructura: resumen (3 líneas), el problema en palabras del cliente, la solución, qué incluye y qué no, plazos, precio con condiciones, próximos pasos.\n3. Si no tenés el precio, dejalo como [PRECIO] para que lo complete el usuario.\n4. Guardala en propuestas/<cliente>-<fecha>.md y pasá la ruta." },
  { id: "semanal", categoria: "Equipo", nombre: "Resumen semanal del equipo", descripcion: "Qué se hizo, qué sigue y qué está trabado, en una página.",
    instrucciones: "1. Revisá las tareas y proyectos de la semana (y las actas de reuniones).\n2. Escribí: logros (con resultados concretos), en curso, bloqueos (con qué hace falta para destrabar) y prioridades de la semana próxima.\n3. Una página como máximo, en viñetas. Guardalo en resumenes/semana-<fecha>.md.\n4. Ideal como rutina semanal (viernes)." },
  { id: "contrato", categoria: "Legal", nombre: "Revisar un contrato (riesgos)", descripcion: "Señalar cláusulas riesgosas y preguntas para un abogado. No es asesoramiento legal.",
    instrucciones: "1. Leé el contrato completo.\n2. Listá: partes, objeto, plazos, montos y forma de pago, renovación, rescisión, penalidades, confidencialidad, propiedad intelectual, jurisdicción.\n3. Marcá lo inusual o desequilibrado, con la cláusula citada y por qué preocupa.\n4. Terminá con preguntas para un abogado. Aclarale al usuario que no es asesoramiento legal." },
  { id: "contenido", categoria: "Marketing", nombre: "Plan de contenido para redes", descripcion: "Calendario de publicaciones de 2 semanas con ideas, textos y formatos.",
    instrucciones: "1. Preguntá: marca, público, objetivo, redes y frecuencia.\n2. Armá 2 semanas: por día, red, formato (video corto, carrusel, historia), idea, texto y llamado a la acción.\n3. Mezclá: 60 % valor, 30 % comunidad, 10 % venta.\n4. Guardalo como planilla contenido/plan-<fecha>.csv.\n5. Publicar siempre pide aprobación." },
  { id: "ventas", categoria: "Datos", nombre: "Analizar una planilla de ventas", descripcion: "Totales, tendencias, mejores y peores productos, y 3 conclusiones accionables.",
    instrucciones: "1. Abrí la planilla y revisá columnas y datos raros (vacíos, duplicados, fechas mal).\n2. Calculá con un script (no a mano): total por mes, por producto y por canal; variación contra el período anterior.\n3. Top 5 y bottom 5 productos.\n4. Guardá el script y los resultados en analisis/<fecha>/.\n5. Terminá con 3 conclusiones accionables y qué datos faltarían para más certeza." },
  { id: "reunion", categoria: "Equipo", nombre: "Preparar una reunión", descripcion: "Agenda con objetivo, tiempos, material previo y decisiones a tomar.",
    instrucciones: "1. Definí el objetivo en una oración y qué decisión tiene que salir.\n2. Agenda con tiempos (máximo 45 minutos) y quién habla en cada punto.\n3. Juntá el material previo (cifras, documentos) y resumilo en 5 líneas.\n4. Si es con compañeros de Gravity, convocala con la herramienta reunion (tipo debate si hay que elegir entre opciones)." },
  { id: "correo", categoria: "Comunicación", nombre: "Escribir un correo profesional", descripcion: "Correo claro: asunto concreto, pedido en la primera línea, cierre con próximo paso.",
    instrucciones: "1. Asunto concreto (qué y para cuándo).\n2. Primera línea: el pedido o la noticia.\n3. Contexto en 2 o 3 oraciones; datos en viñetas.\n4. Cierre con el próximo paso y la fecha.\n5. Mandarlo siempre pide aprobación: mostrá el borrador antes." },
  { id: "depurar", categoria: "Programación", nombre: "Depurar un error de código", descripcion: "Reproducir, aislar, arreglar y verificar con una prueba.",
    instrucciones: "1. Reproducí el error con un comando y guardá la salida.\n2. Leé el mensaje y la traza: ubicá el archivo y la línea.\n3. Formulá una hipótesis y verificála (agregá un print o una prueba mínima).\n4. Arreglá lo mínimo, sin tocar lo que no hace falta.\n5. Corré la prueba de nuevo y las pruebas existentes.\n6. Contá la causa, el arreglo y cómo se verificó." },
  { id: "lanzamiento", categoria: "Proyectos", nombre: "Plan de lanzamiento", descripcion: "Lanzar un producto o servicio en etapas, con responsables y fechas.",
    instrucciones: "1. Objetivo medible y fecha.\n2. Etapas: preparación, prueba con pocos, lanzamiento, seguimiento.\n3. Tareas por etapa con responsable, dependencia y criterio de listo: creá el proyecto con la herramienta proyectos.\n4. Riesgos y plan B.\n5. Métricas a mirar la primera semana." },
];

export function vistaMercado() {
  const instaladas = new Set(listarHabilidades().map((h) => h.nombre));
  return CATALOGO.map((f) => ({ id: f.id, nombre: f.nombre, categoria: f.categoria, descripcion: f.descripcion, instalada: instaladas.has(f.nombre) }));
}

export function instalarDelMercado(id: string) {
  const f = CATALOGO.find((x) => x.id === id);
  if (!f) throw new Error("No existe esa habilidad en el catálogo.");
  return guardarHabilidad({ nombre: f.nombre, descripcion: f.descripcion, instrucciones: f.instrucciones });
}
