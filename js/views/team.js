// Meu setor / Minha equipe: membros, cadastro de colaboradores pelos gerentes e executivos/líderes e presença.
import { api, qs } from "../api.js";
import { h, clear, fmtDateTime, empty, errorState, toast, busy, errorBox, modal, field, input, select, loading, subnav, sectorChip } from "../ui.js";
import { state, navigate, isAdmin, isManager } from "../state.js";

export const GESTAO = [["gestao/setor", "Demandas do setor"], ["gestao/indicadores", "Indicadores"], ["gestao/equipe", "Equipe"]];

export async function teamPage(main) {
  const groups = await api.get("/api/team");
  const box = h("div", { class: "stack" });
  if (!groups.length) box.appendChild(h("div", { class: "panel" }, empty("Você ainda não pertence a nenhum setor.")));
  for (const g of groups) {
    const rows = g.people.map((p) => h("tr", null,
      h("td", null, h("div", { class: "title" }, p.name), g.can_manage && p.username ? h("div", { class: "code" }, p.username) : null),
      h("td", null, ({ gerente: "Gerente", lider: "Executivo/Líder", gestor: "Executivo/Líder" })[p.role] || "Colaborador"),
      g.can_manage ? h("td", { class: "hide-sm" }, p.phone_corp || "") : null,
      g.can_manage ? h("td", { class: "hide-sm" }, fmtDateTime(p.last_login_at)) : null,
      g.can_manage ? h("td", null, !p.is_manager || isAdmin() ? h("button", { class: "btn sm ghost danger", onclick: () => removeDialog(g.sector, p) }, "Remover do setor") : null) : null));
    box.appendChild(h("div", { class: "panel" },
      h("div", { class: "row", style: { padding: "10px 12px" } }, h("h2", { style: { flex: 1 } }, sectorChip(state.sectors.find((x) => x.id === g.sector.id) || g.sector), g.sector.acronym !== g.sector.name ? h("span", { class: "small muted" }, ` ${g.sector.acronym}`) : null),
        g.can_manage ? h("button", { class: "btn sm", onclick: () => addExistingDialog(g.sector) }, "Incluir pessoa existente") : null,
        g.can_manage ? h("button", { class: "btn sm primary", onclick: () => createDialog(g.sector) }, "Cadastrar colaborador") : null),
      h("div", { class: "scroll-x" }, h("table", { class: "list" },
        h("thead", null, h("tr", null, h("th", null, "Nome"), h("th", null, "Papel"), g.can_manage ? h("th", { class: "hide-sm" }, "Telefone corporativo") : null,
          g.can_manage ? h("th", { class: "hide-sm" }, "Último login") : null, g.can_manage ? h("th", null) : null)),
        h("tbody", null, rows)))));
  }
  main.append(h("div", { class: "page-head" }, h("h1", null, "Gestão")),
  subnav(GESTAO, "gestao/equipe"), box);
  if (isAdmin() || isManager()) {
    const pbox = h("div", { class: "panel", style: { marginTop: "14px" } }, loading());
    main.appendChild(pbox);
    presenceTable(pbox);
  }
}

export async function presenceTable(box) {
  try {
    const res = await api.get("/api/presence");
    clear(box).append(
      h("div", { style: { padding: "10px 12px" } }, h("h2", null, `Presença (${res.people.length})`),
        h("div", { class: "small muted" }, `Aproximada: “online” significa atividade nos últimos ${res.online_window_minutes} minutos. Online não significa leitura de demanda. Visível ao administrador e aos gerentes e executivos/líderes.`)),
      res.people.length ? h("div", { class: "scroll-x" }, h("table", { class: "list" },
        h("thead", null, h("tr", null, h("th", null, "Nome"), h("th", null, "Presença"), h("th", null, "Último login"), h("th", { class: "hide-sm" }, "Última atividade"), h("th", { class: "hide-sm" }, "Motivo do acesso"))),
        h("tbody", null, res.people.map((p) => h("tr", null, h("td", null, p.name),
          h("td", null, h("span", { class: "presence" + (p.online ? " on" : "") }), p.online ? "Online" : "Offline"),
          h("td", null, fmtDateTime(p.last_login_at)), h("td", { class: "hide-sm" }, fmtDateTime(p.last_activity_at)),
          h("td", { class: "hide-sm small muted" }, p.reasons.join(", ")))))))
        : empty("Ninguém no seu escopo."));
  } catch (e) { clear(box).appendChild(errorState(e)); }
}

