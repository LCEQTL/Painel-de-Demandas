// Conteúdo rico seguro: texto com formatação simples + tabelas estruturadas.
// Renderização por DOM (textContent); nenhum HTML do usuário é interpretado.
import { h, clear, icon, fmtDate, fmtNumber, fmtBytes, modal, toast, select } from "./ui.js";
import { api, imageObjectUrl, fileBytes, saveFile } from "./api.js";

export const COL_TYPES = [
  { value: "text", label: "Texto" }, { value: "number", label: "Número" }, { value: "currency", label: "Moeda" },
  { value: "date", label: "Data" }, { value: "list", label: "Lista" },
];

// ---------------------------------------------------------------- inline
const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|\[[^\]\n]*\]\([^)\s]+\)|https?:\/\/[^\s<>"')]+)/g;

function safeUrl(u) { return /^(https?:\/\/|mailto:)/i.test(u) ? u : null; }

function inline(text) {
  const out = [];
  let last = 0;
  text.replace(INLINE, (m, _g, idx) => {
    if (idx > last) out.push(document.createTextNode(text.slice(last, idx)));
    if (m.startsWith("**")) out.push(h("strong", null, m.slice(2, -2)));
    else if (m.startsWith("__")) out.push(h("u", null, m.slice(2, -2)));
    else if (m.startsWith("*")) out.push(h("em", null, m.slice(1, -1)));
    else if (m.startsWith("[")) {
      const mm = /^\[([^\]]*)\]\(([^)\s]+)\)$/.exec(m);
      const url = mm && safeUrl(mm[2]);
      out.push(url ? h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, mm[1] || url) : document.createTextNode(m));
    } else {
      out.push(h("a", { href: m, target: "_blank", rel: "noopener noreferrer" }, m));
    }
    last = idx + m.length;
    return m;
  });
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

export function renderText(md) {
  const root = h("div");
  const lines = (md || "").split("\n");
  let list = null, listType = null, para = [];
  const flushPara = () => { if (para.length) { root.appendChild(h("p", null, inline(para.join("\n")))); para = []; } };
  const flushList = () => { if (list) { root.appendChild(list); list = null; listType = null; } };
  for (const line of lines) {
    let m;
    if ((m = /^\s*[-*] \[( |x|X)\] (.*)$/.exec(line))) {
      flushPara();
      if (listType !== "ul") { flushList(); list = h("ul"); listType = "ul"; }
      list.appendChild(h("li", { class: "chk" }, m[1].trim() ? "☑ " : "☐ ", inline(m[2])));
    } else if ((m = /^\s*[-*] (.*)$/.exec(line))) {
      flushPara();
      if (listType !== "ul") { flushList(); list = h("ul"); listType = "ul"; }
      list.appendChild(h("li", null, inline(m[1])));
    } else if ((m = /^\s*\d+[.)] (.*)$/.exec(line))) {
      flushPara();
      if (listType !== "ol") { flushList(); list = h("ol"); listType = "ol"; }
      list.appendChild(h("li", null, inline(m[1])));
    } else if ((m = /^#{1,3} (.*)$/.exec(line))) {
      flushPara(); flushList(); root.appendChild(h("h4", null, inline(m[1])));
    } else if (!line.trim()) {
      flushPara(); flushList();
    } else {
      flushList(); para.push(line);
    }
  }
  flushPara(); flushList();
  return root;
}

