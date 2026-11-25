// Camada única de acesso aos dados. As telas chamam caminhos /api/... como antes;
// aqui eles são atendidos no próprio navegador (core/routes.js), lendo e gravando no repositório.
import { HttpError } from "./core/logic.js";
import { ready, getServer, getStore } from "./core/boot.js";
import { P } from "./core/store.js";

export class ApiError extends Error {
  constructor(status, message, detail) { super(message); this.status = status; this.detail = detail; }
}

let onAuthError = () => {};
export function setAuthHandler(fn) { onAuthError = fn; }

export async function request(method, path, body, opts = {}) {
  await ready();
  try {
    return await getServer().handle(method, path, body);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : e.status || 0;
    let msg = e.message || "Não foi possível concluir a operação.";
    if (e.conflict) msg = "Outra pessoa alterou isto agora há pouco. Tente de novo.";
    const err = new ApiError(status, msg, e.detail);
    if ((status === 401 || status === 428) && !opts.noAuthRedirect) onAuthError(status);
    throw err;
  }
}

export const api = {
  get: (p, o) => request("GET", p, undefined, o),
  post: (p, b, o) => request("POST", p, b === undefined ? {} : b, o),
  patch: (p, b) => request("PATCH", p, b),
  put: (p, b) => request("PUT", p, b),
  del: (p) => request("DELETE", p),
  upload: (path, blob) => request("POST", path, blob),
};

// Baixa um arquivo gerado no navegador.
export function saveFile(name, data, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

const imgCache = new Map();
export function imageObjectUrl(uid) {
  if (!imgCache.has(uid)) {
    const p = (async () => {
      await ready();
      const bytes = await getStore().getBinary(P.anexo(uid));
      return URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    })();
    imgCache.set(uid, p);
    p.catch(() => imgCache.delete(uid));
  }
  return imgCache.get(uid);
}

export function qs(params) {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") u.set(k, v); });
  const s = u.toString();
  return s ? "?" + s : "";
}
