#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build.py — genera los playables single-file MRAID de TACO EMPIRE.

Destila el motor a UNA pieza por idioma:
  playable/taco-empire-playable-en.html   (EN default)
  playable/taco-empire-playable-es.html   (ES default, adset hispano)

Fuentes (nunca se copian números a mano):
  - config/game.json  → economia/juice/ritmo/visual aplanados ({valor} → valor)
  - config/strings.json → strings compartidos con el juego (tap_hint, niveles,
    telón, mejoras…); los strings SOLO-playable (CTA, rush) viven aquí.
  - assets/*.webp     → data-URIs base64 (SOLO los que el playable usa)
  - playable/src/playable.js + playable/src/shell.html → templates

Regenerar al cambiar arte/config:  python3 playable/build.py
Gate fail-closed: cada .html final debe pesar ≤ 2 MB o el build LANZA.
"""
import argparse
import base64
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent      # repo taco-empire
PLAYABLE = RAIZ / "playable"
MAX_BYTES = 2 * 1024 * 1024                        # requisito duro plan v2.1 #8

# assets que el playable USA (recorte deliberado del set completo del motor;
# fuera: fondo_3, hud_s77, panel_oferta, marco_panel, chip, icono_comal,
# icono_mesa, icono_gema, boton_circular, cli_*_aburrido — ver README)
ASSETS_USADOS = [
    "fondo_1", "fondo_2", "carrito", "hud_s7",
    "placa_turquesa", "placa_mostaza", "placa_roja",
    "icono_taco", "icono_salsa", "icono_taco_billetes",
    "cli_0", "cli_0_celebra", "cli_1", "cli_1_celebra",
    "cli_2", "cli_2_celebra", "cli_3", "cli_3_celebra",
]

SECCIONES_CFG = ["economia", "juice", "ritmo", "visual"]


def aplanar(seccion: dict, nombre: str) -> dict:
    """{valor,fuente,evidencia} → valor. Fail-closed como config.js del motor."""
    plano = {}
    for k, v in seccion.items():
        if k.startswith("_"):
            continue
        if not isinstance(v, dict) or "valor" not in v:
            raise SystemExit(f"config {nombre}.{k}: nodo sin {{valor,...}}")
        plano[k] = v["valor"]
    return plano


def cargar_cfg() -> dict:
    raw = json.loads((RAIZ / "config" / "game.json").read_text("utf-8"))
    cfg = {}
    for s in SECCIONES_CFG:
        if s not in raw:
            raise SystemExit(f"config/game.json sin sección '{s}'")
        cfg[s] = aplanar(raw[s], s)
    return cfg


def cargar_strings() -> dict:
    """Strings del playable: los compartidos vienen de config/strings.json
    (una sola fuente de verdad con el juego); los solo-playable, de aquí."""
    s = json.loads((RAIZ / "config" / "strings.json").read_text("utf-8"))
    en, es = s["en"], s["es"]
    return {
        "en": {
            "tap_hint": en["tap_hint"],
            "nivel1": en["nivel_nombre_1"],
            "nivel2": en["nivel_nombre_2"],
            "telon": en["telon_renovando"],
            "renov_pop": en["pop_renovacion"],
            "nivel2_pop": en["pop_nivel2"],
            "renovar_lista": en["renovar_lista"]
                .replace("{destino}", en["destino_local"]),
            "renovar_progreso": en["renovar_progreso"]
                .replace("{destino}", en["destino_local"]),
            "mejora_salsa": en["mejoras"][0],
            "mejora_grill": en["mejoras"][1],
            "mejora_hawker": en["mejoras"][2],
            "salsa_pop": en["mejoras"][0] + "!",
            "chip_salsa": "SALSA x{mult}",
            "constr_comal": en["constr_tier1"][0],
            # solo-playable (hook abundancia-montaña, l6 §2 Pizza Ready)
            "rush_pop": "MONEY RUSH!",
            "nivel2_sub": "YOUR EMPIRE GROWS!",
            "panel_h": "UPGRADES",
            "mejora_hecha": "DONE",
            "cta_tagline": "Build your taco empire!",
            "cta_boton": "PLAY NOW",
            "cta_pie": "Play FREE",
        },
        "es": {
            "tap_hint": es["tap_hint"],
            "nivel1": es["nivel_nombre_1"],
            "nivel2": es["nivel_nombre_2"],
            "telon": es["telon_renovando"],
            "renov_pop": es["pop_renovacion"],
            "nivel2_pop": es["pop_nivel2"],
            "renovar_lista": es["renovar_lista"]
                .replace("{destino}", es["destino_local"]),
            "renovar_progreso": es["renovar_progreso"]
                .replace("{destino}", es["destino_local"]),
            "mejora_salsa": es["mejoras"][0],
            "mejora_grill": es["mejoras"][1],
            "mejora_hawker": es["mejoras"][2],
            "salsa_pop": "¡" + es["mejoras"][0] + "!",
            "chip_salsa": "SALSA x{mult}",
            "constr_comal": es["constr_tier1"][0],
            "rush_pop": "¡LLUVIA DE BILLETES!",
            "nivel2_sub": "¡TU IMPERIO CRECE!",
            "panel_h": "MEJORAS",
            "mejora_hecha": "LISTA",
            "cta_tagline": "¡Construye tu imperio del taco!",
            "cta_boton": "JUGAR YA",
            "cta_pie": "Juega GRATIS",
        },
    }


def cargar_assets() -> dict:
    man = json.loads((RAIZ / "assets" / "manifest.json").read_text("utf-8"))
    uris = {}
    for nombre in ASSETS_USADOS:
        if nombre not in man["imagenes"]:
            raise SystemExit(f"asset '{nombre}' no está en el manifest")
        archivo = RAIZ / "assets" / man["imagenes"][nombre]["archivo"]
        b = archivo.read_bytes()
        uris[nombre] = "data:image/webp;base64," + base64.b64encode(b).decode()
    return uris


def commit_actual() -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(RAIZ), "rev-parse", "--short", "HEAD"],
            text=True).strip()
    except Exception:
        return "sin-git"


def construir(lang: str, click_url: str, cfg, strings, assets) -> Path:
    js = (PLAYABLE / "src" / "playable.js").read_text("utf-8")
    shell = (PLAYABLE / "src" / "shell.html").read_text("utf-8")

    js = js.replace("__CFG__", json.dumps(cfg, separators=(",", ":")))
    js = js.replace("__STR__", json.dumps(strings, ensure_ascii=False,
                                          separators=(",", ":")))
    js = js.replace("__ASSETS__", json.dumps(assets, separators=(",", ":")))
    js = js.replace("__LANG__", lang)
    js = js.replace("__CLICK_URL__", click_url)

    info = (f"build.py {dt.date.today().isoformat()} · motor {commit_actual()}"
            f" · lang={lang} · assets={len(assets)}")
    html = (shell.replace("__LANG__", lang)
                 .replace("__BUILD_INFO__", info)
                 .replace("__JS__", js))

    salida = PLAYABLE / f"taco-empire-playable-{lang}.html"
    salida.write_text(html, "utf-8")
    n = salida.stat().st_size
    if n > MAX_BYTES:
        salida.unlink()
        raise SystemExit(f"FALLA: {salida.name} pesa {n} bytes > {MAX_BYTES}")
    print(f"OK  {salida.name}  {n:,} bytes  ({n/1024:.1f} KB, "
          f"{100*n/MAX_BYTES:.1f}% del tope 2MB)")
    return salida


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--click-url",
                    default="https://play.google.com/store/apps/details?id=com.tacoempire.game",
                    help="URL de clickthrough (PLACEHOLDER: la define la red/"
                         "tienda al traficar — ver README)")
    args = ap.parse_args()

    cfg = cargar_cfg()
    strings = cargar_strings()
    assets = cargar_assets()
    raw_kb = sum(len(v) for v in assets.values()) / 1024
    print(f"assets inlined: {len(assets)} ({raw_kb:.0f} KB en base64)")
    for lang in ("en", "es"):
        construir(lang, args.click_url, cfg, strings, assets)


if __name__ == "__main__":
    sys.exit(main())
