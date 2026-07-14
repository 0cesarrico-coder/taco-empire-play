/* ============================================================================
   telemetria.js — telemetría propia (sin ella la etapa F es CIEGA).
   Hoy: persiste a localStorage + expone window.TELEMETRIA.dump().
   Mañana: setRemoto(fn) conecta el endpoint sin tocar el resto del motor.

   Eventos canónicos:
     session_start {lang, seed, demo, retorno_h, d1_retorno}
     session_end   {dur_s, ...resumen}
     nivel         {nivel}                    — renovación completada
     compra_soft   {item, costo, moneda:'billetes'}
     gasto_gemas   {gemas, motivo}            — la pata dura del dual-exit
     ad_shown      {placement}                — por slot: salsa|comalturbo|pocket|influencer|welcomeback
     iap_intent    {sku, precio_usd}
     iap_confirm   {sku, precio_usd, transaccion}
     d1_retorno    {horas_desde_ultima}       — detectado vía timestamps localStorage
   ========================================================================= */

const LS_EVENTOS = 'te_eventos_v1';
const LS_PRIMERA = 'te_primera_sesion_ts';
const LS_ULTIMA = 'te_ultima_sesion_ts';
const CAP_EVENTOS = 500;

const estado = {
  sesionId: null,
  t0: 0,
  eventos: [],     // eventos de ESTA sesión (en memoria)
  remoto: null,    // fn(evento) — endpoint futuro
};

function ahora() { return Date.now(); }

function leerLS(k, def) {
  try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); }
  catch { return def; }
}
function escribirLS(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage lleno/privado */ }
}

export function evento(tipo, datos = {}) {
  const e = { tipo, ts: ahora(), sesion: estado.sesionId, ...datos };
  estado.eventos.push(e);
  const todos = leerLS(LS_EVENTOS, []);
  todos.push(e);
  if (todos.length > CAP_EVENTOS) todos.splice(0, todos.length - CAP_EVENTOS);
  escribirLS(LS_EVENTOS, todos);
  if (estado.remoto) { try { estado.remoto(e); } catch { /* remoto no bloquea */ } }
  return e;
}

export function sessionStart({ lang, seed, demo }) {
  estado.sesionId = `s${ahora().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  estado.t0 = ahora();
  const primera = leerLS(LS_PRIMERA, null);
  const ultima = leerLS(LS_ULTIMA, null);
  if (primera === null) escribirLS(LS_PRIMERA, estado.t0);
  const retornoH = ultima === null ? null : (estado.t0 - ultima) / 3.6e6;
  // D1-retorno: volvió entre 20 y 48 h después de la última sesión
  const d1 = retornoH !== null && retornoH >= 20 && retornoH <= 48;
  escribirLS(LS_ULTIMA, estado.t0);
  evento('session_start', {
    lang, seed, demo,
    retorno_h: retornoH === null ? null : +retornoH.toFixed(2),
    d1_retorno: d1,
  });
  if (d1) evento('d1_retorno', { horas_desde_ultima: +retornoH.toFixed(2) });
}

export function sessionEnd(resumen = {}) {
  evento('session_end', { dur_s: +((ahora() - estado.t0) / 1000).toFixed(1), ...resumen });
}

/** Conecta el endpoint remoto futuro: fn(evento) por evento. */
export function setRemoto(fn) { estado.remoto = fn; }

export function dump() {
  return {
    sesion_actual: estado.sesionId,
    eventos_sesion: estado.eventos.slice(),
    eventos_persistidos: leerLS(LS_EVENTOS, []).length,
    primera_sesion_ts: leerLS(LS_PRIMERA, null),
    ultima_sesion_ts: leerLS(LS_ULTIMA, null),
  };
}

export function instalar(getResumen) {
  window.TELEMETRIA = { evento, dump, setRemoto };
  // session_end en cierre/ocultamiento (persistencia síncrona vía localStorage)
  let cerrada = false;
  const cerrar = () => {
    if (cerrada) return; cerrada = true;
    sessionEnd(getResumen ? getResumen() : {});
  };
  window.addEventListener('beforeunload', cerrar);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { cerrar(); }
    else { cerrada = false; }  // volvió: la próxima ocultada re-emite
  });
}
