# Precio de Fábrica

App web que, para cualquier producto, estima:

1. **El precio de fábrica**: lo que cobra el fabricante por unidad comprando por volumen (FOB/EXW), con pedido mínimo y origen.
2. **Lo que debería costar en tu país**: precio de fábrica + flete y seguro + aranceles + tasas + IVA y otros impuestos + un margen razonable de comercio, en moneda local.
3. **A cuánto se vende hoy en tu país**, y si está caro, barato o razonable comparado con lo anterior.

Usa IA (Claude con búsqueda web) para buscar en mayoristas y fabricantes (Alibaba, Made-in-China, 1688, Global Sources, IndiaMART…), en las reglas de importación del país elegido y en tiendas locales. Muestra el progreso en vivo y las fuentes consultadas.

## Uso

Requiere Node.js 22.18 o superior y una API key de Anthropic.

```bash
npm install
cp .env.example .env   # y completá ANTHROPIC_API_KEY
npm start
```

Abrí http://localhost:3000, escribí el producto, elegí el país y tocá **Buscar**.

## Configuración

| Variable | Default | Para qué |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Obligatoria |
| `PORT` | `3000` | Puerto del servidor |
| `PRECIO_MODELO` | `claude-opus-5-5` | Modelo de Claude |
| `PRECIO_ESFUERZO` | `low` | `low` es lo más rápido; `medium` o `high` dan estimaciones más cuidadas pero tardan más |

Las búsquedas repetidas (mismo producto y país) se guardan en memoria 6 horas y responden al instante.

## Estructura

- `src/server.ts`: servidor HTTP. Sirve la página y `GET /api/buscar?producto=…&pais=AR`, que devuelve el progreso y el resultado como eventos SSE.
- `src/buscador.ts`: consulta a Claude con búsqueda web y valida el resultado contra un esquema.
- `src/paises.ts`: países disponibles con su moneda.
- `public/index.html`: interfaz.

`npm run check` corre el chequeo de tipos.

## Aclaración

Los resultados son estimaciones hechas con fuentes públicas, no cotizaciones formales. Antes de comprar o importar, confirmá con el proveedor y con un despachante de aduana.
