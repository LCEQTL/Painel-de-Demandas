// Administração: setores, pessoas (inclui cadastro em massa), avisos, dados e configurações.
import { api, qs, saveFile } from "../api.js";
import {
  h, clear, fmtDateTime, empty, errorState, toast, busy, errorBox, modal, field, input, select,
  personPicker, loading, confirmDialog, subnav, sectorChip,
} from "../ui.js";
import { state, navigate, loadSectors } from "../state.js";
import { removeDialog, showTempPassword } from "./team.js";
import { getStore, getConfig, getKey } from "../core/boot.js";
import { buildEmail, buildTeams, digestFor, digestCount } from "../core/avisos.js";
import { buildAnalysis } from "../core/analytics.js";
import { makeXlsx } from "../core/xlsx.js";
import { nowIso, ROLE_LABEL, todayLocal } from "../core/logic.js";

const ADMIN = [["admin/setores", "Setores"], ["admin/pessoas", "Pessoas"], ["admin/origens", "Origens"], ["admin/avisos", "Avisos"], ["admin/dados", "Dados"], ["admin/config", "Configurações"]];
function adminHead(main, path) { main.append(h("div", { class: "page-head" }, h("h1", null, "Administração")), subnav(ADMIN, path)); }
const ROLE_OPTS = [{ value: "colaborador", label: "Colaborador" }, { value: "lider", label: "Executivo/Líder" }, { value: "gerente", label: "Gerente" }];

// ---------------------------------------------------------------- setores
export async function sectorsPage(main) {
  adminHead(main, "admin/setores");
  const list = await api.get("/api/admin/sectors");
  const side = h("div", { class: "panel pad sticky" });
  const edit = (s) => clear(side).appendChild(sectorEditor(s));
  edit(null);
  main.append(
    h("div", { class: "page-head" }, h("div", null, h("h2", null, "Setores"), h("div", { class: "small muted" }, "Cada setor tem um gerente, que recebe o que chega sem pessoa definida e as cobranças da equipe. Executivos/líderes são os delegados do gerente: veem e redistribuem as demandas do setor.")),
      h("span", { class: "spacer" }), h("button", { class: "btn primary", onclick: () => edit(null) }, "+ Novo setor")),
    h("div", { class: "split wide-right" },
      h("div", { class: "panel" }, h("div", { class: "scroll-x" }, h("table", { class: "list" },
        h("thead", null, h("tr", null, h("th", null, "Setor"), h("th", null, "Sigla"), h("th", null, "Gerente"), h("th", null, "Executivos/Líderes"), h("th", { class: "hide-sm" }, "Pessoas"), h("th", { class: "hide-sm" }, "Abertas"), h("th", null, "Situação"))),
        h("tbody", null, list.map((s) => {
          const tr = h("tr", { class: "click" }, h("td", null, sectorChip(s)), h("td", null, s.acronym),
            h("td", null, s.primary_manager ? s.primary_manager.name : h("span", { class: "badge b-orange" }, "Sem gerente")),
            h("td", null, s.managers.filter((m) => m.role === "lider").map((m) => m.name).join(", ") || h("span", { class: "muted" }, "—")),
            h("td", { class: "hide-sm" }, s.member_count), h("td", { class: "hide-sm" }, s.open_demands),
            h("td", null, s.active ? h("span", { class: "badge b-green" }, "Ativo") : h("span", { class: "badge b-neutral" }, "Inativo")));
          tr.addEventListener("click", () => { tr.parentElement.querySelectorAll(".selected").forEach((x) => x.classList.remove("selected")); tr.classList.add("selected"); edit(s); });
          return tr;
        }))))),
      side));
}

