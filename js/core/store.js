// Banco de dados do painel: arquivos cifrados na branch "dados" do repositório.
// Cada demanda, pessoa, mensagem e anexo é um arquivo próprio (menos conflitos entre pessoas).
// Leitura: ref → árvore → só os arquivos que mudaram (cache local por SHA). Escrita: um commit por alteração.
import { encryptJSON, encryptBytes, decrypt } from "./crypto.js";
import { makeGitHub } from "./github.js";

export const P = {
  setores: "db/setores.enc",
  config: "db/config.enc",
  contadores: "db/contadores.enc",
  avisos: "avisos/estado.enc",
  pessoas: "db/pessoas.enc",
  demanda: (id) => `db/demandas/${id}.enc`,
  mensagem: (did, mid) => `db/mensagens/${did}/${mid}.enc`,
  leitura: (uid) => `db/leituras/${uid}.enc`,
  presenca: (uid) => `db/presenca/${uid}.enc`,
  anexo: (uid) => `anexos/${uid}.bin`,
};

// ---------------------------------------------------------------- cache local (IndexedDB) dos arquivos cifrados
const idb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res) => {
    try {
      const r = indexedDB.open("painel-demandas", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("blobs");
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch (_) { res(null); }
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    if (!db) return null;
    return new Promise((res) => {
      try {
        const t = db.transaction("blobs", mode);
        const r = fn(t.objectStore("blobs"));
        t.oncomplete = () => res(r && r.result);
        t.onerror = () => res(null);
      } catch (_) { res(null); }
    });
  };
  return {
    get: (k) => tx("readonly", (s) => s.get(k)),
    set: (k, v) => tx("readwrite", (s) => s.put(v, k)),
  };
})();

