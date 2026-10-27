# Gravity 8: el bot decía "enviado" pero el mensaje no salía

Causa: al usar Gemini (u otro proveedor compatible) el modelo omite los campos `null`
de la herramienta `mensajes` (`cantidad`, `motivo`, etc.). El esquema estricto los exige,
así que cada llamada volvía como `INVALID_JSON` ("falló, falló") y el mensaje nunca llegaba a la cola.

Arreglo: `completarNulos` rellena con `null` los campos requeridos que aceptan null antes de validar
(`assets/motor/gravity/servidor.mjs`). Aplicar con `python3 aplicar.py servidor.mjs`.
