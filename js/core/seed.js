// Dados iniciais da instalação: setores, o administrador e a configuração padrão. Sem usuários nem demandas de teste.
import * as L from "./logic.js";
import { hashPassword } from "./crypto.js";
import { P } from "./store.js";

export const SECTORS = [["Relacionamento", "REL"], ["STC", "STC"], ["Manutenção", "MAN"], ["Facilities", "FAC"], ["Obras", "OBR"], ["Garantia", "GAR"], ["AT", "AT"],
  ["Superintendência", "SUP"], ["Perdas", "PER"]];

// opts: { adminName, adminEmail, phone, password, adminSector }
export async function buildSeed(opts) {
  const now = L.nowIso();
  const sectors = SECTORS.map(([name, acronym], i) => ({ id: i + 1, name, acronym, active: true, color: L.SECTOR_PALETTE[i % L.SECTOR_PALETTE.length], primary_manager_id: null }));
  const db = { sectors, users: new Map(), demands: new Map(), config: {}, msgIndex: new Map() };
  const sec = sectors.find((s) => s.acronym === (opts.adminSector || "REL")) || sectors[0];
  const admin = {
    id: 1, username: L.normalizeUsername(opts.adminEmail), full_name: opts.adminName, short_code: L.makeShortCode(db, opts.adminName), email: L.normalizeEmail(opts.adminEmail),
    phone_corp: L.normalizePhone(opts.phone, true, "Telefone"), phone_personal: null, is_admin: true, is_active: true, must_change_password: false,
    pwd: await hashPassword(opts.password), created_at: now, memberships: [{ sector_id: sec.id, role: "colaborador", active: true }],
  };
  const config = { notifications: { ...L.DEFAULT_CONFIG.notifications, test_mode: 0, test_email: L.normalizeEmail(opts.adminEmail) }, origens: [...L.DEFAULT_ORIGENS] };
  const files = { [P.setores]: sectors, [P.pessoas]: [admin], [P.contadores]: { demanda: 0 }, [P.config]: config };
  return { files, admin, users: [{ login: admin.username, nome: admin.full_name }] };
}