// ---------------------------------------------------------------- tabelas
function cellText(v, type) {
  if (v === null || v === undefined || v === "") return "";
  if (type === "currency") return fmtNumber(v, true);
  if (type === "number") return fmtNumber(v);
  if (type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtDate(v) : String(v);
  return String(v);
}

export function tableToTSV(t) {
  const esc = (s) => String(s).replace(/[\t\n\r]+/g, " ");
  return [t.columns.map((c) => esc(c.label)).join("\t"),
    ...t.rows.map((r) => r.map((v, i) => esc(cellText(v, t.columns[i].type))).join("\t"))].join("\n");
}
export function tableToCSV(t) {
  const esc = (s) => { s = String(s ?? ""); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return "﻿" + [t.columns.map((c) => esc(c.label)).join(";"),
    ...t.rows.map((r) => r.map((v, i) => esc(cellText(v, t.columns[i].type))).join(";"))].join("\r\n");
}

export function renderTable(t, { title, actions = true } = {}) {
  const table = h("table", { class: "data" },
    h("thead", null, h("tr", null, t.columns.map((c) => h("th", null, c.label)))),
    h("tbody", null, t.rows.map((r) => h("tr", null, r.map((v, i) => {
      const type = t.columns[i] ? t.columns[i].type : "text";
      return h("td", { class: type === "number" || type === "currency" ? "num" : "" }, cellText(v, type));
    })))));
  const wrap = h("div", { class: "rtable" });
  if (actions) {
    wrap.appendChild(h("div", { class: "tbar" }, h("span", { class: "t" }, title || t.title || ""),
      h("button", { class: "tbtn", title: "Copiar (cole no Excel)", onclick: async () => {
        try { await navigator.clipboard.writeText(tableToTSV(t)); toast("Tabela copiada.", "ok"); }
        catch (_) { toast("Não foi possível acessar a área de transferência.", "err"); }
      } }, "Copiar"),
      h("button", { class: "tbtn", onclick: () => {
        const a = h("a", { href: URL.createObjectURL(new Blob([tableToCSV(t)], { type: "text/csv;charset=utf-8" })), download: (title || t.title || "tabela") + ".csv" });
        document.body.appendChild(a); a.click(); a.remove();
      } }, "Exportar CSV"),
      h("button", { class: "tbtn", onclick: () => modal({ title: title || t.title || "Tabela", wide: true, body: h("div", { class: "scroll-x" }, renderTable(t, { actions: false })) }) },
        icon("expand", 14), "Ampliar")));
  }
  wrap.appendChild(h("div", { class: "scroll-x" }, table));
  return wrap;
}

// Imagens ficam cifradas no repositório: são baixadas e decifradas na hora de mostrar.
export function renderImage(b) {
  const img = h("img", { class: "cimg loading", alt: "Imagem anexada", width: b.w || null, height: b.h || null });
  imageObjectUrl(b.uid).then((url) => { img.src = url; img.classList.remove("loading"); })
    .catch(() => { img.alt = "Não foi possível carregar a imagem."; img.classList.add("broken"); });
  img.addEventListener("click", () => { if (img.src) modal({ title: "Imagem", wide: true, body: h("img", { src: img.src, alt: "Imagem anexada", style: { maxWidth: "100%" } }) }); });
  return img;
}

// Arquivo anexado (PDF, Word, Excel...): cartão com ícone, nome e tamanho; clique para baixar.
const FILE_KIND = { pdf: ["PDF", "f-pdf"], doc: ["DOC", "f-doc"], docx: ["DOC", "f-doc"], xls: ["XLS", "f-xls"], xlsx: ["XLS", "f-xls"], xlsm: ["XLS", "f-xls"], csv: ["CSV", "f-xls"], ppt: ["PPT", "f-ppt"], pptx: ["PPT", "f-ppt"] };
export function renderFile(b, { onRemove } = {}) {
  const [lbl, cls] = FILE_KIND[b.ext] || ["ARQ", "f-doc"];
  const card = h("button", { type: "button", class: "filecard", title: `Baixar ${b.name}` },
    h("span", { class: "fico " + cls }, lbl), h("span", { class: "fmeta" }, h("span", { class: "fname" }, b.name), h("span", { class: "fsize" }, `${fmtBytes(b.size)} · clique para baixar`)));
  card.addEventListener("click", async () => {
    card.classList.add("loading");
    try { saveFile(b.name, await fileBytes(b)); } catch (e) { toast("Não foi possível baixar o arquivo: " + e.message, "err"); }
    card.classList.remove("loading");
  });
  if (!onRemove) return card;
  return h("span", { class: "filewrap" }, card, h("button", { type: "button", class: "fx", "aria-label": "Remover " + b.name, onclick: onRemove }, "×"));
}
export function renderAttachments(list) {
  if (!list || !list.length) return null;
  return h("div", { class: "attlist" }, list.map((b) => (b.t === "image" ? renderImage(b) : renderFile(b))));
}

export function renderContent(content) {
  const root = h("div", { class: "rich" });
  let files = null;
  for (const b of (content && content.blocks) || []) {
    if (b.t === "file") { if (!files) { files = h("div", { class: "attlist" }); root.appendChild(files); } files.appendChild(renderFile(b)); continue; }
    files = null;
    if (b.t === "text") root.appendChild(renderText(b.md));
    else if (b.t === "table") root.appendChild(renderTable(b));
    else if (b.t === "image") root.appendChild(renderImage(b));
  }
  return root;
}

// ---------------------------------------------------------------- imagens: compressão no navegador
const MAX_SIDE = 1600;
const TARGET_BYTES = 350 * 1024; // o mais leve possível sem ficar ilegível
export async function compressImage(file) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch (_) { throw new Error("Não foi possível ler a imagem."); }
  for (const side of [MAX_SIDE, 1200, 900]) {
    const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), hgt = Math.round(bmp.height * scale);
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = hgt;
    const g = cv.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, w, hgt); // fundo branco para imagens com transparência
    g.drawImage(bmp, 0, 0, w, hgt);
    for (const q of [0.72, 0.6, 0.5, 0.4]) {
      const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", q));
      if (blob && blob.size <= TARGET_BYTES) return { blob, w, h: hgt };
    }
  }
  throw new Error("A imagem continua grande demais mesmo comprimida. Recorte ou reduza antes de enviar.");
}

