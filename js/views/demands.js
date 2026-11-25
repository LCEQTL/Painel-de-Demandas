// Acompanhamento (lista), Cadastro e Demanda (tarefa à esquerda, conversa à direita).
import { api, qs } from "../api.js";
import {
  h, clear, icon, fmtDate, fmtDateTime, todayBR, deadlineBadge, statusBadge, priorityTag, priorityMark, conclusionTag, sourceTag, dueCell,
  avatar, personTag, loading, empty, errorState, toast, busy, errorBox, modal, field, input, select, personPicker, sectorChip,
  sectorFlow, actionMenu, drawer, STATUS, PRIORITY,
} from "../ui.js";
import { renderContent, createEditor, renderTable, tableEditor } from "../content.js";
import { state, navigate, mySectors, isAdmin, refreshCounts, sectorById, setLeaveGuard, isOnline } from "../state.js";
import { play } from "../sounds.js";

// ---------------------------------------------------------------- tabela de demandas (Início, Acompanhamento, Indicadores)
export function demandTable(items, { compact = false } = {}) {
  const head = ["Título", "Pedido feito em / por", "Prioridade", "Status", "Conclusão", "Responsável", "Prazo"];
  const tbody = h("tbody");
  for (const d of items) {
    const mark = d.new_for_me ? h("span", { class: "mark-new" }, "Nova") : d.unread ? h("span", { class: "mark-msg" }, "Mensagem nova") : null;
    const seen = d.seen_at ? h("span", { class: "seen on", title: `Vista pelo responsável em ${fmtDateTime(d.seen_at)}` }, icon("checks", 14))
      : h("span", { class: "seen", title: "Ainda não vista pelo responsável" }, icon("check", 14));
    const tr = h("tr", { class: "click", tabindex: "0", onclick: () => { LS.scrollY = window.scrollY; navigate("demandas/" + d.id); },
      onkeydown: (e) => { if (e.key === "Enter") navigate("demandas/" + d.id); } },
    h("td", { class: "c-title" }, h("div", { class: "t" }, d.title, compact ? priorityMark(d.priority) : null, mark), d.preview ? h("div", { class: "pv" }, d.preview) : null),
    h("td", { class: "c-src" }, sourceTag(d.request_source)),
    compact ? null : h("td", { class: "c-pr" }, priorityTag(d.priority)),
    h("td", { class: "c-st" }, statusBadge(d.status)),
    compact ? null : h("td", { class: "c-cc" }, conclusionTag(d.conclusion, d.status)),
    h("td", { class: "c-who" }, h("span", { class: "row", style: { gap: "6px", flexWrap: "nowrap" } }, personTag(d.assignee, { online: isOnline(d.assignee.id) }), seen)),
    h("td", { class: "c-due" }, dueCell(d)));
    tbody.appendChild(tr);
  }
  return h("div", { class: "panel tablewrap" }, h("table", { class: "dtable" + (compact ? " compact" : "") },
    h("thead", null, h("tr", null, head.map((x, i) => [x, ["c-title", "c-src", "c-pr", "c-st", "c-cc", "c-who", "c-due"][i]])
      .filter(([, c]) => !(compact && (c === "c-cc" || c === "c-pr"))).map(([x, c]) => h("th", { class: c }, x)))),
    tbody));
}
export const demandRows = (items) => demandTable(items);

// ---------------------------------------------------------------- Acompanhamento
const QUICK = [
  { key: "pendentes", label: "Pendentes" }, { key: "vencidas", label: "Fora do prazo" }, { key: "confirmar", label: "Aguardando confirmação" },
  { key: "concluidas", label: "Concluídas" }, { key: "canceladas", label: "Canceladas" }, { key: "todas", label: "Todas" },
];
const SCOPES = [{ value: "todas", label: "Todas que posso ver" }, { value: "minhas", label: "Comigo" }, { value: "criadas", label: "Criadas por mim" }];
let LS;
export function resetListState() { LS = { quick: "pendentes", scope: "todas", q: "", f: { source: "", dest_id: "", origin_id: "", assignee: null, priority: "" }, sort: "prazo", page: 1, filtersOpen: false, scrollY: 0 }; }
resetListState();
export function presetList(quick, scope = "todas") { resetListState(); LS.quick = quick; LS.scope = scope; }

