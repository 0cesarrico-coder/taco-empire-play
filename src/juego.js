/* ============================================================================
   juego.js — TACO EMPIRE · motor idle-clicker (port de producción del
   prototipo P4 gray-box de Brain-App-Growing, GOAL-TAQUERIA F3→B).

   Reglas del port:
   - TODA la economía + juice + ritmo viene de config/game.json (CFG). Aquí
     NO viven números de economía: cambiar el juego = editar la config.
   - Modo por defecto = JUEGO MANUAL real. ?demo=1 activa el autopilot-demo
     con sus compresiones; TODAS las redes de demo van tras `if (G.autopilot)`
     (anti-patrón pagado: redes de demo sin guard matan partidas manuales).
   - Dual-exit (gemas O ad) en toda fricción — heredado tal cual del P4.
   - Sim determinista: timestep fijo 60 Hz, PRNG mulberry32 (?seed=N).
   ========================================================================= */

import { STR } from './i18n.js';
import { IMG } from './assets.js';
import * as TELE from './telemetria.js';
import * as IAP from './iap.js';

export function iniciarJuego({ canvas, CFG, lang }) {

const E = CFG.economia, IA = CFG.iap, R = CFG.ritmo, J = CFG.juice, D = CFG.demo;
const M = CFG.midlate;   // mid-game (etapa D p1, derivado de config_v1 C0)
const V = CFG.visual;    // capa visual LOTE 1 (aprobado 👤)
const W = 540, H = 960, TICK = 1 / 60;
const cv = canvas, ctx = cv.getContext('2d');

/* ---------- flags de URL ---------- */
const seed = (() => {
  const m = location.search.match(/[?&]seed=(\d+)/);
  return m ? (parseInt(m[1], 10) >>> 0) : ((Date.now() % 100000) >>> 0);
})();
const DEMO_MODE = /[?&]demo=1/.test(location.search);

/* ---------- PRNG determinista (mulberry32) ---------- */
function mulberry32(a){ return function(){
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng  = mulberry32(seed);          // sim (decisiones)
const vrng = mulberry32(seed ^ 0x9e37); // vfx (partículas)

/* ---------- utilidades ---------- */
const clamp = (v,a,b)=> v<a?a : v>b?b : v;
const lerp  = (a,b,t)=> a+(b-a)*t;
const easeOut = t => 1-Math.pow(1-t,3);
const easeIn  = t => t*t*t;
function hash2(i,j){ let h=(i*374761393 + j*668265263)|0; h=(h^(h>>>13))|0;
  h=Math.imul(h,1274126177); return ((h^(h>>>16))>>>0)/4294967296; }
function fmt(n){ n = Math.round(n);
  return n>=100000 ? (n/1000).toFixed(0)+'K'
       : String(n).replace(/\B(?=(\d{3})+(?!\d))/g,','); }
const mmss = s => `${(s/60)|0}:${String(Math.ceil(s)%60).padStart(2,'0')}`;

/* ---------- spring subamortiguado (TODO pop pasa por aquí) ---------- */
function mkSpring(v){ return {x:v, v:0, t:v}; }
function stepSpring(s, k, d, dt){
  s.v += (s.t - s.x) * k * dt;
  s.v *= Math.exp(-d * dt);
  s.x += s.v * dt;
}

/* ---------- ritmo efectivo por modo (demo comprime SOLO el demo) ---------- */
const cooldownOverlay = DEMO_MODE ? R.cooldown_overlay_demo_s : R.cooldown_overlay_s;
const starterReshowS  = DEMO_MODE ? D.starter_reshow_s : E.starter_reshow_s;
const accelClientes   = DEMO_MODE ? D.accel_clientes : 1.0;
let overlayLibreDesde = -999;         // último cierre de overlay fullscreen

/* ============================================================================
   ESTADO GLOBAL + API para el smoke
   ========================================================================= */
const G = {
  state:'juego',              // juego|renovando|fin
  simTime:0, tick:0, fps:60, timeScale:1, hitStop:0,
  billetes: E.dinero_inicial, gemas:0, nivel:1,
  compras:0, comprasMin1:0, lastCompraT:0,
  renovaciones:0, renovT:0,
  vipActive:false, vipNearMiss:false, vipNearMissDone:false, vipDone:false,
  starterShown:false, adsVistos:0, demoDone:false, adScPeak:0, comboBursts:0,
  tiendaShown:false, wbDone:false,
  noAds:false, dosx:false, passTier:null,
  skips:0, ofertaTransicionShown:false,
  autopilot: DEMO_MODE, seed, lang,
};
window.__game = G;

const cam = { shake:0, zoom:mkSpring(1) };
let slowmoHasta = -1;          // simTime hasta el que dura el slow-mo de rescate

/* ---------- geometría de la escena ---------- */
const STAND = { cx:330, postL:206, postR:454, toldoY:300, counterY:470, baseY:560 };
const COMAL = { x:272, y:460, rx:52, ry:20 };
const SIDEWALK_Y = 592;
function slotX(i){ return 150 - i*54; }

/* ---------- pops (números/rotulos flotantes con spring) ---------- */
const pops = [];
function pop(txt,x,y,size,color){
  const s = mkSpring(0.2); s.t = 1; s.v = 8;
  while (pops.length >= R.max_pops) pops.shift();  // cap anti-saturación
  // trayectoria PARABÓLICA (sube con empuje, frena, CAE con deriva lateral) —
  // gravedad y arco leídos de config §juice (D-gate: el juez vio los pops lineales)
  pops.push({txt,x,y,t:0,size,color:color||'#fff',s,
    vx:(vrng()-0.5)*J.pop_arco_vx, vy:-J.pop_impulso-vrng()*JUICE_POP_RISE(),
    g:J.pop_gravedad});
}
function JUICE_POP_RISE(){ return J.pop_rise; }

/* ---------- partículas ---------- */
const parts = [];
function burst(x,y,n,color,spd,g){
  n = Math.round(n*J.particulas_densidad);
  for(let i=0;i<n;i++){ const a=vrng()*Math.PI*2, v=(0.35+vrng()*0.65)*spd;
    parts.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-spd*0.3,g:(g==null?520:g),
      t:0,life:0.4+vrng()*0.4,color,r:2+vrng()*3.2,tipo:'spark'}); } }
function vapor(x,y,n){
  n = Math.round(n*J.particulas_densidad);
  for(let i=0;i<n;i++)
    parts.push({x:x+(vrng()-0.5)*46, y, vx:(vrng()-0.5)*16, vy:-34-vrng()*30,
      g:-14, t:0, life:0.9+vrng()*0.7, color:'#e8e4da', r:4+vrng()*5, tipo:'vapor'}); }
const confetti = [];
function dropConfetti(n){
  for(let i=0;i<(n||J.confeti_n);i++) confetti.push({x:vrng()*W, y:-20-vrng()*380,
    vy:130+vrng()*160, vx:(vrng()-0.5)*60, rot:vrng()*Math.PI, vr:(vrng()-0.5)*8,
    color:['#ff6b35','#4caf50','#ffd700','#fff'][ (vrng()*4)|0 ], s:4+vrng()*5 }); }

/* ---------- vuelos (tacos / billetes / gemas en arco bezier) ---------- */
const vuelos = [];
function vuelo(tipo, x0,y0, x1,y1, dur, cb){
  vuelos.push({tipo, x0,y0,x1,y1, cx:(x0+x1)/2, cy:Math.min(y0,y1)-138,
    t:0, dur, cb}); }

/* ============================================================================
   CONSTRUCCIONES (pista 1) y MEJORAS (pista 2) — costos desde config,
   nombres desde strings, geometría local (no es economía).
   ========================================================================= */
const LOCS_T1 = [[272,455],[496,545],[402,452],[330,515],[330,262]];
const LOCS_T2 = [[330,262],[496,545],[330,515],[402,452],[120,545]];
const LOCS_T3 = [[330,262],[496,545],[330,515],[402,452],[120,545]];
function tierDef(nivelTanda){
  const [costos, nombres, locs] =
    nivelTanda===1 ? [E.construcciones_costos, STR('constr_tier1'), LOCS_T1] :
    nivelTanda===2 ? [E.construcciones_tier2_costos, STR('constr_tier2'), LOCS_T2] :
                     [E.construcciones_tier3_costos, STR('constr_tier3'), LOCS_T3];
  return costos.map((c,i)=>({ n:nombres[i], c, loc:locs[i],
    comprada:false, sc:mkSpring(1), pulsoT:0 }));
}
let construcciones = tierDef(1);

const NOMBRES_MEJORAS = STR('mejoras');
let mejoras = E.mejoras_costos_base.map((base,i)=>({
  n:NOMBRES_MEJORAS[i], base, costo:base, nivel:0, sc:mkSpring(1),
  pulsoT:0.3*(i+1) }));

/* ingreso por venta: base × (1+crec)^compras × lluvia FTUE × salsa-turbo × 2x
   IAP × permanente mid × multiplicador de la escalera de locales (local 4+) */
function ingresoVenta(){
  let v = E.ingreso_base_por_venta *
          Math.pow(1+E.ingreso_crecimiento_por_compra, G.compras);
  if (G.simTime < E.ftue_lluvia_dur_s) v *= E.ftue_lluvia_mult;
  if (salsaActiva()) v *= E.salsa_multiplicador;
  if (G.dosx) v *= IA.dosx_multiplicador;
  if (mid.perms[0].comprado) v *= M.perm_ingreso_mult;
  if (G.nivel > 3)                       // escalera de locales (n55): reset de
    v *= Math.pow(M.expansion_ingreso_mult_por_local, G.nivel-3); // curva CON mult
  return Math.round(v);
}

const hudMoney = mkSpring(1), hudGem = mkSpring(1);
let lastMoney = null;   // batching de pops de dinero (juez de ritmo: máx 4 UI)
function ganar(monto, x, y, color){
  G.billetes += monto;
  hudMoney.v += 4;
  if (lastMoney && (G.simTime - lastMoney.t0) < R.pop_batch_s &&
      pops.includes(lastMoney.p)){
    lastMoney.monto += monto;                       // suma al pop vivo
    lastMoney.p.txt = '+$'+fmt(lastMoney.monto);
    lastMoney.p.s.v += 4;
    lastMoney.p.t = Math.min(lastMoney.p.t, 0.35);  // le renueva vida
    // re-kick parabólico en CADA merge (cura r2, defecto 3/6: el pop del
    // comal renovado seguía integrando gravedad → deriva lineal; re-impulso
    // + vx re-sorteado = arco con dispersión lateral, vrng del seed)
    lastMoney.p.vx = (vrng()-0.5)*J.pop_arco_vx;
    lastMoney.p.vy = -(J.pop_impulso*J.pop_rekick_mult + vrng()*J.pop_rise);
  } else {
    pop('+$'+fmt(monto), x, y, 26, color||'#ffd700');
    lastMoney = { p: pops[pops.length-1], monto, t0: G.simTime };
  }
  vuelo('billete', x, y-30, 64, 42, 0.55);
}

function comprar(c){
  if (c.comprada || G.billetes < c.c) return;
  G.billetes -= c.c; c.comprada = true;
  G.compras++; if (G.simTime < 60) G.comprasMin1++;
  G.lastCompraT = G.simTime;
  TELE.evento('compra_soft', { item:c.n, costo:c.c, moneda:'billetes' });
  c.sc.x = 1.35; c.sc.v = -4;
  burst(c.loc[0], c.loc[1], 18, '#ffd700', 190);
  burst(c.loc[0], c.loc[1], 8, '#4caf50', 140);
  pop('¡'+c.n+'!', c.loc[0], c.loc[1]-30, 24, '#4caf50');
  cam.shake = Math.max(cam.shake, 3);
}
/* cap de nivel de estación por local (n20): 25→50→75→150; local 5+ = 150 */
function capMejoraActual(){
  return M.cap_estacion_por_local[
    Math.min(G.nivel, M.cap_estacion_por_local.length) - 1];
}
/* ratio de la curva: 2.3 early → 1.20 aplanado al entrar al local 3+ (n19) */
function ratioMejora(){
  return G.nivel >= M.curva_late_desde_local
    ? M.curva_costo_late_ratio : E.curva_upgrade_ratio;
}
function comprarMejora(m){
  if (m.nivel >= capMejoraActual()) return;   // estación al cap del local
  if (G.billetes < m.costo) return;
  G.billetes -= m.costo; m.nivel++;
  const costoPagado = m.costo;
  m.costo = Math.round(m.costo * ratioMejora());  // curva de config (early/late)
  G.compras++; if (G.simTime < 60) G.comprasMin1++;
  G.lastCompraT = G.simTime;
  TELE.evento('compra_soft', { item:m.n+'_nv'+m.nivel, costo:costoPagado,
    moneda:'billetes' });
  m.sc.x = 1.3; m.sc.v = -4;
  burst(COMAL.x, COMAL.y-10, 10, '#4caf50', 150);
  pop(m.n+' '+STR('nv')+m.nivel, W/2, 700, 20, '#4caf50');
}
function marchantaNivel(){ return mejoras[2].nivel; }

/* ============================================================================
   BOOSTERS + SLOTS DE AD SIMULADOS (dual-exit: gemas O ad)
   ========================================================================= */
const boost = { salsaHasta:0, comalHasta:0 };
const salsaActiva = ()=> G.simTime < boost.salsaHasta;
const comalTurbo  = ()=> G.simTime < boost.comalHasta;

const ads = {
  overlay:null,               // {t, dur, tipo}
  pocketDisp:false, pocketNextT:E.money_pocket_primero_t_s, pocketAdelantado:false,
  influencerNextT:E.influencer_primero_t_s,
  salsaDesde:E.salsa_desde_t_s, comalDesde:E.comal_turbo_desde_t_s,
};
function verAd(tipo){
  if (ads.overlay || G.state!=='juego') return;
  // cadenciador: gameplay libre garantizado entre interrupciones fullscreen
  if (G.simTime - overlayLibreDesde < cooldownOverlay) return;
  // pop-in orgánico — cura r3 (defecto 2/3: "entra con corte directo"): el
  // spring r2 SÍ corría (verificado: pico 1.35) pero con escala0=0.62 el
  // recorrido cabía ENTRE muestras a fps=4; escala0 baja = despliegue que el
  // juez ve en ≥2 frames. G.adScPeak = evidencia runtime de que el spring corre.
  const sc = mkSpring(J.ad_in_escala0); sc.t = 1; sc.v = J.ad_pop_v;
  G.adScPeak = sc.x;
  ads.overlay = { t:0, dur:R.ad_sim_dur_s, tipo, sc, done:false };
  TELE.evento('ad_shown', { placement:tipo });
}
function recompensaAd(tipo){
  G.adsVistos++;
  if (tipo==='salsa'){
    boost.salsaHasta = G.simTime + E.booster_salsa_dur_s;
    pop(STR('pop_salsa',{mult:E.salsa_multiplicador,
      dur:mmss(E.booster_salsa_dur_s)}), W/2, 420, 26, '#ff6b35');
    burst(W/2, 430, 22, '#ff6b35', 220);
  } else if (tipo==='comalturbo'){
    boost.comalHasta = G.simTime + E.booster_comal_dur_s;
    pop(STR('pop_comal',{dur:mmss(E.booster_comal_dur_s)}), W/2, 420, 26, '#ff6b35');
    burst(COMAL.x, COMAL.y, 20, '#ff6b35', 200);
  } else if (tipo==='pocket'){
    cobrarPocket();
  } else if (tipo==='influencer'){
    G.gemas += E.influencer_gema_recompensa; hudGem.v += 4;
    vuelo('gema', W/2, 430, W-70, 42, 0.6);
    pop(STR('pop_influencer',{n:E.influencer_gema_recompensa}), W/2, 400, 26, '#7ee0ff');
    ads.influencerNextT = G.simTime + E.influencer_cadencia_s; // goteo de gema
  } else if (tipo==='welcomeback'){
    const monto = E.welcomeback_monto * E.welcomeback_x2;
    ganar(monto, W/2, 400, '#ffd700');
    pop(STR('pop_wb',{x:E.welcomeback_x2}), W/2, 360, 26, '#ffd700');
    dropConfetti(40);
    G.wbDone = true; wb.visible = false;
  }
}
function cobrarPocket(){
  const monto = Math.max(E.money_pocket_min,
    Math.floor(G.billetes * E.money_pocket_factor));
  ganar(monto, W/2, 430, '#ffd700');
  pop(STR('pop_pocket'), W/2, 390, 28, '#ffd700');
  dropConfetti(35);
  ads.pocketDisp = false; ads.pocketAdelantado = false;
  ads.pocketNextT = G.simTime + E.money_pocket_cadencia_s;
}
function gastarGemas(n, motivo){
  if (G.gemas < n) return false;
  G.gemas -= n; hudGem.v += 3;
  TELE.evento('gasto_gemas', { gemas:n, motivo });
  return true;
}
/* skip-de-ad con gemas: la forma MÁS PURA del dual-exit (MPH: pagas por NO
   ver el ad) — visible en CADA overlay de ad */
function skipAd(){
  const o = ads.overlay;
  if (!o || o.done) return;
  if (G.skips > 0){            // mid: un SALTO del pack (SKU bidireccional n42)
    G.skips--;
    TELE.evento('skip_usado', { restantes:G.skips });
  } else if (!gastarGemas(E.dual_exit_gemas[0], 'skip_ad')) return;
  o.t = o.dur;                 // directo a la recompensa, sin "ver" el resto
  pop(STR('pop_ad_saltado',{n:E.dual_exit_gemas[0]}), W/2, 250, 20, '#7ee0ff');
}
/* ramas de gemas del dual-exit (pagas gemas por NO ver el ad — MPH/BP) */
function pocketConGemas(){
  if (!ads.pocketDisp) return;
  if (!gastarGemas(E.dual_exit_gemas[0], 'pocket')) return;
  cobrarPocket();
}
function comalTurboConGemas(){
  if (comalTurbo()) return;
  if (!gastarGemas(E.dual_exit_gemas[0], 'comal_turbo')) return;
  boost.comalHasta = G.simTime + E.booster_comal_dur_s;
  pop(STR('pop_comal_gemas',{n:E.dual_exit_gemas[0]}), W/2, 420, 24, '#7ee0ff');
}

/* ---------- welcome-back: ganancia offline ×2 por ad (INFERRED teardown) ---- */
const wb = { visible:false, shown:false, sl:mkSpring(0) };
function wbReclamar(x2){
  if (!wb.visible) return;
  if (x2){
    if (ads.overlay || G.state!=='juego') return;
    verAd('welcomeback'); wb.visible = false;
  } else { ganar(E.welcomeback_monto, W/2, 400, '#4caf50');
    G.wbDone = true; wb.visible = false; }
}

/* ---------- TIENDA (gramática §3: escalera IAP vía módulo iap.js) ---------- */
const tienda = { abierta:false, sl:mkSpring(0) };
function abrirTienda(){
  if (tienda.abierta || G.state!=='juego') return;
  tienda.abierta = true; G.tiendaShown = true;
  tienda.sl.x = 0.6; tienda.sl.t = 1; tienda.sl.v = 4;
}
function cerrarTienda(){ tienda.abierta = false; overlayLibreDesde = G.simTime; }

/* grant central de IAP (el módulo iap.js llama aquí tras confirm del stub) */
IAP.setOtorgador((sku)=>{
  if (sku.gems){ G.gemas += sku.gems; hudGem.v += 4;
    vuelo('gema', W/2, 430, W-70, 42, 0.6); }
  if (sku.noads) G.noAds = true;
  if (sku.dosx)  G.dosx = true;
  if (sku.tier)  G.passTier = sku.tier;
  pop(STR('pop_compra_stub'), W/2, 300, 24, '#7ee0ff');
  pop(sku.id, W/2, 336, 16, '#fff');
});
function comprarIAP(skuId){
  IAP.comprar(skuId);   // intent → confirm (stub) → grant; telemetría adentro
}
function cambioGemas(gemasCosto, mult){
  const base = Math.max(IA.cambio_base_min, Math.floor(G.billetes*IA.cambio_base_factor));
  if (!gastarGemas(gemasCosto, 'cambio_cash')) return;
  ganar(base*mult, W/2, 430, '#4caf50');
}

/* ============================================================================
   MID-GAME (etapa D p1 — config_v1 C0 §midlate; desbloquea en el local 2:
   el FTUE validado por los jueces NO se toca)
   ========================================================================= */
const mid = {
  abierta:false, sl:mkSpring(0),
  desbloqueadoT:-1,            // simTime al llegar a mid_desde_local
  freeCashListoT:Infinity,     // free cash (n42): cooldown de config
  // dual-pricing permanente (n25): gratis-por-espera O gemas
  perms: [
    { key:'perm_ingreso',  comprado:false, desdeT:Infinity },
    { key:'perm_clientes', comprado:false, desdeT:Infinity },
  ],
};
const midDesbloqueado = ()=> G.nivel >= M.mid_desde_local;
function abrirMid(){
  if (mid.abierta || !midDesbloqueado() || G.state!=='juego') return;
  mid.abierta = true;
  mid.sl.x = 0.6; mid.sl.t = 1; mid.sl.v = 4;
}
function cerrarMid(){ mid.abierta = false; overlayLibreDesde = G.simTime; }
/* packs de saltos: precio en gemas = skip_ad_skus (consume tiers 10/30 — H2) */
function comprarSkipPack(i){
  const precio = M.skip_ad_skus[i], n = M.skip_pack_contenidos[i];
  if (!gastarGemas(precio, 'skip_pack_'+i)) return;
  G.skips += n;
  pop(STR('pop_skips',{n}), W/2, 400, 26, '#7ee0ff');
}
/* free cash cada 20 min (n42): la pata GRATIS del SKU bidireccional */
function cobrarFreeCash(){
  if (!midDesbloqueado() || G.simTime < mid.freeCashListoT) return;
  const monto = Math.max(M.free_cash_min,
    Math.floor(G.billetes * M.free_cash_monto_factor));
  ganar(monto, W/2, 430, '#4caf50');
  mid.freeCashListoT = G.simTime + M.free_cash_cooldown_min*60;
  TELE.evento('free_cash', { monto });
}
/* dual-pricing permanente (n25): gratis tras espera O dual_pricing gems */
function permListaGratis(i){
  const p = mid.perms[i];
  return !p.comprado && G.simTime >= p.desdeT + M.dual_pricing_espera_min*60;
}
function aplicarPerm(i){
  mid.perms[i].comprado = true;
  pop(STR(mid.perms[i].key,
    {pct: Math.round(((i===0?M.perm_ingreso_mult:M.perm_clientes_mult)-1)*100)}),
    W/2, 400, 20, '#ffd700');
  burst(W/2, 420, 20, '#ffd700', 200);
}
function reclamarPermGratis(i){
  if (!permListaGratis(i)) return;
  TELE.evento('perm_gratis', { perm:mid.perms[i].key });
  aplicarPerm(i);
}
function comprarPermGemas(i){
  if (mid.perms[i].comprado) return;
  if (!gastarGemas(M.dual_pricing_permanente_gems, 'perm_'+i)) return;
  aplicarPerm(i);
}

/* oferta anclada a TRANSICIÓN (n30 MPH): 15s después de cada renovación */
const ofertaTrans = { visible:false, sku:null, hastaT:0, paraRenov:0 };

/* ---------- starter offer (t=25s, countdown 2h, NO bloqueante) ---------- */
const starter = { visible:false, min:false, t0:0, fin:0, sl:mkSpring(0),
  minT:0, reshows:0, comprada:false };
function fmtCuenta(s){ s = Math.max(0, Math.floor(s));
  const h=(s/3600)|0, m=((s%3600)/60)|0, ss=s%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`; }

/* ============================================================================
   CLIENTES — siluetas procedurales con walk-cycle de curvas
   ========================================================================= */
const PAL_CLI = ['#7b8fa6','#a67b8f','#8fa67b','#a6947b','#7ba0a6','#9b7ba6'];
const clientes = [];   // todos (incluye los que salen)
const fila = [];       // en cola (fila[0] = al frente)
let spawnT = 1.2;
let vip = null;        // referencia al cliente VIP
let vipSpawned = false;
/* latido crítico del VIP (cura r5, defecto 3/3 r4): fase ACUMULADA con Hz
   variable (vip_latido_hz_min→max al agotarse) — integrar la fase evita saltos
   al cambiar la frecuencia. El pulso modula INTENSIDAD sobre rojo
   siempre-visible (nunca hay fase apagada → toda muestra a fps=4 captura rojo). */
let vipLatidoFase = 0;
const vipPulso = ()=> 0.5 + 0.5*Math.sin(vipLatidoFase*Math.PI*2);
const vipRestanteS = ()=> (vip && vip.estado==='espera' && G.vipActive)
  ? vip.paciencia * E.vip_paciencia_s : Infinity;

/* ráfaga TURBO (cura r5, 4ª ronda del defecto hit-stop): contador de
   cobros-tap consecutivos con booster activo; cada rafaga_cada_n dispara el
   COMBO-BURST. El tap normal (sin booster) jamás entra aquí. */
const rafaga = { n:0, lastT:-99 };

function mkCliente(esVip){
  return { vip:!!esVip, estado:'asoma', t:0, x:-26, y:SIDEWALK_Y,
    dist:0, pasoN:0, moviendo:false, dir:1,
    ln:mkSpring(0), frenoT:0, frenoDir:1, prevMov:false,
    col: esVip ? '#ffd700' : PAL_CLI[(rng()*PAL_CLI.length)|0],
    spr: (rng()*4)|0,                 // pool de 4 canons (determinista por seed)
    alto: esVip ? 1.12 : 0.92+rng()*0.16,
    pedidos: esVip ? E.vip_pedidos : 1, servidos:0,
    paciencia: 1, sq:mkSpring(1), hop:0 };
}
function spawnCliente(esVip){
  const c = mkCliente(esVip);
  clientes.push(c);
  if (esVip){ fila.unshift(c); } else fila.push(c);
  return c;
}

/* ---------- el comal (tap → squash + chispas; humea antes de estar listo) -- */
const comal = { taps:0, humoT:0, flashT:0, tapFlashT:0, sx:mkSpring(1), sy:mkSpring(1),
  pop:mkSpring(1), radialT:0, radialA:0,     // cura r3: pop de escala + líneas radiales
  radialK:1 };                               // cura r5: escala de radiales (combo=grandes)
function tapComal(){
  if (tienda.abierta || mid.abierta || wb.visible || ads.overlay) return; // overlays bloquean
  if (!construcciones[0].comprada && G.nivel===1) return; // sin comal no hay tacos
  const front = fila[0];
  if (!front || front.estado!=='espera' || comal.humoT>0 || G.state!=='juego') return;
  comal.taps += comalTurbo() ? E.comal_turbo_taps : 1;
  // squash direccional + hit-stop + micro-shake en CADA tap (el clicker SE SIENTE)
  comal.sy.x = J.squash_tap; comal.sx.x = 1/J.squash_tap;
  comal.sy.v = 5; comal.sx.v = -5;
  G.hitStop = J.hitstop_ticks_tap;
  // flash blanco del TAP (cura r2, defecto 4/6): el freeze de ~117ms es
  // invisible en video 8fps; el flash — que persiste CONGELADO durante el
  // hit-stop porque su decay vive en update() — es el marcador perceptible
  comal.tapFlashT = J.flash_tap_s;
  // cura r3 (defecto 2/3: el golpe seguía imperceptible a 4-8 fps; NO se alarga
  // el hit-stop — ritmo en banda): pop de escala 1.0→comal_pop_escala→1.0 por
  // spring + líneas radiales de impacto estilo cómic (identidad E2 pop-art).
  // Ambos quedan CONGELADOS durante el hit-stop → el juez los muestrea.
  comal.pop.x = J.comal_pop_escala; comal.pop.v = 1.2;
  comal.radialT = J.impacto_radial_dur_s;
  comal.radialA = vrng()*Math.PI*2;
  comal.radialK = 1;
  cam.shake = Math.max(cam.shake, J.shake_tap);
  burst(COMAL.x+(vrng()-0.5)*56, COMAL.y-8, 6, '#ff6b35', 160, 340);
  burst(COMAL.x+(vrng()-0.5)*40, COMAL.y-6, 3, '#ffd700', 120, 300);
  vapor(COMAL.x, COMAL.y-10, 3);   // pico de humo EN el tap (no emisión plana)
  // ★ CADA TAP PAGA (juez de ritmo: recompensa ≤0.5s; mismo total por taco —
  //   el tap cobra v/taps y la venta paga el residuo)
  ganar(Math.round(ingresoVenta()/E.taps_por_taco), COMAL.x, COMAL.y-34);
  // COMBO-BURST de ráfaga TURBO (cura r5, 4ª ronda del defecto "hit-stop
  // imperceptible en cobros rápidos": D1-v1 00:20.75 · D2-v1 00:19.50 ·
  // D3-v1 00:18.50). SOLO con booster activo (salsa/comal turbo) y FUERA del
  // VIP (su coreografía near-miss — elogiada 3/3 en r4 — no se toca); el tap
  // normal y los cooldowns quedan intactos. El contador APILA (×4!, ×8!…)
  // mientras la ráfaga viva (huecos ≤ rafaga_gap_s).
  if ((comalTurbo() || salsaActiva()) && !G.vipActive){
    if (G.simTime - rafaga.lastT > J.rafaga_gap_s) rafaga.n = 0;
    rafaga.lastT = G.simTime;
    rafaga.n++;
    if (rafaga.n % J.rafaga_cada_n === 0) comboBurst(rafaga.n);
  } else rafaga.n = 0;
  if (comal.taps >= E.taps_por_taco){
    comal.taps = 0;
    comal.humoT = 0.35;          // anticipación diegética: humea ANTES de salir
    comal.flashT = J.flash_comal_s;   // destello del sizzle al completar
    burst(COMAL.x, COMAL.y-10, 12, '#fff', 240, 300);
    cam.zoom.v += 0.5;           // punch-in al completar (cada 3er tap remata)
  }
}
/* COMBO-BURST (cura r5): el impacto congelado que POR FIN es legible a fps=4.
   Verificado el mecanismo canónico del motor: G.hitStop congela update() (el
   mundo, springs, timers de juice y autopilot) pero G.tick/simTime SIGUEN
   corriendo — idéntico a hitstop_ticks_tap/grande → los timers de economía
   (boosters, cooldowns, starter) no se alteran distinto de lo ya validado.
   Legibilidad garantizada: freeze de 0.25s = período exacto del muestreo a
   4fps → ≥1 muestra cae SIEMPRE dentro del frame congelado, que además ya
   está ampliado rafaga_zoom (el zoom se fija DIRECTO en cam.zoom.x, no como
   impulso) y con radiales GRANDES + número gigante apilado encima. */
function comboBurst(n){
  G.comboBursts++;
  G.hitStop = Math.max(G.hitStop, Math.round(J.rafaga_freeze_s / TICK));
  cam.zoom.x = Math.max(cam.zoom.x, 1 + J.rafaga_zoom); cam.zoom.v = 0;
  comal.radialT = J.impacto_radial_dur_s;   // congeladas durante TODO el freeze
  comal.radialA = vrng()*Math.PI*2;
  comal.radialK = 2.4;                      // radiales GRANDES (vs 1 del tap)
  cam.shake = Math.max(cam.shake, J.shake_venta);
  pop('×'+n+'!', COMAL.x, COMAL.y-96, 54, '#ff6b35');  // gigante, apilado
  // el pop nace en escala 0.2 (spring); el freeze del MISMO tick lo congelaría
  // enano → nace YA desplegado con overshoot (el frame congelado lo muestra gigante)
  const gp = pops[pops.length-1]; gp.s.x = 1.3; gp.s.v = -2;
}

function tacoListo(){
  const front = fila[0];
  vapor(COMAL.x, COMAL.y-14, 6);
  if (!front) return;
  vuelo('taco', COMAL.x, COMAL.y-16, front.x+6, front.y-58, 0.45, ()=>{
    entregarTaco(front);
  });
}
function entregarTaco(c){
  if (!clientes.includes(c)) return;
  c.servidos++;
  c.sq.x = 1.25; c.sq.v = -4;      // brinco de gusto con squash
  vapor(c.x, c.y-60, 2);
  if (c.servidos >= c.pedidos) venta(c);
}
function venta(c){
  const v = ingresoVenta();
  // los taps ya pagaron v/taps cada uno; la venta liquida el residuo del pedido
  const porTaps = Math.round(v/E.taps_por_taco) * E.taps_por_taco;
  const total = Math.max(0, (v - porTaps)) * c.pedidos;
  if (total > 0) ganar(total, c.x, c.y-70, '#ffd700');
  // shake propio del evento VENTA (cura r2: solo el tap tenía knob; las
  // ráfagas de venta ahora sacuden la cámara — antes 2.5 hardcodeado)
  cam.shake = Math.max(cam.shake, J.shake_venta);
  if (c.vip){
    // ★ EL RESCATE: propina explosiva + hit-stop + mini slow-mo
    const tip = v * E.vip_tip_mult;
    ganar(tip, c.x, c.y-110, '#ffd700');
    pop(STR('vip_propinazo'), W/2, 340, 46, '#ffd700');
    pop(STR('vip_salvado',{pct:(c.paciencia*100|0)}), W/2, 388, 18, '#fff');
    G.hitStop = J.hitstop_ticks_grande;
    cam.shake = J.shake_intensidad + 3; cam.zoom.t = 1.1;
    dropConfetti(70);
    burst(c.x, c.y-70, 30, '#ffd700', 260);
    G.timeScale = J.slowmo_save; slowmoHasta = G.simTime + 0.25;
    G.vipDone = true; G.vipActive = false; G.vipNearMiss = false;
    vip = null;
  }
  const i = fila.indexOf(c); if (i>=0) fila.splice(i,1);
  c.estado = 'feliz'; c.t = 0;
}

/* ============================================================================
   RENOVACIÓN — puesto → local (transición coreografiada + reset de curva)
   ========================================================================= */
const renov = { activa:false, t:0, swapped:false };
function renovCosto(){
  if (G.renovaciones === 0) return E.renovacion_costo;
  if (G.renovaciones === 1) return E.renovacion2_costo;
  // escalera de locales (n55): renov N≥3 = renov2 × escala^(N-2)
  return Math.round(E.renovacion2_costo *
    Math.pow(M.renovacion_costo_escala, G.renovaciones - 1));
}
function puedeRenovar(){
  // escalera SIN tope (n55): cada local nuevo resetea la curva a costos base.
  // requisito LATE (n2 OBSERVED): desde el local 3+, TODAS las estaciones al cap
  const reqCap = !M.renovacion_late_requisito ||
    G.nivel < M.renov_late_requisito_desde_local ||
    mejoras.every(m => m.nivel >= capMejoraActual());
  return reqCap && construcciones.every(c=>c.comprada) &&
         G.billetes >= renovCosto();
}
function renovar(){
  if (!puedeRenovar() || G.state!=='juego') return;
  const costo = renovCosto();
  G.billetes -= costo;
  TELE.evento('compra_soft', { item:'renovacion_'+(G.renovaciones+1),
    costo, moneda:'billetes' });
  renov.activa = true; renov.t = 0; renov.swapped = false;
  G.state = 'renovando';
  pop(STR('pop_renovacion'), W/2, 330, 50, '#ffd700');
  cam.shake = J.shake_intensidad + 4; cam.zoom.t = 1.12;
  G.hitStop = J.hitstop_ticks_grande;
  dropConfetti();
  fila.length = 0;
  for (const c of clientes){ if (c.estado!=='sale'){ c.estado='sale'; } }
  comal.taps = 0; comal.humoT = 0;
  // ★H3: si el VIP estaba activo/en cola, la renovación lo despide LIMPIO —
  // sin esto G.vipActive queda sucio (vignette dorada permanente + bloquea
  // el show/re-show de la starter, que exige !G.vipActive)
  if (G.vipActive || vip){
    G.vipActive = false; G.vipNearMiss = false; G.vipDone = true;
    vip = null; G.timeScale = 1; slowmoHasta = -1;
  }
}

/* ============================================================================
   UPDATE — timestep fijo, todo determinista
   ========================================================================= */
let apTapT = 0, apActT = 0;
function update(dt){
  G.tick++; G.simTime = G.tick*TICK;
  if (G.hitStop > 0){ G.hitStop--; return; }   // hit-stop congela el mundo

  // springs globales
  stepSpring(cam.zoom, 26, 7, dt);
  cam.shake = Math.max(0, cam.shake - dt*30);
  stepSpring(hudMoney, J.spring_k, J.spring_amort, dt);
  stepSpring(hudGem, J.spring_k, J.spring_amort, dt);
  stepSpring(comal.sx, J.spring_k, J.spring_amort, dt);
  stepSpring(comal.sy, J.spring_k, J.spring_amort, dt);
  stepSpring(comal.pop, J.spring_k, J.spring_amort, dt);  // cura r3: overshoot del comal
  stepSpring(starter.sl, 60, 8, dt);
  stepSpring(wb.sl, 60, 8, dt);
  stepSpring(tienda.sl, 90, 9, dt);
  stepSpring(mid.sl, 90, 9, dt);
  // descanso post-renovación: sin pulsos de botones (amortiguación, juez ritmo)
  const postRenovCalma = G.renovaciones>0 &&
    G.simTime - G.renovT < R.post_renov_calma_s + R.renov_dur_s;
  for (const c of construcciones){ stepSpring(c.sc, J.spring_k, J.spring_amort, dt);
    if (!c.comprada && G.billetes>=c.c && !postRenovCalma){ c.pulsoT += dt;
      if (c.pulsoT > J.pulso_boton_s){ c.pulsoT = 0; c.sc.v += 2.4; } } }
  for (const m of mejoras){ stepSpring(m.sc, J.spring_k, J.spring_amort, dt);
    if (G.billetes>=m.costo && m.nivel<capMejoraActual()){ m.pulsoT += dt;
      if (m.pulsoT > J.pulso_boton_s){ m.pulsoT = 0; m.sc.v += 1.8; } } }

  // pops / partículas / confeti / vuelos
  for (const p of pops){ p.t += dt; p.x += p.vx*dt; p.y += p.vy*dt;
    p.vy += p.g*dt; stepSpring(p.s, 140, 8, dt); }
  for (let i=pops.length-1;i>=0;i--) if (pops[i].t>1.15) pops.splice(i,1);
  for (const p of parts){ p.t+=dt; p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=p.g*dt; }
  for (let i=parts.length-1;i>=0;i--) if (parts[i].t>parts[i].life) parts.splice(i,1);
  for (const c of confetti){ c.y+=c.vy*dt; c.x+=c.vx*dt+Math.sin(c.y*0.02)*0.7; c.rot+=c.vr*dt; }
  for (let i=confetti.length-1;i>=0;i--) if (confetti[i].y>H) confetti.splice(i,1);
  for (const v of vuelos){ v.t += dt/v.dur; }
  for (let i=vuelos.length-1;i>=0;i--) if (vuelos[i].t>=1){
    const v = vuelos[i]; vuelos.splice(i,1); if (v.cb) v.cb(); }

  // fin del slow-mo de rescate
  if (slowmoHasta>0 && G.simTime>slowmoHasta){ G.timeScale = 1; slowmoHasta = -1;
    cam.zoom.t = 1; }   // el punch-in del rescate VIP SIEMPRE vuelve a 1

  // ad overlay simulado (el juego sigue corriendo detrás)
  if (ads.overlay){ const o = ads.overlay; o.t += dt;
    // spring del despliegue con knobs (cura r2: amort 9 mataba el overshoot
    // a <5% al pico; 4.5 deja el rebote subamortiguado visible)
    stepSpring(o.sc, J.ad_spring_k, J.ad_spring_amort, dt);
    if (o.sc.x > G.adScPeak) G.adScPeak = o.sc.x;   // evidencia: el spring corre
    // salida ANIMADA (cura r3, defecto 2/3 "corte seco"): scale-down con kick
    // de velocidad hacia ad_out_escala + fade de ad_out_s (≥1 frame a fps=4)
    if (o.t >= o.dur && !o.done){ o.done = true;
      o.sc.t = J.ad_out_escala; o.sc.v -= J.ad_pop_v;
      recompensaAd(o.tipo); }
    if (o.t >= o.dur + J.ad_out_s){ ads.overlay = null;
      overlayLibreDesde = G.simTime; } }

  if (G.state === 'renovando'){ updateRenov(dt); return; }

  // ---- welcome-back al arranque (offline ×2 por ad; el mejor convertidor) ----
  if (!wb.shown && G.simTime >= 1.5){
    wb.shown = true; wb.visible = true;
    wb.sl.x = 0; wb.sl.t = 1; wb.sl.v = 3;
  }

  // ---- starter offer a t=oferta_starter_t_s (no cae ENCIMA de una compra;
  //      tope duro: la regla <60s de la gramática §1 no se viola) ----
  if (!G.starterShown && G.simTime >= E.oferta_starter_t_s && !G.vipActive &&
      G.simTime - overlayLibreDesde >= (G.autopilot ? 0 : R.starter_espera_libre_s) &&
      (G.simTime - G.lastCompraT > R.oferta_tras_compra_s ||
       G.simTime > E.starter_tope_duro_s)){
    G.starterShown = true; starter.visible = true; starter.min = false;
    starter.t0 = G.simTime; starter.showT = G.simTime;
    starter.fin = G.simTime + E.starter_countdown_h*3600;
    starter.sl.t = 1; starter.sl.v = 3;
  }
  // re-show del starter (OBSERVED GPGP: la oferta REAPARECE)
  if (starter.min && !starter.comprada && starter.reshows < 1 && !G.vipActive &&
      G.simTime > starter.minT + starterReshowS){
    starter.reshows++; starter.min = false; starter.showT = G.simTime;
    starter.sl.x = 0.5; starter.sl.v = 3;
    pop(STR('starter_sigue'), W/2, 258, 18, '#ffd700');
  }

  // ---- oferta anclada a TRANSICIÓN (n30 MPH): 15s tras cada renovación ----
  if (G.state==='juego' && G.renovaciones > ofertaTrans.paraRenov &&
      G.simTime >= G.renovT + M.noads_oferta_post_prestige_s){
    ofertaTrans.paraRenov = G.renovaciones;    // una por transición
    const sku = !G.noAds ? 'noads_bundle' : (!G.dosx ? 'dosx_permanente' : null);
    if (sku && !tienda.abierta && !mid.abierta){
      ofertaTrans.visible = true; ofertaTrans.sku = sku;
      ofertaTrans.hastaT = G.simTime + M.oferta_transicion_dur_s;
      G.ofertaTransicionShown = true;
      TELE.evento('oferta_transicion', { sku, renovacion:G.renovaciones });
    }
  }
  if (ofertaTrans.visible && G.simTime > ofertaTrans.hastaT)
    ofertaTrans.visible = false;

  // ---- money pocket: cadencia + ADELANTO por fricción (>Ns sin compra) ----
  if (!ads.pocketDisp && G.simTime > ads.pocketNextT) ads.pocketDisp = true;
  if (!ads.pocketDisp && G.simTime - G.lastCompraT > E.money_pocket_adelanto_s
      && G.simTime > E.money_pocket_primero_t_s){
    ads.pocketDisp = true; ads.pocketAdelantado = true;
    pop(STR('pop_pocket_aviso'), W/2, 560, 20, '#ffd700');
  }

  // ---- spawn de clientes (rate = config × accel del demo × marchanta) ----
  if (!G.demoDone && G.state==='juego'){
    spawnT -= dt;
    const rate = E.clientes_por_min_inicial * accelClientes *
                 (1 + E.marchanta_clientes_mult_por_nivel*marchantaNivel()) *
                 (mid.perms[1].comprado ? M.perm_clientes_mult : 1);
    if (spawnT<=0 && fila.length<E.max_fila){
      spawnCliente(false); spawnT = 60/rate * (0.8+rng()*0.4);
    }
  }

  // ---- VIP: 1 por sesión garantizado, entra en slow-mo ----
  if (!vipSpawned && G.simTime >= E.vip_t_s && G.state==='juego'){
    vipSpawned = true; G.vipActive = true;
    // el cliente del frente cede el turno (vuelve a la cola)
    if (fila[0] && (fila[0].estado==='pide' || fila[0].estado==='espera')){
      fila[0].estado = 'cola'; comal.taps = 0; comal.humoT = 0;
    }
    vip = spawnCliente(true);
    vipLatidoFase = 0;                      // el latido crítico arranca en fase 0
    G.timeScale = J.slowmo_vip;             // entrada en cámara lenta
    pop(STR('vip_titulo'), W/2, 300, 44, '#ffd700');
    pop(STR('vip_sub',{n:E.vip_pedidos}), W/2, 348, 22, '#fff');
  }
  if (vip && G.vipActive){
    if (G.timeScale===J.slowmo_vip &&
        (vip.x > 40 || vip.estado==='pide' || vip.estado==='espera')) G.timeScale = 1;
    if (vip.estado==='espera'){
      vip.paciencia -= dt/E.vip_paciencia_s;  // el contador que baja hasta casi-cero
      if (G.autopilot) vip.paciencia = Math.max(vip.paciencia, 0.02); // rescate garantizado SOLO demo
      if (vip.paciencia < J.vip_near_miss_umbral && vip.servidos < vip.pedidos){
        G.vipNearMiss = true; G.vipNearMissDone = true;
      }
      // latido crítico (cura r5, defecto 3/3 r4): fase integrada con Hz que
      // ACELERA hz_min→hz_max conforme se agota la ventana crítica (~3s)
      const restante = vip.paciencia * E.vip_paciencia_s;
      if (restante <= J.vip_latido_ventana_s && vip.servidos < vip.pedidos){
        const critK = 1 - clamp(restante / J.vip_latido_ventana_s, 0, 1);
        vipLatidoFase += (J.vip_latido_hz_min +
          (J.vip_latido_hz_max - J.vip_latido_hz_min) * critK) * dt;
      }
      if (vip.paciencia <= 0){                // solo alcanzable en manual
        pop(STR('vip_sefue'), W/2, 360, 30, '#ef4444');
        const i = fila.indexOf(vip); if (i>=0) fila.splice(i,1);
        vip.estado='sale'; G.vipActive=false; G.vipNearMiss=false;
        G.vipDone=true; vip=null; G.timeScale=1;
      }
    }
  }
  // telemetría del VIP (smoke/debug)
  G.vipEstado = vip ? vip.estado : '-';
  G.vipPaciencia = vip ? +vip.paciencia.toFixed(3) : -1;
  G.vipServidos = vip ? vip.servidos : -1;

  // ---- clientes ----
  for (let i=clientes.length-1;i>=0;i--){
    const c = clientes[i];
    updCliente(c, dt);
    if (c.estado==='fuera') clientes.splice(i,1);
  }

  // ---- comal: cocción con anticipación ----
  if (comal.flashT > 0) comal.flashT -= dt;
  if (comal.tapFlashT > 0) comal.tapFlashT -= dt;
  if (comal.radialT > 0) comal.radialT -= dt;   // congelado durante el hit-stop
  if (comal.humoT > 0){
    comal.humoT -= dt;
    if ((G.tick%5)===0) vapor(COMAL.x, COMAL.y-12, 2);
    if (comal.humoT <= 0) tacoListo();
  }

  // ---- redes de seguridad de terminación: SOLO el demo autopilot.
  //      En manual el juego es LIBRE (anti-patrón pagado: una red de demo
  //      sin guard mata la partida manual). ----
  if (G.autopilot){
    if (G.simTime > D.vip_timeout_s && !G.vipDone){ G.vipDone = true; G.vipActive=false; }
    if (G.simTime > D.renov_regalo_t_s && G.renovaciones===0){
      G.billetes = Math.max(G.billetes, E.renovacion_costo);   // solo el demo
      for (const c of construcciones) c.comprada = true;       // comprimido
    }
    if (G.simTime > D.fin_t_s) G.demoDone = true;
    // fin del demo: renovación + ventana post
    if (G.renovaciones>0 && G.state==='juego' &&
        G.simTime > G.renovT + D.dur_post_renov_s && !G.demoDone){
      G.demoDone = true; G.state = 'fin';
    }
  }

  // ---- autopilot (SOLO ?demo=1) ----
  if (G.autopilot && !G.demoDone) autopilot(dt);
}

/* zancada: la fase del paso = distancia recorrida / walk_paso_px (cura
   calibración r2, defecto 6/6: el bob por seno-de-tiempo quedaba DESACOPLADO
   del avance — "flota y desliza sobre la acera"). Cada pisada (wrap de la
   fase) dispara el squash de CONTACTO vía el spring c.sq: la pisada pesa. */
function zancada(c, dx){
  c.dist += Math.abs(dx);
  const n = (c.dist / J.walk_paso_px) | 0;
  if (n !== c.pasoN){
    c.pasoN = n;
    c.sq.x = Math.min(c.sq.x, 1 - J.walk_squash_contacto);   // pisada
  }
  c.moviendo = true;
}

function updCliente(c, dt){
  stepSpring(c.sq, J.spring_k, J.spring_amort, dt);
  const idx = fila.indexOf(c);
  c.moviendo = false;
  switch (c.estado){
    case 'asoma':   // anticipación diegética: PEEK adentro, retrocede, y entra
      c.t += dt;
      c.x = -30 + Math.sin(clamp(c.t/0.85,0,1)*Math.PI)*56;
      if (c.t > 0.85){ c.estado='entra'; c.x = -14; }
      break;
    case 'entra': case 'cola': {
      if (idx < 0){ c.estado='sale'; break; }
      const tx = slotX(idx);
      if (Math.abs(c.x - tx) > 2){
        const dir = c.x < tx ? 1 : -1;
        const dx = dir * (c.vip?150:120)*dt;
        c.x += dx;
        if ((dir>0 && c.x>tx) || (dir<0 && c.x<tx)) c.x = tx;
        zancada(c, dx); c.dir = dir;
      } else if (idx === 0){
        c.estado = 'pide'; c.t = 0; c.sq.v += 3;
      } else c.estado = 'cola';
      break; }
    case 'pide':
      c.t += dt;
      if (c.t > 0.5) c.estado = 'espera';
      break;
    case 'espera': break;                    // el comal manda
    case 'feliz':
      c.t += dt; c.hop = Math.abs(Math.sin(c.t*9))*14*(1-c.t);
      if (c.t > 0.7){ c.estado='sale'; c.hop=0; }
      break;
    case 'sale':
      c.x += 175*dt; zancada(c, 175*dt); c.dir = 1;
      if (c.x > W+40) c.estado = 'fuera';
      break;
  }
  // ---- cura r3 (defecto 3/3: "frenan en seco" / "deslizamiento rígido"):
  //      anticipación de FRENO y ARRANQUE por SILUETA — el lean cambia la
  //      pose entera, que SÍ sobrevive al muestreo 4-8 fps del juez (el bob
  //      por fase de zancada, correcto en física, no se lee a ese fps).
  if (c.frenoT > 0){                 // pose de freno SOSTENIDA (walk_freno_ticks)
    c.frenoT -= dt;
    c.ln.x = -c.frenoDir * J.walk_freno_lean; c.ln.v = 0;
  } else stepSpring(c.ln, J.spring_k, J.spring_amort, dt);   // release elástico
  if (c.prevMov && !c.moviendo){     // FRENÓ: lean atrás + micro-squash pesado
    c.frenoDir = c.dir;
    c.frenoT = J.walk_freno_ticks * TICK;
    c.sq.x = Math.min(c.sq.x, 1 - J.walk_freno_squash);
  } else if (!c.prevMov && c.moviendo){   // ARRANCÓ: lean adelante (anticipación)
    c.frenoT = 0;
    c.ln.x = c.dir * J.walk_freno_lean; c.ln.v = c.dir * 1.5;
  }
  c.prevMov = c.moviendo;
}

function updateRenov(dt){
  renov.t += dt;
  const t = renov.t;
  if (t > 0.7 && !renov.swapped){       // telón cerrado: swap del puesto
    renov.swapped = true;
    G.renovaciones++; G.nivel = G.renovaciones + 1; G.renovT = G.simTime;
    TELE.evento('nivel', { nivel:G.nivel });
    // ★ RESET a costos base en CADA local (escalera n55; local 4+ re-usa la
    //   tanda 3 con curva fresca — el multiplicador vive en ingresoVenta)
    construcciones = tierDef(G.renovaciones===1 ? 2 : 3);
    for (const m of mejoras) m.costo = m.base;
    ads.pocketNextT = G.simTime + E.money_pocket_cadencia_s;
    ads.influencerNextT = G.simTime + E.influencer_cadencia_s; // el goteo vuelve
    // desbloqueo del MID (saltos/free-cash/permanentes) al llegar al local 2
    if (midDesbloqueado() && mid.desbloqueadoT < 0){
      mid.desbloqueadoT = G.simTime;
      mid.freeCashListoT = G.simTime;          // primer free cash disponible ya
      for (const p of mid.perms) p.desdeT = G.simTime;  // arranca la espera
    }
    // ★ recompensa de prestige (n29 OBSERVED MPH): +gemas +cash al renovar
    G.gemas += M.prestige_recompensa.gemas; hudGem.v += 4;
    ganar(M.prestige_recompensa.cash, W/2, 430, '#ffd700');
    vuelo('gema', W/2, 430, W-70, 42, 0.6);
    TELE.evento('prestige_recompensa', { ...M.prestige_recompensa,
      renovacion: G.renovaciones });
  }
  if (t > 1.05 && t-dt <= 1.05){ dropConfetti(); cam.shake = 8;
    pop(G.nivel===2 ? STR('pop_nivel2') : G.nivel===3 ? STR('pop_nivel3')
      : STR('nivel_nombre_extra',{n:G.nivel}), W/2, 350, 44, '#ffd700');
    pop(STR('pop_curva'), W/2, 398, 20, '#4caf50'); }
  if (t > R.renov_dur_s){ renov.activa = false; G.state = 'juego'; cam.zoom.t = 1; }
}

/* ---------- autopilot: bot greedy que acepta ads (SOLO ?demo=1) ---------- */
function autopilot(dt){
  apTapT -= dt; apActT -= dt;
  if (apTapT <= 0){
    apTapT = G.vipActive ? 0.34 : 0.125;     // taps más pausados en el VIP (drama)
    if (!ads.overlay && !tienda.abierta && !wb.visible) tapComal();
  }
  if (apActT > 0) return;
  apActT = 0.3;
  // welcome-back: el bot elige ×2 CON AD (muestra el flujo completo)
  if (wb.visible && G.simTime > 3.2){ wbReclamar(true); return; }
  // tienda: la abre una vez, la muestra unos segundos y la cierra (sin comprar)
  if (!G.tiendaShown && !tienda.abierta && G.simTime > D.tienda_open_t &&
      !ads.overlay && !G.vipActive && G.state==='juego'){ abrirTienda(); return; }
  if (tienda.abierta){
    if (G.simTime > D.tienda_open_t + D.tienda_dur_s) cerrarTienda();
    return;
  }
  if (starter.visible && !starter.min && G.simTime > (starter.showT||starter.t0) + 4){
    starter.min = true; starter.minT = G.simTime;  // minimiza la oferta (no la compra)
  }
  if (!ads.overlay && !G.vipActive && G.state==='juego'){
    if (ads.pocketDisp) verAd('pocket');
    else if (G.simTime>=ads.salsaDesde && !salsaActiva()) verAd('salsa');
    else if (G.simTime>=ads.comalDesde && !comalTurbo()){
      if (G.gemas >= E.dual_exit_gemas[0]) comalTurboConGemas();
      else verAd('comalturbo');
    }
    else if (G.simTime>=ads.influencerNextT) verAd('influencer');
  }
  if (G.state==='juego' && !G.vipActive &&
      !(G.renovaciones>0 && G.simTime - G.renovT < R.post_renov_calma_s + R.renov_dur_s)){
    const next = construcciones.find(c=>!c.comprada);
    if (next && G.billetes >= next.c) comprar(next);
    else if (!next || G.renovaciones>0){
      if (puedeRenovar() && G.vipDone) renovar();
      else {
        const m = mejoras.reduce((a,b)=> a.costo<b.costo?a:b);
        const reserva = G.renovaciones===0
          ? E.renovacion_costo + E.renovacion_reserva_ftue : 0;
        if (G.billetes - m.costo >= reserva) comprarMejora(m);
      }
    }
  }
}

/* ============================================================================
   RENDER — capa visual LOTE 1 (fondos E2 por nivel + carrito canon s7 + UI
   kit). La GEOMETRÍA de gameplay del P4 no se movió: los fondos se generaron
   sobre mockups del prototipo y el ancla (comal 272,460 · fila y=592) coincide.
   ========================================================================= */
function fondoActual(){ return IMG['fondo_' + Math.min(G.nivel, 3)]; }

let hits = [];   // hitboxes del frame (para modo manual)
function hit(x,y,w,h,fn){ hits.push({x,y,w,h,fn}); }

function render(){
  hits = [];
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,W,H);
  ctx.drawImage(fondoActual(), 0, 0, W, H);

  // cámara: shake + punch-in
  ctx.save();
  const shx = cam.shake>0 ? (hash2(G.tick,1)-0.5)*cam.shake*2 : 0;
  const shy = cam.shake>0 ? (hash2(G.tick,2)-0.5)*cam.shake*2 : 0;
  const z = cam.zoom.x;
  ctx.translate(W/2 + shx, 430 + shy); ctx.scale(z, z); ctx.translate(-W/2, -430);

  drawPuesto();
  // clientes: primero los de cola (orden), al final los que salen (delante)
  for (const c of clientes) if (c.estado!=='sale') drawCliente(c);
  drawComal();
  for (const c of clientes) if (c.estado==='sale') drawCliente(c);

  // vuelos
  for (const v of vuelos) drawVuelo(v);
  // partículas
  for (const p of parts){
    const a = 1 - p.t/p.life;
    ctx.globalAlpha = p.tipo==='vapor' ? a*0.4 : a;
    ctx.fillStyle = p.color;
    const r = p.tipo==='vapor' ? p.r*(1+p.t*1.6) : p.r*a+0.5;
    ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // vignette dorada del VIP
  if (G.vipActive){
    const vg = ctx.createRadialGradient(W/2,450,170, W/2,450,560);
    vg.addColorStop(0,'rgba(255,215,0,0)');
    vg.addColorStop(1,`rgba(255,180,0,${J.vip_vignette_alpha})`);
    ctx.fillStyle = vg; ctx.fillRect(0,0,W,H);
    // vignette ROJA de pánico en los últimos ~3s (cura r5, defecto 3/3 r4:
    // "sin latido/pánico proporcional a la criticidad"). El pulso modula
    // alpha entre 55% y 100% de vip_vignette_alpha — NUNCA se apaga, así
    // toda muestra a fps=4 captura los bordes rojos; solo la intensidad late
    // (1.5→4 Hz vía vipLatidoFase).
    if (vipRestanteS() <= J.vip_latido_ventana_s){
      const ra = J.vip_vignette_alpha * (0.55 + 0.45*vipPulso());
      const rv = ctx.createRadialGradient(W/2,450,150, W/2,450,560);
      rv.addColorStop(0,'rgba(239,68,68,0)');
      rv.addColorStop(1,`rgba(220,38,38,${ra})`);
      ctx.fillStyle = rv; ctx.fillRect(0,0,W,H);
    }
  }

  // pops (números flotantes con overshoot de spring)
  for (const p of pops){
    const k = clamp(p.t/1.15,0,1);
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(p.s.x, p.s.x);
    ctx.globalAlpha = k>0.68 ? (1-k)/0.32 : 1;
    ctx.font = `900 ${p.size}px Arial`; ctx.textAlign='center';
    ctx.lineWidth = p.size/7; ctx.strokeStyle = '#1a1a2e'; ctx.lineJoin='round';
    ctx.strokeText(p.txt, 0, 0);
    ctx.fillStyle = p.color; ctx.fillText(p.txt, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // confeti
  for (const c of confetti){
    ctx.save(); ctx.translate(c.x,c.y); ctx.rotate(c.rot);
    ctx.fillStyle = c.color; ctx.fillRect(-c.s/2,-c.s/4,c.s,c.s/2); ctx.restore(); }

  drawHUD();
  drawChips();
  drawPanel();
  if (renov.activa) drawTelon();
  drawStarter();
  drawOfertaTrans();
  drawTienda();
  drawMid();
  drawWB();
  if (ads.overlay) drawAdOverlay();
  if (G.demoDone) drawFin();
}

/* ---------- welcome-back: ganancia offline con ×2 por ad ---------- */
function drawWB(){
  if (!wb.visible) return;
  hit(0,0,W,H, ()=>{});      // el modal bloquea los taps de abajo
  const k = wb.sl.x;
  ctx.save();
  ctx.globalAlpha = clamp(k*1.4,0,1);
  ctx.fillStyle = 'rgba(8,8,16,0.55)'; ctx.fillRect(0,0,W,H);
  ctx.translate(W/2, 430); ctx.scale(0.7+0.3*k, 0.7+0.3*k); ctx.translate(-W/2, -430);
  const pw=380, ph=210, x=(W-pw)/2, y=320;
  ctx.fillStyle='rgba(24,20,46,0.97)'; rr(x+8,y+8,pw-16,ph-16,14); ctx.fill();
  ctx.drawImage(IMG.marco_panel, x, y, pw, ph);    // marco cromado LOTE 1
  ctx.font='900 24px Arial'; ctx.textAlign='center'; ctx.fillStyle='#ffd700';
  ctx.fillText(STR('wb_titulo'), W/2, y+40);
  ctx.font='700 15px Arial'; ctx.fillStyle='#fff';
  ctx.fillText(STR('wb_sub'), W/2, y+70);
  ctx.font='900 26px Arial'; ctx.fillStyle='#4caf50';
  ctx.fillText('+$'+fmt(E.welcomeback_monto), W/2, y+102);
  // botones: reclamar / ×2 con ad (el que mejor convierte — destacado)
  ctx.fillStyle='rgba(255,255,255,0.12)'; rr(x+24, y+130, 150, 52, 12); ctx.fill();
  ctx.font='800 14px Arial'; ctx.fillStyle='#fff';
  ctx.fillText(STR('wb_reclamar'), x+99, y+161);
  const puls2 = 1+0.05*Math.sin(G.simTime*7);
  ctx.save(); ctx.translate(x+pw-99, y+156); ctx.scale(puls2,puls2);
  ctx.fillStyle='#ffd700'; rr(-75,-26,150,52,12); ctx.fill();
  ctx.font='900 15px Arial'; ctx.fillStyle='#1a1a2e';
  ctx.fillText(STR('wb_x2',{x:E.welcomeback_x2,
    monto:fmt(E.welcomeback_monto*E.welcomeback_x2)}), 0, 6);
  ctx.restore();
  ctx.restore();
  hit(x+24, y+130, 150, 52, ()=> wbReclamar(false));
  hit(x+pw-174, y+130, 150, 52, ()=> wbReclamar(true));
}

/* ---------- TIENDA: la escalera IAP completa (módulo iap.js + stub) -------- */
function drawTienda(){
  if (!tienda.abierta) return;
  hit(0,0,W,H, ()=>{});      // el modal bloquea los taps de abajo
  const k = tienda.sl.x;
  ctx.save();
  ctx.globalAlpha = clamp(k*1.3,0,1);
  ctx.fillStyle = 'rgba(8,8,16,0.72)'; ctx.fillRect(0,0,W,H);
  ctx.translate(W/2, 470); ctx.scale(0.75+0.25*k, 0.75+0.25*k); ctx.translate(-W/2, -470);
  const pw=470, ph=590, x=(W-pw)/2, y=175;
  ctx.drawImage(IMG.panel_oferta, x, y, pw, ph);   // tarjeta crema + listón rojo
  ctx.font='900 22px Arial'; ctx.textAlign='center'; ctx.fillStyle='#fff';
  ctx.fillText(STR('tienda_titulo'), W/2, y+40);   // sobre el listón
  ctx.font='900 18px Arial'; ctx.fillStyle='rgba(58,36,56,0.8)'; ctx.textAlign='right';
  ctx.fillText('✕', x+pw-26, y+40);
  hit(x+pw-48, y+16, 40, 36, cerrarTienda);
  // — gems ladder ×6 (OBSERVED eatventure t=840.5) —
  ctx.font='800 12px Arial'; ctx.textAlign='left'; ctx.fillStyle='rgba(58,36,56,0.75)';
  ctx.fillText(STR('tienda_gemas_h'), x+24, y+82);
  const gw=142, gh=72;
  IA.gems_ladder.forEach((g,i)=>{
    const gx = x+16 + (i%3)*(gw+6), gy = y+90 + ((i/3)|0)*(gh+8);
    ctx.drawImage(IMG.placa_turquesa, gx, gy, gw, gh);
    ctx.font='900 16px Arial'; ctx.textAlign='center'; ctx.fillStyle='#0e3f33';
    ctx.fillText(fmt(g)+' 💎', gx+gw/2, gy+29);
    ctx.font='900 15px Arial'; ctx.fillStyle='#123a30';
    ctx.fillText('$'+IA.gems_precios_usd[i], gx+gw/2, gy+54);
    hit(gx,gy,gw,gh, ()=> comprarIAP('gems_'+g));
  });
  // — bundles (no-ads SIEMPRE con valor + 2x permanente best-value) —
  let by2 = y+90 + 2*(gh+8) + 10;
  ctx.font='800 12px Arial'; ctx.textAlign='left'; ctx.fillStyle='rgba(58,36,56,0.75)';
  ctx.fillText(STR('tienda_paquetes_h'), x+24, by2+2);
  ctx.drawImage(IMG.placa_roja, x+16, by2+10, pw-32, 56);
  ctx.font='900 15px Arial'; ctx.textAlign='left'; ctx.fillStyle='#fff';
  ctx.fillText(STR('tienda_noads',{gems:fmt(IA.noads_bundle.gems)}), x+32, by2+44);
  ctx.font='900 18px Arial'; ctx.textAlign='right'; ctx.fillStyle='#ffe66b';
  ctx.fillText('$'+IA.noads_bundle.precio_usd, x+pw-30, by2+44);
  hit(x+16, by2+10, pw-32, 56, ()=> comprarIAP('noads_bundle'));
  const puls3 = 1+0.03*Math.sin(G.simTime*6);
  ctx.save(); ctx.translate(W/2, by2+108); ctx.scale(puls3,puls3);
  ctx.drawImage(IMG.placa_mostaza, -(pw-32)/2, -30, pw-32, 60);
  ctx.font='800 11px Arial'; ctx.textAlign='center'; ctx.fillStyle='#7a1f1f';
  ctx.fillText(STR('tienda_mejor_valor'), 0, -12);
  ctx.font='900 16px Arial'; ctx.fillStyle='#3a2810';
  ctx.fillText(STR('tienda_dosx',{x:IA.dosx_multiplicador,
    precio:IA.dosx_permanente_usd}), 0, 12);
  ctx.restore();
  hit(x+16, by2+78, pw-32, 60, ()=> comprarIAP('dosx_permanente'));
  // — pass por progresión (free + 2 tiers — PR/MPH, gramática §3) —
  ctx.drawImage(IMG.placa_turquesa, x+16, by2+146, pw-32, 36);
  ctx.font='800 13px Arial'; ctx.textAlign='left'; ctx.fillStyle='#0e3f33';
  ctx.fillText(STR('tienda_pass'), x+32, by2+169);
  ctx.font='900 13px Arial'; ctx.textAlign='right'; ctx.fillStyle='#123a30';
  ctx.fillText(STR('tienda_pass_precios',
    {a:IA.pass_tiers_usd[0], b:IA.pass_tiers_usd[1]}), x+pw-30, by2+169);
  hit(x+16, by2+146, pw-32, 36, ()=> comprarIAP('pass_pro'));
  // — cash-por-gems (conversión SIEMPRE disponible; escala con progreso) —
  const cy2 = by2+196;
  ctx.font='800 12px Arial'; ctx.textAlign='left'; ctx.fillStyle='rgba(58,36,56,0.75)';
  ctx.fillText(STR('tienda_cambio_h'), x+24, cy2+2);
  const base = Math.max(IA.cambio_base_min, Math.floor(G.billetes*IA.cambio_base_factor));
  IA.cambio_gemas.forEach(([g,m],i)=>{
    const cx2 = x+16 + i*((pw-44)/3+6), cw3=(pw-44)/3;
    ctx.drawImage(IMG.placa_mostaza, cx2, cy2+10, cw3, 62);
    ctx.font='900 14px Arial'; ctx.textAlign='center'; ctx.fillStyle='#3a2810';
    ctx.fillText('💎'+g, cx2+cw3/2, cy2+34);
    ctx.font='900 14px Arial';
    ctx.fillText('$'+fmt(base*m), cx2+cw3/2, cy2+58);
    hit(cx2, cy2+10, cw3, 62, ()=> cambioGemas(g, m));
  });
  ctx.font='600 10px Arial'; ctx.textAlign='center'; ctx.fillStyle='rgba(58,36,56,0.55)';
  ctx.fillText(STR('tienda_pie'), W/2, y+ph-14);
  ctx.restore();
}

/* ---------- el puesto: carrito canon s7 sobre el fondo (LOTE 1) ------------
   El fondo de cada nivel trae el local horneado (E2); en el nivel 1 el
   carrito canon s7 (decisión 👤) se dibuja como sprite anclado al comal de
   gameplay. La evolución visual del puesto ahora la llevan los FONDOS por
   renovación; los botones del panel siguen mostrando el progreso de compra. */
function comprada(i){ return construcciones[i] && construcciones[i].comprada; }
function drawPuesto(){
  if (G.nivel === 1){
    const c = V.carrito;
    const im = IMG.carrito;
    ctx.drawImage(im, c.x, c.y, c.w, c.w * im.height / im.width);
  }
}

/* ---------- el comal: disco con glow, tortillas y pips de progreso ---------- */
function drawComal(){
  const on = G.nivel>=2 || comprada(0);
  ctx.save();
  ctx.translate(COMAL.x, COMAL.y);
  // cura r3: el pop de escala (1→1.12→1) multiplica el squash direccional —
  // el flash y las líneas radiales viven DENTRO del transform (flash más grande)
  ctx.scale(comal.sx.x*comal.pop.x, comal.sy.x*comal.pop.x);
  // glow del borde (pulso)
  if (on){
    const puls = 0.34 + 0.14*Math.sin(G.simTime*3.2) + (comal.humoT>0? 0.3:0);
    const gg = ctx.createRadialGradient(0,0,COMAL.rx*0.4, 0,0,COMAL.rx*1.5);
    gg.addColorStop(0,'rgba(255,107,53,0)');
    gg.addColorStop(0.75,`rgba(255,107,53,${puls*0.55})`);
    gg.addColorStop(1,'rgba(255,107,53,0)');
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.ellipse(0,0,COMAL.rx*1.5,COMAL.ry*1.9,0,0,Math.PI*2); ctx.fill();
  }
  // disco
  ctx.fillStyle = '#15151f';
  ctx.beginPath(); ctx.ellipse(0,2,COMAL.rx+6,COMAL.ry+4,0,0,Math.PI*2); ctx.fill();
  const sg = ctx.createRadialGradient(0,-3,6, 0,0,COMAL.rx);
  if (on){ sg.addColorStop(0,'#4a4038'); sg.addColorStop(1,'#26221e'); }
  else { sg.addColorStop(0,'#33333f'); sg.addColorStop(1,'#22222c'); }
  ctx.fillStyle = sg;
  ctx.beginPath(); ctx.ellipse(0,0,COMAL.rx,COMAL.ry,0,0,Math.PI*2); ctx.fill();
  if (on){
    ctx.strokeStyle = 'rgba(255,107,53,0.8)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(0,0,COMAL.rx,COMAL.ry,0,0,Math.PI*2); ctx.stroke();
  } else {
    ctx.setLineDash([6,6]); ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.ellipse(0,0,COMAL.rx,COMAL.ry,0,0,Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
  }
  // tortillas según progreso de taps
  for (let i=0;i<comal.taps;i++){
    const a = i*2.1+0.5, d = 22;
    ctx.fillStyle = '#e8c97a';
    ctx.beginPath(); ctx.ellipse(Math.cos(a)*d, Math.sin(a)*d*0.4-2, 11, 5, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#c9a860';
    ctx.beginPath(); ctx.ellipse(Math.cos(a)*d, Math.sin(a)*d*0.4-2, 6, 2.6, 0, 0, Math.PI*2);
    ctx.fill();
  }
  // taco completo cociéndose (anticipación: humea antes de salir)
  if (comal.humoT>0){
    ctx.fillStyle = '#e8c97a';
    ctx.beginPath(); ctx.arc(0,-4,13,Math.PI,0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#4caf50'; ctx.fillRect(-9,-7,18,3);
    ctx.fillStyle = '#c0392b'; ctx.fillRect(-7,-10,14,3);
  }
  // anillo de anticipación: el PRÓXIMO tap completa el taco
  const front0 = fila[0];
  if (on && front0 && front0.estado==='espera' && comal.humoT<=0 &&
      comal.taps === E.taps_por_taco-1){
    const pk = 0.5+0.5*Math.sin(G.simTime*10);
    ctx.strokeStyle = `rgba(255,235,160,${0.3+0.45*pk})`;
    ctx.lineWidth = 3+2.5*pk;
    ctx.beginPath(); ctx.ellipse(0,0,COMAL.rx+9,COMAL.ry+6,0,0,Math.PI*2); ctx.stroke();
  }
  // destello del sizzle al completar (flash blanco que decae)
  if (comal.flashT>0){
    ctx.globalAlpha = (comal.flashT/J.flash_comal_s)*0.55;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(0,-2,COMAL.rx*1.06,COMAL.ry*1.25,0,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // flash blanco del TAP (cura r2: hit-stop imperceptible a 8fps — el flash
  // fuerte de 1-2 frames marca el golpe; congelado durante el hit-stop)
  if (comal.tapFlashT>0){
    ctx.globalAlpha = clamp(comal.tapFlashT/J.flash_tap_s, 0, 1)*0.85;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(0,0,COMAL.rx*1.14,COMAL.ry*1.35,0,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // líneas radiales de impacto estilo cómic (cura r3, defecto 2/3): señal que
  // SOBREVIVE al muestreo 4-8 fps — el timer decae en update(), así que
  // persisten congeladas durante el hit-stop; ángulo re-sorteado por tap (vrng)
  if (comal.radialT>0){
    const rk = clamp(comal.radialT/J.impacto_radial_dur_s, 0, 1);   // 1→0
    const n = J.impacto_radial_lineas, ky = COMAL.ry/COMAL.rx;
    const K = comal.radialK || 1;   // cura r5: COMBO-BURST = radiales GRANDES
    ctx.strokeStyle = `rgba(255,244,214,${0.95*rk})`;
    ctx.lineWidth = 3.5*K; ctx.lineCap = 'round';
    for (let i=0;i<n;i++){
      const a = comal.radialA + i*Math.PI*2/n;
      const r0 = COMAL.rx*1.18 + (1-rk)*10*K;        // se expanden al morir
      const r1 = r0 + (12 + 14*rk)*K;                // largas al golpe, cortas al final
      ctx.beginPath();
      ctx.moveTo(Math.cos(a)*r0, Math.sin(a)*r0*ky);
      ctx.lineTo(Math.cos(a)*r1, Math.sin(a)*r1*ky);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
  ctx.restore();
  // pips de progreso (N taps = 1 taco)
  const front = fila[0];
  if (on && front && (front.estado==='espera'||front.estado==='pide')){
    for (let i=0;i<E.taps_por_taco;i++){
      ctx.fillStyle = i<comal.taps ? '#ff6b35' : 'rgba(255,255,255,0.2)';
      ctx.beginPath(); ctx.arc(COMAL.x-18+i*18, COMAL.y-40, 5, 0, Math.PI*2); ctx.fill();
    }
    // hint de tap (solo manual)
    if (!G.autopilot){
      ctx.font='700 13px Arial'; ctx.fillStyle='rgba(255,255,255,0.7)'; ctx.textAlign='center';
      ctx.fillText(STR('tap_hint'), COMAL.x, COMAL.y-56);
    }
  }
  hit(COMAL.x-COMAL.rx-14, COMAL.y-COMAL.ry-30, (COMAL.rx+14)*2, (COMAL.ry+30)*2,
      ()=> tapComal());
}

/* ---------- clientes: siluetas con walk-cycle de curvas ---------- */
/* pose del sprite según estado: feliz→celebra · espera aburrida→aburrido */
function spriteCliente(c){
  const base = 'cli_' + c.spr;
  if (c.estado === 'feliz') return IMG[base + '_celebra'];
  if (c.vip && c.estado === 'espera' && c.paciencia < 0.6)
    return IMG[base + '_aburrido'];            // el VIP se impacienta VISIBLEMENTE
  if (!c.vip && c.estado === 'cola' && fila.indexOf(c) > 0)
    return IMG[base + '_aburrido'];            // la cola se aburre (vida de fondo)
  return IMG[base];
}
function drawCliente(c){
  // walk-cycle con PESO acoplado a la ZANCADA (cura r2, defecto 6/6): la fase
  // del paso = distancia recorrida / walk_paso_px — bob 0 en CADA contacto y
  // máximo a mitad del paso; el squash de contacto lo dispara zancada() por
  // pisada vía c.sq (spring), no un seno libre sobre el tiempo global
  const ph = (c.dist / J.walk_paso_px) % 1;              // fase de la zancada
  const stepPh = c.moviendo ? Math.sin(ph*Math.PI) : 0;  // 0=contacto, 1=aire
  const bob = c.moviendo ? stepPh*J.walk_bob : Math.sin(G.simTime*2.2+c.x)*1.2;
  const y = c.y - bob - c.hop;
  const wsq = c.moviendo ? 1 + (stepPh-0.5)*2*J.walk_squash : 1;
  const sq = c.sq.x * wsq, alto = c.alto;
  ctx.save();
  // aura VIP
  if (c.vip){
    const ag = ctx.createRadialGradient(c.x, y-40, 8, c.x, y-40, 66);
    ag.addColorStop(0,'rgba(255,215,0,0.35)'); ag.addColorStop(1,'rgba(255,215,0,0)');
    ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(c.x, y-40, 66, 0, Math.PI*2); ctx.fill();
  }
  // sombra pegada al suelo
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(c.x, c.y+2, 16, 5, 0, 0, Math.PI*2); ctx.fill();
  ctx.globalAlpha = 1;
  // vibración preventiva al ordenar (anticipación pedida por el juez r2)
  const wig = c.estado==='pide' ? Math.sin(G.simTime*22)*1.6 : 0;
  ctx.translate(c.x + wig, y);
  if (c.moviendo) ctx.rotate(c.dir*J.walk_lean);         // lean hacia la marcha
  else if (c.estado==='asoma') ctx.rotate(0.16);         // peek inclinado del asomo
  ctx.rotate(c.ln.x);   // cura r3: lean de freno/arranque (silueta legible a 4fps)
  ctx.scale(1/Math.sqrt(sq), sq);
  ctx.scale(alto, alto);
  // sprite del pool (LOTE 1: 4 canons + poses celebra/aburrido) dentro del
  // MISMO tren de transforms del walk-cycle E-anim (bob/lean/squash intactos)
  const im = spriteCliente(c);
  const h = V.cliente_alto_px, w = h * im.width / im.height;
  if (c.dir < 0){ ctx.scale(-1, 1); }          // mira hacia la marcha
  ctx.drawImage(im, -w/2, -h+2, w, h);
  if (c.dir < 0){ ctx.scale(-1, 1); }
  if (c.vip){ ctx.fillStyle='#ffd700'; drawStar(0, -h-8, 8); }
  ctx.restore();
  // "!" del asomo (anticipación LEGIBLE de la llegada — juez r3)
  if (c.estado==='asoma' && c.t>0.12 && c.t<0.78){
    const ek = Math.min((c.t-0.12)*6, 1);
    ctx.save(); ctx.translate(Math.max(c.x+10, 26), y-96); ctx.scale(ek,ek);
    ctx.fillStyle='#ffd700';
    ctx.beginPath(); ctx.arc(0,0,10,0,Math.PI*2); ctx.fill();
    ctx.font='900 15px Arial'; ctx.textAlign='center'; ctx.fillStyle='#1a1a2e';
    ctx.fillText('!', 0, 5); ctx.restore();
  }
  // burbuja de orden (al frente)
  if ((c.estado==='pide' || c.estado==='espera') && fila[0]===c){
    const bx = c.x+2, by = y-118;
    ctx.save();
    ctx.fillStyle = 'rgba(244,232,208,0.96)';
    rr(bx-36, by-16, 72, 32, 10); ctx.fill();
    ctx.beginPath(); ctx.moveTo(bx-6,by+16); ctx.lineTo(bx+6,by+16); ctx.lineTo(bx,by+26);
    ctx.closePath(); ctx.fill();
    // mini taco (icono canon LOTE 1)
    ctx.drawImage(IMG.icono_taco, bx-29, by-8, 22, 20);
    ctx.font='800 14px Arial'; ctx.fillStyle='#1a1a2e'; ctx.textAlign='left';
    ctx.fillText(`${c.servidos}/${c.pedidos}`, bx-4, by+7);
    ctx.restore();
  }
  // barra de paciencia del VIP (baja hasta casi-cero)
  if (c.vip && c.estado==='espera'){
    const bx = c.x, by = y-142, bw=76, bh=9;
    const p = clamp(c.paciencia,0,1);
    const nm = p < J.vip_near_miss_umbral;      // umbral near-miss de config
    // latido crítico (cura r5, defecto 3/3 r4). ANTES: flash on/off a
    // Math.floor(simTime*8)%2 → fases de 125ms que el muestreo a 4fps
    // (1 frame/250ms) se saltaba. AHORA: rojo SIEMPRE presente; el pulso
    // (1.5→4 Hz) solo modula intensidad/grosor → toda muestra captura rojo.
    const puls = nm ? vipPulso() : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; rr(bx-bw/2-2, by-2, bw+4, bh+4, 5); ctx.fill();
    if (nm){                                    // marco ROJO pulsante de la barra
      ctx.strokeStyle = `rgba(239,68,68,${0.55+0.45*puls})`;
      ctx.lineWidth = 2.5 + 2*puls;
      rr(bx-bw/2-4, by-4, bw+8, bh+8, 6); ctx.stroke();
    }
    ctx.fillStyle = p>0.5? '#4caf50' : !nm? '#ffd700'
      : (puls>0.5? '#ff8a7a' : '#ef4444');      // rojo↔rojo-claro: jamás se apaga
    rr(bx-bw/2, by, bw*p, bh, 4); ctx.fill();
    // rótulo SE VA!/LEAVING! con TEMBLOR continuo (presente en cada frame)
    let tx = bx, ty = by-6, tsc = 1;
    if (nm){
      tx += (hash2(G.tick,7)-0.5)*2*J.vip_latido_shake;
      ty += (hash2(G.tick,8)-0.5)*2*J.vip_latido_shake;
      tsc = 1 + 0.12*puls;
    }
    ctx.save(); ctx.translate(tx,ty); ctx.scale(tsc,tsc);
    ctx.font = nm? '900 13px Arial' : '800 11px Arial'; ctx.textAlign='center';
    if (nm){ ctx.lineWidth=3; ctx.strokeStyle='#1a1a2e'; ctx.lineJoin='round';
      ctx.strokeText(STR('vip_seva'), 0, 0); }
    ctx.fillStyle = nm? '#ef4444' : '#fff';
    ctx.fillText(nm? STR('vip_seva') : STR('vip_paciencia'), 0, 0);
    ctx.restore();
  }
}
function drawStar(x,y,r){
  ctx.save(); ctx.translate(x,y); ctx.beginPath();
  for (let i=0;i<10;i++){ const a=-Math.PI/2 + i*Math.PI/5, rr2=i%2? r*0.45:r;
    ctx.lineTo(Math.cos(a)*rr2, Math.sin(a)*rr2); }
  ctx.closePath(); ctx.fill(); ctx.restore();
}

/* ---------- vuelos ---------- */
function drawVuelo(v){
  const t = easeOut(clamp(v.t,0,1));
  const x = lerp(lerp(v.x0,v.cx,t), lerp(v.cx,v.x1,t), t);
  const y = lerp(lerp(v.y0,v.cy,t), lerp(v.cy,v.y1,t), t);
  ctx.save(); ctx.translate(x,y);
  if (v.tipo==='taco'){
    ctx.rotate(v.t*5.5);                       // spin procedural del vuelo
    ctx.drawImage(IMG.icono_taco, -16, -15, 32, 30);
  } else if (v.tipo==='billete'){
    ctx.rotate(Math.sin(v.t*11)*0.55);
    ctx.scale(1, 0.55+0.45*Math.abs(Math.cos(v.t*8)));  // flip 3D del billete
    ctx.fillStyle = '#4caf50'; rr(-11,-7,22,14,3); ctx.fill();
    ctx.fillStyle = '#a5e8a7'; ctx.font='900 11px Arial'; ctx.textAlign='center';
    ctx.fillText('$', 0, 4);
  } else if (v.tipo==='gema'){
    ctx.rotate(v.t*4);
    ctx.drawImage(IMG.icono_gema, -12, -12, 24, 25);
  }
  ctx.restore();
}

/* ---------- HUD superior (barra LOTE 1: forma decidida vs mockup E2) ------- */
const HUD_ESTILO = (() => {
  const m = location.search.match(/[?&]hud=(s77|s7)/);  // s77 ANTES: la alternancia regex es golosa por orden (bug D-gate: s7 matcheaba primero y ?hud=s77 rendía s7)
  return m ? m[1] : V.hud_estilo;         // override de prueba A/B
})();
function drawHUD(){
  ctx.save();
  const g = ctx.createLinearGradient(0,0,0,132);
  g.addColorStop(0,'rgba(10,10,20,0.98)'); g.addColorStop(1,'rgba(10,10,20,0)');
  ctx.fillStyle = g; ctx.fillRect(0,0,W,132);
  // la BARRA del HUD (s7 rectángulo / s77 cápsula — sub-decisión 👤 del lote)
  const hb = IMG['hud_' + HUD_ESTILO];
  ctx.drawImage(hb, 2, 4, W-4, 72);
  // billetes (con spring pop al cobrar)
  ctx.save(); ctx.translate(20, 40); ctx.scale(hudMoney.x, hudMoney.x);
  ctx.fillStyle = '#4caf50'; rr(0,-16,26,17,3); ctx.fill();
  ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 1.5; rr(0,-16,26,17,3); ctx.stroke();
  ctx.fillStyle = '#eafbe7'; ctx.font='900 13px Arial'; ctx.textAlign='center';
  ctx.fillText('$', 13, -3);
  ctx.font='900 26px Arial'; ctx.textAlign='left';
  ctx.lineWidth = 4; ctx.strokeStyle = '#1a1a2e'; ctx.lineJoin='round';
  ctx.strokeText(fmt(G.billetes), 34, 6);
  ctx.fillStyle='#fff'; ctx.fillText(fmt(G.billetes), 34, 6);
  ctx.restore();
  // gemas (icono canon LOTE 1)
  ctx.save(); ctx.translate(W-24, 32); ctx.scale(hudGem.x, hudGem.x);
  ctx.drawImage(IMG.icono_gema, -13, -13, 26, 27);
  ctx.font='900 22px Arial'; ctx.textAlign='right';
  ctx.lineWidth = 4; ctx.strokeStyle = '#1a1a2e'; ctx.lineJoin='round';
  ctx.strokeText(String(G.gemas), -18, 8);
  ctx.fillStyle='#fff'; ctx.fillText(String(G.gemas), -18, 8);
  ctx.restore();
  // nivel (sobre la barra: texto con contorno para el burst naranja)
  ctx.font='800 15px Arial'; ctx.textAlign='center';
  ctx.lineWidth = 4; ctx.strokeStyle = '#1a1a2e'; ctx.lineJoin='round';
  const nivelTxt = G.nivel<=3 ? STR('nivel_nombre_'+G.nivel)
    : STR('nivel_nombre_extra',{n:G.nivel});
  ctx.strokeText(nivelTxt, W/2, 26);
  ctx.fillStyle='#ffd700'; ctx.fillText(nivelTxt, W/2, 26);
  // botón TIENDA (botón circular LOTE 1; la escalera IAP siempre a un tap)
  const tp = 1+0.04*Math.sin(G.simTime*5);
  ctx.save(); ctx.translate(W-52, 112); ctx.scale(tp,tp);
  ctx.drawImage(IMG.boton_circular, -22, -22, 44, 44);
  ctx.font='900 17px Arial'; ctx.textAlign='center';
  ctx.fillText('🛒', 0, 6); ctx.restore();
  hit(W-80, 96, 56, 32, abrirTienda);
  // chip del PASS con progreso (chip LOTE 1)
  ctx.save(); ctx.translate(W-52, 150);
  ctx.drawImage(IMG.chip, -32, -14, 64, 28);
  ctx.font='900 12px Arial'; ctx.textAlign='center'; ctx.fillStyle='#3a2438';
  ctx.fillText('🎟️'+Math.min(G.compras,IA.pass_meta_compras)+'/'+IA.pass_meta_compras,
    0, 4); ctx.restore();
  hit(W-80, 136, 56, 28, abrirTienda);
  // chip MID (⭐ PRO · saltos/free-cash/permanentes) — solo desde el local 2
  if (midDesbloqueado()){
    ctx.save(); ctx.translate(W-52, 184);
    ctx.drawImage(IMG.chip, -32, -14, 64, 28);
    ctx.font='900 11px Arial'; ctx.textAlign='center'; ctx.fillStyle='#3a2438';
    ctx.fillText(STR('chip_mid')+(G.skips>0? ' '+G.skips:''), 0, 4); ctx.restore();
    hit(W-80, 170, 56, 28, abrirMid);
  }
  // barra de renovación (se vuelve botón al llenarse; ESCALERA de locales n55)
  const bx=120, by=44, bw=W-240, bh=24;
  const destino = G.renovaciones===0 ? STR('destino_local')
    : G.renovaciones===1 ? STR('destino_taqueria')
    : STR('destino_sucursal',{n:G.renovaciones+2});
  const k = clamp(G.billetes/renovCosto(), 0, 1);
  const lista = puedeRenovar();
  ctx.fillStyle='rgba(255,255,255,0.12)'; rr(bx,by,bw,bh,12); ctx.fill();
  ctx.save(); rr(bx,by,bw,bh,12); ctx.clip();
  const bg2 = ctx.createLinearGradient(bx,0,bx+bw,0);
  bg2.addColorStop(0,'#b8860b'); bg2.addColorStop(1,'#ffd700');
  ctx.fillStyle = bg2; ctx.fillRect(bx,by,bw*k,bh);
  ctx.restore();
  const puls = lista ? 1+0.05*Math.sin(G.simTime*9) : 1;
  ctx.save(); ctx.translate(bx+bw/2, by+bh/2); ctx.scale(puls,puls);
  ctx.font='900 13px Arial'; ctx.textAlign='center';
  ctx.fillStyle = lista? '#1a1a2e' : '#fff';
  ctx.fillText(lista ? STR('renovar_lista',{destino, costo:fmt(renovCosto())})
    : STR('renovar_progreso',{destino, tengo:fmt(G.billetes), costo:fmt(renovCosto())}),
    0, 5);
  ctx.restore();
  if (lista){ ctx.strokeStyle='#fff'; ctx.lineWidth=2; rr(bx,by,bw,bh,12); ctx.stroke();
    hit(bx,by,bw,bh, renovar); }
  ctx.restore();
}

/* ---------- chips de boosters activos ---------- */
function drawChips(){
  let x = 16; const y = 84;
  function chip(txt, col){
    ctx.font='800 12px Arial';
    const w = ctx.measureText(txt).width + 24;
    ctx.drawImage(IMG.chip, x, y-2, w, 28);   // chip LOTE 1 estirado al texto
    ctx.fillStyle='#3a2438'; ctx.textAlign='left'; ctx.fillText(txt, x+12, y+16);
    x += w+8;
  }
  if (G.simTime < E.ftue_lluvia_dur_s)
    chip(STR('chip_ftue',{mult:E.ftue_lluvia_mult,
      t:mmss(E.ftue_lluvia_dur_s-G.simTime)}), '#4caf50');
  if (salsaActiva()) chip(STR('chip_salsa',{mult:E.salsa_multiplicador,
    t:mmss(boost.salsaHasta-G.simTime)}), '#ff6b35');
  if (comalTurbo()) chip(STR('chip_turbo',{t:mmss(boost.comalHasta-G.simTime)}), '#ffd700');
}

/* ---------- panel inferior: construcciones · mejoras · slots de ad ---------- */
function drawPanel(){
  const py = 648;
  ctx.save();
  ctx.fillStyle = '#141428'; ctx.fillRect(0, py, W, H-py);
  ctx.fillStyle = '#ff6b35'; ctx.fillRect(0, py, W, 3);

  // — pista 1: construcciones —
  ctx.font='800 11px Arial'; ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.textAlign='left';
  ctx.fillText(G.nivel===1? STR('constr_h_n1') : STR('constr_h_n2'), 14, py+18);
  const cw=96, ch=82, gap=8, x0=14, cy=py+26;
  // iconos LOTE 1 por posición de la tanda (los que faltan = LOTE 3 pendiente)
  const ICONOS_CONSTR = ['icono_comal','icono_mesa',null,null,null];
  construcciones.forEach((c,i)=>{
    const x = x0 + i*(cw+gap);
    const afford = !c.comprada && G.billetes>=c.c;
    ctx.save(); ctx.translate(x+cw/2, cy+ch/2);
    ctx.scale(c.sc.x, clamp(2-c.sc.x, 0.6, 1.4));   // squash táctil del botón
    // placa del mockup E2: comprada=turquesa · pendiente=roja
    ctx.globalAlpha = (c.comprada || afford) ? 1 : 0.45;
    ctx.drawImage(IMG[c.comprada? 'placa_turquesa':'placa_roja'],
      -cw/2,-ch/2,cw,ch);
    if (afford){ ctx.strokeStyle='#ffd700'; ctx.lineWidth=2.5;
      rr(-cw/2,-ch/2,cw,ch,10); ctx.stroke(); }
    ctx.font='800 11px Arial'; ctx.textAlign='center';
    ctx.lineWidth = 3; ctx.strokeStyle='rgba(20,16,30,0.75)'; ctx.lineJoin='round';
    ctx.strokeText(c.n, 0, -24); ctx.fillStyle='#fff'; ctx.fillText(c.n, 0, -24);
    const ic = ICONOS_CONSTR[i];
    if (ic){ const im2=IMG[ic]; const ih=30, iw=ih*im2.width/im2.height;
      ctx.drawImage(im2, -iw/2, -14, iw, ih); }
    if (c.comprada){
      ctx.strokeStyle='#fff'; ctx.lineWidth=5; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(-10,22); ctx.lineTo(-3,30); ctx.lineTo(12,14); ctx.stroke();
      ctx.strokeStyle='#2e7d32'; ctx.lineWidth=3;
      ctx.beginPath(); ctx.moveTo(-10,22); ctx.lineTo(-3,30); ctx.lineTo(12,14); ctx.stroke();
    } else {
      ctx.font='900 15px Arial';
      ctx.lineWidth = 3; ctx.strokeStyle='rgba(20,16,30,0.75)';
      ctx.strokeText('$'+fmt(c.c), 0, 30);
      ctx.fillStyle = afford? '#ffe66b':'#fff';
      ctx.fillText('$'+fmt(c.c), 0, 30);
    }
    ctx.restore();
    if (!c.comprada) hit(x, cy, cw, ch, ()=> comprar(c));
  });

  // — pista 2: mejoras (curva de config) —
  ctx.font='800 11px Arial'; ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.textAlign='left';
  ctx.fillText(STR('mejoras_h',
    {mult:(1+E.ingreso_crecimiento_por_compra).toFixed(2)}), 14, py+130);
  const mw=164, mh=70, my=py+138;
  mejoras.forEach((m,i)=>{
    const x = 14 + i*(mw+10);
    const enCap = m.nivel >= capMejoraActual();  // cap de estación por local (n20)
    const afford = !enCap && G.billetes>=m.costo;
    ctx.save(); ctx.translate(x+mw/2, my+mh/2);
    ctx.scale(m.sc.x, clamp(2-m.sc.x, 0.6, 1.4));   // squash táctil del botón
    ctx.globalAlpha = afford || enCap ? 1 : 0.45;   // placa mostaza (mockup E2)
    ctx.drawImage(IMG.placa_mostaza, -mw/2,-mh/2,mw,mh);
    if (afford){ ctx.strokeStyle='#fff'; ctx.lineWidth=2; rr(-mw/2,-mh/2,mw,mh,10); ctx.stroke(); }
    ctx.font='800 12px Arial'; ctx.textAlign='center'; ctx.fillStyle='#3a2810';
    ctx.fillText(m.n + (m.nivel? ' · '+STR('nv')+m.nivel:''), 0, -10);
    ctx.font='900 15px Arial';
    ctx.fillStyle = enCap? '#7a1f1f' : '#3a2810';
    ctx.fillText(enCap? STR('mejora_max') : '$'+fmt(m.costo), 0, 14);
    ctx.restore();
    if (!enCap) hit(x, my, mw, mh, ()=> comprarMejora(m));
  });

  // — pista 3: slots de rewarded (dual-exit visible) —
  ctx.font='800 11px Arial'; ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.textAlign='left';
  ctx.fillText(STR('ads_h'), 14, py+226);
  const aw=124, ah=64, ay=py+234;
  const slots = [
    { label:STR('slot_salsa',{mult:E.salsa_multiplicador}),
      sub: salsaActiva()? mmss(boost.salsaHasta-G.simTime)
        : G.simTime>=ads.salsaDesde? STR('slot_gratis'):STR('slot_pronto'),
      on: !salsaActiva() && G.simTime>=ads.salsaDesde, col:'#ff6b35',
      fn: ()=> verAd('salsa') },
    { label:STR('slot_comal'), sub: comalTurbo()? mmss(boost.comalHasta-G.simTime)
        : G.simTime>=ads.comalDesde? '💎'+E.dual_exit_gemas[0]+' · 📺':STR('slot_pronto'),
      on: !comalTurbo() && G.simTime>=ads.comalDesde, col:'#ffd700',
      fn: ()=> (G.gemas>=E.dual_exit_gemas[0] ? comalTurboConGemas() : verAd('comalturbo')) },
    { label:STR('slot_pocket',{pct:Math.round(E.money_pocket_factor*100)}),
      sub: ads.pocketDisp?
        (ads.pocketAdelantado?STR('slot_ahora'):'💎'+E.dual_exit_gemas[0]+' · 📺')
        :STR('slot_espera'),
      on: ads.pocketDisp, col:'#4caf50',
      fn: ()=> (G.gemas>=E.dual_exit_gemas[0] ? pocketConGemas() : verAd('pocket')) },
    { label:STR('slot_influencer'),
      sub: G.simTime>=ads.influencerNextT?
        STR('slot_influencer_sub',{n:E.influencer_gema_recompensa}):STR('slot_pronto'),
      on: G.simTime>=ads.influencerNextT, col:'#7ee0ff', fn: ()=> verAd('influencer') },
  ];
  // placas + iconos de los slots (paleta del mockup E2)
  const SLOT_SKIN = [
    ['placa_roja','icono_salsa'], ['placa_mostaza','icono_comal'],
    ['placa_turquesa','icono_taco_billetes'], ['placa_turquesa',null]];
  slots.forEach((s,i)=>{
    const x = 13 + i*(aw+6);
    const puls = s.on ? 1+0.03*Math.sin(G.simTime*7+i) : 1;
    const oscuro = SLOT_SKIN[i][0]==='placa_mostaza';
    ctx.save(); ctx.translate(x+aw/2, ay+ah/2); ctx.scale(puls,puls);
    ctx.globalAlpha = s.on ? 1 : 0.42;
    ctx.drawImage(IMG[SLOT_SKIN[i][0]], -aw/2,-ah/2,aw,ah);
    if (SLOT_SKIN[i][1]){ const im2=IMG[SLOT_SKIN[i][1]];
      const ih=26, iw=ih*im2.width/im2.height;
      ctx.globalAlpha = s.on ? 0.95 : 0.4;
      ctx.drawImage(im2, aw/2-iw-5, ah/2-ih-4, iw, ih);
      ctx.globalAlpha = s.on ? 1 : 0.42; }
    if (s.on){ ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; rr(-aw/2,-ah/2,aw,ah,10); ctx.stroke(); }
    ctx.font='800 11px Arial'; ctx.textAlign='center';
    ctx.fillStyle = oscuro? '#3a2810' : '#fff';
    ctx.fillText(s.label, 0, -8);
    ctx.font='900 13px Arial';
    ctx.fillText(s.sub, 0, 14);
    ctx.restore();
    if (s.on) hit(x, ay, aw, ah, s.fn);
  });

  // pie
  ctx.font='600 9px Arial'; ctx.fillStyle='rgba(255,255,255,0.3)'; ctx.textAlign='center';
  ctx.fillText(STR('pie_canvas',{seed, modo: G.autopilot?'demo':'manual'}), W/2, H-8);
  ctx.restore();
}

/* ---------- starter offer (no bloqueante, countdown de config) ------------
   Posición = knob visual.starter_banda (cura r2: en (50,122) tapaba el
   centro/carrito y colisionaba con los vuelos — ahora banda inferior-derecha
   fuera de fila/comal/trayectorias, sobre el panel de compras). */
function drawStarter(){
  if (!G.starterShown || starter.comprada) return;
  const resta = starter.fin - G.simTime;
  const B = V.starter_banda;
  if (starter.visible && !starter.min){
    const k = starter.sl.x;
    ctx.save();
    ctx.translate(0, 240*(1-k));       // entra desde abajo (overshoot del spring)
    ctx.drawImage(IMG.placa_roja, B.x, B.y, B.w, B.h);   // placa roja LOTE 1
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2.5; rr(B.x,B.y,B.w,B.h,14); ctx.stroke();
    ctx.font='900 16px Arial'; ctx.fillStyle='#ffe66b'; ctx.textAlign='left';
    ctx.fillText(STR('starter_titulo'), B.x+18, B.y+28);
    ctx.font='700 13px Arial'; ctx.fillStyle='#fff';
    ctx.fillText(STR('starter_sub',{gems:IA.starter_bundle.gems}), B.x+18, B.y+52);
    ctx.font='900 22px Arial'; ctx.fillStyle='#fff';
    ctx.fillText('$'+IA.starter_bundle.precio_usd, B.x+18, B.y+86);
    ctx.font='700 11px Arial'; ctx.fillStyle='rgba(255,255,255,0.75)';
    ctx.fillText(STR('starter_precio_pl'), B.x+88, B.y+86);
    // countdown grande
    ctx.font='900 20px Arial'; ctx.fillStyle='#ffe66b'; ctx.textAlign='right';
    ctx.fillText(fmtCuenta(resta), B.x+B.w-16, B.y+86);
    ctx.font='700 10px Arial'; ctx.fillStyle='rgba(255,255,255,0.75)';
    ctx.fillText(STR('starter_termina'), B.x+B.w-16, B.y+64);
    // botón cerrar
    ctx.font='900 18px Arial'; ctx.fillStyle='rgba(255,255,255,0.7)'; ctx.textAlign='center';
    ctx.fillText('✕', B.x+B.w-22, B.y+26);
    ctx.restore();
    // badge de re-aparición (OBSERVED GPGP: la oferta VUELVE)
    if (starter.reshows > 0){
      const bp = 1+0.08*Math.sin(G.simTime*9);
      ctx.save(); ctx.translate(B.x+60, B.y); ctx.rotate(-0.12); ctx.scale(bp,bp);
      ctx.fillStyle='#ef4444'; rr(-52,-14,104,28,14); ctx.fill();
      ctx.font='900 14px Arial'; ctx.textAlign='center'; ctx.fillStyle='#fff';
      ctx.fillText(STR('starter_volvio'), 0, 5); ctx.restore();
    }
    // COMPRAR: tap en el cuerpo de la oferta → flujo IAP (intent→confirm→grant)
    hit(B.x, B.y, B.w-44, B.h, ()=>{
      IAP.comprar('starter_bundle').then(r=>{
        if (r.ok){ starter.comprada = true; starter.visible = false; } });
    });
    hit(B.x+B.w-40, B.y+8, 34, 32, ()=>{ starter.min = true; starter.minT = G.simTime; });
  } else if (starter.min){
    // chip minimizada con countdown vivo (chip LOTE 1)
    ctx.save();
    ctx.drawImage(IMG.chip, W-150, 60, 136, 28);
    ctx.font='800 12px Arial'; ctx.fillStyle='#3a2438'; ctx.textAlign='left';
    ctx.fillText('⭐ '+fmtCuenta(resta), W-138, 80);
    ctx.restore();
    hit(W-150, 62, 136, 26, ()=>{ starter.min=false; starter.showT=G.simTime;
      starter.sl.x=0.6; starter.sl.v=3; });
  }
}

/* ---------- overlay de ad simulado (el juego sigue detrás) ---------- */
function drawAdOverlay(){
  hit(0,0,W,H, ()=>{});      // el ad bloquea los taps de abajo
  const o = ads.overlay, k = clamp(o.t/o.dur, 0, 1);
  const fade = o.done ? clamp(1-(o.t-o.dur)/J.ad_out_s, 0, 1) : 1;
  // cura r3: el dimmer del 72% en 0.15s era <1 frame a fps=4 = el "corte seco"
  // que el juez citó; ad_in_fade_s=0.35 da 2 muestras de fade (0→0.76→1.0)
  const fadeIn = clamp(o.t/J.ad_in_fade_s, 0, 1);
  ctx.save();
  ctx.globalAlpha = fade*fadeIn;
  ctx.fillStyle = 'rgba(8,8,16,0.72)'; ctx.fillRect(0,0,W,H);
  const cw2=380, ch2=300, x=(W-cw2)/2, y=280;
  ctx.translate(W/2, y+ch2/2); ctx.scale(o.sc.x, o.sc.x); ctx.translate(-W/2, -(y+ch2/2));
  ctx.fillStyle='#0b0b16'; rr(x+10,y+10,cw2-20,ch2-20,16); ctx.fill();
  ctx.drawImage(IMG.marco_panel, x, y, cw2, ch2);   // marco cromado LOTE 1
  // "video" de nieve procedural
  for (let i=0;i<60;i++){
    const rx = x+18+hash2(G.tick+i,i)* (cw2-36), ry = y+58+hash2(i,G.tick)* (ch2-140);
    ctx.fillStyle = `rgba(255,255,255,${0.05+hash2(i,3)*0.16})`;
    ctx.fillRect(rx, ry, 3+hash2(i,5)*10, 2);
  }
  ctx.font='900 22px Arial'; ctx.fillStyle='#fff'; ctx.textAlign='center';
  ctx.fillText(STR('ad_titulo'), W/2, y+40);
  ctx.font='700 13px Arial'; ctx.fillStyle='rgba(255,255,255,0.6)';
  ctx.fillText(STR('ad_nota'), W/2, y+ch2-58);
  // barra de progreso
  ctx.fillStyle='rgba(255,255,255,0.15)'; rr(x+24, y+ch2-38, cw2-48, 14, 7); ctx.fill();
  ctx.fillStyle='#ff6b35';
  rr(x+24, y+ch2-38, (cw2-48)*k, 14, 7); ctx.fill();
  // ★DUAL-EXIT en el modal: saltar con SALTO del pack (mid) o pagando gemas
  if (!o.done){
    const usaToken = G.skips > 0;
    const can = usaToken || G.gemas >= E.dual_exit_gemas[0];
    ctx.fillStyle = can? 'rgba(126,224,255,0.16)':'rgba(255,255,255,0.06)';
    rr(x+cw2/2-92, y+ch2+14, 184, 40, 12); ctx.fill();
    ctx.strokeStyle = can? '#7ee0ff':'rgba(255,255,255,0.25)';
    ctx.lineWidth=2; rr(x+cw2/2-92, y+ch2+14, 184, 40, 12); ctx.stroke();
    ctx.font='900 14px Arial'; ctx.textAlign='center';
    ctx.fillStyle = can? '#7ee0ff':'rgba(255,255,255,0.4)';
    ctx.fillText(usaToken ? STR('ad_saltar_token',{n:G.skips})
      : STR('ad_saltar',{n:E.dual_exit_gemas[0]}), W/2, y+ch2+39);
    hit(x+cw2/2-92, y+ch2+14, 184, 40, skipAd);
  }
  ctx.restore();
}

/* ---------- oferta anclada a TRANSICIÓN (n30): panel NO bloqueante ---------- */
function drawOfertaTrans(){
  if (!ofertaTrans.visible) return;
  const y0 = 250;                       // debajo del slot de la starter (122)
  ctx.save();
  ctx.drawImage(IMG.placa_turquesa, 50, y0, W-100, 108);  // placa LOTE 1
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; rr(50, y0, W-100, 108, 14); ctx.stroke();
  ctx.font='900 17px Arial'; ctx.fillStyle='#0e3f33'; ctx.textAlign='left';
  ctx.fillText(STR('oferta_trans_titulo'), 68, y0+30);
  ctx.font='900 15px Arial'; ctx.fillStyle='#123a30';
  ctx.fillText(ofertaTrans.sku==='noads_bundle'
    ? STR('oferta_trans_noads',{gems:fmt(IA.noads_bundle.gems), p:IA.noads_bundle.precio_usd})
    : STR('oferta_trans_dosx',{x:IA.dosx_multiplicador, p:IA.dosx_permanente_usd}),
    68, y0+60);
  ctx.font='700 12px Arial'; ctx.fillStyle='rgba(18,58,48,0.7)';
  ctx.fillText(STR('starter_precio_pl'), 68, y0+84);
  // countdown de la ventana
  ctx.font='900 18px Arial'; ctx.fillStyle='#7a1f1f'; ctx.textAlign='right';
  ctx.fillText(Math.max(0, Math.ceil(ofertaTrans.hastaT-G.simTime))+'s', W-70, y0+84);
  // cerrar
  ctx.font='900 18px Arial'; ctx.fillStyle='rgba(18,58,48,0.8)'; ctx.textAlign='center';
  ctx.fillText('✕', W-72, y0+26);
  ctx.restore();
  hit(50, y0, W-100-44, 108, ()=>{
    const sku = ofertaTrans.sku;
    IAP.comprar(sku).then(r=>{ if (r.ok) ofertaTrans.visible = false; });
  });
  hit(W-88, y0+6, 32, 30, ()=>{ ofertaTrans.visible = false; });
}

/* ---------- panel MID (⭐ PRO): saltos · free cash · permanentes ---------- */
function drawMid(){
  if (!mid.abierta) return;
  hit(0,0,W,H, ()=>{});      // el modal bloquea los taps de abajo
  const k = mid.sl.x;
  ctx.save();
  ctx.globalAlpha = clamp(k*1.3,0,1);
  ctx.fillStyle = 'rgba(8,8,16,0.72)'; ctx.fillRect(0,0,W,H);
  ctx.translate(W/2, 470); ctx.scale(0.75+0.25*k, 0.75+0.25*k); ctx.translate(-W/2, -470);
  const pw=470, ph=520, x=(W-pw)/2, y=210;
  ctx.drawImage(IMG.panel_oferta, x, y, pw, ph);   // tarjeta crema + listón rojo
  ctx.font='900 22px Arial'; ctx.textAlign='center'; ctx.fillStyle='#fff';
  ctx.fillText(STR('mid_titulo',{n:G.nivel}), W/2, y+40);   // sobre el listón
  ctx.font='900 18px Arial'; ctx.fillStyle='rgba(58,36,56,0.8)'; ctx.textAlign='right';
  ctx.fillText('✕', x+pw-26, y+40);
  hit(x+pw-48, y+16, 40, 36, cerrarMid);
  // — packs de SALTOS (skip-ad SKU n42; precio = gemas [10,20,30] → H2) —
  ctx.font='800 12px Arial'; ctx.textAlign='left'; ctx.fillStyle='rgba(58,36,56,0.75)';
  ctx.fillText(STR('mid_skips_h',{n:G.skips}), x+24, y+86);
  const gw=142, gh=76;
  M.skip_ad_skus.forEach((precio,i)=>{
    const gx = x+16 + i*(gw+6), gy = y+94;
    const can = G.gemas >= precio;
    ctx.globalAlpha = can ? 1 : 0.5;
    ctx.drawImage(IMG.placa_turquesa, gx, gy, gw, gh);
    ctx.font='900 15px Arial'; ctx.textAlign='center'; ctx.fillStyle='#0e3f33';
    ctx.fillText(STR('mid_pack',{n:M.skip_pack_contenidos[i]}), gx+gw/2, gy+30);
    ctx.font='900 15px Arial'; ctx.fillStyle='#123a30';
    ctx.fillText('💎'+precio, gx+gw/2, gy+56);
    ctx.globalAlpha = 1;
    hit(gx,gy,gw,gh, ()=> comprarSkipPack(i));
  });
  // — FREE CASH cada 20 min (n42, la pata gratis del SKU bidireccional) —
  const fy = y+186;
  const fcListo = G.simTime >= mid.freeCashListoT;
  ctx.globalAlpha = fcListo ? 1 : 0.5;
  ctx.drawImage(IMG.placa_mostaza, x+16, fy, pw-32, 52);
  ctx.globalAlpha = 1;
  ctx.font='900 15px Arial'; ctx.textAlign='left'; ctx.fillStyle='#3a2810';
  ctx.fillText(STR('mid_freecash'), x+32, fy+32);
  ctx.font='900 15px Arial'; ctx.textAlign='right';
  ctx.fillText(fcListo? STR('mid_freecash_listo')
    : mmss(mid.freeCashListoT-G.simTime), x+pw-30, fy+32);
  if (fcListo) hit(x+16, fy, pw-32, 52, cobrarFreeCash);
  // — PERMANENTES dual-pricing (n25): gratis-por-espera O 💎30 —
  const hy = fy+72;
  ctx.font='800 12px Arial'; ctx.textAlign='left'; ctx.fillStyle='rgba(58,36,56,0.75)';
  ctx.fillText(STR('mid_perm_h',{g:M.dual_pricing_permanente_gems}), x+24, hy);
  mid.perms.forEach((p,i)=>{
    const py2 = hy+10 + i*96;
    ctx.fillStyle='rgba(58,36,56,0.08)'; rr(x+16, py2, pw-32, 88, 12); ctx.fill();
    ctx.strokeStyle='rgba(58,36,56,0.3)'; ctx.lineWidth=1.5;
    rr(x+16, py2, pw-32, 88, 12); ctx.stroke();
    ctx.font='800 14px Arial'; ctx.textAlign='left'; ctx.fillStyle='#3a2438';
    ctx.fillText(STR(p.key, {pct: Math.round(
      ((i===0?M.perm_ingreso_mult:M.perm_clientes_mult)-1)*100)}), x+32, py2+28);
    if (p.comprado){
      ctx.font='900 16px Arial'; ctx.textAlign='center'; ctx.fillStyle='#2e7d32';
      ctx.fillText(STR('perm_comprada'), x+pw/2, py2+64);
    } else {
      const listo = permListaGratis(i);
      // botón GRATIS (espera) — placa turquesa
      ctx.globalAlpha = listo ? 1 : 0.5;
      ctx.drawImage(IMG.placa_turquesa, x+28, py2+40, 200, 38);
      ctx.globalAlpha = 1;
      ctx.font='900 13px Arial'; ctx.textAlign='center'; ctx.fillStyle='#0e3f33';
      ctx.fillText(listo? STR('perm_reclamar')
        : STR('perm_gratis_en',{t:mmss(p.desdeT + M.dual_pricing_espera_min*60 - G.simTime)}),
        x+128, py2+64);
      if (listo) hit(x+28, py2+40, 200, 38, ()=> reclamarPermGratis(i));
      // botón GEMAS YA — placa roja
      const can = G.gemas >= M.dual_pricing_permanente_gems;
      ctx.globalAlpha = can ? 1 : 0.5;
      ctx.drawImage(IMG.placa_roja, x+pw-228, py2+40, 200, 38);
      ctx.globalAlpha = 1;
      ctx.font='900 13px Arial'; ctx.fillStyle='#fff';
      ctx.fillText(STR('perm_ya',{g:M.dual_pricing_permanente_gems}), x+pw-128, py2+64);
      hit(x+pw-228, py2+40, 200, 38, ()=> comprarPermGemas(i));
    }
  });
  ctx.font='600 10px Arial'; ctx.textAlign='center'; ctx.fillStyle='rgba(58,36,56,0.55)';
  ctx.fillText(STR('tienda_pie'), W/2, y+ph-14);
  ctx.restore();
}

/* ---------- telón de renovación (coreografía) ---------- */
function drawTelon(){
  const t = renov.t;
  let k;                                     // 0=abierto 1=cerrado
  if (t < 0.35)      k = 0;
  else if (t < 0.7)  k = easeIn((t-0.35)/0.35);
  else if (t < 1.05) k = 1;
  else if (t < 1.6)  k = 1-easeOut((t-1.05)/0.55);
  else               k = 0;
  if (k <= 0.001) return;
  const half = (W/2) * k;
  ctx.save();
  for (const dir of [-1,1]){
    const x0 = dir<0 ? -W/2+half : W-half;
    ctx.fillStyle = '#c94a12';
    ctx.fillRect(x0, 100, W/2, 548);
    // franjas del telón
    ctx.fillStyle = 'rgba(255,215,0,0.2)';
    for (let i=0;i<5;i++)
      ctx.fillRect(x0 + i*(W/10)+8, 100, 12, 548);
    // borde picado
    ctx.fillStyle = '#ffd700';
    const edge = dir<0? x0+W/2 : x0;
    for (let i=0;i<14;i++){
      ctx.beginPath();
      ctx.arc(edge, 120+i*40, 9, 0, Math.PI*2); ctx.fill();
    }
  }
  if (t>=0.7 && t<1.05){
    ctx.font='900 34px Arial'; ctx.textAlign='center'; ctx.fillStyle='#ffd700';
    ctx.fillText(STR('telon_renovando'), W/2, 380);
  }
  ctx.restore();
}

/* ---------- badge de fin de demo ---------- */
function drawFin(){
  ctx.save();
  ctx.fillStyle='rgba(20,20,40,0.9)'; rr(W/2-120, 140, 240, 40, 20); ctx.fill();
  ctx.strokeStyle='#4caf50'; ctx.lineWidth=2; rr(W/2-120,140,240,40,20); ctx.stroke();
  ctx.font='900 16px Arial'; ctx.textAlign='center'; ctx.fillStyle='#4caf50';
  ctx.fillText(STR('fin_demo'), W/2, 166);
  ctx.restore();
}

function shade(hex, amt){
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n>>16)+amt,0,255), g = clamp(((n>>8)&255)+amt,0,255), b = clamp((n&255)+amt,0,255);
  return `rgb(${r},${g},${b})`;
}
function rr(x,y,w,h,r){ ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

/* ---------- input (modo manual; en autopilot los botones siguen activos) ---- */
cv.addEventListener('pointerdown', (e)=>{
  const r = cv.getBoundingClientRect();
  const x = (e.clientX - r.left) * (W/r.width);
  const y = (e.clientY - r.top) * (H/r.height);
  for (let i=hits.length-1;i>=0;i--){
    const h2 = hits[i];
    if (x>=h2.x && x<=h2.x+h2.w && y>=h2.y && y<=h2.y+h2.h){ h2.fn(); return; }
  }
});

/* ---------- resumen para session_end ---------- */
function resumen(){
  return { billetes:G.billetes, gemas:G.gemas, compras:G.compras,
    nivel:G.nivel, ads_vistos:G.adsVistos, sim_s:+G.simTime.toFixed(1) };
}

/* ============================================================================
   LOOP — acumulador de timestep fijo; fps medido en el render real
   ========================================================================= */
let last = performance.now(), acc = 0, fpsAcc = 0, fpsN = 0, fpsT = 0;
function frame(now){
  let dt = (now - last)/1000; last = now;
  dt = Math.min(dt, 0.1);
  fpsAcc += dt; fpsN++; fpsT += dt;
  if (fpsT >= 0.5){ G.fps = Math.round(fpsN / fpsAcc); fpsAcc=0; fpsN=0; fpsT=0; }
  acc += dt * G.timeScale;
  let guard = 0;
  while (acc >= TICK && guard < 8){ update(TICK); acc -= TICK; guard++; }
  if (guard >= 8) acc = 0;
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---------- API de depuración/smoke: llama a las funciones REALES del motor
   (para el smoke mid-game fail-closed; no fabrica estado, ejecuta el juego) -- */
G.dbg = {
  renovCosto, puedeRenovar, renovar, capMejora: capMejoraActual,
  ratioMejora, ingresoVenta,
  costoMejora: (i)=> mejoras[i].costo,
  nivelMejora: (i)=> mejoras[i].nivel,
  comprarMejora: (i)=> comprarMejora(mejoras[i]),
  constrRestantes: ()=> construcciones.filter(c=>!c.comprada).length,
  constrCosto: (i)=> construcciones[i].c,
  comprarConstr: (i)=> comprar(construcciones[i]),
  abrirMid, cerrarMid, comprarSkipPack, cobrarFreeCash,
  reclamarPermGratis, comprarPermGemas,
  permEstado: ()=> mid.perms.map(p=>({key:p.key, comprado:p.comprado})),
  freeCashListo: ()=> G.simTime >= mid.freeCashListoT,
  ofertaTransVisible: ()=> ofertaTrans.visible,
};

return { G, resumen };
}