export async function uploadImage(file) {
  const { blob, w, h: hh } = await compressImage(file);
  const r = await api.upload("/api/images", blob);
  return { t: "image", uid: r.uid, w, h: hh };
}

// ---------------------------------------------------------------- arquivos: PDF, Word, Excel, PowerPoint e imagens
export const MAX_FILE_MB = 5;
export const DOC_EXT = ["pdf", "doc", "docx", "xls", "xlsx", "xlsm", "csv", "ppt", "pptx"];
export const ACCEPT = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.xlsm,.csv,.ppt,.pptx";
const isImage = (f) => /^image\/(jpeg|png|webp|gif|bmp)$/.test(f.type);
const extOf = (name) => (String(name).split(".").pop() || "").toLowerCase();
export function bigFileMessage(name, size) {
  return `“${name}” tem ${fmtBytes(size)}; o limite é ${MAX_FILE_MB} MB. Para arquivos grandes, salve no SharePoint/OneDrive e cole o link na conversa.`;
}
async function gzipBlob(file) {
  if (typeof CompressionStream === "undefined") return null;
  try { return await new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob(); } catch (_) { return null; }
}
export async function uploadFile(file) {
  const ext = extOf(file.name);
  if (!DOC_EXT.includes(ext)) throw new Error(`“${file.name}”: tipo não aceito. Envie imagem, PDF, Word, Excel ou PowerPoint.`);
  let body = file, gz = false;
  const z = await gzipBlob(file);
  if (z && z.size < file.size * 0.9) { body = z; gz = true; } // comprime quando compensa (PDF, CSV, DOC antigos)
  if (body.size > MAX_FILE_MB * 1024 * 1024) throw new Error(bigFileMessage(file.name, file.size));
  const r = await api.upload(`/api/files?name=${encodeURIComponent(file.name)}&size=${file.size}&gz=${gz ? 1 : 0}`, body);
  return r;
}
// Imagem → comprimida; documento → arquivo. Devolve o bloco para guardar.
export async function uploadAny(file) {
  if (isImage(file)) return uploadImage(file);
  return uploadFile(file);
}
export function isAcceptedFile(f) { return isImage(f) || DOC_EXT.includes(extOf(f.name)); }