export async function listPage(main) {
  const chips = h("div", { class: "chips" });
  const listBox = h("div");
  const search = input({ type: "search", placeholder: "Pesquisar demanda…", value: LS.q, "aria-label": "Pesquisar demanda" });
  const scope = select(SCOPES, LS.scope, { "aria-label": "Quais demandas", class: "w-auto" });
  const fBtn = h("button", { class: "btn", type: "button", "aria-expanded": String(LS.filtersOpen) }, icon("list", 15), "Filtros");
  const fBox = h("div", { class: "panel pad filters" + (LS.filtersOpen ? "" : " hidden") });
  const secOpts = [{ value: "", label: "Todos" }, ...state.sectors.map((s) => ({ value: s.id, label: s.name }))];
  const fSource = input({ value: LS.f.source, placeholder: "Ex.: Comitê de Clientes" });
  const fDest = select(secOpts, LS.f.dest_id), fOrigin = select(secOpts, LS.f.origin_id);
  const fPrio = select([{ value: "", label: "Todas" }, ...Object.entries(PRIORITY).map(([k, v]) => ({ value: k, label: v }))], LS.f.priority);
  const sort = select([{ value: "prazo", label: "Prazo mais próximo" }, { value: "atualizacao", label: "Atualizadas recentemente" }, { value: "criacao", label: "Criadas recentemente" }], LS.sort);
  const who = h("div", { class: "hint" });
  const fWho = personPicker({ placeholder: "Responsável…", onPick: (p) => { LS.f.assignee = p; reload(); } });
  fBox.append(h("div", { class: "grid3" }, field("Pedido feito em / por", fSource), field("Setor atual", fDest), field("Setor que abriu", fOrigin),
    field("Prioridade", fPrio), h("div", null, field("Responsável", fWho), who), field("Ordenar", sort)),
  h("div", { class: "row", style: { justifyContent: "flex-end", marginTop: "10px" } }, h("button", { class: "linkbtn", onclick: () => {
    LS.f = { source: "", dest_id: "", origin_id: "", assignee: null, priority: "" }; fSource.value = ""; fDest.value = fOrigin.value = fPrio.value = ""; reload();
  } }, "Limpar filtros")));
  fBtn.addEventListener("click", () => { LS.filtersOpen = !LS.filtersOpen; fBox.classList.toggle("hidden", !LS.filtersOpen); fBtn.setAttribute("aria-expanded", String(LS.filtersOpen)); });
  let t;
  search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { LS.q = search.value; reload(); }, 300); });
  fSource.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { LS.f.source = fSource.value; reload(); }, 400); });
  for (const [el, k] of [[fDest, "dest_id"], [fOrigin, "origin_id"], [fPrio, "priority"]]) el.addEventListener("change", () => { LS.f[k] = el.value; reload(); });
  scope.addEventListener("change", () => { LS.scope = scope.value; reload(); });
  sort.addEventListener("change", () => { LS.sort = sort.value; reload(); });

  const params = () => ({ scope: LS.scope, q: LS.q, source: LS.f.source, dest_id: LS.f.dest_id, origin_id: LS.f.origin_id, priority: LS.f.priority, assignee_id: LS.f.assignee ? LS.f.assignee.id : "" });
  const activeCount = () => ["source", "dest_id", "origin_id", "priority"].filter((k) => LS.f[k]).length + (LS.f.assignee ? 1 : 0);
  const load = async () => {
    who.textContent = LS.f.assignee ? "Selecionado: " + LS.f.assignee.name : "";
    const n = activeCount();
    clear(fBtn).append(icon("list", 15), n ? `Filtros (${n})` : "Filtros");
    clear(listBox).appendChild(loading());
    try {
      const [c, res] = await Promise.all([api.get("/api/demands/counts" + qs(params())),
        api.get("/api/demands" + qs({ ...params(), quick: LS.quick, sort: LS.sort, page: LS.page, page_size: 30 }))]);
      clear(chips);
      for (const q of QUICK) chips.appendChild(h("button", { class: `qf q-${q.key}` + (q.key === LS.quick ? " active" : ""), type: "button", "aria-pressed": String(q.key === LS.quick),
        onclick: () => { LS.quick = q.key; LS.page = 1; load(); } }, q.label, h("span", { class: "n" }, c.quick[q.key])));
      clear(listBox);
      if (!res.items.length) { listBox.appendChild(h("div", { class: "panel" }, empty(LS.q || n ? "Nenhuma demanda com estes filtros." : "Nenhuma demanda aqui."))); return; }
      listBox.appendChild(demandTable(res.items));
      const pages = Math.ceil(res.total / res.page_size);
      if (pages > 1) listBox.appendChild(h("div", { class: "pager" }, h("span", { class: "muted" }, `${res.total} demandas`), h("span", { style: { flex: 1 } }),
        LS.page > 1 ? h("button", { class: "btn sm", onclick: () => { LS.page--; load(); } }, "Anterior") : null, h("span", { class: "muted" }, `${LS.page} de ${pages}`),
        LS.page < pages ? h("button", { class: "btn sm", onclick: () => { LS.page++; load(); } }, "Próxima") : null));
    } catch (e) { clear(listBox).appendChild(errorState(e, load)); }
  };
  const reload = () => { LS.page = 1; return load(); };
  main.append(
    h("div", { class: "page-head" }, h("h1", null, "Acompanhamento"), h("span", { class: "spacer" }),
      h("div", { class: "search" }, icon("search", 15), search), scope, fBtn,
      h("a", { class: "btn primary", href: "#/cadastro" }, icon("plus", 14), "Nova demanda")),
    fBox, chips, listBox);
  await load();
  const y = LS.scrollY;
  return () => window.scrollTo(0, y);
}

