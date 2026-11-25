// Regras de negócio (as mesmas da versão local): permissões, demandas, prazos, percurso por setor.
// Funções puras sobre os documentos; quem grava é o routes.js (via store.mutate).

export class HttpError extends Error {
  constructor(status, message, detail) { super(message); this.status = status; this.detail = detail || message; }
}
export const bad = (msg, status = 400, detail) => { throw new HttpError(status, msg, detail); };

export const STATUS_ABERTA = "aberta", STATUS_CONFIRMACAO = "aguardando_confirmacao", STATUS_CONCLUIDA = "concluida", STATUS_CANCELADA = "cancelada";
export const OPEN_STATUSES = [STATUS_ABERTA, STATUS_CONFIRMACAO];
export const STATUS_LABELS = { aberta: "Pendente", aguardando_confirmacao: "Aguardando confirmação", concluida: "Concluída", cancelada: "Cancelada" };
export const PRIORITIES = ["normal", "alta", "urgente"];
export const ROLE_LABEL = { colaborador: "Colaborador", gestor: "Gestor", gerente: "Gerente" };
export const SECTOR_PALETTE = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#db2777", "#0891b2", "#a16207", "#475569"];

export const DEFAULT_CONFIG = {
  deadline_bands: { yellow_max_days_left: 3, orange_max_days_left: 1, red_max_days_late: 3, darkred_max_days_late: 7 },
  limits: { max_text_chars: 20000, max_table_rows: 500, max_table_cols: 30, max_cell_chars: 1000, max_blocks: 60, max_image_kb: 800, max_images_per_content: 10 },
  notifications: {
    enabled: 1, test_mode: 1, test_email: "", work_start: 8, work_end: 18, weekdays_only: 1,
    remind_alta_hours: 4, remind_urgente_hours: 2, escalate_days: 5, digest_hour: 8,
  },
  presence: { heartbeat_minutes: 15, online_minutes: 20 },
};
export function conf(db, key) { return { ...DEFAULT_CONFIG[key], ...((db.config || {})[key] || {}) }; }