// Anexos de uma janela (encaminhar, concluir, devolver): botão, colar print (Ctrl+V) e arrastar.
export function attachmentsPicker({ hint = "Prints, PDF, Word ou Excel (até 5 MB cada)." } = {}) {
  const items = []; // {blk} ou {loading}
  const list = h("div", { class: "attlist" });
  const fileInput = h("input", { type: "file", accept: ACCEPT, multiple: true, class: "hidden", onchange: (e) => { addFiles(Array.from(e.target.files)); e.target.value = ""; } });
  const render = () => {
    clear(list);
    for (const it of items) {
      if (it.loading) list.appendChild(h("span", { class: "filecard loading" }, h("span", { class: "loader" }), h("span", { class: "fmeta" }, h("span", { class: "fname" }, it.name), h("span", { class: "fsize" }, "Enviando…"))));
      else if (it.blk.t === "image") list.appendChild(h("span", { class: "filewrap" }, renderImage(it.blk), h("button", { type: "button", class: "fx", "aria-label": "Remover imagem", onclick: () => { items.splice(items.indexOf(it), 1); render(); } }, "×")));
      else list.appendChild(renderFile(it.blk, { onRemove: () => { items.splice(items.indexOf(it), 1); render(); } }));
    }
  };
  const addFiles = async (files) => {
    for (const f of files) {
      if (!isAcceptedFile(f)) { toast(`“${f.name}”: tipo não aceito. Envie imagem, PDF, Word ou Excel.`, "err"); continue; }
      if (!isImage(f) && f.size > MAX_FILE_MB * 1024 * 1024 * 3) { toast(bigFileMessage(f.name, f.size), "err"); continue; }
      const it = { loading: true, name: f.name || "print" };
      items.push(it); render();
      try { it.blk = await uploadAny(f); it.loading = false; }
      catch (e) { items.splice(items.indexOf(it), 1); toast(e.message, "err"); }
      render();
    }
  };
  const drop = h("div", { class: "dropzone", tabindex: "0", role: "button", onclick: () => fileInput.click(), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } } },
    icon("clip", 16), h("span", null, h("b", null, "Anexar"), " · clique, arraste ou cole um print (Ctrl+V)"), h("span", { class: "small muted" }, hint));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles(Array.from(e.dataTransfer.files || [])); });
  const el = h("div", { class: "attpicker" }, drop, list, fileInput);
  return {
    el,
    // cole em qualquer lugar da janela (menos campos de texto com texto)
    bindPaste(scope) {
      scope.addEventListener("paste", (e) => {
        const files = Array.from(e.clipboardData.items || []).filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
        if (files.length) { e.preventDefault(); addFiles(files); }
      });
    },
    get value() { return items.filter((i) => !i.loading).map((i) => i.blk); },
    isUploading: () => items.some((i) => i.loading),
  };
}

// ---------------------------------------------------------------- colar do Excel
export function parseTSV(text) {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  return lines.map((l) => l.split("\t").map((c) => c.trim()));
}
export function looksLikeCells(text) { return /\t/.test(text || ""); }

export function rowsToTable(rows, firstIsHeader = true) {
  const width = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => [...r, ...Array(width - r.length).fill("")]);
  if (norm.length < 2) firstIsHeader = false;
  const head = firstIsHeader ? norm.shift() : Array.from({ length: width }, (_, i) => `Coluna ${i + 1}`);
  return { columns: head.map((l, i) => ({ label: l || `Coluna ${i + 1}`, type: "text" })), rows: norm };
}

export function pasteExcelDialog(onTable) {
  const ta = h("textarea", { rows: 10, placeholder: "Selecione as células no Excel, copie (Ctrl+C) e cole aqui (Ctrl+V)." });
  const hdr = h("input", { type: "checkbox", checked: true });
  modal({
    title: "Colar do Excel",
    body: h("div", { class: "stack" }, ta, h("label", { class: "checkbox" }, hdr, "A primeira linha contém os cabeçalhos"),
      h("div", { class: "small muted" }, "Somente o texto das células é importado; formatação, imagens e fórmulas são descartadas.")),
    actions: [{ label: "Cancelar" }, { label: "Inserir tabela", class: "primary", onClick: () => {
      if (!ta.value.trim()) throw new Error("Cole as células primeiro.");
      onTable(rowsToTable(parseTSV(ta.value), hdr.checked));
    } }],
  });
}

