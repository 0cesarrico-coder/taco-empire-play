/* ============================================================================
   main.js — bootstrap: config (fail-closed) → strings → telemetría → IAP →
   motor. Cualquier fallo de carga se muestra en pantalla y en consola
   (console.error → el smoke lo caza).
   ========================================================================= */

import { cargarConfig } from './config.js';
import { cargarAssets } from './assets.js';
import { cargarStrings, lang } from './i18n.js';
import * as TELE from './telemetria.js';
import * as IAP from './iap.js';
import { iniciarJuego } from './juego.js';

(async () => {
  try {
    const CFG = await cargarConfig('.');
    const idioma = await cargarStrings('.');
    await cargarAssets('.');   // fail-closed: sin assets no hay juego

    IAP.construirCatalogo(CFG.iap);

    const canvas = document.getElementById('cv');
    const seedM = location.search.match(/[?&]seed=(\d+)/);
    const juego = iniciarJuego({ canvas, CFG, lang: idioma });

    TELE.instalar(() => juego.resumen());
    TELE.sessionStart({
      lang: idioma,
      seed: seedM ? parseInt(seedM[1], 10) : juego.G.seed,
      demo: juego.G.autopilot,
    });
  } catch (e) {
    console.error('BOOT FALLÓ:', e);
    const el = document.getElementById('err');
    if (el) el.textContent = 'BOOT FALLÓ: ' + (e && e.message ? e.message : e);
  }
})();