// ---------------------------------------------------------------- Cadastro
export async function newDemand(main) {
  const mine = mySectors();
  const originOpts = mine.length ? mine : isAdmin() ? state.sectors : [];
  if (!originOpts.length) {
    main.appendChild(h("div", { class: "panel pad" }, "Você ainda não pertence a nenhum setor. Peça ao gestor do seu setor ou ao administrador para incluir seu vínculo."));
    return;
  }
  const title = input({ maxlength: 200, placeholder: "O que precisa ser feito?", id: "nd-title" });
  const due = input({ type: "date", min: todayBR(), id: "nd-due" });
  const source = input({ maxlength: 120, id: "nd-source", placeholder: "Ex.: Comitê de Clientes, reunião com o presidente, ANEEL" });
  const dest = select([{ value: "", label: "Selecione o setor…" }, ...state.sectors.map((s) => ({ value: s.id, label: s.name }))], "", { id: "nd-dest" });
  const person = select([{ value: "", label: "Escolha o setor primeiro" }], "", { disabled: true, id: "nd-person" });
  const personHint = h("div", { class: "hint" });
  const prio = select(Object.entries(PRIORITY).map(([k, v]) => ({ value: k, label: v })), "normal", { id: "nd-prio" });
  const just = input({ placeholder: "Por que é urgente?", id: "nd-just" });
  const justWrap = field("Justificativa da urgência", just, { required: true });
  justWrap.classList.add("hidden");
  prio.addEventListener("change", () => justWrap.classList.toggle("hidden", prio.value !== "urgente"));
  const origin = select(originOpts.map((s) => ({ value: s.id, label: s.name })), originOpts[0].id, { id: "nd-origin" });
  const editor = createEditor({ placeholder: "Descreva o pedido. Você pode colar imagens e células do Excel aqui." });

  const forMe = h("label", { class: "checkbox forme" }, h("input", { type: "checkbox", id: "nd-forme" }), "É para mim");
  const fillPeople = async (selectId) => {
    person.disabled = true;
    clear(person).appendChild(h("option", null, "Carregando…"));
    const s = sectorById(dest.value);
    const people = dest.value ? await api.get("/api/people/search" + qs({ sector_id: dest.value, limit: 50 })) : [];
    clear(person);
    person.appendChild(h("option", { value: "", disabled: !(s && s.primary_manager) }, s && s.primary_manager ? `Gerente do setor (${s.primary_manager.name})` : "Escolha uma pessoa"));
    for (const p of people) person.appendChild(h("option", { value: p.id }, p.id === state.me.id ? `${p.name} (você)` : p.name));
    person.disabled = false;
    if (selectId) person.value = String(selectId);
    else if (!(s && s.primary_manager) && people.length) person.selectedIndex = 1;
    hint();
  };
  const hint = () => {
    const s = sectorById(dest.value);
    personHint.textContent = !dest.value ? "" : person.value ? "" : s && s.primary_manager ? `Sem pessoa escolhida, vai para ${s.primary_manager.name}.` : "Este setor não tem gerente principal: escolha uma pessoa.";
  };
  dest.addEventListener("change", () => { forMe.firstChild.checked = false; fillPeople(); });
  person.addEventListener("change", hint);
  forMe.firstChild.addEventListener("change", async (e) => {
    if (!e.target.checked) return;
    const sid = origin.value;
    if (!mine.some((m) => String(m.id) === String(sid))) { toast("Para criar para você, é preciso pertencer ao setor que abre.", "err"); e.target.checked = false; return; }
    dest.value = sid;
    await fillPeople(state.me.id);
  });

  const err = errorBox();
  const save = h("button", { class: "btn primary lg" }, icon("check", 16), "Salvar demanda");
  let dirty = false;
  [title, source].forEach((x) => x.addEventListener("input", () => { dirty = true; }));
  setLeaveGuard(() => dirty || !editor.isEmpty());
  save.addEventListener("click", busy(save, async () => {
    if (!title.value.trim()) throw new Error("Informe a demanda (título).");
    if (!due.value) throw new Error("Informe o prazo.");
    if (!dest.value) throw new Error("Escolha o setor responsável.");
    if (editor.isUploading()) throw new Error("Aguarde o envio das imagens.");
    if (editor.isEmpty()) throw new Error("Descreva o pedido.");
    const r = await api.post("/api/demands", {
      title: title.value, description: editor.getValue(), origin_sector_id: Number(origin.value), dest_sector_id: Number(dest.value),
      assignee_id: person.value ? Number(person.value) : null, due_date: due.value, priority: prio.value,
      priority_justification: prio.value === "urgente" ? just.value : null, request_source: source.value || null,
    });
    setLeaveGuard(null);
    play("acao");
    toast("Demanda cadastrada.", "ok");
    navigate("demandas/" + r.id);
  }, err));

  main.append(
    h("div", { class: "page-head" }, h("h1", null, "Cadastro")),
    h("div", { class: "panel pad form-card" },
      h("div", { class: "fgrid" },
        h("div", { class: "span3" }, field("Demanda", title, { required: true })),
        h("div", null, field("Prazo", due, { required: true })),
        h("div", { class: "span2" }, h("div", { class: "f" }, h("label", { for: "nd-source" }, h("span", null, "Pedido feito em / por")), source),
          h("div", { class: "hint" }, "Onde ou por quem a demanda surgiu. Não é o setor.")),
        h("div", null, field("Setor responsável", dest, { required: true })),
        h("div", null, h("div", { class: "f" }, h("label", { for: "nd-person" }, h("span", null, "Responsável ", h("span", { class: "req" }, "*"))), person), personHint, forMe),
        h("div", null, field("Prioridade", prio)), h("div", { class: "span3" }, justWrap),
        h("div", { class: "span4" }, h("div", { class: "f" }, h("span", null, "Descrição ", h("span", { class: "req" }, "*")), editor.el))),
      h("div", { class: "form-foot" },
        h("div", { class: "origin-box" }, h("span", null, "Setor que abriu: "),
          originOpts.length > 1 ? origin : sectorChip(originOpts[0]), h("span", { class: "muted small" }, ` · Criada por ${state.me.full_name}`)),
        h("span", { class: "spacer" }), err, save)));
  setTimeout(() => title.focus(), 30);
}

