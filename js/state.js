import { api } from "./api.js";

export const state = {
  me: null,
  sectors: [],
  attention: 0, // pendentes comigo novas/não lidas + aguardando minha confirmação
  online: new Set(), // ids de quem está online (visível para todos)
  listeners: new Set(),
  leaveGuard: null, // função que retorna true se houver texto não enviado
};

export function navigate(path) {
  const target = "#/" + path.replace(/^#?\/?/, "");
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = target;
}

export function isManager() { return !!(state.me && state.me.roles.is_manager); }
export function isAdmin() { return !!(state.me && state.me.roles.is_admin); }
export function isPrimary() { return !!(state.me && state.me.roles.primary_sector_ids.length); }
export function mySectors() {
  return (state.me ? state.me.memberships : []).filter((m) => m.sector_active !== false).map((m) => {
    const s = state.sectors.find((x) => x.id === m.sector_id) || {};
    return { id: m.sector_id, name: m.sector_name, acronym: m.acronym, is_manager: m.is_manager, color: s.color };
  });
}
export function sectorById(id) { return state.sectors.find((s) => String(s.id) === String(id)) || null; }

export async function loadSectors() {
  state.sectors = await api.get("/api/sectors");
  return state.sectors;
}

export async function refreshOnline() {
  try { state.online = new Set((await api.get("/api/presence/online")).online_ids); } catch (_) { /* opcional */ }
  return state.online;
}
export const isOnline = (id) => state.online.has(id);

let lastAttention = null;
export async function refreshCounts() {
  try {
    const c = await api.get("/api/demands/counts");
    if (lastAttention !== null && c.attention > lastAttention) window.dispatchEvent(new CustomEvent("painel:nova", { detail: c.attention - lastAttention }));
    lastAttention = c.attention;
    state.attention = c.attention;
    state.listeners.forEach((fn) => fn());
    return c;
  } catch (_) { return null; }
}
export function onCounts(fn) { state.listeners.add(fn); }
export function setLeaveGuard(fn) { state.leaveGuard = fn; }
