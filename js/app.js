// Inicialização, roteamento por hash (compatível com subdiretório/GitHub Pages) e estrutura da página.
import { api, setAuthHandler } from "./api.js";
import { ready, BootError } from "./core/boot.js";
import { h, clear, icon, avatar, loading, errorState, actionMenu, toast } from "./ui.js";
import { state, navigate, isManager, isAdmin, loadSectors, refreshCounts, refreshOnline, onCounts } from "./state.js";
import { play, soundOn, setSound } from "./sounds.js";
import * as home from "./views/home.js";
import { brand } from "./brand.js";
import * as auth from "./views/auth.js";
import * as demands from "./views/demands.js";
import * as team from "./views/team.js";
import * as dashboard from "./views/dashboard.js";
import * as admin from "./views/admin.js";

const app = document.getElementById("app");
const HOME = "inicio";

const PUBLIC = { login: auth.login, registro: auth.register };

const ROUTES = [
  ["inicio", home.homePage],
  ["acompanhamento", demands.listPage],
  ["cadastro", demands.newDemand],
  ["demandas/:id", demands.detailPage],
  ["perfil", auth.profile],
  ["gestao/indicadores", dashboard.dashboardPage, "gestao"],
  ["gestao/equipe", team.teamPage, "gestao"],
  ["admin/setores", admin.sectorsPage, "admin"],
  ["admin/pessoas", admin.peoplePage, "admin"],
  ["admin/avisos", admin.avisosPage, "admin"],
  ["admin/dados", admin.dataPage, "admin"],
  ["admin/config", admin.configPage, "admin"],
];

// Rotas antigas (planner removido, páginas fundidas) levam às novas.
const LEGACY = {
  "meu-trabalho": HOME, modelos: HOME, convites: HOME, novas: HOME, minhas: "acompanhamento", criadas: "acompanhamento",
  acompanho: "acompanhamento", todas: "acompanhamento", setor: "acompanhamento", demandas: "acompanhamento",
  "demandas/nova": "cadastro", "nova-demanda": "cadastro", painel: "gestao/indicadores", equipe: "gestao/equipe",
  gestao: "gestao/indicadores", admin: "admin/setores", "admin/exportacoes": "admin/avisos", "admin/notificacoes": "admin/avisos", "admin/armazenamento": "admin/dados",
};

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query] = raw.split("?");
  return { path: path || HOME, query: new URLSearchParams(query || "") };
}

function match(path) {
  for (const [pattern, fn, area] of ROUTES) {
    const pp = pattern.split("/"), ap = path.split("/");
    if (pp.length !== ap.length) continue;
    const params = {};
    let ok = true;
    pp.forEach((seg, i) => { if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(ap[i]); else if (seg !== ap[i]) ok = false; });
    if (ok) return { fn, params, pattern, area };
  }
  return null;
}

// ---------------------------------------------------------------- menu
let shell = null;

function navItems() {
  const items = [
    { path: HOME, label: "Início", icon: "home", tone: "t-home", count: state.attention, match: (p) => p === HOME },
    { path: "acompanhamento", label: "Acompanhamento", icon: "track", tone: "t-track", match: (p) => p === "acompanhamento" || p.startsWith("demandas/") },
    { path: "cadastro", label: "Cadastro", icon: "plus", tone: "t-new", match: (p) => p === "cadastro" },
  ];
  if (isManager() || isAdmin()) items.push({ path: "gestao/indicadores", label: "Gestão", icon: "chart", tone: "t-mgmt", match: (p) => p.startsWith("gestao") });
  if (isAdmin()) items.push({ path: "admin/setores", label: "Administração", icon: "gear", tone: "t-admin", match: (p) => p.startsWith("admin") });
  return items;
}