const PALETTE = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#db2777", "#0891b2", "#a16207", "#475569"];
function colorPicker(initial) {
  let value = initial || PALETTE[0];
  const box = h("div", { class: "swatches", role: "radiogroup", "aria-label": "Cor do setor" });
  const custom = input({ value, maxlength: 7, style: { width: "110px" }, "aria-label": "Cor personalizada (#RRGGBB)" });
  const render = () => {
    clear(box);
    for (const c of PALETTE) box.appendChild(h("button", { type: "button", class: "swatch" + (c === value ? " on" : ""), role: "radio", "aria-checked": String(c === value),
      "aria-label": "Cor " + c, title: c, style: { background: c }, onclick: () => { value = c; custom.value = c; render(); } }));
  };
  custom.addEventListener("input", () => { if (/^#[0-9a-fA-F]{6}$/.test(custom.value)) { value = custom.value.toLowerCase(); render(); } });
  render();
  return { el: h("div", { class: "row" }, box, custom), get value() { return value; } };
}

function sectorEditor(s) {
  const name = input({ value: s ? s.name : "" });
  const acr = input({ value: s ? s.acronym : "", maxlength: 5, style: { textTransform: "uppercase" } });
  const color = colorPicker(s ? s.color : null);
  const err = errorBox();
  const save = h("button", { class: "btn primary" }, s ? "Salvar" : "Criar setor");
  const done = async () => { await loadSectors(); navigate("admin/setores"); };
  if (!s) {
    save.addEventListener("click", busy(save, async () => { await api.post("/api/admin/sectors", { name: name.value, acronym: acr.value, color: color.value }); toast("Setor criado.", "ok"); await done(); }, err));
    return h("div", { class: "stack" }, h("h2", null, "Novo setor"), h("div", { class: "grid2" }, field("Nome do setor", name, { required: true }), field("Sigla", acr, { required: true })),
      field("Cor de identificação", color.el), err, save);
  }
  const active = h("input", { type: "checkbox", checked: s.active });
  save.addEventListener("click", busy(save, async () => {
    await api.patch(`/api/admin/sectors/${s.id}`, { name: name.value, acronym: acr.value, active: active.checked, color: color.value }); toast("Setor salvo.", "ok"); await done();
  }, err));
  const setRole = async (p, role, msg) => {
    try { await api.post(`/api/admin/sectors/${s.id}/managers`, { user_id: p.id, role }); toast(msg, "ok"); await done(); } catch (e) { toast(e.message, "err"); }
  };
  const unset = (m, what) => h("button", { title: "Voltar a colaborador", "aria-label": `Tirar ${m.name} de ${what}`, onclick: async () => {
    if (!(await confirmDialog("Tirar o perfil", `${m.name} continua no setor como colaborador.${m.role === "gerente" ? " O setor fica sem gerente até você escolher outro." : ""}`, "Confirmar"))) return;
    try { await api.del(`/api/admin/sectors/${s.id}/managers/${m.id}`); await done(); } catch (e) { toast(e.message, "err"); }
  } }, "×");
  const ger = s.managers.find((m) => m.role === "gerente");
  const lid = s.managers.filter((m) => m.role === "lider");
  const gerPicker = personPicker({ placeholder: ger ? "Trocar o gerente…" : "Escolher o gerente…", exclude: ger ? [ger.id] : [], onPick: async (p) => {
    if (ger && !(await confirmDialog("Trocar o gerente", `${p.name} passa a ser o gerente de ${s.name}. ${ger.name} passa a executivo/líder.`, "Trocar"))) return;
    setRole(p, "gerente", `${p.name} agora é gerente de ${s.name}.`);
  } });
  const lidPicker = personPicker({ placeholder: "Adicionar executivo/líder…", exclude: s.managers.map((m) => m.id), onPick: (p) => setRole(p, "lider", `${p.name} agora é executivo/líder de ${s.name}.`) });
  return h("div", { class: "stack" }, h("h2", null, "Editar setor"),
    h("div", { class: "grid2" }, field("Nome do setor", name, { required: true }), field("Sigla", acr, { required: true, hint: "Até 5 letras ou números." })),
    field("Cor de identificação", color.el),
    field("Gerente do setor", h("div", { class: "stack" },
      ger ? h("div", null, h("span", { class: "chip chip-ger" }, "★ ", ger.name, unset(ger, "gerente"))) : h("div", { class: "notice warn small" }, "Sem gerente: demandas sem pessoa definida não podem ser enviadas a este setor."),
      gerPicker), { hint: "Um por setor. Recebe o que chega sem pessoa definida e as cobranças de atraso da equipe." }),
    field("Executivos/Líderes", h("div", { class: "stack" },
      h("div", null, lid.length ? lid.map((m) => h("span", { class: "chip" }, m.name, unset(m, "executivo/líder"))) : h("span", { class: "muted small" }, "Nenhum.")),
      lidPicker), { hint: "Delegados do gerente: veem todas as demandas do setor, redistribuem e acessam a Gestão." }),
    h("label", { class: "checkbox" }, active, "Setor ativo"),
    err, save);
}

// ---------------------------------------------------------------- pessoas
export async function peoplePage(main) {
  adminHead(main, "admin/pessoas");
  const q = input({ type: "search", placeholder: "Buscar por nome ou login…" });
  const inactive = h("input", { type: "checkbox" });
  const listBox = h("div", { class: "panel" });
  const side = h("div", { class: "panel pad sticky" }, h("div", { class: "muted small" }, "Selecione uma pessoa para editar."));
  const load = async () => {
    clear(listBox).appendChild(loading());
    try {
      const users = await api.get("/api/admin/users" + qs({ q: q.value, include_inactive: inactive.checked ? "1" : "" }));
      clear(listBox).appendChild(users.length ? h("div", { class: "scroll-x" }, h("table", { class: "list" },
        h("thead", null, h("tr", null, h("th", null, "Nome"), h("th", null, "Setores e perfil"), h("th", { class: "hide-sm" }, "E-mail"), h("th", { class: "hide-sm" }, "Último acesso"), h("th", null, "Situação"))),
        h("tbody", null, users.map((u) => {
          const tr = h("tr", { class: "click" }, h("td", null, h("div", { class: "title" }, u.full_name), h("div", { class: "code" }, u.username)),
            h("td", null, u.memberships.map((m) => `${m.acronym} · ${m.role_label}`).join(", ") || h("span", { class: "muted" }, "—")),
            h("td", { class: "hide-sm small" }, u.email || h("span", { class: "muted" }, "sem e-mail")),
            h("td", { class: "hide-sm" }, fmtDateTime(u.last_login_at)),
            h("td", null, u.is_admin ? h("span", { class: "badge b-info" }, "Admin") : null, " ", u.is_active ? h("span", { class: "badge b-green" }, "Ativo") : h("span", { class: "badge b-neutral" }, "Desativado")));
          tr.addEventListener("click", () => { clear(side).appendChild(personEditor(u, load)); });
          return tr;
        })))) : empty("Ninguém encontrado."));
    } catch (e) { clear(listBox).appendChild(errorState(e, load)); }
  };
  let t;
  q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 250); });
  inactive.addEventListener("change", load);
  main.append(h("div", { class: "page-head" }, h("div", null, h("h2", null, "Pessoas"), h("div", { class: "small muted" }, "Contas com histórico não são excluídas: desative e redistribua.")),
    h("span", { class: "spacer" }), h("button", { class: "btn primary", onclick: () => importDialog(load) }, "Cadastro em massa")),
  h("div", { class: "split wide-right" }, h("div", null, h("div", { class: "panel pad row", style: { marginBottom: "12px" } }, h("div", { style: { flex: 1, minWidth: "200px" } }, q), h("label", { class: "checkbox" }, inactive, "Incluir desativados")), listBox), side));
  await load();
}