// ---------------------------------------------------------------- Demanda: tarefa à esquerda, conversa à direita
export async function detailPage(main, { id }) {
  let d = await api.get(`/api/demands/${id}`);
  refreshCounts();
  const root = h("div", { class: "taskview" });
  const left = h("section", { class: "taskcol" });
  const msgs = h("div", { class: "chat-msgs", "aria-live": "polite" });
  const chatHead = h("div", { class: "chat-head" });
  const editor = createEditor({ placeholder: "Escreva uma mensagem…", compact: true });
  const sendErr = errorBox();
  const sendBtn = h("button", { class: "btn primary" }, icon("send", 15), "Enviar");
  const chat = h("aside", { class: "chatcol panel" }, chatHead, msgs, h("div", { class: "chat-compose" }, editor.el, h("div", { class: "foot" }, sendErr, sendBtn)));
  root.append(left, chat);
  setLeaveGuard(() => !editor.isEmpty());

  const update = (nd, { sound } = {}) => {
    if (nd && nd.access_lost) { setLeaveGuard(null); toast("Demanda encaminhada. Você não tem mais acesso a ela.", "ok"); navigate("acompanhamento"); return; }
    const newMsgs = nd.messages.length > d.messages.length;
    d = nd; render(); refreshCounts();
    if (sound) play(sound); else if (newMsgs) play("mensagem");
  };
  const reload = async () => update(await api.get(`/api/demands/${d.id}`));
  const ctx = { get d() { return d; }, update, reload };

  sendBtn.addEventListener("click", busy(sendBtn, async () => {
    if (editor.isUploading()) throw new Error("Aguarde o envio da imagem.");
    const content = editor.getValue();
    if (!content.blocks.length) throw new Error("Escreva uma mensagem.");
    const nd = await api.post(`/api/demands/${d.id}/messages`, { content });
    editor.clear();
    d = nd; render(); play("envio");
  }, sendErr));

  // Atualização da conversa a cada 20 s enquanto a página estiver aberta (sem tempo real).
  const timer = setInterval(async () => {
    if (!document.body.contains(root)) { clearInterval(timer); return; }
    if (document.visibilityState !== "visible") return;
    try { const nd = await api.get(`/api/demands/${d.id}`); if (nd.version !== d.version || nd.messages.length !== d.messages.length) update(nd); } catch (_) { /* tenta de novo */ }
  }, 20000);

  const render = () => {
    const p = d.permissions;
    const meCreator = d.creator.id === state.me.id;
    // ---- ações (ficam na tarefa, não no chat)
    const acts = [];
    if (p.confirm) {
      acts.push(h("button", { class: "btn success lg", onclick: () => act(ctx, "confirm", undefined, "acao", "Conclusão confirmada.") }, icon("check", 16), "Confirmar conclusão"));
      acts.push(h("button", { class: "btn outline", onclick: () => textDialog(ctx, "Devolver ao responsável", "O que ainda falta?", "send-back", "reason", "Devolver", `A demanda volta para ${d.assignee.name} como pendente. O prazo continua o mesmo.`) }, icon("undo", 15), "Devolver"));
    }
    if (p.complete) acts.push(h("button", { class: "btn success lg", onclick: () => completeDialog(ctx) }, icon("check", 16), "Concluir"));
    if (p.transfer) acts.push(h("button", { class: "btn outline lg", onclick: () => forwardDialog(ctx) }, icon("forward", 16), "Encaminhar"));
    if (p.reopen) acts.push(h("button", { class: "btn outline", onclick: () => textDialog(ctx, "Reabrir demanda", "Motivo da reabertura", "reopen", "reason", "Reabrir", "A conclusão anterior fica no histórico.") }, icon("undo", 15), "Reabrir"));
    const more = [];
    if (p.change_due) more.push({ label: "Alterar prazo", onClick: () => dueDialog(ctx) });
    if (p.edit_request) more.push({ label: "Editar demanda", onClick: () => editDialog(ctx) });
    if (p.manage_watchers) more.push({ label: "Acompanhantes", onClick: () => showDrawer("participantes") });
    more.push({ label: "Ver percurso nos setores", onClick: () => showDrawer("percurso") }, { label: "Ver histórico", onClick: () => showDrawer("historico") });
    if (p.cancel) more.push("-", { label: "Cancelar demanda", danger: true, onClick: () => textDialog(ctx, "Cancelar demanda", "Justificativa do cancelamento", "cancel", "reason", "Cancelar demanda", "A demanda não é excluída; fica registrada como cancelada.", true) });

    const cur = d.timeline.current;
    const seen = d.seen;
    const seenEl = !seen ? null : seen.seen_at
      ? h("span", { class: "seen on", title: `Vista em ${fmtDateTime(seen.seen_at)}` }, icon("checks", 14), "vista")
      : h("span", { class: "seen", title: "Ainda não vista pelo responsável" }, icon("check", 14), "não vista");
    const meta = (label, value) => h("div", { class: "mi" }, h("span", { class: "k" }, label), h("span", { class: "v" }, value));

    clear(left).append(
      h("a", { class: "backlink", href: "#/acompanhamento" }, icon("back", 14), "Acompanhamento"),
      h("div", { class: "panel task-card" },
        h("div", { class: "task-head" },
          h("div", { class: "th-main" },
            h("div", { class: "row tags" }, statusBadge(d.status), priorityTag(d.priority), d.status !== "aberta" ? conclusionTag(d.conclusion, d.status) : null,
              h("span", { class: "code" }, d.code)),
            h("h1", { class: "task-title" }, d.title)),
          acts.length || more.length ? h("div", { class: "task-actions" }, acts, actionMenu(h("span", null, icon("dots", 16), " Mais"), more, { btnClass: "btn ghost" })) : null),
        d.status === "aguardando_confirmacao" ? h("div", { class: "notice warn" }, icon("flag", 16),
          meCreator ? `${d.resolved_by ? d.resolved_by.name : d.assignee.name} concluiu esta demanda. Confira a solução e confirme, ou devolva se faltar algo.`
            : `Concluída por ${d.resolved_by ? d.resolved_by.name : d.assignee.name}. Aguardando ${d.creator.name} confirmar.`) : null,
        d.resolution && d.status !== "aberta" ? h("div", { class: "resolution" }, h("strong", null, "Solução: "), h("span", { style: { whiteSpace: "pre-wrap" } }, d.resolution)) : null,
        h("div", { class: "pedido" },
          h("div", { class: "pedido-label" }, "Pedido"),
          h("div", { class: "pedido-body" }, renderContent(d.description)),
          d.priority === "urgente" && d.priority_justification ? h("div", { class: "small", style: { color: "var(--late)", marginTop: "8px", fontWeight: 600 } }, "Urgente: " + d.priority_justification) : null),
        h("div", { class: "metastrip" },
          meta("Prazo", h("span", null, fmtDate(d.due_date), " ", d.status === "aberta" ? deadlineBadge(d.deadline, null) : null)),
          meta("Pedido feito em / por", d.request_source || "—"),
          meta("Setor", sectorFlow(d.origin, d.dest)),
          meta("Responsável", h("span", { class: "row", style: { gap: "6px" } }, personTag(d.assignee, { online: isOnline(d.assignee.id) }), seenEl)),
          meta("Criada por", h("span", null, d.creator.name, h("span", { class: "muted" }, " · " + fmtDateTime(d.created_at)))),
          meta("Tempo no setor", h("span", null, cur ? `${cur.sector.name}: ${cur.duration}` : "Encerrado", " · ",
            h("button", { class: "linkbtn", onclick: () => showDrawer("percurso") }, "percurso"))))),
      tablesSection(ctx));

    // ---- conversa: mensagens + acontecimentos com motivo, em ordem de tempo
    const people = [d.creator, d.assignee, ...d.watchers].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i);
    clear(chatHead).append(h("h2", null, "Conversa"), h("span", { class: "spacer" }),
      h("div", { class: "avatars", title: people.map((x) => x.name + (isOnline(x.id) ? " (online)" : "")).join(", ") }, people.slice(0, 5).map((x) => avatar(x.name, isOnline(x.id)))));
    const stick = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 60;
    clear(msgs);
    msgs.appendChild(h("div", { class: "sysmsg" }, `${d.creator.name} abriu a demanda em ${fmtDateTime(d.created_at)}`));
    const items = [...d.messages.map((m) => ({ at: m.created_at, m })), ...d.events.filter((e) => CHAT_EVENTS[e.type]).map((e) => ({ at: e.at, e }))]
      .sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
    if (!items.length) msgs.appendChild(h("div", { class: "state small" }, "Nenhuma mensagem ainda. Use a conversa para perguntas e respostas."));
    for (const it of items) {
      if (it.e) { msgs.appendChild(chatEvent(it.e)); continue; }
      const m = it.m;
      const mine = m.author.id === state.me.id;
      msgs.appendChild(h("div", { class: "bubble" + (mine ? " mine" : "") },
        mine ? null : avatar(m.author.name, isOnline(m.author.id)),
        h("div", { class: "bb" }, h("div", { class: "who" }, mine ? "Você" : m.author.name, h("span", { class: "when" }, fmtDateTime(m.created_at))), renderContent(m.content))));
    }
    if (stick || !render.done) msgs.scrollTop = msgs.scrollHeight;
    render.done = true;
  };

  let openDrawer = null;
  const showDrawer = (kind) => {
    const titles = { percurso: "Percurso nos setores", historico: "Histórico", participantes: "Acompanhantes" };
    const build = () => (kind === "percurso" ? routeView(d) : kind === "historico" ? historyView(d) : participantsView(ctx));
    const dr = drawer({ title: titles[kind], body: build(), onClose: () => { openDrawer = null; } });
    openDrawer = { refresh: () => dr.setBody(build()) };
  };
  const _update = update;
  ctx.update = (nd, o) => { _update(nd, o); if (openDrawer && nd && !nd.access_lost) openDrawer.refresh(); };

  render();
  main.appendChild(root);
}