function renderNav(sidebar, current) {
  clear(sidebar);
  for (const it of navItems()) {
    sidebar.appendChild(h("a", { class: "navitem" + (it.match(current) ? " active" : ""), href: "#/" + it.path, title: it.label,
      onclick: () => sidebar.classList.remove("open") },
    h("span", { class: "navicon " + it.tone }, icon(it.icon, 18)), h("span", { class: "lbl" }, it.label),
    it.count ? h("span", { class: "count", title: "Demandas que pedem sua atenção" }, it.count > 99 ? "99+" : it.count) : null));
  }
  const collapsed = document.body.classList.contains("menu-collapsed");
  sidebar.appendChild(h("button", { class: "navitem collapse btn ghost", style: { justifyContent: "flex-start", border: "0" },
    "aria-label": collapsed ? "Expandir menu" : "Recolher menu", title: collapsed ? "Expandir menu" : "Recolher menu",
    onclick: () => {
      const c = !document.body.classList.contains("menu-collapsed");
      document.body.classList.toggle("menu-collapsed", c);
      try { localStorage.setItem("painel.menuRecolhido", c ? "1" : "0"); } catch (_) { /* preferência visual opcional */ }
      renderNav(sidebar, parseHash().path);
    } }, h("span", null, collapsed ? "»" : "«"), h("span", { class: "lbl" }, "Recolher menu")));
}

function buildShell() {
  try { if (localStorage.getItem("painel.menuRecolhido") === "1") document.body.classList.add("menu-collapsed"); } catch (_) { /* ignora */ }
  const sidebar = h("nav", { class: "sidebar", "aria-label": "Menu principal" });
  const main = h("main", { class: "main" });
  const user = actionMenu(h("span", { class: "row", style: { gap: "8px" } }, avatar(state.me.full_name), h("span", { class: "uname" }, state.me.full_name.split(" ")[0])), [
    { label: "Meu perfil", onClick: () => navigate("perfil") },
    { label: "Sair", onClick: async () => { await api.post("/api/auth/logout"); state.me = null; navigate("login"); } },
  ], { btnClass: "usermenu" });
  const soundBtn = h("button", { class: "iconbtn", type: "button" });
  const renderSound = () => { clear(soundBtn).appendChild(icon(soundOn() ? "sound" : "mute", 19)); soundBtn.title = soundOn() ? "Sons ligados (clique para silenciar)" : "Sons desligados"; soundBtn.setAttribute("aria-label", soundBtn.title); };
  soundBtn.addEventListener("click", () => { setSound(!soundOn()); renderSound(); play("envio"); });
  renderSound();
  const roleTxt = isAdmin() ? "Administrador" : isManager() ? "Gestor" : "Colaborador";
  const top = h("header", { class: "topbar" },
    h("button", { class: "iconbtn mobile-nav-toggle", "aria-label": "Abrir menu", onclick: () => sidebar.classList.toggle("open") }, icon("menu", 20)),
    brand(), h("span", { class: "grow" }), soundBtn, h("span", { class: "role-pill" }, roleTxt), user);
  const root = h("div", null, top, h("div", { class: "layout" }, sidebar, main));
  onCounts(() => renderNav(sidebar, parseHash().path));
  return { root, main, sidebar };
}

// ---------------------------------------------------------------- roteamento
let currentHash = location.hash;
let skipNext = false;

