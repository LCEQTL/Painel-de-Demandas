// Regras de aviso (e-mail via Power Automate e lista para WhatsApp). Roda no GitHub Actions e no navegador (prévia/Excel).
import {
  conf, todayLocal, localHour, localWeekday, localDate, addDays, daysBetween, sectorById, sectorGerentes, currentAssignment,
  STATUS_ABERTA, STATUS_CONFIRMACAO, secondsBetween,
} from "./logic.js";

export const PREFIX = "[Painel Demandas]";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const first = (n) => String(n || "").split(" ")[0];

export function isWorkTime(cfg, now) {
  const wd = localWeekday(now), h = localHour(now);
  if (cfg.weekdays_only && (wd === 0 || wd === 6)) return false;
  return h >= cfg.work_start && h < cfg.work_end;
}

export function demandLink(appUrl, key, id) {
  const base = String(appUrl || "").replace(/#.*$/, "");
  return `${base}#/demandas/${id}${key ? `?k=${encodeURIComponent(key)}` : ""}`;
}

// ---------------------------------------------------------------- resumo diário (também usado no Excel do WhatsApp)
export function digestFor(db, u, now, sinceIso) {
  const today = todayLocal(now);
  const open = [...db.demands.values()].filter((d) => d.status === STATUS_ABERTA);
  const mine = open.filter((d) => d.assignee_id === u.id);
  const late = mine.filter((d) => d.due_date < today).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const soon = mine.filter((d) => d.due_date >= today && daysBetween(today, d.due_date) <= 1);
  const confirm = [...db.demands.values()].filter((d) => d.status === STATUS_CONFIRMACAO && d.creator_id === u.id && d.creator_id !== d.resolved_by_id);
  const since = sinceIso || new Date(new Date(now).getTime() - 86400000).toISOString();
  const arrived = mine.filter((d) => { const a = currentAssignment(d); return a && a.started_at > since && a.assigned_by_id !== u.id; });
  const gerSectors = db.sectors.filter((s) => sectorGerentes(db, s.id).some((g) => g.id === u.id)).map((s) => s.id);
  const team = open.filter((d) => gerSectors.includes(d.dest_sector_id) && d.assignee_id !== u.id && d.due_date < today);
  const cfg = conf(db, "notifications");
  const escalated = u.is_admin ? open.filter((d) => daysBetween(d.due_date, today) > cfg.escalate_days) : [];
  return { late, soon, confirm, arrived, team, escalated, today };
}
export function digestCount(g) { return g.late.length + g.soon.length + g.confirm.length + g.arrived.length + g.team.length + g.escalated.length; }

function userName(db, id) { const u = db.users.get(id); return u ? u.full_name : "?"; }
function secName(db, id) { const s = sectorById(db, id); return s ? s.name : "?"; }

export function digestLines(db, g) {
  const lines = [];
  for (const d of g.late) lines.push(`• Atrasada: ${d.title} (${d.code}) – venceu ${dm(d.due_date)}`);
  for (const d of g.soon) lines.push(`• Vence ${d.due_date === g.today ? "hoje" : "amanhã"}: ${d.title} (${d.code})`);
  for (const d of g.confirm) lines.push(`• Confirme a conclusão: ${d.title} (${d.code})`);
  for (const d of g.arrived) if (!g.late.includes(d) && !g.soon.includes(d)) lines.push(`• Nova: ${d.title} (${d.code}) – prazo ${dm(d.due_date)}`);
  for (const d of g.team) lines.push(`• Equipe – atrasada com ${userName(db, d.assignee_id)}: ${d.title} – venceu ${dm(d.due_date)}`);
  for (const d of g.escalated) lines.push(`• Atrasada há mais de ${daysBetween(d.due_date, g.today) - 1} dias em ${secName(db, d.dest_sector_id)}: ${d.title}`);
  return lines;
}

// ---------------------------------------------------------------- HTML do e-mail
function card(db, d, link, extra, color) {
  return `<tr><td style="padding:0 0 10px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e1e5ee;border-left:4px solid ${color};border-radius:6px;background:#ffffff">
<tr><td style="padding:10px 14px;font:14px Segoe UI,Arial,sans-serif;color:#1f2733">
<div style="font-weight:700;font-size:15px;color:#1f2a5c">${esc(d.title)}</div>
<div style="font-size:12.5px;color:#5f6b7a;margin-top:2px">${esc(d.code)} · ${esc(secName(db, d.dest_sector_id))} · prazo ${dm(d.due_date)}${d.priority !== "normal" ? ` · <b style="color:${d.priority === "urgente" ? "#b91c1c" : "#b45309"}">${d.priority === "urgente" ? "URGENTE" : "Alta"}</b>` : ""}</div>
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

const KIND = {
  nova: { color: "#2563c9", title: "Chegou para você" },
  nova_gerente: { color: "#b91c1c", title: "Urgente no seu setor" },
  devolvida: { color: "#c2410c", title: "Devolvida para você" },
  reaberta: { color: "#c2410c", title: "Reaberta" },
  confirmar: { color: "#a35a00", title: "Confirme a conclusão" },
  lembrete: { color: "#b91c1c", title: "Ainda não aberta" },
  atrasada: { color: "#b91c1c", title: "Venceu sem conclusão" },
  atrasada_equipe: { color: "#b91c1c", title: "Atrasada na sua equipe" },
};

function itemExtra(db, it) {
  const d = it.d;
  if (it.kind === "nova" || it.kind === "nova_gerente") {
    const parts = [];
    if (it.from) parts.push(`De <b>${esc(it.from)}</b>`);
    if (d.request_source) parts.push(`Pedido feito em / por: ${esc(d.request_source)}`);
    if (it.reason) parts.push(`Motivo do encaminhamento: ${esc(it.reason)}`);
    if (it.kind === "nova_gerente") parts.push(`Está com <b>${esc(userName(db, d.assignee_id))}</b>`);
    return parts.join("<br>");
  }
  if (it.kind === "devolvida" || it.kind === "reaberta") return `${esc(it.from || "")}: ${esc(it.reason || "")}`;
  if (it.kind === "confirmar") return `Concluída por <b>${esc(it.from || "")}</b>. Solução: ${esc(d.resolution || "")}`;
  if (it.kind === "lembrete") return `Enviada há ${it.hours}h e ainda não foi aberta por <b>${esc(userName(db, d.assignee_id))}</b>.`;
  if (it.kind === "atrasada") return `Venceu em ${dm(d.due_date)} e continua pendente com você.`;
  if (it.kind === "atrasada_equipe") return `Venceu em ${dm(d.due_date)} e está com <b>${esc(userName(db, d.assignee_id))}</b>.`;
  return "";
}
function itemSubject(it) {
  const d = it.d;
  const tag = d.priority === "urgente" ? "[URGENTE] " : d.priority === "alta" ? "[ALTA] " : "";
  return {
    nova: `${tag}Nova demanda: ${d.title} · prazo ${dm(d.due_date)}`,
    nova_gerente: `[URGENTE] Nova demanda no seu setor: ${d.title}`,
    devolvida: `${tag}Devolvida para você: ${d.title}`,
    reaberta: `${tag}Reaberta: ${d.title}`,
    confirmar: `Confirme a conclusão: ${d.title}`,
    lembrete: `${tag}Ainda não aberta: ${d.title}`,
    atrasada: `Atrasada: ${d.title} (venceu ${dm(d.due_date)})`,
    atrasada_equipe: `Atrasada na sua equipe: ${d.title}`,
  }[it.kind];
}

export function buildEmail(db, u, items, digest, { appUrl, key, now, testMode }) {
  const link = (d) => demandLink(appUrl, key, d.id);
  let inner = "";
  const byKind = {};
  for (const it of items) (byKind[it.kind] = byKind[it.kind] || []).push(it);
  for (const k of Object.keys(KIND)) if (byKind[k]) inner += section(KIND[k].title, KIND[k].color, byKind[k].map((it) => card(db, it.d, link(it.d), itemExtra(db, it), KIND[k].color)).join(""));
  let subject;
  const today = todayLocal(now);
  const wd = WD[new Date(today + "T12:00:00Z").getUTCDay()];
  if (digest) {
    const g = digest;
    const done = new Set(items.map((i) => i.d.id));
    const add = (title, color, list, extra) => { const l = list.filter((d) => !done.has(d.id)); if (l.length) inner += section(`${title} (${l.length})`, color, l.map((d) => card(db, d, link(d), extra ? extra(d) : "", color)).join("")); };
    add("Atrasadas com você", "#b91c1c", g.late, (d) => `Venceu em ${dm(d.due_date)}.`);
    add("Vencem hoje ou amanhã", "#c2410c", g.soon);
    add("Esperando sua confirmação", "#a35a00", g.confirm, (d) => `Concluída por <b>${esc(userName(db, d.resolved_by_id))}</b>.`);
    add("Chegaram desde o último resumo", "#2563c9", g.arrived.filter((d) => !g.late.includes(d) && !g.soon.includes(d)), (d) => (d.request_source ? `Pedido feito em / por: ${esc(d.request_source)}` : ""));
    add("Atrasadas da sua equipe", "#b91c1c", g.team, (d) => `Com <b>${esc(userName(db, d.assignee_id))}</b>, venceu em ${dm(d.due_date)}.`);
    add(`Atrasadas há mais de ${conf(db, "notifications").escalate_days} dias (todos os setores)`, "#6d28d9", g.escalated, (d) => `${esc(secName(db, d.dest_sector_id))} · com <b>${esc(userName(db, d.assignee_id))}</b>`);
    const parts = [];
    if (g.late.length) parts.push(`${g.late.length} atrasada(s)`);
    if (g.soon.length) parts.push(`${g.soon.length} vence(m) hoje/amanhã`);
    if (g.confirm.length) parts.push(`${g.confirm.length} para confirmar`);
    if (g.team.length) parts.push(`${g.team.length} atrasada(s) na equipe`);
    if (!parts.length && g.arrived.length) parts.push(`${g.arrived.length} nova(s)`);
    subject = `Resumo de ${wd} ${dm(today)}${parts.length ? " · " + parts.join(" · ") : ""}`;
  } else if (items.length === 1) subject = itemSubject(items[0]);
  else subject = `${items.length} avisos: ${items[0].d.title} e mais ${items.length - 1}`;
  const intro = digest ? `Bom dia, ${esc(first(u.full_name))}. Este é o seu resumo de hoje.` : `${esc(first(u.full_name))}, há novidades no painel para você.`;
  const footer = `Aviso automático do Painel de Demandas. Não responda este e-mail.${testMode ? ` <b>Modo teste:</b> e-mail original de ${esc(u.full_name)} (${esc(u.email || "sem e-mail")}).` : ""}`;
  return { subject: `${PREFIX} ${testMode ? `[TESTE p/ ${u.full_name}] ` : ""}${subject}`, html: wrap(intro, inner, footer) };
}

// ---------------------------------------------------------------- rodada de avisos
// state: { v, ev: {demandId: nº de eventos já processados}, sent: {chave: iso}, last_digest, last_digest_at, log: [] }
export function computeAvisos(db, prevState, now, opts = {}) {
  const cfg = conf(db, "notifications");
  const first = !prevState;
  const st = prevState ? JSON.parse(JSON.stringify(prevState)) : { v: 1, ev: {}, sent: {}, last_digest: null, last_digest_at: null, log: [] };
  const work = isWorkTime(cfg, now);
  const today = todayLocal(now);
  const per = new Map(); // userId → items
  const add = (uid, it) => {
    const u = db.users.get(uid);
    if (!u || !u.is_active) return;
    if (!per.has(uid)) per.set(uid, []);
    const list = per.get(uid);
    if (!list.some((x) => x.kind === it.kind && x.d.id === it.d.id)) list.push(it);
  };
  const sentKey = (k) => { if (st.sent[k]) return false; st.sent[k] = now; return true; };
  const actorName = (e) => (e.actor_id ? userName(db, e.actor_id) : "");

  // 1) acontecimentos desde a última rodada
  for (const d of db.demands.values()) {
    const evs = d.events || [];
    const done = first ? evs.length : st.ev[d.id] || 0;
    st.ev[d.id] = evs.length;
    for (const e of evs.slice(done)) {
      if (secondsBetween(e.at, now) > 2 * 86400) continue; // nada de avisar coisa antiga
      const urgent = d.priority === "urgente";
      if (!work && !urgent) continue; // fora do horário: vai no resumo das 8h
      if ((e.type === "atribuida" || e.type === "transferida") && e.data.to_user_id && e.data.to_user_id !== e.actor_id && d.assignee_id === e.data.to_user_id && d.status === STATUS_ABERTA) {
        add(e.data.to_user_id, { kind: "nova", d, from: actorName(e), reason: e.type === "transferida" ? e.data.reason : null });
        if (urgent) for (const g of sectorGerentes(db, d.dest_sector_id)) if (g.id !== e.data.to_user_id && g.id !== e.actor_id) add(g.id, { kind: "nova_gerente", d });
      } else if ((e.type === "devolvida" || e.type === "reaberta") && d.status === STATUS_ABERTA && d.assignee_id !== e.actor_id) {
        add(d.assignee_id, { kind: e.type, d, from: actorName(e), reason: e.data.reason });
      } else if (e.type === "resolvida" && d.status === STATUS_CONFIRMACAO && d.creator_id !== e.actor_id) {
        add(d.creator_id, { kind: "confirmar", d, from: actorName(e) });
      }
    }
  }

  // 2) lembretes de alta/urgente não abertas e 3) cobrança no 1º dia de atraso
  for (const d of db.demands.values()) {
    if (d.status !== STATUS_ABERTA) continue;
    const a = currentAssignment(d);
    const urgent = d.priority === "urgente";
    if (a && !a.viewed_at && d.priority !== "normal" && (work || urgent)) {
      const hours = Math.floor(secondsBetween(a.started_at, now) / 3600);
      const limit = urgent ? cfg.remind_urgente_hours : cfg.remind_alta_hours;
      if (hours >= limit && hours < 48 && sentKey(`lemb:${d.id}:${a.id}`)) {
        add(d.assignee_id, { kind: "lembrete", d, hours });
        if (urgent) for (const g of sectorGerentes(db, d.dest_sector_id)) if (g.id !== d.assignee_id) add(g.id, { kind: "lembrete", d, hours });
      }
    }
    if (work && d.due_date < today && sentKey(`atr:${d.id}:${d.due_date}`)) {
      add(d.assignee_id, { kind: "atrasada", d });
      for (const g of sectorGerentes(db, d.dest_sector_id)) if (g.id !== d.assignee_id) add(g.id, { kind: "atrasada_equipe", d });
    }
  }

  // 4) resumo das 8h (dias úteis)
  const digestNow = !opts.noDigest && st.last_digest !== today && localHour(now) >= cfg.digest_hour && isWorkTime(cfg, now);
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

  // monta um e-mail por pessoa
  const emails = [];
  const people = new Set([...per.keys(), ...digests.keys()]);
  for (const uid of people) {
    const u = db.users.get(uid);
    const items = per.get(uid) || [];
    const g = digests.get(uid) || null;
    const to = cfg.test_mode ? cfg.test_email : u.email;
    const mail = buildEmail(db, u, items, g, { appUrl: opts.appUrl, key: opts.key, now, testMode: !!cfg.test_mode });
    const rec = { at: now, user_id: uid, name: u.full_name, email: to || null, subject: mail.subject, kinds: [...new Set(items.map((i) => i.kind))].concat(g ? ["resumo"] : []), status: to && cfg.enabled ? "enviado" : !cfg.enabled ? "desligado" : "sem e-mail" };
    st.log = [rec, ...(st.log || [])].slice(0, 300);
    if (to && cfg.enabled) emails.push({ tipo: rec.kinds.join(","), para: to, nome: u.full_name, assunto: mail.subject, mensagem_html: mail.html });
  }
  // limpeza das chaves antigas
  const cutoff = new Date(new Date(now).getTime() - 40 * 86400000).toISOString();
  for (const [k, v] of Object.entries(st.sent)) if (v < cutoff) delete st.sent[k];
  return { emails, state: st, digest: digestNow };
}

export function addDaysLocal(n, now) { return addDays(todayLocal(now), n); }
export { localDate };
