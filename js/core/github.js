// Acesso ao repositório (API REST do GitHub). Usado pelo painel e pelo instalador.
import { b64 } from "./crypto.js";

export class GitHubError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

export function makeGitHub({ owner, repo, branch = "dados", token, apiBase = "https://api.github.com", rawBase = "https://raw.githubusercontent.com" }) {
  const base = apiBase.replace(/\/$/, "");
  const R = `/repos/${owner}/${repo}`;
  const etags = new Map();

  async function req(method, path, body, { etag = false, accept } = {}) {
    const headers = { Accept: accept || "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const key = method + " " + path;
    if (etag && etags.has(key)) headers["If-None-Match"] = etags.get(key).etag;
    let res;
    try {
      res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
    } catch (_) {
      throw new GitHubError(0, "Sem conexão com o GitHub. Verifique a internet.");
    }
    if (res.status === 304 && etag) return { notModified: true, data: etags.get(key).data };
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (_) { data = text; } }
    if (!res.ok) {
      let msg = (data && data.message) || `Erro ${res.status} no GitHub.`;
      if (res.status === 401) msg = "O token do GitHub é inválido ou expirou. Peça ao administrador para trocá-lo.";
      if (res.status === 403 && /rate limit/i.test(msg)) msg = "Limite de uso do GitHub atingido. Tente de novo em alguns minutos.";
      throw new GitHubError(res.status, msg, data);
    }
    if (etag && res.headers.get("ETag")) etags.set(key, { etag: res.headers.get("ETag"), data });
    return { notModified: false, data };
  }

  return {
    owner, repo, branch, req,
    async head(ref = branch) {
      const r = await req("GET", `${R}/git/ref/heads/${ref}`, undefined, { etag: true });
      return { sha: r.data.object.sha, changed: !r.notModified };
    },
    async tree(commitSha) {
      const r = await req("GET", `${R}/git/trees/${commitSha}?recursive=1`);
      return r.data.tree.filter((x) => x.type === "blob").map((x) => ({ path: x.path, sha: x.sha, size: x.size }));
    },
    async raw(commitSha, path, blobSha) {
      // Arquivos do repositório público: leitura pelo raw (não gasta a cota da API).
      try {
        const res = await fetch(`${rawBase.replace(/\/$/, "")}/${owner}/${repo}/${commitSha}/${path}`, { cache: "force-cache" });
        if (res.ok) return new Uint8Array(await res.arrayBuffer());
      } catch (_) { /* tenta pela API */ }
      const r = await req("GET", `${R}/git/blobs/${blobSha}`);
      return Uint8Array.from(atob(r.data.content.replace(/\n/g, "")), (c) => c.charCodeAt(0));
    },
    async getFile(path, ref = branch) {
      try {
        const r = await req("GET", `${R}/contents/${path}?ref=${ref}`);
        const content = r.data.content ? Uint8Array.from(atob(r.data.content.replace(/\n/g, "")), (c) => c.charCodeAt(0))
          : await this.raw(ref, path, r.data.sha);
        return { sha: r.data.sha, bytes: content };
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },
    async put(path, bytes, sha, message) {
      const body = { message: message || `Atualiza ${path}`, content: b64(bytes), branch };
      if (sha) body.sha = sha;
      try {
        const r = await req("PUT", `${R}/contents/${path}`, body);
        return { sha: r.data.content.sha, commit: r.data.commit.sha };
      } catch (e) {
        if (e.status === 409 || (e.status === 422 && /sha/i.test(e.message))) e.conflict = true;
        throw e;
      }
    },
  };
}
