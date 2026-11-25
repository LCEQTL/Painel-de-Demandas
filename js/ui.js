// Utilidades de interface. Conteúdo de usuário é sempre inserido como texto (nunca innerHTML).
import { api } from "./api.js";

// Element.append nativo converteria null/false em texto ("null"); filtramos esses valores.
const _append = Element.prototype.append;
Element.prototype.append = function (...nodes) {
  return _append.apply(this, nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false));
};

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k === "value") el.value = v;
      else if (k === "checked") el.checked = !!v;
      else if (k === "disabled") el.disabled = !!v;
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// Ícones estáticos (strings constantes do próprio sistema).
const ICONS = {
  work: '<rect x="3" y="4" width="14" height="13" rx="2"/><path d="M7 8h6M7 11h6M7 14h3"/>',
  list: '<path d="M4 5h12M4 10h12M4 15h12"/>',
  user: '<circle cx="10" cy="7" r="3"/><path d="M4 17c1-3.5 3.5-5 6-5s5 1.5 6 5"/>',
  inbox: '<path d="M3 11l2-6h10l2 6v5H3z"/><path d="M3 11h4l1 2h4l1-2h4"/>',
  sector: '<path d="M3 17V7l7-4 7 4v10"/><path d="M8 17v-5h4v5"/>',
  chart: '<path d="M4 16V9M9 16V5M14 16v-4"/>',
  team: '<circle cx="7" cy="7" r="2.5"/><circle cx="14" cy="8" r="2"/><path d="M2.5 16c.8-3 2.5-4.5 4.5-4.5s3.7 1.5 4.5 4.5M12 12.5c2 0 3.4 1.2 4 3.5"/>',
  gear: '<circle cx="10" cy="10" r="2.5"/><path d="M10 2.5v2.5M10 15v2.5M2.5 10H5M15 10h2.5M4.7 4.7l1.8 1.8M13.5 13.5l1.8 1.8M4.7 15.3l1.8-1.8M13.5 6.5l1.8-1.8"/>',
  export: '<path d="M10 3v9M6 8l4 4 4-4M4 15h12"/>',
  db: '<ellipse cx="10" cy="5" rx="6" ry="2.5"/><path d="M4 5v10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5"/>',
  bell: '<path d="M6 13V9a4 4 0 018 0v4l1.5 2h-11z"/><path d="M8.5 17h3"/>',
  search: '<circle cx="8.5" cy="8.5" r="5"/><path d="M12.5 12.5L16 16"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  clock: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/>',
  template: '<rect x="4" y="3" width="12" height="14" rx="1.5"/><path d="M7 7h6M7 10h6M7 13h4"/>',
  mail: '<rect x="3" y="5" width="14" height="10" rx="1.5"/><path d="M3.5 6l6.5 5 6.5-5"/>',
  menu: '<path d="M3 6h14M3 10h14M3 14h14"/>',
  expand: '<path d="M12 3h5v5M8 17H3v-5M17 3l-6 6M3 17l6-6"/>',
  table: '<rect x="3" y="4" width="14" height="12" rx="1"/><path d="M3 8h14M3 12h14M8 4v12"/>',
  text: '<path d="M5 5h10M10 5v11"/>',
  link: '<path d="M8.5 11.5l3-3M7 9l-1.5 1.5a2.5 2.5 0 003.5 3.5L10.5 12.5M13 11l1.5-1.5A2.5 2.5 0 0011 6L9.5 7.5"/>',
  paste: '<rect x="5" y="4" width="10" height="13" rx="1.5"/><path d="M8 3h4v3H8z"/>',
  back: '<path d="M12 4l-6 6 6 6"/>',
  home: '<path d="M3 9.5L10 3l7 6.5"/><path d="M5 8v9h10V8"/><path d="M8.5 17v-4.5h3V17"/>',
  track: '<path d="M3 16l4.5-5 3.5 3 6-7"/><path d="M13 7h4v4"/>',
  megaphone: '<path d="M3 8v4h3l6 4V4L6 8H3z"/><path d="M15 7.5a3.5 3.5 0 010 5"/>',
  building: '<rect x="4" y="3" width="12" height="14" rx="1"/><path d="M8 7h1M11 7h1M8 10h1M11 10h1M9 17v-3h2v3"/>',
  check: '<path d="M4 10.5l4 4 8-9"/>',
  checks: '<path d="M2 10.5l4 4 7-8"/><path d="M9 14l1 .5 7-8"/>',
  x: '<path d="M5 5l10 10M15 5L5 15"/>',
  forward: '<path d="M11 5l5 5-5 5"/><path d="M16 10H8a4 4 0 00-4 4v2"/>',
  send: '<path d="M3 10l14-6-5 14-2.5-5.5L3 10z"/>',
  image: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><circle cx="7.5" cy="8.5" r="1.5"/><path d="M3 14l4-3.5 3 2.5 3-3 4 4"/>',
  sound: '<path d="M3 8v4h3l5 4V4L6 8H3z"/><path d="M14 7a4 4 0 010 6M16 5a7 7 0 010 10"/>',
  mute: '<path d="M3 8v4h3l5 4V4L6 8H3z"/><path d="M14 8l4 4M18 8l-4 4"/>',
  dots: '<circle cx="5" cy="10" r="1.3"/><circle cx="10" cy="10" r="1.3"/><circle cx="15" cy="10" r="1.3"/>',
  flag: '<path d="M5 17V3"/><path d="M5 4h9l-2 3.5L14 11H5"/>',
  route: '<circle cx="5" cy="5" r="2"/><circle cx="15" cy="15" r="2"/><path d="M7 5h5a3 3 0 010 6H8a3 3 0 000 6h5"/>',
  hourglass: '<path d="M6 3h8M6 17h8M7 3c0 4 6 4 6 7s-6 3-6 7M13 3c0 4-6 4-6 7s6 3 6 7"/>',
  undo: '<path d="M7 7L3 11l4 4"/><path d="M3 11h9a5 5 0 000-10H9"/>',
};