// Acontecimentos que aparecem na conversa, com o motivo/solução em destaque.
const who = (e) => (e.actor ? (e.actor.id === state.me.id ? "Você" : e.actor.name) : "Sistema");
const CHAT_EVENTS = {
  transferida: { ic: "forward", cls: "ev-fwd", title: (e) => (e.data.internal ? `${who(e)} repassou para ${e.data.to_user}` : `${who(e)} encaminhou para ${e.data.to_sector} · ${e.data.to_user}`), text: (e) => e.data.reason, label: "Motivo" },
  resolvida: { ic: "check", cls: "ev-conf", title: (e) => `${who(e)} concluiu · aguardando confirmação`, text: (e) => e.data.resolution, label: "Solução" },
  concluida: { ic: "check", cls: "ev-done", title: (e) => `${who(e)} concluiu ${e.data.on_time ? "no prazo" : "fora do prazo"}`, text: (e) => e.data.resolution, label: "Solução" },
  conclusao_confirmada: { ic: "checks", cls: "ev-done", title: (e) => `${who(e)} confirmou a conclusão` },
  devolvida: { ic: "undo", cls: "ev-back", title: (e) => `${who(e)} devolveu ao responsável`, text: (e) => e.data.reason, label: "O que falta" },
  reaberta: { ic: "undo", cls: "ev-back", title: (e) => `${who(e)} reabriu a demanda`, text: (e) => e.data.reason, label: "Motivo" },
  cancelada: { ic: "x", cls: "ev-cancel", title: (e) => `${who(e)} cancelou a demanda`, text: (e) => e.data.reason, label: "Justificativa" },
  prazo_alterado: { ic: "clock", cls: "ev-due", title: (e) => `${who(e)} alterou o prazo: ${fmtDate(e.data.old)} → ${fmtDate(e.data.new)}`, text: (e) => e.data.justification, label: "Justificativa" },
};
function chatEvent(e) {
  const c = CHAT_EVENTS[e.type];
  const txt = c.text ? c.text(e) : null;
  return h("div", { class: "evmsg " + c.cls },
    h("div", { class: "et" }, h("span", { class: "tt" }, icon(c.ic, 14), h("span", null, c.title(e))), h("span", { class: "when" }, fmtDateTime(e.at))),
    txt ? h("div", { class: "ex" }, h("span", { class: "lbl" }, c.label + ": "), txt) : null);
}

