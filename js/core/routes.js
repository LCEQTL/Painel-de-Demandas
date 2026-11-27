// "Servidor" que roda no navegador: atende os mesmos caminhos /api/... da versão local,
// lendo e gravando os arquivos cifrados do repositório. As telas não sabem a diferença.
import { P } from "./store.js";
import { hashPassword, verifyPassword, randomId } from "./crypto.js";
import * as L from "./logic.js";
import { digestFor, digestLines, digestCount } from "./avisos.js";

const { bad, HttpError } = L;
const SESSION_KEY = "painel.sessao";
const QUICK = ["pendentes", "vencidas", "confirmar", "concluidas", "canceladas", "todas"];

export function createServer(store, appCfg) {
  const db = store.db;
  const cfgKey = (k) => L.conf(db, k);

  // ---------------------------------------------------------------- sessão (local ao navegador)
  const session = {
    get() { try { const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); return s && Date.now() - s.t < 30 * 86400000 ? s : null; } catch (_) { return null; } },
    set(uid) { try { localStorage.setItem(SESSION_KEY, JSON.stringify({ uid, t: Date.now() })); } catch (_) { /* sem armazenamento */ } },
    clear() { try { localStorage.removeItem(SESSION_KEY); } catch (_) { /* ignora */ } },
  };
  function me({ allowMustChange = false } = {}) {
    const s = session.get();
    const u = s && db.users.get(s.uid);
    if (!u || !u.is_active) { session.clear(); bad("Faça login.", 401); }
    if (u.must_change_password && !allowMustChange) bad("Troque a senha temporária.", 428);
    return u;
  }
  const requireAdmin = (u) => { if (!u.is_admin) bad("Ação restrita ao administrador.", 403); };

  // ---------------------------------------------------------------- gravações
  const users = () => [...db.users.values()];
  function mutateUsers(fn, msg) {
    // fn altera a lista no lugar; devolver false significa "nada mudou, não grave".
    return store.mutate(P.pessoas, (list) => { list = list || []; return fn(list) === false ? undefined : list; }, msg || "Atualiza pessoas");
  }
  function mutateUser(id, fn, msg) {
    return mutateUsers((list) => { const u = list.find((x) => x.id === Number(id)); if (!u) bad("Pessoa não encontrada.", 404); return fn(u, list); }, msg);
  }
  function mutateSectors(fn, msg) { return store.mutate(P.setores, (list) => { list = list || []; return fn(list) === false ? undefined : list; }, msg || "Atualiza setores"); }
  async function mutateDemand(id, fn, msg) {
    const out = await store.mutate(P.demanda(id), (d) => { if (!d) bad("Demanda não encontrada.", 404); return fn(d); }, msg || `Demanda ${id}`);
    return out;
  }
  async function nextCounter(name, extraKey) {
    let value, extra;
    await store.mutate(P.contadores, (c) => {
      c = c || {};
      c[name] = (c[name] || 0) + 1; value = c[name];
      if (extraKey) { c[extraKey] = (c[extraKey] || 0) + 1; extra = c[extraKey]; }
      return c;
    }, `Contador ${name}`);
    return [value, extra];
  }

  // Antes de mostrar uma demanda ou lista, pergunta ao GitHub se algo mudou (consulta com ETag: "nada mudou" não gasta cota).
  let lastFresh = 0;
  async function fresh(minMs = 4000) {
    if (Date.now() - lastFresh < minMs) return;
    lastFresh = Date.now();
    try { if (await store.sync() && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("painel:dados")); } catch (e) { console.warn("Sincronização:", e.message); }
  }

  // ---------------------------------------------------------------- leitura / visto
  function lastOtherMsg(did, uid) {
    const idx = db.msgIndex.get(did) || [];
    for (let i = idx.length - 1; i >= 0; i--) if (idx[i].authorId !== uid) return idx[i].at;
    return null;
  }
  const lastRead = (uid, did) => ((db.reads.get(uid) || {})[did]) || null;
  function markRead(uid, did) {
    const lo = lastOtherMsg(did, uid);
    const lr = lastRead(uid, did);
    if (lr && (!lo || lo <= lr)) return Promise.resolve();
    const now = L.nowIso();
    return store.mutate(P.leitura(uid), (r) => { r = r || {}; r[did] = now; return r; }, "Leitura").catch((e) => console.warn(e));
  }

  // ---------------------------------------------------------------- resumo de listas
  function summarize(u, items) {
    return items.map((d) => {
      const lo = lastOtherMsg(d.id, u.id);
      const lr = lastRead(u.id, d.id);
      const a = L.currentAssignment(d);
      const lastA = (d.assignments || [])[d.assignments.length - 1];
      return L.demandSummary(db, d, u, {
        unread: !!(lo && (!lr || lo > lr)),
        new_for_me: !!(a && a.user_id === u.id && !a.viewed_at),
        came_from: a && a.assigned_by_id && a.assigned_by_id !== u.id ? { name: (db.users.get(a.assigned_by_id) || {}).full_name, kind: a.kind } : null,
        is_self: d.creator_id === d.assignee_id,
        seen_at: lastA ? L.localIso(lastA.viewed_at) : null,
        preview: L.preview(d.description),
      });
    });
  }
  function visible(u) { return [...db.demands.values()].filter((d) => L.canView(db, u, d)); }
  function quickFilter(quick, today) {
    if (!quick || quick === "todas") return () => true;
    if (!QUICK.includes(quick)) bad("Filtro inválido.");
    return {
      pendentes: (d) => d.status === L.STATUS_ABERTA,
      vencidas: (d) => d.status === L.STATUS_ABERTA && d.due_date < today,
      confirmar: (d) => d.status === L.STATUS_CONFIRMACAO,
      concluidas: (d) => d.status === L.STATUS_CONCLUIDA,
      canceladas: (d) => d.status === L.STATUS_CANCELADA,
    }[quick];
  }
  function baseList(u, q) {
    const scope = q.scope || "todas";
    if (!["todas", "minhas", "criadas"].includes(scope)) bad("Escopo inválido.");
    const term = (q.q || "").trim().toLowerCase();
    const src = (q.source || "").trim().toLowerCase();
    const a = q.date_from ? L.startOfDayUtc(q.date_from) : null, b = q.date_to ? L.endOfDayUtc(q.date_to) : null;
    return visible(u).filter((d) => (scope !== "minhas" || d.assignee_id === u.id) && (scope !== "criadas" || d.creator_id === u.id)
      && (!term || d.title.toLowerCase().includes(term) || d.code.toLowerCase().includes(term) || (d.request_source || "").toLowerCase().includes(term))
      && (!src || (d.request_source || "").toLowerCase().includes(src))
      && (!q.origin_id || d.origin_sector_id === Number(q.origin_id)) && (!q.dest_id || d.dest_sector_id === Number(q.dest_id))
      && (!q.assignee_id || d.assignee_id === Number(q.assignee_id)) && (!q.priority || d.priority === q.priority)
      && (!a || d.created_at >= a) && (!b || d.created_at <= b));
  }
  const lastActivity = (d) => { const idx = db.msgIndex.get(d.id) || []; const m = idx.length ? idx[idx.length - 1].at : ""; return m > d.updated_at ? m : d.updated_at; };
  const SORTS = {
    prazo: (x, y) => (x.due_date < y.due_date ? -1 : x.due_date > y.due_date ? 1 : x.id - y.id),
    atualizacao: (x, y) => (lastActivity(x) < lastActivity(y) ? 1 : -1),
    criacao: (x, y) => (x.created_at < y.created_at ? 1 : -1),
  };

  function loadDemand(u, id) {
    const d = db.demands.get(Number(id));
    if (!d || !L.canView(db, u, d)) bad("Demanda não encontrada ou sem acesso.", 404);
    return d;
  }
  async function detail(u, d) {
    const msgs = await store.loadMessages(d.id);
    const out = L.demandSummary(db, d, u);
    const lastA = (d.assignments || [])[d.assignments.length - 1];
    Object.assign(out, {
      description: d.description, priority_justification: d.priority_justification, original_due_date: d.original_due_date,
      resolution: d.resolution, version: d.version, watchers: (d.watchers || []).map((w) => L.uref(db, w.user_id)),
      permissions: L.demandPermissions(db, u, d), timeline: L.timeline(db, d),
      messages: msgs.sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).map((m) => ({ id: m.id, author: L.uref(db, m.author_id) || { id: m.author_id, name: "?" }, kind: "mensagem", content: m.content, created_at: L.localIso(m.created_at) })),
      events: (d.events || []).map((e) => ({ id: e.id, type: e.type, actor: L.uref(db, e.actor_id), at: L.localIso(e.at), data: e.data })),
      tables: (d.tables || []).map((t) => L.tableDict(db, t)), resolved_by: L.uref(db, d.resolved_by_id), resolution_files: d.resolution_files || [],
      auto_confirm_at: L.localIso(L.autoConfirmAt(db, d)), current_period: (() => { const cp = L.currentPeriod(d); return cp ? { forwarded_by: L.uref(db, cp.forwarded_by_id), sector: L.sectorRef(L.sectorById(db, cp.sector_id)) } : null; })(),
      seen: lastA ? { user: L.uref(db, lastA.user_id), sent_at: L.localIso(lastA.started_at), seen_at: L.localIso(lastA.viewed_at) } : null,
    });
    return out;
  }
  async function demandResult(u, id) {
    const d = db.demands.get(Number(id));
    if (!d || !L.canView(db, u, d)) return { access_lost: true };
    return detail(u, d);
  }

  // ---------------------------------------------------------------- pessoas
  function sectorRoles(u) {
    return L.activeMemberships(db, u).map((m) => { const s = L.sectorById(db, m.sector_id); const role = m.role || "colaborador";
      return { id: s.id, name: s.name, acronym: s.acronym, color: s.color, role: s.primary_manager_id === u.id ? "Gerente do setor" : L.ROLE_LABEL[role] }; });
  }
  function newUser(list, { username, full_name, password, phone_corp, phone_personal, email, sector_roles, is_admin = false, must_change_password = false, created_by = null }, pwdRec) {
    username = L.normalizeUsername(username);
    L.validateUsername(username);
    if (list.some((x) => x.username === username)) bad(`Já existe um acesso com o login “${username}”.`, 409);
    full_name = String(full_name || "").split(/\s+/).join(" ").trim();
    if (full_name.length < 3) bad("Informe o nome completo.");
    const roles = (sector_roles || []).map((r) => ({ sector_id: Number(r.sector_id), role: r.role || "colaborador", active: true }));
    for (const r of roles) { const s = L.sectorById(db, r.sector_id); if (!s || s.active === false) bad("Setor inválido ou desativado."); if (!L.ROLE_LABEL[r.role]) bad("Perfil inválido."); }
    if (!roles.length && !is_admin) bad("Selecione ao menos um setor.");
    const tmpDb = { users: new Map(list.map((x) => [x.id, x])) };
    const u = {
      id: list.reduce((m, x) => Math.max(m, x.id), 0) + 1, username, full_name, short_code: L.makeShortCode(tmpDb, full_name),
      email: email === undefined ? null : L.normalizeEmail(email), phone_corp: L.normalizePhone(phone_corp, true, "Telefone corporativo"),
      phone_personal: L.normalizePhone(phone_personal, false, "Telefone pessoal"), is_admin, is_active: true, must_change_password,
      pwd: pwdRec, created_at: L.nowIso(), created_by_id: created_by, memberships: roles,
    };
    list.push(u);
    return u;
  }
  function tempPassword() { return randomId(4).toLowerCase() + Math.floor(1000 + Math.random() * 9000); }

  async function redistribute(actor, demands, strategy, targetId, reason) {
    for (const d of demands) {
      await mutateDemand(d.id, (dd) => L.opTransfer(db, actor, dd, { sector_id: dd.dest_sector_id, user_id: strategy === "user" ? targetId : null, reason }, true), "Redistribuição");
    }
  }
  const openAssigned = (uid, sid) => [...db.demands.values()].filter((d) => d.assignee_id === uid && d.status === L.STATUS_ABERTA && (sid === undefined || d.dest_sector_id === sid));

  async function removeMembership(actor, target, sector, strategy, targetUserId) {
    if (!L.memberSectorIds(db, target).has(sector.id)) bad("Vínculo não encontrado.", 404);
    const pending = openAssigned(target.id, sector.id);
    if (pending.length && !strategy) {
      bad(`${target.full_name} é responsável por ${pending.length} demanda(s) aberta(s) em ${sector.name}. Escolha para quem redistribuir antes de remover o vínculo.`, 409,
        { message: `${target.full_name} é responsável por ${pending.length} demanda(s) aberta(s) em ${sector.name}. Escolha para quem redistribuir antes de remover o vínculo.`, demands: pending.map((d) => ({ id: d.id, code: d.code, title: d.title })) });
    }
    if (sector.primary_manager_id === target.id && pending.length && strategy !== "user") bad("Esta pessoa é a gerente do setor do setor. Defina outro gerente do setor ou escolha uma pessoa para receber as demandas.");
    await mutateUser(target.id, (u) => { u.memberships = (u.memberships || []).filter((m) => m.sector_id !== sector.id); return u; }, "Remove vínculo");
    if (sector.primary_manager_id === target.id) await mutateSectors((list) => { const s = list.find((x) => x.id === sector.id); s.primary_manager_id = null; return list; });
    if (pending.length) await redistribute(actor, pending, strategy, targetUserId, `Redistribuição: vínculo de ${target.full_name} com ${sector.name} removido`);
  }

  // ---------------------------------------------------------------- painel gerencial
  function dashScope(u) {
    if (u.is_admin) return () => true;
    const managed = L.managedSectorIds(db, u);
    if (!managed.size) bad("O painel gerencial é destinado a gerentes, executivos/líderes e ao administrador.", 403);
    return (d) => managed.has(d.origin_sector_id) || managed.has(d.dest_sector_id) || (d.periods || []).some((p) => managed.has(p.sector_id));
  }
  function dashFilters(q) {
    const to = q.date_to || L.todayLocal();
    const from = q.date_from || L.addDays(to, -29);
    if (from > to) bad("Período inválido: data inicial maior que a final.");
    return { from, to, a: L.startOfDayUtc(from), b: L.endOfDayUtc(to) };
  }
  function dashBase(u, q) {
    const sc = dashScope(u);
    return [...db.demands.values()].filter((d) => sc(d) && (!q.origin_id || d.origin_sector_id === Number(q.origin_id)) && (!q.dest_id || d.dest_sector_id === Number(q.dest_id))
      && (!q.assignee_id || d.assignee_id === Number(q.assignee_id)) && (!q.priority || d.priority === q.priority) && (!q.status || d.status === q.status));
  }
  function metric(u, q, f, m) {
    const base = dashBase(u, q);
    const today = L.todayLocal();
    const days = cfgKey("deadline_bands").yellow_max_days_left;
    const inP = (iso) => iso && iso >= f.a && iso <= f.b;
    switch (m) {
      case "abertas": return base.filter((d) => L.OPEN_STATUSES.includes(d.status));
      case "vencidas": return base.filter((d) => d.status === L.STATUS_ABERTA && d.due_date < today);
      case "vencendo": return base.filter((d) => d.status === L.STATUS_ABERTA && d.due_date >= today && d.due_date <= L.addDays(today, days));
      case "entradas": return base.filter((d) => inP(d.created_at));
      case "concluidas": case "dentro_prazo": case "fora_prazo": case "prazo_alterado": {
        let l = base.filter((d) => d.status === L.STATUS_CONCLUIDA && inP(d.completed_at));
        if (m === "dentro_prazo") l = l.filter((d) => L.localDate(d.resolved_at || d.completed_at) <= d.due_date);
        if (m === "fora_prazo") l = l.filter((d) => L.localDate(d.resolved_at || d.completed_at) > d.due_date);
        if (m === "prazo_alterado") l = l.filter((d) => d.due_date !== d.original_due_date);
        return l;
      }
      case "chegaram_vencidas": return base.filter((d) => (d.periods || []).some((p) => p.arrived_overdue && inP(p.started_at) && (!q.sector_id || p.sector_id === Number(q.sector_id))));
      default: bad("Indicador inválido.");
    }
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length >> 1; return s.length % 2 ? s[n] : (s[n - 1] + s[n]) / 2; };
  const days1 = (s) => Math.round((s / 86400) * 10) / 10;

  // ---------------------------------------------------------------- rotas
  const routes = [];
  const on = (method, pattern, fn) => routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), fn });

  // --- autenticação
  on("GET", "/api/auth/me", () => {
    const u = me({ allowMustChange: true });
    const out = L.userFull(db, u);
    out.roles = { is_admin: !!u.is_admin, is_manager: L.managedSectorIds(db, u).size > 0, managed_sector_ids: [...L.managedSectorIds(db, u)], primary_sector_ids: [...L.primarySectorIds(db, u)] };
    out.app_url = appCfg.appUrl;
    if (u.is_admin) {
      const raw = cfgKey("token").expires || (store.gh.tokenExpiry ? String(store.gh.tokenExpiry).slice(0, 10) : "");
      out.token_expires = /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
    }
    return out;
  });
  on("POST", "/api/auth/login", async (_, b) => {
    const username = L.normalizeUsername(b.username);
    const u = users().find((x) => x.username === username);
    if (!u || !(await verifyPassword(b.password || "", u.pwd))) bad("Login ou senha inválidos.", 401);
    if (!u.is_active) bad("Conta desativada. Procure o gerente do seu setor ou o administrador.", 403);
    session.set(u.id);
    store.mutate(P.presenca(u.id), () => ({ at: L.nowIso(), login: L.nowIso() }), "Presença").catch(() => {});
    return { ok: true, must_change_password: !!u.must_change_password };
  });
  on("POST", "/api/auth/logout", () => { session.clear(); return { ok: true }; });
  on("GET", "/api/public/sectors", () => db.sectors.filter((s) => s.active !== false).sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ id: s.id, name: s.name, acronym: s.acronym })));
  on("POST", "/api/auth/register", async (_, b) => {
    const email = b.email ? L.normalizeEmail(b.email) : null;
    const username = email ? email.split("@")[0] : L.normalizeUsername(b.username);
    if (!username) bad("Informe seu e-mail.");
    if (users().some((x) => x.username === username)) bad(`Já existe um acesso com o login “${username}” (parte antes do @). Se for você, entre com ele; se não, procure o administrador.`, 409);
    const err = L.validatePasswordStrength(b.password);
    if (err) bad(err);
    const pwd = await hashPassword(b.password);
    let created;
    await mutateUsers((list) => { created = newUser(list, { username, full_name: b.full_name, phone_corp: b.phone_corp, phone_personal: b.phone_personal, email: email || undefined,
      sector_roles: (b.sector_ids || []).map((id) => ({ sector_id: id, role: "colaborador" })) }, pwd); }, `Autocadastro de ${username}`);
    return { id: created.id, username: created.username };
  });
  on("POST", "/api/auth/change-password", async (_, b) => {
    const u = me({ allowMustChange: true });
    if (!(await verifyPassword(b.current_password || "", u.pwd))) bad("Senha atual incorreta.");
    const err = L.validatePasswordStrength(b.new_password);
    if (err) bad(err);
    if (b.new_password === b.current_password) bad("A nova senha deve ser diferente da atual.");
    const pwd = await hashPassword(b.new_password);
    await mutateUser(u.id, (x) => { x.pwd = pwd; x.must_change_password = false; return x; }, "Troca de senha");
    return { ok: true };
  });
  on("PATCH", "/api/auth/profile", async (_, b) => {
    const u = me();
    await mutateUser(u.id, (x) => applyProfile(x, b), "Atualiza perfil");
    return L.userFull(db, db.users.get(u.id));
  });
  function applyProfile(x, b) {
    if (b.full_name !== undefined && b.full_name !== null) { const n = String(b.full_name).split(/\s+/).join(" ").trim(); if (n.length < 3) bad("Informe o nome completo."); x.full_name = n; }
    if (b.phone_corp !== undefined && b.phone_corp !== null) x.phone_corp = L.normalizePhone(b.phone_corp, true, "Telefone corporativo");
    if (b.phone_personal !== undefined && b.phone_personal !== null) x.phone_personal = L.normalizePhone(b.phone_personal, false, "Telefone pessoal");
    if (b.email !== undefined && b.email !== null) x.email = L.normalizeEmail(b.email);
    return x;
  }

  // --- presença
  on("POST", "/api/presence/heartbeat", () => {
    const u = me();
    const p = db.presence.get(u.id);
    const every = cfgKey("presence").heartbeat_minutes * 60000;
    if (p && Date.now() - new Date(p.at).getTime() < every) return { ok: true };
    store.mutate(P.presenca(u.id), (x) => ({ ...(x || {}), at: L.nowIso() }), "Presença").catch(() => {});
    return { ok: true };
  });
  const isOnline = (uid) => { const p = db.presence.get(uid); return !!(p && Date.now() - new Date(p.at).getTime() < cfgKey("presence").online_minutes * 60000); };
  on("GET", "/api/presence/online", () => { me(); return { online_ids: users().filter((u) => isOnline(u.id)).map((u) => u.id), window_minutes: cfgKey("presence").online_minutes }; });
  on("GET", "/api/presence", () => {
    const u = me();
    const managed = u.is_admin ? null : L.managedSectorIds(db, u);
    if (!u.is_admin && !managed.size) bad("Disponível para gerentes, executivos/líderes e administrador.", 403);
    const people = users().filter((x) => x.is_active && x.id !== u.id && (u.is_admin || [...L.memberSectorIds(db, x)].some((s) => managed.has(s))));
    return { online_window_minutes: cfgKey("presence").online_minutes, people: people.sort((a, b) => a.full_name.localeCompare(b.full_name)).map((x) => ({
      name: x.full_name, online: isOnline(x.id), last_login_at: L.localIso((db.presence.get(x.id) || {}).login), last_activity_at: L.localIso((db.presence.get(x.id) || {}).at),
      reasons: sectorRoles(x).map((s) => s.name) })) };
  });

  // --- setores e pessoas
  on("GET", "/api/sectors", () => {
    me({ allowMustChange: true });
    return db.sectors.filter((s) => s.active !== false).sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
      const p = s.primary_manager_id ? db.users.get(s.primary_manager_id) : null;
      return { id: s.id, name: s.name, acronym: s.acronym, color: s.color, has_primary_manager: !!p, primary_manager: p ? { id: p.id, name: p.full_name } : null };
    });
  });
  on("GET", "/api/people/search", (q) => {
    me();
    const term = (q.q || "").trim().toLowerCase();
    return users().filter((u) => u.is_active && (!term || u.full_name.toLowerCase().includes(term)) && (!q.sector_id || L.memberSectorIds(db, u).has(Number(q.sector_id))))
      .sort((a, b) => a.full_name.localeCompare(b.full_name)).slice(0, Math.min(Number(q.limit) || 20, 50))
      .map((u) => ({ id: u.id, name: u.full_name, sectors: sectorRoles(u) }));
  });
  const managedOrAll = (u) => (u.is_admin ? new Set(db.sectors.map((s) => s.id)) : L.managedSectorIds(db, u));
  on("GET", "/api/team", (q) => {
    const u = me();
    const managed = managedOrAll(u);
    let vis = new Set([...L.memberSectorIds(db, u), ...managed]);
    if (q.sector_id) { if (!vis.has(Number(q.sector_id))) bad("Você não pertence a este setor.", 403); vis = new Set([Number(q.sector_id)]); }
    return db.sectors.filter((s) => vis.has(s.id)).sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
      const canManage = managed.has(s.id);
      return { sector: { id: s.id, name: s.name, acronym: s.acronym, active: s.active !== false }, can_manage: canManage,
        people: users().filter((x) => L.memberSectorIds(db, x).has(s.id)).sort((a, b) => a.full_name.localeCompare(b.full_name)).map((x) => {
          const role = L.roleIn(db, x, s.id);
          const p = { id: x.id, name: x.full_name, role, is_manager: role !== "colaborador", is_primary: s.primary_manager_id === x.id, is_active: x.is_active };
          if (canManage) Object.assign(p, { username: x.username, phone_corp: x.phone_corp, email: x.email, last_login_at: L.localIso((db.presence.get(x.id) || {}).login) });
          return p;
        }) };
    });
  });
  on("POST", "/api/team/users", async (_, b) => {
    const u = me();
    const managed = managedOrAll(u);
    if (!(b.sector_ids || []).length || !(b.sector_ids || []).every((id) => managed.has(Number(id)))) bad("Você só pode cadastrar pessoas nos setores que gerencia.", 403);
    const temp = tempPassword();
    const pwd = await hashPassword(temp);
    const email = b.email ? L.normalizeEmail(b.email) : null;
    let created;
    await mutateUsers((list) => { created = newUser(list, { username: email ? email.split("@")[0] : b.username, full_name: b.full_name, phone_corp: b.phone_corp, phone_personal: b.phone_personal, email: email || undefined,
      sector_roles: b.sector_ids.map((id) => ({ sector_id: id, role: "colaborador" })), must_change_password: true, created_by: u.id }, pwd); }, "Cadastro de colaborador");
    return { id: created.id, username: created.username, temporary_password: temp };
  });
  on("POST", "/api/team/memberships", async (_, b) => {
    const u = me();
    if (!managedOrAll(u).has(Number(b.sector_id))) bad("Você só pode incluir pessoas nos setores que gerencia.", 403);
    const s = L.sectorById(db, b.sector_id);
    if (!s || s.active === false) bad("Setor inválido.");
    await mutateUser(b.user_id, (x) => {
      if (!x.is_active) bad("Pessoa desativada.");
      if ((x.memberships || []).some((m) => m.sector_id === s.id)) bad("A pessoa já pertence a este setor.", 409);
      x.memberships = [...(x.memberships || []), { sector_id: s.id, role: "colaborador", active: true }];
      return x;
    }, "Inclui vínculo");
    return { ok: true };
  });
  on("POST", "/api/team/memberships/remove", async (_, b) => {
    const u = me();
    const s = L.sectorById(db, b.sector_id), target = db.users.get(Number(b.user_id));
    if (!s || !target) bad("Vínculo não encontrado.", 404);
    if (!u.is_admin) {
      if (!L.managedSectorIds(db, u).has(s.id)) bad("Você só pode remover vínculos dos setores que gerencia.", 403);
      if (L.roleIn(db, target, s.id) !== "colaborador") bad("Somente o administrador tira o perfil de gerente ou executivo/líder.", 403);
    }
    await removeMembership(u, target, s, b.strategy, b.target_user_id);
    return { ok: true };
  });
  on("GET", "/api/team/candidates", (q) => {
    const u = me();
    if (!managedOrAll(u).size) bad("Sem permissão.", 403);
    const term = (q.q || "").trim().toLowerCase();
    return users().filter((x) => x.is_active && (!term || x.full_name.toLowerCase().includes(term) || x.username.includes(term))).slice(0, 20)
      .map((x) => ({ id: x.id, name: x.full_name, username: x.username, sectors: sectorRoles(x) }));
  });

  // --- demandas
  on("GET", "/api/demands", async (q) => {
    await fresh();
    const u = me();
    let quick = q.quick === undefined ? "pendentes" : q.quick;
    const list = baseList(u, q).filter(quickFilter(quick, L.todayLocal()));
    let sort = q.sort || "prazo";
    if (["concluidas", "canceladas"].includes(quick) && sort === "prazo") sort = "atualizacao";
    list.sort(SORTS[sort] || SORTS.prazo);
    const size = Math.max(1, Math.min(Number(q.page_size) || 30, 100)), page = Math.max(1, Number(q.page) || 1);
    return { total: list.length, page, page_size: size, items: summarize(u, list.slice((page - 1) * size, page * size)) };
  });
  on("GET", "/api/demands/counts", (q) => {
    const u = me();
    const base = baseList(u, q), today = L.todayLocal();
    const quick = Object.fromEntries(QUICK.map((k) => [k, base.filter(quickFilter(k, today)).length]));
    const mine = [...db.demands.values()].filter((d) => d.assignee_id === u.id && d.status === L.STATUS_ABERTA);
    const attention = mine.filter((d) => { const a = L.currentAssignment(d); const lo = lastOtherMsg(d.id, u.id), lr = lastRead(u.id, d.id); return (a && a.user_id === u.id && !a.viewed_at) || (lo && (!lr || lo > lr)); }).length
      + [...db.demands.values()].filter((d) => d.creator_id === u.id && d.status === L.STATUS_CONFIRMACAO).length;
    return { quick, attention };
  });
  on("GET", "/api/demands/home", async () => {
    await fresh();
    const u = me();
    const vis = visible(u), today = L.todayLocal();
    const summary = { pendentes: vis.filter((d) => d.status === L.STATUS_ABERTA).length, fora_prazo: vis.filter((d) => d.status === L.STATUS_ABERTA && d.due_date < today).length,
      confirmar: vis.filter((d) => d.status === L.STATUS_CONFIRMACAO).length, concluidas: vis.filter((d) => d.status === L.STATUS_CONCLUIDA).length };
    const mine = [...db.demands.values()].filter((d) => d.assignee_id === u.id && d.status === L.STATUS_ABERTA).sort(SORTS.prazo).slice(0, 50);
    const confirm = [...db.demands.values()].filter((d) => d.creator_id === u.id && d.status === L.STATUS_CONFIRMACAO).sort((a, b) => (a.resolved_at < b.resolved_at ? -1 : 1)).slice(0, 50);
    return { summary, mine: summarize(u, mine), to_confirm: summarize(u, confirm) };
  });
  on("POST", "/api/demands", async (_, b) => {
    const u = me();
    const origin = L.sectorById(db, b.origin_sector_id);
    L.buildDemand(db, u, b, 0, "x"); // valida antes de reservar número
    const [id, seq] = await nextCounter("demanda", `codigo:${origin.acronym}-${L.todayLocal().replace(/-/g, "")}-${u.short_code}`);
    const code = `${origin.acronym}-${L.todayLocal().replace(/-/g, "")}-${u.short_code}-${String(seq).padStart(3, "0")}`;
    const d = L.buildDemand(db, u, b, id, code);
    await store.create(P.demanda(id), d, `Nova demanda ${code}`);
    markRead(u.id, id);
    return { id, code };
  });
  on("GET", "/api/demands/:id", async (q, b, p) => {
    await fresh(q.poll ? 4000 : 0);
    const u = me();
    const d = loadDemand(u, p.id);
    const a = L.currentAssignment(d);
    if (a && a.user_id === u.id && !a.viewed_at) {
      await mutateDemand(d.id, (dd) => { const aa = L.currentAssignment(dd); if (!aa || aa.user_id !== u.id || aa.viewed_at) return undefined; aa.viewed_at = L.nowIso(); return dd; }, "Visto").catch((e) => console.warn(e));
    }
    const out = await detail(u, db.demands.get(d.id));
    markRead(u.id, d.id);
    return out;
  });
  const op = (fn, msg) => async (q, b, p) => {
    const u = me();
    loadDemand(u, p.id);
    await mutateDemand(p.id, (d) => fn(db, u, d, b || {}), msg);
    return demandResult(u, p.id);
  };
  on("PATCH", "/api/demands/:id", op(L.opEdit, "Edita demanda"));
  on("POST", "/api/demands/:id/transfer", op((db_, u, d, b) => L.opTransfer(db_, u, d, b), "Encaminha demanda"));
  on("POST", "/api/demands/:id/due-date", op(L.opChangeDue, "Altera prazo"));
  on("POST", "/api/demands/:id/stage-due", op(L.opStageDue, "Altera prazo da etapa"));
  on("POST", "/api/demands/:id/complete", op(L.opComplete, "Conclui demanda"));
  on("POST", "/api/demands/:id/confirm", op(L.opConfirm, "Confirma conclusão"));
  on("POST", "/api/demands/:id/send-back", op(L.opSendBack, "Devolve demanda"));
  on("POST", "/api/demands/:id/reopen", op(L.opReopen, "Reabre demanda"));
  on("POST", "/api/demands/:id/cancel", op(L.opCancel, "Cancela demanda"));
  on("POST", "/api/demands/:id/watchers", op((db_, u, d, b) => L.opWatcher(db_, u, d, b.user_id, true), "Acompanhante"));
  on("DELETE", "/api/demands/:id/watchers/:uid", async (q, b, p) => {
    const u = me(); loadDemand(u, p.id);
    await mutateDemand(p.id, (d) => L.opWatcher(db, u, d, p.uid, false), "Acompanhante");
    return demandResult(u, p.id);
  });
  on("POST", "/api/demands/:id/messages", async (q, b, p) => {
    const u = me();
    const d = loadDemand(u, p.id);
    const content = L.validateContent(b.content, cfgKey("limits"), "Mensagem", true);
    const now = L.nowIso();
    const mid = `${Date.now()}-${u.id}-${randomId(6)}`;
    await store.create(P.mensagem(d.id, mid), { id: mid, demand_id: d.id, author_id: u.id, content, created_at: now }, `Mensagem em ${d.code}`);
    await store.mutate(P.leitura(u.id), (r) => { r = r || {}; r[d.id] = now; return r; }, "Leitura").catch(() => {});
    return detail(u, db.demands.get(d.id));
  });
  on("POST", "/api/demands/:id/tables", async (q, b, p) => {
    const u = me(); loadDemand(u, p.id);
    await mutateDemand(p.id, (d) => L.opCreateTable(db, u, d, b), "Nova tabela");
    const d = db.demands.get(Number(p.id));
    return L.tableDict(db, d.tables[d.tables.length - 1]);
  });
  on("PUT", "/api/demands/:id/tables/:tid", async (q, b, p) => {
    const u = me(); loadDemand(u, p.id);
    await mutateDemand(p.id, (d) => L.opUpdateTable(db, u, d, p.tid, b), "Atualiza tabela");
    return L.tableDict(db, db.demands.get(Number(p.id)).tables.find((t) => t.id === Number(p.tid)));
  });
  on("GET", "/api/demands/:id/tables/:tid", (q, b, p) => {
    const u = me(); const d = loadDemand(u, p.id);
    const t = (d.tables || []).find((x) => x.id === Number(p.tid));
    if (!t) bad("Tabela não encontrada.", 404);
    return L.tableDict(db, t, true);
  });

  // --- imagens
  on("POST", "/api/images", async (q, blob) => {
    me();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const lim = cfgKey("limits").max_image_kb * 1024;
    if (!bytes.length) bad("Imagem vazia.");
    if (bytes.length > lim) bad(`Imagem muito grande (${Math.round(bytes.length / 1024)} KB). O limite é ${lim / 1024} KB.`, 413);
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8, isPng = bytes[0] === 0x89 && bytes[1] === 0x50, isWebp = bytes[8] === 0x57 && bytes[9] === 0x45;
    if (!isJpeg && !isPng && !isWebp) bad("Formato não aceito. Use JPEG, PNG ou WebP.", 415);
    const uid = randomId(24);
    await store.putBinary(P.anexo(uid), bytes, "Anexo");
    return { uid, size_bytes: bytes.length };
  });

  // --- arquivos (PDF, Word, Excel...): até o limite configurado; o navegador comprime com gzip quando compensa
  on("POST", "/api/files", async (q, blob) => {
    me();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const meta = L.cleanFile({ uid: "x".repeat(24), name: q.name, size: Number(q.size), gz: q.gz === "1" }, "Arquivo");
    const lim = cfgKey("limits").max_file_mb * 1024 * 1024;
    if (!bytes.length) bad("Arquivo vazio.");
    if (bytes.length > lim) bad(`Arquivo acima de ${cfgKey("limits").max_file_mb} MB. Compartilhe o link do SharePoint/OneDrive na conversa.`, 413);
    const uid = randomId(24);
    await store.putBinary(P.anexo(uid), bytes, "Anexo");
    return { ...meta, uid };
  });

  // --- origens do pedido ("Pedido feito em / por"): lista mantida pelo administrador; também aceita texto livre
  on("GET", "/api/origens", () => {
    const u = me();
    const list = L.origens(db);
    const out = { origens: list };
    if (u.is_admin) {
      const count = new Map();
      for (const d of db.demands.values()) if (d.request_source) count.set(d.request_source, (count.get(d.request_source) || 0) + 1);
      const norm = (x) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
      const known = new Set(list.map(norm));
      out.uso = list.map((o) => ({ origem: o, demandas: count.get(o) || 0 }));
      out.livres = [...count].filter(([o]) => !known.has(norm(o))).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([origem, demandas]) => ({ origem, demandas }));
    }
    return out;
  });
  on("PUT", "/api/admin/origens", async (q, b) => {
    requireAdmin(me());
    const seen = new Set();
    const clean = (b.origens || []).map((x) => L.text(x, "Origem", false, 120)).filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
    if (clean.length > 200) bad("No máximo 200 origens.");
    await store.mutate(P.config, (c) => ({ ...(c || {}), origens: clean }), "Origens do pedido");
    return { origens: clean };
  });
  on("PUT", "/api/admin/regras", async (q, b) => {
    requireAdmin(me());
    const rules = {};
    for (const r of L.RULES) {
      const v = (b.rules || {})[r.key];
      if (!v) continue;
      const to = (v.to || []).filter((x) => L.RECIPIENTS[x]);
      const ch = (v.ch || []).filter((x) => ["email", "teams"].includes(x));
      const o = { on: v.on ? 1 : 0, to, ch };
      if (r.n) { const n = Number(v.n); if (!Number.isFinite(n) || n < 0 || n > 999) bad(`Número inválido em “${r.label}”.`); o.n = n; }
      if (o.on && !to.length && r.key !== "resumo") bad(`Escolha ao menos um destinatário em “${r.label}”.`);
      if (o.on && !ch.length) bad(`Escolha ao menos um canal em “${r.label}”.`);
      rules[r.key] = o;
    }
    await store.mutate(P.config, (c) => { c = c || {}; return { ...c, notifications: { ...L.DEFAULT_CONFIG.notifications, ...(c.notifications || {}), rules } }; }, "Regras de aviso");
    return { rules };
  });

  // --- demandas do setor (para gerentes e executivos/líderes; serve de ata das reuniões)
  on("GET", "/api/setor/demandas", async (q) => {
    await fresh();
    const u = me();
    const allowed = u.is_admin ? new Set(db.sectors.map((s) => s.id)) : L.managedSectorIds(db, u);
    if (!allowed.size) bad("Disponível para gerentes, executivos/líderes e administrador.", 403);
    const sid = Number(q.sector_id) || [...allowed][0];
    if (!allowed.has(sid)) bad("Você não gerencia este setor.", 403);
    const dir = q.dir || "todas";
    const inDir = {
      todas: (d) => d.origin_sector_id === sid || d.dest_sector_id === sid || (d.periods || []).some((p) => p.sector_id === sid),
      enviadas: (d) => d.origin_sector_id === sid,
      recebidas: (d) => d.dest_sector_id === sid,
      passaram: (d) => (d.periods || []).some((p) => p.sector_id === sid) && d.dest_sector_id !== sid,
    }[dir];
    if (!inDir) bad("Filtro inválido.");
    const today = L.todayLocal();
    const st = q.status || "";
    const okStatus = (d) => !st || (st === "vencidas" ? d.status === L.STATUS_ABERTA && d.due_date < today : st === "abertas" ? L.OPEN_STATUSES.includes(d.status) : d.status === st);
    const srcs = (q.sources || "").split("|").map((x) => x.trim().toLowerCase()).filter(Boolean);
    const term = (q.q || "").trim().toLowerCase();
    const a = q.date_from ? L.startOfDayUtc(q.date_from) : null, b = q.date_to ? L.endOfDayUtc(q.date_to) : null;
    const list = [...db.demands.values()].filter((d) => inDir(d) && okStatus(d)
      && (!srcs.length || srcs.includes((d.request_source || "").toLowerCase()) || (srcs.includes("(sem origem)") && !d.request_source))
      && (!term || d.title.toLowerCase().includes(term) || d.code.toLowerCase().includes(term))
      && (!a || d.created_at >= a) && (!b || d.created_at <= b));
    list.sort(SORTS.prazo);
    const lastNote = (d) => {
      const e = [...(d.events || [])].reverse().find((x) => ["transferida", "resolvida", "concluida", "devolvida", "reaberta", "cancelada", "prazo_alterado", "prazo_etapa", "conclusao_confirmada"].includes(x.type));
      if (!e) return null;
      const who = (db.users.get(e.actor_id) || {}).full_name || "Sistema";
      const txt = { transferida: `${who} encaminhou para ${e.data.internal ? e.data.to_user : e.data.to_sector}: ${e.data.reason}`, resolvida: `${who} concluiu: ${e.data.resolution}`, concluida: `${who} concluiu: ${e.data.resolution}`,
        devolvida: `${who} devolveu: ${e.data.reason}`, reaberta: `${who} reabriu: ${e.data.reason}`, cancelada: `${who} cancelou: ${e.data.reason}`,
        prazo_alterado: `${who} mudou o prazo para ${e.data.new}: ${e.data.justification}`, prazo_etapa: `${who} mudou o prazo da etapa: ${e.data.justification}`,
        conclusao_confirmada: e.data.auto ? "Confirmada automaticamente" : `${who} confirmou a conclusão` }[e.type];
      return { at: L.localIso(e.at), text: txt };
    };
    const items = summarize(u, list).map((x, i) => ({ ...x, resolution: list[i].resolution, last_note: lastNote(list[i]),
      direction: list[i].origin_sector_id === sid ? (list[i].dest_sector_id === sid ? "interna" : "enviada") : list[i].dest_sector_id === sid ? "recebida" : "passou" }));
    const fontes = [...new Set([...db.demands.values()].filter(inDir).map((d) => d.request_source || "(sem origem)"))].sort((x, y) => x.localeCompare(y));
    return { sector: L.sectorRef(L.sectorById(db, sid)), sectors: db.sectors.filter((s) => allowed.has(s.id)).map(L.sectorRef), items, fontes, origens: L.origens(db) };
  });

  // --- painel gerencial
  on("GET", "/api/dashboard", (q) => {
    const u = me();
    const f = dashFilters(q);
    const concluded = metric(u, q, f, "concluidas");
    const durations = concluded.map((d) => L.secondsBetween(d.created_at, d.completed_at));
    const onTime = concluded.filter((d) => L.localDate(d.resolved_at || d.completed_at) <= d.due_date);
    const bySector = new Map();
    const ids = new Set(dashBase(u, q).map((d) => d.id));
    for (const d of db.demands.values()) {
      if (!ids.has(d.id)) continue;
      for (const p of d.periods || []) {
        if (p.started_at < f.a || p.started_at > f.b) continue;
        const s = L.sectorById(db, p.sector_id);
        const x = bySector.get(p.sector_id) || { sector: { id: s.id, name: s.name, acronym: s.acronym, color: s.color }, durations: [], arrived_overdue: 0, open_periods: 0, stages: 0, stages_ok: 0, stages_late: 0 };
        x.durations.push(L.secondsBetween(p.started_at, p.ended_at)); if (p.arrived_overdue) x.arrived_overdue++; if (!p.ended_at) x.open_periods++;
        const si = L.stageInfo(p, d);
        if (si && (si.done || si.days_late)) { x.stages++; if (si.on_time && si.done) x.stages_ok++; else x.stages_late++; }
        bySector.set(p.sector_id, x);
      }
    }
    const sectors = [...bySector.values()].map((x) => ({ sector: x.sector, arrived_overdue: x.arrived_overdue, open_periods: x.open_periods, periods: x.durations.length,
      stages: x.stages, stages_ok: x.stages_ok, stages_late: x.stages_late,
      mean_days: days1(mean(x.durations)), median_days: days1(median(x.durations)), total_days: days1(x.durations.reduce((a, b) => a + b, 0)) })).sort((a, b) => b.total_days - a.total_days);
    return {
      filters: { date_from: f.from, date_to: f.to }, scope: u.is_admin ? "todas as demandas" : "demandas relacionadas aos setores que você gerencia",
      stock: { abertas: metric(u, q, f, "abertas").length, vencidas: metric(u, q, f, "vencidas").length, vencendo: metric(u, q, f, "vencendo").length },
      period: { entradas: metric(u, q, f, "entradas").length, concluidas: concluded.length, dentro_prazo: onTime.length, fora_prazo: concluded.length - onTime.length,
        prazo_alterado: concluded.filter((d) => d.due_date !== d.original_due_date).length,
        dentro_prazo_original: concluded.filter((d) => L.localDate(d.resolved_at || d.completed_at) <= d.original_due_date).length,
        reabertas_antes: concluded.filter((d) => (d.events || []).some((e) => e.type === "reaberta")).length,
        tempo_atendimento: { media_dias: durations.length ? days1(mean(durations)) : null, mediana_dias: durations.length ? days1(median(durations)) : null, amostra: durations.length } },
      sectors,
      definitions: { estoque: "Abertas, vencidas e vencendo refletem a situação atual.", entradas: "Demandas criadas no período.", concluidas: "Demandas com conclusão vigente no período.",
        prazo: "Dentro do prazo = concluída até o fim do prazo vigente.", tempo_atendimento: "Da criação até a conclusão, em dias corridos.", setores: "Passagens por setor iniciadas no período.", etapas: "Etapas com prazo próprio já encerradas (ou já vencidas): cumprida quando o setor encaminhou ou concluiu até o prazo da etapa.",
        vencendo: `Vence hoje ou nos próximos ${cfgKey("deadline_bands").yellow_max_days_left} dias.` },
    };
  });
  on("GET", "/api/dashboard/list", (q) => {
    const u = me();
    const items = metric(u, q, dashFilters(q), q.metric).sort(SORTS.prazo).slice(0, 500);
    return { metric: q.metric, items: summarize(u, items) };
  });

  // --- administração: setores
  function sectorDict(s) {
    const members = users().filter((u) => L.memberSectorIds(db, u).has(s.id));
    const p = s.primary_manager_id ? db.users.get(s.primary_manager_id) : null;
    return { id: s.id, name: s.name, acronym: s.acronym, active: s.active !== false, color: s.color, primary_manager: p ? { id: p.id, name: p.full_name } : null,
      managers: members.filter((u) => L.roleIn(db, u, s.id) !== "colaborador").map((u) => ({ id: u.id, name: u.full_name, role: L.roleIn(db, u, s.id) })).sort((x, y) => (x.role === "gerente" ? -1 : y.role === "gerente" ? 1 : x.name.localeCompare(y.name))),
      member_count: members.length, open_demands: [...db.demands.values()].filter((d) => d.dest_sector_id === s.id && L.OPEN_STATUSES.includes(d.status)).length };
  }
  function checkSectorNames(list, name, acronym, excludeId) {
    name = String(name || "").split(/\s+/).join(" ").trim(); acronym = String(acronym || "").trim().toUpperCase();
    if (name.length < 2) bad("Nome do setor inválido.");
    if (!/^[A-Z0-9]{2,5}$/.test(acronym)) bad("Sigla deve ter de 2 a 5 letras/números, sem espaços.");
    if (list.some((s) => s.id !== excludeId && (s.name.toLowerCase() === name.toLowerCase() || s.acronym === acronym))) bad("Já existe setor com este nome ou sigla.", 409);
    return [name, acronym];
  }
  on("GET", "/api/admin/sectors", () => { requireAdmin(me()); return [...db.sectors].sort((a, b) => a.name.localeCompare(b.name)).map(sectorDict); });
  on("POST", "/api/admin/sectors", async (_, b) => {
    requireAdmin(me());
    let created;
    await mutateSectors((list) => {
      const [name, acronym] = checkSectorNames(list, b.name, b.acronym);
      if (b.color && !/^#[0-9a-fA-F]{6}$/.test(b.color)) bad("Cor inválida. Use #RRGGBB.");
      created = { id: list.reduce((m, s) => Math.max(m, s.id), 0) + 1, name, acronym, active: true, color: (b.color || L.SECTOR_PALETTE[list.length % L.SECTOR_PALETTE.length]).toLowerCase(), primary_manager_id: null };
      list.push(created);
    }, "Novo setor");
    return sectorDict(created);
  });
  on("PATCH", "/api/admin/sectors/:id", async (q, b, p) => {
    requireAdmin(me());
    const sid = Number(p.id);
    if (b.active === false) {
      const open = [...db.demands.values()].filter((d) => d.dest_sector_id === sid && L.OPEN_STATUSES.includes(d.status)).length;
      if (open) bad(`O setor possui ${open} demanda(s) aberta(s). Transfira-as antes de desativar.`, 409);
    }
    await mutateSectors((list) => {
      const s = list.find((x) => x.id === sid);
      if (!s) bad("Setor não encontrado.", 404);
      if (b.name !== undefined || b.acronym !== undefined) [s.name, s.acronym] = checkSectorNames(list, b.name || s.name, b.acronym || s.acronym, sid);
      if (b.color) { if (!/^#[0-9a-fA-F]{6}$/.test(b.color)) bad("Cor inválida. Use #RRGGBB."); s.color = b.color.toLowerCase(); }
      if (b.active !== undefined) s.active = !!b.active;
    }, "Edita setor");
    return sectorDict(L.sectorById(db, sid));
  });
  on("POST", "/api/admin/sectors/:id/managers", async (q, b, p) => {
    requireAdmin(me());
    const sid = Number(p.id);
    await setRole(b.user_id, sid, b.role || "lider");
    return sectorDict(L.sectorById(db, sid));
  });
  on("DELETE", "/api/admin/sectors/:id/managers/:uid", async (q, b, p) => {
    requireAdmin(me());
    await setRole(p.uid, Number(p.id), "colaborador");
    return sectorDict(L.sectorById(db, Number(p.id)));
  });
  // Perfis no setor: colaborador, executivo/líder ou gerente. Só há um gerente por setor:
  // nomear um novo gerente passa o anterior para executivo/líder.
  async function setRole(uid, sid, role) {
    role = L.normRole(role);
    uid = Number(uid);
    const s = L.sectorById(db, sid);
    if (!s) bad("Setor não encontrado.", 404);
    const target = db.users.get(uid);
    if (!target || !target.is_active) bad("Pessoa inválida ou desativada.");
    await mutateUsers((list) => {
      for (const x of list) {
        const m = (x.memberships || []).find((mm) => mm.sector_id === sid);
        if (x.id === uid) {
          if (m) { m.role = role; m.active = true; } else x.memberships = [...(x.memberships || []), { sector_id: sid, role, active: true }];
        } else if (role === "gerente" && m && L.normRole(m.role) === "gerente") m.role = "lider";
      }
    }, "Perfil no setor");
    const pm = role === "gerente" ? uid : s.primary_manager_id === uid ? null : s.primary_manager_id;
    if (pm !== s.primary_manager_id) await mutateSectors((list) => { list.find((x) => x.id === sid).primary_manager_id = pm; }, "Gerente do setor");
  }
  on("POST", "/api/admin/users/:id/role", async (q, b, p) => { requireAdmin(me()); await setRole(p.id, Number(b.sector_id), b.role); return { ok: true }; });

  // --- administração: pessoas
  on("GET", "/api/admin/users", (q) => {
    requireAdmin(me());
    const term = (q.q || "").trim().toLowerCase();
    return users().filter((u) => (q.include_inactive || u.is_active) && (!term || u.full_name.toLowerCase().includes(term) || u.username.includes(term)))
      .sort((a, b) => a.full_name.localeCompare(b.full_name)).map((u) => ({ ...L.userFull(db, u), last_login_at: L.localIso((db.presence.get(u.id) || {}).login), last_activity_at: L.localIso((db.presence.get(u.id) || {}).at) }));
  });
  on("PATCH", "/api/admin/users/:id", async (q, b, p) => {
    requireAdmin(me());
    await mutateUser(p.id, (x) => {
      applyProfile(x, b);
      if (b.username) { const un = L.normalizeUsername(b.username); L.validateUsername(un); if (users().some((o) => o.id !== x.id && o.username === un)) bad("Login já usado por outra pessoa.", 409); x.username = un; }
      return x;
    }, "Edita pessoa");
    return L.userFull(db, db.users.get(Number(p.id)));
  });
  on("POST", "/api/admin/users/:id/reset-password", async (q, b, p) => {
    requireAdmin(me());
    const temp = tempPassword();
    const pwd = await hashPassword(temp);
    await mutateUser(p.id, (x) => { x.pwd = pwd; x.must_change_password = true; return x; }, "Senha temporária");
    return { temporary_password: temp };
  });
  on("POST", "/api/admin/users/:id/deactivate", async (q, b, p) => {
    const actor = me(); requireAdmin(actor);
    const target = db.users.get(Number(p.id));
    if (!target) bad("Pessoa não encontrada.", 404);
    if (target.is_admin) bad("O administrador não pode ser desativado pela interface.");
    const pending = openAssigned(target.id);
    if (pending.length && !b.strategy) bad(`${target.full_name} é responsável por ${pending.length} demanda(s) aberta(s). Escolha como redistribuir antes de desativar.`, 409,
      { message: `${target.full_name} é responsável por ${pending.length} demanda(s) aberta(s). Escolha como redistribuir antes de desativar.`, demands: pending.map((d) => ({ id: d.id, code: d.code, title: d.title })) });
    if (db.sectors.some((s) => s.primary_manager_id === target.id)) await mutateSectors((list) => { list.forEach((s) => { if (s.primary_manager_id === target.id) s.primary_manager_id = null; }); });
    await mutateUser(target.id, (x) => { x.is_active = false; x.deactivated_at = L.nowIso(); return x; }, "Desativa pessoa");
    if (pending.length) await redistribute(actor, pending, b.strategy, b.target_user_id, `Redistribuição: conta de ${target.full_name} desativada`);
    return { ok: true };
  });
  on("POST", "/api/admin/users/:id/activate", async (q, b, p) => { requireAdmin(me()); await mutateUser(p.id, (x) => { x.is_active = true; x.deactivated_at = null; return x; }, "Reativa pessoa"); return { ok: true }; });

  // Cadastro em massa: linhas {nome, email, telefone, setor, perfil}. Sem perfil = colaborador.
  function parseImport(rows, list) {
    const seen = new Set();
    const gerentesNaPlanilha = new Set();
    return rows.map((r, i) => {
      const out = { linha: i + 1, nome: String(r.nome || "").trim(), email: String(r.email || "").trim().toLowerCase(), telefone: String(r.telefone || "").trim(),
        setor: String(r.setor || "").trim(), perfil: String(r.perfil || "").trim().toLowerCase() || "colaborador", erros: [], avisos: [] };
      try { out.email = L.normalizeEmail(out.email) || ""; } catch (e) { out.erros.push(e.message); }
      if (!out.email) out.erros.push("E-mail obrigatório (o login vem dele).");
      out.login = out.email ? out.email.split("@")[0] : "";
      if (out.login && !/^[a-z0-9][a-z0-9._-]{1,59}$/.test(out.login)) out.erros.push("A parte antes do @ não serve como login.");
      if (out.login && list.some((u) => u.username === out.login)) out.erros.push("Login já existe.");
      if (out.login && seen.has(out.login)) out.erros.push("Login repetido na planilha."); else seen.add(out.login);
      if (out.nome.split(/\s+/).join(" ").length < 3) out.erros.push("Nome obrigatório.");
      try { out.telefone_norm = L.normalizePhone(out.telefone, true, "Telefone"); } catch (e) { out.erros.push(e.message); }
      const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
      out.setores = out.setor.split(/[;,/]/).map((x) => x.trim()).filter(Boolean).map((x) => db.sectors.find((s) => s.active !== false && (norm(s.acronym) === norm(x) || norm(s.name) === norm(x))));
      if (!out.setor) out.erros.push("Setor obrigatório.");
      else if (out.setores.some((s) => !s)) out.erros.push("Setor não existe.");
      const pmap = { colaborador: "colaborador", "": "colaborador", gerente: "gerente", lider: "lider", executivo: "lider", "executivo/lider": "lider", "executivo / lider": "lider", "lider/executivo": "lider", gestor: "lider" };
      out.role = pmap[norm(out.perfil)];
      if (!out.role) out.erros.push("Perfil deve ser Colaborador, Executivo/Líder ou Gerente.");
      if (out.role === "gerente") for (const s of out.setores.filter(Boolean)) {
        if (gerentesNaPlanilha.has(s.id)) out.erros.push(`Mais de um gerente para ${s.acronym} na planilha (só pode haver um por setor).`);
        gerentesNaPlanilha.add(s.id);
        const atual = L.sectorGerente(db, s.id);
        if (atual && atual.username !== out.login) out.avisos.push(`${s.acronym} já tem gerente (${atual.full_name}); ele(a) passa a executivo/líder.`);
      }
      return out;
    });
  }
  on("POST", "/api/admin/users/import", async (_, b) => {
    const actor = me(); requireAdmin(actor);
    const rows = b.rows || [];
    if (!rows.length) bad("Nenhuma linha para importar.");
    if (rows.length > 500) bad("No máximo 500 pessoas por vez.");
    const checked = parseImport(rows, users());
    const preview = checked.map((r) => ({ linha: r.linha, nome: r.nome, email: r.email, telefone: r.telefone_norm || r.telefone, setores: (r.setores || []).filter(Boolean).map((s) => s.acronym).join(", "),
      perfil: L.ROLE_LABEL[r.role] || r.perfil, login: r.login, erros: r.erros, avisos: r.avisos }));
    if (b.dry_run) return { rows: preview, ok: preview.filter((r) => !r.erros.length).length, errors: preview.filter((r) => r.erros.length).length };
    const good = checked.filter((r) => !r.erros.length);
    if (!good.length) bad("Nenhuma linha válida para importar.");
    const creds = [];
    const prepared = [];
    for (const r of good) { const temp = b.password || tempPassword(); prepared.push({ r, temp, pwd: await hashPassword(temp) }); }
    const newGerentes = new Map(); // setor → login do novo gerente
    await mutateUsers((list) => {
      for (const { r, temp, pwd } of prepared) {
        if (list.some((u) => u.username === r.login)) continue;
        const u = newUser(list, { username: r.login, full_name: r.nome, phone_corp: r.telefone_norm, email: r.email,
          sector_roles: r.setores.map((s) => ({ sector_id: s.id, role: r.role })), must_change_password: !b.password, created_by: actor.id }, pwd);
        creds.push({ nome: u.full_name, login: u.username, senha: temp, email: u.email, setores: r.setores.map((s) => s.acronym).join(", "), perfil: L.ROLE_LABEL[r.role] });
        if (r.role === "gerente") for (const s of r.setores) newGerentes.set(s.id, u.username);
      }
      // um gerente por setor: o anterior passa a executivo/líder
      for (const [sid, login] of newGerentes) for (const x of list) {
        const m = (x.memberships || []).find((mm) => mm.sector_id === sid);
        if (x.username !== login && m && L.normRole(m.role) === "gerente") m.role = "lider";
      }
    }, `Cadastro em massa (${prepared.length})`);
    if (newGerentes.size) {
      const byLogin = new Map(users().map((u) => [u.username, u.id]));
      await mutateSectors((list) => { for (const [sid, login] of newGerentes) { const s = list.find((x) => x.id === sid); if (s && byLogin.has(login)) s.primary_manager_id = byLogin.get(login); } }, "Gerentes dos setores");
    }
    return { created: creds, skipped: checked.length - creds.length, rows: preview };
  });

  // --- administração: configurações, avisos e dados
  on("GET", "/api/admin/settings", () => { requireAdmin(me()); return { ...Object.fromEntries(Object.keys(L.DEFAULT_CONFIG).map((k) => [k, cfgKey(k)])), app_url: appCfg.appUrl, sector_palette: L.SECTOR_PALETTE }; });
  on("PUT", "/api/admin/settings/:key", async (q, b, p) => {
    requireAdmin(me());
    const key = p.key;
    if (!L.DEFAULT_CONFIG[key]) bad("Configuração desconhecida.", 404);
    const clean = {};
    for (const [k, def] of Object.entries(L.DEFAULT_CONFIG[key])) {
      let v = b[k] === undefined ? cfgKey(key)[k] : b[k];
      if (def && typeof def === "object") { clean[k] = cfgKey(key)[k]; continue; }
      if (typeof def === "number") { v = Number(v); if (!Number.isFinite(v) || v < 0) bad(`Valor inválido para ${k}.`); }
      else v = String(v || "").trim();
      clean[k] = v;
    }
    if (key === "deadline_bands" && !(clean.orange_max_days_left < clean.yellow_max_days_left && clean.red_max_days_late >= 1 && clean.red_max_days_late < clean.darkred_max_days_late)) bad("Faixas de prazo inconsistentes.");
    if (key === "notifications") {
      if (!(clean.work_start >= 0 && clean.work_start < clean.work_end && clean.work_end <= 24)) bad("Horário comercial inválido.");
      if (clean.test_mode && clean.test_email) clean.test_email = L.normalizeEmail(clean.test_email);
      if (clean.test_mode && !clean.test_email) bad("No modo teste, informe o e-mail que recebe tudo.");
    }
    await store.mutate(P.config, (c) => ({ ...(c || {}), [key]: clean }), "Configurações");
    return clean;
  });
  on("GET", "/api/admin/avisos", () => {
    requireAdmin(me());
    const st = db.avisos || {};
    const rules = Object.fromEntries(L.RULES.map((r) => [r.key, L.rule(db, r.key)]));
    return { config: cfgKey("notifications"), flow: cfgKey("flow"), rules, rule_defs: L.RULES, recipients: L.RECIPIENTS, log: (st.log || []).map((x) => ({ ...x, at: L.localIso(x.at) })),
      last_digest: st.last_digest || null, avisos_repo: appCfg.avisosRepo, runs: (st.runs || []).map((x) => ({ ...x, at: L.localIso(x.at) })), last_run_at: L.localIso(st.last_run_at || null) };
  });
  on("GET", "/api/admin/avisos/resumo", (q) => {
    requireAdmin(me());
    const now = L.nowIso();
    return users().filter((u) => u.is_active).map((u) => { const g = digestFor(db, u, now, null); return { id: u.id, nome: u.full_name, numero: u.phone_corp, email: u.email, quantidade: digestCount(g), lista: digestLines(db, g).join("\n") }; })
      .filter((x) => x.quantidade).sort((a, b) => a.nome.localeCompare(b.nome));
  });

  // ---------------------------------------------------------------- despacho
  async function handle(method, fullPath, body) {
    const [path, qstr] = fullPath.split("?");
    const query = Object.fromEntries(new URLSearchParams(qstr || ""));
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (m) return r.fn(query, body, m.groups || {});
    }
    throw new HttpError(404, "Caminho não encontrado.");
  }
  return { handle, session, db };
}
