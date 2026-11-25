// Início: atalhos, resumo e o que pede ação da pessoa.
import { api } from "../api.js";
import { h, icon, empty } from "../ui.js";
import { navigate, isAdmin, isManager } from "../state.js";
import { demandTable, presetList } from "./demands.js";

export async function homePage(main) {
  const r = await api.get("/api/demands/home");
  const s = r.summary;
  const scopeTxt = isAdmin() ? "Todas as demandas do sistema" : isManager() ? "Demandas do seu setor e as que você participa" : "Demandas em que você participa";
  const go = (quick, scope = "todas") => { presetList(quick, scope); navigate("acompanhamento"); };
  const tile = (cls, ic, label, n, quick) => h("button", { class: "stat " + cls, type: "button", onclick: () => go(quick) },
    h("span", { class: "ic" }, icon(ic, 20)), h("span", { class: "n" }, n), h("span", { class: "l" }, label));

  main.append(
    h("div", { class: "page-head" }, h("h1", null, "Início"),
      h("a", { class: "btn primary lg", href: "#/cadastro" }, icon("plus", 16), "Nova demanda")),
    h("div", { class: "section-head", style: { marginTop: "4px" } }, h("h2", null, "Resumo"), h("span", { class: "small muted" }, scopeTxt)),
    h("div", { class: "stats" },
      tile("s-open", "hourglass", "Pendentes", s.pendentes, "pendentes"),
      tile("s-late", "flag", "Fora do prazo", s.fora_prazo, "vencidas"),
      tile("s-conf", "checks", "Aguardando confirmação", s.confirmar, "confirmar"),
      tile("s-done", "check", "Concluídas", s.concluidas, "concluidas")),
    r.to_confirm.length ? h("div", null,
      h("div", { class: "section-head" }, h("h2", null, icon("flag", 17), " Precisa da sua confirmação"), h("span", { class: "count-pill warn" }, r.to_confirm.length)),
      demandTable(r.to_confirm, { compact: true })) : null,
    h("div", { class: "section-head" }, h("h2", null, "Suas pendências"), h("span", { class: "count-pill" }, r.mine.length), h("span", { class: "spacer" }),
      r.mine.length ? h("button", { class: "linkbtn", onclick: () => go("pendentes", "minhas") }, "Ver no acompanhamento") : null),
    r.mine.length ? demandTable(r.mine, { compact: true }) : h("div", { class: "panel" }, empty("Nada pendente com você.")));
}