// ---------------------------------------------------------------- tempo (Piauí: UTC-3, sem horário de verão)
const OFFSET_MS = 3 * 3600 * 1000;
export const nowIso = () => new Date().toISOString();
export function localIso(iso) {
  if (!iso) return null;
  return new Date(new Date(iso).getTime() - OFFSET_MS).toISOString().slice(0, 19) + "-03:00";
}
export function localDate(iso) { return new Date(new Date(iso).getTime() - OFFSET_MS).toISOString().slice(0, 10); }
export const todayLocal = (now = nowIso()) => localDate(now);
export function localHour(now = nowIso()) { return new Date(new Date(now).getTime() - OFFSET_MS).getUTCHours(); }
export function localWeekday(now = nowIso()) { return new Date(new Date(now).getTime() - OFFSET_MS).getUTCDay(); }
export function addDays(dateStr, n) { const d = new Date(dateStr + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function daysBetween(a, b) { return Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 86400000); }
export function endOfDayUtc(dateStr) { return new Date(dateStr + "T23:59:59-03:00").toISOString(); }
export function startOfDayUtc(dateStr) { return new Date(dateStr + "T00:00:00-03:00").toISOString(); }
export function secondsBetween(a, b) { return Math.max(0, Math.floor((new Date(b || nowIso()) - new Date(a)) / 1000)); }
export function fmtDuration(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return `${h}h ${m}min`;
  return `${m}min`;
}
export function deadlineInfo(due, status, bands, today = todayLocal()) {
  if (!due) return { days_left: null, days_late: 0, level: "none", label: "Sem prazo" };
  const left = daysBetween(today, due);
  if (["concluida", "cancelada", "aguardando_confirmacao"].includes(status)) {
    return { days_left: left, days_late: 0, level: "closed", label: { concluida: "Concluída", cancelada: "Cancelada", aguardando_confirmacao: "Resolvida" }[status] };
  }
  if (left < 0) {
    const late = -left;
    const level = late <= bands.red_max_days_late ? "red" : late <= bands.darkred_max_days_late ? "darkred" : "purple";
    return { days_left: left, days_late: late, level, label: late === 1 ? "Vencida há 1 dia" : `Vencida há ${late} dias` };
  }
  const label = left === 0 ? "Vence hoje" : left === 1 ? "Vence amanhã" : `Vence em ${left} dias`;
  const level = left <= bands.orange_max_days_left ? "orange" : left <= bands.yellow_max_days_left ? "yellow" : "neutral";
  return { days_left: left, days_late: 0, level, label };
}

// ---------------------------------------------------------------- pessoas e setores
export const sectorById = (db, id) => db.sectors.find((s) => s.id === Number(id)) || null;
export const sectorRef = (s) => (s ? { id: s.id, name: s.name, acronym: s.acronym, color: s.color } : null);
export const userRef = (u) => (u ? { id: u.id, name: u.full_name } : null);
export const uref = (db, id) => userRef(db.users.get(Number(id)));

export function activeMemberships(db, u) {
  return (u.memberships || []).filter((m) => m.active !== false && (sectorById(db, m.sector_id) || {}).active !== false);
}
export const memberSectorIds = (db, u) => new Set(activeMemberships(db, u).map((m) => m.sector_id));
export const managedSectorIds = (db, u) => new Set(activeMemberships(db, u).filter((m) => m.role === "gestor" || m.role === "gerente").map((m) => m.sector_id));
export const primarySectorIds = (db, u) => new Set(db.sectors.filter((s) => s.active !== false && s.primary_manager_id === u.id).map((s) => s.id));
export function roleIn(db, u, sectorId) {
  const m = activeMemberships(db, u).find((x) => x.sector_id === Number(sectorId));
  return m ? m.role || "colaborador" : null;
}
// Gerentes do setor: recebem as cobranças de atraso. Sem gerente, o gerente principal.
export function sectorGerentes(db, sectorId) {
  const out = [...db.users.values()].filter((u) => u.is_active && roleIn(db, u, sectorId) === "gerente");
  if (out.length) return out;
  const s = sectorById(db, sectorId);
  const p = s && s.primary_manager_id ? db.users.get(s.primary_manager_id) : null;
  return p && p.is_active ? [p] : [];
}

export function membershipDict(db, u, m) {
  const s = sectorById(db, m.sector_id) || { id: m.sector_id, name: "?", acronym: "?" };
  const role = m.role || "colaborador";
  return { sector_id: s.id, sector_name: s.name, acronym: s.acronym, role, role_label: ROLE_LABEL[role],
    is_manager: role !== "colaborador", is_primary: s.primary_manager_id === u.id, sector_active: s.active !== false };
}
export function userFull(db, u) {
  return {
    id: u.id, username: u.username, full_name: u.full_name, short_code: u.short_code, phone_corp: u.phone_corp,
    phone_personal: u.phone_personal || null, email: u.email || null, is_admin: !!u.is_admin, is_active: !!u.is_active,
    must_change_password: !!u.must_change_password, created_at: localIso(u.created_at),
    memberships: activeMemberships(db, u).map((m) => membershipDict(db, u, m)),
  };
}

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,59}$/;
export function normalizeUsername(raw) { let u = String(raw || "").trim().toLowerCase(); if (u.includes("@")) u = u.split("@")[0]; return u; }
export function validateUsername(u) { if (!USERNAME_RE.test(u)) bad("Login inválido. Use a parte antes do @ do e-mail (letras, números, ponto, hífen ou sublinhado)."); }
export function normalizePhone(raw, required, label) {
  const p = String(raw || "").trim();
  if (!p) { if (required) bad(`${label} é obrigatório.`); return null; }
  if (!/^\+?[0-9 ()\-]{8,25}$/.test(p)) bad(`${label} inválido. Informe com DDD, por exemplo 86 99999-0000.`);
  const digits = p.replace(/\D/g, "");
  if (digits.length < 10) bad(`${label} deve incluir o DDD.`);
  if (p.startsWith("+")) return "+" + digits;
  if (digits.length === 10 || digits.length === 11) return "+55" + digits;
  return "+" + digits;
}
export function normalizeEmail(raw) {
  const e = String(raw || "").trim().toLowerCase();
  if (!e) return null;
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) bad(`E-mail inválido: ${e}`);
  return e;
}
export function makeShortCode(db, fullName) {
  const plain = fullName.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const words = plain.split(/[^A-Z]+/).filter((w) => w && !["DA", "DE", "DO", "DAS", "DOS", "E"].includes(w));
  const ini = !words.length ? "XX" : words.length === 1 ? (words[0] + "X").slice(0, 2) : words[0][0] + words[words.length - 1][0];
  const used = new Set([...db.users.values()].map((u) => u.short_code));
  for (let n = 1; n < 1000; n++) { const c = ini + String(n).padStart(2, "0"); if (!used.has(c)) return c; }
  return ini + Date.now() % 1000;
}
export function validatePasswordStrength(p) {
  if (!p || p.length < 8) return "A senha deve ter no mínimo 8 caracteres.";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "A senha deve combinar letras e números.";
  return null;
}

