import { api } from "../api.js";
import { h, clear, field, input, errorBox, busy, toast, loading } from "../ui.js";
import { brand } from "../brand.js";
import { state, navigate } from "../state.js";
import { resetListState } from "./demands.js";

function authCard(title, body, wide = false) {
  return h("div", { class: "auth-wrap" }, h("div", { class: "auth" + (wide ? " wide" : "") }, brand(),
    h("div", { class: "panel pad stack" }, h("h1", null, title), body)));
}

export function login(app) {
  const user = input({ placeholder: "nome.sobrenome", autocomplete: "username" });
  const pass = input({ type: "password", autocomplete: "current-password" });
  const err = errorBox();
  const btn = h("button", { class: "btn primary", type: "submit", style: { width: "100%", justifyContent: "center" } }, "Entrar");
  const form = h("form", { class: "stack" },
    field("Login (parte antes do @ do seu e-mail)", user),
    field("Senha", pass), err, btn,
    h("div", { class: "small muted" }, "Ainda não tem acesso? ", h("a", { href: "#/registro" }, "Cadastre-se"), "."),
    h("div", { class: "small muted" }, "Esqueceu a senha? Procure o administrador do sistema para gerar uma senha temporária."));
  form.addEventListener("submit", busy(btn, async () => {
    const r = await api.post("/api/auth/login", { username: user.value, password: pass.value }, { noAuthRedirect: true });
    state.me = null;
    resetListState();
    navigate("inicio");
  }, err));
  app.appendChild(authCard("Entrar", form));
  setTimeout(() => user.focus(), 30);
}

export async function register(app) {
  app.appendChild(loading());
  let sectors = [];
  try { sectors = await api.get("/api/public/sectors"); } catch (e) { clear(app); app.appendChild(h("div", { class: "state error" }, e.message)); return; }
  clear(app);
  const f = {
    full_name: input({ autocomplete: "name" }),
    email: input({ type: "email", placeholder: "maria.souza@empresa.com.br", autocomplete: "email" }),
    password: input({ type: "password", autocomplete: "new-password" }),
    password2: input({ type: "password", autocomplete: "new-password" }),
    phone_corp: input({ type: "tel", placeholder: "+55 86 99999-0000" }),
    phone_personal: input({ type: "tel", placeholder: "Opcional" }),
  };
  const loginHint = h("div", { class: "hint" }, "Vale e-mail da Equatorial ou de empresa parceira. Seu login será a parte antes do @.");
  f.email.addEventListener("input", () => {
    const local = f.email.value.trim().toLowerCase().split("@")[0];
    loginHint.textContent = local ? `Seu login será: ${local}` : "Vale e-mail da Equatorial ou de empresa parceira. Seu login será a parte antes do @.";
  });
  const checks = sectors.map((s) => ({ s, cb: h("input", { type: "checkbox" }) }));
  const err = errorBox();
  const btn = h("button", { class: "btn primary", type: "submit" }, "Criar cadastro");
  const form = h("form", { class: "stack" },
    h("div", { class: "grid2" },
      field("Nome completo", f.full_name, { required: true }),
      h("div", null, field("E-mail", f.email, { required: true }), loginHint),
      field("Senha", f.password, { required: true, hint: "Mínimo 8 caracteres, combinando letras e números." }),
      field("Repita a senha", f.password2, { required: true }),
      field("Telefone corporativo", f.phone_corp, { required: true, hint: "Com DDD. Usado nas notificações do setor." }),
      field("Telefone pessoal", f.phone_personal)),
    h("div", null, h("div", { class: "small muted", style: { marginBottom: "6px" } }, "Setor(es) em que você trabalha *"),
      h("div", { class: "row" }, checks.map(({ s, cb }) => h("label", { class: "checkbox" }, cb, s.name)))),
    h("div", { class: "notice info small" }, "Todo cadastro entra como colaborador. Gerente e executivo/líder são definidos pelo administrador."),
    err, h("div", { class: "row" }, btn, h("a", { href: "#/login" }, "Voltar ao login")));
  form.addEventListener("submit", busy(btn, async () => {
    if (f.password.value !== f.password2.value) throw new Error("As senhas não conferem.");
    const ids = checks.filter((c) => c.cb.checked).map((c) => c.s.id);
    if (!ids.length) throw new Error("Selecione ao menos um setor.");
    await api.post("/api/auth/register", {
      full_name: f.full_name.value, email: f.email.value, password: f.password.value,
      phone_corp: f.phone_corp.value, phone_personal: f.phone_personal.value || null, sector_ids: ids,
    }, { noAuthRedirect: true });
    toast(`Cadastro realizado. Entre com o login ${f.email.value.trim().toLowerCase().split("@")[0]} e sua senha.`, "ok");
    navigate("login");
  }, err));
  app.appendChild(authCard("Criar acesso", form, true));
}

