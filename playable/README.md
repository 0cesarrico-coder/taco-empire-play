# TACO EMPIRE — Playable Ad (ETAPA E)

Playable de ~6-15s, **single-file MRAID, ≤2MB, cero peticiones de red**
(requisito duro del plan v2.1, #8 del red-team). Es una pieza APARTE
destilada del motor (`src/juego.js`) — "el prototipo ES el playable" era
falso tal cual: esto es el juego recortado a un guión de ad.

## Archivos

| Archivo | Qué es |
|---|---|
| `taco-empire-playable-en.html` | playable EN (default) — 393 KB, self-contained |
| `taco-empire-playable-es.html` | playable ES (adset hispano) — mismo binario, lang default es |
| `build.py` | regenera ambos desde motor/assets/config (`python3 playable/build.py`) |
| `smoke_playable.py` | verificación fail-closed (8 checks × 2 idiomas, playwright) |
| `src/playable.js` · `src/shell.html` | templates del build (no se sirven solos) |
| `out/` | screenshots del smoke (gitignored) |

Ambos aceptan `?lang=en|es` (override) y `?seed=N` (sim determinista, default 7).

## Hook elegido: ABUNDANCIA-MONTAÑA (Pizza Ready)

De `Brain-App-Growing/docs/radar/research-s23/l6-creativos-maestros.md`:
- §2 PR: *"I'll stack them like a mountain"* — promete MONTAÑAS de producto.
- §3: la promesa se apoya en "el número gigante SIEMPRE subiendo" y **no hay
  fake-ads en los 5 maestros**: convierten con gameplay real.

Por qué este y no rags-to-riches (BP) ni "millonario" (EV): esos dos son
promesas NARRADAS (necesitan VO/UGC encima — van en los creativos de video);
la abundancia es la única que el VERBO mismo demuestra en un playable: cada
tap paga, los billetes vuelan al HUD y se APILAN en escena (la montaña crece
con cada venta), y la renovación muestra la escala. El playable ES el juego
con ese hook al frente.

## Guión (~12s, el smoke lo recorre entero)

1. **0-1s** — escena E2 viva: fondo+carrito s7, fila formada, cliente
   entrando, primer pago ambiental (~t=0.6). Scroll-stop.
2. **1-8s** — verbo: taps al comal (flash + radiales + hit-stop + pops
   parabólicos + squash, knobs de `config §juice`); 3 taps = taco → venta →
   billetes a la montaña. Mejora **SALSA** ($30) se enciende → comprarla
   activa ×2 y el rush (clientes acelerados, "MONEY RUSH!").
3. **~10s** — **RENOVACIÓN** ($847): telón naranja → fondo local 2 →
   confeti. La promesa de escala.
4. **~12s / corte duro 14s / inactividad 3s post-guión** — CTA overlay:
   logo, "Build your taco empire!" / "¡Construye tu imperio del taco!",
   botón. Todo el overlay convierte (mraid.open → fallback window.open).
- **Autoplay de rescate**: sin toque en 2.5s, la mano fantasma juega
  (enseña el verbo); cualquier toque real toma el control.

## Economía: MISMOS números de config, tiempos comprimidos

- Todo valor económico sale de `config/game.json` aplanado por `build.py`
  (dinero_inicial 150, ingreso 6×1.14^compras×lluvia3×salsa2, taps 3,
  salsa $30 = `mejoras_costos_base[0]`, renovación $847 OBSERVED).
- Pre-warm honesto: arranca como sesión en curso (5 compras hechas — banda
  FTUE "PR 5 compras/30s" de la propia config; el FTUE de lluvia sigue activo).
- Compresiones SOLO de tiempo (permitidas en un ad): cadencia de clientes,
  cadencia del ghost, y el top-up de renovación a t=9.5 usa el patrón demo
  del MOTOR (`D.renov_regalo`: billetes = max(billetes, renovacion_costo)).

## Recorte de assets (18 de 31 del manifest, 349 KB base64)

- ENTRARON: fondo_1, fondo_2, carrito, hud_s7, placas ×3, icono_taco,
  icono_salsa, icono_taco_billetes (logo del CTA), cli_0-3 base+celebra.
- FUERA: fondo_3 (88KB, el guión termina en local 2), hud_s77 (perdió la
  decisión 👤), panel_oferta/marco_panel/chip/boton_circular/icono_gema
  (tienda-IAP: no existe en el playable), icono_comal/mesa (panel completo
  no viaja), cli_*_aburrido (sin colas largas en 12s).

## Clickthrough (PLACEHOLDER)

`build.py --click-url URL` — default
`https://play.google.com/store/apps/details?id=com.tacoempire.game` es un
**placeholder**: cada red (AppLovin/Unity/ironSource/Meta) lo reemplaza o
inyecta su macro al traficar. En MRAID real la salida es `mraid.open()`;
`window.open` es solo el fallback de preview/smoke.

## Verificar

```bash
python3 playable/build.py
PYTHONIOENCODING=utf-8 \
  /Users/macbookprocesar/Brain-App-Growing/.venv/bin/python playable/smoke_playable.py
```

8 checks fail-closed por idioma: ≤2MB · 0 errores consola · 0 red externa ·
primer frame <500ms · tap paga · CTA aparece · clickthrough dispara ·
idioma correcto. Estado actual: **SMOKE VERDE** (2026-07-14).
