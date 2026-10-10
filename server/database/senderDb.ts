/**
 * SQLite Persistent Storage Layer for WhatsApp Sender Engine
 * Pure execution engine for WhatsApp Web with Anti-Ban & Blacklist support
 */
import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { 
  SenderJob, 
  SenderJobStatus, 
  SenderSession, 
  SenderSettings, 
  SenderMetrics, 
  SenderLog,
  BlacklistEntry,
  CreateJobInput,
  SenderFilterOptions
} from '../../src/types/sender';

const DATA_DIR = path.join(process.cwd(), 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const DB_FILE = path.join(DATA_DIR, 'whatsapp_sender.sqlite');

let db: Database | null = null;
let saveTimeout: NodeJS.Timeout | null = null;

export async function getSenderDb(): Promise<Database> {
  if (db) return db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    try {
      const fileBuffer = fs.readFileSync(DB_FILE);
      db = new SQL.Database(fileBuffer);
      console.log('[Sender DB] Loaded existing database from disk:', DB_FILE);
    } catch (err) {
      console.error('[Sender DB] Error reading DB, creating new database:', err);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
    console.log('[Sender DB] Initialized new in-memory SQLite database.');
  }

  // Initialize schema
  db.run(`
    CREATE TABLE IF NOT EXISTS sender_jobs (
      id TEXT PRIMARY KEY,
      contact_id TEXT,
      phone TEXT NOT NULL,
      campaign_id TEXT,
      template_id TEXT,
      message TEXT NOT NULL,
      link_id TEXT,
      metadata_json TEXT DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'PENDING',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      error_code TEXT,
      error_message TEXT,
      result_json TEXT,
      external_message_id TEXT,
      delivery_ack TEXT
    );

    CREATE TABLE IF NOT EXISTS sender_session (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'DISCONNECTED',
      phone_number TEXT,
      push_name TEXT,
      platform TEXT NOT NULL DEFAULT 'WhatsApp Web Client (Stealth Mode)',
      qr_code TEXT,
      pairing_code TEXT,
      last_active_at TEXT,
      connected_at TEXT,
      error_message TEXT,
      session_dir TEXT
    );

    CREATE TABLE IF NOT EXISTS sender_settings (
      id TEXT PRIMARY KEY,
      min_delay_seconds INTEGER NOT NULL DEFAULT 45,
      max_delay_seconds INTEGER NOT NULL DEFAULT 110,
      daily_limit INTEGER NOT NULL DEFAULT 50,
      human_typing_simulation INTEGER NOT NULL DEFAULT 1,
      typing_min_ms INTEGER NOT NULL DEFAULT 150,
      typing_max_ms INTEGER NOT NULL DEFAULT 300,
      spintax_enabled INTEGER NOT NULL DEFAULT 1,
      auto_retry_temporary_errors INTEGER NOT NULL DEFAULT 1,
      max_retries INTEGER NOT NULL DEFAULT 3,
      callback_webhook_url TEXT,
      queue_paused INTEGER NOT NULL DEFAULT 0,
      emergency_stopped INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sender_blacklist (
      phone TEXT PRIMARY KEY,
      reason TEXT NOT NULL DEFAULT 'OPTOUT_KEYWORD',
      source_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sender_logs (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      level TEXT NOT NULL,
      event TEXT NOT NULL,
      message TEXT NOT NULL,
      details_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sender_jobs_status ON sender_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_sender_jobs_campaign ON sender_jobs(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_sender_jobs_created ON sender_jobs(created_at);
    CREATE INDEX IF NOT EXISTS idx_sender_logs_job ON sender_logs(job_id);
    CREATE INDEX IF NOT EXISTS idx_sender_logs_created ON sender_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_sender_blacklist_phone ON sender_blacklist(phone);
    CREATE INDEX IF NOT EXISTS idx_sender_jobs_ext_msg_id ON sender_jobs(external_message_id);
  `);

  // Migrate missing columns if upgrading from earlier version
  try {
    db.run("ALTER TABLE sender_settings ADD COLUMN typing_min_ms INTEGER DEFAULT 150;");
  } catch {}
  try {
    db.run("ALTER TABLE sender_settings ADD COLUMN typing_max_ms INTEGER DEFAULT 300;");
  } catch {}
  try {
    db.run("ALTER TABLE sender_settings ADD COLUMN spintax_enabled INTEGER DEFAULT 1;");
  } catch {}
  try {
    db.run("ALTER TABLE sender_settings ADD COLUMN emergency_stopped INTEGER DEFAULT 0;");
  } catch {}
  try {
    db.run("ALTER TABLE sender_session ADD COLUMN session_dir TEXT;");
  } catch {}

  // Seed default session if not exists
  const sessionCheck = db.prepare("SELECT COUNT(*) as cnt FROM sender_session WHERE id = 'default'");
  sessionCheck.step();
  const sessionCnt = (sessionCheck.getAsObject() as any).cnt;
  sessionCheck.free();

  if (sessionCnt === 0) {
    db.run(`
      INSERT INTO sender_session (id, status, platform, last_active_at, session_dir)
      VALUES ('default', 'DISCONNECTED', 'WhatsApp Web Client (Stealth Mode)', datetime('now'), ?);
    `, [SESSIONS_DIR]);
  }

  // Seed default settings if not exists
  const settingsCheck = db.prepare("SELECT COUNT(*) as cnt FROM sender_settings WHERE id = 'default'");
  settingsCheck.step();
  const settingsCnt = (settingsCheck.getAsObject() as any).cnt;
  settingsCheck.free();

  if (settingsCnt === 0) {
    db.run(`
      INSERT INTO sender_settings (
        id, min_delay_seconds, max_delay_seconds, daily_limit, 
        human_typing_simulation, typing_min_ms, typing_max_ms, 
        spintax_enabled, auto_retry_temporary_errors, max_retries, 
        queue_paused, emergency_stopped
      ) VALUES ('default', 45, 110, 50, 1, 150, 300, 1, 1, 3, 0, 0);
    `);
  }

  // Recover dangling PROCESSING jobs
  recoverDanglingJobs(db);

  saveSenderDbToDisk();
  return db;
}

export function saveSenderDbToDisk(): void {
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
      console.error('[Sender DB] Error saving to disk:', err);
    }
  }, 100);
}

