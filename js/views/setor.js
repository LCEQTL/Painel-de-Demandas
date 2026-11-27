// Gestão › Demandas do setor: tudo o que o setor enviou, recebeu ou por onde passou.
// Pensado para servir de ata das reuniões: filtra pela origem do pedido (ex.: Comitê de Clientes), imprime e exporta.
import { api, qs, saveFile } from "../api.js";
import { h, clear, icon, fmtDate, fmtDateTime, loading, empty, errorState, field, input, select, subnav, statusBadge, dueCell, sectorChip, personTag, sourceTag, todayBR, STATUS } from "../ui.js";
import { navigate } from "../state.js";
import { GESTAO } from "./team.js";
import { makeXlsx } from "../core/xlsx.js";

const F = { sector_id: "", dir: "todas", status: "abertas", sources: [], q: "", date_from: "", date_to: "" };
const DIRS = [
  { key: "todas", label: "Todas", hint: "Enviadas, recebidas e as que passaram pelo setor" },
  { key: "enviadas", label: "Enviadas pelo setor", hint: "O setor abriu a demanda" },
  { key: "recebidas", label: "Estão no setor", hint: "O setor é o responsável agora" },
  { key: "passaram", label: "Passaram pelo setor", hint: "Estiveram no setor e seguiram adiante" },
];
const STATUSES = [{ value: "abertas", label: "Em aberto" }, { value: "vencidas", label: "Vencidas" }, { value: "aguardando_confirmacao", label: "Aguardando confirmação" },
  { value: "concluida", label: "Concluídas" }, { value: "cancelada", label: "Canceladas" }, { value: "", label: "Todas" }];
const DIR_LABEL = { enviada: "Enviada", recebida: "Recebida", passou: "Passou", interna: "Interna" };

export async function sectorPage(main) {
  const body = h("div");
  const head = h("div", { class: "page-head" }, h("h1", null, "Gestão"));
  main.append(head, subnav(GESTAO, "gestao/setor"), body);
  let res;
  const load = async () => {
    clear(body).appendChild(loading());
    try {
      res = await api.get("/api/setor/demandas" + qs({ sector_id: F.sector_id, dir: F.dir, status: F.status, sources: F.sources.join("|"), q: F.q, date_from: F.date_from, date_to: F.date_to }));
      F.sector_id = String(res.sector.id);
      render();
    } catch (e) { clear(body).appendChild(errorState(e, load)); }
  };
  const render = () => {
    const sec = select(res.sectors.map((s) => ({ value: s.id, label: s.name })), F.sector_id, { "aria-label": "Setor" });
    sec.addEventListener("change", () => { F.sector_id = sec.value; F.sources = []; load(); });
    const status = select(STATUSES, F.status, { "aria-label": "Situação" });
    status.addEventListener("change", () => { F.status = status.value; load(); });
    const q = input({ type: "search", placeholder: "Título ou código…", value: F.q });
    let t; q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { F.q = q.value; load(); }, 350); });
    const df = input({ type: "date", value: F.date_from }), dt = input({ type: "date", value: F.date_to });
    df.addEventListener("change", () => { F.date_from = df.value; load(); }); dt.addEventListener("change", () => { F.date_to = dt.value; load(); });
    const items = res.items;
    const today = todayBR();
    const late = items.filter((d) => d.status === "aberta" && d.due_date < today).length;
    const open = items.filter((d) => ["aberta", "aguardando_confirmacao"].includes(d.status)).length;
    const done = items.filter((d) => d.status === "concluida");
    const doneOk = done.filter((d) => d.conclusion === "no_prazo").length;

    // origens (chips liga/desliga) — o filtro da "ata"
    const srcBox = h("div", { class: "src-chips" },
      h("span", { class: "small muted", style: { marginRight: "4px" } }, "Origem do pedido:"),
      h("button", { type: "button", class: "qf" + (F.sources.length ? "" : " active"), onclick: () => { F.sources = []; load(); } }, "Todas"),
      res.fontes.map((o) => {
        const on = F.sources.includes(o);
        return h("button", { type: "button", class: "qf" + (on ? " active" : ""), "aria-pressed": String(on), onclick: () => { F.sources = on ? F.sources.filter((x) => x !== o) : [...F.sources, o]; load(); } }, o);
      }));

    clear(body).append(
      h("div", { class: "page-head", style: { marginTop: "6px" } },
        h("div", null, h("h2", { class: "row", style: { gap: "8px" } }, icon("minutes", 18), "Demandas do setor"),
          h("div", { class: "small muted" }, "Tudo o que o setor pediu, recebeu ou por onde a demanda passou. Filtre pela origem para usar como ata da reunião.")),
        h("span", { class: "spacer" }),
        res.sectors.length > 1 ? sec : sectorChip(res.sector),
        h("button", { class: "btn", onclick: () => printAta(res, F) }, icon("print", 15), "Imprimir ata"),
        h("button", { class: "btn", onclick: () => exportXlsx(res) }, icon("export", 15), "Excel")),
      h("div", { class: "seg-tabs", role: "tablist" }, DIRS.map((d) => h("button", { type: "button", role: "tab", "aria-selected": String(F.dir === d.key), class: "seg-tab" + (F.dir === d.key ? " on" : ""), title: d.hint, onclick: () => { F.dir = d.key; load(); } }, d.label))),
      h("div", { class: "panel pad stack", style: { gap: "10px" } },
        srcBox,
        h("div", { class: "filterbar", style: { margin: 0 } }, field("Situação", status), field("Criadas de", df), field("até", dt), field("Buscar", q))),
      h("div", { class: "grid4", style: { margin: "12px 0" } },
        mini("Demandas", items.length, ""), mini("Em aberto", open, ""), mini("Vencidas", late, late ? "red" : ""),
        mini("Concluídas no prazo", done.length ? `${Math.round((100 * doneOk) / done.length)}%` : "—", done.length ? "green" : "", done.length ? `${doneOk} de ${done.length}` : "")),
      items.length ? table(items) : h("div", { class: "panel" }, empty("Nenhuma demanda com estes filtros.")));
  };
  await load();
}

