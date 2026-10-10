/**
 * SQLite Persistent Storage Layer for DigiWare Lead Extractor
 * STE DigiWare SUARL - Lead Intelligence Platform
 */
import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { 
  LeadRecord, 
  LeadSourceRecord, 
  SegmentDefinition, 
  EnrichmentJobState, 
  DashboardMetrics, 
  LeadFilterOptions 
} from '../../src/types/lead';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'digiware_leads.sqlite');

let db: Database | null = null;
let saveTimeout: NodeJS.Timeout | null = null;

// Default Sector Definitions for Tunisia
export const DEFAULT_SEGMENTS: SegmentDefinition[] = [
  {
    id: 'seg-avocat',
    code: 'AVOCAT',
    label: 'Avocats & Cabinets Juridiques',
    keywords: ['avocat', 'محامي', 'cabinet', 'juridique', 'barreau', 'droit', 'conseil juridique', 'notaire'],
    isCustom: false,
    color: 'indigo'
  },
  {
    id: 'seg-comptable',
    code: 'COMPTABLE',
    label: 'Experts-Comptables & Commissaires',
    keywords: ['expert-comptable', 'comptable', 'محاسب', 'commissaire aux comptes', 'fiscalité', 'audit', 'fiduciaire'],
    isCustom: false,
    color: 'emerald'
  },
  {
    id: 'seg-ecole',
    code: 'ECOLE_PRIVEE',
    label: 'Écoles Privées & Centres de Formation',
    keywords: ['école', 'ecole', 'مدرسة', 'institut', 'académie', 'lycée', 'collège', 'centre de formation', 'crèche'],
    isCustom: false,
    color: 'amber'
  },
  {
    id: 'seg-bureau-etude',
    code: 'BUREAU_ETUDE',
    label: "Bureaux d'Études & Ingénierie",
    keywords: ["bureau d'étude", "bureau d'etude", 'مكتب دراسات', 'ingénierie', 'architecture', 'architecte', 'géomètre', 'topographe'],
    isCustom: false,
    color: 'cyan'
  },
  {
    id: 'seg-entreprise',
    code: 'ENTREPRISE',
    label: 'Entreprises & Sociétés Commerciales',
    keywords: ['sarl', 'suarl', 'sa', 'société', 'societe', 'شركة', 'group', 'industrie', 'negoce', 'holding'],
    isCustom: false,
    color: 'blue'
  },
  {
    id: 'seg-commerce',
    code: 'COMMERCE',
    label: 'Commerces & Points de Vente',
    keywords: ['boutique', 'magasin', 'store', 'showroom', 'dépôt', 'vente', 'commerce', 'تجارة'],
    isCustom: false,
    color: 'orange'
  },
  {
    id: 'seg-sante',
    code: 'SANTE',
    label: 'Médecins, Cliniques & Santé',
    keywords: ['docteur', 'dr', 'طبيب', 'clinique', 'cabinet médical', 'dentiste', 'laboratoire', 'pharmacie'],
    isCustom: false,
    color: 'rose'
  },
  {
    id: 'seg-professionnel',
    code: 'PROFESSIONNEL',
    label: 'Professionnels Indépendants & Artisans',
    keywords: ['consultant', 'freelance', 'artisan', 'prestataire', 'service', 'technicien', 'agence'],
    isCustom: false,
    color: 'violet'
  },
  {
    id: 'seg-inconnu',
    code: 'INCONNU',
    label: 'Non classifié / À déterminer',
    keywords: [],
    isCustom: false,
    color: 'slate'
  }
];

/**
 * Migration helper to ensure all columns exist across tables and remove legacy constraints
 */