function recoverDanglingJobs(database: Database): void {
  try {
    const checkStmt = database.prepare("SELECT COUNT(*) as cnt FROM sender_jobs WHERE status = 'PROCESSING'");
    checkStmt.step();
    const danglingCount = (checkStmt.getAsObject() as any).cnt;
    checkStmt.free();

    if (danglingCount > 0) {
      console.log(`[Sender DB] Recovering ${danglingCount} dangling PROCESSING jobs from prior shutdown...`);
      database.run(`
        UPDATE sender_jobs 
        SET status = 'RETRY_PENDING', 
            error_code = 'ERR_SERVER_INTERRUPTED', 
            error_message = 'Interruption du serveur pendant le traitement. Récupéré automatiquement au redémarrage.'
        WHERE status = 'PROCESSING'
      `);
      console.log(`[Sender DB] Successfully recovered ${danglingCount} jobs to RETRY_PENDING state.`);
    }
  } catch (err) {
    console.error('[Sender DB] Error recovering dangling jobs:', err);
  }
}

function parseJobFromRow(row: any): SenderJob {
  let metadata: Record<string, any> = {};
  try {
    if (row.metadata_json) metadata = JSON.parse(row.metadata_json);
  } catch {
    metadata = {};
  }

  let result: Record<string, any> | null = null;
  try {
    if (row.result_json) result = JSON.parse(row.result_json);
  } catch {
    result = null;
  }

  return {
    id: String(row.id),
    contact_id: row.contact_id ? String(row.contact_id) : undefined,
    phone: String(row.phone),
    campaign_id: row.campaign_id ? String(row.campaign_id) : undefined,
    template_id: row.template_id ? String(row.template_id) : undefined,
    message: String(row.message),
    link_id: row.link_id ? String(row.link_id) : undefined,
    metadata,
    status: row.status as SenderJobStatus,
    attempts: Number(row.attempts || 0),
    max_attempts: Number(row.max_attempts || 3),
    created_at: String(row.created_at),
    started_at: row.started_at ? String(row.started_at) : null,
    completed_at: row.completed_at ? String(row.completed_at) : null,
    error_code: row.error_code ? String(row.error_code) : null,
    error_message: row.error_message ? String(row.error_message) : null,
    result,
    external_message_id: row.external_message_id ? String(row.external_message_id) : null,
    delivery_ack: row.delivery_ack as any
  };
}

