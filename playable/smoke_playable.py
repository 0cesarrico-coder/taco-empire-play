#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
smoke_playable.py — verificación FAIL-CLOSED de los playables MRAID.

Por cada .html (EN y ES), standalone vía file://:
  1. tamaño ≤ 2 MB (bytes reales en disco)
  2. 0 errores de consola / pageerror
  3. 0 peticiones de red externas (http/https) — single-file de verdad
  4. primer canvas pintado < 500 ms (PLAYABLE.firstFrameMs, medido en el motor)
  5. tap simulado al comal → el dinero SUBE (el verbo paga)
  6. CTA aparece (guión completo: mejora → rush → renovación → CTA)
  7. tap en el CTA → clickthrough (window.open stubbeado; en red real = mraid.open)
  8. idioma correcto por archivo (EN default / ES default)

Correr:  PYTHONIOENCODING=utf-8 \
  /Users/macbookprocesar/Brain-App-Growing/.venv/bin/python playable/smoke_playable.py
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parent
OUT = RAIZ / "out"
OUT.mkdir(exist_ok=True)
MAX_BYTES = 2 * 1024 * 1024

FALLAS = []


def check(nombre, ok, detalle=""):
    tag = "OK " if ok else "FALLA"
    print(f"  [{tag}] {nombre}" + (f" — {detalle}" if detalle else ""))
    if not ok:
        FALLAS.append(f"{nombre}: {detalle}")


def probar(pw, archivo: Path, lang: str):
    print(f"\n== {archivo.name} (lang={lang}) ==")
    n = archivo.stat().st_size
    check("tamaño ≤ 2MB", n <= MAX_BYTES, f"{n:,} bytes ({n/1024:.1f} KB)")

    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": 405, "height": 720})

    consola, red_externa, popups = [], [], []
    page.on("console", lambda m: consola.append(m.text)
            if m.type == "error" else None)
    page.on("pageerror", lambda e: consola.append(str(e)))
    page.on("request", lambda r: red_externa.append(r.url)
            if r.url.startswith(("http://", "https://")) else None)
    # stub de window.open ANTES de cargar (el clickthrough no abre popup real)
    page.add_init_script(
        "window.__opens=[]; window.open=(u,t)=>{window.__opens.push(u); return null;};")

    page.goto(archivo.as_uri())
    page.wait_for_timeout(700)   # deja correr ~0.7s de sim

    ffms = page.evaluate("PLAYABLE.firstFrameMs")
    check("primer frame < 500 ms", 0 <= ffms < 500, f"{ffms} ms")
    check("idioma del build", page.evaluate("PLAYABLE.lang") == lang,
          f"esperado {lang}")

    page.screenshot(path=str(OUT / f"primer-frame-{lang}.png"))

    # --- tap simulado al comal (272,460 en canvas 540x960) ---
    page.wait_for_timeout(600)                    # front ya en 'espera'
    box = page.locator("#cv").bounding_box()
    cx = box["x"] + box["width"] * (272 / 540)
    cy = box["y"] + box["height"] * (460 / 960)
    # como un dedo real: tapea hasta que el pago entra (el comal puede estar
    # cocinando ~0.3s — igual que en el motor, el tap espera al ciclo)
    antes = page.evaluate("PLAYABLE.money")
    taps_antes = page.evaluate("PLAYABLE.taps")
    despues, taps_despues = antes, taps_antes
    for _ in range(8):
        page.mouse.click(cx, cy)
        page.wait_for_timeout(160)
        despues = page.evaluate("PLAYABLE.money")
        taps_despues = page.evaluate("PLAYABLE.taps")
        if despues > antes and taps_despues > taps_antes:
            break
    check("tap produce pago", despues > antes and taps_despues > taps_antes,
          f"${antes} → ${despues} (taps {taps_antes}→{taps_despues})")

    # --- guión completo hasta el CTA (autoplay de rescate lo lleva) ---
    try:
        page.wait_for_function("PLAYABLE.ctaShown === true", timeout=20000)
        cta_ok = True
    except Exception:
        cta_ok = False
    estado = page.evaluate(
        "JSON.stringify({fase:PLAYABLE.fase,nivel:PLAYABLE.nivel,"
        "ventas:PLAYABLE.ventas,money:PLAYABLE.money,t:PLAYABLE.simTime})")
    check("CTA aparece", cta_ok, estado)
    check("renovación ocurrió (nivel 2)",
          page.evaluate("PLAYABLE.nivel") == 2, estado)

    page.wait_for_timeout(500)                    # pop-in del CTA asentado
    page.screenshot(path=str(OUT / f"cta-{lang}.png"))

    # --- clickthrough ---
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.wait_for_timeout(200)
    opens = page.evaluate("window.__opens")
    url_cfg = page.evaluate("PLAYABLE.clickUrl")
    check("clickthrough dispara", len(opens) >= 1 and opens[0] == url_cfg,
          f"opens={opens}")

    # --- string ES visible en la tabla del build ---
    tagline = page.evaluate("PLAYABLE.strings.cta_tagline")
    if lang == "es":
        check("CTA en español", "imperio" in tagline, tagline)
    else:
        check("CTA en inglés", "empire" in tagline, tagline)

    check("0 errores de consola", len(consola) == 0, "; ".join(consola[:4]))
    check("0 peticiones de red externas", len(red_externa) == 0,
          "; ".join(red_externa[:4]))
    browser.close()


def main():
    with sync_playwright() as pw:
        for lang in ("en", "es"):
            archivo = RAIZ / f"taco-empire-playable-{lang}.html"
            if not archivo.exists():
                FALLAS.append(f"{archivo.name} no existe — corre build.py")
                print(f"FALTA {archivo.name}")
                continue
            probar(pw, archivo, lang)

    print()
    if FALLAS:
        print(f"SMOKE ROJO — {len(FALLAS)} falla(s):")
        for f in FALLAS:
            print("  - " + f)
        return 1
    print("SMOKE VERDE — playables EN y ES pasan las 8 verificaciones.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
