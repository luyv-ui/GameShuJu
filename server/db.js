import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export const sqliteEnabled = () => Boolean(process.env.DATABASE_FILE);

const schema = `
CREATE TABLE IF NOT EXISTS game_base (
  id TEXT PRIMARY KEY, position INTEGER NOT NULL, name TEXT, genre TEXT, channel TEXT,
  source_url TEXT, updated_at TEXT, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS game_base_position ON game_base(position);
CREATE INDEX IF NOT EXISTS game_base_name ON game_base(name);
CREATE TABLE IF NOT EXISTS project_base (
  id TEXT PRIMARY KEY, position INTEGER NOT NULL, name TEXT, genre TEXT, stage TEXT,
  studio TEXT, risk_review_complete INTEGER NOT NULL DEFAULT 0,
  created_at TEXT, updated_at TEXT, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_base_position ON project_base(position);
CREATE TABLE IF NOT EXISTS market_analysis (
  project_id TEXT PRIMARY KEY REFERENCES project_base(id) ON DELETE CASCADE,
  tam REAL, growth_12m_pct REAL, survival_6m_pct REAL, region TEXT, as_of TEXT, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_metric (
  project_id TEXT PRIMARY KEY REFERENCES project_base(id) ON DELETE CASCADE,
  d1_pct REAL, d7_pct REAL, d30_pct REAL, d90_pct REAL, paying_d180_pct REAL,
  monthly_cash_decay_pct REAL, region TEXT, as_of TEXT, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS commercial (
  project_id TEXT PRIMARY KEY REFERENCES project_base(id) ON DELETE CASCADE,
  arpu REAL, arppu REAL, ltv90 REAL, cac REAL, region TEXT, as_of TEXT, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS version_ops (
  project_id TEXT PRIMARY KEY REFERENCES project_base(id) ON DELETE CASCADE,
  version_cycle_months REAL, version_revenue_lift_pct REAL,
  economy_stability_score REAL, region TEXT, as_of TEXT, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS risk_analysis (
  id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES project_base(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, category TEXT, status TEXT, severity TEXT,
  evidence_url TEXT, payload TEXT NOT NULL, PRIMARY KEY(project_id, id)
);
CREATE INDEX IF NOT EXISTS risk_analysis_status ON risk_analysis(status, severity);
CREATE TABLE IF NOT EXISTS benchmark_compare (
  project_id TEXT PRIMARY KEY REFERENCES project_base(id) ON DELETE CASCADE,
  benchmark_irr_pct REAL, benchmark_payback_months REAL, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS investment_report (
  project_id TEXT PRIMARY KEY REFERENCES project_base(id) ON DELETE CASCADE,
  currency TEXT, upfront_cost REAL, annual_discount_rate_pct REAL, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS score_config (
  id INTEGER PRIMARY KEY CHECK (id = 1), updated_at TEXT NOT NULL,
  market_weight REAL, returns_weight REAL, sustainability_weight REAL, risk_reserve_weight REAL,
  payload TEXT NOT NULL
);`;

export function withDatabase(operation) {
  if (!sqliteEnabled()) throw new Error('未配置 DATABASE_FILE');
  const filename = path.resolve(process.env.DATABASE_FILE);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename, { timeout: 5000 });
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(schema);
    return operation(db);
  } finally { db.close(); }
}

export function withDatabaseTransaction(operation) {
  return withDatabase(db => db.transaction(() => operation(db)).immediate());
}

export function dbListGames(db) {
  return db.prepare('SELECT payload FROM game_base ORDER BY position').all().map(row => JSON.parse(row.payload));
}