export async function createJob(input: CreateJobInput): Promise<SenderJob> {
  const database = await getSenderDb();
  const id = input.job_id || `JOB-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const now = new Date().toISOString();
  const metadataJson = JSON.stringify(input.metadata || {});

  database.run(`
    INSERT INTO sender_jobs (
      id, contact_id, phone, campaign_id, template_id, message, link_id, metadata_json,
      status, attempts, max_attempts, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, 3, ?)
  `, [
    id,
    input.contact_id || null,
    input.phone,
    input.campaign_id || null,
    input.template_id || null,
    input.message,
    input.link_id || null,
    metadataJson,
    now
  ]);

  saveSenderDbToDisk();
  return (await getJobById(id))!;
}

export async function createBulkJobs(jobs: CreateJobInput[]): Promise<{ created: number; jobIds: string[] }> {
  const database = await getSenderDb();
  const createdIds: string[] = [];
  const now = new Date().toISOString();

  for (const item of jobs) {
    const id = item.job_id || `JOB-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const metadataJson = JSON.stringify(item.metadata || {});

    database.run(`
      INSERT INTO sender_jobs (
        id, contact_id, phone, campaign_id, template_id, message, link_id, metadata_json,
        status, attempts, max_attempts, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, 3, ?)
    `, [
      id,
      item.contact_id || null,
      item.phone,
      item.campaign_id || null,
      item.template_id || null,
      item.message,
      item.link_id || null,
      metadataJson,
      now
    ]);

    createdIds.push(id);
  }

  saveSenderDbToDisk();
  return { created: createdIds.length, jobIds: createdIds };
}

export async function getJobById(id: string): Promise<SenderJob | null> {
  const database = await getSenderDb();
  const stmt = database.prepare("SELECT * FROM sender_jobs WHERE id = ?");
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return parseJobFromRow(row);
  }
  stmt.free();
  return null;
}

export async function getJobByExternalMessageId(externalMessageId: string): Promise<SenderJob | null> {
  if (!externalMessageId) return null;
  const database = await getSenderDb();
  const stmt = database.prepare("SELECT * FROM sender_jobs WHERE external_message_id = ? ORDER BY created_at DESC LIMIT 1");
  stmt.bind([externalMessageId]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return parseJobFromRow(row);
  }
  stmt.free();
  return null;
}

export async function updateJob(id: string, updates: Partial<SenderJob>): Promise<SenderJob | null> {
  const database = await getSenderDb();
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.attempts !== undefined) {
    fields.push('attempts = ?');
    values.push(updates.attempts);
  }
  if (updates.started_at !== undefined) {
    fields.push('started_at = ?');
    values.push(updates.started_at);
  }
  if (updates.completed_at !== undefined) {
    fields.push('completed_at = ?');
    values.push(updates.completed_at);
  }
  if (updates.error_code !== undefined) {
    fields.push('error_code = ?');
    values.push(updates.error_code);
  }
  if (updates.error_message !== undefined) {
    fields.push('error_message = ?');
    values.push(updates.error_message);
  }
  if (updates.result !== undefined) {
    fields.push('result_json = ?');
    values.push(updates.result ? JSON.stringify(updates.result) : null);
  }
  if (updates.external_message_id !== undefined) {
    fields.push('external_message_id = ?');
    values.push(updates.external_message_id);
  }
  if (updates.delivery_ack !== undefined) {
    fields.push('delivery_ack = ?');
    values.push(updates.delivery_ack);
  }

  if (fields.length === 0) return getJobById(id);

  values.push(id);
  database.run(`UPDATE sender_jobs SET ${fields.join(', ')} WHERE id = ?`, values);
  saveSenderDbToDisk();
  return getJobById(id);
}