function personEditor(u, reload) {
  const name = input({ value: u.full_name });
  const login = input({ value: u.username });
  const pc = input({ value: u.phone_corp });
  const pp = input({ value: u.phone_personal || "" });
  const em = input({ type: "email", value: u.email || "" });
  const err = errorBox();
  const save = h("button", { class: "btn primary" }, "Salvar dados");
  save.addEventListener("click", busy(save, async () => {
    await api.patch(`/api/admin/users/${u.id}`, { full_name: name.value, username: login.value, phone_corp: pc.value, phone_personal: pp.value, email: em.value });
    toast("Dados salvos.", "ok"); reload();
  }, err));
  const addSector = select([{ value: "", label: "Incluir em setor…" }, ...state.sectors.filter((s) => !u.memberships.some((m) => m.sector_id === s.id)).map((s) => ({ value: s.id, label: s.name }))], "");
  addSector.addEventListener("change", async () => {
    if (!addSector.value) return;
    try { await api.post("/api/team/memberships", { user_id: u.id, sector_id: Number(addSector.value) }); toast("Vínculo incluído.", "ok"); reload(); } catch (e) { toast(e.message, "err"); }
  });
  const reset = h("button", { class: "btn" }, "Gerar senha temporária");
  reset.addEventListener("click", busy(reset, async () => {
    if (!(await confirmDialog("Recuperar acesso", `Gerar nova senha temporária para ${u.full_name}?`, "Gerar"))) return;
    const r = await api.post(`/api/admin/users/${u.id}/reset-password`); showTempPassword(u.username, r.temporary_password);
  }));
  const deact = u.is_admin ? null : u.is_active ? h("button", { class: "btn danger", onclick: () => deactivateDialog(u, reload) }, "Desativar conta")
    : h("button", { class: "btn", onclick: async () => { await api.post(`/api/admin/users/${u.id}/activate`); toast("Conta reativada.", "ok"); reload(); } }, "Reativar conta");
  return h("div", { class: "stack" }, h("h2", null, u.full_name), h("div", { class: "code" }, u.username + " · " + u.short_code),
    field("Nome completo", name), h("div", { class: "grid2" }, field("Login", login, { hint: "Parte antes do @." }), field("E-mail", em)),
    h("div", { class: "grid2" }, field("Telefone corporativo", pc), field("Telefone pessoal", pp)), err, save,
    h("h3", null, "Setores e perfil"),
    u.memberships.length ? h("div", null, u.memberships.map((m) => {
      const role = select(ROLE_OPTS, m.role);
      role.addEventListener("change", async () => {
        if (role.value === "gerente" && !(await confirmDialog("Gerente do setor", `${u.full_name} passa a ser o gerente de ${m.sector_name}. Se já houver um gerente, ele(a) passa a executivo/líder.`, "Confirmar"))) { role.value = m.role; return; }
        try { await api.post(`/api/admin/users/${u.id}/role`, { sector_id: m.sector_id, role: role.value }); await loadSectors(); toast("Perfil atualizado.", "ok"); reload(); }
        catch (e) { toast(e.message, "err"); role.value = m.role; }
      });
      return h("div", { class: "row", style: { justifyContent: "space-between", padding: "4px 0" } },
        h("span", { style: { flex: 1 } }, m.sector_name, null), h("span", { style: { width: "140px" } }, role),
        h("button", { class: "btn sm ghost danger", onclick: () => removeDialog({ id: m.sector_id, name: m.sector_name }, { id: u.id, name: u.full_name }, reload) }, "Remover"));
    })) : h("div", { class: "muted small" }, "Sem vínculos."),
    addSector,
    h("h3", null, "Acesso"), h("div", { class: "row" }, reset, deact));
}

function deactivateDialog(u, reload) {
  const err = errorBox();
  const strategy = select([{ value: "primary_manager", label: "Gerente de cada setor" }, { value: "user", label: "Uma pessoa específica" }], "primary_manager");
  let target = null;
  const who = h("div", { class: "small" });
  const picker = personPicker({ exclude: [u.id], onPick: (p) => { target = p; who.textContent = "Selecionado: " + p.name; } });
  const pickWrap = h("div", { class: "hidden" }, picker, who);
  strategy.addEventListener("change", () => pickWrap.classList.toggle("hidden", strategy.value !== "user"));
  const red = h("div", { class: "stack hidden" }, h("div", { class: "notice warn small" }), field("Redistribuir para", strategy), pickWrap);
  let needs = false;
  modal({ title: "Desativar conta", body: h("div", { class: "stack" }, h("p", null, `${u.full_name} não poderá mais entrar. Autoria e histórico são preservados.`), red, err),
    actions: [{ label: "Cancelar" }, { label: "Desativar", class: "danger primary", errBox: err, onClick: async () => {
      const body = {};
      if (needs) { body.strategy = strategy.value; if (strategy.value === "user") { if (!target) throw new Error("Selecione a pessoa."); body.target_user_id = target.id; } }
      try { await api.post(`/api/admin/users/${u.id}/deactivate`, body); }
      catch (e) {
        if (e.status === 409 && e.detail && e.detail.demands) { needs = true; red.classList.remove("hidden"); red.firstChild.textContent = e.message + " " + e.detail.demands.map((d) => d.code).join(", "); return false; }
        throw e;
      }
      toast("Conta desativada.", "ok"); reload();
    } }] });
}

