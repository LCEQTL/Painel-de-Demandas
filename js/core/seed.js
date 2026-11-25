// Dados iniciais da instalação: setores, administrador, gerentes e colaboradores de teste e demandas de exemplo.
import * as L from "./logic.js";
import { hashPassword, randomId } from "./crypto.js";
import { P } from "./store.js";

export const SECTORS = [["Relacionamento", "REL"], ["STC", "STC"], ["Manutenção", "MAN"], ["Facilities", "FAC"], ["Obras", "OBR"], ["Garantia", "GAR"], ["AT", "AT"]];

const EXAMPLES = [
  ["Card do Cliente", "REL", "STC", 5, "Comitê de Clientes", "alta", "Trazer a abertura do indicador card do cliente referente aos indicadores de atendimento."],
  ["Negativação e Protesto de Lírio Parisotto", "REL", "GAR", -3, "Comitê de Cobrança", "alta", "Atualizar na sexta se os responsáveis pela ação estão com a cobrança em dia."],
  ["Quartil dos Postos Credenciados", "STC", "REL", 1, "Comitê de Clientes", "normal", "Trazer para o próximo comitê o quartil dos postos credenciados."],
  ["Slide Obras do Relacionamento", "REL", "OBR", 0, "Reunião com a diretoria", "normal", "No slide de obras, modificar a coluna fora do prazo para dias corridos."],
  ["Povoado Sítio do Mocó", "OBR", "MAN", -9, "Órgão público (Prefeitura)", "urgente", "Passar para o gerente como está a situação do povoado e a previsão de ligação."],
  ["Revisar Metas Matriz de Relacionamento", "REL", "FAC", 8, "Presidente", "normal", "Revisar as metas da matriz de relacionamento. O limite mensal precisa ser reavaliado."],
  ["Levantamento de luminárias queimadas", "FAC", "AT", 3, "Associação de moradores", "normal", "Listar as luminárias queimadas do bloco administrativo e prever a troca."],
];

// opts: { adminName, adminEmail, phone, password, testUsers, examples, testEmail }
export async function buildSeed(opts) {
  const now = L.nowIso();
  const sectors = SECTORS.map(([name, acronym], i) => ({ id: i + 1, name, acronym, active: true, color: L.SECTOR_PALETTE[i % L.SECTOR_PALETTE.length], primary_manager_id: null }));
  const db = { sectors, users: new Map(), demands: new Map(), config: {}, msgIndex: new Map() };
  const pwd = await hashPassword(opts.password);
  let uid = 0;
  const addUser = (username, full_name, email, roles, extra = {}) => {
    const u = { id: ++uid, username, full_name, short_code: L.makeShortCode(db, full_name), email: email || null, phone_corp: L.normalizePhone(opts.phone, true, "Telefone"),
      phone_personal: null, is_admin: false, is_active: true, must_change_password: false, pwd, created_at: now, memberships: roles, ...extra };
    db.users.set(u.id, u);
    return u;
  };
  const sec = (acr) => sectors.find((s) => s.acronym === acr);
  const admin = addUser(L.normalizeUsername(opts.adminEmail), opts.adminName, opts.adminEmail, [{ sector_id: sec("REL").id, role: "colaborador", active: true }], { is_admin: true });
  if (opts.testUsers) {
    for (const s of sectors) {
      const slug = s.acronym.toLowerCase();
      const g = addUser(`teste.gerente.${slug}`, `Gerente Teste ${s.name}`, null, [{ sector_id: s.id, role: "gerente", active: true }]);
      s.primary_manager_id = g.id;
      addUser(`teste.colab1.${slug}`, `Colaborador 1 Teste ${s.name}`, null, [{ sector_id: s.id, role: "colaborador", active: true }]);
      addUser(`teste.colab2.${slug}`, `Colaborador 2 Teste ${s.name}`, null, [{ sector_id: s.id, role: "colaborador", active: true }]);
    }
  }
  const files = {};
  const counters = { demanda: 0 };
  const messages = [];
  if (opts.testUsers && opts.examples) {
    const user = (kind, acr) => [...db.users.values()].find((u) => u.username === `teste.${kind}.${acr.toLowerCase()}`);
    EXAMPLES.forEach(([title, o, dst, days, source, prio, text], i) => {
      const actor = user("gerente", o), assignee = user(i % 2 === 0 ? "colab1" : "colab2", dst);
      const id = ++counters.demanda;
      const key = `codigo:${o}-${L.todayLocal().replace(/-/g, "")}-${actor.short_code}`;
      counters[key] = (counters[key] || 0) + 1;
      const code = `${o}-${L.todayLocal().replace(/-/g, "")}-${actor.short_code}-${String(counters[key]).padStart(3, "0")}`;
      const d = L.buildDemand(db, actor, { title, description: { v: 1, blocks: [{ t: "text", md: text }] }, origin_sector_id: sec(o).id, dest_sector_id: sec(dst).id,
        assignee_id: assignee.id, due_date: L.addDays(L.todayLocal(), Math.max(days, 0)), priority: prio,
        priority_justification: prio === "urgente" ? "Pedido com prazo externo." : null, request_source: source }, id, code);
      if (days < 0) { d.due_date = d.original_due_date = L.addDays(L.todayLocal(), days); d.periods[0].due_date_at_entry = d.due_date; }
      if (i === 0 || i === 3) {
        const a = L.currentAssignment(d); a.viewed_at = now;
        const mid = `${Date.now() + i}-${assignee.id}-${randomId(6)}`;
        messages.push([P.mensagem(id, mid), { id: mid, demand_id: id, author_id: assignee.id, content: { v: 1, blocks: [{ t: "text", md: "Recebido, já estou verificando." }] }, created_at: now }]);
      }
      if (i === 5) L.opComplete(db, assignee, d, { resolution: "Metas revisadas e enviadas para aprovação." });
      db.demands.set(id, d);
      files[P.demanda(id)] = d;
    });
  }
  const config = { notifications: { ...L.DEFAULT_CONFIG.notifications, test_mode: 1, test_email: opts.testEmail || opts.adminEmail } };
  files[P.setores] = sectors;
  files[P.pessoas] = [...db.users.values()];
  files[P.contadores] = counters;
  files[P.config] = config;
  for (const [p, m] of messages) files[p] = m;
  return { files, admin, users: [...db.users.values()].map((u) => ({ login: u.username, nome: u.full_name })) };
}