// ---------------------------------------------------------------- conteúdo (texto, tabelas, imagens)
const HTML_TAG = /<\s*\/?\s*[a-zA-Z!?][^<>]*>|<\s*\/?\s*(script|img|iframe|svg|object|embed|style|link|meta)\b/i;
const DATA_URI = /data\s*:\s*[a-z]+\/[a-z0-9.+-]+\s*[;,]/i;
const BAD_SCHEME = /(javascript|vbscript|file)\s*:/i;
export function checkText(v, where, max) {
  if (typeof v !== "string") bad(`${where}: valor de texto inválido.`, 422);
  v = v.replace(/\r\n/g, "\n").replace(/\x00/g, "");
  if (v.length > max) bad(`${where}: o texto tem ${v.length} caracteres; o limite é ${max}.`, 422);
  if (DATA_URI.test(v)) bad(`${where}: imagens ou arquivos embutidos (data:) não são permitidos.`, 422);
  if (HTML_TAG.test(v)) bad(`${where}: HTML/scripts não são permitidos. Use a formatação simples do editor.`, 422);
  if (BAD_SCHEME.test(v)) bad(`${where}: links com javascript:, vbscript: ou file: não são permitidos.`, 422);
  return v;
}
function parseNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  let s = String(v).trim().replace("R$", "").replace(/\s/g, "");
  if (s === "") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  if (Number.isNaN(n)) throw new Error("num");
  return n;
}
function parseDate(v) {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return s;
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s))) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  throw new Error("date");
}
export function validateTable(tbl, limits, where = "Tabela") {
  if (!tbl || typeof tbl !== "object") bad(`${where}: formato inválido.`, 422);
  const cols = tbl.columns, rows = tbl.rows || [];
  if (!Array.isArray(cols) || !cols.length) bad(`${where}: informe ao menos uma coluna.`, 422);
  if (cols.length > limits.max_table_cols) bad(`${where}: ${cols.length} colunas; o limite é ${limits.max_table_cols}.`, 422);
  if (!Array.isArray(rows)) bad(`${where}: linhas inválidas.`, 422);
  if (rows.length > limits.max_table_rows) bad(`${where}: ${rows.length} linhas; o limite é ${limits.max_table_rows}.`, 422);
  const cc = cols.map((c, i) => {
    const label = checkText(String((c && c.label) || "").trim() || `Coluna ${i + 1}`, `${where}, cabeçalho ${i + 1}`, 120);
    const type = (c && c.type) || "text";
    if (!["text", "number", "currency", "date", "list"].includes(type)) bad(`${where}: tipo de coluna inválido.`, 422);
    const col = { label, type };
    if (type === "list") {
      if (!Array.isArray(c.options) || !c.options.length) bad(`${where}: a coluna '${label}' do tipo lista precisa de opções.`, 422);
      col.options = c.options.slice(0, 50).map((o) => checkText(String(o), `${where}, opção`, 100));
    }
    return col;
  });
  const rr = rows.map((row, ri) => {
    if (!Array.isArray(row)) bad(`${where}: linha ${ri + 1} inválida.`, 422);
    row = row.slice(0, cc.length).concat(Array(Math.max(0, cc.length - row.length)).fill(null));
    return row.map((cell, ci) => {
      const col = cc[ci], loc = `${where}, linha ${ri + 1}, coluna '${col.label}'`;
      if (cell && typeof cell === "object") bad(`${loc}: valor inválido.`, 422);
      try {
        if (col.type === "number" || col.type === "currency") return parseNumber(cell);
        if (col.type === "date") return parseDate(cell);
      } catch (_) { bad(`${loc}: '${String(cell).slice(0, 40)}' não é ${col.type === "date" ? "uma data (dd/mm/aaaa)" : "um número"} válido.`, 422); }
      const s = cell === null || cell === undefined ? "" : checkText(String(cell), loc, limits.max_cell_chars);
      if (col.type === "list" && s && !col.options.includes(s)) bad(`${loc}: '${s.slice(0, 40)}' não está entre as opções.`, 422);
      return s;
    });
  });
  const out = { columns: cc, rows: rr };
  if (tbl.title) out.title = checkText(String(tbl.title), `${where}, título`, 160);
  return out;
}
export function validateContent(content, limits, where = "Conteúdo", required = true) {
  if (content === null || content === undefined || content === "") content = { v: 1, blocks: [] };
  if (typeof content === "string") content = { v: 1, blocks: [{ t: "text", md: content }] };
  if (typeof content !== "object" || !Array.isArray(content.blocks || [])) bad(`${where}: formato inválido.`, 422);
  const blocks = content.blocks || [];
  if (blocks.length > limits.max_blocks) bad(`${where}: muitos blocos (${blocks.length}).`, 422);
  const out = [];
  let total = 0, nt = 0, ni = 0;
  for (const b of blocks) {
    if (!b || typeof b !== "object") bad(`${where}: bloco inválido.`, 422);
    if (b.t === "text") {
      const md = checkText(b.md || "", where, limits.max_text_chars);
      total += md.length;
      if (md.trim()) out.push({ t: "text", md });
    } else if (b.t === "table") {
      nt++;
      out.push({ ...validateTable(b, limits, `${where}, tabela ${nt}`), t: "table" });
    } else if (b.t === "image") {
      if (++ni > limits.max_images_per_content) bad(`${where}: no máximo ${limits.max_images_per_content} imagens.`, 422);
      if (!/^[A-Za-z0-9_-]{16,40}$/.test(String(b.uid || ""))) bad(`${where}: imagem inválida.`, 422);
      const img = { t: "image", uid: b.uid };
      for (const k of ["w", "h"]) if (Number.isInteger(b[k]) && b[k] > 0 && b[k] <= 10000) img[k] = b[k];
      out.push(img);
    } else bad(`${where}: tipo de bloco não permitido.`, 422);
  }
  if (total > limits.max_text_chars) bad(`${where}: texto total acima do limite.`, 422);
  if (required && !out.length) bad(`${where}: preenchimento obrigatório.`, 422);
  return { v: 1, blocks: out };
}
export function contentToText(c) {
  if (!c) return "";
  return (c.blocks || []).map((b) => (b.t === "text" ? b.md : b.t === "image" ? "[Imagem]" : "[Tabela] " + (b.columns || []).map((x) => x.label).join(" | "))).join("\n");
}
export function preview(c, n = 110) {
  for (const b of (c || {}).blocks || []) {
    if (b.t === "text") {
      const t = b.md.replace(/\*/g, "").replace(/__/g, "").split(/\s+/).join(" ").trim();
      return t.length > n ? t.slice(0, n) + "…" : t;
    }
  }
  return "";
}
export function text(value, label, required = true, max = 4000) {
  const v = String(value || "").trim();
  if (!v) { if (required) bad(`${label} é obrigatório(a).`); return null; }
  if (v.length > max) bad(`${label}: máximo de ${max} caracteres (informado: ${v.length}).`);
  return checkText(v, label, max);
}