export function icon(name, size = 16) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 20 20");
  s.setAttribute("width", size);
  s.setAttribute("height", size);
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.6");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.innerHTML = ICONS[name] || ""; // constante interna, nunca dados do usuário
  return s;
}

// ---------------------------------------------------------------- formatação
const pad = (n) => String(n).padStart(2, "0");
export function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
export function fmtDateTime(iso) {
  // A API envia horários já em Brasília (ex.: 2026-10-28T10:15:00-03:00).
  if (!iso) return "—";
  return `${fmtDate(iso)} ${iso.slice(11, 16)}`;
}
export function todayBR() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts; // AAAA-MM-DD
}
export function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
export function fmtNumber(v, currency = false) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return currency ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : n.toLocaleString("pt-BR", { maximumFractionDigits: 6 });
}
export function fmtBytes(b) {
  if (b === null || b === undefined) return "—";
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / 1024 / 1024).toFixed(2) + " MB";
}
export function initials(name) {
  const p = (name || "?").trim().split(/\s+/);
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

export const STATUS = { aberta: "Pendente", aguardando_confirmacao: "Aguardando confirmação", concluida: "Concluída", cancelada: "Cancelada" };
export const PRIORITY = { normal: "Normal", alta: "Alta", urgente: "Urgente" };
const STATUS_ICON = { aberta: "hourglass", aguardando_confirmacao: "flag", concluida: "check", cancelada: "x" };

// Prazo: texto + cor; a data exata aparece junto (sem depender do mouse).
export function deadlineBadge(dl, due, { withDate = true } = {}) {
  return h("span", { class: "dl" }, h("span", { class: `dl-badge dl-${dl.level}` }, dl.label),
    withDate && due ? h("span", { class: "dl-date" }, fmtDate(due)) : null);
}
// Data do prazo colorida conforme a situação (para tabelas).
export function dueCell(d) {
  const lvl = d.deadline.level;
  return h("span", { class: `due due-${lvl}`, title: d.deadline.label }, fmtDate(d.due_date),
    ["red", "darkred", "purple", "orange"].includes(lvl) ? h("small", null, d.deadline.label) : null);
}
// Cada informação tem uma cor única e fixa (sempre com texto e ícone).
export function statusBadge(st) {
  return h("span", { class: `tag st-${st}` }, icon(STATUS_ICON[st] || "clock", 13), STATUS[st] || st);
}
export function priorityTag(p) {
  return h("span", { class: `tag pr-${p}` }, p === "normal" ? "" : "↑ ", PRIORITY[p] || p);
}
export function priorityMark(p) { return p && p !== "normal" ? h("span", { class: `prio ${p}` }, PRIORITY[p]) : null; }
export function conclusionTag(c, status) {
  if (c === "no_prazo") return h("span", { class: "tag cc-ok" }, icon("check", 13), "No prazo");
  if (c === "fora_prazo") return h("span", { class: "tag cc-late" }, icon("x", 13), "Fora do prazo");
  return h("span", { class: "tag cc-none" }, "—");
}
// "Pedido feito em / por": cor estável derivada do texto.
const SOURCE_HUES = [262, 200, 172, 228, 300, 188, 245, 160];
export function sourceTag(text) {
  if (!text) return h("span", { class: "muted small" }, "—");
  let hsh = 0;
  for (const ch of text.toLowerCase()) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = SOURCE_HUES[hsh % SOURCE_HUES.length];
  return h("span", { class: "tag src", title: "Pedido feito em / por: " + text, style: { background: `hsl(${hue} 70% 95%)`, color: `hsl(${hue} 45% 33%)`, borderColor: `hsl(${hue} 50% 85%)` } }, text);
}
export function avatar(name, online = false) {
  return h("span", { class: "avatar" + (online ? " on" : ""), title: online ? name + " · online" : name }, initials(name));
}
export function personTag(p, { online = false } = {}) {
  if (!p) return null;
  return h("span", { class: "person" }, avatar(p.name, online), h("span", { class: "pname" }, p.name));
}

// Identidade do setor: cor (vinculada ao ID) + nome; nunca só cor.
export function sectorChip(s, title) {
  if (!s) return null;
  const c = s.color || "#5b6b7f";
  return h("span", { class: "sec", title: title || s.name, style: { borderColor: c + "66", background: c + "14", color: c } },
    h("i", { style: { background: c } }), h("span", { class: "sn" }, s.name));
}
export function sectorFlow(origin, dest) {
  if (!origin || !dest) return null;
  if (origin.id === dest.id) return h("span", { class: "flow" }, sectorChip(dest, `Origem e setor atual: ${dest.name}`));
  return h("span", { class: "flow" }, sectorChip(origin, `Origem: ${origin.name}`), h("span", { class: "arrow", "aria-label": "para" }, "→"),
    sectorChip(dest, `Setor atual: ${dest.name}`));
}

// Menu de ações acessível por teclado (não usa <select> como menu de comandos).
export function actionMenu(label, items, { align = "right", btnClass = "btn" } = {}) {
  const list = items.filter(Boolean);
  const btn = h("button", { class: btnClass, type: "button", "aria-haspopup": "menu", "aria-expanded": "false" }, label, " ▾");
  const wrap = h("div", { class: "menu-wrap" }, btn);
  if (!list.length) return null;
  let menu = null;
  const close = (focusBtn) => {
    if (!menu) return;
    menu.remove(); menu = null; btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", outside);
    if (focusBtn) btn.focus();
  };
  const outside = (e) => { if (menu && !wrap.contains(e.target)) close(false); };
  const open = () => {
    menu = h("ul", { class: "menu" + (align === "left" ? " left" : ""), role: "menu" });
    for (const it of list) {
      if (it === "-") { menu.appendChild(h("li", { role: "separator" }, h("hr"))); continue; }
      const b = h("button", { role: "menuitem", class: it.danger ? "danger" : "", type: "button", tabindex: "-1",
        onclick: () => { close(false); it.onClick(); } }, it.label);
      menu.appendChild(h("li", { role: "none" }, b));
    }
    menu.addEventListener("keydown", (e) => {
      const els = Array.from(menu.querySelectorAll("[role=menuitem]"));
      const i = els.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); els[(i + 1) % els.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); els[(i - 1 + els.length) % els.length].focus(); }
      else if (e.key === "Home") { e.preventDefault(); els[0].focus(); }
      else if (e.key === "End") { e.preventDefault(); els[els.length - 1].focus(); }
      else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); close(true); }
    });
    wrap.appendChild(menu);
    btn.setAttribute("aria-expanded", "true");
    document.addEventListener("mousedown", outside);
    const first = menu.querySelector("[role=menuitem]");
    if (first) first.focus();
  };
  btn.addEventListener("click", () => (menu ? close(true) : open()));
  btn.addEventListener("keydown", (e) => { if ((e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") && !menu) { e.preventDefault(); open(); } });
  return wrap;
}

// Gaveta lateral para informações secundárias (não recria a tela principal).
export function drawer({ title, body, wide = false, onClose }) {
  const back = h("div", { class: "drawer-back" });
  const panel = h("aside", { class: "drawer" + (wide ? " wide" : ""), role: "dialog", "aria-modal": "true", "aria-label": title });
  const prevFocus = document.activeElement;
  const close = () => { back.remove(); panel.remove(); document.removeEventListener("keydown", esc); onClose && onClose(); if (prevFocus && prevFocus.focus) prevFocus.focus(); };
  const esc = (e) => { if (e.key === "Escape" && !document.querySelector(".modal-back")) close(); };
  const content = h("div", { class: "db" }, body);
  panel.append(h("div", { class: "dh" }, h("h2", null, title), h("button", { class: "iconbtn", "aria-label": "Fechar", onclick: close }, "✕")), content);
  back.addEventListener("click", close);
  document.addEventListener("keydown", esc);
  document.body.append(back, panel);
  setTimeout(() => panel.querySelector(".dh button").focus(), 20);
  return { close, setBody: (b) => { clear(content).appendChild(b); } };
}

// ---------------------------------------------------------------- estados
export const loading = (txt = "Carregando…") => h("div", { class: "state" }, h("span", { class: "loader" }), txt);
export const empty = (txt) => h("div", { class: "state" }, txt);
export const errorState = (err, retry) => h("div", { class: "state error" }, err.message || String(err), " ",
  retry ? h("button", { class: "btn sm", onclick: retry }, "Tentar novamente") : null);

export function toast(msg, kind = "") {
  const t = h("div", { class: `toast ${kind}` }, msg);
  document.getElementById("toasts").appendChild(t);
  setTimeout(() => t.remove(), kind === "err" ? 6500 : 3500);
}

// Botão com estado de salvamento e exibição de erro.
export function busy(btn, fn, errBox) {
  return async (ev) => {
    if (ev) ev.preventDefault();
    if (btn.disabled) return;
    const old = Array.from(btn.childNodes);
    btn.disabled = true;
    clear(btn); append(btn, [h("span", { class: "spin" }), "Salvando…"]);
    if (errBox) { clear(errBox); errBox.classList.add("hidden"); }
    try {
      await fn();
    } catch (e) {
      if (errBox) { errBox.textContent = e.message; errBox.classList.remove("hidden"); } else toast(e.message, "err");
    } finally {
      btn.disabled = false;
      clear(btn); append(btn, old);
    }
  };
}

export function errorBox() { return h("div", { class: "form-error hidden" }); }

// ---------------------------------------------------------------- modal
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const back = h("div", { class: "modal-back" });
  const close = () => { back.remove(); document.removeEventListener("keydown", esc); onClose && onClose(); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", esc);
  const foot = h("div", { class: "mf" });
  const m = h("div", { class: "modal" + (wide ? " wide" : ""), role: "dialog", "aria-modal": "true" },
    h("div", { class: "mh" }, h("h2", null, title), h("button", { class: "iconbtn", "aria-label": "Fechar", onclick: close }, "✕")),
    h("div", { class: "mb" }, body), foot);
  for (const a of actions) {
    const b = h("button", { class: "btn " + (a.class || "") }, a.label);
    b.addEventListener("click", a.onClick ? busy(b, async () => { const r = await a.onClick(); if (r !== false) close(); }, a.errBox) : close);
    foot.appendChild(b);
  }
  if (!actions.length) foot.appendChild(h("button", { class: "btn", onclick: close }, "Fechar"));
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  back.appendChild(m);
  document.body.appendChild(back);
  const first = m.querySelector("input, select, textarea");
  if (first) setTimeout(() => first.focus(), 30);
  return { close, el: m };
}

export function confirmDialog(title, text, okLabel = "Confirmar", danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title, body: h("p", null, text),
      actions: [{ label: "Cancelar" }, { label: okLabel, class: danger ? "danger primary" : "primary", onClick: () => { done = true; resolve(true); } }],
      onClose: () => { if (!done) resolve(false); },
    });
    return m;
  });
}

