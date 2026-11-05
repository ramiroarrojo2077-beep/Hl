# Gravity NEXT · Estado de las 170 mejoras

✅ hecho y probado · 🟡 parcial (qué falta) · ⛔ falta. Estado al 4/11/2026. Detalles técnicos en `PENDIENTE.md`.

## 1. IA y agentes autónomos
1. ✅ Aprender de errores: cada error de herramienta se anota solo en `/memories/errores-recientes.md` (últimos 40); el prompt le pide revisar y dejar lecciones en `/memories/lecciones.md`; habilidad incluida «Aprender de errores».
2. ✅ Personalidades: estilo de comunicación propio (Perfil > Personalidad y estilo) además de descripción, modelo, esfuerzo, enseñanza y permisos.
3. ✅ Director: los managers coordinan, delegan y reciben resultados; Architect arma el equipo con un manager.
4. ✅ Equipos automáticos según el proyecto: Gravity Architect (#/arquitecto).
5. ✅ Compañeros que proponen compañeros: herramienta `equipo_nuevo` (proponer con Architect; crear pide aprobación siempre, aunque esté «Aprobar todo solo»).
6. ✅ Debates: reuniones tipo Debate con propuestas, críticas y votación.
7. 🟡 Memoria compartida: carpeta de equipo + `recordar` (cada uno ve la suya y la de su equipo, no la de otros). Falta permiso por recuerdo.
8. 🟡 Especialización progresiva: memoria persistente + lecciones. Falta un resumen automático de lo aprendido por proyecto.
9. ✅ Revisión cruzada: habilidad incluida y automática en proyectos (lo que completa un miembro pasa a «verificando» y lo revisa el coordinador; si falta algo vuelve al autor).
10. ✅ Investigación profunda: habilidad incluida (varias fuentes verificadas, informe con citas).

## 2. Robots 3D y llamadas
11. ✅ Robot 3D (cabeza, brazos, manos con dedos, torso, articulaciones) con three.js.
12. ✅ Animaciones sincronizadas con la envolvente real del audio.
13. ✅ Emociones sin boca: estados escuchando, pensando, hablando, entusiasmado, esperando.
14. 🟡 Personalizable: color, expresividad, calidad, voz y velocidad. Faltan accesorios y estilos.
15. ⛔ Sala holográfica con varios robots.
16. ✅ Voz en tiempo real con interrupción (tocar al robot).
17. ✅ Fotos durante la llamada (botón Foto): se achica, se guarda en llamadas/ y el compañero la mira con Gemini y la comenta en voz.
18. ✅ Cámara: el botón Foto abre la cámara o la galería solo cuando lo tocás (permiso explícito). Falta video en vivo.
19. 🟡 Voces por compañero (las del sistema). Falta tono/estilo.
20. ✅ Resumen automático al cortar (si hubo charla): el compañero deja en el chat decisiones, notas y tareas.

## 3. Automatizaciones
21. ✅ Misiones: proyectos con tareas y dependencias + Architect que divide el objetivo.
22. ⛔ Infraestructura remota.
23. ⛔ Editor visual de nodos.
24. ✅ Automatizaciones condicionales (Ajustes > Automatizaciones): si una tarea queda bloqueada, falla o se completa, o termina una reunión → un compañero hace lo indicado (una vez por evento, tope 20/hora).
25. ✅ Investigaciones programadas: rutina + habilidad Investigación profunda.
26. ✅ Aprobaciones antes de acciones sensibles.
27. ✅ Tareas bloqueadas: la auditoría las detecta, avisan por notificación y una automatización «tarea bloqueada» puede pedirle a un compañero que proponga la solución.
28. ✅ Historial de acciones por compañero (Operaciones > Actividad reciente).
29. 🟡 Reintentos: mensajes con reintento controlado, colas que sobreviven reinicios. Falta para tareas largas.
30. ✅ Presupuestos: tope diario global y por compañero, gasto por compañero.

## 4. Programación
31. ⛔ Gravity Studio. 32. 🟡 Equipos de programación (Architect puede armarlos; la computadora tiene terminal). 33. ✅ Editor de archivos de texto en la Computadora (también en el celular), sin pisar cambios de un compañero. 34. ✅ Vista previa web de páginas de la computadora (marco aislado: sin acceso a Gravity ni a sesiones). 35. ⛔ Detección automática de errores de código. 36. ⛔ Generar interfaces. 37. 🟡 GitHub: por conexión MCP. 38. 🟡 Versiones: copia de seguridad completa; falta por archivo. 39. ⛔ Pruebas aisladas. 40. 🟡 Exportar: copia .zip completa.

## 5. Android
41. ✅ Widget de inicio (compañeros trabajando y aprobaciones; lo actualiza el servicio del motor; abre Operaciones). 42. ✅ Notificaciones de aprobaciones y de tareas bloqueadas o fallidas (desde el servicio nativo, con la app cerrada). 43. ✅ Accesos rápidos del ícono. 44. 🟡 Offline: todo corre en el celular; solo el modelo necesita internet. 45. ✅ Compartir a Gravity. 46. ⛔ Comandos de voz fuera de llamadas. 47. ✅ Panel de rendimiento (CPU, memoria, batería). 48. ⛔ Sincronización entre dispositivos (se puede exportar/importar). 49. ✅ Copias de seguridad. 50. ✅ Modo privado (menú ⋮): huella, rostro o PIN al abrir o volver después de 1 minuto (Android 9+).

## 6. Experimentales
51. ⛔ Gravity Universe. 52. ✅ Laboratorio (#/laboratorio): misma consulta con Automático/Rápido/Potente y la personalidad de un compañero, lado a lado. 53. ⛔ Mercado de habilidades (hay habilidades locales). 54. ⛔ Simulador. 55. ⛔ Mapa de conocimiento. 56. ✅ Agentes temporales. 57. ✅ Modo enseñanza. 58. ✅ Auditor. 59. ✅ Centro de operaciones. 60. ✅ Gravity Architect.

## 7. Visual
61–64. ✅ Estilo «Cristal» opcional (Ajustes > Estilo): azul profundo, paneles translúcidos con desenfoque, brillos cian/violeta moderados (respeta «reducir transparencia»). Tema clásico oscuro/claro sigue igual. 65. 🟡 Transición suave al cambiar de pantalla en el estilo Cristal (respeta «reducir movimiento»). 66. ⛔ Logo 3D animado. 67. 🟡 Centro de operaciones hace de panel. 68. ✅ Tarjetas con estado. 69. ✅ Navegación inferior en el celular. 70. ✅ Íconos propios. 71. ✅ Indicadores de actividad. 72. ✅ Gráfico de productividad animado (respeta «reducir movimiento»). 73. ✅ Tema claro/oscuro y estilo Clásico/Cristal. 74. ✅ Adaptable (360 px a escritorio). 75. 🟡 Calidad del robot adaptable.

## 8. Robot 3D
76–82. ✅ (cuerpo, iluminación, movimientos independientes, estados, gestos con pausas e intensidad, ojos). 78. 🟡 símbolo en el pecho: verificar. 83. 🟡 Reacciones al terminar. 84. 🟡 Saludo. 85. ✅ Girar al robot arrastrando el dedo. 86. 🟡 Personalización (color). 87. 🟡 Estilo por expresividad. 88–90. ✅.

## 9. Reuniones
91. ✅ 92. ✅ 93. ✅ 94. ✅ (Debate) 95. ✅ (votación) 96. ✅ 97. ✅ 98. ✅ 99. ✅ (pausar/reanudar/terminar) 100. ⛔ Robots en la sala.

## 10. Memoria
101. ✅ 102. 🟡 (carpeta de equipo) 103. ✅ Memoria por proyecto (su carpeta; `recordar` la ve solo quien coordina o tiene tareas ahí) 104. ✅ Búsqueda semántica con embeddings de Gemini (si hay clave) combinada con BM25; vectores en caché 105–106. ✅ Habilidad incluida «Ordenar la memoria» (junta lo repetido, borra lo viejo, deja índice; se puede programar semanal) 107. ✅ (compactación del servidor) 108. ✅ (pestaña Memoria) 109. ✅ (copia) 110. 🟡.

## 11. Integraciones
111. 🟡 WhatsApp por notificaciones; la API oficial necesita URL pública. 112. ✅ Telegram (bot oficial). 113. ✅ Gmail (IMAP/SMTP). 114–116. 🟡 por MCP / Microsoft 365. 117. ✅ MCP. 118. ✅ Webhooks entrantes (Ajustes > Webhooks: URL secreta /api/gancho/<token>, 30 por hora, datos como contenido de afuera; desde el celular necesita túnel). 119. ✅ Claves cifradas (Keystore en el celular). 120. 🟡 Panel de Conexiones.

## 12. Modelos
121. ✅ Claude, Gemini, Groq, Mistral. 122. ✅ Modelo por compañero (Automático/Rápido/Potente). 123. ✅ Cambiar el modelo en medio de la conversación (selector Auto/Rápido/Potente en la cabecera del chat). 124. 🟡 Mensajes y llamadas usan el rápido. 125. ✅ Comparar respuestas entre modelos (Laboratorio). 126–127. ✅ consumo por compañero. 128–129. ✅ Servidor propio compatible con OpenAI (Ollama, LM Studio, vLLM): `GRAVITY_LOCAL_URL`, `GRAVITY_LOCAL_MODELOS`, `GRAVITY_LOCAL_CLAVE`; va primero en la cadena y, si falla, siguen los demás. En el celular: campo «Respaldo» de la pantalla de claves con `http://IP:11434/v1#modelo`. 130. ✅ Cadena de respaldo entre proveedores.

## 13. Seguridad
131. ✅ 132. ✅ 133. ✅ 134. ✅ 135. ✅ (contenido de afuera envuelto, suplantación neutralizada; ver PENDIENTE: pruebas de inyección a revisar) 136. ✅ 137. ✅ (Android vuelve a prender el motor) 138. 🟡 139. 🟡 140. ⛔ 141. ✅ 142. 🟡 143. ✅ (migraciones en almacen.ts) 144. ✅ (11 pruebas + e2e) 145. 🟡 (restaurar copia).

## 14. Experiencia
146. ✅ Buscador global. 147. ✅ Actividad en vivo. 148. ✅ Historial. 149. ✅ Favoritos (compañeros; aparecen primero). 150. ✅ Etiquetas en proyectos (con filtro). 151. ✅ Prioridades en tareas. 152. ✅ Recordatorios de una sola vez (rutina «Una sola vez»; los compañeros también los programan con la herramienta rutinas). 153. ✅ Productividad de 7 días por compañero (Operaciones) 154. ✅ Primeros pasos en Operaciones (se marcan solos, con atajos; se pueden ocultar) 155. ✅ Diagnóstico en Ajustes («Probar el modelo» con la causa del error) + Rendimiento y Auditoría 156. 🟡 (accesibilidad básica: roles, contraste) 157. ⛔ 158. ✅ Notificaciones configurables (aprobaciones y tareas trabadas) 159. ✅ Panel de novedades en Ajustes 160. 🟡 (auditoría).

## 15. Conservación
161–170. ✅ Se mantiene todo lo anterior, con migraciones, copias y versiones en git. 168: los botones nuevos tienen función y prueba. 169: nada simulado (el robot 2D avisa si no hay 3D; la voz avisa si no hay).