// ---------------------------------------------------------------- permissões
export function canView(db, u, d) {
  if (u.is_admin || [d.creator_id, d.assignee_id].includes(u.id)) return true;
  if ((d.watchers || []).some((w) => w.user_id === u.id)) return true;
  const managed = managedSectorIds(db, u);
  if (!managed.size) return false;
  if (managed.has(d.origin_sector_id) || managed.has(d.dest_sector_id)) return true;
  return (d.periods || []).some((p) => managed.has(p.sector_id));
}
export function demandPermissions(db, u, d) {
  const managed = managedSectorIds(db, u);
  const pending = d.status === STATUS_ABERTA;
  const mgrDest = u.is_admin || managed.has(d.dest_sector_id);
  const mgrOrigin = u.is_admin || managed.has(d.origin_sector_id);
  const isAssignee = d.assignee_id === u.id, isCreator = d.creator_id === u.id;
  const work = pending && (isAssignee || mgrDest);
  return {
    view: true, comment: true, transfer: work, complete: work,
    confirm: d.status === STATUS_CONFIRMACAO && (isCreator || !!u.is_admin),
    change_due: pending && (isCreator || mgrDest),
    edit_request: pending && (isCreator || mgrOrigin),
    cancel: OPEN_STATUSES.includes(d.status) && (isCreator || mgrOrigin || mgrDest),
    reopen: d.status === STATUS_CONCLUIDA && (isCreator || mgrOrigin || mgrDest),
    manage_watchers: isCreator || isAssignee || mgrOrigin || mgrDest,
    edit_tables: OPEN_STATUSES.includes(d.status) && (isCreator || isAssignee || mgrOrigin || mgrDest),
  };
}
export function requirePerm(db, u, d, perm, msg) {
  if (!demandPermissions(db, u, d)[perm]) bad(msg || "Você não tem permissão para esta ação nesta demanda.", 403);
}