// ---------------------------------------------------------------- campos
export function field(label, input, { required = false, hint } = {}) {
  // <label> só envolve controles nativos simples; um editor ou grupo de botões dentro de <label>
  // faria cliques serem redirecionados ao primeiro botão.
  const simple = input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement;
  return h(simple ? "label" : "div", { class: "f" }, h("span", null, label, required ? h("span", { class: "req" }, " *") : null), input,
    hint ? h("div", { class: "small muted", style: { marginTop: "3px" } }, hint) : null);
}
export function input(attrs = {}) { return h("input", { type: "text", ...attrs }); }
export function select(options, value, attrs = {}) {
  const s = h("select", attrs);
  for (const o of options) {
    const opt = h("option", { value: o.value }, o.label);
    if (String(o.value) === String(value ?? "")) opt.selected = true;
    s.appendChild(opt);
  }
  return s;
}

// Seletor de pessoas: busca mostra apenas nome, setor e papel.
export function personPicker({ placeholder = "Buscar pessoa…", sectorId = null, onPick, exclude = [] } = {}) {
  const inp = input({ placeholder, autocomplete: "off" });
  const box = h("div", { class: "opts hidden" });
  const wrap = h("div", { class: "picker" }, inp, box);
  let timer;
  const search = async () => {
    const q = inp.value.trim();
    try {
      const params = new URLSearchParams({ q });
      if (typeof sectorId === "function" ? sectorId() : sectorId) params.set("sector_id", typeof sectorId === "function" ? sectorId() : sectorId);
      const res = await api.get("/api/people/search?" + params.toString());
      clear(box);
      const list = res.filter((p) => !exclude.includes(p.id));
      if (!list.length) box.appendChild(h("div", { class: "opt muted" }, "Ninguém encontrado"));
      for (const p of list) {
        box.appendChild(h("div", { class: "opt", onmousedown: (e) => { e.preventDefault(); box.classList.add("hidden"); inp.value = ""; onPick(p); } },
          h("div", null, p.name), h("div", { class: "s" }, p.sectors.map((s) => `${s.name} · ${s.role}`).join(" | ") || "Sem setor")));
      }
      box.classList.remove("hidden");
    } catch (e) { toast(e.message, "err"); }
  };
  inp.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 220); });
  inp.addEventListener("focus", search);
  inp.addEventListener("blur", () => setTimeout(() => box.classList.add("hidden"), 150));
  return wrap;
}

export function tabs(items, active, onChange) {
  const el = h("div", { class: "tabs", role: "tablist" });
  for (const it of items) {
    el.appendChild(h("button", { class: "tab" + (it.key === active ? " active" : ""), role: "tab", onclick: () => onChange(it.key) },
      it.label, it.count !== undefined ? h("span", { class: "n" }, ` (${it.count})`) : null));
  }
  return el;
}

export function isMobile() { return window.matchMedia("(max-width: 900px)").matches; }

// Sub-navegação de uma área (Gestão, Administração) — os subitens não ficam fixos no menu lateral.
export function subnav(items, current) {
  return h("nav", { class: "subnav", "aria-label": "Seções" }, items.map(([path, label]) =>
    h("a", { href: "#/" + path, class: path === current ? "active" : "", "aria-current": path === current ? "page" : null }, label)));
}