// ---------------------------------------------------------------- cadastro em massa
const IMPORT_COLS = ["nome", "email", "telefone", "setor", "perfil"];
function parsePasted(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  const rows = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, "")));
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const head = rows[0].map(norm);
  const hasHeader = head.some((c) => ["nome", "email", "e-mail", "telefone", "setor", "perfil"].includes(c));
  const idx = hasHeader ? IMPORT_COLS.map((k) => head.findIndex((c) => c === k || (k === "email" && c === "e-mail"))) : [0, 1, 2, 3, 4];
  return rows.slice(hasHeader ? 1 : 0).map((r) => Object.fromEntries(IMPORT_COLS.map((k, i) => [k, idx[i] >= 0 ? r[idx[i]] || "" : ""])));
}
function importDialog(reload) {
  const ta = h("textarea", { rows: 8, placeholder: "nome\temail\ttelefone\tsetor\tperfil\nMaria Souza\tmaria.souza@equatorialenergia.com.br\t86 99999-0001\tSTC\tGerente", style: { fontFamily: "Consolas, monospace", fontSize: "13px" } });
  const file = h("input", { type: "file", accept: ".csv,.txt,.tsv", class: "hidden" });
  file.addEventListener("change", async () => { if (file.files[0]) ta.value = await file.files[0].text(); });
  const pwdMode = select([{ value: "temp", label: "Senha temporária diferente para cada pessoa (troca no 1º acesso)" }, { value: "fixed", label: "A mesma senha para todos" }], "temp");
  const pwd = input({ placeholder: "Senha para todos", class: "hidden" });
  pwdMode.addEventListener("change", () => pwd.classList.toggle("hidden", pwdMode.value !== "fixed"));
  const out = h("div");
  const err = errorBox();
  const sectors = state.sectors.map((s) => s.acronym).join(", ");
  const template = () => saveFile("modelo_cadastro_pessoas.xlsx", makeXlsx([{ name: "pessoas", rows: [IMPORT_COLS, ["Maria Souza", "maria.souza@equatorialenergia.com.br", "86 99999-0001", "STC", "Gerente"], ["João Lima", "joao.lima@parceira.com.br", "86 99999-0002", "REL", ""]], widths: [28, 38, 18, 14, 14], text: new Set([2]) },
    { name: "leia-me", rows: [["Como preencher"], ["Uma pessoa por linha. Copie as linhas (com o cabeçalho) e cole no painel."], ["email: obrigatório; o login é a parte antes do @. Vale e-mail de empresa parceira."], ["telefone: com DDD."], [`setor: sigla ou nome (${sectors}). Mais de um: separe com vírgula.`], ["perfil: Colaborador (padrão, pode deixar vazio), Executivo/Líder ou Gerente. Só um gerente por setor."]], widths: [100] }]));
  const previewBtn = h("button", { class: "btn" }, "Conferir");
  let lastRows = null;
  const doImport = h("button", { class: "btn primary hidden" }, "Cadastrar");
  previewBtn.addEventListener("click", busy(previewBtn, async () => {
    lastRows = parsePasted(ta.value);
    if (!lastRows.length) throw new Error("Cole as linhas da planilha.");
    const r = await api.post("/api/admin/users/import", { rows: lastRows, dry_run: true });
    clear(out).append(h("div", { class: "row", style: { margin: "6px 0" } }, h("strong", null, `${r.ok} pronta(s)`), r.errors ? h("span", { class: "badge b-red" }, `${r.errors} com erro`) : null,
      h("span", { class: "small muted" }, "Linhas com erro não são cadastradas.")),
    h("div", { class: "scroll-x", style: { maxHeight: "320px", overflowY: "auto" } }, h("table", { class: "list" }, h("thead", null, h("tr", null, ["#", "Nome", "Login", "Setores", "Perfil", "Situação"].map((x) => h("th", null, x)))),
      h("tbody", null, r.rows.map((x) => h("tr", { style: x.erros.length ? { background: "#fdf1f0" } : null }, h("td", null, x.linha), h("td", null, x.nome), h("td", { class: "code" }, x.login), h("td", null, x.setores), h("td", null, x.perfil),
        h("td", { class: x.erros.length ? "small" : "small", style: { color: x.erros.length ? "var(--red-fg)" : "var(--green-fg)" } }, x.erros.length ? x.erros.join(" ") : (x.avisos || []).length ? h("span", { style: { color: "var(--orange-fg)" } }, "Pronto · " + x.avisos.join(" ")) : "Pronto")))))));
    doImport.textContent = `Cadastrar ${r.ok} pessoa(s)`;
    doImport.classList.toggle("hidden", !r.ok);
  }, err));
  doImport.addEventListener("click", busy(doImport, async () => {
    if (pwdMode.value === "fixed" && !pwd.value.trim()) throw new Error("Informe a senha para todos.");
    const r = await api.post("/api/admin/users/import", { rows: lastRows, password: pwdMode.value === "fixed" ? pwd.value.trim() : null });
    await loadSectors();
    const rows = [["nome", "login", "senha", "email", "setores", "perfil"], ...r.created.map((c) => [c.nome, c.login, c.senha, c.email, c.setores, c.perfil])];
    clear(out).append(h("div", { class: "notice ok" }, `${r.created.length} pessoa(s) cadastrada(s).${r.skipped ? ` ${r.skipped} linha(s) ignorada(s).` : ""}`),
      h("div", { class: "row", style: { marginTop: "8px" } }, h("button", { class: "btn primary", onclick: () => saveFile(`acessos_${todayLocal()}.xlsx`, makeXlsx([{ name: "acessos", rows, widths: [28, 22, 14, 36, 14, 12] }])) }, "Baixar planilha de acessos"),
        h("span", { class: "small muted" }, "As senhas não aparecem de novo. Guarde a planilha e entregue a cada pessoa a sua.")));
    doImport.classList.add("hidden");
    reload();
  }, err));
  modal({ title: "Cadastro em massa", wide: true, body: h("div", { class: "stack" },
    h("div", { class: "small" }, "Cole as linhas copiadas do Excel (com o cabeçalho) ou abra um CSV. Colunas: ", h("b", null, "nome, email, telefone, setor, perfil"),
      ". Perfil vazio = Colaborador. O login é a parte antes do @. Siglas: ", sectors, "."),
    h("div", { class: "row" }, h("button", { class: "btn sm", onclick: template }, "Baixar modelo (Excel)"), h("button", { class: "btn sm", onclick: () => file.click() }, "Abrir CSV"), file),
    ta, field("Senha inicial", h("div", { class: "stack" }, pwdMode, pwd)), err, h("div", { class: "row" }, previewBtn, doImport), out) });
}

