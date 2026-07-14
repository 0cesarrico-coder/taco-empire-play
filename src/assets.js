/* ============================================================================
   assets.js — carga FAIL-CLOSED de assets/manifest.json (LOTE 1 aprobado 👤).
   Si una imagen del manifest no carga, el boot FALLA (console.error → el
   smoke lo caza). Nada de placeholders silenciosos.
   ========================================================================= */

export const IMG = {};

export async function cargarAssets(base = '.') {
  const res = await fetch(`${base}/assets/manifest.json`);
  if (!res.ok) throw new Error(`no pude cargar assets/manifest.json (${res.status})`);
  const man = await res.json();
  const nombres = Object.keys(man.imagenes);
  await Promise.all(nombres.map(async nombre => {
    const v = man.imagenes[nombre];
    const im = new Image();
    im.src = `${base}/assets/${v.archivo}`;
    // decode() fuerza la DECODIFICACIÓN del webp AQUÍ (en el boot), no en el
    // primer drawImage — antes el primer uso de cada asset (p.ej. fondo_2 al
    // renovar, marco_panel al primer ad) pagaba un decode SINCRÓNICO en medio
    // del gameplay = hitch visible (fix perf 2026-07-14, long task ~60ms medido)
    try { await im.decode(); }
    catch (e) { throw new Error(`asset no cargó: ${v.archivo}`); }
    IMG[nombre] = im;
  }));
  return man;
}
