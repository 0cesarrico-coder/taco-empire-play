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
  await Promise.all(nombres.map(nombre => new Promise((ok, bad) => {
    const v = man.imagenes[nombre];
    const im = new Image();
    im.onload = () => { IMG[nombre] = im; ok(); };
    im.onerror = () => bad(new Error(`asset no cargó: ${v.archivo}`));
    im.src = `${base}/assets/${v.archivo}`;
  })));
  return man;
}