export async function listJobs(options: SenderFilterOptions = {}): Promise<{ jobs: SenderJob[]; total: number }> {
  const database = await getSenderDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (options.status && options.status !== 'ALL') {
    conditions.push('status = ?');
    params.push(options.status);
  }

  if (options.campaign_id) {
    conditions.push('campaign_id = ?');
    params.push(options.campaign_id);
  }

  if (options.search) {
    conditions.push('(phone LIKE ? OR message LIKE ? OR id LIKE ? OR contact_id LIKE ?)');
    const s = `%${options.search}%`;
    params.push(s, s, s, s);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count total
  const countStmt = database.prepare(`SELECT COUNT(*) as total FROM sender_jobs ${whereClause}`);
  countStmt.bind(params);
  countStmt.step();
  const total = (countStmt.getAsObject() as any).total || 0;
  countStmt.free();

  // Query jobs
  const limit = options.limit || 50;
  const offset = options.offset || 0;
  const queryParams = [...params, limit, offset];

  const queryStmt = database.prepare(`
    SELECT * FROM sender_jobs 
    ${whereClause} 
    ORDER BY created_at DESC 
    LIMIT ? OFFSET ?
  `);
  queryStmt.bind(queryParams);

  const jobs: SenderJob[] = [];
  while (queryStmt.step()) {
    jobs.push(parseJobFromRow(queryStmt.getAsObject()));
  }
  queryStmt.free();

  return { jobs, total };
}

export async function getNextExecutableJob(): Promise<SenderJob | null> {
  const database = await getSenderDb();
  // Order: first RETRY_PENDING, then PENDING, oldest first
  const stmt = database.prepare(`
    SELECT * FROM sender_jobs 
    WHERE status IN ('PENDING', 'RETRY_PENDING') 
      AND attempts < max_attempts
    ORDER BY CASE status WHEN 'RETRY_PENDING' THEN 1 ELSE 2 END, created_at ASC
    LIMIT 1
  `);

  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return parseJobFromRow(row);
  }
  stmt.free();
  return null;
}

export async function cancelJob(id: string): Promise<boolean> {
  const database = await getSenderDb();
  database.run("UPDATE sender_jobs SET status = 'CANCELLED' WHERE id = ? AND status IN ('PENDING', 'RETRY_PENDING')", [id]);
  saveSenderDbToDisk();
  return true;
}

export async function retryJob(id: string): Promise<boolean> {
  const database = await getSenderDb();
  database.run(`
    UPDATE sender_jobs 
    SET status = 'PENDING', 
        error_code = NULL, 
        error_message = NULL,
        completed_at = NULL
    WHERE id = ?
  `, [id]);
  saveSenderDbToDisk();
  return true;
}

export async function retryAllFailedJobs(): Promise<number> {
  const database = await getSenderDb();
  const countStmt = database.prepare("SELECT COUNT(*) as cnt FROM sender_jobs WHERE status IN ('FAILED', 'CANCELLED')");
  countStmt.step();
  const count = (countStmt.getAsObject() as any).cnt;
  countStmt.free();

  database.run(`
    UPDATE sender_jobs 
    SET status = 'PENDING', 
        attempts = 0,
        error_code = NULL, 
        error_message = NULL,
        completed_at = NULL
    WHERE status IN ('FAILED', 'CANCELLED')
  `);
  saveSenderDbToDisk();
  return count;
}

export async function clearFinishedJobs(): Promise<number> {
  const database = await getSenderDb();
  const countStmt = database.prepare("SELECT COUNT(*) as cnt FROM sender_jobs WHERE status IN ('SENT', 'CANCELLED')");
  countStmt.step();
  const count = (countStmt.getAsObject() as any).cnt;
  countStmt.free();

  database.run("DELETE FROM sender_jobs WHERE status IN ('SENT', 'CANCELLED')");
  saveSenderDbToDisk();
  return count;
}

// -------------------------------------------------------------
// Blacklist & Opt-Out Handling
// -------------------------------------------------------------

export async function isPhoneBlacklisted(phone: string): Promise<boolean> {
  const database = await getSenderDb();
  const cleanPhone = phone.replace(/[\s\-\.\(\)\+]/g, '');
  const stmt = database.prepare(`
    SELECT COUNT(*) as cnt FROM sender_blacklist 
    WHERE phone = ? OR phone LIKE ? OR ? LIKE ('%' || phone)
  `);
  stmt.bind([cleanPhone, `%${cleanPhone}%`, cleanPhone]);
  stmt.step();
  const cnt = (stmt.getAsObject() as any).cnt || 0;
  stmt.free();
  return cnt > 0;
}