// ---------------------------------------------------------------- operações sobre o documento da demanda
const nextId = (arr) => (arr.length ? Math.max(...arr.map((x) => x.id || 0)) + 1 : 1);
export function addEvent(d, type, actor, data = {}, now = nowIso()) {
  d.events = d.events || [];
  d.events.push({ id: nextId(d.events), type, actor_id: actor ? actor.id : null, at: now, data });
}
export const currentAssignment = (d) => [...(d.assignments || [])].reverse().find((a) => !a.ended_at) || null;
export const currentPeriod = (d) => [...(d.periods || [])].reverse().find((p) => !p.ended_at) || null;
function touch(d, now) { d.updated_at = now; d.version = (d.version || 0) + 1; }
function checkVersion(d, version) {
  if (version !== undefined && version !== null && Number(version) !== d.version) {
    bad("Esta demanda foi alterada por outra pessoa enquanto você editava. Recarregue para ver a versão atual; suas alterações não foram aplicadas.", 409);
  }
}
export function resolveAssignee(db, sector, userId) {
  if (!sector || sector.active === false) bad(`O setor ${sector ? sector.name : ""} está desativado ou não existe.`);
  if (userId) {
    const u = db.users.get(Number(userId));
    if (!u || !u.is_active) bad("Responsável inválido ou com conta desativada.");
    if (!memberSectorIds(db, u).has(sector.id)) bad(`${u.full_name} não pertence ao setor ${sector.name}.`);
    return [u, false];
  }
  if (!sector.primary_manager_id) bad(`O setor ${sector.name} ainda não tem gerente principal. Escolha uma pessoa ou peça ao administrador para definir em Administração › Setores.`, 409);
  const u = db.users.get(sector.primary_manager_id);
  if (!u || !u.is_active || !memberSectorIds(db, u).has(sector.id)) bad(`O gerente principal de ${sector.name} está inativo ou sem vínculo com o setor.`, 409);
  return [u, true];
}
function openPeriod(d, sectorId, actor, reason, now) {
  d.periods = d.periods || [];
  const p = { id: nextId(d.periods), sector_id: sectorId, started_at: now, ended_at: null, forwarded_by_id: actor.id, reason,
    arrived_overdue: localDate(now) > d.due_date, due_date_at_entry: d.due_date };
  d.periods.push(p);
  return p;
}
function openAssignment(d, p, user, actor, kind, reason, now, fallback) {
  d.assignments = d.assignments || [];
  const a = { id: nextId(d.assignments), period_id: p.id, sector_id: p.sector_id, user_id: user.id, kind, started_at: now, ended_at: null,
    end_reason: null, assigned_by_id: actor.id, reason, fallback, viewed_at: user.id === actor.id ? now : null };
  d.assignments.push(a);
  return a;
}
function closeCurrent(d, now, reason, closePeriod) {
  const a = currentAssignment(d);
  if (a) { a.ended_at = now; a.end_reason = reason; }
  if (closePeriod) { const p = currentPeriod(d); if (p) p.ended_at = now; }
}

