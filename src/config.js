/* ============================================================================
   config.js — carga FAIL-CLOSED de config/game.json (la única fuente de verdad).
   Aplana {valor, fuente, evidencia} → valor y valida que TODA clave requerida
   exista. Si falta una, LANZA (no hay defaults silenciosos: un default
   hardcodeado sería economía inventada fuera de la config).
   ========================================================================= */

const REQUERIDAS = {
  economia: [
    'dinero_inicial', 'construcciones_costos', 'construcciones_tier2_costos',
    'construcciones_tier3_costos', 'mejoras_costos_base', 'curva_upgrade_ratio',
    'ingreso_base_por_venta', 'taps_por_taco', 'ingreso_crecimiento_por_compra',
    'ftue_lluvia_mult', 'ftue_lluvia_dur_s', 'clientes_por_min_inicial',
    'max_fila', 'renovacion_costo', 'renovacion2_costo', 'oferta_starter_t_s',
    'starter_countdown_h', 'starter_reshow_s', 'starter_tope_duro_s',
    'booster_salsa_dur_s', 'salsa_multiplicador', 'booster_comal_dur_s',
    'comal_turbo_taps', 'money_pocket_factor',
    'money_pocket_min', 'money_pocket_adelanto_s', 'money_pocket_cadencia_s',
    'money_pocket_primero_t_s', 'dual_exit_gemas', 'influencer_gema_recompensa',
    'influencer_cadencia_s', 'influencer_primero_t_s', 'salsa_desde_t_s',
    'comal_turbo_desde_t_s', 'welcomeback_monto', 'welcomeback_x2', 'vip_t_s',
    'vip_pedidos', 'vip_paciencia_s', 'vip_tip_mult',
    'marchanta_clientes_mult_por_nivel', 'renovacion_reserva_ftue',
  ],
  iap: [
    'gems_ladder', 'gems_precios_usd', 'starter_bundle', 'noads_bundle',
    'dosx_permanente_usd', 'dosx_multiplicador', 'pass_tiers_usd',
    'pass_meta_compras',
    'cambio_gemas', 'cambio_base_factor', 'cambio_base_min',
  ],
  midlate: [
    'mid_desde_local', 'expansion_resetea_curva',
    'expansion_ingreso_mult_por_local', 'cap_estacion_por_local',
    'curva_costo_late_ratio', 'curva_late_desde_local',
    'renovacion_costo_escala', 'skip_ad_skus', 'skip_pack_contenidos',
    'free_cash_cooldown_min', 'free_cash_monto_factor', 'free_cash_min',
    'noads_oferta_post_prestige_s', 'oferta_transicion_dur_s',
    'dual_pricing_permanente_gems', 'dual_pricing_espera_min',
    'perm_ingreso_mult', 'perm_clientes_mult',
    'renovacion_late_requisito', 'renov_late_requisito_desde_local',
    'prestige_recompensa',
  ],
  visual: [
    'hud_estilo', 'carrito', 'cliente_alto_px', 'starter_banda', 'dpr_max',
    'props', 'tap_hit_factor',
  ],
  ritmo: [
    'cooldown_overlay_s', 'cooldown_overlay_demo_s', 'renov_dur_s',
    'oferta_tras_compra_s', 'pop_batch_s', 'max_pops', 'post_renov_calma_s',
    'starter_espera_libre_s', 'ad_sim_dur_s',
  ],
  juice: [
    'shake_intensidad', 'shake_tap', 'hitstop_ticks_tap', 'hitstop_ticks_grande',
    'walk_bob', 'walk_paso_px', 'walk_squash', 'walk_squash_contacto',
    'walk_lean', 'walk_freno_lean', 'walk_freno_squash', 'walk_freno_ticks',
    'flash_comal_s', 'flash_tap_s', 'shake_venta',
    'impacto_radial_lineas', 'impacto_radial_dur_s', 'comal_pop_escala',
    'ad_out_s', 'ad_in_escala0', 'ad_in_fade_s', 'ad_out_escala',
    'ad_spring_k', 'ad_spring_amort', 'ad_pop_v',
    'spring_k', 'spring_amort', 'particulas_densidad', 'squash_tap',
    'slowmo_vip', 'slowmo_save', 'vip_vignette_alpha', 'vip_near_miss_umbral',
    'vip_latido_hz_min', 'vip_latido_hz_max', 'vip_latido_shake',
    'vip_latido_ventana_s',
    'rafaga_cada_n', 'rafaga_freeze_s', 'rafaga_zoom', 'rafaga_gap_s',
    'pop_rise', 'pop_impulso', 'pop_gravedad', 'pop_arco_vx', 'pop_rekick_mult',
    'confeti_n', 'pulso_boton_s',
    'prop_spawn_escala0', 'prop_spawn_v', 'prop_polvo_n', 'prop_spawn_shake',
    'tap_aro_grosor', 'tap_aro_hz', 'tap_aro_rayos', 'tap_glow_alpha',
    'tap_hint_taps',
  ],
  demo: [
    'accel_clientes', 'dur_post_renov_s', 'starter_reshow_s', 'tienda_open_t',
    'tienda_dur_s', 'vip_timeout_s', 'renov_regalo_t_s', 'fin_t_s',
  ],
};

function aplanar(seccion, nombre) {
  const plano = {};
  for (const [k, v] of Object.entries(seccion)) {
    if (k.startsWith('_')) continue;
    if (v === null || typeof v !== 'object' || !('valor' in v)) {
      throw new Error(`config ${nombre}.${k}: nodo sin {valor,fuente,evidencia}`);
    }
    if (!['OBSERVED', 'INFERRED', 'DESIGNED'].includes(v.fuente)) {
      throw new Error(`config ${nombre}.${k}: fuente inválida "${v.fuente}"`);
    }
    plano[k] = v.valor;
  }
  return plano;
}

export async function cargarConfig(base = '.') {
  const res = await fetch(`${base}/config/game.json`);
  if (!res.ok) throw new Error(`no pude cargar config/game.json (${res.status})`);
  const raw = await res.json();
  const cfg = { meta: raw.meta };
  for (const [nombre, claves] of Object.entries(REQUERIDAS)) {
    if (!raw[nombre]) throw new Error(`config: falta la sección "${nombre}"`);
    cfg[nombre] = aplanar(raw[nombre], nombre);
    for (const k of claves) {
      if (!(k in cfg[nombre])) {
        throw new Error(`config: falta ${nombre}.${k} (fail-closed, sin defaults)`);
      }
    }
    Object.freeze(cfg[nombre]);
  }
  return Object.freeze(cfg);
}