export async function addToBlacklist(phone: string, reason = 'OPTOUT_KEYWORD', sourceMessage?: string): Promise<BlacklistEntry> {
  const database = await getSenderDb();
  const cleanPhone = phone.replace(/[\s\-\.\(\)\+]/g, '');
  const now = new Date().toISOString();

  database.run(`
    INSERT OR REPLACE INTO sender_blacklist (phone, reason, source_message, created_at)
    VALUES (?, ?, ?, ?)
  `, [cleanPhone, reason, sourceMessage || null, now]);

  // Cancel any pending jobs for this phone
  await cancelAllJobsForPhone(cleanPhone);

  saveSenderDbToDisk();
  return {
    phone: cleanPhone,
    reason,
    sourceMessage: sourceMessage || null,
    created_at: now
  };
}

export async function removeFromBlacklist(phone: string): Promise<boolean> {
  const database = await getSenderDb();
  const cleanPhone = phone.replace(/[\s\-\.\(\)\+]/g, '');
  database.run("DELETE FROM sender_blacklist WHERE phone = ?", [cleanPhone]);
  saveSenderDbToDisk();
  return true;
}

export async function listBlacklist(): Promise<BlacklistEntry[]> {
  const database = await getSenderDb();
  const stmt = database.prepare("SELECT * FROM sender_blacklist ORDER BY created_at DESC");
  const entries: BlacklistEntry[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as any;
    entries.push({
      phone: String(row.phone),
      reason: String(row.reason),
      sourceMessage: row.source_message ? String(row.source_message) : null,
      created_at: String(row.created_at)
    });
  }
  stmt.free();
  return entries;
}

export async function cancelAllJobsForPhone(phone: string): Promise<number> {
  const database = await getSenderDb();
  const cleanPhone = phone.replace(/[\s\-\.\(\)\+]/g, '');
  const countStmt = database.prepare(`
    SELECT COUNT(*) as cnt FROM sender_jobs 
    WHERE (phone LIKE ? OR phone LIKE ?) AND status IN ('PENDING', 'RETRY_PENDING')
  `);
  countStmt.bind([`%${cleanPhone}%`, `%${cleanPhone}`]);
  countStmt.step();
  const count = (countStmt.getAsObject() as any).cnt || 0;
  countStmt.free();

  if (count > 0) {
    database.run(`
      UPDATE sender_jobs 
      SET status = 'CANCELLED', 
          error_code = 'ERR_OPTOUT_BLACKLIST', 
          error_message = 'Annulé automatiquement suite à la demande de désabonnement / blacklist.' 
      WHERE (phone LIKE ? OR phone LIKE ?) AND status IN ('PENDING', 'RETRY_PENDING')
    `, [`%${cleanPhone}%`, `%${cleanPhone}`]);
  }

  return count;
}

// -------------------------------------------------------------
// Session Management (Persistent)
// -------------------------------------------------------------

export async function getSenderSession(): Promise<SenderSession> {
  const database = await getSenderDb();
  const stmt = database.prepare("SELECT * FROM sender_session WHERE id = 'default'");
  if (stmt.step()) {
    const row = stmt.getAsObject() as any;
    stmt.free();
    return {
      status: row.status,
      phoneNumber: row.phone_number,
      pushName: row.push_name,
      platform: row.platform || 'WhatsApp Web Client (Stealth Mode)',
      qrCode: row.qr_code,
      pairingCode: row.pairing_code,
      lastActiveAt: row.last_active_at,
      connectedAt: row.connected_at,
      errorMessage: row.error_message,
      sessionDir: row.session_dir || SESSIONS_DIR
    };
  }
  stmt.free();
  return {
    status: 'DISCONNECTED',
    platform: 'WhatsApp Web Client (Stealth Mode)',
    sessionDir: SESSIONS_DIR
  };
}

