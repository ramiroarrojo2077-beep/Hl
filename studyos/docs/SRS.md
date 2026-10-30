# Repetición espaciada en StudyOS (SM-2)

StudyOS usa una variante del algoritmo **SM-2** (Piotr Woźniak, SuperMemo 2, 1987). Implementación: `src/lib/srs.ts`, pruebas: `tests/srs.test.ts`.

## Estado de cada tarjeta

| Campo | Significado |
|---|---|
| `ease` | Factor de facilidad. Empieza en 2,5 y nunca baja de 1,3. |
| `interval` | Días hasta la próxima revisión. |
| `reps` | Aciertos seguidos. |
| `lapses` | Veces que se olvidó. |
| `due` | Fecha de la próxima revisión (desde las 4 a. m. de ese día). |

## Calificación

Después de ver la respuesta el estudiante elige:

| Botón | Calidad q |
|---|---|
| Otra vez | 1 |
| Difícil | 3 |
| Bien | 4 |
| Fácil | 5 |

## Reglas

1. `ease ← max(1,3; ease + 0,1 − (5 − q)·(0,08 + (5 − q)·0,02))`
2. Si `q < 3` (fallo): `reps ← 0`, `interval ← 1`, `lapses ← lapses + 1`.
3. Si `q ≥ 3` (acierto): `reps ← reps + 1` y
   - 1.º acierto: `interval ← 1`
   - 2.º acierto: `interval ← 6`
   - siguientes: `interval ← round(interval · ease)` (con «Difícil» se multiplica por 1,2 en lugar de `ease`).
4. «Fácil» agrega un 30 % al intervalo resultante.
5. El intervalo se limita a 10 años.

Ejemplo con «Bien» siempre: 1 → 6 → 15 → 38 días.

## Retención estimada

Se supone que el intervalo se eligió para que, al vencer, se recuerde ~90 %, y que el olvido es exponencial:

R(t) = 0,9^(t / interval)

donde `t` son los días desde el último repaso. Es una **estimación del modelo**. La pantalla de cada mazo muestra además la **tasa real de aciertos**, que sale del historial de calificaciones.

## Relación con el dominio por concepto

Si la tarjeta tiene un concepto asociado, cada repaso actualiza el dominio de ese concepto (`src/lib/mastery.ts`): Bien/Fácil cuentan 1, Difícil 0,6 y Otra vez 0.