// ---------------------------------------------------------------- editor de tabela
export function tableEditor(initial, { onRemove, compactTitle = false } = {}) {
  const t = JSON.parse(JSON.stringify(initial || { columns: [{ label: "Coluna 1", type: "text" }, { label: "Coluna 2", type: "text" }], rows: [["", ""]] }));
  const root = h("div", { class: "tedit-wrap" });
  const titleInp = h("input", { type: "text", placeholder: "Título da tabela (opcional)", value: t.title || "", style: { marginBottom: "6px" } });
  const area = h("div", { class: "tedit" });
  const render = () => {
    clear(area);
    const thead = h("tr", null, t.columns.map((c, ci) => {
      const lab = h("input", { type: "text", value: c.label, "aria-label": "Cabeçalho", oninput: (e) => { c.label = e.target.value; } });
      const typ = select(COL_TYPES, c.type, { onchange: (e) => {
        c.type = e.target.value;
        if (c.type === "list" && !c.options) {
          const raw = prompt("Opções da lista, separadas por ponto e vírgula:", "Pendente;Conferida");
          c.options = (raw || "Opção 1").split(";").map((s) => s.trim()).filter(Boolean);
        }
        render();
      } });
      return h("th", null, h("div", { style: { display: "flex" } }, lab,
        h("button", { class: "x", title: "Remover coluna", onclick: () => { if (t.columns.length > 1) { t.columns.splice(ci, 1); t.rows.forEach((r) => r.splice(ci, 1)); render(); } } }, "×")), typ);
    }), h("th", { style: { minWidth: "30px" } }));
    const body = t.rows.map((r, ri) => h("tr", null, t.columns.map((c, ci) => {
      let el;
      if (c.type === "list") {
        el = select([{ value: "", label: "" }, ...(c.options || []).map((o) => ({ value: o, label: o }))], r[ci] ?? "", { onchange: (e) => { r[ci] = e.target.value; } });
      } else {
        const ph = c.type === "date" ? "dd/mm/aaaa" : c.type === "currency" ? "0,00" : "";
        let val = r[ci] ?? "";
        if (c.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(val)) val = fmtDate(val);
        if ((c.type === "number" || c.type === "currency") && typeof val === "number") val = String(val).replace(".", ",");
        el = h("input", { type: "text", value: val, placeholder: ph, oninput: (e) => { r[ci] = e.target.value; } });
        el.addEventListener("paste", (e) => {
          const txt = e.clipboardData.getData("text/plain");
          if (!/\t|\n/.test(txt.trim())) return;
          e.preventDefault();
          const rows = parseTSV(txt);
          rows.forEach((pr, dr) => {
            const target = ri + dr;
            while (t.rows.length <= target) t.rows.push(Array(t.columns.length).fill(""));
            pr.forEach((v, dc) => {
              const col = ci + dc;
              while (t.columns.length <= col) { t.columns.push({ label: `Coluna ${t.columns.length + 1}`, type: "text" }); t.rows.forEach((x) => x.push("")); }
              t.rows[target][col] = v;
            });
          });
          render();
        });
      }
      return h("td", null, el);
    }), h("td", null, h("button", { class: "x", title: "Remover linha", onclick: () => { t.rows.splice(ri, 1); render(); } }, "×"))));
    area.appendChild(h("table", null, h("thead", null, thead), h("tbody", null, body)));
  };
  render();
  root.append(compactTitle ? "" : titleInp, area, h("div", { class: "tedit-actions" },
    h("button", { class: "btn sm", onclick: () => { t.rows.push(Array(t.columns.length).fill("")); render(); } }, "+ Linha"),
    h("button", { class: "btn sm", onclick: () => { t.columns.push({ label: `Coluna ${t.columns.length + 1}`, type: "text" }); t.rows.forEach((r) => r.push("")); render(); } }, "+ Coluna"),
    h("button", { class: "btn sm ghost", onclick: () => pasteExcelDialog((nt) => { t.columns = nt.columns; t.rows = nt.rows; render(); }) }, "Substituir colando do Excel"),
    onRemove ? h("button", { class: "btn sm danger", onclick: onRemove }, "Remover tabela") : null));
  return {
    el: root,
    get value() {
      const v = { columns: t.columns.map((c) => ({ label: c.label, type: c.type, ...(c.type === "list" ? { options: c.options || [] } : {}) })), rows: t.rows };
      if (titleInp.value.trim()) v.title = titleInp.value.trim();
      return v;
    },
  };
}

