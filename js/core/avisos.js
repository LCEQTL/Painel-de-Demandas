// Regras de aviso (e-mail e Teams via Power Automate; lista para WhatsApp). Roda no GitHub Actions e no navegador (prévia/Excel).
// As regras (quando, para quem e por qual canal) ficam em config.notifications.rules e são editadas em Administração › Avisos.
import {
  conf, rule, todayLocal, localHour, localWeekday, addDays, daysBetween, sectorById, sectorGerente, sectorLideres, currentAssignment, currentPeriod,
  STATUS_ABERTA, STATUS_CONFIRMACAO, secondsBetween, autoConfirmAt, localIso,
} from "./logic.js";

export const PREFIX = "[Painel Demandas]";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const dmh = (iso) => { const l = localIso(iso); return l ? `${l.slice(8, 10)}/${l.slice(5, 7)} às ${l.slice(11, 16)}` : ""; };
const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const first = (n) => String(n || "").split(" ")[0];

export function isWorkTime(cfg, now) {
  const wd = localWeekday(now), h = localHour(now);
  if (cfg.weekdays_only && (wd === 0 || wd === 6)) return false;
  return h >= cfg.work_start && h < cfg.work_end;
}
const isWorkDay = (cfg, date) => { const wd = new Date(date + "T12:00:00Z").getUTCDay(); return !cfg.weekdays_only || (wd !== 0 && wd !== 6); };
// Dia em que sai o aviso "vence em N dias": N dias antes; se cair no fim de semana, no dia útil anterior.
export function warnDate(cfg, due, n) {
  let d = addDays(due, -Math.max(0, n));
  for (let i = 0; i < 7 && !isWorkDay(cfg, d); i++) d = addDays(d, -1);
  return d;
}
const dueWord = (due, today) => { const n = daysBetween(today, due); return n === 0 ? "hoje" : n === 1 ? "amanhã" : n > 1 ? `em ${n} dias (${dm(due)})` : `desde ${dm(due)}`; };