// ---------------------------------------------------------------- avisos
export async function avisosPage(main) {
  adminHead(main, "admin/avisos");
  const data = await api.get("/api/admin/avisos");
  const c = data.config;
  const db = getStore().db;
  const cfg = getConfig();

  // ---- saúde da rotina (GitHub Actions)
  const last = data.last_run_at;
  const ageMin = last ? Math.round((Date.now() - new Date(last).getTime()) / 60000) : null;
  const level = ageMin === null ? "bad" : ageMin <= 45 ? "ok" : ageMin <= 180 ? "mid" : "bad";
  const actionsUrl = `https://github.com/${cfg.owner}/${cfg.repo}/actions`;
  const health = h("div", { class: `health h-${level}` },
    h("div", { class: "hdot" }),
    h("div", { style: { flex: 1 } },
      h("b", null, ageMin === null ? "A rotina de avisos ainda não rodou" : ageMin <= 45 ? `Rotina de avisos funcionando · última rodada há ${ageMin < 1 ? "menos de 1" : ageMin} min` : `A rotina de avisos não roda há ${ageMin >= 120 ? Math.round(ageMin / 60) + " h" : ageMin + " min"}`),
      h("div", { class: "small" }, level === "ok"
        ? `${data.runs[0] ? `${data.runs[0].notificacoes} notificação(ões) na última rodada${data.runs[0].resumo ? ", com o resumo do dia" : ""}. ` : ""}Ela roda a cada 20 minutos e quando alguém mexe numa demanda.`
        : "Sem a rotina, nenhum e-mail ou Teams sai. Confira no GitHub: 1) a aba Actions tem o fluxo “Avisos do painel” e ele está ativo; 2) os segredos PAINEL_CHAVE (a palavra-chave) e AVISOS_TOKEN existem em Settings › Secrets and variables › Actions; 3) a última execução não falhou (clique nela para ver o motivo)."),
      data.last_digest ? h("div", { class: "small muted" }, `Último resumo diário: ${data.last_digest.split("-").reverse().join("/")}`) : null),
    h("a", { class: "btn sm", href: actionsUrl, target: "_blank", rel: "noopener" }, "Abrir o GitHub Actions"));

  // ---- configurações gerais
  const general = (() => {
    const enabled = h("input", { type: "checkbox", checked: !!c.enabled });
    const test = h("input", { type: "checkbox", checked: !!c.test_mode });
    const testEmail = input({ type: "email", value: c.test_email || "" });
    const num = (v, w = "80px") => input({ type: "number", min: 0, value: v, style: { width: w } });
    const ws = num(c.work_start), we = num(c.work_end), dh = num(c.digest_hour), ac = num(data.flow.auto_confirm_hours);
    const wd = h("input", { type: "checkbox", checked: !!c.weekdays_only });
    const ua = h("input", { type: "checkbox", checked: !!c.urgent_anytime });
    const err = errorBox();
    const save = h("button", { class: "btn primary" }, "Salvar");
    save.addEventListener("click", busy(save, async () => {
      await api.put("/api/admin/settings/notifications", { enabled: enabled.checked ? 1 : 0, test_mode: test.checked ? 1 : 0, test_email: testEmail.value, work_start: ws.value, work_end: we.value,
        weekdays_only: wd.checked ? 1 : 0, digest_hour: dh.value, urgent_anytime: ua.checked ? 1 : 0 });
      await api.put("/api/admin/settings/flow", { auto_confirm_hours: ac.value });
      toast("Configuração salva. Vale a partir da próxima rodada.", "ok");
    }, err));
    return h("div", { class: "panel pad stack" }, h("h2", null, "Geral"),
      h("label", { class: "checkbox" }, enabled, h("b", null, "Avisos ligados")),
      h("label", { class: "checkbox" }, test, h("span", null, h("b", null, "Modo teste: "), "tudo vai só para o e-mail abaixo, com o destinatário original no assunto")),
      field("E-mail do modo teste", testEmail),
      h("div", { class: "row" }, field("Horário comercial: das", ws), field("às", we), field("Resumo e avisos de prazo às", dh)),
      h("label", { class: "checkbox" }, wd, "Só dias úteis (seg a sex)"),
      h("label", { class: "checkbox" }, ua, "Urgentes saem a qualquer hora (fora do horário, o resto espera)"),
      h("div", { class: "row" }, field("Confirmar sozinha depois de (horas)", ac, { hint: "Se quem pediu não confirmar nem devolver. 0 = nunca." })),
      err, h("div", null, save));
  })();

  // ---- regras: quando, para quem e por onde
  const rulesPanel = (() => {
    const R = JSON.parse(JSON.stringify(data.rules));
    const groups = [...new Set(data.rule_defs.map((r) => r.group))];
    const toggle = (on, label, onClick, title) => h("button", { type: "button", class: "tg" + (on ? " on" : ""), "aria-pressed": String(on), title: title || label, onclick: onClick }, label);
    const tbody = h("tbody");
    const SHORT = { responsavel: "Responsável", quem_pediu: "Quem pediu", gerente: "Gerente", lideres: "Exec./Líderes", gerente_origem: "Gerente de quem pediu", acompanhantes: "Acompanhantes", admin: "Admin" };
    const render = () => {
      clear(tbody);
      for (const g of groups) {
        tbody.appendChild(h("tr", { class: "grp" }, h("td", { colspan: 4 }, g)));
        for (const def of data.rule_defs.filter((r) => r.group === g)) {
          const r = R[def.key];
          const n = def.n ? input({ type: "number", min: 0, value: r.n, style: { width: "64px" }, oninput: (e) => { r.n = Number(e.target.value); } }) : null;
          tbody.appendChild(h("tr", { class: r.on ? "" : "off" },
            h("td", null, h("label", { class: "switch" }, h("input", { type: "checkbox", checked: !!r.on, onchange: (e) => { r.on = e.target.checked ? 1 : 0; render(); } }), h("span", null))),
            h("td", null, h("div", { class: "rlabel" }, def.label), n ? h("div", { class: "row small", style: { gap: "6px", marginTop: "4px" } }, n, def.n) : null),
            h("td", null, def.key === "resumo" ? h("span", { class: "small muted" }, "Cada pessoa com pendência")
              : h("div", { class: "tgs" }, Object.keys(data.recipients).map((k) => toggle(r.to.includes(k), SHORT[k], () => { r.to = r.to.includes(k) ? r.to.filter((x) => x !== k) : [...r.to, k]; render(); }, data.recipients[k])))),
            h("td", null, h("div", { class: "tgs" },
              toggle(r.ch.includes("email"), "✉ E-mail", () => { r.ch = r.ch.includes("email") ? r.ch.filter((x) => x !== "email") : [...r.ch, "email"]; render(); }),
              toggle(r.ch.includes("teams"), "Teams", () => { r.ch = r.ch.includes("teams") ? r.ch.filter((x) => x !== "teams") : [...r.ch, "teams"]; render(); })))));
        }
      }
    };
    render();
    const err = errorBox();
    const save = h("button", { class: "btn primary" }, "Salvar regras");
    save.addEventListener("click", busy(save, async () => { await api.put("/api/admin/regras", { rules: R }); toast("Regras salvas. Valem a partir da próxima rodada.", "ok"); }, err));
    const reset = h("button", { class: "btn ghost", onclick: () => { for (const d of data.rule_defs) R[d.key] = JSON.parse(JSON.stringify(d.def)); render(); toast("Padrão restaurado. Clique em Salvar regras para valer.", ""); } }, "Voltar ao padrão");
    return h("div", { class: "panel pad stack" },
      h("div", { class: "row" }, h("h2", { style: { flex: 1 } }, "Regras: quando avisar, para quem e por onde"), reset, save),
      h("div", { class: "small muted" }, "Quem fez a ação nunca é avisado dela. Uma pessoa recebe um único e-mail/mensagem por rodada, juntando tudo o que for para ela. Avisos de prazo saem a partir do horário do resumo, em dias úteis."),
      h("div", { class: "scroll-x" }, h("table", { class: "list rules" }, h("thead", null, h("tr", null, h("th", null, "Ligada"), h("th", null, "Quando"), h("th", null, "Para quem"), h("th", null, "Canal"))), tbody)), err);
  })();

  // ---- prévia do resumo de uma pessoa (e-mail e Teams)
  const people = [...db.users.values()].filter((u) => u.is_active).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const who = select(people.map((u) => ({ value: u.id, label: u.full_name })), (people.find((u) => !u.is_admin) || people[0] || {}).id);
  const kind = select([{ value: "email", label: "E-mail" }, { value: "teams", label: "Teams" }], "email");
  const frame = h("iframe", { title: "Prévia", sandbox: "", style: { width: "100%", height: "480px", border: "1px solid var(--border)", borderRadius: "8px", background: "#fff" } });
  const subj = h("div", { class: "code", style: { whiteSpace: "normal", fontSize: "13px", color: "var(--text)" } });
  const renderPreview = () => {
    const u = db.users.get(Number(who.value));
    if (!u) return;
    const g = digestFor(db, u, nowIso(), null);
    const o = { appUrl: cfg.app_url, key: getKey(), now: nowIso(), testMode: !!c.test_mode };
    const mail = buildEmail(db, u, [], g, o);
    subj.textContent = (digestCount(g) ? "" : "(nada pendente hoje: esta pessoa não recebe resumo) ") + "Assunto: " + mail.subject;
    frame.srcdoc = kind.value === "email" ? mail.html
      : `<div style="font:14px 'Segoe UI',Arial,sans-serif;background:#f5f5f5;padding:16px"><div style="background:#fff;border-radius:6px;padding:12px 14px;box-shadow:0 1px 2px rgba(0,0,0,.1);max-width:520px"><div style="font-size:12px;color:#616161;margin-bottom:6px">Workflows · Power Automate</div>${buildTeams(db, u, [], g, o)}</div></div>`;
  };
  who.addEventListener("change", renderPreview); kind.addEventListener("change", renderPreview);
  setTimeout(renderPreview, 0);

  // ---- envios recentes
  const log = data.log || [];
  const logPanel = h("div", { class: "panel" }, h("div", { style: { padding: "10px 12px" } }, h("h2", null, `Últimos envios (${log.length})`)),
    log.length ? h("div", { class: "scroll-x", style: { maxHeight: "380px", overflowY: "auto" } }, h("table", { class: "list" }, h("thead", null, h("tr", null, ["Quando", "Para", "Assunto", "Canal", "Situação"].map((x) => h("th", null, x)))),
      h("tbody", null, log.map((x) => h("tr", null, h("td", { class: "nowrap small" }, fmtDateTime(x.at)), h("td", null, x.name, h("div", { class: "small muted" }, x.email || "")),
        h("td", { class: "small" }, x.subject), h("td", { class: "small nowrap" }, (x.canais || ["email"]).map((k) => (k === "email" ? "E-mail" : "Teams")).join(" + ")),
        h("td", null, h("span", { class: "badge " + (x.status === "enviado" ? "b-green" : "b-neutral") }, x.status))))))) : h("div", { class: "pad" }, empty("Nada enviado ainda.")));

  // ---- WhatsApp
  const zapBtn = h("button", { class: "btn" }, "Baixar Excel (WhatsApp)");
  zapBtn.addEventListener("click", busy(zapBtn, async () => {
    const rows = await api.get("/api/admin/avisos/resumo");
    if (!rows.length) { toast("Ninguém tem pendências hoje.", ""); return; }
    saveFile(`whatsapp_${todayLocal()}.xlsx`, makeXlsx([{ name: "por_pessoa", rows: [["nome", "numero", "lista", "quantidade", "email"], ...rows.map((r) => [r.nome, r.numero, r.lista, r.quantidade, r.email || ""])], widths: [30, 18, 90, 12, 34], text: new Set([1]) }]));
  }));
  const zap = h("div", { class: "panel pad stack" }, h("h2", null, "Resumo de hoje para o WhatsApp"),
    h("div", { class: "small muted" }, "Mesmo conteúdo do resumo diário, uma linha por pessoa (nome, número e lista), para o script de envio."), h("div", null, zapBtn));

  main.append(health,
    c.test_mode ? h("div", { class: "notice warn small", style: { margin: "10px 0" } }, h("b", null, "Modo teste ligado: "), `tudo vai só para ${c.test_email || "(defina o e-mail)"}.`) : null,
    h("div", { style: { height: "12px" } }), rulesPanel,
    h("div", { class: "grid2", style: { alignItems: "start", marginTop: "14px" } }, h("div", { class: "stack" }, general, zap),
      h("div", { class: "panel pad stack" }, h("h2", null, "Prévia do resumo das 8h"), h("div", { class: "row" }, h("div", { style: { flex: 1 } }, field("Pessoa", who)), field("Canal", kind)), subj, frame)),
    h("div", { style: { height: "14px" } }), logPanel);
}

