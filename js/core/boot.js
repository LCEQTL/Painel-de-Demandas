// Inicialização: lê config.json, obtém a chave de acesso (do link ou deste navegador),
// abre o token do GitHub e carrega os dados cifrados.
import { deriveKey, decryptText } from "./crypto.js";
import { createStore } from "./store.js";
import { createServer } from "./routes.js";

const KEY_STORAGE = "painel.chave";
let state = { promise: null, store: null, server: null, cfg: null, error: null };

export class BootError extends Error { constructor(kind, message) { super(message); this.kind = kind; } }

// A chave pode vir no link: ...#k=CHAVE ou ...#/demandas/12?k=CHAVE. Depois de lida, sai da barra de endereço.
function keyFromUrl() {
  const m = /[#?&]k=([^&#]+)/.exec(location.hash);
  if (!m) return null;
  const k = decodeURIComponent(m[1]);
  const clean = location.hash.replace(/([?&])k=[^&#]+&?/, "$1").replace(/[?&]$/, "").replace(/^#k=[^&]*&?/, "#");
  history.replaceState(null, "", location.pathname + location.search + (clean === "#" ? "" : clean));
  return k;
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
  const pass = passphrase || keyFromUrl() || storedKey();
  if (!pass) throw new BootError("key", "Abra o painel pelo link de acesso, que já traz a chave.");
  const key = await deriveKey(pass, cfg.salt, cfg.kdf_iterations);
  let token;
  try { token = await decryptText(key, cfg.token_enc); }
  catch (_) { forgetKey(); throw new BootError("key", "Chave de acesso incorreta. Use o link de acesso mais recente."); }
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