// Link direto para a demanda. A chave vai na consulta (?k=), que o Outlook e o Teams preservam.
export function demandLink(appUrl, key, id) {
  const base = String(appUrl || "").replace(/[#?].*$/, "");
  return `${base}${key ? `?k=${encodeURIComponent(key)}` : ""}#/demandas/${id}`;
}

function userName(db, id) { const u = db.users.get(id); return u ? u.full_name : "?"; }
function secName(db, id) { const s = sectorById(db, id); return s ? s.name : "?"; }

// Destinatários de uma regra para uma demanda.
export function recipients(db, d, to) {
  const ids = new Set();
  for (const k of to || []) {
    if (k === "responsavel") ids.add(d.assignee_id);
    else if (k === "quem_pediu") ids.add(d.creator_id);
    else if (k === "gerente") { const g = sectorGerente(db, d.dest_sector_id); if (g) ids.add(g.id); }
    else if (k === "lideres") for (const l of sectorLideres(db, d.dest_sector_id)) ids.add(l.id);
    else if (k === "gerente_origem") { const g = sectorGerente(db, d.origin_sector_id); if (g) ids.add(g.id); }
    else if (k === "acompanhantes") for (const w of d.watchers || []) ids.add(w.user_id);
    else if (k === "admin") for (const u of db.users.values()) if (u.is_admin) ids.add(u.id);
  }
  return ids;
}

// ---------------------------------------------------------------- resumo diário (também usado no Excel do WhatsApp)
export function digestFor(db, u, now, sinceIso) {
  const today = todayLocal(now);
  const open = [...db.demands.values()].filter((d) => d.status === STATUS_ABERTA);
  const mine = open.filter((d) => d.assignee_id === u.id);
  const late = mine.filter((d) => d.due_date < today).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const soon = mine.filter((d) => d.due_date >= today && daysBetween(today, d.due_date) <= 1);
  const stage = mine.filter((d) => { const p = currentPeriod(d); return p && p.stage_due && p.stage_due <= addDays(today, 1) && !late.includes(d) && !soon.includes(d); });
  const confirm = [...db.demands.values()].filter((d) => d.status === STATUS_CONFIRMACAO && d.creator_id === u.id && d.creator_id !== d.resolved_by_id);
  const since = sinceIso || new Date(new Date(now).getTime() - 86400000).toISOString();
  const arrived = mine.filter((d) => { const a = currentAssignment(d); return a && a.started_at > since && a.assigned_by_id !== u.id; });
  const gerSectors = db.sectors.filter((s) => { const g = sectorGerente(db, s.id); return g && g.id === u.id; }).map((s) => s.id);
  const team = open.filter((d) => gerSectors.includes(d.dest_sector_id) && d.assignee_id !== u.id && d.due_date < today);
  const n = rule(db, "atrasada_dias").n || 5;
  const escalated = u.is_admin ? open.filter((d) => daysBetween(d.due_date, today) >= n) : [];
  return { late, soon, stage, confirm, arrived, team, escalated, today };
}
export function digestCount(g) { return g.late.length + g.soon.length + g.stage.length + g.confirm.length + g.arrived.length + g.team.length + g.escalated.length; }

export function digestLines(db, g) {
  const lines = [];
  for (const d of g.late) lines.push(`• Atrasada: ${d.title} (${d.code}) – venceu ${dm(d.due_date)}`);
  for (const d of g.soon) lines.push(`• Vence ${d.due_date === g.today ? "hoje" : "amanhã"}: ${d.title} (${d.code})`);
  for (const d of g.stage) { const p = currentPeriod(d); lines.push(`• Prazo da etapa ${p.stage_due < g.today ? "vencido em" : "vence"} ${dm(p.stage_due)}: ${d.title} (${d.code})`); }
  for (const d of g.confirm) lines.push(`• Confirme a conclusão: ${d.title} (${d.code})`);
  for (const d of g.arrived) if (!g.late.includes(d) && !g.soon.includes(d)) lines.push(`• Nova: ${d.title} (${d.code}) – prazo ${dm(d.due_date)}`);
  for (const d of g.team) lines.push(`• Equipe – atrasada com ${userName(db, d.assignee_id)}: ${d.title} – venceu ${dm(d.due_date)}`);
  for (const d of g.escalated) lines.push(`• Atrasada há ${daysBetween(d.due_date, g.today)} dias em ${secName(db, d.dest_sector_id)}: ${d.title}`);
  return lines;
}

// ---------------------------------------------------------------- textos de cada tipo de aviso
const KIND = {
  nova: { color: "#2563c9", title: "Chegou para você" },
  nova_urgente: { color: "#b91c1c", title: "Urgente no seu setor" },
  devolvida: { color: "#c2410c", title: "Devolvida para você" },
  reaberta: { color: "#c2410c", title: "Reaberta" },
  confirmar: { color: "#a35a00", title: "Confirme a conclusão" },
  confirmada: { color: "#18794e", title: "Conclusão confirmada" },
  mensagem: { color: "#2563c9", title: "Mensagens novas" },
  lembrete: { color: "#b91c1c", title: "Ainda não aberta" },
  vence: { color: "#c2410c", title: "Prazo vencendo" },
  vencida: { color: "#b91c1c", title: "Venceu sem conclusão" },
  atrasada_dias: { color: "#6d28d9", title: "Continua atrasada" },
  etapa_vence: { color: "#c2410c", title: "Prazo da etapa vencendo" },
  etapa_vencida: { color: "#b91c1c", title: "Prazo da etapa venceu" },
};

function itemExtra(db, it, uid, html = true) {
  const d = it.d;
  const b = (s) => (html ? `<b>${esc(s)}</b>` : s);
  const e = (s) => (html ? esc(s) : s);
  const withWho = d.assignee_id !== uid ? ` Está com ${b(userName(db, d.assignee_id))} (${e(secName(db, d.dest_sector_id))}).` : "";
  switch (it.kind) {
    case "nova": case "nova_urgente": {
      const parts = [];
      if (it.from) parts.push(`De ${b(it.from)}`);
      if (d.request_source) parts.push(`Pedido feito em / por: ${e(d.request_source)}`);
      if (it.reason) parts.push(`Motivo do encaminhamento: ${e(it.reason)}`);
      if (it.stage_due) parts.push(`Prazo desta etapa: ${b(dm(it.stage_due))} (prazo final ${dm(d.due_date)})`);
      if (it.kind === "nova_urgente") parts.push(`Está com ${b(userName(db, d.assignee_id))}`);
      return parts.join(html ? "<br>" : " · ");
    }
    case "devolvida": case "reaberta": return `${e(it.from || "")}: ${e(it.reason || "")}`;
    case "confirmar": return `Concluída por ${b(it.from || "")}. Solução: ${e(d.resolution || "")}${it.auto_at ? `${html ? "<br>" : " · "}Se você não confirmar nem devolver, ela é confirmada automaticamente em ${dmh(it.auto_at)}.` : ""}`;
    case "confirmada": return it.auto ? "Confirmada automaticamente: quem pediu não respondeu no prazo." : `${e(it.from || "")} confirmou a conclusão.`;
    case "mensagem": return `${it.count > 1 ? `${it.count} mensagens novas` : "Mensagem nova"} de ${b(it.from || "")}.`;
    case "lembrete": return `Enviada há ${it.hours}h e ainda não foi aberta por ${b(userName(db, d.assignee_id))}.`;
    case "vence": return `O prazo final vence ${e(dueWord(d.due_date, it.today))}.${withWho}`;
    case "vencida": return `Venceu em ${dm(d.due_date)} e continua pendente.${withWho}`;
    case "atrasada_dias": return `Atrasada há ${daysBetween(d.due_date, it.today)} dias.${withWho}`;
    case "etapa_vence": return `O prazo desta etapa (${e(secName(db, d.dest_sector_id))}) vence ${e(dueWord(it.stage_due, it.today))}. Prazo final: ${dm(d.due_date)}.${withWho}`;
    case "etapa_vencida": return `O prazo desta etapa (${e(secName(db, d.dest_sector_id))}) venceu em ${dm(it.stage_due)}. Prazo final: ${dm(d.due_date)}.${withWho}`;
    default: return "";
  }
}
function itemSubject(it) {
  const d = it.d;
  const tag = d.priority === "urgente" ? "[URGENTE] " : d.priority === "alta" ? "[ALTA] " : "";
  return {
    nova: `${tag}Nova demanda: ${d.title} · prazo ${dm(it.stage_due || d.due_date)}`,
    nova_urgente: `[URGENTE] Nova demanda no seu setor: ${d.title}`,
    devolvida: `${tag}Devolvida para você: ${d.title}`,
    reaberta: `${tag}Reaberta: ${d.title}`,
    confirmar: `Confirme a conclusão: ${d.title}`,
    confirmada: `Conclusão confirmada: ${d.title}`,
    mensagem: `Mensagem nova: ${d.title}`,
    lembrete: `${tag}Ainda não aberta: ${d.title}`,
    vence: `Vence ${dueWord(d.due_date, it.today)}: ${d.title}`,
    vencida: `Atrasada: ${d.title} (venceu ${dm(d.due_date)})`,
    atrasada_dias: `Atrasada há ${daysBetween(d.due_date, it.today)} dias: ${d.title}`,
    etapa_vence: `Prazo da etapa vence ${dueWord(it.stage_due, it.today)}: ${d.title}`,
    etapa_vencida: `Prazo da etapa venceu: ${d.title}`,
  }[it.kind];
}

// ---------------------------------------------------------------- HTML do e-mail
function card(db, d, link, extra, color) {
  const p = currentPeriod(d);
  const stage = d.status === STATUS_ABERTA && p && p.stage_due ? ` · etapa até ${dm(p.stage_due)}` : "";
  return `<tr><td style="padding:0 0 10px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e1e5ee;border-left:4px solid ${color};border-radius:6px;background:#ffffff">
<tr><td style="padding:10px 14px;font:14px Segoe UI,Arial,sans-serif;color:#1f2733">
<div style="font-weight:700;font-size:15px;color:#1f2a5c">${esc(d.title)}</div>
<div style="font-size:12.5px;color:#5f6b7a;margin-top:2px">${esc(d.code)} · ${esc(secName(db, d.dest_sector_id))} · prazo ${dm(d.due_date)}${stage}${d.priority !== "normal" ? ` · <b style="color:${d.priority === "urgente" ? "#b91c1c" : "#b45309"}">${d.priority === "urgente" ? "URGENTE" : "Alta"}</b>` : ""}</div>
${extra ? `<div style="margin-top:6px;font-size:13.5px">${extra}</div>` : ""}
<div style="margin-top:8px"><a href="${esc(link)}" style="display:inline-block;background:#283672;color:#ffffff;text-decoration:none;padding:6px 12px;border-radius:5px;font-size:13px;font-weight:600">Abrir no painel</a></div>
</td></tr></table></td></tr>`;
}
function section(title, color, inner) {
  return `<tr><td style="padding:12px 0 6px;font:700 12px Segoe UI,Arial,sans-serif;letter-spacing:.5px;text-transform:uppercase;color:${color}">${esc(title)}</td></tr>${inner}`;
}
function wrap(intro, inner, footer) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f4f8"><tr><td align="center" style="padding:16px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%">
<tr><td style="background:#1f2733;border-bottom:4px solid #ffc20e;padding:12px 16px;font:700 15px Segoe UI,Arial,sans-serif;color:#ffffff">Painel de Demandas · EQTL PI Sul</td></tr>
<tr><td style="background:#f7f8fb;padding:14px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">
<tr><td style="padding:0 0 8px;font:14px Segoe UI,Arial,sans-serif;color:#1f2733">${intro}</td></tr>${inner}</table></td></tr>
<tr><td style="padding:10px 16px;font:12px Segoe UI,Arial,sans-serif;color:#6b7383">${footer}</td></tr>
</table></td></tr></table>`;
}

function digestSections(db, g, items) {
  const done = new Set(items.map((i) => i.d.id));
  const out = [];
  const add = (title, color, list, extra) => { const l = list.filter((d) => !done.has(d.id)); if (l.length) out.push({ title: `${title} (${l.length})`, color, list: l, extra }); };
  add("Atrasadas com você", "#b91c1c", g.late, (d) => `Venceu em ${dm(d.due_date)}.`);
  add("Vencem hoje ou amanhã", "#c2410c", g.soon);
  add("Prazo da etapa vencendo ou vencido", "#c2410c", g.stage, (d) => `Etapa até ${dm(currentPeriod(d).stage_due)} · prazo final ${dm(d.due_date)}.`);
  add("Esperando sua confirmação", "#a35a00", g.confirm, (d) => `Concluída por ${esc(userName(db, d.resolved_by_id))}.`);
  add("Chegaram desde o último resumo", "#2563c9", g.arrived.filter((d) => !g.late.includes(d) && !g.soon.includes(d)), (d) => (d.request_source ? `Pedido feito em / por: ${esc(d.request_source)}` : ""));
  add("Atrasadas da sua equipe", "#b91c1c", g.team, (d) => `Com ${esc(userName(db, d.assignee_id))}, venceu em ${dm(d.due_date)}.`);
  add("Atrasadas há mais tempo (todos os setores)", "#6d28d9", g.escalated, (d) => `${esc(secName(db, d.dest_sector_id))} · com ${esc(userName(db, d.assignee_id))}`);
  return out;
}
function digestSubject(g, today) {
  const wd = WD[new Date(today + "T12:00:00Z").getUTCDay()];
  const parts = [];
  if (g.late.length) parts.push(`${g.late.length} atrasada(s)`);
  if (g.soon.length) parts.push(`${g.soon.length} vence(m) hoje/amanhã`);
  if (g.stage.length) parts.push(`${g.stage.length} etapa(s) no limite`);
  if (g.confirm.length) parts.push(`${g.confirm.length} para confirmar`);
  if (g.team.length) parts.push(`${g.team.length} atrasada(s) na equipe`);
  if (!parts.length && g.arrived.length) parts.push(`${g.arrived.length} nova(s)`);
  return `Resumo de ${wd} ${dm(today)}${parts.length ? " · " + parts.join(" · ") : ""}`;
}
function subjectFor(items, digest, today) {
  if (digest) return digestSubject(digest, today);
  if (items.length === 1) return itemSubject(items[0]);
  return `${items.length} avisos: ${items[0].d.title} e mais ${items.length - 1}`;
}

export function buildEmail(db, u, items, digest, { appUrl, key, now, testMode }) {
  const link = (d) => demandLink(appUrl, key, d.id);
  const today = todayLocal(now);
  items = items.map((it) => ({ today, ...it }));
  let inner = "";
  const byKind = {};
  for (const it of items) (byKind[it.kind] = byKind[it.kind] || []).push(it);
  for (const k of Object.keys(KIND)) if (byKind[k]) inner += section(KIND[k].title, KIND[k].color, byKind[k].map((it) => card(db, it.d, link(it.d), itemExtra(db, it, u.id), KIND[k].color)).join(""));
  if (digest) for (const s of digestSections(db, digest, items)) inner += section(s.title, s.color, s.list.map((d) => card(db, d, link(d), s.extra ? s.extra(d) : "", s.color)).join(""));
  const intro = digest ? `Bom dia, ${esc(first(u.full_name))}. Este é o seu resumo de hoje.` : `${esc(first(u.full_name))}, há novidades no painel para você.`;
  const footer = `Aviso automático do Painel de Demandas. Não responda este e-mail.${testMode ? ` <b>Modo teste:</b> e-mail original de ${esc(u.full_name)} (${esc(u.email || "sem e-mail")}).` : ""}`;
  return { subject: `${PREFIX} ${testMode ? `[TESTE p/ ${u.full_name}] ` : ""}${subjectFor(items, digest, today)}`, html: wrap(intro, inner, footer) };
}

// Mensagem do Teams (chat com o Flow bot): curta, com link para cada demanda.
export function buildTeams(db, u, items, digest, { appUrl, key, now, testMode }) {
  const link = (d) => demandLink(appUrl, key, d.id);
  const today = todayLocal(now);
  items = items.map((it) => ({ today, ...it }));
  const lines = [];
  const row = (d, txt) => `• <a href="${esc(link(d))}">${esc(d.title)}</a> <span>(${esc(secName(db, d.dest_sector_id))}, prazo ${dm(d.due_date)})</span>${txt ? ` — ${txt}` : ""}`;
  for (const k of Object.keys(KIND)) {
    const l = items.filter((i) => i.kind === k);
    if (!l.length) continue;
    lines.push(`<b>${esc(KIND[k].title)}</b>`);
    for (const it of l.slice(0, 15)) lines.push(row(it.d, itemExtra(db, it, u.id)));
  }
  if (digest) for (const s of digestSections(db, digest, items)) {
    lines.push(`<b>${esc(s.title)}</b>`);
    for (const d of s.list.slice(0, 15)) lines.push(row(d, s.extra ? s.extra(d) : ""));
    if (s.list.length > 15) lines.push(`… e mais ${s.list.length - 15}. Veja no painel.`);
  }
  const head = `<b>${esc(PREFIX)} ${testMode ? `[TESTE p/ ${esc(u.full_name)}] ` : ""}${esc(subjectFor(items, digest, today))}</b>`;
  return [head, ...lines].join("<br>");
}

// ---------------------------------------------------------------- rodada de avisos
// state: { v: 2, ev: {demandId: nº de eventos já vistos}, pend: [{d, i}], msg_at, sent: {chave: iso}, last_digest, last_digest_at, log: [], runs: [] }
// Devolve as notificações (um item por pessoa e canal), o novo estado e as demandas a confirmar automaticamente.
export function computeAvisos(db, prevState, now, opts = {}) {
  const cfg = conf(db, "notifications");
  const isFirst = !prevState;
  const st = prevState ? JSON.parse(JSON.stringify(prevState)) : { v: 2, ev: {}, sent: {}, last_digest: null, last_digest_at: null, log: [] };
  st.v = 2; st.pend = st.pend || []; st.sent = st.sent || {};
  if (!st.msg_at) st.msg_at = now;
  const work = isWorkTime(cfg, now);
  const today = todayLocal(now);
  const anytime = !!cfg.urgent_anytime;
  const per = new Map(); // userId → [{kind, d, ch, ...}]
  const add = (uid, ch, it) => {
    const u = db.users.get(uid);
    if (!u || !u.is_active || !ch.length) return;
    if (!per.has(uid)) per.set(uid, []);
    const list = per.get(uid);
    const same = list.find((x) => x.kind === it.kind && x.d.id === it.d.id);
    if (same) { same.ch = [...new Set([...same.ch, ...ch])]; return; }
    list.push({ ...it, ch: [...ch] });
  };
  // aplica uma regra: destinatários menos quem fez a ação
  const fire = (key, d, it, exclude = []) => {
    const r = rule(db, key);
    if (!r.on) return;
    for (const uid of recipients(db, d, r.to)) if (!exclude.includes(uid)) add(uid, r.ch, { ...it, d });
  };
  const sentKey = (k) => { if (st.sent[k]) return false; st.sent[k] = now; return true; };
  const actorName = (e) => (e.actor_id ? userName(db, e.actor_id) : "Sistema");

  // 1) acontecimentos desde a última rodada (fora do horário, só urgentes; o resto espera o horário comercial)
  const handle = (d, e) => {
    const urgent = d.priority === "urgente";
    if ((e.type === "atribuida" || e.type === "transferida") && e.data.to_user_id && d.status === STATUS_ABERTA && d.assignee_id === e.data.to_user_id) {
      if (e.data.to_user_id !== e.actor_id) fire("nova", d, { kind: "nova", from: actorName(e), reason: e.type === "transferida" ? e.data.reason : null, stage_due: e.data.stage_due || null }, [e.actor_id]);
      if (urgent && !(e.type === "transferida" && e.data.internal)) fire("nova_urgente", d, { kind: "nova_urgente" }, [e.actor_id, d.assignee_id]);
    } else if ((e.type === "devolvida" || e.type === "reaberta") && d.status === STATUS_ABERTA) {
      fire("devolvida", d, { kind: e.type, from: actorName(e), reason: e.data.reason }, [e.actor_id]);
    } else if (e.type === "resolvida" && d.status === STATUS_CONFIRMACAO) {
      fire("confirmar", d, { kind: "confirmar", from: actorName(e), auto_at: autoConfirmAt(db, d) }, [e.actor_id]);
    } else if (e.type === "conclusao_confirmada") {
      fire("confirmada", d, { kind: "confirmada", from: actorName(e), auto: !!e.data.auto }, [e.actor_id]);
    }
  };
  const pending = [];
  for (const p of st.pend) { const d = db.demands.get(p.d); if (d && d.events && d.events[p.i]) pending.push([d, d.events[p.i], p.i]); }
  st.pend = [];
  for (const d of db.demands.values()) {
    const evs = d.events || [];
    const done = isFirst ? evs.length : Math.min(st.ev[d.id] || 0, evs.length);
    for (let i = done; i < evs.length; i++) pending.push([d, evs[i], i]);
    st.ev[d.id] = evs.length;
  }
  const ACTION = new Set(["atribuida", "transferida", "devolvida", "reaberta", "resolvida", "conclusao_confirmada"]);
  for (const [d, e, i] of pending) {
    if (!ACTION.has(e.type)) continue;
    if (secondsBetween(e.at, now) > 4 * 86400) continue; // nada de avisar coisa antiga (4 dias cobre fim de semana e feriado)
    const urgent = d.priority === "urgente" && anytime;
    if (!work && !urgent) { st.pend.push({ d: d.id, i }); continue; }
    handle(d, e);
  }
  // mensagens novas na conversa (só se a regra estiver ligada)
  const rm = rule(db, "mensagem");
  if (rm.on && work) {
    for (const [did, idx] of db.msgIndex || new Map()) {
      const d = db.demands.get(did);
      if (!d) continue;
      const fresh = idx.filter((m) => m.at > st.msg_at && m.at <= now && secondsBetween(m.at, now) < 2 * 86400);
      if (!fresh.length) continue;
      const byAuthor = new Map();
      for (const m of fresh) byAuthor.set(m.authorId, (byAuthor.get(m.authorId) || 0) + 1);
      for (const [aid, count] of byAuthor) fire("mensagem", d, { kind: "mensagem", from: userName(db, aid), count }, [aid]);
    }
    st.msg_at = now;
  } else if (!rm.on) st.msg_at = now;

  // 2) lembretes, prazos e etapas
  for (const d of db.demands.values()) {
    if (d.status !== STATUS_ABERTA) continue;
    const a = currentAssignment(d);
    const urgent = d.priority === "urgente";
    if (a && !a.viewed_at && d.priority !== "normal" && (work || (urgent && anytime))) {
      const key = urgent ? "nao_aberta_urgente" : "nao_aberta_alta";
      const r = rule(db, key);
      const hours = Math.floor(secondsBetween(a.started_at, now) / 3600);
      if (r.on && hours >= r.n && hours < 48 && sentKey(`lemb:${d.id}:${a.id}`)) fire(key, d, { kind: "lembrete", hours });
    }
    if (!work) continue;
    const rv = rule(db, "vence");
    if (rv.on && d.due_date >= today && today >= warnDate(cfg, d.due_date, rv.n) && localHour(now) >= cfg.digest_hour && sentKey(`vence:${d.id}:${d.due_date}`)) fire("vence", d, { kind: "vence", today });
    if (d.due_date < today && sentKey(`atr:${d.id}:${d.due_date}`)) fire("vencida", d, { kind: "vencida", today });
    const ra = rule(db, "atrasada_dias");
    if (ra.on && d.due_date < today && daysBetween(d.due_date, today) >= ra.n && sentKey(`atrN:${d.id}:${d.due_date}:${ra.n}`)) fire("atrasada_dias", d, { kind: "atrasada_dias", today });
    const p = currentPeriod(d);
    if (p && p.stage_due) {
      const re = rule(db, "etapa_vence");
      if (re.on && p.stage_due >= today && today >= warnDate(cfg, p.stage_due, re.n) && localHour(now) >= cfg.digest_hour && p.stage_due !== d.due_date && sentKey(`etv:${d.id}:${p.id}:${p.stage_due}`))
        fire("etapa_vence", d, { kind: "etapa_vence", stage_due: p.stage_due, today });
      if (p.stage_due < today && sentKey(`etx:${d.id}:${p.id}:${p.stage_due}`)) fire("etapa_vencida", d, { kind: "etapa_vencida", stage_due: p.stage_due, today });
    }
  }

  // 3) confirmação automática (quem pediu não confirmou nem devolveu a tempo)
  const autoConfirm = [];
  for (const d of db.demands.values()) { const at = autoConfirmAt(db, d); if (at && at <= now) autoConfirm.push(d.id); }

  // 4) resumo diário (dias úteis, a partir da hora configurada)
  const rd = rule(db, "resumo");
  const digestNow = !opts.noDigest && rd.on && st.last_digest !== today && localHour(now) >= cfg.digest_hour && work;
  const digests = new Map();
  if (digestNow) {
    for (const u of db.users.values()) {
      if (!u.is_active) continue;
      const g = digestFor(db, u, now, st.last_digest_at);
      if (digestCount(g)) digests.set(u.id, g);
    }
    st.last_digest = today;
    st.last_digest_at = now;
  }

  // 5) monta as notificações: por pessoa, separando o que vai por e-mail e o que vai pelo Teams
  const out = [];
  const people = new Set([...per.keys(), ...digests.keys()]);
  const o = { appUrl: opts.appUrl, key: opts.key, now, testMode: !!cfg.test_mode };
  for (const uid of people) {
    const u = db.users.get(uid);
    const items = per.get(uid) || [];
    const g = digests.get(uid) || null;
    const pick = (ch) => ({ items: items.filter((i) => i.ch.includes(ch)), digest: g && rd.ch.includes(ch) ? g : null });
    const em = pick("email"), tm = pick("teams");
    const has = (x) => x.items.length || x.digest;
    const sameSet = (x, y) => x.items.length === y.items.length && x.items.every((i) => y.items.includes(i)) && !!x.digest === !!y.digest;
    const groups = has(em) && has(tm) && sameSet(em, tm) ? [[["email", "teams"], em]] : [has(em) ? [["email"], em] : null, has(tm) ? [["teams"], tm] : null].filter(Boolean);
    const to = cfg.test_mode ? cfg.test_email : u.email;
    for (const [canais, x] of groups) {
      const mail = buildEmail(db, u, x.items, x.digest, o);
      const teams = buildTeams(db, u, x.items, x.digest, o);
      const kinds = [...new Set(x.items.map((i) => i.kind))].concat(x.digest ? ["resumo"] : []);
      const status = !cfg.enabled ? "desligado" : !to ? "sem e-mail" : "enviado";
      st.log = [{ at: now, user_id: uid, name: u.full_name, email: to || null, subject: mail.subject, kinds, canais, status }, ...(st.log || [])].slice(0, 300);
      if (status === "enviado") out.push({ tipo: kinds.join(","), para: to, nome: u.full_name, assunto: mail.subject, mensagem_html: mail.html, mensagem_teams: teams, canais });
    }
  }
  // limpeza das chaves antigas
  const cutoff = new Date(new Date(now).getTime() - 40 * 86400000).toISOString();
  for (const [k, v] of Object.entries(st.sent)) if (v < cutoff) delete st.sent[k];
  st.last_run_at = now;
  st.runs = [{ at: now, notificacoes: out.length, resumo: digestNow, horario: work, autoconfirmadas: autoConfirm.length, pendentes: st.pend.length }, ...(st.runs || [])].slice(0, 50);
  return { emails: out, notifications: out, state: st, digest: digestNow, autoConfirm };
}

export function addDaysLocal(n, now) { return addDays(todayLocal(now), n); }