async function route() {
  if (skipNext) { skipNext = false; return; }
  // Aviso antes de sair com texto não enviado.
  if (state.leaveGuard && location.hash !== currentHash && state.leaveGuard()) {
    if (!confirm("Há uma mensagem não enviada. Sair desta demanda e descartar o texto?")) {
      skipNext = true; location.hash = currentHash; return;
    }
  }
  state.leaveGuard = null;
  try {
    await ready();
  } catch (e) {
    shell = null; clear(app);
    app.appendChild(bootScreen(e));
    return;
  }
  currentHash = location.hash;
  let { path, query } = parseHash();
  if (LEGACY[path] !== undefined || path.startsWith("tarefas/")) { navigate(LEGACY[path] || HOME); return; }
  if (PUBLIC[path]) { shell = null; clear(app); PUBLIC[path](app, query); return; }
  if (!state.me) {
    try {
      state.me = await api.get("/api/auth/me", { noAuthRedirect: true });
    } catch (e) {
      if (e.status === 401) { navigate("login"); return; }
      clear(app); app.appendChild(errorState(e, route)); return;
    }
  }
  if (state.me.must_change_password) { shell = null; clear(app); auth.forceChangePassword(app); return; }
  if (!state.sectors.length) { try { await loadSectors(); } catch (_) { /* tenta depois */ } }
  if (!shell) { shell = buildShell(); clear(app); app.appendChild(shell.root); refreshOnline(); }
  refreshCounts();
  renderNav(shell.sidebar, path);
  const m = match(path);
  clear(shell.main);
  if (!m) { navigate(HOME); return; }
  if (m.area === "admin" && !isAdmin()) { navigate(HOME); return; }
  if (m.area === "gestao" && !(isManager() || isAdmin())) { navigate(HOME); return; }
  shell.main.appendChild(loading());
  window.scrollTo(0, 0);
  try {
    const container = h("div");
    const after = await m.fn(container, m.params, query);
    clear(shell.main);
    shell.main.appendChild(container);
    if (typeof after === "function") after(); // ex.: restaurar rolagem da lista
  } catch (e) {
    clear(shell.main);
    shell.main.appendChild(errorState(e, route));
  }
}

// Tela quando o painel não abre (sem chave, chave errada, sem internet).
function bootScreen(e) {
  const keyErr = e instanceof BootError && e.kind === "key";
  const inp = h("input", { type: "password", placeholder: "Cole aqui a chave de acesso", autocomplete: "off", id: "boot-key" });
  const msg = h("div", { class: "form-error" + (keyErr || !(e instanceof BootError) ? "" : " hidden") }, e.message);
  const btn = h("button", { class: "btn primary", type: "submit" }, "Abrir o painel");
  const form = h("form", { class: "stack" }, msg, keyErr ? h("div", { class: "f" }, h("label", { for: "boot-key" }, h("span", null, "Chave de acesso")), inp) : null,
    keyErr ? btn : h("button", { class: "btn primary", type: "button", onclick: () => route() }, "Tentar de novo"),
    h("div", { class: "small muted" }, keyErr ? "A chave vem no link que o administrador compartilhou. Depois do primeiro acesso, este navegador lembra dela." : ""));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    btn.disabled = true; btn.textContent = "Abrindo…";
    try { await ready(inp.value.trim()); route(); }
    catch (err) { msg.textContent = err.message; msg.classList.remove("hidden"); btn.disabled = false; btn.textContent = "Abrir o painel"; }
  });
  return h("div", { class: "auth-wrap" }, h("div", { class: "auth" }, brand(), h("div", { class: "panel pad stack" }, h("h1", null, "Painel de Demandas"), form)));
}

export async function reloadMe() { state.me = await api.get("/api/auth/me"); }

setAuthHandler((status) => {
  if (status === 401) { state.me = null; shell = null; if (parseHash().path !== "login") navigate("login"); }
  if (status === 428 && state.me) { state.me.must_change_password = true; route(); }
});

window.addEventListener("hashchange", route);
window.addEventListener("painel:nova", (e) => { play("nova"); toast(e.detail > 1 ? `${e.detail} novidades para você.` : "Chegou uma novidade para você.", "ok"); });
window.addEventListener("beforeunload", (e) => { if (state.leaveGuard && state.leaveGuard()) { e.preventDefault(); e.returnValue = ""; } });
route();

// Presença aproximada: um sinal por minuto enquanto a aba está visível (sem histórico no servidor).
setInterval(() => {
  if (state.me && !state.me.must_change_password && document.visibilityState === "visible") api.post("/api/presence/heartbeat").catch(() => {});
}, 60000);
// Quando chegam dados novos do repositório, atualiza contadores e quem está online.
window.addEventListener("painel:dados", () => { if (state.me) { refreshCounts(); refreshOnline(); } });
setInterval(() => { if (state.me && document.visibilityState === "visible") { refreshCounts(); refreshOnline(); } }, 60000);