export function createStore(cfg, key, token) {
  const gh = makeGitHub({ owner: cfg.owner, repo: cfg.repo, branch: cfg.dataBranch || "dados", token, apiBase: cfg.apiBase, rawBase: cfg.rawBase });
  const files = new Map(); // path → { sha, value }
  let head = null;
  const listeners = new Set();
  let queue = Promise.resolve();

  const db = {
    sectors: [], config: {}, counters: {}, users: new Map(), demands: new Map(),
    msgIndex: new Map(), // demandId → [{ path, id, at, authorId }]
    messages: new Map(), // path → mensagem (carregada sob demanda)
    reads: new Map(), presence: new Map(), avisos: null,
  };

  function rebuild() {
    db.users.clear(); db.demands.clear(); db.msgIndex.clear(); db.reads.clear(); db.presence.clear();
    for (const [path, f] of files) {
      let m;
      if (path === P.setores) db.sectors = f.value || [];
      else if (path === P.config) db.config = f.value || {};
      else if (path === P.contadores) db.counters = f.value || {};
      else if (path === P.avisos) db.avisos = f.value;
      else if (path === P.pessoas) for (const u of f.value || []) db.users.set(u.id, u);
      else if ((m = /^db\/demandas\/(\d+)\.enc$/.exec(path))) db.demands.set(Number(m[1]), f.value);
      else if ((m = /^db\/leituras\/(\d+)\.enc$/.exec(path))) db.reads.set(Number(m[1]), f.value || {});
      else if ((m = /^db\/presenca\/(\d+)\.enc$/.exec(path))) db.presence.set(Number(m[1]), f.value);
      else if ((m = /^db\/mensagens\/(\d+)\/((\d{13})-(\d+)-\w+)\.enc$/.exec(path))) {
        const did = Number(m[1]);
        if (!db.msgIndex.has(did)) db.msgIndex.set(did, []);
        db.msgIndex.get(did).push({ path, id: m[2], at: new Date(Number(m[3])).toISOString(), authorId: Number(m[4]) });
      }
    }
    for (const l of db.msgIndex.values()) l.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  const isData = (p) => p.startsWith("db/") || p === P.avisos;
  const isLazy = (p) => p.startsWith("db/mensagens/");

  async function fetchFile(path, sha) {
    let bytes = await idb.get(sha);
    if (!bytes) {
      bytes = await gh.raw(head, path, sha);
      idb.set(sha, bytes);
    }
    return decrypt(key, bytes);
  }

  async function pool(items, n, fn) {
    const out = [];
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
    }));
    return out;
  }

  async function sync({ force = false } = {}) {
    const h = await gh.head();
    if (!force && h.sha === head && !h.changed) return false;
    if (h.sha === head) return false;
    head = h.sha;
    const tree = await gh.tree(head);
    const seen = new Set();
    const todo = [];
    for (const t of tree) {
      if (!isData(t.path)) continue;
      seen.add(t.path);
      const cur = files.get(t.path);
      if (cur && cur.sha === t.sha) continue;
      if (isLazy(t.path)) { files.set(t.path, { sha: t.sha, value: cur && cur.sha === t.sha ? cur.value : undefined, lazy: true }); continue; }
      todo.push(t);
    }
    for (const p of [...files.keys()]) if (!seen.has(p)) files.delete(p);
    await pool(todo, 8, async (t) => {
      try { files.set(t.path, { sha: t.sha, value: await fetchFile(t.path, t.sha) }); }
      catch (e) { console.warn("Falha ao ler", t.path, e); }
    });
    rebuild();
    listeners.forEach((fn) => fn());
    return true;
  }

  async function loadMessages(demandId) {
    const idx = db.msgIndex.get(demandId) || [];
    await pool(idx, 6, async (m) => {
      const f = files.get(m.path);
      if (f && f.value === undefined) {
        try { f.value = await fetchFile(m.path, f.sha); } catch (e) { console.warn("Falha ao ler", m.path, e); }
      }
      if (f && f.value) db.messages.set(m.path, f.value);
    });
    return idx.map((m) => db.messages.get(m.path)).filter(Boolean);
  }

  // Escritas em fila: uma de cada vez, para não brigar consigo mesmo.
  function serial(fn) {
    const p = queue.then(fn, fn);
    queue = p.catch(() => {});
    return p;
  }

  async function putRaw(path, bytes, sha, message) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await gh.put(path, bytes, sha, message); }
      catch (e) {
        // corrida no avanço da branch (outra pessoa gravou outro arquivo no mesmo instante)
        if (e.conflict && /is at|reference|update/i.test(e.message) && attempt < 2) { await new Promise((r) => setTimeout(r, 400 + Math.random() * 600)); continue; }
        throw e;
      }
    }
  }

  function afterWrite(path, res, value) {
    files.set(path, { sha: res.sha, value });
    head = res.commit;
    rebuild();
    listeners.forEach((fn) => fn());
  }

  // Lê o valor atual, aplica fn e grava. Em conflito (outra pessoa alterou o mesmo arquivo), relê e tenta de novo.
  function mutate(path, fn, message) {
    return serial(async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const cur = files.get(path);
        const base = cur ? structuredClone(cur.value) : undefined;
        const next = await fn(base);
        if (next === undefined) return cur ? cur.value : undefined;
        const bytes = await encryptJSON(key, next);
        try {
          const res = await putRaw(path, bytes, cur && cur.sha, message);
          afterWrite(path, res, next);
          return next;
        } catch (e) {
          if (!e.conflict || attempt === 4) throw e;
          const fresh = await gh.getFile(path);
          if (fresh) files.set(path, { sha: fresh.sha, value: await decrypt(key, fresh.bytes) });
          else files.delete(path);
        }
      }
    });
  }

  function create(path, value, message) {
    return serial(async () => {
      const bytes = await encryptJSON(key, value);
      const res = await putRaw(path, bytes, undefined, message);
      afterWrite(path, res, value);
      return value;
    });
  }

  async function putBinary(path, bytes, message) {
    return serial(async () => {
      const enc = await encryptBytes(key, bytes);
      const res = await putRaw(path, enc, undefined, message);
      files.set(path, { sha: res.sha, value: bytes, bin: true });
      head = res.commit;
      return res;
    });
  }

  const binCache = new Map();
  async function getBinary(path) {
    if (binCache.has(path)) return binCache.get(path);
    const p = (async () => {
      let f = files.get(path);
      if (f && f.value instanceof Uint8Array) return f.value;
      if (!f) {
        await sync({ force: true });
        f = files.get(path);
      }
      if (!f) {
        // anexos não ficam no índice da árvore de dados; busca direto
        const t = (await gh.tree(head)).find((x) => x.path === path);
        if (!t) throw new Error("Anexo não encontrado.");
        f = { sha: t.sha };
      }
      return fetchFile(path, f.sha);
    })();
    binCache.set(path, p);
    p.catch(() => binCache.delete(path));
    return p;
  }

  return {
    db, gh, files, sync, loadMessages, mutate, create, putBinary, getBinary,
    get head() { return head; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