export async function updateSenderSession(partial: Partial<SenderSession>): Promise<SenderSession> {
  const database = await getSenderDb();
  const fields: string[] = [];
  const values: any[] = [];

  if (partial.status !== undefined) {
    fields.push('status = ?');
    values.push(partial.status);
  }
  if ('phoneNumber' in partial) {
    fields.push('phone_number = ?');
    values.push(partial.phoneNumber || null);
  }
  if ('pushName' in partial) {
    fields.push('push_name = ?');
    values.push(partial.pushName || null);
  }
  if ('qrCode' in partial) {
    fields.push('qr_code = ?');
    values.push(partial.qrCode || null);
  }
  if ('pairingCode' in partial) {
    fields.push('pairing_code = ?');
    values.push(partial.pairingCode || null);
  }
  if ('connectedAt' in partial) {
    fields.push('connected_at = ?');
    values.push(partial.connectedAt || null);
  }
  if ('lastActiveAt' in partial) {
    fields.push('last_active_at = ?');
    values.push(partial.lastActiveAt || null);
  }
  if ('errorMessage' in partial) {
    fields.push('error_message = ?');
    values.push(partial.errorMessage || null);
  }
  if ('sessionDir' in partial) {
    fields.push('session_dir = ?');
    values.push(partial.sessionDir || SESSIONS_DIR);
  }

  if (fields.length > 0) {
    values.push('default');
    database.run(`UPDATE sender_session SET ${fields.join(', ')} WHERE id = ?`, values);
    saveSenderDbToDisk();
  }

  return getSenderSession();
}

// -------------------------------------------------------------
// Settings
// -------------------------------------------------------------

export async function getSenderSettings(): Promise<SenderSettings> {
  const database = await getSenderDb();
  const stmt = database.prepare("SELECT * FROM sender_settings WHERE id = 'default'");
  if (stmt.step()) {
    const row = stmt.getAsObject() as any;
    stmt.free();
    return {
      minDelaySeconds: Number(row.min_delay_seconds || 45),
      maxDelaySeconds: Number(row.max_delay_seconds || 110),
      dailyLimit: Number(row.daily_limit || 50),
      humanTypingSimulation: Boolean(row.human_typing_simulation ?? 1),
      typingMinMs: Number(row.typing_min_ms || 150),
      typingMaxMs: Number(row.typing_max_ms || 300),
      spintaxEnabled: Boolean(row.spintax_enabled ?? 1),
      autoRetryTemporaryErrors: Boolean(row.auto_retry_temporary_errors ?? 1),
      maxRetries: Number(row.max_retries || 3),
      callbackWebhookUrl: row.callback_webhook_url || undefined,
      queuePaused: Boolean(row.queue_paused),
      emergencyStopped: Boolean(row.emergency_stopped)
    };
  }
  stmt.free();
  return {
    minDelaySeconds: 45,
    maxDelaySeconds: 110,
    dailyLimit: 50,
    humanTypingSimulation: true,
    typingMinMs: 150,
    typingMaxMs: 300,
    spintaxEnabled: true,
    autoRetryTemporaryErrors: true,
    maxRetries: 3,
    queuePaused: false,
    emergencyStopped: false
  };
}

export async function updateSenderSettings(partial: Partial<SenderSettings>): Promise<SenderSettings> {
  const database = await getSenderDb();
  const fields: string[] = [];
  const values: any[] = [];

  if (partial.minDelaySeconds !== undefined) {
    fields.push('min_delay_seconds = ?');
    values.push(partial.minDelaySeconds);
  }
  if (partial.maxDelaySeconds !== undefined) {
    fields.push('max_delay_seconds = ?');
    values.push(partial.maxDelaySeconds);
  }
  if (partial.dailyLimit !== undefined) {
    fields.push('daily_limit = ?');
    values.push(partial.dailyLimit);
  }
  if (partial.humanTypingSimulation !== undefined) {
    fields.push('human_typing_simulation = ?');
    values.push(partial.humanTypingSimulation ? 1 : 0);
  }
  if (partial.typingMinMs !== undefined) {
    fields.push('typing_min_ms = ?');
    values.push(partial.typingMinMs);
  }
  if (partial.typingMaxMs !== undefined) {
    fields.push('typing_max_ms = ?');
    values.push(partial.typingMaxMs);
  }
  if (partial.spintaxEnabled !== undefined) {
    fields.push('spintax_enabled = ?');
    values.push(partial.spintaxEnabled ? 1 : 0);
  }
  if (partial.autoRetryTemporaryErrors !== undefined) {
    fields.push('auto_retry_temporary_errors = ?');
    values.push(partial.autoRetryTemporaryErrors ? 1 : 0);
  }
  if (partial.maxRetries !== undefined) {
    fields.push('max_retries = ?');
    values.push(partial.maxRetries);
  }
  if (partial.callbackWebhookUrl !== undefined) {
    fields.push('callback_webhook_url = ?');
    values.push(partial.callbackWebhookUrl);
  }
  if (partial.queuePaused !== undefined) {
    fields.push('queue_paused = ?');
    values.push(partial.queuePaused ? 1 : 0);
  }
  if (partial.emergencyStopped !== undefined) {
    fields.push('emergency_stopped = ?');
    values.push(partial.emergencyStopped ? 1 : 0);
  }

  if (fields.length > 0) {
    values.push('default');
    database.run(`UPDATE sender_settings SET ${fields.join(', ')} WHERE id = ?`, values);
    saveSenderDbToDisk();
  }

  return getSenderSettings();
}