function act(ctx, path, body, sound, msg) {
  return (async () => {
    try { ctx.update(await api.post(`/api/demands/${ctx.d.id}/${path}`, body), { sound }); if (msg) toast(msg, "ok"); }
    catch (e) { toast(e.message, "err"); if (e.status === 409) await ctx.reload(); }
  })();
}

// ---------------------------------------------------------------- tabelas de acompanhamento (na tarefa)
function tablesSection(ctx) {
  const d = ctx.d;
  if (!d.tables.length && !d.permissions.edit_tables) return null;
  const box = h("div", { class: "panel task-card" }, h("div", { class: "row" }, h("h3", { style: { flex: 1 } }, icon("table", 15), ` Tabelas de acompanhamento (${d.tables.length})`),
    d.permissions.edit_tables ? h("button", { class: "btn sm", onclick: () => newTableDialog(ctx) }, icon("plus", 13), "Nova tabela") : null));
  if (!d.tables.length) box.appendChild(h("div", { class: "small muted" }, "Tabelas editáveis com histórico de alterações, para acompanhar listas ao longo da demanda."));
  for (const t of d.tables) box.appendChild(trackingTable(ctx, t));
  return box;
}

function newTableDialog(ctx) {
  const title = input({ placeholder: "Ex.: Relação de contas" });
  const ed = tableEditor(null, { compactTitle: true });
  const err = errorBox();
  modal({ title: "Nova tabela de acompanhamento", wide: true, body: h("div", { class: "stack" }, field("Título", title, { required: true }), ed.el, err),
    actions: [{ label: "Cancelar" }, { label: "Criar tabela", class: "primary", errBox: err, onClick: async () => {
      await api.post(`/api/demands/${ctx.d.id}/tables`, { title: title.value, data: ed.value });
      await ctx.reload();
    } }] });
}

function trackingTable(ctx, t) {
  const d = ctx.d;
  const box = h("div", { class: "ttable" });
  const view = () => {
    clear(box).append(
      h("div", { class: "row" }, h("strong", { style: { flex: 1 } }, t.title),
        h("span", { class: "small muted" }, `${t.updated_by ? t.updated_by.name + " · " : ""}${fmtDateTime(t.updated_at)}`),
        d.permissions.edit_tables ? h("button", { class: "btn sm", onclick: edit }, "Editar") : null,
        h("button", { class: "btn sm ghost", onclick: history }, "Alterações")),
      renderTable(t.data, { title: "" }));
  };
  const edit = () => {
    const ed = tableEditor(t.data, { compactTitle: true });
    const title = input({ value: t.title });
    const err = errorBox();
    const save = h("button", { class: "btn primary sm" }, "Salvar tabela");
    save.addEventListener("click", busy(save, async () => {
      try {
        Object.assign(t, await api.put(`/api/demands/${d.id}/tables/${t.id}`, { title: title.value, data: ed.value, version: t.version }));
        view(); toast("Tabela salva.", "ok");
      } catch (e) {
        if (e.status === 409 && e.detail && e.detail.current) {
          err.textContent = e.message; err.classList.remove("hidden");
          err.appendChild(h("div", null, h("button", { class: "btn sm", style: { marginTop: "6px" }, onclick: () => { Object.assign(t, e.detail.current); view(); } }, "Carregar a versão atual")));
          return;
        }
        throw e;
      }
    }, err));
    clear(box).append(field("Título", title), ed.el, err, h("div", { class: "row", style: { justifyContent: "flex-end", marginTop: "8px" } }, h("button", { class: "btn sm", onclick: view }, "Cancelar"), save));
  };
  const history = async () => {
    const full = await api.get(`/api/demands/${d.id}/tables/${t.id}`);
    modal({ title: "Alterações: " + t.title, wide: true, body: h("div", null, full.changes.map((c) => h("div", { class: "event" },
      h("div", { class: "when" }, `versão ${c.version} · ${fmtDateTime(c.at)} · ${c.user.name}`), h("div", null, describeTableDiff(c.diff))))) });
  };
  view();
  return box;
}

function describeTableDiff(diff) {
  if (diff.created) return "Tabela criada.";
  const parts = [];
  if (diff.title) parts.push(`Título: “${diff.title.old}” → “${diff.title.new}”`);
  if (diff.columns) parts.push(`Colunas: ${diff.columns.old.join(", ")} → ${diff.columns.new.join(", ")}`);
  if (diff.rows_added) parts.push(`${diff.rows_added} linha(s) adicionada(s)`);
  if (diff.rows_removed) parts.push(`${diff.rows_removed} linha(s) removida(s)`);
  const el = h("div", null, parts.join(" · "));
  if (diff.cells) el.appendChild(h("ul", { class: "small" }, diff.cells.map(([r, col, o, n]) => h("li", null, `Linha ${r}, ${col}: “${o ?? ""}” → “${n ?? ""}”`))));
  return el;
}