// ---------------------------------------------------------------- origens do pedido
export async function origensPage(main) {
  adminHead(main, "admin/origens");
  const data = await api.get("/api/origens");
  let list = [...data.origens];
  const uso = new Map((data.uso || []).map((x) => [x.origem, x.demandas]));
  const box = h("div", { class: "stack" });
  const err = errorBox();
  const save = h("button", { class: "btn primary" }, "Salvar lista");
  const persist = async () => { const r = await api.put("/api/admin/origens", { origens: list }); list = r.origens; render(); toast("Lista salva.", "ok"); };
  save.addEventListener("click", busy(save, persist, err));
  const add = input({ placeholder: "Nova origem (ex.: Comitê de Perdas)", maxlength: 120 });
  const addIt = () => { const v = add.value.trim(); if (!v) return; if (list.some((x) => x.toLowerCase() === v.toLowerCase())) { toast("Já está na lista.", "err"); return; } list.push(v); add.value = ""; render(); };
  add.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addIt(); } });
  const render = () => {
    clear(box).append(
      list.length ? h("div", { class: "olist" }, list.map((o, i) => h("div", { class: "orow" },
        h("span", { class: "ograb" }, "⋮⋮"), h("span", { class: "oname" }, o), h("span", { class: "small muted" }, uso.get(o) ? `${uso.get(o)} demanda(s)` : ""),
        h("button", { class: "btn sm ghost", title: "Subir", disabled: i === 0, onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; render(); } }, "↑"),
        h("button", { class: "btn sm ghost", title: "Descer", disabled: i === list.length - 1, onclick: () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; render(); } }, "↓"),
        h("button", { class: "btn sm ghost danger", title: "Tirar da lista", onclick: () => { list.splice(i, 1); render(); } }, "Tirar")))) : empty("Lista vazia: o campo aceita só texto livre."),
      h("div", { class: "row" }, h("div", { style: { flex: 1 } }, add), h("button", { class: "btn", onclick: addIt }, "+ Adicionar")));
  };
  render();
  const livres = data.livres || [];
  main.append(h("div", { class: "grid2", style: { alignItems: "start" } },
    h("div", { class: "panel pad stack" }, h("h2", null, "Origens do pedido"),
      h("div", { class: "small muted" }, "Aparecem como lista suspensa em “Origem do pedido” (cadastro, edição e filtros). A pessoa ainda pode digitar outra. Tirar da lista não muda as demandas antigas."),
      box, err, h("div", null, save)),
    h("div", { class: "panel pad stack" }, h("h2", null, "Digitadas fora da lista"),
      h("div", { class: "small muted" }, "Textos livres mais usados. Clique para incluir na lista (depois salve)."),
      livres.length ? h("div", { class: "tgs" }, livres.map((x) => h("button", { type: "button", class: "tg", onclick: () => { if (!list.includes(x.origem)) { list.push(x.origem); render(); } } }, `+ ${x.origem} (${x.demandas})`)))
        : empty("Nenhuma por enquanto."))));
}

