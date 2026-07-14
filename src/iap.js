/* ============================================================================
   iap.js — flujo IAP: catálogo desde config → intent → confirm → grant.
   La PASARELA es un stub con interfaz clara: en producción se sustituye por
   la del store real (Capacitor/Google Play Billing/StoreKit) implementando
   `confirmar(sku) → Promise<{ok, transaccion, error?}>` y llamando
   `setPasarela(...)`. NADA más del motor cambia.
   ========================================================================= */

import * as TELE from './telemetria.js';

let CATALOGO = null;
let pasarela = null;
let otorgar = null;   // fn(sku) — la aplica el motor (gemas/flags)

/** Pasarela SIMULADA (gray-box): confirma al instante, sin red. */
const pasarelaStub = {
  nombre: 'stub-simulada',
  confirmar(sku) {
    return Promise.resolve({
      ok: true,
      transaccion: `stub-${Date.now().toString(36)}-${sku.id}`,
    });
  },
};

export function construirCatalogo(cfgIap) {
  const skus = [];
  cfgIap.gems_ladder.forEach((gems, i) => {
    skus.push({
      id: `gems_${gems}`, tipo: 'gemas', gems,
      precio_usd: cfgIap.gems_precios_usd[i],
    });
  });
  skus.push({
    id: 'starter_bundle', tipo: 'bundle',
    gems: cfgIap.starter_bundle.gems, noads: !!cfgIap.starter_bundle.noads,
    precio_usd: cfgIap.starter_bundle.precio_usd,
  });
  skus.push({
    id: 'noads_bundle', tipo: 'bundle',
    gems: cfgIap.noads_bundle.gems, noads: true,
    precio_usd: cfgIap.noads_bundle.precio_usd,
  });
  skus.push({ id: 'dosx_permanente', tipo: 'permanente', dosx: true,
    precio_usd: cfgIap.dosx_permanente_usd });
  skus.push({ id: 'pass_pro', tipo: 'pass', tier: 'pro',
    precio_usd: cfgIap.pass_tiers_usd[0] });
  skus.push({ id: 'pass_elite', tipo: 'pass', tier: 'elite',
    precio_usd: cfgIap.pass_tiers_usd[1] });
  CATALOGO = Object.freeze(skus.map(Object.freeze));
  pasarela = pasarelaStub;
  return CATALOGO;
}

export function catalogo() { return CATALOGO; }
export function setPasarela(p) {
  if (!p || typeof p.confirmar !== 'function') {
    throw new Error('pasarela inválida: requiere confirmar(sku) → Promise');
  }
  pasarela = p;
}
export function setOtorgador(fn) { otorgar = fn; }

/** intent → confirm → grant. Devuelve {ok, sku, transaccion?, error?}. */
export async function comprar(skuId) {
  const sku = (CATALOGO || []).find(s => s.id === skuId);
  if (!sku) throw new Error(`sku desconocido: ${skuId}`);
  TELE.evento('iap_intent', { sku: sku.id, precio_usd: sku.precio_usd });
  let res;
  try { res = await pasarela.confirmar(sku); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok) {
    TELE.evento('iap_cancel', { sku: sku.id, error: res.error || 'cancelada' });
    return { ok: false, sku, error: res.error || 'cancelada' };
  }
  TELE.evento('iap_confirm', {
    sku: sku.id, precio_usd: sku.precio_usd, transaccion: res.transaccion,
  });
  if (otorgar) otorgar(sku);
  return { ok: true, sku, transaccion: res.transaccion };
}