// ---------------------------------------------------------------- editor de texto (visual)
// O usuário vê negrito, listas e links diretamente (sem digitar sintaxe). O conteúdo é
// convertido para o formato armazenado {t:"text", md} — compatível com os registros antigos.
// Colar sempre entra como texto puro; células do Excel viram tabela; imagens/arquivos são bloqueados.

function safeHref(u) { return /^(https?:\/\/|mailto:)/i.test(u || "") ? u : null; }

function serialize(node) {
  let out = "";
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out += n.nodeValue.replace(/ /g, " "); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName;
    const inner = () => serialize(n);
    if (tag === "BR") out += "\n";
    else if (tag === "B" || tag === "STRONG") { const t = inner(); out += t.trim() ? `**${t}**` : t; }
    else if (tag === "I" || tag === "EM") { const t = inner(); out += t.trim() ? `*${t}*` : t; }
    else if (tag === "U") { const t = inner(); out += t.trim() ? `__${t}__` : t; }
    else if (tag === "A") { const t = inner(); const href = safeHref(n.getAttribute("href")); out += href ? `[${t || href}](${href})` : t; }
    else if (tag === "UL" || tag === "OL") {
      let i = 0;
      const items = Array.from(n.children).filter((c) => c.tagName === "LI").map((li) => {
        i += 1;
        const txt = serialize(li).replace(/\n+/g, " ").trim();
        return (tag === "OL" ? `${i}. ` : "- ") + txt;
      });
      out += "\n" + items.join("\n") + "\n";
    } else if (["DIV", "P", "H1", "H2", "H3", "H4", "LI", "BLOCKQUOTE", "PRE"].includes(tag)) out += "\n" + inner() + "\n";
    else out += inner(); // span, font etc.: só o texto
  }
  return out;
}
export function domToMd(el) {
  return serialize(el).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function insertPlainText(text) {
  if (!document.execCommand("insertText", false, text)) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    r.deleteContents();
    r.insertNode(document.createTextNode(text));
    r.collapse(false);
  }
}

