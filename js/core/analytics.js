// Exportação para análise (mesmo formato da versão local): um JSON por extração, para acumular numa pasta
// e abrir em ferramentas/painel_analise.html. Sem textos de pedidos, mensagens, senhas, telefones ou e-mails.
import * as L from "./logic.js";

const hours = (a, b) => (a && b ? Math.round(Math.max(0, (new Date(b) - new Date(a)) / 3600000) * 100) / 100 : null);
const lateHours = (s, e, deadline) => { const st = s > deadline ? s : deadline; return e > st ? Math.round(((new Date(e) - new Date(st)) / 3600000) * 100) / 100 : 0; };

export function buildAnalysis(db) {
  const now = L.nowIso(), today = L.todayLocal(now);
  const demandas = [], passagens = [], atribuicoes = [], eventos = [];
  for (const d of db.demands.values()) {
    const stop = d.resolved_at || d.completed_at || d.cancelled_at || now;
    const deadline = L.endOfDayUtc(d.due_date);
    const resolved = d.resolved_at || d.completed_at;
    const count = (t) => (d.events || []).filter((e) => e.type === t).length;
    demandas.push({
      id: d.id, codigo: d.code, titulo: d.title, pedido_feito_por: d.request_source, prioridade: d.priority, status: d.status, status_texto: L.STATUS_LABELS[d.status],
      setor_origem_id: d.origin_sector_id, setor_atual_id: d.dest_sector_id, criador_id: d.creator_id, responsavel_id: d.assignee_id, concluida_por_id: d.resolved_by_id,
      criada_em: L.localIso(d.created_at), prazo: d.due_date, prazo_original: d.original_due_date, resolvida_em: L.localIso(resolved), confirmada_em: L.localIso(d.completed_at),
      cancelada_em: L.localIso(d.cancelled_at), conclusao: L.conclusion(d),
      dias_atraso: d.status === "aberta" ? Math.max(0, L.daysBetween(d.due_date, today)) : resolved ? Math.max(0, L.daysBetween(d.due_date, L.localDate(resolved))) : null,
      horas_total: hours(d.created_at, stop), encaminhamentos: count("transferida"), devolucoes: count("devolvida"), reaberturas: count("reaberta"),
      mudancas_prazo: count("prazo_alterado"), mensagens: (db.msgIndex.get(d.id) || []).length,
    });
    for (const p of d.periods || []) {
      const end = p.ended_at || stop;
      passagens.push({ demanda_id: d.id, setor_id: p.sector_id, entrada: L.localIso(p.started_at), saida: L.localIso(p.ended_at), em_andamento: !p.ended_at && d.status === "aberta",
        horas: hours(p.started_at, end), horas_apos_prazo: lateHours(p.started_at, end, deadline), chegou_vencida: !!p.arrived_overdue, encaminhado_por_id: p.forwarded_by_id });
    }
    for (const a of d.assignments || []) {
      const end = a.ended_at || stop;
      atribuicoes.push({ demanda_id: d.id, pessoa_id: a.user_id, setor_id: a.sector_id, tipo: a.kind, inicio: L.localIso(a.started_at), fim: L.localIso(a.ended_at), motivo_fim: a.end_reason,
        horas: hours(a.started_at, end), horas_apos_prazo: lateHours(a.started_at, end, deadline), vista_em: L.localIso(a.viewed_at), horas_ate_ver: hours(a.started_at, a.viewed_at) });
    }
    for (const e of d.events || []) eventos.push({ demanda_id: d.id, tipo: e.type, em: L.localIso(e.at), pessoa_id: e.actor_id });
  }
  return {
    formato: "painel-demandas-analise", versao: 1, sistema: "Painel de Demandas - EQTL PI SUL",
    extraido_em: L.localIso(now), extraido_em_local: L.localIso(now).slice(0, 19).replace("T", " "),
    observacao: "Foto completa do momento. Datas em ISO 8601 com fuso de Brasília. Horas param quando o responsável conclui. 'horas_apos_prazo' = tempo que a demanda ficou com o setor/pessoa depois de vencida.",
    setores: db.sectors.map((s) => ({ id: s.id, nome: s.name, sigla: s.acronym, cor: s.color, ativo: s.active !== false })),
    pessoas: [...db.users.values()].map((u) => ({ id: u.id, nome: u.full_name, login: u.username, ativo: !!u.is_active, setores: L.activeMemberships(db, u).map((m) => m.sector_id) })),
    demandas, passagens_setor: passagens, atribuicoes, eventos,
  };
}
