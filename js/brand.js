import { h } from "./ui.js";

const CFG = window.PAINEL_CONFIG || { orgLabel: "Grupo Equatorial", systemName: "Painel de Demandas - EQTL PI SUL" };

// Logo do grupo: versão branca na barra azul, versão azul nas telas claras (login, cadastro).
export function brand() {
  const org = h("span", { class: "org" },
    h("img", { class: "logo-w", src: "img/logo-branca.png", alt: CFG.orgLabel || "Grupo Equatorial" }),
    h("img", { class: "logo-b", src: "img/logo-azul.png", alt: CFG.orgLabel || "Grupo Equatorial" }));
  return h("a", { class: "brand", href: "#/inicio" }, org, h("span", { class: "sep" }),
    h("span", { class: "sys" }, CFG.systemName || "Painel de Demandas - EQTL PI SUL"));
}
