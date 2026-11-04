# Gravity NEXT · Estado de las 170 mejoras

✅ hecho y probado · 🟡 parcial (qué falta) · ⛔ falta. Estado al 4/11/2026. Detalles técnicos en `PENDIENTE.md`.

## 1. IA y agentes autónomos
1. 🟡 Aprender de errores: habilidad incluida «Aprender de errores» (lecciones en `/memories/lecciones.md`) + historial de acciones con errores. Falta que se dispare sola después de cada error.
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
17. ⛔ Imágenes durante la llamada (el chat sí acepta archivos).
18. ⛔ Modo cámara.
19. 🟡 Voces por compañero (las del sistema). Falta tono/estilo.
20. ✅ Resumen automático al cortar (si hubo charla): el compañero deja en el chat decisiones, notas y tareas.

## 3. Automatizaciones
21. ✅ Misiones: proyectos con tareas y dependencias + Architect que divide el objetivo.
22. ⛔ Infraestructura remota.
23. ⛔ Editor visual de nodos.
24. 🟡 Condicionales: rutinas + tareas con dependencias. Falta «si pasa X, hacé Y».
25. ✅ Investigaciones programadas: rutina + habilidad Investigación profunda.
26. ✅ Aprobaciones antes de acciones sensibles.
27. 🟡 Tareas bloqueadas: la auditoría las detecta y se puede pedir análisis a un compañero. Falta propuesta automática.
28. ✅ Historial de acciones por compañero (Operaciones > Actividad reciente).
29. 🟡 Reintentos: mensajes con reintento controlado, colas que sobreviven reinicios. Falta para tareas largas.
30. ✅ Presupuestos: tope diario global y por compañero, gasto por compañero.

## 4. Programación
31. ⛔ Gravity Studio. 32. 🟡 Equipos de programación (Architect puede armarlos; la computadora tiene terminal). 33. 🟡 Editor: la Computadora muestra archivos; falta editar desde la interfaz. 34. ⛔ Vista previa web. 35. ⛔ Detección automática de errores de código. 36. ⛔ Generar interfaces. 37. 🟡 GitHub: por conexión MCP. 38. 🟡 Versiones: copia de seguridad completa; falta por archivo. 39. ⛔ Pruebas aisladas. 40. 🟡 Exportar: copia .zip completa.

## 5. Android
41. ⛔ Widget. 42. ✅ Notificaciones de aprobaciones y de tareas bloqueadas o fallidas (desde el servicio nativo, con la app cerrada). 43. ✅ Accesos rápidos del ícono. 44. 🟡 Offline: todo corre en el celular; solo el modelo necesita internet. 45. ✅ Compartir a Gravity. 46. ⛔ Comandos de voz fuera de llamadas. 47. ✅ Panel de rendimiento (CPU, memoria, batería). 48. ⛔ Sincronización entre dispositivos (se puede exportar/importar). 49. ✅ Copias de seguridad. 50. ⛔ Modo privado con huella.

## 6. Experimentales
51. ⛔ Gravity Universe. 52. ⛔ Laboratorio. 53. ⛔ Mercado de habilidades (hay habilidades locales). 54. ⛔ Simulador. 55. ⛔ Mapa de conocimiento. 56. ✅ Agentes temporales. 57. ✅ Modo enseñanza. 58. ✅ Auditor. 59. ✅ Centro de operaciones. 60. ✅ Gravity Architect.

## 7. Visual
61–64. 🟡 Tema oscuro/claro con cian y naranja; diseño de referencia en el lienzo «Gravity · Interfaz profesional». Faltan efectos de cristal y neón. 65. 🟡 Transiciones básicas. 66. ⛔ Logo 3D animado. 67. 🟡 Centro de operaciones hace de panel. 68. ✅ Tarjetas con estado. 69. ✅ Navegación inferior en el celular. 70. ✅ Íconos propios. 71. ✅ Indicadores de actividad. 72. ⛔ Gráficos animados. 73. 🟡 Tema claro/oscuro. 74. ✅ Adaptable (360 px a escritorio). 75. 🟡 Calidad del robot adaptable.

## 8. Robot 3D
76–82. ✅ (cuerpo, iluminación, movimientos independientes, estados, gestos con pausas e intensidad, ojos). 78. 🟡 símbolo en el pecho: verificar. 83. 🟡 Reacciones al terminar. 84. 🟡 Saludo. 85. ⛔ Cambiar ángulo de cámara. 86. 🟡 Personalización (color). 87. 🟡 Estilo por expresividad. 88–90. ✅.

## 9. Reuniones
91. ✅ 92. ✅ 93. ✅ 94. ✅ (Debate) 95. ✅ (votación) 96. ✅ 97. ✅ 98. ✅ 99. ✅ (pausar/reanudar/terminar) 100. ⛔ Robots en la sala.

## 10. Memoria
101. ✅ 102. 🟡 (carpeta de equipo) 103. 🟡 (carpeta por proyecto) 104. 🟡 búsqueda de texto (BM25), no semántica 105. ⛔ 106. 🟡 (sin duplicados en resultados) 107. ✅ (compactación del servidor) 108. ✅ (pestaña Memoria) 109. ✅ (copia) 110. 🟡.

## 11. Integraciones
111. 🟡 WhatsApp por notificaciones; la API oficial necesita URL pública. 112. ✅ Telegram (bot oficial). 113. ✅ Gmail (IMAP/SMTP). 114–116. 🟡 por MCP / Microsoft 365. 117. ✅ MCP. 118. ✅ Webhooks entrantes (Ajustes > Webhooks: URL secreta /api/gancho/<token>, 30 por hora, datos como contenido de afuera; desde el celular necesita túnel). 119. ✅ Claves cifradas (Keystore en el celular). 120. 🟡 Panel de Conexiones.

## 12. Modelos
121. ✅ Claude, Gemini, Groq, Mistral. 122. ✅ Modelo por compañero (Automático/Rápido/Potente). 123. ⛔ Cambiar en medio de la conversación (se cambia en el Perfil). 124. 🟡 Mensajes y llamadas usan el rápido. 125. ⛔ Comparar. 126–127. ✅ consumo por compañero. 128–129. ⛔ (se puede con un servidor compatible OpenAI: falta configuración). 130. ✅ Cadena de respaldo entre proveedores.

## 13. Seguridad
131. ✅ 132. ✅ 133. ✅ 134. ✅ 135. ✅ (contenido de afuera envuelto, suplantación neutralizada; ver PENDIENTE: pruebas de inyección a revisar) 136. ✅ 137. ✅ (Android vuelve a prender el motor) 138. 🟡 139. 🟡 140. ⛔ 141. ✅ 142. 🟡 143. ✅ (migraciones en almacen.ts) 144. ✅ (11 pruebas + e2e) 145. 🟡 (restaurar copia).

## 14. Experiencia
146. ✅ Buscador global. 147. ✅ Actividad en vivo. 148. ✅ Historial. 149. ✅ Favoritos (compañeros; aparecen primero). 150. ⛔ Etiquetas. 151. ✅ Prioridades en tareas. 152. 🟡 Recordatorios por rutinas. 153. ⛔ 154. ⛔ 155. 🟡 (Rendimiento y Auditoría) 156. 🟡 (accesibilidad básica: roles, contraste) 157. ⛔ 158. ⛔ 159. ⛔ 160. 🟡 (auditoría).

## 15. Conservación
161–170. ✅ Se mantiene todo lo anterior, con migraciones, copias y versiones en git. 168: los botones nuevos tienen función y prueba. 169: nada simulado (el robot 2D avisa si no hay 3D; la voz avisa si no hay).
