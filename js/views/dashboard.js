// Painel gerencial (gestores: escopo dos próprios setores; admin: todas as demandas corporativas).
import { api, qs } from "../api.js";
import { h, clear, icon, fmtDate, todayBR, addDays, loading, empty, errorState, field, input, select, subnav, PRIORITY, STATUS } from "../ui.js";
import { state, isAdmin } from "../state.js";
import { demandRows } from "./demands.js";
import { GESTAO } from "./team.js";

const F = { period: "30", date_from: "", date_to: "", origin_id: "", dest_id: "", assignee_id: "", priority: "", status: "" };
let metric = null;

const METRIC_LABEL = {
  abertas: "Abertas (estoque atual)", vencidas: "Vencidas (estoque atual)", vencendo: "Vencendo (estoque atual)", entradas: "Entradas no período",
  concluidas: "Concluídas no período", dentro_prazo: "Concluídas dentro do prazo", fora_prazo: "Concluídas fora do prazo",
  prazo_alterado: "Concluídas com prazo alterado", chegaram_vencidas: "Chegaram vencidas a um setor",
};

function periodDates() {
  const today = todayBR();
  if (F.period === "custom") return { date_from: F.date_from, date_to: F.date_to };
  return { date_from: addDays(today, -(Number(F.period) - 1)), date_to: today };
}

export async function dashboardPage(main) {
  const body = h("div");
  const sectorOpts = [{ value: "", label: "Todos" }, ...state.sectors.map((s) => ({ value: s.id, label: s.name }))];
  const period = select([{ value: "7", label: "Últimos 7 dias" }, { value: "30", label: "Últimos 30 dias" }, { value: "90", label: "Últimos 90 dias" }, { value: "365", label: "Últimos 12 meses" }, { value: "custom", label: "Personalizado" }], F.period);
  const dfrom = input({ type: "date", value: F.date_from }), dto = input({ type: "date", value: F.date_to });
  const custom = h("div", { class: "grid2" + (F.period === "custom" ? "" : " hidden") }, field("De", dfrom), field("Até", dto));
  const origin = select(sectorOpts, F.origin_id), dest = select(sectorOpts, F.dest_id);
  const prio = select([{ value: "", label: "Todas" }, ...Object.entries(PRIORITY).map(([k, v]) => ({ value: k, label: v }))], F.priority);
  const status = select([{ value: "", label: "Todos" }, ...Object.entries(STATUS).map(([k, v]) => ({ value: k, label: v }))], F.status);
  const load = async () => {
    clear(body).appendChild(loading());
    const pd = periodDates();
    const params = { ...pd, origin_id: F.origin_id, dest_id: F.dest_id, priority: F.priority, status: F.status };
    try {
      if (metric) {
        // Lista de um indicador: substitui a visão geral, com caminho claro de volta.
        const m = metric;
        const res = await api.get("/api/dashboard/list" + qs({ ...params, metric: m.key, sector_id: m.sector_id }));
        clear(body).append(
          h("button", { class: "backlink linkbtn", style: { textDecoration: "none" }, onclick: () => { metric = null; load(); } }, icon("back", 14), "Voltar aos indicadores"),
          h("div", { class: "row", style: { margin: "4px 0 10px" } }, h("h2", null, METRIC_LABEL[m.key] + (m.sectorName ? ` · ${m.sectorName}` : "")),
            h("span", { class: "badge b-neutral" }, res.items.length)),
          res.items.length ? demandRows(res.items, { tab: "todas" }) : h("div", { class: "panel" }, empty("Nenhuma demanda neste indicador.")));
        return;
      }
      const d = await api.get("/api/dashboard" + qs(params));
      clear(body).appendChild(overview(d, (key, extra = {}) => { metric = { key, ...extra }; load(); window.scrollTo(0, 0); }));
    } catch (e) { clear(body).appendChild(errorState(e, load)); }
  };
  period.addEventListener("change", () => { F.period = period.value; custom.classList.toggle("hidden", F.period !== "custom"); if (F.period !== "custom") load(); });
  for (const [el, k] of [[dfrom, "date_from"], [dto, "date_to"], [origin, "origin_id"], [dest, "dest_id"], [prio, "priority"], [status, "status"]]) {
    el.addEventListener("change", () => { F[k] = el.value; if (F.period !== "custom" || (F.date_from && F.date_to)) load(); });
  }
  metric = null;
  main.append(
    h("div", { class: "page-head" }, h("h1", null, "Gestão")),
    subnav(GESTAO, "gestao/indicadores"),
    h("div", { class: "filterbar" }, field("Período", period), field("Origem", origin), field("Setor atual", dest), field("Prioridade", prio), field("Status", status)),
    custom,
    body);
  await load();
}

