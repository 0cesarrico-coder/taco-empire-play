/* ============================================================================
   TACO EMPIRE — PLAYABLE AD (single-file MRAID, ≤2MB, cero red)
   Pieza DESTILADA del motor (src/juego.js): mismo juice (springs, hit-stop,
   flash, radiales, pops parabólicos), mismos NÚMEROS de config/game.json
   (inyectados por build.py — jamás copiados a mano), assets E2 en data-URIs.
   Hook: ABUNDANCIA-MONTAÑA (l6 §2 Pizza Ready: "I'll stack them like a
   mountain" — la montaña de billetes crece en escena con cada venta).
   Guión ~6-15s: escena viva → taps que pagan → mejora SALSA → rush →
   RENOVACIÓN (telón → local 2) → CTA.
   Compresiones de TIEMPO (permitidas, la economía NO se toca): cadencia de
   clientes, cadencia del ghost-autoplay, top-up estilo demo del motor
   (D.renov_regalo: billetes = max(billetes, renovacion_costo)).
   ========================================================================= */
'use strict';
(function () {

const CFG = __CFG__;                    // economia+juice+ritmo+visual (build.py)
const STRS = __STR__;                   // strings EN/ES del playable
const ASSETS = __ASSETS__;              // nombre → data-URI webp
const DEFAULT_LANG = '__LANG__';
const CLICK_URL = '__CLICK_URL__';      // placeholder: la red/tienda lo define

const E = CFG.economia, J = CFG.juice, R = CFG.ritmo, V = CFG.visual;

/* ---------- idioma (?lang= > default del build) ---------- */
const langM = location.search.match(/[?&]lang=(\w+)/);
const LANG = (langM && STRS[langM[1]]) ? langM[1] : DEFAULT_LANG;
const T = STRS[LANG];

/* ---------- canvas ---------- */
const W = 540, H = 960, TICK = 1 / 60;
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');

/* ---------- RNG determinista (mismo mulberry32 del motor) ---------- */
const seedM = location.search.match(/[?&]seed=(\d+)/);
const seed = seedM ? parseInt(seedM[1], 10) : 7;
function mulberry32(a){ return function(){
  a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rng  = mulberry32(seed);
const vrng = mulberry32(seed ^ 0x9e37);

const clamp = (v,a,b)=> v<a?a : v>b?b : v;
const lerp  = (a,b,t)=> a+(b-a)*t;
const easeOut = t => 1-Math.pow(1-t,3);
const easeIn  = t => t*t*t;
function hash2(i,j){ let h=(i*374761393 + j*668265263)|0; h=(h^(h>>>13))|0;
  return ((h*1274126177)>>>8)/16777216; }
function fmt(n){ n = Math.round(n);
  return n>=1e6 ? (n/1e6).toFixed(1)+'M' : n>=1e4 ? (n/1e3).toFixed(1)+'K'
    : String(n); }
function mkSpring(v){ return {x:v, v:0, t:v}; }
function stepSpring(s, k, d, dt){
  const a = -k*(s.x-s.t) - d*s.v; s.v += a*dt; s.x += s.v*dt; }
function rr(x,y,w,h,r){ ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

/* ---------- geometría (idéntica al motor) ---------- */
const COMAL = { x:272, y:460, rx:52, ry:20 };
const SIDEWALK_Y = 592;
function slotX(i){ return 150 - i*54; }

/* ---------- estado ---------- */
const G = {
  tick:0, simTime:0, hitStop:0, timeScale:1,
  // pre-warm FTUE (sesión en curso — escena YA VIVA a t=0):
  // dinero_inicial OBSERVED + 5 compras hechas (banda FTUE "PR 5 compras/30s")
  billetes: E.dinero_inicial, compras: 5,
  nivel: 1, renovaciones: 0, renovT: -99,
  taps: 0, ventas: 0, state: 'juego',
  salsaOn: false, ctaShown: false, ctaT: 0, firstFrameMs: -1,
};
const cam = { shake:0, zoom:mkSpring(1) };

/* ---------- fase del guión ---------- */
// live → tap (taps del usuario/ghost) → upgrade → rush → renovlista →
// renovando → post → cta
let fase = 'live';
let lastUserT = -99;          // último toque REAL del usuario
let userTocado = false;
const GHOST_IDLE_S = 2.5;     // autoplay de rescate (guión: 2.5s sin tocar)
const CTA_HARD_T = 14;        // corte duro del guión
const CTA_IDLE_S = 3;         // inactividad post-guión

/* ---------- assets (data-URIs → Image; decode local, cero red) ---------- */
const IMG = {};
let assetsListos = false;
{
  const nombres = Object.keys(ASSETS);
  let n = 0;
  for (const k of nombres){
    const im = new Image();
    im.onload = ()=>{ if (++n === nombres.length) assetsListos = true; };
    im.onerror = ()=>{ console.error('asset data-URI no decodificó: '+k); };
    im.src = ASSETS[k];
    IMG[k] = im;
  }
}

/* ---------- pops (números flotantes, parabólicos — knobs del motor) ------ */
const pops = [];
function pop(txt,x,y,size,color){
  const s = mkSpring(0.2); s.t = 1; s.v = 8;
  while (pops.length >= R.max_pops) pops.shift();
  pops.push({txt,x,y,t:0,size,color:color||'#fff',s,
    vx:(vrng()-0.5)*J.pop_arco_vx, vy:-J.pop_impulso-vrng()*J.pop_rise,
    g:J.pop_gravedad});
}

/* ---------- partículas / confeti / vuelos (del motor) ---------- */
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
const vuelos = [];
function vuelo(tipo, x0,y0, x1,y1, dur, cb){
  vuelos.push({tipo, x0,y0,x1,y1, cx:(x0+x1)/2, cy:Math.min(y0,y1)-138,
    t:0, dur, cb}); }

/* ---------- LA MONTAÑA DE BILLETES (hook abundancia, l6 §2 PR) ----------
   Cada venta apila billetes junto al puesto: la abundancia se VE crecer. */
const pila = [];
function apilar(nBills){
  for (let i=0;i<nBills;i++){
    if (pila.length >= 46) break;
    const k = pila.length;
    pila.push({ x: 402 + (vrng()-0.5)*128, y: 596 - (k/6|0)*7 + (vrng()-0.5)*4,
      rot: (vrng()-0.5)*0.8, t: 0 });
  }
}

/* ---------- economía: MISMA fórmula del motor (números de config) -------- */
function ingresoVenta(){
  let v = E.ingreso_base_por_venta *
          Math.pow(1+E.ingreso_crecimiento_por_compra, G.compras);
  if (G.simTime < E.ftue_lluvia_dur_s) v *= E.ftue_lluvia_mult;   // pre-warm sigue en FTUE
  if (G.salsaOn) v *= E.salsa_multiplicador;
  return Math.round(v);
}

const hudMoney = mkSpring(1);
let lastMoney = null;
function ganar(monto, x, y, color){
  G.billetes += monto;
  hudMoney.v += 4;
  if (lastMoney && (G.simTime - lastMoney.t0) < R.pop_batch_s &&
      pops.includes(lastMoney.p)){
    lastMoney.monto += monto;
    lastMoney.p.txt = '+$'+fmt(lastMoney.monto);
    lastMoney.p.s.v += 4;
    lastMoney.p.t = Math.min(lastMoney.p.t, 0.35);
    lastMoney.p.vx = (vrng()-0.5)*J.pop_arco_vx;
    lastMoney.p.vy = -(J.pop_impulso*J.pop_rekick_mult + vrng()*J.pop_rise);
  } else {
    pop('+$'+fmt(monto), x, y, 26, color||'#ffd700');
    lastMoney = { p: pops[pops.length-1], monto, t0: G.simTime };
  }
  vuelo('billete', x, y-30, 64, 42, 0.55);
}

/* ---------- clientes (walk-cycle E-anim del motor; pool base+celebra) ----- */
const PAL_CLI = ['#7b8fa6','#a67b8f','#8fa67b','#a6947b','#7ba0a6','#9b7ba6'];
const clientes = [];
const fila = [];
let spawnT = 0.9;
let spawnAccel = 1.0;         // compresión de TIEMPO del playable (no economía)

function mkCliente(){
  return { estado:'asoma', t:0, x:-26, y:SIDEWALK_Y,
    dist:0, pasoN:0, moviendo:false, dir:1,
    ln:mkSpring(0), frenoT:0, frenoDir:1, prevMov:false,
    col: PAL_CLI[(rng()*PAL_CLI.length)|0],
    spr: (rng()*4)|0,
    alto: 0.92+rng()*0.16,
    pedidos: 1, servidos:0, sq:mkSpring(1), hop:0 };
}
function spawnCliente(){
  const c = mkCliente();
  clientes.push(c); fila.push(c);
  return c;
}
/* pre-seed de la escena VIVA (0-1s: fila formada, no pantalla vacía) */
function preSeed(){
  for (let i=0;i<3;i++){
    const c = spawnCliente();
    c.estado = i===0 ? 'espera' : 'cola';
    c.x = slotX(i); c.t = 1;
  }
  const c4 = spawnCliente();   // uno entrando (movimiento inmediato)
  c4.estado = 'asoma'; c4.t = 0.2;
}

function zancada(c, dx){
  c.dist += Math.abs(dx);
  const n = (c.dist / J.walk_paso_px) | 0;
  if (n !== c.pasoN){
    c.pasoN = n;
    c.sq.x = Math.min(c.sq.x, 1 - J.walk_squash_contacto);
  }
  c.moviendo = true;
}
function updCliente(c, dt){
  stepSpring(c.sq, J.spring_k, J.spring_amort, dt);
  const idx = fila.indexOf(c);
  c.moviendo = false;
  switch (c.estado){
    case 'asoma':
      c.t += dt;
      c.x = -30 + Math.sin(clamp(c.t/0.85,0,1)*Math.PI)*56;
      if (c.t > 0.85){ c.estado='entra'; c.x = -14; }
      break;
    case 'entra': case 'cola': {
      if (idx < 0){ c.estado='sale'; break; }
      const tx = slotX(idx);
      if (Math.abs(c.x - tx) > 2){
        const dir = c.x < tx ? 1 : -1;
        const dx = dir * 120*dt;
        c.x += dx;
        if ((dir>0 && c.x>tx) || (dir<0 && c.x<tx)) c.x = tx;
        zancada(c, dx); c.dir = dir;
      } else if (idx === 0){
        c.estado = 'pide'; c.t = 0; c.sq.v += 3;
      } else c.estado = 'cola';
      break; }
    case 'pide':
      c.t += dt;
      if (c.t > 0.35) c.estado = 'espera';    // compresión de tiempo (motor: 0.5)
      break;
    case 'espera': break;
    case 'feliz':
      c.t += dt; c.hop = Math.abs(Math.sin(c.t*9))*14*(1-c.t);
      if (c.t > 0.55){ c.estado='sale'; c.hop=0; }   // compresión (motor: 0.7)
      break;
    case 'sale':
      c.x += 175*dt; zancada(c, 175*dt); c.dir = 1;
      if (c.x > W+40) c.estado = 'fuera';
      break;
  }
  if (c.frenoT > 0){
    c.frenoT -= dt;
    c.ln.x = -c.frenoDir * J.walk_freno_lean; c.ln.v = 0;
  } else stepSpring(c.ln, J.spring_k, J.spring_amort, dt);
  if (c.prevMov && !c.moviendo){
    c.frenoDir = c.dir;
    c.frenoT = J.walk_freno_ticks * TICK;
    c.sq.x = Math.min(c.sq.x, 1 - J.walk_freno_squash);
  } else if (!c.prevMov && c.moviendo){
    c.frenoT = 0;
    c.ln.x = c.dir * J.walk_freno_lean; c.ln.v = c.dir * 1.5;
  }
  c.prevMov = c.moviendo;
}

/* ---------- comal: MISMO juice del motor (tap paga, 3 taps = taco) -------- */
const comal = { taps:0, humoT:0, flashT:0, tapFlashT:0, sx:mkSpring(1), sy:mkSpring(1),
  pop:mkSpring(1), radialT:0, radialA:0 };
function tapComal(){
  if (G.ctaShown || G.state!=='juego') return;
  const front = fila[0];
  if (!front || front.estado!=='espera' || comal.humoT>0) return;
  comal.taps += 1;
  G.taps++;
  comal.sy.x = J.squash_tap; comal.sx.x = 1/J.squash_tap;
  comal.sy.v = 5; comal.sx.v = -5;
  G.hitStop = J.hitstop_ticks_tap;
  comal.tapFlashT = J.flash_tap_s;
  comal.pop.x = J.comal_pop_escala; comal.pop.v = 1.2;
  comal.radialT = J.impacto_radial_dur_s;
  comal.radialA = vrng()*Math.PI*2;
  cam.shake = Math.max(cam.shake, J.shake_tap);
  burst(COMAL.x+(vrng()-0.5)*56, COMAL.y-8, 6, '#ff6b35', 160, 340);
  burst(COMAL.x+(vrng()-0.5)*40, COMAL.y-6, 3, '#ffd700', 120, 300);
  vapor(COMAL.x, COMAL.y-10, 3);
  // ★ cada tap PAGA (v/taps; la venta liquida el residuo — motor)
  ganar(Math.round(ingresoVenta()/E.taps_por_taco), COMAL.x, COMAL.y-34);
  if (comal.taps >= E.taps_por_taco){
    comal.taps = 0;
    comal.humoT = 0.28;               // anticipación (comprimida: motor 0.35)
    comal.flashT = J.flash_comal_s;
    burst(COMAL.x, COMAL.y-10, 12, '#fff', 240, 300);
    cam.zoom.v += 0.5;
  }
}
function tacoListo(){
  const front = fila[0];
  vapor(COMAL.x, COMAL.y-14, 6);
  if (!front) return;
  vuelo('taco', COMAL.x, COMAL.y-16, front.x+6, front.y-58, 0.4, ()=>{
    entregarTaco(front);
  });
}
function entregarTaco(c){
  if (!clientes.includes(c)) return;
  c.servidos++;
  c.sq.x = 1.25; c.sq.v = -4;
  vapor(c.x, c.y-60, 2);
  if (c.servidos >= c.pedidos) venta(c);
}
function venta(c){
  const v = ingresoVenta();
  const porTaps = Math.round(v/E.taps_por_taco) * E.taps_por_taco;
  const total = Math.max(0, (v - porTaps)) * c.pedidos;
  if (total > 0) ganar(total, c.x, c.y-70, '#ffd700');
  cam.shake = Math.max(cam.shake, J.shake_venta);
  G.ventas++;
  apilar(3);                          // ★ la montaña crece (hook abundancia)
  const i = fila.indexOf(c); if (i>=0) fila.splice(i,1);
  c.estado = 'feliz'; c.t = 0;
}

/* ---------- mejora SALSA (mejoras_costos_base[0]; efecto = salsa ×2) ------ */
const mejora = { costo: E.mejoras_costos_base[0], nivel: 0, sc: mkSpring(1),
  pulsoT: 0 };
function comprarMejora(){
  if (mejora.nivel > 0 || G.billetes < mejora.costo || G.ctaShown) return;
  G.billetes -= mejora.costo;
  mejora.nivel = 1; G.compras++;
  G.salsaOn = true;                   // salsa_multiplicador (config) al ingreso
  spawnAccel = 2.2;                   // compresión de TIEMPO del rush
  mejora.sc.x = 1.3; mejora.sc.v = -4;
  burst(COMAL.x, COMAL.y-10, 14, '#4caf50', 170);
  burst(184, 786, 16, '#ff6b35', 190);
  pop(T.salsa_pop, W/2, 700, 26, '#4caf50');
  pop(T.rush_pop, W/2, 380, 34, '#ffd700');
  cam.shake = Math.max(cam.shake, 5);
  if (fase==='upgrade') fase = 'rush';
}

/* ---------- renovación (coreografía del motor, costo de config) ----------- */
const renov = { activa:false, t:0, swapped:false };
function renovLista(){ return G.billetes >= E.renovacion_costo && G.renovaciones===0; }
function renovar(){
  if (!renovLista() || G.state!=='juego' || G.ctaShown) return;
  G.billetes -= E.renovacion_costo;
  renov.activa = true; renov.t = 0; renov.swapped = false;
  G.state = 'renovando';
  pop(T.renov_pop, W/2, 330, 50, '#ffd700');
  cam.shake = J.shake_intensidad + 4; cam.zoom.t = 1.12;
  G.hitStop = J.hitstop_ticks_grande;
  dropConfetti();
  fila.length = 0;
  for (const c of clientes){ if (c.estado!=='sale') c.estado='sale'; }
  comal.taps = 0; comal.humoT = 0;
  fase = 'renovando';
}
function updateRenov(dt){
  renov.t += dt;
  const t = renov.t;
  if (t > 0.7 && !renov.swapped){
    renov.swapped = true;
    G.renovaciones = 1; G.nivel = 2; G.renovT = G.simTime;
  }
  if (t > 1.05 && t-dt <= 1.05){ dropConfetti(); cam.shake = 8;
    pop(T.nivel2_pop, W/2, 350, 44, '#ffd700');
    pop(T.nivel2_sub, W/2, 398, 20, '#4caf50'); }
  if (t > R.renov_dur_s){ renov.activa = false; G.state = 'juego';
    cam.zoom.t = 1; fase = 'post'; }
}

/* ---------- CTA + clickthrough (MRAID estándar, fallback window.open) ----- */
const cta = { sl: mkSpring(0) };
function mostrarCTA(){
  if (G.ctaShown) return;
  G.ctaShown = true; G.ctaT = G.simTime;
  cta.sl.x = 0; cta.sl.t = 1; cta.sl.v = J.ad_pop_v;
  dropConfetti(40);
}
function clickthrough(){
  try {
    if (typeof mraid !== 'undefined' && mraid.open){ mraid.open(CLICK_URL); return; }
  } catch (e) { /* cae al fallback */ }
  try { window.open(CLICK_URL, '_blank'); } catch (e) { /* preview sin popup */ }
}

/* ---------- ghost hand (autoplay de rescate + tutor del verbo) ----------- */
const hand = { x: COMAL.x+46, y: COMAL.y+58, tx: COMAL.x+46, ty: COMAL.y+58,
  tapT: 0, visible: true };
let ghostTapT = 0.45;   // primer pago ambiental antes de t=1 (escena VIVA)
function ghostObjetivo(){
  if (fase==='live' || fase==='tap' || fase==='rush')
    return [COMAL.x+46, COMAL.y+58];
  if (fase==='upgrade') return [184+52, 786+40];       // placa SALSA del panel
  if (fase==='renovlista') return [W/2+40, 56+42];     // barra RENOVATE del HUD
  return [COMAL.x+46, COMAL.y+58];
}
function ghostActua(){
  if (fase==='upgrade') comprarMejora();
  else if (fase==='renovlista') renovar();
  else tapComal();
}
function updGhost(dt){
  const idle = G.simTime - lastUserT;
  const activo = !userTocado || idle >= GHOST_IDLE_S;
  hand.visible = !G.ctaShown && (activo || fase==='upgrade' || fase==='renovlista');
  const [tx,ty] = ghostObjetivo();
  hand.tx = tx; hand.ty = ty;
  hand.x = lerp(hand.x, hand.tx, clamp(dt*7,0,1));
  hand.y = lerp(hand.y, hand.ty, clamp(dt*7,0,1));
  hand.tapT = Math.max(0, hand.tapT - dt);
  if (!activo || G.ctaShown) return;
  ghostTapT -= dt;
  if (ghostTapT <= 0 && Math.abs(hand.x-hand.tx)<12){
    ghostTapT = fase==='rush' ? 0.20 : 0.30;
    hand.tapT = 0.14;
    ghostActua();
  }
}

/* ---------- guión (fases + compresiones de tiempo) ---------- */
function updGuion(){
  const t = G.simTime;
  if (fase==='live' && t > 0.9) fase = 'tap';
  if (fase==='tap' && G.ventas >= 1 && G.billetes >= mejora.costo)
    fase = 'upgrade';
  if (fase==='rush'){
    // top-up estilo demo del motor (D.renov_regalo): garantiza la renovación
    // dentro del guión sin tocar la fórmula de ingreso
    if (t >= 9.5 && G.billetes < E.renovacion_costo){
      const falta = E.renovacion_costo - G.billetes;
      ganar(falta, W/2, 430, '#ffd700');
      apilar(6);
    }
    if (renovLista()) fase = 'renovlista';
  }
  if (fase==='post' && t - G.renovT > 1.4) mostrarCTA();
  if (!G.ctaShown && t >= CTA_HARD_T) mostrarCTA();
  if (!G.ctaShown && userTocado && fase!=='renovando' &&
      t > 12 && t - lastUserT > CTA_IDLE_S) mostrarCTA();
}

/* ---------- update (timestep fijo del motor) ---------- */
function update(dt){
  G.tick++; G.simTime = G.tick*TICK;
  if (G.hitStop > 0){ G.hitStop--; return; }

  stepSpring(cam.zoom, 26, 7, dt);
  cam.shake = Math.max(0, cam.shake - dt*30);
  stepSpring(hudMoney, J.spring_k, J.spring_amort, dt);
  stepSpring(comal.sx, J.spring_k, J.spring_amort, dt);
  stepSpring(comal.sy, J.spring_k, J.spring_amort, dt);
  stepSpring(comal.pop, J.spring_k, J.spring_amort, dt);
  stepSpring(mejora.sc, J.spring_k, J.spring_amort, dt);
  stepSpring(cta.sl, J.ad_spring_k, J.ad_spring_amort, dt);

  // pulso del botón comprable (knob del motor)
  if (mejora.nivel===0 && G.billetes>=mejora.costo && fase==='upgrade'){
    mejora.pulsoT += dt;
    if (mejora.pulsoT > J.pulso_boton_s){ mejora.pulsoT = 0; mejora.sc.v += 2.4; }
  }

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
  for (const b of pila) b.t += dt;

  if (G.state === 'renovando'){ updateRenov(dt); updGuion(); return; }

  // spawn de clientes (clientes_por_min_inicial de config × accel del playable)
  if (!G.ctaShown || G.simTime - G.ctaT < 6){
    spawnT -= dt;
    const rate = E.clientes_por_min_inicial * 4.0 * spawnAccel;  // compresión
    if (spawnT<=0 && fila.length<E.max_fila){
      spawnCliente(); spawnT = 60/rate * (0.8+rng()*0.4);
    }
  }

  for (let i=clientes.length-1;i>=0;i--){
    const c = clientes[i];
    updCliente(c, dt);
    if (c.estado==='fuera') clientes.splice(i,1);
  }

  if (comal.flashT > 0) comal.flashT -= dt;
  if (comal.tapFlashT > 0) comal.tapFlashT -= dt;
  if (comal.radialT > 0) comal.radialT -= dt;
  if (comal.humoT > 0){
    comal.humoT -= dt;
    if ((G.tick%5)===0) vapor(COMAL.x, COMAL.y-12, 2);
    if (comal.humoT <= 0) tacoListo();
  }

  updGhost(dt);
  updGuion();
}

/* ============================================================================
   RENDER (cara E2 del motor: fondo + carrito s7 + HUD s7 + placas)
   ========================================================================= */
function fondoActual(){ return IMG[G.nivel>=2 ? 'fondo_2' : 'fondo_1']; }

let hits = [];
function hit(x,y,w,h,fn){ hits.push({x,y,w,h,fn}); }

function drawComal(){
  ctx.save();
  ctx.translate(COMAL.x, COMAL.y);
  ctx.scale(comal.sx.x*comal.pop.x, comal.sy.x*comal.pop.x);
  const puls = 0.34 + 0.14*Math.sin(G.simTime*3.2) + (comal.humoT>0? 0.3:0);
  const gg = ctx.createRadialGradient(0,0,COMAL.rx*0.4, 0,0,COMAL.rx*1.5);
  gg.addColorStop(0,'rgba(255,107,53,0)');
  gg.addColorStop(0.75,`rgba(255,107,53,${puls*0.55})`);
  gg.addColorStop(1,'rgba(255,107,53,0)');
  ctx.fillStyle = gg;
  ctx.beginPath(); ctx.ellipse(0,0,COMAL.rx*1.5,COMAL.ry*1.9,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = '#15151f';
  ctx.beginPath(); ctx.ellipse(0,2,COMAL.rx+6,COMAL.ry+4,0,0,Math.PI*2); ctx.fill();
  const sg = ctx.createRadialGradient(0,-3,6, 0,0,COMAL.rx);
  sg.addColorStop(0,'#4a4038'); sg.addColorStop(1,'#26221e');
  ctx.fillStyle = sg;
  ctx.beginPath(); ctx.ellipse(0,0,COMAL.rx,COMAL.ry,0,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,107,53,0.8)'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.ellipse(0,0,COMAL.rx,COMAL.ry,0,0,Math.PI*2); ctx.stroke();
  for (let i=0;i<comal.taps;i++){
    const a = i*2.1+0.5, d = 22;
    ctx.fillStyle = '#e8c97a';
    ctx.beginPath(); ctx.ellipse(Math.cos(a)*d, Math.sin(a)*d*0.4-2, 11, 5, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#c9a860';
    ctx.beginPath(); ctx.ellipse(Math.cos(a)*d, Math.sin(a)*d*0.4-2, 6, 2.6, 0, 0, Math.PI*2);
    ctx.fill();
  }
  if (comal.humoT>0){
    ctx.fillStyle = '#e8c97a';
    ctx.beginPath(); ctx.arc(0,-4,13,Math.PI,0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#4caf50'; ctx.fillRect(-9,-7,18,3);
    ctx.fillStyle = '#c0392b'; ctx.fillRect(-7,-10,14,3);
  }
  const front0 = fila[0];
  if (front0 && front0.estado==='espera' && comal.humoT<=0 &&
      comal.taps === E.taps_por_taco-1){
    const pk = 0.5+0.5*Math.sin(G.simTime*10);
    ctx.strokeStyle = `rgba(255,235,160,${0.3+0.45*pk})`;
    ctx.lineWidth = 3+2.5*pk;
    ctx.beginPath(); ctx.ellipse(0,0,COMAL.rx+9,COMAL.ry+6,0,0,Math.PI*2); ctx.stroke();
  }
  if (comal.flashT>0){
    ctx.globalAlpha = (comal.flashT/J.flash_comal_s)*0.55;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(0,-2,COMAL.rx*1.06,COMAL.ry*1.25,0,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (comal.tapFlashT>0){
    ctx.globalAlpha = clamp(comal.tapFlashT/J.flash_tap_s, 0, 1)*0.85;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(0,0,COMAL.rx*1.14,COMAL.ry*1.35,0,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (comal.radialT>0){
    const rk = clamp(comal.radialT/J.impacto_radial_dur_s, 0, 1);
    const n = J.impacto_radial_lineas, ky = COMAL.ry/COMAL.rx;
    ctx.strokeStyle = `rgba(255,244,214,${0.95*rk})`;
    ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    for (let i=0;i<n;i++){
      const a = comal.radialA + i*Math.PI*2/n;
      const r0 = COMAL.rx*1.18 + (1-rk)*10;
      const r1 = r0 + 12 + 14*rk;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a)*r0, Math.sin(a)*r0*ky);
      ctx.lineTo(Math.cos(a)*r1, Math.sin(a)*r1*ky);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
  ctx.restore();
  const front = fila[0];
  if (front && (front.estado==='espera'||front.estado==='pide')){
    for (let i=0;i<E.taps_por_taco;i++){
      ctx.fillStyle = i<comal.taps ? '#ff6b35' : 'rgba(255,255,255,0.2)';
      ctx.beginPath(); ctx.arc(COMAL.x-18+i*18, COMAL.y-40, 5, 0, Math.PI*2); ctx.fill();
    }
    ctx.font='700 13px Arial'; ctx.fillStyle='rgba(255,255,255,0.75)'; ctx.textAlign='center';
    ctx.fillText(T.tap_hint, COMAL.x, COMAL.y-56);
  }
  hit(COMAL.x-COMAL.rx-14, COMAL.y-COMAL.ry-30, (COMAL.rx+14)*2, (COMAL.ry+30)*2,
      ()=> tapComal());
}

/* walk-cycle REAL de la RONDA FULL (mismo mapeo del motor): en tránsito el
   frame lo dicta la fase de zancada (floor(fase·N)%N); parado = w1 estable.
   El playable no lleva pose aburrido (recorte deliberado — ver build.py). */
function frameZancada(c){
  const n = J.walk_frames_por_ciclo;
  return ((((c.dist / J.walk_paso_px) % 1) * n) | 0) % n + 1;   // 1..n
}
function spriteCliente(c){
  const base = 'cli_' + c.spr;
  if (c.estado === 'feliz') return IMG[base + '_celebra'];
  if (c.moviendo) return IMG[base + '_w' + frameZancada(c)];
  return IMG[base + '_w1'];
}
function drawCliente(c){
  const ph = (c.dist / J.walk_paso_px) % 1;
  const stepPh = c.moviendo ? Math.sin(ph*Math.PI) : 0;
  // walk_bob = 0 en config (el ciclo trae el bob dibujado); código intacto
  const bob = c.moviendo ? stepPh*J.walk_bob : Math.sin(G.simTime*2.2+c.x)*1.2;
  const y = c.y - bob - c.hop;
  const wsq = c.moviendo ? 1 + (stepPh-0.5)*2*J.walk_squash : 1;
  const sq = c.sq.x * wsq, alto = c.alto;
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(c.x, c.y+2, 16, 5, 0, 0, Math.PI*2); ctx.fill();
  ctx.globalAlpha = 1;
  const wig = c.estado==='pide' ? Math.sin(G.simTime*22)*1.6 : 0;
  ctx.translate(c.x + wig, y);
  if (c.moviendo) ctx.rotate(c.dir*J.walk_lean);
  else if (c.estado==='asoma') ctx.rotate(0.16);
  ctx.rotate(c.ln.x);
  ctx.scale(1/Math.sqrt(sq), sq);
  ctx.scale(alto, alto);
  const im = spriteCliente(c);
  const h = V.cliente_alto_px, w = h * im.width / im.height;
  if (c.dir < 0){ ctx.scale(-1, 1); }
  ctx.drawImage(im, -w/2, -h+2, w, h);
  if (c.dir < 0){ ctx.scale(-1, 1); }
  ctx.restore();
  if (c.estado==='asoma' && c.t>0.12 && c.t<0.78){
    const ek = Math.min((c.t-0.12)*6, 1);
    ctx.save(); ctx.translate(Math.max(c.x+10, 26), y-96); ctx.scale(ek,ek);
    ctx.fillStyle='#ffd700';
    ctx.beginPath(); ctx.arc(0,0,10,0,Math.PI*2); ctx.fill();
    ctx.font='900 15px Arial'; ctx.textAlign='center'; ctx.fillStyle='#1a1a2e';
    ctx.fillText('!', 0, 5); ctx.restore();
  }
  if ((c.estado==='pide' || c.estado==='espera') && fila[0]===c){
    const bx = c.x+2, by = y-118;
    ctx.save();
    ctx.fillStyle = 'rgba(244,232,208,0.96)';
    rr(bx-36, by-16, 72, 32, 10); ctx.fill();
    ctx.beginPath(); ctx.moveTo(bx-6,by+16); ctx.lineTo(bx+6,by+16); ctx.lineTo(bx,by+26);
    ctx.closePath(); ctx.fill();
    ctx.drawImage(IMG.icono_taco, bx-29, by-8, 22, 20);
    ctx.font='800 14px Arial'; ctx.fillStyle='#1a1a2e'; ctx.textAlign='left';
    ctx.fillText(`${c.servidos}/${c.pedidos}`, bx-4, by+7);
    ctx.restore();
  }
}

function drawVuelo(v){
  const t = easeOut(clamp(v.t,0,1));
  const x = lerp(lerp(v.x0,v.cx,t), lerp(v.cx,v.x1,t), t);
  const y = lerp(lerp(v.y0,v.cy,t), lerp(v.cy,v.y1,t), t);
  ctx.save(); ctx.translate(x,y);
  if (v.tipo==='taco'){
    ctx.rotate(v.t*5.5);
    ctx.drawImage(IMG.icono_taco, -16, -15, 32, 30);
  } else if (v.tipo==='billete'){
    ctx.rotate(Math.sin(v.t*11)*0.55);
    ctx.scale(1, 0.55+0.45*Math.abs(Math.cos(v.t*8)));
    ctx.fillStyle = '#4caf50'; rr(-11,-7,22,14,3); ctx.fill();
    ctx.fillStyle = '#a5e8a7'; ctx.font='900 11px Arial'; ctx.textAlign='center';
    ctx.fillText('$', 0, 4);
  }
  ctx.restore();
}

/* la montaña de billetes junto al puesto (hook abundancia) */
function drawPila(){
  for (const b of pila){
    const k = clamp(b.t*6, 0, 1);           // cae y aterriza
    const y = lerp(b.y-90, b.y, easeOut(k));
    ctx.save(); ctx.translate(b.x, y); ctx.rotate(b.rot*k);
    ctx.fillStyle = '#3d9142'; rr(-13,-8,26,16,3); ctx.fill();
    ctx.fillStyle = '#4caf50'; rr(-11,-6,22,12,2); ctx.fill();
    ctx.fillStyle = '#a5e8a7'; ctx.font='900 9px Arial'; ctx.textAlign='center';
    ctx.fillText('$', 0, 3);
    ctx.restore();
  }
}

function drawHUD(){
  ctx.save();
  const g = ctx.createLinearGradient(0,0,0,132);
  g.addColorStop(0,'rgba(10,10,20,0.98)'); g.addColorStop(1,'rgba(10,10,20,0)');
  ctx.fillStyle = g; ctx.fillRect(0,0,W,132);
  ctx.drawImage(IMG.hud_s7, 2, 4, W-4, 72);
  // billetes con spring (motor)
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
  // nivel
  ctx.font='800 15px Arial'; ctx.textAlign='center';
  ctx.lineWidth = 4; ctx.strokeStyle = '#1a1a2e'; ctx.lineJoin='round';
  const nivelTxt = G.nivel===1 ? T.nivel1 : T.nivel2;
  ctx.strokeText(nivelTxt, W/2, 26);
  ctx.fillStyle='#ffd700'; ctx.fillText(nivelTxt, W/2, 26);
  // barra de renovación → botón (motor); tras renovar (nivel 2) ya cumplió
  if (G.nivel >= 2){
    ctx.font='800 14px Arial'; ctx.textAlign='center';
    ctx.lineWidth = 4; ctx.strokeStyle = '#1a1a2e'; ctx.lineJoin='round';
    ctx.strokeText(T.nivel2_sub, W/2, 60);
    ctx.fillStyle='#4caf50'; ctx.fillText(T.nivel2_sub, W/2, 60);
    if (G.salsaOn) drawChipSalsa();
    ctx.restore();
    return;
  }
  const bx=120, by=44, bw=W-240, bh=24;
  const k = clamp(G.billetes/E.renovacion_costo, 0, 1);
  const lista = renovLista();
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
  ctx.fillText(lista ? T.renovar_lista.replace('{costo}', fmt(E.renovacion_costo))
    : T.renovar_progreso.replace('{tengo}', fmt(G.billetes))
        .replace('{costo}', fmt(E.renovacion_costo)), 0, 5);
  ctx.restore();
  if (lista){ ctx.strokeStyle='#fff'; ctx.lineWidth=2; rr(bx,by,bw,bh,12); ctx.stroke();
    hit(bx,by,bw,bh, renovar); }
  // chip SALSA ×2 activo
  if (G.salsaOn) drawChipSalsa();
  ctx.restore();
}
function drawChipSalsa(){
  ctx.font='800 12px Arial';
  const txt = T.chip_salsa.replace('{mult}', String(E.salsa_multiplicador));
  const w2 = ctx.measureText(txt).width + 24;
  ctx.fillStyle='rgba(255,107,53,0.92)'; rr(16, 84, w2, 26, 13); ctx.fill();
  ctx.fillStyle='#fff'; ctx.textAlign='left'; ctx.fillText(txt, 28, 101);
}

/* panel inferior: COMAL ✓ + SALSA (interactiva) + placas de profundidad */
function drawPanel(){
  const py = 648;
  ctx.save();
  ctx.fillStyle = '#141428'; ctx.fillRect(0, py, W, H-py);
  ctx.fillStyle = '#ff6b35'; ctx.fillRect(0, py, W, 3);
  ctx.font='800 11px Arial'; ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.textAlign='left';
  ctx.fillText(T.panel_h, 14, py+18);

  // COMAL comprado (placa turquesa + check, look del motor)
  const cw=150, ch=104, cy=py+30;
  ctx.save(); ctx.translate(14+cw/2, cy+ch/2);
  ctx.drawImage(IMG.placa_turquesa, -cw/2,-ch/2,cw,ch);
  ctx.font='800 12px Arial'; ctx.textAlign='center';
  ctx.lineWidth = 3; ctx.strokeStyle='rgba(20,16,30,0.75)'; ctx.lineJoin='round';
  ctx.strokeText(T.constr_comal, 0, -30); ctx.fillStyle='#fff'; ctx.fillText(T.constr_comal, 0, -30);
  ctx.strokeStyle='#fff'; ctx.lineWidth=5; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(-12,26); ctx.lineTo(-4,36); ctx.lineTo(14,16); ctx.stroke();
  ctx.strokeStyle='#2e7d32'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(-12,26); ctx.lineTo(-4,36); ctx.lineTo(14,16); ctx.stroke();
  ctx.restore();

  // SALSA (placa mostaza interactiva — mejoras_costos_base[0] de config)
  const mx=184, mw=200, mh=80, my2=py+42;
  const afford = mejora.nivel===0 && G.billetes>=mejora.costo;
  ctx.save(); ctx.translate(mx+mw/2, my2+mh/2);
  ctx.scale(mejora.sc.x, clamp(2-mejora.sc.x, 0.6, 1.4));
  ctx.globalAlpha = afford || mejora.nivel>0 ? 1 : 0.45;
  ctx.drawImage(IMG.placa_mostaza, -mw/2,-mh/2,mw,mh);
  if (afford){ ctx.strokeStyle='#ffd700'; ctx.lineWidth=3; rr(-mw/2,-mh/2,mw,mh,10); ctx.stroke(); }
  const imS = IMG.icono_salsa, ihS=44, iwS=ihS*imS.width/imS.height;
  ctx.drawImage(imS, -mw/2+12, -ihS/2, iwS, ihS);
  ctx.font='800 13px Arial'; ctx.textAlign='center'; ctx.fillStyle='#3a2810';
  ctx.fillText(T.mejora_salsa + (mejora.nivel? ' · Lv1':''), 12, -10);
  ctx.font='900 16px Arial';
  ctx.fillStyle = '#3a2810';
  ctx.fillText(mejora.nivel? T.mejora_hecha
    : '$'+fmt(mejora.costo)+'  ·  x'+E.salsa_multiplicador, 12, 16);
  ctx.restore();
  if (mejora.nivel===0) hit(mx, my2, mw, mh, comprarMejora);

  // profundidad: placas dimmed (costos reales de config, no interactivas)
  const dx=398, dw=128, dh2=48;
  [[T.mejora_grill, E.mejoras_costos_base[1]],
   [T.mejora_hawker, E.mejoras_costos_base[2]]].forEach(([nom,costo],i)=>{
    const yy = py+34 + i*(dh2+8);
    ctx.save(); ctx.globalAlpha = 0.42;
    ctx.drawImage(IMG.placa_roja, dx, yy, dw, dh2);
    ctx.font='800 10px Arial'; ctx.textAlign='center'; ctx.fillStyle='#fff';
    ctx.fillText(nom, dx+dw/2, yy+20);
    ctx.font='900 12px Arial';
    ctx.fillText('$'+fmt(costo), dx+dw/2, yy+37);
    ctx.restore();
  });
  ctx.restore();
}

function drawTelon(){
  const t = renov.t;
  let k;
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
    ctx.fillStyle = 'rgba(255,215,0,0.2)';
    for (let i=0;i<5;i++)
      ctx.fillRect(x0 + i*(W/10)+8, 100, 12, 548);
    ctx.fillStyle = '#ffd700';
    const edge = dir<0? x0+W/2 : x0;
    for (let i=0;i<14;i++){
      ctx.beginPath();
      ctx.arc(edge, 120+i*40, 9, 0, Math.PI*2); ctx.fill();
    }
  }
  if (t>=0.7 && t<1.05){
    ctx.font='900 34px Arial'; ctx.textAlign='center'; ctx.fillStyle='#ffd700';
    ctx.fillText(T.telon, W/2, 380);
  }
  ctx.restore();
}

function drawGhost(){
  if (!hand.visible) return;
  const dip = hand.tapT > 0 ? 0.82 : 1 + 0.06*Math.sin(G.simTime*6);
  ctx.save();
  ctx.translate(hand.x, hand.y);
  ctx.scale(dip, dip);
  ctx.rotate(-0.35);
  ctx.font = '54px Arial';
  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.95;
  ctx.fillText('👆', 0, 18);
  ctx.restore();
}

/* CTA overlay (spring del motor para el pop-in) */
function drawCTA(){
  if (!G.ctaShown) return;
  const k = clamp(cta.sl.x, 0, 1.2);
  ctx.save();
  ctx.globalAlpha = clamp(k*1.2,0,0.78);
  ctx.fillStyle = 'rgba(8,8,16,1)'; ctx.fillRect(0,0,W,H);
  ctx.globalAlpha = 1;
  ctx.translate(W/2, 430); ctx.scale(0.6+0.4*k, 0.6+0.4*k); ctx.translate(-W/2, -430);
  // logo: icono taco+billetes grande con glow
  const gl = ctx.createRadialGradient(W/2, 300, 20, W/2, 300, 190);
  gl.addColorStop(0,'rgba(255,215,0,0.35)'); gl.addColorStop(1,'rgba(255,215,0,0)');
  ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(W/2, 300, 190, 0, Math.PI*2); ctx.fill();
  const it = IMG.icono_taco_billetes, ih2 = 150, iw2 = ih2*it.width/it.height;
  ctx.drawImage(it, W/2-iw2/2, 225, iw2, ih2);
  ctx.font='900 52px Arial'; ctx.textAlign='center';
  ctx.lineWidth = 8; ctx.strokeStyle = '#1a1a2e'; ctx.lineJoin='round';
  ctx.strokeText('TACO EMPIRE', W/2, 452);
  ctx.fillStyle='#ffd700'; ctx.fillText('TACO EMPIRE', W/2, 452);
  ctx.font='800 24px Arial';
  ctx.lineWidth = 6; ctx.strokeText(T.cta_tagline, W/2, 496);
  ctx.fillStyle='#fff'; ctx.fillText(T.cta_tagline, W/2, 496);
  // botón (pulso del motor)
  const bp = 1+0.06*Math.sin(G.simTime*6);
  ctx.save(); ctx.translate(W/2, 585); ctx.scale(bp,bp);
  ctx.fillStyle='#4caf50'; rr(-150,-38,300,76,38); ctx.fill();
  ctx.strokeStyle='#fff'; ctx.lineWidth=3; rr(-150,-38,300,76,38); ctx.stroke();
  ctx.font='900 28px Arial'; ctx.fillStyle='#fff';
  ctx.fillText(T.cta_boton, 0, 10);
  ctx.restore();
  ctx.font='700 13px Arial'; ctx.fillStyle='rgba(255,255,255,0.6)';
  ctx.fillText(T.cta_pie, W/2, 650);
  ctx.restore();
  hit(0, 0, W, H, clickthrough);   // todo el overlay convierte
}

function render(){
  hits = [];
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,W,H);
  if (!assetsListos){       // primer frame instantáneo aunque falte decode
    ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0,0,W,H);
    return;
  }
  ctx.drawImage(fondoActual(), 0, 0, W, H);

  ctx.save();
  const shx = cam.shake>0 ? (hash2(G.tick,1)-0.5)*cam.shake*2 : 0;
  const shy = cam.shake>0 ? (hash2(G.tick,2)-0.5)*cam.shake*2 : 0;
  const z = cam.zoom.x;
  ctx.translate(W/2 + shx, 430 + shy); ctx.scale(z, z); ctx.translate(-W/2, -430);

  // carrito canon s7 (solo nivel 1 — el fondo 2 trae el local horneado)
  if (G.nivel === 1){
    const c = V.carrito, im = IMG.carrito;
    ctx.drawImage(im, c.x, c.y, c.w, c.w * im.height / im.width);
  }
  drawPila();
  for (const c of clientes) if (c.estado!=='sale') drawCliente(c);
  drawComal();
  for (const c of clientes) if (c.estado==='sale') drawCliente(c);
  for (const v of vuelos) drawVuelo(v);
  for (const p of parts){
    const a = 1 - p.t/p.life;
    ctx.globalAlpha = p.tipo==='vapor' ? a*0.4 : a;
    ctx.fillStyle = p.color;
    const r = p.tipo==='vapor' ? p.r*(1+p.t*1.6) : p.r*a+0.5;
    ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

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

  for (const c of confetti){
    ctx.save(); ctx.translate(c.x,c.y); ctx.rotate(c.rot);
    ctx.fillStyle = c.color; ctx.fillRect(-c.s/2,-c.s/4,c.s,c.s/2); ctx.restore(); }

  drawHUD();
  drawPanel();
  if (renov.activa) drawTelon();
  drawGhost();
  drawCTA();
}

/* ---------- input ---------- */
cv.addEventListener('pointerdown', (e)=>{
  const r = cv.getBoundingClientRect();
  const x = (e.clientX - r.left) * (W/r.width);
  const y = (e.clientY - r.top) * (H/r.height);
  lastUserT = G.simTime; userTocado = true;
  for (let i=hits.length-1;i>=0;i--){
    const h2 = hits[i];
    if (x>=h2.x && x<=h2.x+h2.w && y>=h2.y && y<=h2.y+h2.h){ h2.fn(); return; }
  }
  // tap fuera de hitbox durante el guión de taps = tap al comal igualmente
  // (playable: cero fricción para enseñar el verbo)
  if (!G.ctaShown && (fase==='tap' || fase==='rush' || fase==='live')) tapComal();
});

/* ---------- loop (timestep fijo del motor) + MRAID ---------- */
let paused = false;
let arrancado = false;
let last = 0, acc = 0, primeraPintada = false;
const t0ms = performance.now();
function frame(now){
  if (!arrancado) return;
  let dt = (now - last)/1000; last = now;
  dt = Math.min(dt, 0.1);
  if (!paused){
    acc += dt * G.timeScale;
    let guard = 0;
    while (acc >= TICK && guard < 8){ update(TICK); acc -= TICK; guard++; }
    if (guard >= 8) acc = 0;
    render();
    if (!primeraPintada && assetsListos){ primeraPintada = true;
      G.firstFrameMs = Math.round(performance.now() - t0ms); }
  }
  requestAnimationFrame(frame);
}
function start(){
  if (arrancado) return;
  arrancado = true;
  preSeed();
  last = performance.now();
  requestAnimationFrame(frame);
}
function boot(){
  let m = null;
  try { m = (typeof mraid !== 'undefined') ? mraid : null; } catch(e){ m = null; }
  if (m){
    try {
      const go = ()=>{
        try {
          m.addEventListener('viewableChange', (v)=>{ paused = !v; });
          if (m.isViewable && !m.isViewable()) paused = false; // arranca igual; viewableChange manda después
        } catch(e){}
        start();
      };
      if (m.getState && m.getState() === 'loading')
        m.addEventListener('ready', go);
      else go();
      return;
    } catch(e){ /* MRAID roto → preview normal */ }
  }
  start();
}

/* ---------- API para el smoke (fail-closed, lee estado REAL) ---------- */
window.PLAYABLE = {
  get money(){ return G.billetes; },
  get taps(){ return G.taps; },
  get ventas(){ return G.ventas; },
  get fase(){ return fase; },
  get nivel(){ return G.nivel; },
  get ctaShown(){ return G.ctaShown; },
  get firstFrameMs(){ return G.firstFrameMs; },
  get lang(){ return LANG; },
  get seed(){ return seed; },
  get simTime(){ return G.simTime; },
  strings: T,
  clickUrl: CLICK_URL,
};

boot();
})();