function runSchemaMigrations(database: Database) {
  try {
    // 1. Check leads table
    const tableInfoStmt = database.prepare("PRAGMA table_info(leads)");
    const existingLeadsCols = new Set<string>();
    while (tableInfoStmt.step()) {
      const col = tableInfoStmt.getAsObject();
      existingLeadsCols.add(String(col.name));
    }
    tableInfoStmt.free();

    const missingLeadsColumns = [
      { name: 'title', def: 'TEXT' },
      { name: 'email_type', def: 'TEXT' },
      { name: 'identity_confidence', def: 'INTEGER DEFAULT 0' },
      { name: 'email_confidence', def: 'INTEGER DEFAULT 0' },
      { name: 'candidate_emails_json', def: 'TEXT DEFAULT "[]"' },
      { name: 'identities_json', def: 'TEXT DEFAULT "[]"' },
      { name: 'professions_json', def: 'TEXT DEFAULT "[]"' },
      { name: 'locations_json', def: 'TEXT DEFAULT "[]"' },
      { name: 'organizations_json', def: 'TEXT DEFAULT "[]"' },
      { name: 'digital_assets_json', def: 'TEXT DEFAULT "[]"' },
      { name: 'discoveries_json', def: 'TEXT DEFAULT "[]"' },
      { name: 'searches_json', def: 'TEXT DEFAULT "[]"' },
      { name: 'pending_queries_json', def: 'TEXT DEFAULT "[]"' },
      { name: 'search_logs_json', def: 'TEXT DEFAULT "[]"' }
    ];

    for (const col of missingLeadsColumns) {
      if (!existingLeadsCols.has(col.name)) {
        database.run(`ALTER TABLE leads ADD COLUMN ${col.name} ${col.def}`);
        existingLeadsCols.add(col.name);
        console.log(`[SQLite Migration] Added missing column leads.${col.name}`);
      }
    }

    // Check if leads table has a legacy CHECK constraint on status
    const masterStmt = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='leads'");
    let leadsSql = '';
    if (masterStmt.step()) {
      leadsSql = String(masterStmt.getAsObject().sql || '');
    }
    masterStmt.free();

    if (leadsSql.includes('CHECK') && (leadsSql.includes('status') || leadsSql.includes('confidence'))) {
      console.log('[SQLite Migration] Migrating leads table to remove legacy status CHECK constraint...');
      database.run(`
        CREATE TABLE leads_migrated (
          id TEXT PRIMARY KEY,
          raw_phone TEXT NOT NULL,
          normalized_phone TEXT NOT NULL UNIQUE,
          national_phone TEXT NOT NULL,
          operator TEXT,
          first_name TEXT,
          last_name TEXT,
          full_name TEXT,
          title TEXT,
          company_name TEXT,
          profession TEXT,
          primary_sector TEXT DEFAULT 'INCONNU',
          segments_json TEXT DEFAULT '["INCONNU"]',
          address TEXT,
          city TEXT,
          region_governorate TEXT,
          email TEXT,
          email_type TEXT,
          website TEXT,
          identity_confidence INTEGER DEFAULT 0,
          email_confidence INTEGER DEFAULT 0,
          confidence_level TEXT DEFAULT 'LOW',
          confidence_score INTEGER DEFAULT 0,
          status TEXT DEFAULT 'PENDING',
          candidate_emails_json TEXT DEFAULT '[]',
          identities_json TEXT DEFAULT '[]',
          professions_json TEXT DEFAULT '[]',
          locations_json TEXT DEFAULT '[]',
          organizations_json TEXT DEFAULT '[]',
          digital_assets_json TEXT DEFAULT '[]',
          discoveries_json TEXT DEFAULT '[]',
          searches_json TEXT DEFAULT '[]',
          pending_queries_json TEXT DEFAULT '[]',
          search_logs_json TEXT DEFAULT '[]',
          import_batch_id TEXT,
          last_checked_at TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `);

      const colsToCopy = [
        'id', 'raw_phone', 'normalized_phone', 'national_phone', 'operator',
        'first_name', 'last_name', 'full_name', 'title', 'company_name', 'profession',
        'primary_sector', 'segments_json', 'address', 'city', 'region_governorate',
        'email', 'email_type', 'website', 'identity_confidence', 'email_confidence',
        'confidence_level', 'confidence_score', 'status', 'candidate_emails_json',
        'identities_json', 'professions_json', 'locations_json', 'organizations_json',
        'digital_assets_json', 'discoveries_json', 'searches_json', 'pending_queries_json',
        'search_logs_json', 'import_batch_id', 'last_checked_at', 'created_at', 'updated_at'
      ];
      
      const availableCols = colsToCopy.filter(c => existingLeadsCols.has(c));
      const colListStr = availableCols.join(', ');

      database.run(`INSERT OR IGNORE INTO leads_migrated (${colListStr}) SELECT ${colListStr} FROM leads;`);
      database.run(`DROP TABLE leads;`);
      database.run(`ALTER TABLE leads_migrated RENAME TO leads;`);
      database.run(`CREATE INDEX IF NOT EXISTS idx_leads_normalized_phone ON leads(normalized_phone);`);
      database.run(`CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);`);
      database.run(`CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);`);
      database.run(`CREATE INDEX IF NOT EXISTS idx_leads_sector ON leads(primary_sector);`);
      database.run(`CREATE INDEX IF NOT EXISTS idx_leads_city ON leads(city);`);
      console.log('[SQLite Migration] leads table migration completed successfully.');
    }

    // 2. Check enrichment_jobs table
    const jobsInfoStmt = database.prepare("PRAGMA table_info(enrichment_jobs)");
    const existingJobsCols = new Set<string>();
    while (jobsInfoStmt.step()) {
      const col = jobsInfoStmt.getAsObject();
      existingJobsCols.add(String(col.name));
    }
    jobsInfoStmt.free();

    const missingJobsColumns = [
      { name: 'email_confirmed_count', def: 'INTEGER DEFAULT 0' },
      { name: 'email_found_count', def: 'INTEGER DEFAULT 0' },
      { name: 'identity_found_count', def: 'INTEGER DEFAULT 0' },
      { name: 'ambiguous_count', def: 'INTEGER DEFAULT 0' },
      { name: 'failed_count', def: 'INTEGER DEFAULT 0' },
      { name: 'current_query_text', def: 'TEXT' }
    ];

    for (const col of missingJobsColumns) {
      if (!existingJobsCols.has(col.name)) {
        database.run(`ALTER TABLE enrichment_jobs ADD COLUMN ${col.name} ${col.def}`);
        console.log(`[SQLite Migration] Added missing column enrichment_jobs.${col.name}`);
      }
    }
    // 3. Check lead_sources table
    const sourcesInfoStmt = database.prepare("PRAGMA table_info(lead_sources)");
    const existingSourcesCols = new Set<string>();
    while (sourcesInfoStmt.step()) {
      const col = sourcesInfoStmt.getAsObject();
      existingSourcesCols.add(String(col.name));
    }
    sourcesInfoStmt.free();

    const missingSourcesColumns = [
      { name: 'snippet', def: 'TEXT' },
      { name: 'found_at', def: 'TEXT' }
    ];

    for (const col of missingSourcesColumns) {
      if (!existingSourcesCols.has(col.name)) {
        database.run(`ALTER TABLE lead_sources ADD COLUMN ${col.name} ${col.def}`);
        console.log(`[SQLite Migration] Added missing column lead_sources.${col.name}`);
      }
    }

    // 4. Check search_cache table
    const cacheInfoStmt = database.prepare("PRAGMA table_info(search_cache)");
    const existingCacheCols = new Set<string>();
    while (cacheInfoStmt.step()) {
      const col = cacheInfoStmt.getAsObject();
      existingCacheCols.add(String(col.name));
    }
    cacheInfoStmt.free();

    const missingCacheColumns = [
      { name: 'provider_name', def: "TEXT DEFAULT 'gemini'" },
      { name: 'results_count', def: 'INTEGER DEFAULT 0' },
      { name: 'created_at', def: "TEXT DEFAULT (datetime('now'))" },
      { name: 'last_hit_at', def: "TEXT DEFAULT (datetime('now'))" },
      { name: 'hit_count', def: 'INTEGER DEFAULT 1' }
    ];

    for (const col of missingCacheColumns) {
      if (!existingCacheCols.has(col.name)) {
        database.run(`ALTER TABLE search_cache ADD COLUMN ${col.name} ${col.def}`);
        console.log(`[SQLite Migration] Added missing column search_cache.${col.name}`);
      }
    }
  } catch (err) {
    console.warn('[SQLite Migration] Column check warning:', err);
  }
}