export async function dataPage(main) {
  adminHead(main, "admin/dados");
  const store = getStore();
  const cfg = getConfig();
  const db = store.db;
  const msgs = [...db.msgIndex.values()].reduce((a, l) => a + l.length, 0);
  const anal = h("button", { class: "btn primary" }, "Exportar para análise (JSON)");
  anal.addEventListener("click", () => {
    const stamp = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "_");
    saveFile(`analise_painel_${stamp}.json`, JSON.stringify(buildAnalysis(db)), "application/json");
  });
  const full = h("button", { class: "btn" }, "Baixar cópia completa (JSON)");
  full.addEventListener("click", busy(full, async () => {
    const messages = {};
    for (const did of db.msgIndex.keys()) messages[did] = await store.loadMessages(did);
    const dump = { formato: "painel-demandas-copia", gerado_em: new Date().toISOString(), setores: db.sectors, config: db.config,
      pessoas: [...db.users.values()].map(({ pwd, ...u }) => u), demandas: [...db.demands.values()], mensagens: messages };
    saveFile(`copia_painel_${todayLocal()}.json`, JSON.stringify(dump), "application/json");
  }));
  main.append(h("div", { class: "grid2", style: { alignItems: "start" } },
    h("div", { class: "panel pad stack" }, h("h2", null, "Onde ficam os dados"),
      h("div", null, "Repositório: ", h("b", null, `${cfg.owner}/${cfg.repo}`), ", branch ", h("b", null, cfg.dataBranch || "dados"), "."),
      h("div", null, `${db.demands.size} demandas · ${msgs} mensagens · ${db.users.size} pessoas · ${db.sectors.length} setores`),
      h("div", { class: "small muted" }, "Cada arquivo é cifrado (AES-256-GCM) antes de sair do navegador, inclusive as imagens. Cada alteração é um commit: o histórico do GitHub é o backup e mostra quem mudou o quê."),
      h("div", { class: "small muted" }, `Última versão carregada: ${(store.head || "").slice(0, 7)}`)),
    h("div", { class: "panel pad stack" }, h("h2", null, "Exportar"),
      h("div", { class: "small" }, h("b", null, "Para análise: "), "JSON sem textos, senhas, telefones ou e-mails. Junte os arquivos numa pasta e abra ", h("a", { href: "ferramentas/painel_analise.html", target: "_blank", rel: "noopener" }, "o painel de análise"), "."),
      h("div", null, anal),
      h("div", { class: "small" }, h("b", null, "Cópia completa: "), "todos os dados decifrados (sem senhas e sem as imagens). Guarde com cuidado: tem nomes, telefones e conversas."),
      h("div", null, full))));
}