export function buildDemand(db, actor, data, id, code, now = nowIso()) {
  const limits = conf(db, "limits");
  const title = text(data.title, "Título", true, 200);
  const description = validateContent(data.description, limits, "Descrição", true);
  const origin = sectorById(db, data.origin_sector_id), dest = sectorById(db, data.dest_sector_id);
  if (!origin || origin.active === false) bad("Setor de origem obrigatório.");
  if (!dest || dest.active === false) bad("Setor de destino obrigatório.");
  if (!actor.is_admin && !memberSectorIds(db, actor).has(origin.id)) bad("O setor de origem deve ser um dos seus setores.");
  const due = data.due_date;
  if (!due) bad("Prazo é obrigatório.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) bad("Prazo inválido.");
  if (due < todayLocal(now)) bad("O prazo não pode ser anterior a hoje.");
  const priority = data.priority || "normal";
  if (!PRIORITIES.includes(priority)) bad("Prioridade inválida.");
  const just = text(data.priority_justification, "Justificativa da urgência", priority === "urgente", 2000);
  const source = text(data.request_source, "Pedido feito em / por", false, 120);
  const [assignee, fallback] = resolveAssignee(db, dest, data.assignee_id);
  const d = {
    id, code, title, description, creator_id: actor.id, origin_sector_id: origin.id, dest_sector_id: dest.id, assignee_id: assignee.id,
    due_date: due, original_due_date: due, priority, priority_justification: priority === "urgente" ? just : null, status: STATUS_ABERTA,
    resolution: null, request_source: source, resolved_at: null, resolved_by_id: null, created_at: now, updated_at: now,
    completed_at: null, cancelled_at: null, version: 1, periods: [], assignments: [], events: [], watchers: [], tables: [],
  };
  const p = openPeriod(d, dest.id, actor, "Abertura da demanda", now);
  openAssignment(d, p, assignee, actor, "inicial", null, now, fallback);
  addEvent(d, "criada", actor, { origin: origin.name, dest: dest.name, due_date: due, priority, request_source: source }, now);
  addEvent(d, "atribuida", actor, { to_user: assignee.full_name, to_user_id: assignee.id, sector: dest.name, fallback_primary: fallback }, now);
  for (const wid of data.watcher_ids || []) {
    const w = db.users.get(Number(wid));
    if (w && w.is_active && w.id !== actor.id && w.id !== assignee.id) d.watchers.push({ user_id: w.id, added_by_id: actor.id, added_at: now });
  }
  return d;
}

export function opTransfer(db, actor, d, { sector_id, user_id, reason, version }, skipPerm = false, now = nowIso()) {
  if (!skipPerm) requirePerm(db, actor, d, "transfer", "Você não pode encaminhar esta demanda.");
  if (d.status !== STATUS_ABERTA) bad("Somente demandas pendentes podem ser encaminhadas.");
  checkVersion(d, version);
  reason = text(reason, "Motivo do encaminhamento", true, 2000);
  const sector = sectorById(db, sector_id);
  if (!sector) bad("Setor de destino obrigatório.");
  const [nu, fallback] = resolveAssignee(db, sector, user_id);
  if (nu.id === d.assignee_id && sector.id === d.dest_sector_id) bad("A demanda já está com esta pessoa neste setor.");
  const internal = sector.id === d.dest_sector_id;
  const oldSector = sectorById(db, d.dest_sector_id), oldUser = db.users.get(d.assignee_id);
  closeCurrent(d, now, "transferida", !internal);
  const p = internal ? currentPeriod(d) || openPeriod(d, sector.id, actor, reason, now) : openPeriod(d, sector.id, actor, reason, now);
  openAssignment(d, p, nu, actor, internal ? "troca_interna" : "transferencia", reason, now, fallback);
  d.dest_sector_id = sector.id; d.assignee_id = nu.id;
  touch(d, now);
  addEvent(d, "transferida", actor, { from_sector: oldSector ? oldSector.name : "?", to_sector: sector.name, from_user: oldUser ? oldUser.full_name : "?",
    to_user: nu.full_name, to_user_id: nu.id, reason, internal, fallback_primary: fallback, arrived_overdue: internal ? null : p.arrived_overdue, due_date: d.due_date }, now);
  return d;
}
export function opChangeDue(db, actor, d, { due_date, justification, version }, now = nowIso()) {
  requirePerm(db, actor, d, "change_due", "Somente quem criou, o administrador ou gestores do setor responsável podem alterar o prazo.");
  checkVersion(d, version);
  const just = text(justification, "Justificativa da alteração de prazo", true, 2000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due_date || "")) bad("Prazo inválido.");
  if (due_date === d.due_date) bad("O novo prazo é igual ao atual.");
  const old = d.due_date;
  d.due_date = due_date;
  touch(d, now);
  addEvent(d, "prazo_alterado", actor, { old, new: due_date, justification: just }, now);
  return d;
}
export function opEdit(db, actor, d, data, now = nowIso()) {
  requirePerm(db, actor, d, "edit_request", "Somente quem criou, gestores do setor de origem ou o administrador podem alterar o pedido.");
  checkVersion(d, data.version);
  const changes = {};
  if (data.title !== undefined && data.title !== null) {
    const t = text(data.title, "Título", true, 200);
    if (t !== d.title) { changes.title = { old: d.title, new: t }; d.title = t; }
  }
  if (data.description !== undefined && data.description !== null) {
    const desc = validateContent(data.description, conf(db, "limits"), "Descrição", true);
    if (JSON.stringify(desc) !== JSON.stringify(d.description)) { changes.description = { changed: true }; d.description = desc; }
  }
  if (data.priority) {
    if (!PRIORITIES.includes(data.priority)) bad("Prioridade inválida.");
    const just = text(data.priority_justification, "Justificativa da urgência", data.priority === "urgente", 2000);
    if (data.priority !== d.priority || (data.priority === "urgente" && just !== d.priority_justification)) {
      changes.priority = { old: d.priority, new: data.priority, justification: just };
      d.priority = data.priority; d.priority_justification = data.priority === "urgente" ? just : null;
    }
  }
  if (data.request_source !== undefined && data.request_source !== null) {
    const src = text(data.request_source, "Pedido feito em / por", false, 120);
    if (src !== d.request_source) { changes.request_source = { old: d.request_source, new: src }; d.request_source = src; }
  }
  if (!Object.keys(changes).length) bad("Nenhuma alteração informada.");
  touch(d, now);
  addEvent(d, "pedido_alterado", actor, changes, now);
  return d;
}
export function opComplete(db, actor, d, { resolution }, now = nowIso()) {
  requirePerm(db, actor, d, "complete", "Somente o responsável, gestores do setor responsável ou o administrador podem concluir.");
  const res = text(resolution, "Descrição da solução", true, 8000);
  closeCurrent(d, now, "concluida", true);
  const onTime = localDate(now) <= d.due_date;
  d.resolution = res; d.resolved_at = now; d.resolved_by_id = actor.id;
  const direct = actor.id === d.creator_id || d.creator_id === d.assignee_id;
  if (direct) { d.status = STATUS_CONCLUIDA; d.completed_at = now; } else d.status = STATUS_CONFIRMACAO;
  touch(d, now);
  addEvent(d, direct ? "concluida" : "resolvida", actor, { resolution: res, due_date: d.due_date, original_due_date: d.original_due_date, on_time: onTime }, now);
  return d;
}
export function opConfirm(db, actor, d, _b, now = nowIso()) {
  requirePerm(db, actor, d, "confirm", "Somente quem criou a demanda (ou o administrador) confirma a conclusão.");
  d.status = STATUS_CONCLUIDA; d.completed_at = now;
  touch(d, now);
  addEvent(d, "conclusao_confirmada", actor, { resolution: d.resolution }, now);
  return d;
}
function restart(db, actor, d, why, label, now) {
  const sector = sectorById(db, d.dest_sector_id);
  let assignee, fallback;
  try { [assignee, fallback] = resolveAssignee(db, sector, d.resolved_by_id || d.assignee_id); }
  catch (_) {
    try { [assignee, fallback] = resolveAssignee(db, sector, d.assignee_id); }
    catch (__) { [assignee, fallback] = resolveAssignee(db, sector, null); }
  }
  d.status = STATUS_ABERTA; d.completed_at = null; d.resolved_at = null; d.resolved_by_id = null; d.resolution = null;
  d.assignee_id = assignee.id;
  const p = openPeriod(d, sector.id, actor, `${label}: ${why}`, now);
  openAssignment(d, p, assignee, actor, "reabertura", why, now, fallback);
  touch(d, now);
}
export function opSendBack(db, actor, d, { reason }, now = nowIso()) {
  requirePerm(db, actor, d, "confirm", "Somente quem criou a demanda (ou o administrador) pode devolver.");
  const why = text(reason, "Motivo da devolução", true, 4000);
  addEvent(d, "devolvida", actor, { reason: why, previous_resolution: d.resolution }, now);
  restart(db, actor, d, why, "Devolvida", now);
  return d;
}
export function opReopen(db, actor, d, { reason }, now = nowIso()) {
  requirePerm(db, actor, d, "reopen", "Somente quem criou, gestores envolvidos ou o administrador podem reabrir.");
  const why = text(reason, "Motivo da reabertura", true, 4000);
  addEvent(d, "reaberta", actor, { reason: why, previous_resolution: d.resolution, previous_completed_at: d.completed_at }, now);
  restart(db, actor, d, why, "Reabertura", now);
  return d;
}
export function opCancel(db, actor, d, { reason }, now = nowIso()) {
  requirePerm(db, actor, d, "cancel", "Somente quem criou, gestores envolvidos ou o administrador podem cancelar.");
  const why = text(reason, "Justificativa do cancelamento", true, 4000);
  closeCurrent(d, now, "cancelada", true);
  const old = d.status;
  d.status = STATUS_CANCELADA; d.cancelled_at = now;
  touch(d, now);
  addEvent(d, "cancelada", actor, { reason: why, old_status: old }, now);
  return d;
}
export function opWatcher(db, actor, d, userId, add, now = nowIso()) {
  requirePerm(db, actor, d, "manage_watchers");
  const u = db.users.get(Number(userId));
  if (!u || !u.is_active) bad("Pessoa inválida.");
  d.watchers = d.watchers || [];
  const has = d.watchers.some((w) => w.user_id === u.id);
  if (add && !has) { d.watchers.push({ user_id: u.id, added_by_id: actor.id, added_at: now }); addEvent(d, "acompanhante_incluido", actor, { user: u.full_name }, now); }
  if (!add && has) { d.watchers = d.watchers.filter((w) => w.user_id !== u.id); addEvent(d, "acompanhante_removido", actor, { user: u.full_name }, now); }
  touch(d, now);
  return d;
}
function tableDiff(old, nw) {
  const diff = {};
  const ol = old.columns.map((c) => c.label), nl = nw.columns.map((c) => c.label);
  if (JSON.stringify(ol) !== JSON.stringify(nl) || JSON.stringify(old.columns.map((c) => c.type)) !== JSON.stringify(nw.columns.map((c) => c.type))) diff.columns = { old: ol, new: nl };
  if (nw.rows.length > old.rows.length) diff.rows_added = nw.rows.length - old.rows.length;
  if (nw.rows.length < old.rows.length) diff.rows_removed = old.rows.length - nw.rows.length;
  const cells = [];
  for (let r = 0; r < Math.min(old.rows.length, nw.rows.length); r++) {
    nl.forEach((label, ci) => {
      const oi = ol.indexOf(label);
      const ov = oi >= 0 ? old.rows[r][oi] : null, nv = nw.rows[r][ci];
      if (ov !== nv) cells.push([r + 1, label, ov, nv]);
    });
  }
  if (cells.length) { diff.cells = cells.slice(0, 200); diff.cells_total = cells.length; }
  return diff;
}
export function opCreateTable(db, actor, d, { title, data }, now = nowIso()) {
  requirePerm(db, actor, d, "edit_tables", "Você não pode editar tabelas de acompanhamento desta demanda.");
  title = text(title, "Título da tabela", true, 160);
  const clean = validateTable(data, conf(db, "limits"), "Tabela de acompanhamento");
  d.tables = d.tables || [];
  d.tables.push({ id: nextId(d.tables), title, data: clean, version: 1, created_by_id: actor.id, created_at: now, updated_at: now, updated_by_id: actor.id,
    changes: [{ at: now, user_id: actor.id, version: 1, diff: { created: true } }] });
  addEvent(d, "tabela_criada", actor, { table: title }, now);
  touch(d, now);
  return d;
}
export function opUpdateTable(db, actor, d, tid, { title, data, version }, now = nowIso()) {
  requirePerm(db, actor, d, "edit_tables", "Você não pode editar tabelas de acompanhamento desta demanda.");
  const t = (d.tables || []).find((x) => x.id === Number(tid));
  if (!t) bad("Tabela não encontrada.", 404);
  if (Number(version) !== t.version) bad("A tabela foi alterada por outra pessoa. Revise a versão atual e aplique novamente suas alterações.", 409,
    { message: "A tabela foi alterada por outra pessoa. Revise a versão atual e aplique novamente suas alterações.", current: tableDict(db, t) });
  const clean = validateTable(data, conf(db, "limits"), "Tabela de acompanhamento");
  const diff = tableDiff(t.data, clean);
  if (title && title.trim() && title.trim() !== t.title) { diff.title = { old: t.title, new: title.trim().slice(0, 160) }; t.title = title.trim().slice(0, 160); }
  if (!Object.keys(diff).length) return undefined;
  t.data = clean; t.version++; t.updated_at = now; t.updated_by_id = actor.id;
  t.changes = [...(t.changes || []), { at: now, user_id: actor.id, version: t.version, diff }].slice(-100);
  d.updated_at = now;
  return d;
}
export function tableDict(db, t, withChanges = false) {
  const out = { id: t.id, title: t.title, data: t.data, version: t.version, updated_at: localIso(t.updated_at), updated_by: uref(db, t.updated_by_id) };
  if (withChanges) out.changes = [...(t.changes || [])].reverse().map((c) => ({ at: localIso(c.at), user: uref(db, c.user_id), version: c.version, diff: c.diff }));
  return out;
}