function passwordForm(onDone, { requireCurrent = true } = {}) {
  const cur = input({ type: "password", autocomplete: "current-password" });
  const nw = input({ type: "password", autocomplete: "new-password" });
  const nw2 = input({ type: "password", autocomplete: "new-password" });
  const err = errorBox();
  const btn = h("button", { class: "btn primary", type: "submit" }, "Trocar senha");
  const form = h("form", { class: "stack" },
    field(requireCurrent ? "Senha atual (ou temporária)" : "Senha atual", cur),
    field("Nova senha", nw, { hint: "Mínimo 8 caracteres, combinando letras e números." }), field("Repita a nova senha", nw2), err, btn);
  form.addEventListener("submit", busy(btn, async () => {
    if (nw.value !== nw2.value) throw new Error("As senhas não conferem.");
    await api.post("/api/auth/change-password", { current_password: cur.value, new_password: nw.value });
    cur.value = nw.value = nw2.value = "";
    await onDone();
  }, err));
  return form;
}

export function forceChangePassword(app) {
  app.appendChild(authCard("Troque a senha temporária", h("div", { class: "stack" },
    h("p", { class: "muted" }, "Por segurança, defina uma nova senha antes de usar o sistema."),
    passwordForm(async () => { state.me = null; toast("Senha alterada.", "ok"); navigate("inicio"); }),
    h("button", { class: "btn ghost", onclick: async () => { await api.post("/api/auth/logout"); state.me = null; navigate("login"); } }, "Sair"))));
}

export async function profile(main) {
  const me = await api.get("/api/auth/me");
  const name = input({ value: me.full_name });
  const pc = input({ type: "tel", value: me.phone_corp });
  const pp = input({ type: "tel", value: me.phone_personal || "" });
  const em = input({ type: "email", value: me.email || "" });
  const err = errorBox();
  const save = h("button", { class: "btn primary" }, "Salvar");
  save.addEventListener("click", busy(save, async () => {
    state.me = { ...state.me, ...(await api.patch("/api/auth/profile", { full_name: name.value, phone_corp: pc.value, phone_personal: pp.value, email: em.value })) };
    toast("Perfil atualizado.", "ok");
  }, err));
  main.append(
    h("div", { class: "page-head" }, h("h1", null, "Meu perfil")),
    h("div", { class: "split" },
      h("div", { class: "panel pad stack" },
        h("div", { class: "grid2" },
          field("Nome completo", name), field("Login", input({ value: me.username, disabled: true })),
          field("Telefone corporativo", pc, { required: true }), field("Telefone pessoal", pp, { hint: "Opcional. Visível apenas a você e ao administrador." }),
          field("E-mail corporativo", em, { hint: "Recebe os avisos de demandas novas, prazos e confirmações." }),
          field("Código curto (usado no código das demandas)", input({ value: me.short_code, disabled: true }))),
        err, h("div", null, save),
        h("h2", null, "Meus setores"),
        me.memberships.length ? h("div", null, me.memberships.map((m) => h("span", { class: "chip" }, `${m.sector_name} · ${m.role_label}`)))
          : h("div", { class: "muted" }, "Nenhum setor vinculado."),
        me.roles.is_admin ? h("div", { class: "notice info small" }, "Você é o administrador do sistema.") : null),
      h("div", { class: "panel pad stack" }, h("h2", null, "Trocar senha"), passwordForm(async () => toast("Senha alterada. Outras sessões foram encerradas.", "ok")))));
}
