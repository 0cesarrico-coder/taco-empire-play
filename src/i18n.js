/* ============================================================================
   i18n.js — strings EN/ES desde config/strings.json. EN = default.
   Selección: ?lang=es|en > navigator.language. Fail-closed: clave que no
   existe lanza (mejor romper el smoke que shippear un "undefined" en pantalla).
   ========================================================================= */

let TABLA = null;
let LANG = 'en';

export async function cargarStrings(base = '.') {
  const res = await fetch(`${base}/config/strings.json`);
  if (!res.ok) throw new Error(`no pude cargar config/strings.json (${res.status})`);
  const raw = await res.json();
  const m = location.search.match(/[?&]lang=(\w+)/);
  const pedido = m ? m[1] : (navigator.language || 'en').slice(0, 2);
  LANG = raw[pedido] ? pedido : 'en';
  if (!raw.en) throw new Error('strings.json sin tabla "en" (default)');
  TABLA = raw[LANG];
  // toda clave de EN debe existir en la tabla elegida (paridad de idiomas)
  for (const k of Object.keys(raw.en)) {
    if (!(k in TABLA)) throw new Error(`strings: falta "${k}" en tabla "${LANG}"`);
  }
  return LANG;
}

export function lang() { return LANG; }

/** STR('clave', {x: 1}) — interpola {x}. Arrays se devuelven tal cual. */
export function STR(clave, vars) {
  if (!TABLA) throw new Error('i18n sin cargar');
  let s = TABLA[clave];
  if (s === undefined) throw new Error(`string desconocido: "${clave}"`);
  if (Array.isArray(s)) return s;
  if (vars) for (const [k, v] of Object.entries(vars)) {
    s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}