// ---------------------------------------------------------------- apresentação
export function conclusion(d) {
  const when = d.resolved_at || d.completed_at;
  if ([STATUS_CONCLUIDA, STATUS_CONFIRMACAO].includes(d.status) && when) return localDate(when) <= d.due_date ? "no_prazo" : "fora_prazo";
  return null;
}
export function contextLabel(db, d, u, now = nowIso()) {
  if ([STATUS_CONCLUIDA, STATUS_CANCELADA].includes(d.status)) return null;
  if (d.status === STATUS_CONFIRMACAO) return d.creator_id === u.id ? "Aguardando sua confirmação" : `Aguardando confirmação de ${(db.users.get(d.creator_id) || {}).full_name}`;
  if (d.assignee_id === u.id) return "Com você";
  const p = currentPeriod(d);
  const days = p ? Math.floor(secondsBetween(p.started_at, now) / 86400) : 0;
  const s = sectorById(db, d.dest_sector_id);
  return `Com ${s ? s.name : "?"} ${days === 0 ? "desde hoje" : days === 1 ? "há 1 dia" : `há ${days} dias`}`;
}
export function demandSummary(db, d, u, extra = {}) {
  const bands = conf(db, "deadline_bands");
  return {
    id: d.id, code: d.code, title: d.title, origin: sectorRef(sectorById(db, d.origin_sector_id)), dest: sectorRef(sectorById(db, d.dest_sector_id)),
    creator: uref(db, d.creator_id), assignee: uref(db, d.assignee_id), waiting_on: null, due_date: d.due_date,
    deadline: deadlineInfo(d.due_date, d.status, bands), priority: d.priority, status: d.status, status_label: STATUS_LABELS[d.status],
    created_at: localIso(d.created_at), updated_at: localIso(d.updated_at), completed_at: localIso(d.completed_at),
    context_label: contextLabel(db, d, u), request_source: d.request_source, conclusion: conclusion(d), resolved_at: localIso(d.resolved_at),
    ...extra,
  };
}
export function timeline(db, d, now = nowIso()) {
  const totals = new Map();
  const periods = (d.periods || []).map((p) => {
    const secs = secondsBetween(p.started_at, p.ended_at || now);
    const s = sectorById(db, p.sector_id);
    const t = totals.get(p.sector_id) || { sector: sectorRef(s), seconds: 0, periods: 0 };
    t.seconds += secs; t.periods++; totals.set(p.sector_id, t);
    return {
      id: p.id, sector: sectorRef(s), started_at: localIso(p.started_at), ended_at: localIso(p.ended_at), seconds: secs, duration: fmtDuration(secs),
      current: !p.ended_at, forwarded_by: uref(db, p.forwarded_by_id), reason: p.reason, arrived_overdue: p.arrived_overdue,
      assignments: (d.assignments || []).filter((a) => a.period_id === p.id).map((a) => ({
        id: a.id, user: uref(db, a.user_id), kind: a.kind, started_at: localIso(a.started_at), ended_at: localIso(a.ended_at),
        duration: fmtDuration(secondsBetween(a.started_at, a.ended_at || now)), assigned_by: uref(db, a.assigned_by_id), reason: a.reason,
        viewed_at: localIso(a.viewed_at), fallback_primary: a.fallback,
      })),
    };
  });
  const tl = [...totals.values()].map((t) => ({ ...t, duration: fmtDuration(t.seconds) }));
  return { periods, totals: tl, current: periods.find((p) => p.current) || null };
}