// ---------------------------------------------------------------- áreas secundárias
function routeView(d) {
  const tl = d.timeline;
  return h("div", { class: "stack" },
    h("div", { class: "small muted" }, "Tempo corrido. Trocar a pessoa dentro do mesmo setor não reinicia o tempo do setor; encaminhar não muda o prazo."),
    h("div", { class: "timeline" }, tl.periods.map((p) => h("div", { class: "tl-item" + (p.current ? " current" : "") },
      h("div", { class: "head" }, sectorChip(p.sector), h("span", null, p.duration)),
      h("div", { class: "sub" }, `Entrada ${fmtDateTime(p.started_at)} · ${p.ended_at ? "saída " + fmtDateTime(p.ended_at) : "até agora"}`),
      p.forwarded_by ? h("div", { class: "sub" }, `Encaminhado por ${p.forwarded_by.name}${p.reason ? ": " + p.reason : ""}`) : null,
      p.arrived_overdue ? h("div", { class: "small", style: { color: "var(--red-fg)", fontWeight: 600 } }, "Chegou vencida a este setor") : null,
      p.assignments.map((a) => h("div", { class: "tl-person" }, `${a.user.name} · ${a.duration}${a.ended_at ? "" : " (atual)"}`))))),
    h("h3", null, "Tempo acumulado por setor"),
    h("div", null, tl.totals.map((t) => h("div", { class: "row", style: { justifyContent: "space-between", padding: "4px 0" } },
      h("span", null, sectorChip(t.sector), t.periods > 1 ? h("span", { class: "small muted" }, ` ${t.periods} passagens`) : null), h("strong", null, t.duration)))));
}

const EVENT_TEXT = {
  criada: (e) => `Demanda aberta: ${e.data.origin} → ${e.data.dest}, prazo ${fmtDate(e.data.due_date)}${e.data.request_source ? `, pedido feito em/por ${e.data.request_source}` : ""}.`,
  atribuida: (e) => `Atribuída a ${e.data.to_user} (${e.data.sector})${e.data.fallback_primary ? ", gestor do setor" : ""}.`,
  transferida: (e) => (e.data.internal ? `Encaminhada dentro de ${e.data.to_sector}: ${e.data.from_user} → ${e.data.to_user}.`
    : `Encaminhada de ${e.data.from_sector} (${e.data.from_user}) para ${e.data.to_sector} (${e.data.to_user})${e.data.arrived_overdue ? ", chegou vencida" : ""}.`) + ` Motivo: ${e.data.reason}.`,
  prazo_alterado: (e) => `Prazo alterado de ${fmtDate(e.data.old)} para ${fmtDate(e.data.new)}. Justificativa: ${e.data.justification}`,
  status: (e) => `Status: ${STATUS[e.data.old] || e.data.old} → ${STATUS[e.data.new] || e.data.new}.`,
  resolvida: (e) => `Concluída pelo responsável ${e.data.on_time ? "dentro" : "fora"} do prazo, aguardando confirmação. Solução: ${e.data.resolution}`,
  concluida: (e) => `Concluída ${e.data.on_time ? "dentro" : "fora"} do prazo. Solução: ${e.data.resolution}`,
  conclusao_confirmada: () => "Conclusão confirmada por quem criou.",
  devolvida: (e) => `Devolvida ao responsável. Motivo: ${e.data.reason}`,
  reaberta: (e) => `Reaberta. Motivo: ${e.data.reason}.`,
  cancelada: (e) => `Cancelada. Justificativa: ${e.data.reason}`,
  acompanhante_incluido: (e) => `${e.data.user} incluído(a) como acompanhante.`,
  acompanhante_removido: (e) => `${e.data.user} removido(a) dos acompanhantes.`,
  tabela_criada: (e) => `Tabela de acompanhamento “${e.data.table}” criada.`,
  pedido_alterado: () => "Demanda editada.",
  retorno_solicitado: (e) => `Resposta solicitada a ${e.data.waiting_on}: ${e.data.question}`,
  retorno_recebido: (e) => `${e.data.waiting_on} respondeu.`,
  espera_encerrada: () => "Atendimento continuado.",
};

function historyView(d) {
  return h("div", null, [...d.events].reverse().map((e) => h("div", { class: "event" },
    h("div", { class: "when" }, `${fmtDateTime(e.at)} · ${e.actor ? e.actor.name : "Sistema"}`), h("div", null, (EVENT_TEXT[e.type] || (() => e.type))(e)))));
}

function participantsView(ctx) {
  const d = ctx.d;
  const p = d.permissions;
  return h("div", { class: "stack" },
    h("div", { class: "small muted" }, "Acompanhantes veem a demanda e participam da conversa."),
    d.watchers.length ? h("div", null, d.watchers.map((w) => h("span", { class: "chip" }, w.name,
      p.manage_watchers ? h("button", { "aria-label": "Remover " + w.name, onclick: async () => {
        try { ctx.update(await api.del(`/api/demands/${d.id}/watchers/${w.id}`)); } catch (e) { toast(e.message, "err"); }
      } }, "×") : null))) : h("div", { class: "muted small" }, "Nenhum acompanhante."),
    p.manage_watchers ? personPicker({ placeholder: "Incluir acompanhante…", exclude: d.watchers.map((w) => w.id),
      onPick: async (pp) => { try { ctx.update(await api.post(`/api/demands/${d.id}/watchers`, { user_id: pp.id })); toast(`${pp.name} incluído(a).`, "ok"); } catch (e) { toast(e.message, "err"); } } }) : null);
}

