// Rodada de avisos (GitHub Actions). Lê os dados cifrados, decide quem avisar e abre issues no repositório de avisos.
// Nunca escreve no log nomes, e-mails ou títulos: o repositório do painel é público e os logs também.
import fs from "node:fs";
import path from "node:path";
import { deriveKey, decrypt, encryptJSON } from "../../js/core/crypto.js";
import { computeAvisos } from "../../js/core/avisos.js";
import { opAutoConfirm, conf } from "../../js/core/logic.js";
import crypto from "node:crypto";

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
// mensagens: só os nomes dos arquivos (data e autor), sem decifrar o conteúdo
db.msgIndex = new Map();
const mdir = path.join(DADOS, "db/mensagens");
if (fs.existsSync(mdir)) for (const did of fs.readdirSync(mdir)) {
  const list = [];
  for (const f of fs.readdirSync(path.join(mdir, did))) { const m = /^(\d{13})-(\d+)-\w+\.enc$/.exec(f); if (m) list.push({ at: new Date(Number(m[1])).toISOString(), authorId: Number(m[2]) }); }
  db.msgIndex.set(Number(did), list.sort((a, b) => (a.at < b.at ? -1 : 1)));
}
const prev = (await read("avisos/estado.enc")) || null;

const now = process.env.AGORA || new Date().toISOString();
const { emails, state, digest, autoConfirm } = computeAvisos(db, prev, now, { appUrl: cfg.app_url, key: pass });
const nTeams = emails.filter((e) => e.canais.includes("teams")).length, nMail = emails.filter((e) => e.canais.includes("email")).length;
console.log(`${db.users.size} pessoas e ${db.demands.size} demandas lidas. ${emails.length} notificação(ões): ${nMail} por e-mail, ${nTeams} pelo Teams${digest ? " (inclui o resumo diário)" : ""}.`);
if (!prev) console.log("Primeira rodada: os acontecimentos anteriores foram marcados como vistos (sem avisos retroativos).");

// Confirmação automática: grava pela API (com o sha do arquivo) para não atropelar quem estiver mexendo na mesma demanda.
const ghToken = process.env.GH_TOKEN, selfRepo = process.env.GITHUB_REPOSITORY;
if (autoConfirm.length && ghToken && selfRepo) {
  const hours = conf(db, "flow").auto_confirm_hours;
  let ok = 0;
  for (const id of autoConfirm) {
    const rel = `db/demandas/${id}.enc`;
    const raw = fs.readFileSync(path.join(DADOS, rel));
    const sha = crypto.createHash("sha1").update(`blob ${raw.length}\0`).update(raw).digest("hex");
    const d = await read(rel);
    if (!opAutoConfirm(db, d, hours, now)) continue;
    const res = await fetch(`${API}/repos/${selfRepo}/contents/${rel}`, { method: "PUT", headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "painel-avisos" },
      body: JSON.stringify({ message: "Confirmação automática", branch: "dados", sha, content: Buffer.from(await encryptJSON(key, d)).toString("base64") }) });
    if (res.ok) ok++; else console.log(`Aviso: uma confirmação automática ficou para a próxima rodada (GitHub ${res.status}).`);
  }
  console.log(`${ok} demanda(s) confirmada(s) automaticamente.`);
  state.runs[0].autoconfirmadas = ok;
}

const token = process.env.AVISOS_TOKEN;
const repo = cfg.avisos_repo;
async function gh(method, p, body) {
  const res = await fetch(API + p, { method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "painel-avisos" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    let why = "";
    if (res.status === 401) why = " (AVISOS_TOKEN inválido ou vencido)";
    if (res.status === 403 || res.status === 404) why = " (o AVISOS_TOKEN precisa de Issues: leitura e escrita no repositório de avisos)";
    if (res.status === 422) why = " (confira o avisos_assignee: precisa ser o dono do repositório de avisos)";
    throw new Error(`GitHub respondeu ${res.status} em ${method} ${p.replace(/\?.*/, "")}${why}`);
  }
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
    try { await gh("POST", `/repos/${repo}/issues`, {
      title: `Painel-Avisos ${stamp} (${chunks[i].length})${chunks.length > 1 ? ` parte ${i + 1}/${chunks.length}` : ""}`,
      body: JSON.stringify({ origem: "Painel de Demandas", notificacoes: chunks[i] }),
      assignees: [cfg.avisos_assignee],
    }); } catch (e) { fail(`não foi possível abrir a issue de avisos: ${e.message}. O estado não foi salvo; a próxima rodada tenta de novo.`); }
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