/**
 * Initializes the SQLite Database with schema and seeds default segments
 */
export async function getDatabase(): Promise<Database> {
  if (db) return db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    try {
      const fileBuffer = fs.readFileSync(DB_FILE);
      db = new SQL.Database(fileBuffer);
      console.log('[SQLite] Loaded existing database from disk:', DB_FILE);
    } catch (err) {
      console.error('[SQLite] Error reading database file, creating fresh one:', err);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
    console.log('[SQLite] Initialized new in-memory SQLite database.');
  }

  // Create tables and indexes
  db.run(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      raw_phone TEXT NOT NULL,
      normalized_phone TEXT NOT NULL UNIQUE,
      national_phone TEXT NOT NULL,
      operator TEXT,
      first_name TEXT,
      last_name TEXT,
      full_name TEXT,
      title TEXT,
      company_name TEXT,
      profession TEXT,
      primary_sector TEXT DEFAULT 'INCONNU',
      segments_json TEXT DEFAULT '["INCONNU"]',
      address TEXT,
      city TEXT,
      region_governorate TEXT,
      email TEXT,
      email_type TEXT,
      website TEXT,
      identity_confidence INTEGER DEFAULT 0,
      email_confidence INTEGER DEFAULT 0,
      confidence_level TEXT DEFAULT 'LOW',
      confidence_score INTEGER DEFAULT 0,
      status TEXT DEFAULT 'PENDING',
      candidate_emails_json TEXT DEFAULT '[]',
      identities_json TEXT DEFAULT '[]',
      professions_json TEXT DEFAULT '[]',
      locations_json TEXT DEFAULT '[]',
      organizations_json TEXT DEFAULT '[]',
      digital_assets_json TEXT DEFAULT '[]',
      discoveries_json TEXT DEFAULT '[]',
      searches_json TEXT DEFAULT '[]',
      pending_queries_json TEXT DEFAULT '[]',
      search_logs_json TEXT DEFAULT '[]',
      import_batch_id TEXT,
      last_checked_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lead_sources (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      field_value TEXT NOT NULL,
      source_url TEXT,
      source_type TEXT NOT NULL,
      snippet TEXT,
      found_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS segments (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      keywords_json TEXT NOT NULL,
      is_custom INTEGER DEFAULT 0,
      color TEXT DEFAULT 'indigo',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS enrichment_jobs (
      id TEXT PRIMARY KEY,
      total_leads INTEGER DEFAULT 0,
      processed_leads INTEGER DEFAULT 0,
      enriched_count INTEGER DEFAULT 0,
      not_found_count INTEGER DEFAULT 0,
      ambiguous_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      email_confirmed_count INTEGER DEFAULT 0,
      email_found_count INTEGER DEFAULT 0,
      identity_found_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'IDLE',
      current_lead_id TEXT,
      current_lead_phone TEXT,
      current_query_text TEXT,
      started_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS search_cache (
      query_hash TEXT PRIMARY KEY,
      query_text TEXT NOT NULL,
      provider_name TEXT DEFAULT 'gemini',
      results_json TEXT NOT NULL,
      results_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      last_hit_at TEXT DEFAULT (datetime('now')),
      hit_count INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_leads_normalized_phone ON leads(normalized_phone);
    CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_sector ON leads(primary_sector);
    CREATE INDEX IF NOT EXISTS idx_leads_city ON leads(city);
    CREATE INDEX IF NOT EXISTS idx_lead_sources_lead_id ON lead_sources(lead_id);
    CREATE INDEX IF NOT EXISTS idx_search_cache_hash ON search_cache(query_hash);
  `);

  runSchemaMigrations(db);

  // Seed default segments if empty
  const segCountStmt = db.prepare('SELECT COUNT(*) as count FROM segments');
  segCountStmt.step();
  const countRow = segCountStmt.getAsObject();
  segCountStmt.free();

  if (Number(countRow.count) === 0) {
    for (const seg of DEFAULT_SEGMENTS) {
      db.run(`
        INSERT INTO segments (id, code, label, keywords_json, is_custom, color)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [seg.id, seg.code, seg.label, JSON.stringify(seg.keywords), seg.isCustom ? 1 : 0, seg.color || 'indigo']);
    }
    console.log('[SQLite] Seeded default Tunisian sector segments.');
  }

  saveDatabaseToDisk();
  return db;
}

export function saveDatabaseToDisk(): void {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    if (!db) return;
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_FILE, buffer);
    } catch (err) {
      console.error('[SQLite] Error saving database to disk:', err);
    }
  }, 100);
}