function mini(k, v, cls, d) { return h("div", { class: "panel kpi static" }, h("div", { class: "k" }, k), h("div", { class: "v " + cls }, v), d ? h("div", { class: "d" }, d) : null); }

function table(items) {
  return h("div", { class: "panel tablewrap" }, h("table", { class: "dtable ata" },
    h("thead", null, h("tr", null, ["Demanda", "Origem do pedido", "Caminho", "Situação", "Com quem", "Prazo", "Último andamento"].map((x) => h("th", null, x)))),
    h("tbody", null, items.map((d) => h("tr", { class: "click", tabindex: "0", onclick: () => navigate("demandas/" + d.id), onkeydown: (e) => { if (e.key === "Enter") navigate("demandas/" + d.id); } },
      h("td", { class: "c-title" }, h("div", { class: "t" }, d.title), h("div", { class: "code" }, d.code)),
      h("td", null, sourceTag(d.request_source)),
      h("td", null, h("span", { class: `dir dir-${d.direction}` }, DIR_LABEL[d.direction]), " ", h("span", { class: "small muted" }, `${d.origin.acronym} → ${d.dest.acronym}`)),
      h("td", null, statusBadge(d.status)),
      h("td", null, personTag(d.assignee)),
      h("td", null, dueCell(d)),
      h("td", { class: "c-note" }, d.last_note ? h("div", null, h("div", { class: "small" }, d.last_note.text), h("div", { class: "small muted" }, fmtDateTime(d.last_note.at))) : h("span", { class: "muted small" }, "—")))))));
}

function exportXlsx(res) {
  const rows = [["Código", "Demanda", "Origem do pedido", "Setor que pediu", "Setor atual", "Situação", "Responsável", "Prazo final", "Prazo da etapa", "Criada em", "Último andamento", "Solução"],
    ...res.items.map((d) => [d.code, d.title, d.request_source || "", d.origin.name, d.dest.name, STATUS[d.status] || d.status, d.assignee.name, fmtDate(d.due_date),
      d.stage ? fmtDate(d.stage.due) : "", fmtDateTime(d.created_at), d.last_note ? d.last_note.text : "", d.resolution || ""])];
  saveFile(`demandas_${res.sector.acronym}_${todayBR()}.xlsx`, makeXlsx([{ name: "demandas", rows, widths: [26, 40, 24, 18, 18, 20, 24, 12, 12, 17, 60, 50] }]));
}

// Ata: documento limpo para imprimir ou salvar em PDF, agrupado pela origem do pedido.
function printAta(res, F) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const groups = new Map();
  for (const d of res.items) { const k = d.request_source || "(sem origem)"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); }
  const dir = DIRS.find((x) => x.key === F.dir).label, st = STATUSES.find((x) => x.value === F.status).label;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ata – ${esc(res.sector.name)}</title><style>
body{font:12.5px "Segoe UI",Arial,sans-serif;color:#1c2230;margin:28px}h1{font-size:20px;margin:0 0 4px;color:#1f2a5c}.sub{color:#5f6b7a;margin-bottom:18px}
h2{font-size:14px;margin:18px 0 6px;padding:4px 8px;background:#eef2fb;border-left:4px solid #1f2a5c}table{width:100%;border-collapse:collapse}
th,td{text-align:left;vertical-align:top;border-bottom:1px solid #dde1e8;padding:6px 6px}th{font-size:11px;text-transform:uppercase;color:#5f6b7a}
.code{color:#6b7383;font-size:11px}.late{color:#b91c1c;font-weight:600}.foot{margin-top:24px;color:#6b7383;font-size:11px}@page{margin:14mm}</style></head><body>
<h1>Ata · Demandas de ${esc(res.sector.name)}</h1><div class="sub">${esc(dir)} · ${esc(st)}${F.sources.length ? ` · Origem: ${esc(F.sources.join(", "))}` : ""} · gerada em ${esc(fmtDateTime(new Date().toISOString()))} · ${res.items.length} demanda(s)</div>
${[...groups].map(([g, list]) => `<h2>${esc(g)} (${list.length})</h2><table><thead><tr><th style="width:30%">Demanda</th><th>Situação</th><th>Com quem</th><th>Prazo</th><th style="width:34%">Andamento</th></tr></thead><tbody>
${list.map((d) => `<tr><td><b>${esc(d.title)}</b><div class="code">${esc(d.code)} · ${esc(d.origin.acronym)} → ${esc(d.dest.acronym)}</div></td><td>${esc(STATUS[d.status] || d.status)}</td><td>${esc(d.assignee.name)}</td>
<td class="${d.status === "aberta" && d.deadline.level !== "neutral" && d.deadline.days_late ? "late" : ""}">${esc(fmtDate(d.due_date))}${d.status === "aberta" ? `<div class="code">${esc(d.deadline.label)}</div>` : ""}</td>
<td>${d.resolution && d.status !== "aberta" ? `<b>Solução:</b> ${esc(d.resolution)}` : d.last_note ? esc(d.last_note.text) : "—"}</td></tr>`).join("")}</tbody></table>`).join("")}
<div class="foot">Painel de Demandas · EQTL PI SUL</div></body></html>`;
  const fr = document.createElement("iframe");
  fr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(fr);
  fr.contentDocument.open(); fr.contentDocument.write(html); fr.contentDocument.close();
  setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(() => fr.remove(), 1500); }, 250);
}