function kpi(label, value, desc, cls, onClick) {
  return h("button", { class: "panel kpi", type: "button", onclick: onClick, title: "Ver a lista" }, h("div", { class: "k" }, label), h("div", { class: "v " + (cls || "") }, value ?? "—"), desc ? h("div", { class: "d" }, desc) : null);
}

function overview(d, open) {
  const p = d.period, s = d.stock;
  const ta = p.tempo_atendimento;
  const maxDays = Math.max(1, ...d.sectors.map((x) => x.mean_days));
  return h("div", { class: "stack" },
    h("div", { class: "small muted" }, `Período: ${fmtDate(d.filters.date_from)} a ${fmtDate(d.filters.date_to)} · Escopo: ${d.scope}`),
    h("div", { class: "small", style: { fontWeight: 600 } }, "Estoque atual (independe do período)"),
    h("div", { class: "grid4" },
      kpi("Abertas", s.abertas, "Situação agora", "", () => open("abertas")),
      kpi("Vencidas", s.vencidas, "Abertas com prazo vencido", "red", () => open("vencidas")),
      kpi("Vencendo", s.vencendo, d.definitions.vencendo, "orange", () => open("vencendo")),
      kpi("Tempo de atendimento", ta.media_dias !== null ? `${ta.media_dias} d` : "—", ta.amostra ? `Média; mediana ${ta.mediana_dias} d (${ta.amostra} concluídas)` : "Sem conclusões no período", "", () => open("concluidas"))),
    h("div", { class: "small", style: { fontWeight: 600 } }, "No período selecionado"),
    h("div", { class: "grid4" },
      kpi("Entradas", p.entradas, "Criadas no período", "", () => open("entradas")),
      kpi("Concluídas", p.concluidas, "Conclusão vigente no período", "green", () => open("concluidas")),
      kpi("Dentro do prazo", p.dentro_prazo, `Fora do prazo: ${p.fora_prazo}`, "green", () => open("dentro_prazo")),
      kpi("Fora do prazo", p.fora_prazo, `Prazo alterado: ${p.prazo_alterado} · cumpririam o original: ${p.dentro_prazo_original} · já reabertas: ${p.reabertas_antes}`, "red", () => open("fora_prazo"))),
    h("div", { class: "split" },
      h("div", { class: "panel pad" }, h("div", { class: "panel-title" }, "Tempo de permanência por setor (média em dias)"),
        h("div", { class: "small muted", style: { marginBottom: "6px" } }, d.definitions.setores),
        d.sectors.length ? h("div", { class: "bars" }, d.sectors.map((x) => h("div", { class: "bar-row" },
          h("span", { class: "lbl", title: x.sector.name }, x.sector.name),
          h("div", { class: "track" }, h("div", { class: "fill", style: { width: `${Math.max(2, (100 * x.mean_days) / maxDays)}%` } })),
          h("span", null, `${x.mean_days} d`))))
          : empty("Sem movimentação no período."),
        d.sectors.length ? h("div", { class: "scroll-x", style: { marginTop: "10px" } }, h("table", { class: "list" },
          h("thead", null, h("tr", null, h("th", null, "Setor"), h("th", null, "Passagens"), h("th", null, "Média"), h("th", null, "Mediana"), h("th", null, "Total"), h("th", null, "Chegaram vencidas"))),
          h("tbody", null, d.sectors.map((x) => h("tr", null, h("td", null, x.sector.name), h("td", null, x.periods), h("td", null, `${x.mean_days} d`), h("td", null, `${x.median_days} d`), h("td", null, `${x.total_days} d`),
            h("td", null, x.arrived_overdue ? h("button", { class: "btn sm", onclick: () => open("chegaram_vencidas", { sector_id: x.sector.id, sectorName: x.sector.name }) }, x.arrived_overdue) : "0")))))) : null),
      h("details", { class: "panel pad small" }, h("summary", { style: { cursor: "pointer", fontWeight: 600 } }, "Como os números são calculados"),
        Object.values(d.definitions).map((t) => h("p", { style: { margin: "8px 0 0" } }, t)))));
}
