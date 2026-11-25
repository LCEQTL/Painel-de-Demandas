// Administração: setores, pessoas (inclui cadastro em massa), avisos, dados e configurações.
import { api, qs, saveFile } from "../api.js";
import {
  h, clear, fmtDateTime, empty, errorState, toast, busy, errorBox, modal, field, input, select,
  personPicker, loading, confirmDialog, subnav, sectorChip,
} from "../ui.js";
import { state, navigate, loadSectors } from "../state.js";
import { removeDialog, showTempPassword } from "./team.js";
import { getStore, getConfig, getKey } from "../core/boot.js";
import { buildEmail, digestFor } from "../core/avisos.js";
import { buildAnalysis } from "../core/analytics.js";
import { makeXlsx } from "../core/xlsx.js";
import { nowIso, ROLE_LABEL, todayLocal } from "../core/logic.js";

const ADMIN = [["admin/setores", "Setores"], ["admin/pessoas", "Pessoas"], ["admin/avisos", "Avisos"], ["admin/dados", "Dados"], ["admin/config", "Configurações"]];
function adminHead(main, path) { main.append(h("div", { class: "page-head" }, h("h1", null, "Administração")), subnav(ADMIN, path)); }
const ROLE_OPTS = [{ value: "colaborador", label: "Colaborador" }, { value: "gestor", label: "Gestor" }, { value: "gerente", label: "Gerente" }];