export function createEditor({ initial = null, placeholder = "Escreva aqui…", compact = false, onInput } = {}) {
  const segs = [];
  const area = h("div", { class: "segs" });
  let lastRt = null;
  const changed = () => { onInput && onInput(); };

  const addText = (md = "", after = null) => {
    const rt = h("div", { class: "rt", contenteditable: "true", role: "textbox", "aria-multiline": "true", "data-placeholder": placeholder, spellcheck: "true" });
    if (md) { const tmp = renderText(md); while (tmp.firstChild) rt.appendChild(tmp.firstChild); }
    rt.style.minHeight = compact ? "60px" : "110px";
    rt.addEventListener("focus", () => { lastRt = rt; });
    rt.addEventListener("input", () => { if (rt.innerHTML === "<br>") rt.innerHTML = ""; changed(); });
    rt.addEventListener("paste", (e) => {
      e.preventDefault();
      const cd = e.clipboardData;
      const files = Array.from(cd.items || []).filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
      if (files.length) { addFiles(files, seg); return; }
      const txt = cd.getData("text/plain");
      if (looksLikeCells(txt)) {
        addTable(rowsToTable(parseTSV(txt), true), seg, true);
        toast("As células coladas viraram uma tabela.", "ok");
        changed();
        return;
      }
      insertPlainText(txt);
    });
    rt.addEventListener("drop", (e) => {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files.length) { addFiles(Array.from(e.dataTransfer.files), seg); return; }
      const t = e.dataTransfer.getData("text/plain");
      if (t) { rt.focus(); insertPlainText(t); }
    });
    const seg = { type: "text", rt, el: h("div", { class: "seg" }, rt) };
    insert(seg, after);
    lastRt = rt;
    return seg;
  };

  const addTable = (tbl, after = null, edit = false) => {
    const seg = { type: "table", data: tbl || { columns: [{ label: "Coluna 1", type: "text" }, { label: "Coluna 2", type: "text" }], rows: [["", ""]] }, editor: null };
    seg.el = h("div", { class: "seg seg-table" });
    const view = () => {
      seg.editor = null;
      clear(seg.el).append(renderTable(seg.data, { actions: false }),
        h("div", { class: "seg-actions" },
          h("button", { class: "linkbtn small", type: "button", onclick: editMode }, "Editar tabela"),
          h("button", { class: "linkbtn small", type: "button", style: { color: "var(--red-fg)" }, onclick: () => { remove(seg); changed(); } }, "Remover tabela")));
    };
    const editMode = () => {
      seg.editor = tableEditor(seg.data, { compactTitle: false });
      clear(seg.el).append(seg.editor.el, h("div", { class: "seg-actions" },
        h("button", { class: "btn sm primary", type: "button", onclick: () => { seg.data = seg.editor.value; view(); changed(); } }, "Concluir edição da tabela")));
    };
    edit ? editMode() : view();
    insert(seg, after);
    const idx = segs.indexOf(seg);
    if (idx === segs.length - 1) addText("", seg);
    return seg;
  };
  const addImageSeg = (blk, after) => {
    const seg = { type: "image", data: blk };
    seg.el = h("div", { class: "seg seg-image" }, renderImage(blk),
      h("button", { class: "linkbtn small", type: "button", style: { color: "var(--red-fg)" }, onclick: () => { remove(seg); changed(); } }, "Remover imagem"));
    insert(seg, after);
    if (segs[segs.length - 1] === seg) addText("", seg);
    return seg;
  };
  const addFileSeg = (blk, after) => {
    const seg = { type: "file", data: blk };
    seg.el = h("div", { class: "seg seg-file" }, renderFile(blk, { onRemove: () => { remove(seg); changed(); } }));
    insert(seg, after);
    if (segs[segs.length - 1] === seg) addText("", seg);
    return seg;
  };
  const addFiles = async (files, after) => {
    for (const f of files) {
      if (!isAcceptedFile(f)) { toast(`“${f.name}”: tipo não aceito. Envie imagem, PDF, Word, Excel ou PowerPoint.`, "err"); continue; }
      const img = isImage(f);
      const ph = { type: "loading", el: h("div", { class: "seg small muted" }, h("span", { class: "loader" }), img ? "Comprimindo e enviando imagem…" : `Enviando ${f.name}…`) };
      insert(ph, after);
      try {
        const blk = await uploadAny(f);
        const i = segs.indexOf(ph); segs.splice(i, 1); ph.el.remove();
        after = (img ? addImageSeg : addFileSeg)(blk, i > 0 ? segs[i - 1] : null);
        changed();
      } catch (e) {
        const i = segs.indexOf(ph); if (i >= 0) { segs.splice(i, 1); ph.el.remove(); }
        toast(e.message, "err");
      }
    }
  };
  const fileInput = h("input", { type: "file", accept: ACCEPT, multiple: true, class: "hidden", onchange: (e) => { addFiles(Array.from(e.target.files), currentSeg()); e.target.value = ""; } });
  const insert = (seg, after) => {
    const idx = after ? segs.indexOf(after) + 1 : segs.length;
    segs.splice(idx, 0, seg);
    const ref = segs[idx + 1];
    area.insertBefore(seg.el, ref ? ref.el : null);
  };
  const remove = (seg) => {
    const i = segs.indexOf(seg);
    if (i >= 0) { segs.splice(i, 1); seg.el.remove(); }
    if (!segs.some((s) => s.type === "text")) addText();
  };
  const currentSeg = () => segs.find((s) => s.rt === lastRt) || null;
  const exec = (cmd, val = null) => {
    const rt = lastRt || (segs.find((s) => s.type === "text") || addText()).rt;
    rt.focus();
    document.execCommand(cmd, false, val);
    changed();
  };
  const tb = (content, label, fn) => h("button", { class: "tbtn", type: "button", title: label, "aria-label": label,
    onmousedown: (e) => e.preventDefault(), onclick: fn }, content);
  const link = () => {
    const sel = window.getSelection();
    const url = prompt("Endereço do link (https://…):", "https://");
    if (!url) return;
    if (!safeHref(url)) { toast("Use um endereço que comece com http://, https:// ou mailto:.", "err"); return; }
    const rt = lastRt || segs.find((s) => s.type === "text").rt;
    rt.focus();
    if (sel && sel.rangeCount && !sel.isCollapsed && rt.contains(sel.anchorNode)) document.execCommand("createLink", false, url);
    else { const a = h("a", { href: url }, url); const r = sel.rangeCount ? sel.getRangeAt(0) : null; if (r && rt.contains(r.startContainer)) { r.insertNode(a); r.setStartAfter(a); } else rt.appendChild(a); }
    rt.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
    changed();
  };
  const fmtBox = h("span", { class: "row", style: { gap: "2px" } },
    tb(h("b", null, "B"), "Negrito", () => exec("bold")),
    tb(h("i", null, "I"), "Itálico", () => exec("italic")),
    tb("• Lista", "Lista com marcadores", () => exec("insertUnorderedList")),
    tb("1. Lista", "Lista numerada", () => exec("insertOrderedList")),
    tb([icon("link", 14), "Link"], "Inserir link", link));
  const tools = h("div", { class: "tools" },
    tb([icon("clip", 14), "Anexar"], "Anexar imagem, PDF, Word ou Excel (até 5 MB; imagens são comprimidas)", () => fileInput.click()),
    tb([icon("table", 14), "Tabela"], "Inserir tabela", () => { addTable(null, currentSeg(), true); changed(); }),
    h("span", { class: "sep" }), fmtBox);
  const root = h("div", { class: "editor" }, area, tools, fileInput);

  const setValue = (content) => {
    segs.splice(0); clear(area); lastRt = null;
    const bl = (content && content.blocks) || [];
    for (const b of bl) {
      if (b.t === "text") addText(b.md);
      else if (b.t === "image") addImageSeg(b, segs[segs.length - 1] || null);
      else if (b.t === "file") addFileSeg(b, segs[segs.length - 1] || null);
      else if (b.t === "table") {
        const tbl = { ...b };
        delete tbl.t;
        addTableAtEnd(tbl);
      }
    }
    if (!segs.length || segs[segs.length - 1].type !== "text") addText();
  };
  const addTableAtEnd = (tbl) => {
    const seg = addTable(tbl, segs[segs.length - 1] || null, false);
    // addTable inclui texto após a última tabela; mantemos a ordem original removendo o extra se o próximo bloco for texto
    const i = segs.indexOf(seg);
    if (segs[i + 1] && segs[i + 1].type === "text" && !segs[i + 1].rt.textContent) { segs[i + 1].el.remove(); segs.splice(i + 1, 1); }
  };
  setValue(initial);
  return {
    el: root,
    setValue,
    clear: () => setValue(null),
    getValue() {
      const out = [];
      for (const sg of segs) {
        if (sg.type === "text") { const md = domToMd(sg.rt); if (md) out.push({ t: "text", md }); }
        else if (sg.type === "image" || sg.type === "file") out.push(sg.data);
        else if (sg.type === "loading") continue;
        else {
          const data = sg.editor ? sg.editor.value : sg.data;
          out.push({ t: "table", ...data });
        }
      }
      return { v: 1, blocks: out };
    },
    isEmpty() { return !this.getValue().blocks.length; },
    isUploading() { return segs.some((x) => x.type === "loading"); },
    focus() { const f = segs.find((x) => x.type === "text"); if (f) f.rt.focus(); },
  };
}
