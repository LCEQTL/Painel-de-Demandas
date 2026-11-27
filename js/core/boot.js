// Inicialização: lê config.json, obtém a chave de acesso (do link ou deste navegador),
// abre o token do GitHub e carrega os dados cifrados.
import { deriveKey, decryptText } from "./crypto.js";
import { createStore } from "./store.js";
import { createServer } from "./routes.js";

const KEY_STORAGE = "painel.chave";
let state = { promise: null, store: null, server: null, cfg: null, error: null };

export class BootError extends Error { constructor(kind, message) { super(message); this.kind = kind; } }

// A chave pode vir no link: ...?k=CHAVE (preferido: sobrevive ao Outlook/Teams), ...#k=CHAVE ou ...#/demandas/12?k=CHAVE.
// Depois de lida, sai da barra de endereço e fica guardada (na memória e neste navegador).
let urlKey = null;
function keyFromUrl() {
  if (urlKey) return urlKey;
  let k = null;
  const qs = new URLSearchParams(location.search);
  if (qs.get("k")) { k = qs.get("k"); qs.delete("k"); }
  const m = /[#?&]k=([^&#]+)/.exec(location.hash);
  let hash = location.hash;
  if (m) { k = k || decodeURIComponent(m[1]); hash = hash.replace(/([?&])k=[^&#]+&?/, "$1").replace(/[?&]$/, "").replace(/^#k=[^&]*&?/, "#"); }
  if (k) {
    const q = qs.toString();
    history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + (hash === "#" ? "" : hash));
    urlKey = k.trim();
  }
  return urlKey;
}
function storedKey() { try { return localStorage.getItem(KEY_STORAGE); } catch (_) { return null; } }
function saveKey(k) { try { localStorage.setItem(KEY_STORAGE, k); } catch (_) { /* sem armazenamento local */ } }
export function forgetKey() { try { localStorage.removeItem(KEY_STORAGE); } catch (_) { /* ignora */ } }

async function start(passphrase) {
  const cfg = await fetch("config.json", { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new BootError("config", "O painel ainda não foi instalado (config.json não encontrado).");
    return r.json();
  });
  state.cfg = cfg;
  const pass = (passphrase || keyFromUrl() || storedKey() || "").trim();
  if (!pass) throw new BootError("nokey", "");
  const key = await deriveKey(pass, cfg.salt, cfg.kdf_iterations);
  let token;
  try { token = await decryptText(key, cfg.token_enc); }
  catch (_) { forgetKey(); urlKey = null; throw new BootError("key", "Palavra-chave incorreta. Confira com o administrador ou use o link de acesso mais recente."); }
  saveKey(pass);
  const store = createStore(cfg, key, token);
  await store.sync({ force: true });
  const server = createServer(store, { appUrl: cfg.app_url, avisosRepo: cfg.avisos_repo });
  state.store = store; state.server = server; state.key = pass;
  // Atualização automática: pergunta ao GitHub se algo mudou (consulta que não gasta a cota quando nada mudou).
  let busy = false;
  const tick = async () => {
    if (busy || document.visibilityState !== "visible") return;
    busy = true;
    try { if (await store.sync()) window.dispatchEvent(new CustomEvent("painel:dados")); } catch (e) { console.warn("Sincronização:", e.message); }
    busy = false;
  };
  setInterval(tick, 30000);
  document.addEventListener("visibilitychange", tick);
  return state;
}

export function ready(passphrase) {
  if (!state.promise) state.promise = start(passphrase).catch((e) => { state.promise = null; state.error = e; throw e; });
  return state.promise;
}
export const getServer = () => state.server;
export const getStore = () => state.store;
export const getConfig = () => state.cfg;
export const getKey = () => state.key;
