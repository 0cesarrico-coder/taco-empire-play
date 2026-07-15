/* ============================================================================
   main.js — bootstrap: config (fail-closed) → strings → telemetría → IAP →
   motor. Cualquier fallo de carga se muestra en pantalla y en consola
   (console.error → el smoke lo caza).
   ========================================================================= */

import { cargarConfig } from './config.js';
import { cargarAssets, cargarAssetsExtra } from './assets.js';
import { cargarStrings, lang } from './i18n.js';
import * as TELE from './telemetria.js';
import * as IAP from './iap.js';
import { iniciarJuego } from './juego.js';

(async () => {
  try {
    const CFG = await cargarConfig('.');
    const idioma = await cargarStrings('.');
    await cargarAssets('.');   // fail-closed: sin assets no hay juego
    // ★LOTE 5 — BUILD EXPERIMENTAL ?look=3d: overrides 3D (fondos diorama +
    // cast D7) SOLO con el param — el default flat no paga ni un byte extra.
    // El mismo regex vive en juego.js (precedente: seed se parsea en ambos);
    // clase de un solo valor, sin riesgo de alternancia golosa (lección s7|s77).
    if (/[?&]look=3d(?![\w])/.test(location.search)) {
      await cargarAssetsExtra('.');   // fail-closed: sin assets 3D no hay build 3D
    }

    IAP.construirCatalogo(CFG.iap);

    const canvas = document.getElementById('cv');
    const seedM = location.search.match(/[?&]seed=(\d+)/);
    const juego = iniciarJuego({ canvas, CFG, lang: idioma });

    TELE.instalar(() => juego.resumen());
    TELE.sessionStart({
      lang: idioma,
      seed: seedM ? parseInt(seedM[1], 10) : juego.G.seed,
      demo: juego.G.autopilot,
      vida: juego.G.vida,   // nivel del experimento L4 (A|B|C) — sin esto el
                            // flywheel no sabría QUÉ build produjo cada sesión
      look: juego.G.look3d ? '3d' : 'flat',   // ★LOTE 5: build experimental
    });
  } catch (e) {
    console.error('BOOT FALLÓ:', e);
    const el = document.getElementById('err');
    if (el) el.textContent = 'BOOT FALLÓ: ' + (e && e.message ? e.message : e);
  }
})();