// ---------------------------------------------------------------- configurações
export async function configPage(main) {
  adminHead(main, "admin/config");
  const s = await api.get("/api/admin/settings");
  const section = (key, title, labels, note) => {
    const inputs = Object.fromEntries(Object.keys(labels).map((k) => [k, input({ type: "number", min: 0, value: s[key][k] })]));
    const err = errorBox();
    const btn = h("button", { class: "btn primary" }, "Salvar");
    btn.addEventListener("click", busy(btn, async () => {
      await api.put(`/api/admin/settings/${key}`, Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, Number(el.value)])));
      toast("Configuração salva.", "ok");
    }, err));
    return h("div", { class: "panel pad stack" }, h("h2", null, title), note ? h("div", { class: "small muted" }, note) : null,
      h("div", { class: "grid2" }, Object.entries(labels).map(([k, l]) => field(l, inputs[k]))), err, h("div", null, btn));
  };
  const tokExp = input({ type: "date", value: s.token.expires || "" });
  const tokErr = errorBox();
  const tokBtn = h("button", { class: "btn primary" }, "Salvar");
  tokBtn.addEventListener("click", busy(tokBtn, async () => { await api.put("/api/admin/settings/token", { expires: tokExp.value }); toast("Validade salva.", "ok"); }, tokErr));
  const tokenPanel = h("div", { class: "panel pad stack" }, h("h2", null, "Token do GitHub"),
    h("div", { class: "small muted" }, "Se o token tiver validade, informe a data: 15 dias antes, o painel mostra um alerta para o administrador. Sem validade (token sem expiração), deixe em branco."),
    field("Vence em", tokExp), h("div", { class: "small" }, "Para trocar o token: abra o instalar_painel.html › “Trocar o token” (pede a palavra-chave) e atualize também o segredo AVISOS_TOKEN no GitHub, se for o mesmo token."),
    tokErr, h("div", null, tokBtn));
  main.append(h("div", { class: "grid2", style: { alignItems: "start" } },
    tokenPanel,
    section("flow", "Confirmação automática", { auto_confirm_hours: "Confirmar sozinha depois de (horas); 0 = nunca" }, "Quando quem pediu não confirma nem devolve a conclusão nesse tempo, a rotina de avisos confirma e registra na conversa."),
    section("deadline_bands", "Faixas de prazo (dias corridos)", { yellow_max_days_left: "Amarelo: faltam até (dias)", orange_max_days_left: "Laranja: faltam até (dias)", red_max_days_late: "Vermelho: atraso até (dias)", darkred_max_days_late: "Vermelho escuro: atraso até (dias); acima = roxo" }),
    section("limits", "Limites de conteúdo", { max_text_chars: "Caracteres por texto", max_table_rows: "Linhas por tabela", max_table_cols: "Colunas por tabela", max_cell_chars: "Caracteres por célula", max_blocks: "Blocos por conteúdo", max_image_kb: "Tamanho máximo por imagem (KB)", max_images_per_content: "Imagens por conteúdo" },
      "As imagens já são reduzidas no navegador (até 1600 px, cerca de 350 KB) antes de enviar."),
    section("presence", "Presença (online)", { heartbeat_minutes: "Registrar atividade a cada (min)", online_minutes: "Considerar online por (min)" }, "Cada registro é uma gravação no GitHub; intervalos curtos gastam a cota mais rápido.")));
}
