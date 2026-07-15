/* ============================================================================
   assets.js — carga FAIL-CLOSED de assets/manifest.json (LOTE 1 aprobado 👤).
   Si una imagen del manifest no carga, el boot FALLA (console.error → el
   smoke lo caza). Nada de placeholders silenciosos.
   ========================================================================= */

export const IMG = {};

async function cargarManifest(base, archivo) {
  const res = await fetch(`${base}/assets/${archivo}`);
  if (!res.ok) throw new Error(`no pude cargar assets/${archivo} (${res.status})`);
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

export async function cargarAssets(base = '.') {
  return cargarManifest(base, 'manifest.json');
}

/* ★LOTE 5 — BUILD EXPERIMENTAL ?look=3d: manifest de OVERRIDES (mismos keys
   del motor → archivos 3D del D7/c-lote6). Solo se carga con el param: el
   modo default no paga ni un byte extra. Fail-closed igual que el base: si
   falta un archivo 3D, el boot del modo experimental FALLA (el smoke lo caza),
   jamás degrada en silencio a mezcla no documentada. */
export async function cargarAssetsExtra(base = '.', archivo = 'manifest3d.json') {
  return cargarManifest(base, archivo);
}