export function dbSaveGames(db, games) {
  db.prepare('DELETE FROM game_base').run();
  const insert = db.prepare(`INSERT INTO game_base
    (id, position, name, genre, channel, source_url, updated_at, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  games.forEach((game, index) => insert.run(game.id, index, game.name ?? null, game.genre ?? null,
    game.channel ?? null, game.sourceUrl ?? null, game.updatedAt ?? null, JSON.stringify(game)));
}

export function dbListProjects(db) {
  return db.prepare('SELECT payload FROM project_base ORDER BY position').all().map(row => JSON.parse(row.payload));
}

function section(project, name) { return project.investmentInputs?.[name] ?? {}; }
function storeProjection(db, table, columns, values) {
  const fields = ['project_id', ...columns, 'payload'];
  db.prepare(`INSERT INTO ${table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`).run(...values);
}

export function dbSaveProjects(db, projects) {
  db.prepare('DELETE FROM project_base').run();
  const insert = db.prepare(`INSERT INTO project_base
    (id, position, name, genre, stage, studio, risk_review_complete, created_at, updated_at, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const riskInsert = db.prepare(`INSERT INTO risk_analysis
    (id, project_id, position, category, status, severity, evidence_url, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  projects.forEach((project, index) => {
    insert.run(project.id, index, project.name ?? null, project.genre ?? null, project.stage ?? null,
      project.studio ?? null, project.riskReviewComplete ? 1 : 0,
      project.createdAt ?? null, project.updatedAt ?? null, JSON.stringify(project));
    const market = section(project, 'market');
    storeProjection(db, 'market_analysis', ['tam', 'growth_12m_pct', 'survival_6m_pct', 'region', 'as_of'],
      [project.id, market.tam ?? null, market.growth12mPct ?? null, market.survival6mPct ?? null,
        market.region ?? null, market.asOf ?? null, JSON.stringify(market)]);
    const users = section(project, 'users');
    storeProjection(db, 'user_metric', ['d1_pct', 'd7_pct', 'd30_pct', 'd90_pct', 'paying_d180_pct', 'monthly_cash_decay_pct', 'region', 'as_of'],
      [project.id, users.d1Pct ?? null, users.d7Pct ?? null, users.d30Pct ?? null, users.d90Pct ?? null,
        users.payingD180Pct ?? null, users.monthlyCashDecayPct ?? null, users.region ?? null, users.asOf ?? null,
        JSON.stringify(users)]);
    const commercial = section(project, 'commercial');
    storeProjection(db, 'commercial', ['arpu', 'arppu', 'ltv90', 'cac', 'region', 'as_of'],
      [project.id, commercial.arpu ?? null, commercial.arppu ?? null, commercial.ltv90 ?? null,
        commercial.cac ?? null, commercial.region ?? null, commercial.asOf ?? null, JSON.stringify(commercial)]);
    const operations = section(project, 'operations');
    storeProjection(db, 'version_ops', ['version_cycle_months', 'version_revenue_lift_pct', 'economy_stability_score', 'region', 'as_of'],
      [project.id, operations.versionCycleMonths ?? null, operations.versionRevenueLiftPct ?? null,
        operations.economyStabilityScore ?? null, operations.region ?? null, operations.asOf ?? null,
        JSON.stringify(operations)]);
    (project.risks ?? []).forEach((risk, riskIndex) => riskInsert.run(risk.id, project.id, riskIndex,
      risk.category ?? null, risk.status ?? null, risk.severity ?? null, risk.evidenceUrl ?? null, JSON.stringify(risk)));
    storeProjection(db, 'benchmark_compare', ['benchmark_irr_pct', 'benchmark_payback_months'],
      [project.id, market.benchmarkIrrPct ?? null, market.benchmarkPaybackMonths ?? null,
        JSON.stringify({ benchmarkIrrPct: market.benchmarkIrrPct ?? null,
          benchmarkPaybackMonths: market.benchmarkPaybackMonths ?? null })]);
    const finance = section(project, 'finance');
    storeProjection(db, 'investment_report', ['currency', 'upfront_cost', 'annual_discount_rate_pct'],
      [project.id, finance.currency ?? null, finance.upfrontCost ?? null,
        finance.annualDiscountRatePct ?? null, JSON.stringify(finance)]);
  });
}

export function dbGetScoreConfig(db) {
  const row = db.prepare('SELECT payload FROM score_config WHERE id = 1').get();
  return row ? JSON.parse(row.payload) : null;
}

export function dbPutScoreConfig(db, config) {
  db.prepare(`INSERT INTO score_config
    (id, updated_at, market_weight, returns_weight, sustainability_weight, risk_reserve_weight, payload)
    VALUES (1, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
    updated_at=excluded.updated_at, market_weight=excluded.market_weight,
    returns_weight=excluded.returns_weight, sustainability_weight=excluded.sustainability_weight,
    risk_reserve_weight=excluded.risk_reserve_weight, payload=excluded.payload`).run(
    new Date().toISOString(), config.weights.market, config.weights.returns,
    config.weights.sustainability, config.weights.riskReserve, JSON.stringify(config));
}