// ---------------------------------------------------------------- setores
export async function sectorsPage(main) {
  adminHead(main, "admin/setores");
  const list = await api.get("/api/admin/sectors");
  const side = h("div", { class: "panel pad sticky" });
  const edit = (s) => clear(side).appendChild(sectorEditor(s));
  edit(null);
  main.append(
    h("div", { class: "page-head" }, h("div", null, h("h2", null, "Setores"), h("div", { class: "small muted" }, "Gerentes e gestores veem e redistribuem as demandas do setor. O gerente principal recebe o que chega sem pessoa definida, e os gerentes recebem as cobranças de atraso.")),
      h("span", { class: "spacer" }), h("button", { class: "btn primary", onclick: () => edit(null) }, "+ Novo setor")),
    h("div", { class: "split wide-right" },
      h("div", { class: "panel" }, h("div", { class: "scroll-x" }, h("table", { class: "list" },
        h("thead", null, h("tr", null, h("th", null, "Setor"), h("th", null, "Sigla"), h("th", null, "Gerentes e gestores"), h("th", null, "Gerente principal"), h("th", { class: "hide-sm" }, "Pessoas"), h("th", { class: "hide-sm" }, "Abertas"), h("th", null, "Situação"))),
        h("tbody", null, list.map((s) => {
          const tr = h("tr", { class: "click" }, h("td", null, sectorChip(s)), h("td", null, s.acronym),
            h("td", null, s.managers.map((m) => `${m.name} (${ROLE_LABEL[m.role]})`).join(", ") || h("span", { class: "muted" }, "—")),
            h("td", null, s.primary_manager ? s.primary_manager.name : h("span", { class: "badge b-orange" }, "Sem gerente principal")),
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
  const acr = input({ value: s ? s.acronym : "", maxlength: 8 });
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
  const primary = select([{ value: "", label: "— sem gerente principal —" }, ...s.managers.map((m) => ({ value: m.id, label: `${m.name} (${ROLE_LABEL[m.role]})` }))], s.primary_manager ? s.primary_manager.id : "");
  save.addEventListener("click", busy(save, async () => {
    const body = { name: name.value, acronym: acr.value, active: active.checked, color: color.value };
    if (primary.value) body.primary_manager_id = Number(primary.value); else body.clear_primary = true;
    await api.patch(`/api/admin/sectors/${s.id}`, body); toast("Setor salvo.", "ok"); await done();
  }, err));
  const managers = h("div", null, s.managers.length ? s.managers.map((m) => h("span", { class: "chip" }, `${m.name} · ${ROLE_LABEL[m.role]}`,
    h("button", { title: "Voltar a colaborador", onclick: async () => {
      if (!(await confirmDialog("Tirar o perfil", `${m.name} continuará no setor como colaborador.`, "Confirmar"))) return;
      try { await api.del(`/api/admin/sectors/${s.id}/managers/${m.id}`); await done(); } catch (e) { toast(e.message, "err"); }
    } }, "×"))) : h("span", { class: "muted small" }, "Nenhum gerente ou gestor."));
  const asRole = select([{ value: "gerente", label: "como Gerente" }, { value: "gestor", label: "como Gestor" }], "gerente");
  const picker = personPicker({ placeholder: "Adicionar pessoa…", exclude: s.managers.map((m) => m.id), onPick: async (p) => {
    try { await api.post(`/api/admin/sectors/${s.id}/managers`, { user_id: p.id, role: asRole.value }); toast(`${p.name} agora é ${ROLE_LABEL[asRole.value].toLowerCase()} de ${s.name}.`, "ok"); await done(); } catch (e) { toast(e.message, "err"); }
  } });
  return h("div", { class: "stack" }, h("h2", null, "Editar setor"),
    h("div", { class: "grid2" }, field("Nome do setor", name, { required: true }), field("Sigla", acr, { required: true })),
    field("Cor de identificação", color.el),
    field("Gerentes e gestores", h("div", { class: "stack" }, managers, h("div", { class: "row" }, h("div", { style: { flex: 1, minWidth: "180px" } }, picker), asRole)), { hint: "Gerente e gestor têm o mesmo acesso. Gerentes recebem as cobranças de atraso da equipe." }),
    field("Gerente principal", primary, { hint: "Recebe as demandas enviadas ao setor sem pessoa indicada." }),
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
            h("td", null, u.memberships.map((m) => `${m.acronym} · ${m.is_primary ? "Gerente principal" : m.role_label}`).join(", ") || h("span", { class: "muted" }, "—")),
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
        try { await api.post(`/api/admin/users/${u.id}/role`, { sector_id: m.sector_id, role: role.value }); await loadSectors(); toast("Perfil atualizado.", "ok"); reload(); }
        catch (e) { toast(e.message, "err"); role.value = m.role; }
      });
      return h("div", { class: "row", style: { justifyContent: "space-between", padding: "4px 0" } },
        h("span", { style: { flex: 1 } }, m.sector_name, m.is_primary ? h("span", { class: "small muted" }, " · gerente principal") : null), h("span", { style: { width: "140px" } }, role),
        h("button", { class: "btn sm ghost danger", onclick: () => removeDialog({ id: m.sector_id, name: m.sector_name }, { id: u.id, name: u.full_name }, reload) }, "Remover"));
    })) : h("div", { class: "muted small" }, "Sem vínculos."),
    addSector,
    h("h3", null, "Acesso"), h("div", { class: "row" }, reset, deact));
}

function deactivateDialog(u, reload) {
  const err = errorBox();
  const strategy = select([{ value: "primary_manager", label: "Gerente principal de cada setor" }, { value: "user", label: "Uma pessoa específica" }], "primary_manager");
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
    { name: "leia-me", rows: [["Como preencher"], ["Uma pessoa por linha. Copie as linhas (com o cabeçalho) e cole no painel."], ["email: obrigatório; o login é a parte antes do @. Vale e-mail de empresa parceira."], ["telefone: com DDD."], [`setor: sigla ou nome (${sectors}). Mais de um: separe com vírgula.`], ["perfil: Colaborador (padrão, pode deixar vazio), Gestor ou Gerente."]], widths: [100] }]));
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
        h("td", { class: x.erros.length ? "small" : "small", style: { color: x.erros.length ? "var(--red-fg)" : "var(--green-fg)" } }, x.erros.length ? x.erros.join(" ") : "Pronto")))))));
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
  const cfgPanel = (() => {
    const enabled = h("input", { type: "checkbox", checked: !!c.enabled });
    const test = h("input", { type: "checkbox", checked: !!c.test_mode });
    const testEmail = input({ type: "email", value: c.test_email || "" });
    const num = (v) => input({ type: "number", min: 0, value: v, style: { width: "90px" } });
    const ws = num(c.work_start), we = num(c.work_end), dh = num(c.digest_hour), ra = num(c.remind_alta_hours), ru = num(c.remind_urgente_hours), esc = num(c.escalate_days);
    const wd = h("input", { type: "checkbox", checked: !!c.weekdays_only });
    const err = errorBox();
    const save = h("button", { class: "btn primary" }, "Salvar");
    save.addEventListener("click", busy(save, async () => {
      await api.put("/api/admin/settings/notifications", { enabled: enabled.checked ? 1 : 0, test_mode: test.checked ? 1 : 0, test_email: testEmail.value, work_start: ws.value, work_end: we.value,
        weekdays_only: wd.checked ? 1 : 0, digest_hour: dh.value, remind_alta_hours: ra.value, remind_urgente_hours: ru.value, escalate_days: esc.value });
      toast("Configuração salva. Vale a partir da próxima rodada.", "ok");
    }, err));
    return h("div", { class: "panel pad stack" }, h("h2", null, "Regras dos avisos"),
      h("label", { class: "checkbox" }, enabled, "Enviar avisos por e-mail"),
      h("label", { class: "checkbox" }, test, h("span", null, h("b", null, "Modo teste: "), "todos os e-mails vão para o endereço abaixo, com o destinatário original no assunto")),
      field("E-mail que recebe tudo no modo teste", testEmail),
      h("div", { class: "row" }, field("Horário: das", ws), field("às", we), field("Resumo diário às", dh), h("label", { class: "checkbox", style: { alignSelf: "end", paddingBottom: "8px" } }, wd, "Só dias úteis")),
      h("div", { class: "row" }, field("Lembrete se alta não for aberta em (h)", ra), field("Lembrete se urgente não for aberta em (h)", ru), field("Avisar o admin após (dias de atraso)", esc)),
      h("div", { class: "small muted" }, "Fora do horário, só demandas urgentes geram e-mail na hora; o resto entra no resumo do dia. Mensagens do chat não geram e-mail."),
      err, h("div", null, save));
  })();

  // prévia do e-mail de uma pessoa
  const people = [...db.users.values()].filter((u) => u.is_active).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const who = select(people.map((u) => ({ value: u.id, label: u.full_name })), (people.find((u) => !u.is_admin) || people[0] || {}).id);
  const frame = h("iframe", { title: "Prévia do e-mail", sandbox: "", style: { width: "100%", height: "520px", border: "1px solid var(--border)", borderRadius: "8px", background: "#fff" } });
  const subj = h("div", { class: "code", style: { whiteSpace: "normal", fontSize: "13px", color: "var(--text)" } });
  const renderPreview = () => {
    const u = db.users.get(Number(who.value));
    if (!u) return;
    const g = digestFor(db, u, nowIso(), null);
    const mail = buildEmail(db, u, [], g, { appUrl: getConfig().app_url, key: getKey(), now: nowIso(), testMode: !!c.test_mode });
    subj.textContent = "Assunto: " + mail.subject;
    frame.srcdoc = mail.html;
  };
  who.addEventListener("change", renderPreview);
  setTimeout(renderPreview, 0);

  // log
  const log = data.log || [];
  const logPanel = h("div", { class: "panel" }, h("div", { style: { padding: "10px 12px" } }, h("h2", null, `Últimos envios (${log.length})`),
    h("div", { class: "small muted" }, data.last_digest ? `Último resumo diário: ${data.last_digest.split("-").reverse().join("/")}` : "Nenhum resumo diário enviado ainda. A rotina roda no GitHub a cada 20 minutos e quando alguém mexe numa demanda.")),
  log.length ? h("div", { class: "scroll-x", style: { maxHeight: "380px", overflowY: "auto" } }, h("table", { class: "list" }, h("thead", null, h("tr", null, ["Quando", "Para", "Assunto", "Situação"].map((x) => h("th", null, x)))),
    h("tbody", null, log.map((x) => h("tr", null, h("td", { class: "nowrap small" }, fmtDateTime(x.at)), h("td", null, x.name, h("div", { class: "small muted" }, x.email || "")),
      h("td", { class: "small" }, x.subject), h("td", null, h("span", { class: "badge " + (x.status === "enviado" ? "b-green" : "b-neutral") }, x.status))))))) : h("div", { class: "pad" }, empty("Nada enviado ainda.")));

  // WhatsApp
  const zap = h("div", { class: "panel pad stack" }, h("h2", null, "Resumo de hoje para o WhatsApp"),
    h("div", { class: "small muted" }, "Mesmo conteúdo do resumo diário, uma linha por pessoa (nome, número e lista), para o script de envio."));
  const zapBtn = h("button", { class: "btn primary" }, "Baixar Excel (WhatsApp)");
  zapBtn.addEventListener("click", busy(zapBtn, async () => {
    const rows = await api.get("/api/admin/avisos/resumo");
    if (!rows.length) { toast("Ninguém tem pendências hoje.", ""); return; }
    saveFile(`whatsapp_${todayLocal()}.xlsx`, makeXlsx([{ name: "por_pessoa", rows: [["nome", "numero", "lista", "quantidade", "email"], ...rows.map((r) => [r.nome, r.numero, r.lista, r.quantidade, r.email || ""])], widths: [30, 18, 90, 12, 34], text: new Set([1]) }]));
  }));
  zap.appendChild(h("div", null, zapBtn));

  main.append(
    h("div", { class: "notice small", style: { marginBottom: "12px" } }, "Os e-mails saem pela rotina do GitHub Actions, que abre uma issue no repositório ", h("b", null, data.avisos_repo || "painel-avisos"),
      "; o fluxo do Power Automate lê a issue e envia pelo Outlook. ", c.test_mode ? h("b", null, `Modo teste ligado: tudo vai para ${c.test_email || "(defina o e-mail)"}.`) : null),
    h("div", { class: "grid2", style: { alignItems: "start" } }, h("div", { class: "stack" }, cfgPanel, zap),
      h("div", { class: "panel pad stack" }, h("h2", null, "Prévia do resumo diário"), field("Pessoa", who), subj, frame,
        h("div", { class: "small muted" }, "É exatamente o e-mail que a pessoa recebe hoje às 8h, com o que está pendente agora."))),
    h("div", { style: { height: "14px" } }), logPanel);
}

// ---------------------------------------------------------------- dados
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
  main.append(h("div", { class: "grid2", style: { alignItems: "start" } },
    section("deadline_bands", "Faixas de prazo (dias corridos)", { yellow_max_days_left: "Amarelo: faltam até (dias)", orange_max_days_left: "Laranja: faltam até (dias)", red_max_days_late: "Vermelho: atraso até (dias)", darkred_max_days_late: "Vermelho escuro: atraso até (dias); acima = roxo" }),
    section("limits", "Limites de conteúdo", { max_text_chars: "Caracteres por texto", max_table_rows: "Linhas por tabela", max_table_cols: "Colunas por tabela", max_cell_chars: "Caracteres por célula", max_blocks: "Blocos por conteúdo", max_image_kb: "Tamanho máximo por imagem (KB)", max_images_per_content: "Imagens por conteúdo" },
      "As imagens já são reduzidas no navegador (até 1600 px, cerca de 350 KB) antes de enviar."),
    section("presence", "Presença (online)", { heartbeat_minutes: "Registrar atividade a cada (min)", online_minutes: "Considerar online por (min)" }, "Cada registro é uma gravação no GitHub; intervalos curtos gastam a cota mais rápido.")));
}