// ---------------------------------------------------------------- diálogos
function completeDialog(ctx) {
  const d = ctx.d;
  const ta = h("textarea", { rows: 4, placeholder: "Como foi resolvido?" });
  const err = errorBox();
  const needs = d.creator.id !== state.me.id && d.creator.id !== d.assignee.id;
  modal({ title: "Concluir demanda", body: h("div", { class: "stack" },
    needs ? h("div", { class: "notice" }, icon("flag", 15), `${d.creator.name} criou esta demanda e vai confirmar a conclusão.`) : null,
    field("Solução", ta, { required: true }), err),
  actions: [{ label: "Voltar" }, { label: "Concluir", class: "success", errBox: err, onClick: async () => {
    ctx.update(await api.post(`/api/demands/${d.id}/complete`, { resolution: ta.value }), { sound: "acao" });
    toast(needs ? "Concluída. Aguardando confirmação de quem criou." : "Demanda concluída.", "ok");
  } }] });
}

async function forwardDialog(ctx) {
  const d = ctx.d;
  const sector = select(state.sectors.map((s) => ({ value: s.id, label: s.name })), d.dest.id);
  const person = select([{ value: "", label: "Carregando…" }], "");
  const reason = h("textarea", { rows: 3, placeholder: "Por que está encaminhando?" });
  const err = errorBox();
  const loadPeople = async () => {
    const s = sectorById(sector.value);
    const people = await api.get("/api/people/search" + qs({ sector_id: sector.value, limit: 50 }));
    clear(person);
    person.appendChild(h("option", { value: "", disabled: !(s && s.primary_manager) }, s && s.primary_manager ? `Gerente do setor (${s.primary_manager.name})` : "Escolha uma pessoa"));
    for (const p of people) if (!(p.id === d.assignee.id && String(sector.value) === String(d.dest.id))) person.appendChild(h("option", { value: p.id }, p.name));
    if (!(s && s.primary_manager) && person.options.length > 1) person.selectedIndex = 1;
  };
  sector.addEventListener("change", loadPeople);
  await loadPeople();
  modal({ title: "Encaminhar demanda", body: h("div", { class: "stack" },
    h("div", { class: "grid2" }, field("Para o setor", sector, { required: true }), field("Para a pessoa", person, { required: true })),
    field("Motivo", reason, { required: true }),
    h("div", { class: "small muted" }, `O prazo continua ${fmtDate(d.due_date)}. O tempo em ${d.dest.name} é registrado no percurso.`), err),
  actions: [{ label: "Cancelar" }, { label: "Encaminhar", class: "primary", errBox: err, onClick: async () => {
    try {
      ctx.update(await api.post(`/api/demands/${d.id}/transfer`, { sector_id: Number(sector.value), user_id: person.value ? Number(person.value) : null, reason: reason.value, version: d.version }), { sound: "acao" });
      toast("Demanda encaminhada.", "ok");
    } catch (e) { if (e.status === 409) await ctx.reload(); throw e; }
  } }] });
}

function textDialog(ctx, title, label, path, key, okLabel, note, danger = false) {
  const ta = h("textarea", { rows: 4 });
  const err = errorBox();
  modal({ title, body: h("div", { class: "stack" }, note ? h("div", { class: "notice small" }, note) : null, field(label, ta, { required: true }), err),
    actions: [{ label: "Voltar" }, { label: okLabel, class: danger ? "danger primary" : "primary", errBox: err, onClick: async () => {
      ctx.update(await api.post(`/api/demands/${ctx.d.id}/${path}`, { [key]: ta.value }), { sound: "acao" });
    } }] });
}

function dueDialog(ctx) {
  const d = ctx.d;
  const due = input({ type: "date", value: d.due_date });
  const just = h("textarea", { rows: 3 });
  const err = errorBox();
  modal({ title: "Alterar prazo", body: h("div", { class: "stack" },
    h("div", { class: "small muted" }, `Prazo atual: ${fmtDate(d.due_date)} (original: ${fmtDate(d.original_due_date)}).`),
    field("Novo prazo", due, { required: true }), field("Justificativa", just, { required: true }), err),
  actions: [{ label: "Cancelar" }, { label: "Alterar prazo", class: "primary", errBox: err, onClick: async () => {
    try { ctx.update(await api.post(`/api/demands/${d.id}/due-date`, { due_date: due.value, justification: just.value, version: d.version })); }
    catch (e) { if (e.status === 409) await ctx.reload(); throw e; }
  } }] });
}

function editDialog(ctx) {
  const d = ctx.d;
  const title = input({ value: d.title });
  const source = input({ value: d.request_source || "", maxlength: 120 });
  const prio = select(Object.entries(PRIORITY).map(([k, v]) => ({ value: k, label: v })), d.priority);
  const just = input({ value: d.priority_justification || "" });
  const editor = createEditor({ initial: d.description });
  const baseline = JSON.stringify(editor.getValue());
  const err = errorBox();
  modal({ title: "Editar demanda", wide: true, body: h("div", { class: "stack" },
    h("div", { class: "grid2" }, field("Demanda", title, { required: true }), field("Pedido feito em / por", source)),
    h("div", { class: "grid2" }, field("Prioridade", prio), field("Justificativa (se urgente)", just)), field("Descrição", editor.el, { required: true }), err),
  actions: [{ label: "Cancelar" }, { label: "Salvar", class: "primary", errBox: err, onClick: async () => {
    const body = { version: d.version, title: title.value, priority: prio.value, priority_justification: just.value || null, request_source: source.value };
    const desc = editor.getValue();
    if (JSON.stringify(desc) !== baseline) body.description = desc;
    try { ctx.update(await api.patch(`/api/demands/${d.id}`, body)); }
    catch (e) { if (e.status === 409) { err.textContent = e.message; err.classList.remove("hidden"); return false; } throw e; }
  } }] });
}