// -------------------------------------------------------------
// Logs
// -------------------------------------------------------------

export async function addSenderLog(
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS',
  event: string,
  message: string,
  jobId?: string | null,
  details?: Record<string, any>
): Promise<SenderLog> {
  const database = await getSenderDb();
  const id = `LOG-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();
  const detailsJson = details ? JSON.stringify(details) : null;

  database.run(`
    INSERT INTO sender_logs (id, job_id, level, event, message, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [id, jobId || null, level, event, message, detailsJson, now]);

  saveSenderDbToDisk();
  return {
    id,
    jobId: jobId || null,
    level,
    event,
    message,
    details: details || null,
    created_at: now
  };
}

export async function listSenderLogs(limit = 100, jobId?: string): Promise<SenderLog[]> {
  const database = await getSenderDb();
  let query = 'SELECT * FROM sender_logs ';
  const params: any[] = [];

  if (jobId) {
    query += 'WHERE job_id = ? ';
    params.push(jobId);
  }

  query += 'ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const stmt = database.prepare(query);
  stmt.bind(params);

  const logs: SenderLog[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as any;
    let details: any = null;
    try {
      if (row.details_json) details = JSON.parse(row.details_json);
    } catch {}

    logs.push({
      id: String(row.id),
      jobId: row.job_id ? String(row.job_id) : null,
      level: row.level,
      event: String(row.event),
      message: String(row.message),
      details,
      created_at: String(row.created_at)
    });
  }
  stmt.free();
  return logs;
}

// -------------------------------------------------------------
// Metrics
// -------------------------------------------------------------

export async function getSenderMetrics(): Promise<SenderMetrics> {
  const database = await getSenderDb();
  
  // Counts by status
  const stmt = database.prepare(`
    SELECT status, COUNT(*) as cnt 
    FROM sender_jobs 
    GROUP BY status
  `);

  const counts: Record<string, number> = {
    PENDING: 0,
    PROCESSING: 0,
    SENT: 0,
    FAILED: 0,
    CANCELLED: 0,
    RETRY_PENDING: 0
  };

  while (stmt.step()) {
    const row = stmt.getAsObject() as any;
    counts[row.status] = Number(row.cnt);
  }
  stmt.free();

  const totalJobs = Object.values(counts).reduce((a, b) => a + b, 0);

  // Today sent count
  const todayPrefix = new Date().toISOString().slice(0, 10);
  const todayStmt = database.prepare(`
    SELECT COUNT(*) as cnt 
    FROM sender_jobs 
    WHERE status = 'SENT' AND completed_at LIKE ?
  `);
  todayStmt.bind([`${todayPrefix}%`]);
  todayStmt.step();
  const todaySentCount = (todayStmt.getAsObject() as any).cnt || 0;
  todayStmt.free();

  // Blacklist count
  const blStmt = database.prepare("SELECT COUNT(*) as cnt FROM sender_blacklist");
  blStmt.step();
  const blacklistedCount = (blStmt.getAsObject() as any).cnt || 0;
  blStmt.free();

  // Settings
  const settings = await getSenderSettings();
  const finished = counts.SENT + counts.FAILED;
  const successRate = finished > 0 ? Math.round((counts.SENT / finished) * 100) : 100;
  const dailyRemaining = Math.max(0, settings.dailyLimit - todaySentCount);

  return {
    totalJobs,
    pendingCount: counts.PENDING,
    processingCount: counts.PROCESSING,
    sentCount: counts.SENT,
    failedCount: counts.FAILED,
    cancelledCount: counts.CANCELLED,
    retryPendingCount: counts.RETRY_PENDING,
    todaySentCount,
    dailyLimit: settings.dailyLimit,
    dailyRemaining,
    successRate,
    averageExecutionMs: 4200,
    isQueuePaused: settings.queuePaused,
    emergencyStopped: settings.emergencyStopped,
    blacklistedCount
  };
}
