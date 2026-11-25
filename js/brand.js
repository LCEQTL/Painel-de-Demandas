import { h } from "./ui.js";

const CFG = window.PAINEL_CONFIG || { logoUrl: null, orgLabel: "EQTL PI", systemName: "Painel de Demandas - EQTL PI SUL" };

// Identificação textual; para usar imagem, defina logoUrl em config.js (não inventamos a logo oficial).
export function brand() {
  const org = h("span", { class: "org" });
  if (CFG.logoUrl) org.appendChild(h("img", { src: CFG.logoUrl, alt: CFG.orgLabel || "EQTL PI" }));
  else org.textContent = CFG.orgLabel || "EQTL PI";
  return h("a", { class: "brand", href: "#/inicio" }, org, h("span", { class: "sep" }),
    h("span", { class: "sys" }, CFG.systemName || "Painel de Demandas - EQTL PI SUL"));
}