function parseLeadFromRow(row: any, sources: LeadSourceRecord[] = []): LeadRecord {
  return {
    id: String(row.id),
    rawPhone: String(row.raw_phone),
    normalizedPhone: String(row.normalized_phone),
    nationalPhone: String(row.national_phone),
    operator: String(row.operator || 'Inconnu'),
    firstName: row.first_name ? String(row.first_name) : null,
    lastName: row.last_name ? String(row.last_name) : null,
    fullName: row.full_name ? String(row.full_name) : null,
    title: row.title ? String(row.title) : null,
    companyName: row.company_name ? String(row.company_name) : null,
    profession: row.profession ? String(row.profession) : null,
    primarySector: String(row.primary_sector || 'INCONNU'),
    targetMetier: row.primary_sector && row.primary_sector !== 'INCONNU' ? String(row.primary_sector) : undefined,
    segments: JSON.parse(String(row.segments_json || '["INCONNU"]')),
    address: row.address ? String(row.address) : null,
    city: row.city ? String(row.city) : null,
    regionGovernorate: row.region_governorate ? String(row.region_governorate) : null,
    email: row.email ? String(row.email) : null,
    emailType: (row.email_type as any) || null,
    website: row.website ? String(row.website) : null,
    identityConfidence: Number(row.identity_confidence || 0),
    emailConfidence: Number(row.email_confidence || 0),
    confidenceLevel: (row.confidence_level as any) || 'LOW',
    confidenceScore: Number(row.confidence_score || 0),
    status: (row.status as any) || 'PENDING',
    candidateEmails: JSON.parse(String(row.candidate_emails_json || '[]')),
    identities: JSON.parse(String(row.identities_json || '[]')),
    professions: JSON.parse(String(row.professions_json || '[]')),
    locations: JSON.parse(String(row.locations_json || '[]')),
    organizations: JSON.parse(String(row.organizations_json || '[]')),
    digitalAssets: JSON.parse(String(row.digital_assets_json || '[]')),
    discoveries: JSON.parse(String(row.discoveries_json || '[]')),
    searches: JSON.parse(String(row.searches_json || '[]')),
    pendingQueries: JSON.parse(String(row.pending_queries_json || '[]')),
    searchLogs: JSON.parse(String(row.search_logs_json || '[]')),
    sources,
    importBatchId: row.import_batch_id ? String(row.import_batch_id) : undefined,
    lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export async function getLeadById(id: string): Promise<LeadRecord | null> {
  const database = await getDatabase();
  const stmt = database.prepare('SELECT * FROM leads WHERE id = ? LIMIT 1');
  stmt.bind([id]);

  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();

    const sourcesStmt = database.prepare('SELECT * FROM lead_sources WHERE lead_id = ? ORDER BY found_at DESC');
    sourcesStmt.bind([id]);
    const sources: LeadSourceRecord[] = [];
    while (sourcesStmt.step()) {
      const srcRow = sourcesStmt.getAsObject();
      sources.push({
        id: String(srcRow.id),
        leadId: String(srcRow.lead_id),
        fieldName: srcRow.field_name as any,
        fieldValue: String(srcRow.field_value),
        sourceUrl: String(srcRow.source_url || ''),
        sourceType: srcRow.source_type as any,
        snippet: srcRow.snippet ? String(srcRow.snippet) : undefined,
        foundAt: String(srcRow.found_at)
      });
    }
    sourcesStmt.free();

    return parseLeadFromRow(row, sources);
  }
  stmt.free();
  return null;
}

export async function upsertLead(lead: LeadRecord): Promise<void> {
  const database = await getDatabase();
  const now = new Date().toISOString();

  database.run(`
    INSERT INTO leads (
      id, raw_phone, normalized_phone, national_phone, operator,
      first_name, last_name, full_name, title, company_name, profession,
      primary_sector, segments_json, address, city, region_governorate,
      email, email_type, website, identity_confidence, email_confidence,
      confidence_level, confidence_score, status, candidate_emails_json,
      identities_json, professions_json, locations_json, organizations_json,
      digital_assets_json, discoveries_json, searches_json, pending_queries_json,
      search_logs_json, import_batch_id, last_checked_at, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
    ON CONFLICT(normalized_phone) DO UPDATE SET
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      full_name = excluded.full_name,
      title = excluded.title,
      company_name = excluded.company_name,
      profession = excluded.profession,
      primary_sector = excluded.primary_sector,
      segments_json = excluded.segments_json,
      address = excluded.address,
      city = excluded.city,
      region_governorate = excluded.region_governorate,
      email = excluded.email,
      email_type = excluded.email_type,
      website = excluded.website,
      identity_confidence = excluded.identity_confidence,
      email_confidence = excluded.email_confidence,
      confidence_level = excluded.confidence_level,
      confidence_score = excluded.confidence_score,
      status = excluded.status,
      candidate_emails_json = excluded.candidate_emails_json,
      identities_json = excluded.identities_json,
      professions_json = excluded.professions_json,
      locations_json = excluded.locations_json,
      organizations_json = excluded.organizations_json,
      digital_assets_json = excluded.digital_assets_json,
      discoveries_json = excluded.discoveries_json,
      searches_json = excluded.searches_json,
      pending_queries_json = excluded.pending_queries_json,
      search_logs_json = excluded.search_logs_json,
      last_checked_at = excluded.last_checked_at,
      updated_at = excluded.updated_at
  `, [
    lead.id,
    lead.rawPhone,
    lead.normalizedPhone,
    lead.nationalPhone,
    lead.operator,
    lead.firstName,
    lead.lastName,
    lead.fullName,
    lead.title || null,
    lead.companyName,
    lead.profession,
    lead.primarySector,
    JSON.stringify(lead.segments || []),
    lead.address,
    lead.city,
    lead.regionGovernorate,
    lead.email,
    lead.emailType || null,
    lead.website,
    lead.identityConfidence || 0,
    lead.emailConfidence || 0,
    lead.confidenceLevel,
    lead.confidenceScore,
    lead.status,
    JSON.stringify(lead.candidateEmails || []),
    JSON.stringify(lead.identities || []),
    JSON.stringify(lead.professions || []),
    JSON.stringify(lead.locations || []),
    JSON.stringify(lead.organizations || []),
    JSON.stringify(lead.digitalAssets || []),
    JSON.stringify(lead.discoveries || []),
    JSON.stringify(lead.searches || []),
    JSON.stringify(lead.pendingQueries || []),
    JSON.stringify(lead.searchLogs || []),
    lead.importBatchId || null,
    lead.lastCheckedAt || now,
    lead.createdAt || now,
    now
  ]);

  // Insert or update sources
  if (lead.sources && lead.sources.length > 0) {
    for (const src of lead.sources) {
      database.run(`
        INSERT INTO lead_sources (id, lead_id, field_name, field_value, source_url, source_type, snippet, found_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `, [
        src.id || `src-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        lead.id,
        src.fieldName,
        src.fieldValue,
        src.sourceUrl || '',
        src.sourceType,
        src.snippet || null,
        src.foundAt || now
      ]);
    }
  }

  saveDatabaseToDisk();
}

const SORT_COLUMN_MAP: Record<string, string> = {
  id: 'id',
  rawPhone: 'raw_phone',
  normalizedPhone: 'normalized_phone',
  nationalPhone: 'national_phone',
  fullName: 'full_name',
  companyName: 'company_name',
  city: 'city',
  confidenceScore: 'confidence_score',
  identityConfidence: 'identity_confidence',
  emailConfidence: 'email_confidence',
  updatedAt: 'updated_at',
  createdAt: 'created_at',
  status: 'status',
  operator: 'operator'
};

export async function getLeads(options: LeadFilterOptions = {}): Promise<{ leads: LeadRecord[]; total: number; page: number; limit: number }> {
  const database = await getDatabase();
  const conditions: string[] = [];
  const params: any[] = [];

  if (options.search) {
    const s = `%${options.search.trim().toLowerCase()}%`;
    conditions.push(`(
      LOWER(raw_phone) LIKE ? OR
      LOWER(normalized_phone) LIKE ? OR
      LOWER(national_phone) LIKE ? OR
      LOWER(COALESCE(full_name, '')) LIKE ? OR
      LOWER(COALESCE(company_name, '')) LIKE ? OR
      LOWER(COALESCE(email, '')) LIKE ? OR
      LOWER(COALESCE(city, '')) LIKE ? OR
      LOWER(COALESCE(profession, '')) LIKE ?
    )`);
    params.push(s, s, s, s, s, s, s, s);
  }

  if (options.emailFilter === 'with_email') {
    conditions.push("email IS NOT NULL AND email != ''");
  } else if (options.emailFilter === 'without_email') {
    conditions.push("(email IS NULL OR email = '')");
  } else if (options.emailFilter === 'confirmed_email') {
    conditions.push("status = 'EMAIL_CONFIRMED'");
  } else if (options.emailFilter === 'candidate_email') {
    conditions.push("status IN ('EMAIL_CANDIDATE', 'EMAIL_FOUND')");
  }

  if (options.websiteFilter === 'with_website') {
    conditions.push("website IS NOT NULL AND website != ''");
  } else if (options.websiteFilter === 'without_website') {
    conditions.push("(website IS NULL OR website = '')");
  }

  if (options.sector && options.sector !== 'all') {
    conditions.push("primary_sector = ?");
    params.push(options.sector);
  }

  if (options.city && options.city !== 'all') {
    conditions.push("LOWER(city) = ?");
    params.push(options.city.toLowerCase());
  }

  if (options.regionGovernorate && options.regionGovernorate !== 'all') {
    conditions.push("LOWER(region_governorate) = ?");
    params.push(options.regionGovernorate.toLowerCase());
  }

  if (options.confidenceLevel && options.confidenceLevel !== 'all') {
    conditions.push("confidence_level = ?");
    params.push(options.confidenceLevel);
  }

  if (options.status && options.status !== 'all') {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.operator && options.operator !== 'all') {
    conditions.push("operator = ?");
    params.push(options.operator);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count total matching
  const countSql = `SELECT COUNT(*) as total FROM leads ${whereClause}`;
  const countStmt = database.prepare(countSql);
  if (params.length > 0) {
    countStmt.bind(params);
  }
  countStmt.step();
  const total = Number(countStmt.getAsObject().total || 0);
  countStmt.free();

  const page = Math.max(1, options.page || 1);
  const limit = Math.max(1, Math.min(500, options.limit || 50));
  const offset = (page - 1) * limit;

  const rawSortBy = options.sortBy || 'updatedAt';
  const sortBy = SORT_COLUMN_MAP[rawSortBy] || 'updated_at';
  const sortOrder = (options.sortOrder || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const querySql = `SELECT * FROM leads ${whereClause} ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;
  const queryParams = [...params, limit, offset];
  const queryStmt = database.prepare(querySql);
  queryStmt.bind(queryParams);

  const leads: LeadRecord[] = [];
  while (queryStmt.step()) {
    const row = queryStmt.getAsObject();
    leads.push(parseLeadFromRow(row));
  }
  queryStmt.free();

  return { leads, total, page, limit };
}

export async function deleteLead(id: string): Promise<boolean> {
  const database = await getDatabase();
  database.run('DELETE FROM lead_sources WHERE lead_id = ?', [id]);
  database.run('DELETE FROM leads WHERE id = ?', [id]);
  saveDatabaseToDisk();
  return true;
}

export async function clearAllLeads(): Promise<void> {
  const database = await getDatabase();
  database.run('DELETE FROM lead_sources');
  database.run('DELETE FROM leads');
  database.run('DELETE FROM enrichment_jobs');
  database.run('DELETE FROM search_cache');
  saveDatabaseToDisk();
  console.log('[SQLite] Cleared all leads and related records from database.');
}

/**
 * Completely resets and wipes all previous enriched data/results for leads,
 * returning them to clean PENDING status for a fresh re-analysis run.
 */
export async function resetLeadsForReanalysis(
  scope: 'all' | 'without_email' | 'no_result' | 'failed' | 'selected' = 'all',
  leadIds?: string[]
): Promise<number> {
  const database = await getDatabase();
  const now = new Date().toISOString();

  let whereClause = "1=1";
  const params: any[] = [];

  if (scope === 'without_email') {
    whereClause = "(email IS NULL OR email = '')";
  } else if (scope === 'no_result') {
    whereClause = "status IN ('NO_RESULT', 'NOT_FOUND', 'AMBIGUOUS', 'FAILED')";
  } else if (scope === 'selected' && leadIds && leadIds.length > 0) {
    const placeholders = leadIds.map(() => '?').join(',');
    whereClause = `id IN (${placeholders})`;
    params.push(...leadIds);
  }

  // 1. Delete associated sources from lead_sources table for targeted leads
  database.run(`DELETE FROM lead_sources WHERE lead_id IN (SELECT id FROM leads WHERE ${whereClause})`, params);

  // 2. Clear stale cached search queries from search_cache
  database.run("DELETE FROM search_cache");

  // 3. Reset all enrichment results on the leads table back to clean initial state
  database.run(`
    UPDATE leads SET
      email = NULL,
      email_type = NULL,
      website = NULL,
      address = NULL,
      city = NULL,
      region_governorate = NULL,
      title = NULL,
      profession = NULL,
      company_name = NULL,
      primary_sector = 'INCONNU',
      segments_json = '[]',
      identity_confidence = CASE WHEN full_name IS NOT NULL AND full_name != '' THEN 50 ELSE 0 END,
      email_confidence = 0,
      confidence_level = 'LOW',
      confidence_score = 0,
      status = 'PENDING',
      candidate_emails_json = '[]',
      identities_json = CASE WHEN full_name IS NOT NULL AND full_name != '' THEN json_array(json_object('fullName', full_name, 'confidence', 50, 'source', 'Import')) ELSE '[]' END,
      professions_json = '[]',
      locations_json = '[]',
      organizations_json = '[]',
      digital_assets_json = '[]',
      discoveries_json = '[]',
      searches_json = '[]',
      pending_queries_json = '[]',
      search_logs_json = '[]',
      last_checked_at = NULL,
      updated_at = '${now}'
    WHERE ${whereClause}
  `, params);

  const countStmt = database.prepare(`SELECT count(*) as cnt FROM leads WHERE ${whereClause}`);
  countStmt.bind(params);
  let affected = 0;
  if (countStmt.step()) {
    affected = Number(countStmt.getAsObject().cnt || 0);
  }
  countStmt.free();

  saveDatabaseToDisk();
  console.log(`[LeadDB] Reset and wiped all previous enrichment results for ${affected} leads (scope: ${scope}).`);
  return affected;
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const database = await getDatabase();
  
  const leadRowsStmt = database.prepare('SELECT * FROM leads');
  let totalLeads = 0;
  let withEmail = 0;
  let withoutEmail = 0;
  let emailConfirmedCount = 0;
  let emailFoundCount = 0;
  let identityOnlyCount = 0;
  let withWebsite = 0;
  let partiallyEnriched = 0;
  let notFound = 0;
  let highConfidence = 0;
  let mediumConfidence = 0;
  let lowConfidence = 0;
  let ambiguousCount = 0;
  let sumIdConf = 0;
  let sumEmConf = 0;

  const sectorCounts: Record<string, number> = {};
  const govCounts: Record<string, number> = {};
  const opCounts: Record<string, number> = {};

  while (leadRowsStmt.step()) {
    const row = leadRowsStmt.getAsObject();
    totalLeads++;

    const hasEm = !!row.email && String(row.email).trim() !== '';
    if (hasEm) withEmail++;
    else withoutEmail++;

    const status = String(row.status || '');
    if (status === 'EMAIL_CONFIRMED') emailConfirmedCount++;
    else if (status === 'EMAIL_FOUND' || status === 'EMAIL_CANDIDATE') emailFoundCount++;
    else if (status === 'IDENTITY_FOUND') identityOnlyCount++;
    else if (status === 'NOT_FOUND' || status === 'NO_RESULT') notFound++;
    else if (status === 'AMBIGUOUS') ambiguousCount++;
    else partiallyEnriched++;

    if (row.website && String(row.website).trim() !== '') withWebsite++;

    const confLevel = String(row.confidence_level || 'LOW');
    if (confLevel === 'HIGH') highConfidence++;
    else if (confLevel === 'MEDIUM') mediumConfidence++;
    else lowConfidence++;

    sumIdConf += Number(row.identity_confidence || 0);
    sumEmConf += Number(row.email_confidence || 0);

    const sec = String(row.primary_sector || 'INCONNU');
    sectorCounts[sec] = (sectorCounts[sec] || 0) + 1;

    const gov = String(row.region_governorate || row.city || 'Inconnu');
    govCounts[gov] = (govCounts[gov] || 0) + 1;

    const op = String(row.operator || 'Autre');
    opCounts[op] = (opCounts[op] || 0) + 1;
  }
  leadRowsStmt.free();

  const sectorDistribution = Object.entries(sectorCounts).map(([sector, count]) => {
    const seg = DEFAULT_SEGMENTS.find(s => s.code === sector);
    return {
      sector,
      count,
      label: seg ? seg.label : sector
    };
  }).sort((a, b) => b.count - a.count);

  const governorateDistribution = Object.entries(govCounts).map(([governorate, count]) => ({
    governorate,
    count
  })).sort((a, b) => b.count - a.count).slice(0, 10);

  const operatorDistribution = Object.entries(opCounts).map(([operator, count]) => ({
    operator,
    count
  })).sort((a, b) => b.count - a.count);

  return {
    totalLeads,
    withEmail,
    withoutEmail,
    emailConfirmedCount,
    emailFoundCount,
    identityOnlyCount,
    withWebsite,
    partiallyEnriched,
    notFound,
    highConfidence,
    mediumConfidence,
    lowConfidence,
    ambiguousCount,
    avgIdentityConfidence: totalLeads > 0 ? Math.round(sumIdConf / totalLeads) : 0,
    avgEmailConfidence: totalLeads > 0 ? Math.round(sumEmConf / totalLeads) : 0,
    sectorDistribution,
    governorateDistribution,
    operatorDistribution
  };
}

export async function getSegments(): Promise<SegmentDefinition[]> {
  const database = await getDatabase();
  const stmt = database.prepare('SELECT * FROM segments ORDER BY is_custom ASC, label ASC');
  const segments: SegmentDefinition[] = [];

  while (stmt.step()) {
    const row = stmt.getAsObject();
    segments.push({
      id: String(row.id),
      code: String(row.code),
      label: String(row.label),
      keywords: JSON.parse(String(row.keywords_json || '[]')),
      isCustom: Number(row.is_custom) === 1,
      color: row.color ? String(row.color) : 'indigo'
    });
  }
  stmt.free();
  return segments;
}

export async function saveSegment(segment: SegmentDefinition): Promise<void> {
  const database = await getDatabase();
  database.run(`
    INSERT INTO segments (id, code, label, keywords_json, is_custom, color)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      label = excluded.label,
      keywords_json = excluded.keywords_json,
      color = excluded.color
  `, [
    segment.id || `seg-${Date.now()}`,
    segment.code.toUpperCase(),
    segment.label,
    JSON.stringify(segment.keywords),
    segment.isCustom ? 1 : 0,
    segment.color || 'indigo'
  ]);
  saveDatabaseToDisk();
}

export async function generateNextLeadId(): Promise<string> {
  const database = await getDatabase();
  const stmt = database.prepare('SELECT COUNT(*) as count FROM leads');
  stmt.step();
  const count = Number(stmt.getAsObject().count || 0) + 1;
  stmt.free();
  return `DGR-${String(count).padStart(6, '0')}`;
}

export async function getAppSetting(key: string): Promise<string | null> {
  try {
    const database = await getDatabase();
    const stmt = database.prepare('SELECT value_json FROM app_settings WHERE key = ? LIMIT 1');
    stmt.bind([key]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return String(row.value_json);
    }
    stmt.free();
  } catch (err) {
    console.warn('[SQLite] getAppSetting error:', err);
  }
  return null;
}

export async function setAppSetting(key: string, valueJson: string): Promise<void> {
  try {
    const database = await getDatabase();
    database.run(`
      INSERT INTO app_settings (key, value_json, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `, [key, valueJson]);
    saveDatabaseToDisk();
  } catch (err) {
    console.error('[SQLite] setAppSetting error:', err);
  }
}