function createDialog(sector) {
  const f = { full_name: input(), email: input({ type: "email", placeholder: "nome.sobrenome@empresa.com.br" }), phone_corp: input({ type: "tel" }), phone_personal: input({ type: "tel" }) };
  const err = errorBox();
  modal({ title: `Cadastrar colaborador em ${sector.name}`, body: h("div", { class: "stack" },
    h("div", { class: "grid2" }, field("Nome completo", f.full_name, { required: true }), field("E-mail", f.email, { required: true, hint: "O login é a parte antes do @." }),
      field("Telefone corporativo", f.phone_corp, { required: true }), field("Telefone pessoal", f.phone_personal)),
    h("div", { class: "notice info small" }, "Uma senha temporária será exibida uma única vez. A pessoa deverá trocá-la no primeiro acesso."), err),
  actions: [{ label: "Cancelar" }, { label: "Cadastrar", class: "primary", errBox: err, onClick: async () => {
    const r = await api.post("/api/team/users", { full_name: f.full_name.value, email: f.email.value, phone_corp: f.phone_corp.value, phone_personal: f.phone_personal.value || null, sector_ids: [sector.id] });
    showTempPassword(r.username, r.temporary_password);
  } }] });
}

export function showTempPassword(username, pwd) {
  modal({ title: "Senha temporária", body: h("div", { class: "stack" },
    h("div", null, "Usuário: ", h("strong", null, username)),
    h("div", null, "Senha temporária: ", h("code", { style: { fontSize: "16px", background: "#f4f5f7", padding: "2px 8px", borderRadius: "4px" } }, pwd)),
    h("div", { class: "notice warn small" }, "Anote e entregue pessoalmente. Ela não será exibida novamente e deverá ser trocada no primeiro acesso.")),
  onClose: () => navigate(location.hash.replace(/^#\/?/, "")) });
}

function addExistingDialog(sector) {
  const q = input({ placeholder: "Buscar por nome ou login…" });
  const list = h("div");
  const search = async () => {
    const res = await api.get("/api/team/candidates" + qs({ q: q.value }));
    clear(list);
    for (const p of res) {
      const already = p.sectors.some((s) => s.id === sector.id);
      list.appendChild(h("div", { class: "row", style: { padding: "6px 0", borderBottom: "1px solid #eef0f4" } },
        h("div", { style: { flex: 1 } }, h("div", null, p.name), h("div", { class: "small muted" }, p.sectors.map((s) => s.name).join(", ") || "Sem setor")),
        already ? h("span", { class: "small muted" }, "Já pertence") : h("button", { class: "btn sm", onclick: async () => {
          try { await api.post("/api/team/memberships", { user_id: p.id, sector_id: sector.id }); toast(`${p.name} incluído(a) em ${sector.name}.`, "ok"); search(); }
          catch (e) { toast(e.message, "err"); }
        } }, "Incluir")));
    }
    if (!res.length) list.appendChild(empty("Ninguém encontrado."));
  };
  let t;
  q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(search, 250); });
  modal({ title: `Incluir pessoa em ${sector.name}`, body: h("div", { class: "stack" }, q, list), onClose: () => navigate("gestao/equipe") });
  search();
}

export function removeDialog(sector, person, onDone) {
  const err = errorBox();
  const strategy = select([{ value: "primary_manager", label: "Gerente do setor" }, { value: "user", label: "Outra pessoa do setor" }], "primary_manager");
  const target = select([{ value: "", label: "—" }], "");
  const targetWrap = field("Pessoa que recebe as demandas", target);
  targetWrap.classList.add("hidden");
  const redistribution = h("div", { class: "stack hidden" }, h("div", { class: "notice warn small" }), field("Redistribuir para", strategy), targetWrap);
  strategy.addEventListener("change", async () => {
    targetWrap.classList.toggle("hidden", strategy.value !== "user");
    if (strategy.value === "user") {
      const people = await api.get("/api/people/search" + qs({ sector_id: sector.id, limit: 50 }));
      clear(target);
      people.filter((p) => p.id !== person.id).forEach((p) => target.appendChild(h("option", { value: p.id }, p.name)));
    }
  });
  let needs = false;
  modal({ title: "Remover vínculo", body: h("div", { class: "stack" },
    h("p", null, `Remover ${person.name} do setor ${sector.name}? O histórico e a autoria de registros anteriores são preservados.`), redistribution, err),
  actions: [{ label: "Cancelar" }, { label: "Remover", class: "danger primary", errBox: err, onClick: async () => {
    const body = { user_id: person.id, sector_id: sector.id };
    if (needs) { body.strategy = strategy.value; if (strategy.value === "user") body.target_user_id = Number(target.value); }
    try {
      await api.post("/api/team/memberships/remove", body);
    } catch (e) {
      if (e.status === 409 && e.detail && e.detail.demands) {
        needs = true;
        redistribution.classList.remove("hidden");
        redistribution.firstChild.textContent = e.message + " Demandas: " + e.detail.demands.map((d) => d.code).join(", ");
        return false;
      }
      throw e;
    }
    toast("Vínculo removido.", "ok");
    onDone ? onDone() : navigate("gestao/equipe");
  } }] });
}
