// Rodada de avisos (GitHub Actions). Lê os dados cifrados, decide quem avisar e abre issues no repositório de avisos.
// Nunca escreve no log nomes, e-mails ou títulos: o repositório do painel é público e os logs também.
import fs from "node:fs";
import path from "node:path";
import { deriveKey, decrypt, encryptJSON } from "../../js/core/crypto.js";
import { computeAvisos } from "../../js/core/avisos.js";

const SITE = process.env.SITE_DIR || "site";
const DADOS = process.env.DADOS_DIR || "dados";
const API = (process.env.GITHUB_API || "https://api.github.com").replace(/\/$/, "");
const fail = (msg) => { console.error("Erro: " + msg); process.exit(1); };

const cfg = JSON.parse(fs.readFileSync(path.join(SITE, "config.json"), "utf8"));
const pass = process.env.PAINEL_CHAVE;
if (!pass) fail("segredo PAINEL_CHAVE não configurado no repositório.");
const key = await deriveKey(pass, cfg.salt, cfg.kdf_iterations);

async function read(rel) {
  const f = path.join(DADOS, rel);
  if (!fs.existsSync(f)) return undefined;
  return decrypt(key, new Uint8Array(fs.readFileSync(f)));
}
let users;
try { users = (await read("db/pessoas.enc")) || []; } catch (_) { fail("não foi possível decifrar os dados. Confira o segredo PAINEL_CHAVE."); }
const db = { sectors: (await read("db/setores.enc")) || [], config: (await read("db/config.enc")) || {}, users: new Map(users.map((u) => [u.id, u])), demands: new Map(), msgIndex: new Map() };
const ddir = path.join(DADOS, "db/demandas");
if (fs.existsSync(ddir)) for (const f of fs.readdirSync(ddir)) if (f.endsWith(".enc")) { const d = await read("db/demandas/" + f); db.demands.set(d.id, d); }
const prev = (await read("avisos/estado.enc")) || null;

const now = process.env.AGORA || new Date().toISOString();
const { emails, state, digest } = computeAvisos(db, prev, now, { appUrl: cfg.app_url, key: pass });
console.log(`${db.demands.size} demandas lidas. ${emails.length} e-mail(s) a enviar${digest ? " (inclui o resumo diário)" : ""}.`);

const token = process.env.AVISOS_TOKEN;
const repo = cfg.avisos_repo;
async function gh(method, p, body) {
  const res = await fetch(API + p, { method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "painel-avisos" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status} em ${method} ${p.replace(/\?.*/, "")}`);
  return res.status === 204 ? null : res.json();
}
if (emails.length) {
  if (!token) fail("segredo AVISOS_TOKEN não configurado no repositório.");
  if (!repo) fail("config.json sem avisos_repo.");
  // Divide em issues de até ~60 mil caracteres (limite do corpo da issue é 65.536).
  const chunks = [];
  let cur = [];
  const size = (list) => JSON.stringify({ origem: "Painel de Demandas", notificacoes: list }).length;
  for (const e of emails) { if (cur.length && size([...cur, e]) > 60000) { chunks.push(cur); cur = []; } cur.push(e); }
  if (cur.length) chunks.push(cur);
  const stamp = new Date(new Date(now).getTime() - 3 * 3600000).toISOString().slice(0, 16).replace("T", " ");
  for (let i = 0; i < chunks.length; i++) {
    await gh("POST", `/repos/${repo}/issues`, {
      title: `Painel-Avisos ${stamp} (${chunks[i].length})${chunks.length > 1 ? ` parte ${i + 1}/${chunks.length}` : ""}`,
      body: JSON.stringify({ origem: "Painel de Demandas", notificacoes: chunks[i] }),
      assignees: [cfg.avisos_assignee],
    });
  }
  console.log(`${chunks.length} issue(s) aberta(s) no repositório de avisos.`);
}
// Fecha issues antigas já processadas pelo Power Automate (mais de 3 horas).
if (token && repo) {
  try {
    const open = await gh("GET", `/repos/${repo}/issues?state=open&per_page=100`);
    const cutoff = Date.now() - 3 * 3600000;
    let n = 0;
    for (const it of open || []) if (it.title.startsWith("Painel-Avisos") && new Date(it.created_at).getTime() < cutoff) { await gh("PATCH", `/repos/${repo}/issues/${it.number}`, { state: "closed" }); n++; }
    if (n) console.log(`${n} issue(s) antiga(s) fechada(s).`);
  } catch (e) { console.log("Aviso: não foi possível fechar issues antigas (" + e.message + ")."); }
}
fs.mkdirSync(path.join(DADOS, "avisos"), { recursive: true });
fs.writeFileSync(path.join(DADOS, "avisos/estado.enc"), await encryptJSON(key, state));
