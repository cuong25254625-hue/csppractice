const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const Database = require("better-sqlite3");
const XLSX = require("xlsx");
const mammoth = require("mammoth");
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require("docx");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const MATHJAX_DIR = path.join(ROOT, "node_modules", "mathjax");
const DATA_DIR = path.join(ROOT, "data");
const BACKUP_DIR = path.join(ROOT, "backups");
const DB_FILE = path.join(DATA_DIR, "db.json");
const SQLITE_FILE = path.join(DATA_DIR, "runtime.sqlite");
const PAPERS_FILE = path.join(DATA_DIR, "papers.json");
const PORT = Number(process.env.PORT || 5173);
const MAX_BODY = 1024 * 1024;
const MAX_UPLOAD = 20 * 1024 * 1024;
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || 100000);
const MAX_AUDIT_LOGS = Number(process.env.MAX_AUDIT_LOGS || 10000);
const SESSION_MAX_AGE_DAYS = Number(process.env.SESSION_MAX_AGE_DAYS || 7);
const SESSION_MAX_AGE_MS = Math.max(1, SESSION_MAX_AGE_DAYS) * 24 * 60 * 60 * 1000;
const BACKUP_RETENTION = Number(process.env.BACKUP_RETENTION || 14);
const BACKUP_INTERVAL_HOURS = Number(process.env.BACKUP_INTERVAL_HOURS || 24);
const LOGIN_MAX_FAILURES = Number(process.env.LOGIN_MAX_FAILURES || 8);
const LOGIN_WINDOW_MS = Number(process.env.LOGIN_WINDOW_MINUTES || 15) * 60 * 1000;
const PROGRAM_SUBMISSION_ENABLED = /^(1|true|yes)$/i.test(process.env.ENABLE_PROGRAM_SUBMISSION || "");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}

let runtimeStore = null;

function getRuntimeStore() {
  if (runtimeStore) return runtimeStore;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  runtimeStore = new Database(SQLITE_FILE);
  runtimeStore.pragma("journal_mode = WAL");
  runtimeStore.prepare(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `).run();
  runtimeStore.prepare(`
    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      username TEXT NOT NULL,
      type TEXT NOT NULL,
      paperId TEXT,
      paperTitle TEXT,
      questionId TEXT,
      questionTitle TEXT,
      classId TEXT,
      score REAL,
      fullScore REAL,
      status TEXT,
      passed INTEGER,
      total INTEGER,
      detailsJson TEXT,
      payloadJson TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `).run();
  runtimeStore.prepare("CREATE INDEX IF NOT EXISTS idx_attempts_user_created ON attempts (userId, createdAt DESC)").run();
  runtimeStore.prepare("CREATE INDEX IF NOT EXISTS idx_attempts_paper_created ON attempts (paperId, createdAt DESC)").run();
  runtimeStore.prepare("CREATE INDEX IF NOT EXISTS idx_attempts_class_created ON attempts (classId, createdAt DESC)").run();
  runtimeStore.prepare("CREATE INDEX IF NOT EXISTS idx_attempts_user_paper_created ON attempts (userId, paperId, createdAt DESC)").run();
  return runtimeStore;
}

function loadRuntimeState() {
  const state = loadStateValue("db");
  if (state) {
    const normalized = normalizeDb(state);
    migrateAttemptsFromState(normalized.attempts);
    normalized.attempts = [];
    return normalized;
  }
  const imported = normalizeDb(readJson(DB_FILE, {}));
  migrateAttemptsFromState(imported.attempts);
  imported.attempts = [];
  saveDb(imported);
  return imported;
}

function loadStateValue(key) {
  const store = getRuntimeStore();
  const row = store.prepare("SELECT value FROM app_state WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : null;
}

function saveStateValue(key, value) {
  const store = getRuntimeStore();
  const transaction = store.transaction((payload) => {
    store.prepare(`
      INSERT INTO app_state (key, value, updatedAt)
      VALUES (@key, @value, @updatedAt)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updatedAt = excluded.updatedAt
    `).run(payload);
  });
  transaction({
    key,
    value: JSON.stringify(value),
    updatedAt: new Date().toISOString()
  });
}

function runtimeStateForStorage(db) {
  return { ...normalizeDb(db), attempts: [] };
}

function saveRuntimeState(db) {
  saveStateValue("db", runtimeStateForStorage(db));
}

function loadPaperState() {
  const stored = loadStateValue("papers");
  if (Array.isArray(stored)) return stored;
  return readJson(PAPERS_FILE, []);
}

function savePaperState(papers) {
  saveStateValue("papers", papers);
  writeJson(PAPERS_FILE, papers);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function sessionExpiresAt(from = new Date()) {
  return new Date(from.getTime() + SESSION_MAX_AGE_MS).toISOString();
}

function isExpired(isoTime) {
  return Boolean(isoTime && new Date(isoTime).getTime() <= Date.now());
}

function createSession(db, user) {
  const sid = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  db.sessions[sid] = {
    userId: user.id,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: sessionExpiresAt(now)
  };
  return sid;
}

function sessionCookie(req, sid, maxAgeSeconds = Math.floor(SESSION_MAX_AGE_MS / 1000)) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const secure = /^(1|true|yes)$/i.test(process.env.COOKIE_SECURE || "") || forwardedProto === "https" || req.socket.encrypted;
  return [
    `sid=${encodeURIComponent(sid)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    secure ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

function clearSessionCookie(req) {
  return sessionCookie(req, "", 0);
}

const loginFailures = new Map();

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
}

function loginFailureKey(req, username) {
  return `${clientIp(req)}:${String(username || "").toLowerCase()}`;
}

function isLoginLimited(req, username) {
  const item = loginFailures.get(loginFailureKey(req, username));
  if (!item) return false;
  if (Date.now() - item.firstAt > LOGIN_WINDOW_MS) {
    loginFailures.delete(loginFailureKey(req, username));
    return false;
  }
  return item.count >= LOGIN_MAX_FAILURES;
}

function recordLoginFailure(req, username) {
  const key = loginFailureKey(req, username);
  const now = Date.now();
  const item = loginFailures.get(key);
  if (!item || now - item.firstAt > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 1, firstAt: now });
    return;
  }
  item.count += 1;
}

function clearLoginFailures(req, username) {
  loginFailures.delete(loginFailureKey(req, username));
}

function normalizeDb(db) {
  db.users ||= [];
  db.sessions ||= {};
  db.attempts ||= [];
  db.classes ||= [];
  db.enrollments ||= [];
  db.assignments ||= [];
  db.auditLogs ||= [];
  db.examTypes ||= [];
  db.paperVisibility ||= {};
  db.settings ||= {};
  db.settings.allowRegistration = db.settings.allowRegistration !== false;

  db.users.forEach((user) => {
    user.role ||= "student";
    user.status ||= "active";
    user.createdAt ||= new Date().toISOString();
    if (user.role !== "student") delete user.teacherId;
  });
  Object.entries(db.sessions).forEach(([sid, session]) => {
    if (!session?.userId || isExpired(session.expiresAt)) {
      delete db.sessions[sid];
      return;
    }
    session.createdAt ||= new Date().toISOString();
    session.expiresAt ||= sessionExpiresAt(new Date(session.createdAt));
  });

  seedUser(db, "admin", "admin123", "admin");
  seedUser(db, "teacher", "teacher123", "teacher");
  seedUser(db, "demo", "demo123", "student");
  seedExamTypes(db);
  db.examTypes = db.examTypes.filter((item) => item.id !== "csp");
  db.assignments.forEach((assignment) => {
    assignment.startAt ||= "";
    assignment.endAt ||= assignment.endAt || assignment.dueAt || "";
    assignment.dueAt = assignment.endAt;
  });
  db.classes.forEach((klass) => {
    klass.category ||= "gesp";
    if (klass.category === "csp") klass.category = "cspj";
    const examType = db.examTypes.find((item) => item.id === klass.category);
    if (!examType?.levelEnabled) klass.level = null;
  });
  return db;
}

function seedExamTypes(db) {
  const defaults = [
    { id: "gesp", name: "GESP", levelEnabled: true, builtIn: true },
    { id: "cspj", name: "CSP-J 初赛", levelEnabled: false, builtIn: true },
    { id: "csps", name: "CSP-S 初赛", levelEnabled: false, builtIn: true }
  ];
  defaults.forEach((item) => {
    const existing = db.examTypes.find((type) => type.id === item.id);
    if (existing) {
      existing.name ||= item.name;
      existing.levelEnabled = item.levelEnabled;
      existing.builtIn = true;
    } else {
      db.examTypes.push(item);
    }
  });
}

function seedUser(db, username, password, role) {
  const existing = db.users.find((user) => user.username.toLowerCase() === username.toLowerCase());
  if (existing) {
    existing.role ||= role;
    existing.status ||= "active";
    return;
  }
  const { salt, hash } = hashPassword(password);
  db.users.push({
    id: crypto.randomUUID(),
    username,
    role,
    status: "active",
    salt,
    passwordHash: hash,
    createdAt: new Date().toISOString()
  });
}

function loadDb() {
  return normalizeDb(loadRuntimeState());
}

function saveDb(db) {
  saveRuntimeState(normalizeDb(db));
}

function loadPapers() {
  return loadPaperState().map((paper) => ({
    ...paper,
    category: paper.category === "csp" ? "cspj" : (paper.category || "gesp")
  }));
}

function savePapers(papers) {
  savePaperState(papers);
}

function attemptFromRow(row) {
  const payload = JSON.parse(row.payloadJson || "{}");
  return {
    ...payload,
    id: row.id,
    userId: row.userId,
    username: row.username,
    type: row.type,
    paperId: row.paperId || payload.paperId,
    paperTitle: row.paperTitle || payload.paperTitle,
    questionId: row.questionId || payload.questionId,
    questionTitle: row.questionTitle || payload.questionTitle,
    classId: row.classId || payload.classId,
    score: row.score ?? payload.score,
    fullScore: row.fullScore ?? payload.fullScore,
    status: row.status || payload.status,
    passed: row.passed ?? payload.passed,
    total: row.total ?? payload.total,
    details: row.detailsJson ? JSON.parse(row.detailsJson) : payload.details,
    createdAt: row.createdAt
  };
}

function attemptPayload(attempt) {
  return {
    id: attempt.id,
    userId: attempt.userId,
    username: attempt.username,
    type: attempt.type || "",
    paperId: attempt.paperId || null,
    paperTitle: attempt.paperTitle || null,
    questionId: attempt.questionId || null,
    questionTitle: attempt.questionTitle || null,
    classId: attempt.classId || null,
    score: attempt.score ?? null,
    fullScore: attempt.fullScore ?? null,
    status: attempt.status || null,
    passed: attempt.passed ?? null,
    total: attempt.total ?? null,
    detailsJson: attempt.details ? JSON.stringify(attempt.details) : null,
    payloadJson: JSON.stringify(attempt),
    createdAt: attempt.createdAt
  };
}

function insertAttempt(attempt) {
  const store = getRuntimeStore();
  store.prepare(`
    INSERT OR REPLACE INTO attempts (
      id, userId, username, type, paperId, paperTitle, questionId, questionTitle,
      classId, score, fullScore, status, passed, total, detailsJson, payloadJson, createdAt
    ) VALUES (
      @id, @userId, @username, @type, @paperId, @paperTitle, @questionId, @questionTitle,
      @classId, @score, @fullScore, @status, @passed, @total, @detailsJson, @payloadJson, @createdAt
    )
  `).run(attemptPayload(attempt));
}

function pruneAttempts() {
  if (MAX_ATTEMPTS <= 0) return;
  getRuntimeStore().prepare(`
    DELETE FROM attempts
    WHERE id NOT IN (
      SELECT id FROM attempts
      ORDER BY datetime(createdAt) DESC, rowid DESC
      LIMIT ?
    )
  `).run(MAX_ATTEMPTS);
}

function loadAttempts(limit = MAX_ATTEMPTS) {
  const safeLimit = Number(limit || MAX_ATTEMPTS);
  if (safeLimit <= 0) return [];
  const rows = getRuntimeStore().prepare(`
    SELECT * FROM attempts
    ORDER BY datetime(createdAt) DESC, rowid DESC
    LIMIT ?
  `).all(safeLimit);
  return rows.map(attemptFromRow);
}

function attemptQuery(filters = {}) {
  const where = [];
  const params = [];
  const hasUserIds = Array.isArray(filters.userIds);
  const hasPaperIds = Array.isArray(filters.paperIds);
  const userIds = hasUserIds ? filters.userIds.filter(Boolean) : [];
  const paperIds = hasPaperIds ? filters.paperIds.filter(Boolean) : [];
  if ((hasUserIds && !userIds.length) || (hasPaperIds && !paperIds.length)) {
    return { whereSql: "WHERE 1 = 0", params: [] };
  }
  if (filters.userId) {
    where.push("userId = ?");
    params.push(filters.userId);
  }
  if (userIds.length) {
    where.push(`userId IN (${userIds.map(() => "?").join(",")})`);
    params.push(...userIds);
  }
  if (filters.paperId) {
    where.push("paperId = ?");
    params.push(filters.paperId);
  }
  if (paperIds.length) {
    where.push(`paperId IN (${paperIds.map(() => "?").join(",")})`);
    params.push(...paperIds);
  }
  return {
    whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params
  };
}

function queryAttempts(filters = {}, limit = MAX_ATTEMPTS) {
  const safeLimit = Number(limit || MAX_ATTEMPTS);
  if (safeLimit <= 0) return [];
  const { whereSql, params } = attemptQuery(filters);
  const rows = getRuntimeStore().prepare(`
    SELECT * FROM attempts
    ${whereSql}
    ORDER BY datetime(createdAt) DESC, rowid DESC
    LIMIT ?
  `).all(...params, safeLimit);
  return rows.map(attemptFromRow);
}

function countAttempts(filters = {}) {
  const { whereSql, params } = attemptQuery(filters);
  return getRuntimeStore().prepare(`SELECT COUNT(*) AS count FROM attempts ${whereSql}`).get(...params).count || 0;
}

function countAttemptsByUser() {
  return new Map(getRuntimeStore().prepare(`
    SELECT userId, COUNT(*) AS count
    FROM attempts
    GROUP BY userId
  `).all().map((row) => [row.userId, row.count]));
}

function migrateAttemptsFromState(attempts) {
  if (!Array.isArray(attempts) || !attempts.length) return;
  const store = getRuntimeStore();
  const transaction = store.transaction((items) => {
    items.forEach((attempt) => {
      if (!attempt?.id || !attempt.userId || !attempt.createdAt) return;
      insertAttempt(attempt);
    });
  });
  transaction(attempts);
  pruneAttempts();
}

function replaceAttempts(attempts) {
  const items = Array.isArray(attempts) ? attempts : [];
  const store = getRuntimeStore();
  const transaction = store.transaction(() => {
    store.prepare("DELETE FROM attempts").run();
    items.forEach((attempt) => {
      if (!attempt?.id || !attempt.userId || !attempt.createdAt) return;
      insertAttempt(attempt);
    });
  });
  transaction();
  pruneAttempts();
}

function backupTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function copyIfExists(source, target) {
  if (!fs.existsSync(source)) return false;
  fs.copyFileSync(source, target);
  return true;
}

function backupDirByName(name) {
  const safeName = String(name || "").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(safeName)) throw new Error("备份名称不正确。");
  const targetDir = path.resolve(BACKUP_DIR, safeName);
  if (!targetDir.startsWith(path.resolve(BACKUP_DIR) + path.sep)) throw new Error("备份名称不正确。");
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) throw new Error("备份不存在。");
  return targetDir;
}

function publicBackupInfo(name) {
  const targetDir = backupDirByName(name);
  const manifest = readJson(path.join(targetDir, "manifest.json"), {});
  const files = fs.readdirSync(targetDir).filter((file) => fs.statSync(path.join(targetDir, file)).isFile());
  return {
    name,
    createdAt: manifest.createdAt || fs.statSync(targetDir).mtime.toISOString(),
    reason: manifest.reason || name.split("-").pop() || "manual",
    files,
    papers: manifest.papers || 0,
    attempts: manifest.attempts || 0
  };
}

function listDataBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => publicBackupInfo(item.name))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function readBackupSqliteValue(sqliteFile, key) {
  if (!fs.existsSync(sqliteFile)) return null;
  const backupDb = new Database(sqliteFile, { readonly: true });
  try {
    const row = backupDb.prepare("SELECT value FROM app_state WHERE key = ?").get(key);
    return row ? JSON.parse(row.value) : null;
  } finally {
    backupDb.close();
  }
}

function readBackupAttempts(sqliteFile) {
  if (!fs.existsSync(sqliteFile)) return null;
  const backupDb = new Database(sqliteFile, { readonly: true });
  try {
    const table = backupDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attempts'").get();
    if (!table) return null;
    return backupDb.prepare("SELECT * FROM attempts ORDER BY datetime(createdAt) DESC, rowid DESC").all().map(attemptFromRow);
  } finally {
    backupDb.close();
  }
}

function readBackupPayload(name) {
  const targetDir = backupDirByName(name);
  const sqliteFile = path.join(targetDir, "runtime.sqlite");
  const dbState = readBackupSqliteValue(sqliteFile, "db") || readJson(path.join(targetDir, "db.json"), null);
  const paperState = readBackupSqliteValue(sqliteFile, "papers") || readJson(path.join(targetDir, "papers.json"), null);
  if (!dbState) throw new Error("备份缺少运行数据。");
  if (!Array.isArray(paperState)) throw new Error("备份缺少试卷数据。");
  const normalizedDb = normalizeDb(dbState);
  const attempts = readBackupAttempts(sqliteFile) || normalizedDb.attempts || [];
  return { db: normalizedDb, papers: paperState, attempts };
}

async function createDataBackup(reason = "scheduled") {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupName = `${backupTimestamp()}-${reason}`;
  const targetDir = path.join(BACKUP_DIR, backupName);
  fs.mkdirSync(targetDir, { recursive: true });

  const papers = loadPapers();
  writeJson(path.join(targetDir, "papers.json"), papers);
  copyIfExists(DB_FILE, path.join(targetDir, "db.json"));

  const sqliteBackup = path.join(targetDir, "runtime.sqlite");
  if (fs.existsSync(SQLITE_FILE)) {
    try {
      await getRuntimeStore().backup(sqliteBackup);
    } catch (error) {
      copyIfExists(SQLITE_FILE, sqliteBackup);
    }
  }

  writeJson(path.join(targetDir, "manifest.json"), {
    createdAt: new Date().toISOString(),
    reason,
    files: fs.readdirSync(targetDir),
    papers: papers.length,
    attempts: loadAttempts().length
  });
  pruneBackups();
  return targetDir;
}

function pruneBackups() {
  if (!fs.existsSync(BACKUP_DIR) || BACKUP_RETENTION <= 0) return;
  const backups = fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .sort();
  backups.slice(0, Math.max(0, backups.length - BACKUP_RETENTION)).forEach((name) => {
    fs.rmSync(path.join(BACKUP_DIR, name), { recursive: true, force: true });
  });
}

let backupInProgress = false;

function scheduleBackups() {
  if (BACKUP_INTERVAL_HOURS <= 0) return;
  const run = async (reason) => {
    if (backupInProgress) return;
    backupInProgress = true;
    try {
      const backupPath = await createDataBackup(reason);
      console.log(`Data backup created: ${backupPath}`);
    } catch (error) {
      console.error("Data backup failed:", error.message);
    } finally {
      backupInProgress = false;
    }
  };
  run("startup");
  setInterval(() => run("scheduled"), BACKUP_INTERVAL_HOURS * 60 * 60 * 1000).unref();
}

function parseCookies(header = "") {
  return header.split(";").reduce((cookies, item) => {
    const [rawKey, ...rawValue] = item.trim().split("=");
    if (!rawKey) return cookies;
    cookies[rawKey] = decodeURIComponent(rawValue.join("="));
    return cookies;
  }, {});
}

function currentUser(req, db) {
  const cookies = parseCookies(req.headers.cookie);
  const session = cookies.sid && db.sessions[cookies.sid];
  if (!session) return null;
  if (isExpired(session.expiresAt)) {
    delete db.sessions[cookies.sid];
    return null;
  }
  const user = db.users.find((item) => item.id === session.userId);
  if (!user || user.status === "disabled") return null;
  return user;
}

function publicUser(user, db = null) {
  if (!user) return null;
  const visible = {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt
  };
  if (user.role === "student" && user.teacherId) {
    const teacher = db?.users?.find((item) => item.id === user.teacherId);
    visible.teacherId = user.teacherId;
    visible.teacherName = teacher?.username || "";
  }
  return visible;
}

function publicSettings(db) {
  return {
    allowRegistration: db.settings?.allowRegistration !== false
  };
}

function dateState(startAt = "", endAt = "", now = new Date()) {
  const startTime = startAt ? new Date(startAt).getTime() : 0;
  const endTime = endAt ? new Date(endAt).getTime() : 0;
  const current = now.getTime();
  if (startTime && current < startTime) return "not_started";
  if (endTime && current > endTime) return "ended";
  return "open";
}

function publicExamType(type) {
  return {
    id: type.id,
    name: type.name,
    levelEnabled: Boolean(type.levelEnabled),
    builtIn: Boolean(type.builtIn)
  };
}

function isTeacher(user) {
  return user && (user.role === "teacher" || user.role === "admin");
}

function isAdmin(user) {
  return user && user.role === "admin";
}

function requireUser(req, res, db) {
  const user = currentUser(req, db);
  if (!user) {
    sendJson(res, 401, { message: "请先登录。" });
    return null;
  }
  return user;
}

function requireTeacher(req, res, db) {
  const user = requireUser(req, res, db);
  if (!user) return null;
  if (!isTeacher(user)) {
    sendJson(res, 403, { message: "需要教师或管理员权限。" });
    return null;
  }
  return user;
}

function requireAdmin(req, res, db) {
  const user = requireUser(req, res, db);
  if (!user) return null;
  if (!isAdmin(user)) {
    sendJson(res, 403, { message: "需要管理员权限。" });
    return null;
  }
  return user;
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    ...headers
  });
  res.end(payload);
}

function sendJson(res, status, body, headers = {}) {
  send(res, status, body, headers);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new Error("请求体过大。"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("JSON 格式不正确。"));
      }
    });
    req.on("error", reject);
  });
}

function readRawBody(req, limit = MAX_UPLOAD) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("上传文件过大。"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(req, body) {
  const boundary = /boundary=([^;]+)/i.exec(req.headers["content-type"] || "")?.[1]?.replace(/^"|"$/g, "");
  if (!boundary) throw new Error("上传格式不正确。");
  const parts = body.toString("binary").split(`--${boundary}`);
  const result = { fields: {}, files: {} };
  parts.forEach((part) => {
    if (!part || part === "--\r\n" || part === "--") return;
    const clean = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const splitIndex = clean.indexOf("\r\n\r\n");
    if (splitIndex < 0) return;
    const rawHeaders = clean.slice(0, splitIndex);
    const rawContent = clean.slice(splitIndex + 4).replace(/\r\n--$/, "");
    const disposition = /content-disposition:\s*form-data;\s*([^\r\n]+)/i.exec(rawHeaders)?.[1] || "";
    const name = /name="([^"]+)"/i.exec(disposition)?.[1];
    if (!name) return;
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1];
    const contentType = /content-type:\s*([^\r\n]+)/i.exec(rawHeaders)?.[1] || "";
    const content = Buffer.from(rawContent, "binary");
    if (filename) result.files[name] = { filename, contentType, content };
    else result.fields[name] = content.toString("utf8").trim();
  });
  return result;
}

function userValidationError(username, password) {
  if (!/^[A-Za-z][A-Za-z0-9_]{3,15}$/.test(username)) return "用户名需字母开头，4-16 位英文、数字或下划线。";
  if (String(password || "").length < 6) return "密码至少 6 位。";
  return "";
}

function normalizeStudentTeacherId(db, teacherId) {
  const id = String(teacherId || "").trim();
  if (!id) return "";
  const teacher = db.users.find((user) => user.id === id && (user.role === "teacher" || user.role === "admin") && user.status !== "disabled");
  return teacher ? teacher.id : "";
}

function createUserRecord(db, username, password, role, teacherId = "") {
  const { salt, hash } = hashPassword(password);
  const newUser = {
    id: crypto.randomUUID(),
    username,
    role,
    status: "active",
    salt,
    passwordHash: hash,
    createdAt: new Date().toISOString()
  };
  if (role === "student") newUser.teacherId = normalizeStudentTeacherId(db, teacherId);
  db.users.push(newUser);
  return newUser;
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function pickColumn(row, candidates) {
  const entries = Object.entries(row);
  const normalized = candidates.map(normalizeHeader);
  const entry = entries.find(([key]) => normalized.includes(normalizeHeader(key)));
  return entry ? String(entry[1] ?? "").trim() : "";
}

function parseUserRowsFromWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel 中没有工作表。");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
  return rows.map((row) => ({
    username: pickColumn(row, ["用户名", "账号", "账户", "username", "user"]),
    password: pickColumn(row, ["密码", "password", "pass"])
  })).filter((row) => row.username || row.password);
}

function publicPaper(paper) {
  return {
    ...paper,
    questions: (paper.questions || []).map(publicQuestion)
  };
}

function publicQuestion(question) {
  const { answer, explanation, tests, ...visible } = question;
  if (Array.isArray(visible.subquestions)) {
    visible.subquestions = visible.subquestions.map(publicQuestion);
  }
  return visible;
}

function isObjectiveQuestion(question) {
  return ["single", "judge", "multi"].includes(question?.type);
}

function objectiveAnswerId(parent, question) {
  return parent ? `${parent.id}__${question.id}` : question.id;
}

function flattenObjectiveQuestions(questions, parent = null) {
  return (questions || []).flatMap((question) => {
    if (isObjectiveQuestion(question)) return [{ ...question, answerId: objectiveAnswerId(parent, question) }];
    if (question.type === "reading" || question.type === "completion") return flattenObjectiveQuestions(question.subquestions || [], question);
    return [];
  });
}

function normalizeAnswerValue(question, value) {
  if (value === undefined || value === null) return undefined;
  if (question.type === "judge") return value === true || value === "true";
  if (question.type === "multi") {
    const values = Array.isArray(value) ? value : [value].filter((item) => item !== undefined);
    return values.map(Number).filter((item) => Number.isInteger(item)).sort((a, b) => a - b);
  }
  return Number(value);
}

function answersEqual(question, userAnswer) {
  if (userAnswer === undefined) return false;
  if (question.type !== "multi") return userAnswer === question.answer;
  const answer = (Array.isArray(question.answer) ? question.answer : []).map(Number).sort((a, b) => a - b);
  return answer.length === userAnswer.length && answer.every((value, index) => value === userAnswer[index]);
}

function findQuestion(papers, paperId, questionId) {
  const paper = papers.find((item) => item.id === paperId);
  if (!paper) return {};
  return { paper, question: (paper.questions || []).find((item) => item.id === questionId) };
}

function normalizeOutput(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trimEnd();
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        child.kill("SIGKILL");
        finished = true;
        resolve({ code: null, stdout, stderr, timeout: true });
      }
    }, options.timeout || 3000);

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (!finished) {
        finished = true;
        resolve({ code: null, stdout, stderr: error.message, error: true });
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!finished) {
        finished = true;
        resolve({ code, stdout, stderr });
      }
    });

    if (options.input) child.stdin.write(options.input);
    child.stdin.end();
  });
}

async function judgeCpp(question, code) {
  if (!code || code.length < 20) {
    return { status: "error", message: "代码太短，请提交完整 C++ 程序。" };
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "gesp-judge-"));
  const source = path.join(workDir, "main.cpp");
  const exe = path.join(workDir, process.platform === "win32" ? "main.exe" : "main");
  fs.writeFileSync(source, code, "utf8");

  try {
    const compilePlans = [
      [source, "-std=c++17", "-O2", "-o", exe],
      [source, "-std=c++14", "-O2", "-o", exe],
      [source, "-std=c++11", "-O2", "-o", exe],
      [source, "-O2", "-o", exe]
    ];
    let compile = null;
    for (const args of compilePlans) {
      compile = await runProcess("g++", args, { cwd: workDir, timeout: 8000 });
      const unsupportedStandard = /unrecognized command line option .-std=c\+\+/.test(compile.stderr || "");
      if (!unsupportedStandard) break;
    }
    if (compile.error) {
      return { status: "error", message: "未找到 g++，请安装 MinGW/g++ 或设置系统 PATH。" };
    }
    if (compile.timeout) return { status: "compile_timeout", message: "编译超时。" };
    if (compile.code !== 0) {
      return { status: "compile_error", message: compile.stderr.slice(0, 2000) || "编译失败。" };
    }

    const tests = [...(question.samples || []), ...(question.tests || [])];
    const results = [];
    for (let index = 0; index < tests.length; index += 1) {
      const test = tests[index];
      const run = await runProcess(exe, [], { cwd: workDir, input: test.input, timeout: 3000 });
      const actual = normalizeOutput(run.stdout);
      const expected = normalizeOutput(test.output);
      const passed = !run.timeout && run.code === 0 && actual === expected;
      results.push({
        index: index + 1,
        sample: index < (question.samples || []).length,
        passed,
        input: test.input,
        expected: test.output,
        actual: run.timeout ? "运行超时" : run.stdout,
        stderr: run.stderr
      });
    }

    const passed = results.every((item) => item.passed);
    return {
      status: passed ? "accepted" : "wrong_answer",
      message: passed ? "全部测试通过。" : "存在未通过的测试点。",
      passed: results.filter((item) => item.passed).length,
      total: results.length,
      results
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function recordAttempt(db, user, attempt) {
  const item = {
    id: crypto.randomUUID(),
    userId: user.id,
    username: user.username,
    createdAt: new Date().toISOString(),
    ...attempt
  };
  insertAttempt(item);
  pruneAttempts();
  db.attempts.unshift(item);
  db.attempts = db.attempts.slice(0, MAX_ATTEMPTS);
  return item;
}

function audit(db, user, action, target) {
  db.auditLogs.unshift({
    id: crypto.randomUUID(),
    userId: user.id,
    username: user.username,
    action,
    target,
    createdAt: new Date().toISOString()
  });
  db.auditLogs = db.auditLogs.slice(0, MAX_AUDIT_LOGS);
}

function validatePaper(input, db) {
  const rawCategory = String(input.category || "gesp").trim();
  const category = rawCategory === "csp" ? "cspj" : rawCategory;
  const examType = db.examTypes.find((item) => item.id === category);
  if (!examType) throw new Error("考试类型不存在。");
  const paper = {
    id: String(input.id || "").trim() || slugify(input.title || "paper"),
    title: String(input.title || "").trim(),
    category,
    level: examType.levelEnabled ? Number(input.level || 1) : null,
    language: String(input.language || "C++").trim(),
    year: Number(input.year || new Date().getFullYear()),
    month: String(input.month || "01").padStart(2, "0"),
    participants: Number(input.participants || 0),
    views: Number(input.views || 0),
    hidden: Boolean(input.hidden),
    summary: String(input.summary || "").trim(),
    questions: Array.isArray(input.questions) ? input.questions : []
  };
  if (!paper.title) throw new Error("试卷标题不能为空。");
  if (examType.levelEnabled && (paper.level < 1 || paper.level > 8)) throw new Error("等级需在 1-8 之间。");
  paper.questions = paper.questions.map((question, index) => normalizeQuestion(question, `${paper.id}-q${index + 1}`));
  return paper;
}

function normalizeQuestion(question, fallbackId) {
  question.id = String(question.id || fallbackId).trim() || fallbackId;
  question.type = ["single", "judge", "multi", "program", "reading", "completion"].includes(question.type) ? question.type : "single";
  question.score = Number(question.score || 0);
  if (question.type === "multi") {
    question.choices = Array.isArray(question.choices) ? question.choices.map(String) : [];
    question.answer = (Array.isArray(question.answer) ? question.answer : []).map(Number).filter((item) => Number.isInteger(item));
  } else if (question.type === "single") {
    question.choices = Array.isArray(question.choices) ? question.choices.map(String) : [];
    question.answer = Number(question.answer || 0);
  } else if (question.type === "judge") {
    question.answer = question.answer === true || question.answer === "true";
  } else if (question.type === "reading" || question.type === "completion") {
    question.title = String(question.title || "").trim();
    question.statement = String(question.statement || "");
    question.code = String(question.code || "");
    question.subquestions = (Array.isArray(question.subquestions) ? question.subquestions : []).map((subquestion, index) => normalizeQuestion(subquestion, `${question.id}-s${index + 1}`));
    question.score = question.subquestions.reduce((sum, subquestion) => sum + Number(subquestion.score || 0), 0);
  } else if (question.type === "program") {
    question.title = String(question.title || "").trim();
    question.statement = String(question.statement || "");
    question.input = String(question.input || "");
    question.output = String(question.output || "");
    question.samples = Array.isArray(question.samples) ? question.samples : [];
    question.tests = Array.isArray(question.tests) ? question.tests : [];
  }
  if (isObjectiveQuestion(question)) {
    question.stem = String(question.stem || "");
    question.explanation = String(question.explanation || "");
  }
  return question;
}

function updatePaperVisibility(req, res, db, papers, user, id, hidden) {
  const paper = papers.find((item) => item.id === id);
  if (!paper) return sendJson(res, 404, { message: "试卷不存在。" });
  if (!canManagePaper(user, paper)) return sendJson(res, 403, { message: "只能管理自己创建的试卷。" });
  db.paperVisibility ||= {};
  db.paperVisibility[id] = Boolean(hidden);
  audit(db, user, db.paperVisibility[id] ? "paper:hide" : "paper:show", id);
  saveDb(db);
  return sendJson(res, 200, { paper: paperWithVisibility(db, paper, user) });
}

function updatePapersVisibility(req, res, db, papers, user, ids, hidden) {
  const uniqueIds = Array.from(new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean)));
  if (!uniqueIds.length) return sendJson(res, 400, { message: "请先选择试卷。" });
  const paperMap = new Map(papers.map((paper) => [paper.id, paper]));
  const missing = uniqueIds.filter((id) => !paperMap.has(id));
  if (missing.length) return sendJson(res, 404, { message: `试卷不存在：${missing.join("、")}` });
  const forbidden = uniqueIds.filter((id) => !canManagePaper(user, paperMap.get(id)));
  if (forbidden.length) return sendJson(res, 403, { message: "只能管理自己创建的试卷。" });
  db.paperVisibility ||= {};
  uniqueIds.forEach((id) => {
    db.paperVisibility[id] = Boolean(hidden);
    audit(db, user, db.paperVisibility[id] ? "paper:hide" : "paper:show", id);
  });
  saveDb(db);
  return sendJson(res, 200, {
    count: uniqueIds.length,
    papers: uniqueIds.map((id) => paperWithVisibility(db, paperMap.get(id), user))
  });
}

const questionTypeLabels = {
  single: "单选题",
  multi: "多选题",
  judge: "判断题",
  reading: "阅读程序题",
  completion: "完善程序题",
  program: "编程题"
};

const labelQuestionTypes = Object.fromEntries(Object.entries(questionTypeLabels).map(([key, value]) => [value, key]));

function paperExportRows(paper) {
  const rows = [
    ["试卷ID", paper.id],
    ["标题", paper.title],
    ["考试类型", paper.category || "gesp"],
    ["等级", paper.level ?? ""],
    ["语言", paper.language || "C++"],
    ["年份", paper.year || ""],
    ["月份", paper.month || ""],
    ["说明", paper.summary || ""]
  ];
  const children = [
    new Paragraph({ text: "试卷信息", heading: HeadingLevel.HEADING_1 }),
    ...rows.map(([label, value]) => new Paragraph({ children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(String(value ?? ""))] })),
    new Paragraph({ text: "题目列表", heading: HeadingLevel.HEADING_1 })
  ];
  (paper.questions || []).forEach((question, index) => {
    children.push(...questionToWordParagraphs(question, index + 1));
  });
  return children;
}

function addLabelParagraph(items, label, value = "") {
  items.push(new Paragraph({ children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(String(value ?? ""))] }));
}

function addTextBlock(items, label, value = "") {
  items.push(new Paragraph({ children: [new TextRun({ text: `${label}:`, bold: true })] }));
  String(value || "").split(/\r?\n/).forEach((line) => items.push(new Paragraph(line || " ")));
}

function questionToWordParagraphs(question, number, prefix = "题目") {
  const items = [
    new Paragraph({ text: `--- ${prefix} ${number} ---`, heading: prefix === "子题" ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_2 })
  ];
  addLabelParagraph(items, "题型", questionTypeLabels[question.type] || question.type || "单选题");
  addLabelParagraph(items, "题目ID", question.id || "");
  addLabelParagraph(items, "分值", question.score ?? 0);
  if (question.type === "reading" || question.type === "completion") {
    addLabelParagraph(items, "标题", question.title || "");
    addTextBlock(items, "题面", question.statement || "");
    addTextBlock(items, "程序代码", question.code || "");
    (question.subquestions || []).forEach((subquestion, index) => {
      items.push(...questionToWordParagraphs(subquestion, index + 1, "子题"));
    });
    return items;
  }
  if (question.type === "program") {
    addLabelParagraph(items, "标题", question.title || "");
    addTextBlock(items, "题面", question.statement || "");
    addTextBlock(items, "输入格式", question.input || "");
    addTextBlock(items, "输出格式", question.output || "");
    addTextBlock(items, "样例", formatWordCases(question.samples || []));
    addTextBlock(items, "隐藏测试点", formatWordCases(question.tests || []));
    return items;
  }
  addTextBlock(items, "题干", question.stem || "");
  if (question.type === "single" || question.type === "multi") {
    items.push(new Paragraph({ children: [new TextRun({ text: "选项:", bold: true })] }));
    (question.choices || []).forEach((choice, index) => items.push(new Paragraph(`${String.fromCharCode(65 + index)}. ${choice}`)));
  }
  addLabelParagraph(items, "答案", formatWordAnswer(question));
  addTextBlock(items, "解析", question.explanation || "");
  return items;
}

function formatWordAnswer(question) {
  if (question.type === "judge") return question.answer ? "正确" : "错误";
  if (question.type === "multi") return (question.answer || []).map((index) => String.fromCharCode(65 + Number(index))).join(", ");
  if (question.type === "single") return String.fromCharCode(65 + Number(question.answer || 0));
  return "";
}

function formatWordCases(cases) {
  return (cases || []).map((item, index) => `样例${index + 1}\n输入:\n${item.input || ""}\n输出:\n${item.output || ""}`).join("\n---\n");
}

async function buildPapersDocxBuffer(papers) {
  const children = [
    new Paragraph({ text: "CSP Practice 试卷导出", heading: HeadingLevel.TITLE }),
    new Paragraph("说明：可在 Word 中编辑后重新导入。请尽量保留“试卷ID:”“题型:”“题干:”等标签。")
  ];
  papers.forEach((paper, index) => {
    if (index > 0) children.push(new Paragraph({ text: "=== 下一套试卷 ===", heading: HeadingLevel.HEADING_1 }));
    children.push(...paperExportRows(paper));
  });
  const doc = new Document({ sections: [{ properties: {}, children }] });
  return Packer.toBuffer(doc);
}

function parseWordAnswer(type, value) {
  const text = String(value || "").trim();
  if (type === "judge") return /^(正确|对|true|yes|1)$/i.test(text);
  const letters = text.split(/[,，、\s]+/).map((item) => item.trim()).filter(Boolean);
  const indexes = letters.map((item) => {
    if (/^\d+$/.test(item)) return Number(item) - 1;
    return item.toUpperCase().charCodeAt(0) - 65;
  }).filter((item) => Number.isInteger(item) && item >= 0);
  return type === "multi" ? indexes : (indexes[0] ?? 0);
}

function readTaggedBlock(lines, startIndex, stopLabels) {
  const values = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index];
    if (/^---\s*(题目|子题)\s+\d+\s*---$/.test(line) || /^===\s*下一套试卷\s*===$/.test(line) || stopLabels.some((label) => line.startsWith(`${label}:`))) break;
    values.push(line);
    index += 1;
  }
  return { value: values.join("\n").trim(), nextIndex: index };
}

function lineValue(line, label) {
  return line.startsWith(`${label}:`) ? line.slice(label.length + 1).trim() : "";
}

function parseWordPapersText(text, db) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((line) => line.trim()).filter((line) => line.length);
  const papers = [];
  let current = null;
  const topLabels = ["试卷ID", "标题", "考试类型", "等级", "语言", "年份", "月份", "说明"];
  const questionLabels = ["题型", "题目ID", "分值", "标题", "题干", "选项", "答案", "解析", "题面", "程序代码", "输入格式", "输出格式", "样例", "隐藏测试点"];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith("试卷ID:")) {
      if (current) papers.push(current);
      current = { id: lineValue(line, "试卷ID"), questions: [] };
      continue;
    }
    if (!current) continue;
    const topLabel = topLabels.find((label) => line.startsWith(`${label}:`));
    if (topLabel) {
      const keyMap = { 标题: "title", 考试类型: "category", 等级: "level", 语言: "language", 年份: "year", 月份: "month", 说明: "summary" };
      if (keyMap[topLabel]) current[keyMap[topLabel]] = lineValue(line, topLabel);
      continue;
    }
    if (/^---\s*题目\s+\d+\s*---$/.test(line)) {
      const parsed = parseWordQuestion(lines, i + 1, false, questionLabels);
      current.questions.push(parsed.question);
      i = parsed.nextIndex - 1;
    }
  }
  if (current) papers.push(current);
  return papers.map((paper) => validatePaper(paper, db));
}

function parseWordQuestion(lines, startIndex, subquestion, questionLabels) {
  const question = {};
  let i = startIndex;
  while (i < lines.length) {
    const line = lines[i];
    if (/^---\s*题目\s+\d+\s*---$/.test(line) || /^===\s*下一套试卷\s*===$/.test(line)) break;
    if (subquestion && /^---\s*子题\s+\d+\s*---$/.test(line)) break;
    if (line.startsWith("题型:")) question.type = labelQuestionTypes[lineValue(line, "题型")] || lineValue(line, "题型") || "single";
    else if (line.startsWith("题目ID:")) question.id = lineValue(line, "题目ID");
    else if (line.startsWith("分值:")) question.score = Number(lineValue(line, "分值") || 0);
    else if (line.startsWith("标题:")) question.title = lineValue(line, "标题");
    else if (line.startsWith("题干:")) {
      const block = readTaggedBlock(lines, i + 1, questionLabels);
      question.stem = block.value;
      i = block.nextIndex - 1;
    } else if (line.startsWith("题面:")) {
      const block = readTaggedBlock(lines, i + 1, questionLabels);
      question.statement = block.value;
      i = block.nextIndex - 1;
    } else if (line.startsWith("程序代码:")) {
      const block = readTaggedBlock(lines, i + 1, questionLabels);
      question.code = block.value;
      i = block.nextIndex - 1;
    } else if (line.startsWith("输入格式:")) {
      const block = readTaggedBlock(lines, i + 1, questionLabels);
      question.input = block.value;
      i = block.nextIndex - 1;
    } else if (line.startsWith("输出格式:")) {
      const block = readTaggedBlock(lines, i + 1, questionLabels);
      question.output = block.value;
      i = block.nextIndex - 1;
    } else if (line.startsWith("解析:")) {
      const block = readTaggedBlock(lines, i + 1, questionLabels);
      question.explanation = block.value;
      i = block.nextIndex - 1;
    } else if (line.startsWith("选项:")) {
      const choices = [];
      i += 1;
      while (i < lines.length && /^[A-Z]\.\s*/.test(lines[i])) {
        choices.push(lines[i].replace(/^[A-Z]\.\s*/, ""));
        i += 1;
      }
      question.choices = choices;
      i -= 1;
    } else if (line.startsWith("答案:")) {
      question.answer = parseWordAnswer(question.type || "single", lineValue(line, "答案"));
    } else if (/^---\s*子题\s+\d+\s*---$/.test(line)) {
      question.subquestions ||= [];
      const parsed = parseWordQuestion(lines, i + 1, true, questionLabels);
      question.subquestions.push(parsed.question);
      i = parsed.nextIndex - 1;
    }
    i += 1;
  }
  question.type ||= "single";
  return { question, nextIndex: i };
}

function isPaperHidden(db, paper) {
  if (!paper) return false;
  if (Object.prototype.hasOwnProperty.call(db.paperVisibility || {}, paper.id)) {
    return Boolean(db.paperVisibility[paper.id]);
  }
  return Boolean(paper.hidden);
}

function paperWithVisibility(db, paper, viewer = null) {
  const payload = { ...paper, hidden: isPaperHidden(db, paper) };
  if (viewer && (isAdmin(viewer) || viewer.role === "teacher")) {
    payload.canManage = canManagePaper(viewer, paper);
  }
  return payload;
}

function paperOwnerId(paper) {
  return String(paper?.createdBy || paper?.updatedBy || "");
}

function canManagePaper(user, paper) {
  if (!user || !paper) return false;
  if (isAdmin(user)) return true;
  return paperOwnerId(paper) === user.id;
}

function slugify(value) {
  const ascii = String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return ascii || `paper-${crypto.randomBytes(4).toString("hex")}`;
}

function canAccessClass(user, klass, db) {
  if (isAdmin(user)) return true;
  if (klass.teacherId === user.id) return true;
  return db.enrollments.some((item) => item.classId === klass.id && item.userId === user.id);
}

function canManageClass(user, klass) {
  return Boolean(klass && (isAdmin(user) || klass.teacherId === user.id));
}

function classPayload(klass, db, viewer = null) {
  const teacher = db.users.find((user) => user.id === klass.teacherId);
  const studentCount = db.enrollments.filter((item) => item.classId === klass.id).length;
  const assignmentCount = db.assignments.filter((item) => item.classId === klass.id).length;
  const examType = db.examTypes.find((item) => item.id === klass.category);
  const { inviteCode, ...visible } = klass;
  return {
    ...visible,
    ...(viewer && canManageClass(viewer, klass) ? { inviteCode } : {}),
    categoryName: examType?.name || klass.category || "GESP",
    teacherName: teacher?.username || "unknown",
    studentCount,
    assignmentCount
  };
}

function classReportPayload(klass, db, papers, viewer = null) {
  const enrollments = db.enrollments.filter((item) => item.classId === klass.id);
  const students = enrollments
    .map((item) => db.users.find((user) => user.id === item.userId))
    .filter(Boolean);
  const assignments = db.assignments.filter((item) => item.classId === klass.id);
  const assignmentPaperIds = new Set(assignments.map((item) => item.paperId));
  const studentIds = new Set(students.map((item) => item.id));
  const attempts = queryAttempts({
    userIds: Array.from(studentIds),
    paperIds: assignmentPaperIds.size ? Array.from(assignmentPaperIds) : null
  }, 100);
  const studentRows = students.map((student) => {
    const studentAttempts = attempts.filter((item) => item.userId === student.id);
    const bestObjective = studentAttempts
      .filter((item) => item.type === "objective")
      .sort((a, b) => ((b.score || 0) / (b.fullScore || 1)) - ((a.score || 0) / (a.fullScore || 1)))[0];
    return {
      ...publicUser(student, db),
      joinedAt: enrollments.find((item) => item.userId === student.id)?.createdAt || "",
      attemptCount: studentAttempts.length,
      bestObjective: bestObjective ? {
        paperTitle: bestObjective.paperTitle,
        score: bestObjective.score,
        fullScore: bestObjective.fullScore,
        createdAt: bestObjective.createdAt
      } : null,
      acceptedPrograms: studentAttempts.filter((item) => item.type === "program" && item.status === "accepted").length
    };
  });
  return {
    class: classPayload(klass, db, viewer),
    assignments: assignments.map((assignment) => ({
      ...assignment,
      paperTitle: papers.find((paper) => paper.id === assignment.paperId)?.title || assignment.title
    })),
    students: studentRows,
    recentAttempts: attempts.slice(0, 30)
  };
}

function buildStudentSummary(user, db, papers) {
  const attempts = queryAttempts({ userId: user.id });
  const classIds = new Set(db.enrollments.filter((item) => item.userId === user.id).map((item) => item.classId));
  const assignments = db.assignments
    .filter((item) => classIds.has(item.classId))
    .map((assignment) => {
      const paper = papers.find((item) => item.id === assignment.paperId);
      if (isPaperHidden(db, paper)) return null;
      const related = attempts.filter((item) => item.paperId === assignment.paperId);
      const objective = related
        .filter((item) => item.type === "objective")
        .sort((a, b) => (b.score || 0) - (a.score || 0))[0];
      const programs = related.filter((item) => item.type === "program" && item.status === "accepted");
      const programTotal = PROGRAM_SUBMISSION_ENABLED ? (paper?.questions || []).filter((item) => item.type === "program").length : 0;
      const objectiveDone = Boolean(objective);
      const programDone = programTotal === 0 || programs.length >= programTotal;
      const status = dateState(assignment.startAt, assignment.endAt);
      return {
        ...assignment,
        paperTitle: paper?.title || assignment.title,
        className: db.classes.find((item) => item.id === assignment.classId)?.name || "",
        done: objectiveDone && programDone,
        bestObjective: objective ? { score: objective.score, fullScore: objective.fullScore } : null,
        acceptedPrograms: programs.length,
        programTotal,
        status
      };
    })
    .filter(Boolean);

  const wrongMap = new Map();
  attempts
    .filter((item) => item.type === "objective")
    .forEach((attempt) => {
      const paper = papers.find((item) => item.id === attempt.paperId);
      (attempt.details || []).forEach((detail) => {
        if (detail.correct) return;
        const question = flattenObjectiveQuestions(paper?.questions || []).find((item) => item.answerId === detail.id);
        if (!question) return;
        wrongMap.set(`${attempt.paperId}:${detail.id}`, {
          id: detail.id,
          paperId: attempt.paperId,
          paperTitle: attempt.paperTitle,
          type: question.type,
          stem: question.stem,
          choices: question.choices || [],
          answer: detail.answer,
          userAnswer: detail.userAnswer,
          explanation: detail.explanation,
          lastWrongAt: attempt.createdAt
        });
      });
    });

  const progress = Array.from({ length: 8 }, (_, index) => {
    const level = index + 1;
    const levelPapers = papers.filter((paper) => !isPaperHidden(db, paper) && (paper.category || "gesp") === "gesp" && Number(paper.level) === level);
    const practiced = new Set(attempts.map((attempt) => attempt.paperId));
    return {
      level,
      total: levelPapers.length,
      practiced: levelPapers.filter((paper) => practiced.has(paper.id)).length
    };
  });

  return {
    totals: {
      attempts: attempts.length,
      assignments: assignments.length,
      pendingAssignments: assignments.filter((item) => !item.done).length,
      wrongQuestions: wrongMap.size
    },
    assignments,
    wrongQuestions: Array.from(wrongMap.values()).sort((a, b) => b.lastWrongAt.localeCompare(a.lastWrongAt)),
    progress
  };
}

async function api(req, res) {
  const db = loadDb();
  const papers = loadPapers();
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "csppractice",
      time: new Date().toISOString(),
      papers: papers.length,
      maxAttempts: MAX_ATTEMPTS,
      backupRetention: BACKUP_RETENTION,
      programSubmissionEnabled: PROGRAM_SUBMISSION_ENABLED,
      settings: publicSettings(db)
    });
  }

  if (req.method === "GET" && url.pathname === "/api/papers") {
    return sendJson(res, 200, { papers: papers.filter((paper) => !isPaperHidden(db, paper)).map(publicPaper) });
  }

  if (req.method === "GET" && url.pathname === "/api/exam-types") {
    return sendJson(res, 200, { examTypes: db.examTypes.map(publicExamType) });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/settings") {
    const user = requireAdmin(req, res, db);
    if (!user) return;
    const body = await readBody(req);
    db.settings.allowRegistration = body.allowRegistration !== false;
    audit(db, user, "settings:update", "allowRegistration");
    saveDb(db);
    return sendJson(res, 200, { settings: publicSettings(db) });
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    const user = currentUser(req, db);
    const attempts = user ? queryAttempts({ userId: user.id }, 80) : [];
    const classes = user ? db.classes.filter((klass) => canAccessClass(user, klass, db)).map((klass) => classPayload(klass, db, user)) : [];
    return sendJson(res, 200, {
      user: publicUser(user),
      attempts,
      classes
    });
  }

  if (req.method === "GET" && url.pathname === "/api/student/summary") {
    const user = requireUser(req, res, db);
    if (!user) return;
    return sendJson(res, 200, buildStudentSummary(user, db, papers));
  }

  if (req.method === "POST" && url.pathname === "/api/register") {
    if (db.settings?.allowRegistration === false) {
      return sendJson(res, 403, { message: "当前已关闭公开注册，请联系管理员创建账号。" });
    }
    const body = await readBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!/^[A-Za-z][A-Za-z0-9_]{3,15}$/.test(username)) {
      return sendJson(res, 400, { message: "用户名需字母开头，4-16 位英文、数字或下划线。" });
    }
    if (password.length < 6) return sendJson(res, 400, { message: "密码至少 6 位。" });
    if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      return sendJson(res, 409, { message: "用户名已存在。" });
    }
    const { salt, hash } = hashPassword(password);
    const user = {
      id: crypto.randomUUID(),
      username,
      role: "student",
      status: "active",
      salt,
      passwordHash: hash,
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    const sid = createSession(db, user);
    saveDb(db);
    return sendJson(res, 201, { user: publicUser(user) }, {
      "Set-Cookie": sessionCookie(req, sid)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (isLoginLimited(req, username)) {
      return sendJson(res, 429, { message: "登录失败次数过多，请稍后再试。" });
    }
    const user = db.users.find((item) => item.username.toLowerCase() === username.toLowerCase());
    if (!user || user.status === "disabled" || !verifyPassword(password, user)) {
      recordLoginFailure(req, username);
      return sendJson(res, 401, { message: "账号或密码不正确。" });
    }
    clearLoginFailures(req, username);
    const sid = createSession(db, user);
    saveDb(db);
    return sendJson(res, 200, { user: publicUser(user) }, {
      "Set-Cookie": sessionCookie(req, sid)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.sid) delete db.sessions[cookies.sid];
    saveDb(db);
    return sendJson(res, 200, { ok: true }, {
      "Set-Cookie": clearSessionCookie(req)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/me/password") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const body = await readBody(req);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (!verifyPassword(currentPassword, user)) return sendJson(res, 400, { message: "当前密码不正确。" });
    if (newPassword.length < 6) return sendJson(res, 400, { message: "新密码至少 6 位。" });
    const { salt, hash } = hashPassword(newPassword);
    user.salt = salt;
    user.passwordHash = hash;
    audit(db, user, "user:password", user.id);
    saveDb(db);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/submit-objective") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const body = await readBody(req);
    const paper = papers.find((item) => item.id === body.paperId);
    if (!paper) return sendJson(res, 404, { message: "试卷不存在。" });
    const enrolledClassIds = new Set(db.enrollments.filter((item) => item.userId === user.id).map((item) => item.classId));
    const userAssignments = db.assignments.filter((assignment) => assignment.paperId === paper.id && enrolledClassIds.has(assignment.classId));
    const hasOpenAssignment = userAssignments.some((assignment) => dateState(assignment.startAt, assignment.endAt) === "open");
    const hasPreviousAttempt = countAttempts({ userId: user.id, paperId: paper.id }) > 0;
    if (!isTeacher(user) && userAssignments.length && !hasOpenAssignment && !hasPreviousAttempt) {
      return sendJson(res, 403, { message: "这份作业当前不在可提交时间内。" });
    }
    if (isPaperHidden(db, paper) && !isTeacher(user)) return sendJson(res, 404, { message: "试卷不存在。" });
    const answers = body.answers || {};
    const objectiveQuestions = flattenObjectiveQuestions(paper.questions || []);
    let score = 0;
    const details = objectiveQuestions.map((question) => {
      const raw = answers[question.answerId];
      const userAnswer = normalizeAnswerValue(question, raw);
      const correct = answersEqual(question, userAnswer);
      if (correct) score += question.score;
      return {
        id: question.answerId,
        correct,
        userAnswer,
        answer: question.answer,
        score: correct ? question.score : 0,
        fullScore: question.score,
        explanation: question.explanation
      };
    });
    const fullScore = objectiveQuestions.reduce((sum, question) => sum + question.score, 0);
    const attempt = recordAttempt(db, user, {
      type: "objective",
      paperId: paper.id,
      paperTitle: paper.title,
      score,
      fullScore,
      details
    });
    return sendJson(res, 200, { score, fullScore, details, attempt });
  }

  if (req.method === "POST" && url.pathname === "/api/submit-code") {
    if (!PROGRAM_SUBMISSION_ENABLED) {
      return sendJson(res, 503, { message: "编程题提交暂时关闭，待运行沙箱配置完成后再开放。" });
    }
    const user = requireUser(req, res, db);
    if (!user) return;
    const body = await readBody(req);
    const { paper, question } = findQuestion(papers, body.paperId, body.questionId);
    const enrolledClassIds = new Set(db.enrollments.filter((item) => item.userId === user.id).map((item) => item.classId));
    const userAssignments = paper ? db.assignments.filter((assignment) => assignment.paperId === paper.id && enrolledClassIds.has(assignment.classId)) : [];
    const hasOpenAssignment = userAssignments.some((assignment) => dateState(assignment.startAt, assignment.endAt) === "open");
    const hasPreviousAttempt = paper ? countAttempts({ userId: user.id, paperId: paper.id }) > 0 : false;
    if (!isTeacher(user) && userAssignments.length && !hasOpenAssignment && !hasPreviousAttempt) {
      return sendJson(res, 403, { message: "这份作业当前不在可提交时间内。" });
    }
    if (isPaperHidden(db, paper) && !isTeacher(user)) return sendJson(res, 404, { message: "试卷不存在。" });
    if (!paper || !question || question.type !== "program") {
      return sendJson(res, 404, { message: "编程题不存在。" });
    }
    const result = await judgeCpp(question, String(body.code || ""));
    const attempt = recordAttempt(db, user, {
      type: "program",
      paperId: paper.id,
      paperTitle: paper.title,
      questionId: question.id,
      questionTitle: question.title,
      status: result.status,
      passed: result.passed || 0,
      total: result.total || 0
    });
    return sendJson(res, 200, { result, attempt });
  }

  if (req.method === "GET" && url.pathname === "/api/teacher/overview") {
    const user = requireTeacher(req, res, db);
    if (!user) return;
    const teacherClasses = db.classes.filter((klass) => isAdmin(user) || klass.teacherId === user.id);
    const classIds = new Set(teacherClasses.map((klass) => klass.id));
    const studentIds = new Set(db.enrollments.filter((item) => classIds.has(item.classId)).map((item) => item.userId));
    const studentIdList = Array.from(studentIds);
    return sendJson(res, 200, {
      totals: {
        papers: papers.length,
        classes: teacherClasses.length,
        students: studentIds.size,
        attempts: countAttempts({ userIds: studentIdList })
      },
      classes: teacherClasses.map((klass) => classPayload(klass, db, user)),
      recentAttempts: queryAttempts({ userIds: studentIdList }, 20),
      assignments: db.assignments.filter((item) => classIds.has(item.classId)).slice(0, 30)
    });
  }

  if (req.method === "GET" && url.pathname === "/api/teacher/students") {
    const user = requireTeacher(req, res, db);
    if (!user) return;
    const students = db.users
      .filter((item) => item.role === "student" && item.status !== "disabled")
      .filter((item) => isAdmin(user) || item.teacherId === user.id)
      .map((item) => ({
        ...publicUser(item, db),
        enrolledClassIds: db.enrollments.filter((enrollment) => enrollment.userId === item.id).map((enrollment) => enrollment.classId)
      }));
    return sendJson(res, 200, { students });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/papers") {
    const user = requireTeacher(req, res, db);
    if (!user) return;
    return sendJson(res, 200, { papers: papers.map((paper) => paperWithVisibility(db, paper, user)) });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/backup") {
    const user = requireAdmin(req, res, db);
    if (!user) return;
    if (backupInProgress) return sendJson(res, 409, { message: "数据维护正在进行中，请稍后再试。" });
    backupInProgress = true;
    try {
      const targetDir = await createDataBackup("manual");
      const manifest = readJson(path.join(targetDir, "manifest.json"), {});
      audit(db, user, "backup:create", path.basename(targetDir));
      saveDb(db);
      return sendJson(res, 200, {
        backup: {
          name: path.basename(targetDir),
          path: targetDir,
          files: manifest.files || [],
          papers: manifest.papers || 0,
          createdAt: manifest.createdAt || new Date().toISOString()
        }
      });
    } finally {
      backupInProgress = false;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/admin/backups") {
    const user = requireAdmin(req, res, db);
    if (!user) return;
    return sendJson(res, 200, { backups: listDataBackups() });
  }

  const backupRestore = url.pathname.match(/^\/api\/admin\/backups\/([^/]+)\/restore$/);
  if (req.method === "POST" && backupRestore) {
    const user = requireAdmin(req, res, db);
    if (!user) return;
    if (backupInProgress) return sendJson(res, 409, { message: "数据维护正在进行中，请稍后再试。" });
    const name = decodeURIComponent(backupRestore[1]);
    const payload = readBackupPayload(name);
    backupInProgress = true;
    try {
      const safetyDir = await createDataBackup("pre-restore");
      const restoredDb = normalizeDb(payload.db);
      const cookies = parseCookies(req.headers.cookie);
      const restoredUser = restoredDb.users.find((item) => item.id === user.id) || restoredDb.users.find((item) => item.username === user.username && item.role === "admin");
      if (cookies.sid && restoredUser) {
        const now = new Date();
        restoredDb.sessions[cookies.sid] = {
          userId: restoredUser.id,
          createdAt: now.toISOString(),
          lastSeenAt: now.toISOString(),
          expiresAt: sessionExpiresAt(now)
        };
      }
      audit(restoredDb, user, "backup:restore", name);
      saveDb(restoredDb);
      writeJson(DB_FILE, restoredDb);
      savePapers(payload.papers);
      replaceAttempts(payload.attempts);
      return sendJson(res, 200, {
        restored: {
          name,
          papers: payload.papers.length,
          attempts: payload.attempts.length,
          safetyBackup: path.basename(safetyDir)
        }
      });
    } finally {
      backupInProgress = false;
    }
  }

  if (req.method === "POST" && url.pathname === "/api/admin/papers/export-word") {
    const user = requireTeacher(req, res, db);
    if (!user) return;
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id || "")) : [];
    const paperMap = new Map(papers.map((paper) => [paper.id, paper]));
    const selected = ids.length ? ids.map((id) => paperMap.get(id)).filter(Boolean) : papers;
    const missing = ids.filter((id) => !paperMap.has(id));
    if (missing.length) return sendJson(res, 404, { message: `试卷不存在：${missing.join("、")}` });
    if (!selected.length) return sendJson(res, 400, { message: "请先选择要导出的试卷。" });
    const buffer = await buildPapersDocxBuffer(selected);
    const filename = encodeURIComponent(`试卷导出-${new Date().toISOString().slice(0, 10)}.docx`);
    audit(db, user, "paper:export-word", selected.map((paper) => paper.id).join(","));
    saveDb(db);
    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      "Content-Length": buffer.length
    });
    res.end(buffer);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/papers/import-word") {
    const user = requireTeacher(req, res, db);
    if (!user) return;
    const upload = parseMultipart(req, await readRawBody(req));
    const file = upload.files.file;
    if (!file?.content?.length) return sendJson(res, 400, { message: "请上传 Word .docx 文件。" });
    const extracted = await mammoth.extractRawText({ buffer: file.content });
    const imported = parseWordPapersText(extracted.value, db);
    if (!imported.length) return sendJson(res, 400, { message: "没有从 Word 中识别到试卷，请使用系统导出的 Word 模板格式。" });
    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;
    const forbidden = imported
      .map((paper) => papers.find((item) => item.id === paper.id))
      .filter((paper) => paper && !canManagePaper(user, paper));
    if (forbidden.length) return sendJson(res, 403, { message: `只能更新自己创建的试卷：${forbidden.map((paper) => paper.title || paper.id).join("、")}` });
    imported.forEach((paper) => {
      const index = papers.findIndex((item) => item.id === paper.id);
      if (index >= 0) {
        papers[index] = { ...papers[index], ...paper, updatedBy: user.id, updatedAt: now };
        updated += 1;
        audit(db, user, "paper:import-update", paper.id);
      } else {
        papers.unshift({ ...paper, createdBy: user.id, createdAt: now, updatedBy: user.id, updatedAt: now });
        created += 1;
        audit(db, user, "paper:import-create", paper.id);
      }
    });
    savePapers(papers);
    saveDb(db);
    const importedIds = new Set(imported.map((paper) => paper.id));
    return sendJson(res, 200, { total: imported.length, created, updated, papers: papers.filter((paper) => importedIds.has(paper.id)).map((paper) => paperWithVisibility(db, paper, user)) });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/papers") {
    const user = requireTeacher(req, res, db);
    if (!user) return;
    const body = await readBody(req);
    const paper = validatePaper(body.paper || body, db);
    const index = papers.findIndex((item) => item.id === paper.id);
    const now = new Date().toISOString();
    if (index >= 0) {
      if (!canManagePaper(user, papers[index])) return sendJson(res, 403, { message: "只能编辑自己创建的试卷。" });
      papers[index] = { ...papers[index], ...paper, updatedBy: user.id, updatedAt: now };
      audit(db, user, "paper:update", paper.id);
    } else {
      papers.unshift({ ...paper, createdBy: user.id, createdAt: now, updatedBy: user.id, updatedAt: now });
      audit(db, user, "paper:create", paper.id);
    }
    savePapers(papers);
    saveDb(db);
    return sendJson(res, 200, { paper });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/papers/visibility") {
    const user = requireTeacher(req, res, db);
    if (!user) return;
    const body = await readBody(req);
    if (Array.isArray(body.ids)) return updatePapersVisibility(req, res, db, papers, user, body.ids, body.hidden);
    return updatePaperVisibility(req, res, db, papers, user, String(body.id || ""), body.hidden);
  }

  const paperVisibility = url.pathname.match(/^\/api\/admin\/papers\/([^/]+)\/visibility$/);
  if (req.method === "POST" && paperVisibility) {
    const user = requireTeacher(req, res, db);
    if (!user) return;
    const id = decodeURIComponent(paperVisibility[1]);
    const body = await readBody(req);
    return updatePaperVisibility(req, res, db, papers, user, id, body.hidden);
  }

  if (req.method === "POST" && url.pathname === "/api/admin/exam-types") {
    const user = requireAdmin(req, res, db);
    if (!user) return;
    const body = await readBody(req);
    const id = String(body.id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const name = String(body.name || "").trim();
    if (!/^[a-z][a-z0-9_-]{1,20}$/.test(id)) {
      return sendJson(res, 400, { message: "考试类型 ID 需字母开头，2-21 位英文、数字、下划线或短横线。" });
    }
    if (id === "csp") return sendJson(res, 400, { message: "CSP-J/S 组合类型已停用，请分别使用 cspj 或 csps。" });
    if (!name) return sendJson(res, 400, { message: "考试类型名称不能为空。" });
    const existing = db.examTypes.find((item) => item.id === id);
    const examType = {
      id,
      name,
      levelEnabled: existing?.builtIn ? Boolean(existing.levelEnabled) : Boolean(body.levelEnabled),
      builtIn: existing?.builtIn || false
    };
    if (existing) Object.assign(existing, examType);
    else db.examTypes.push(examType);
    audit(db, user, existing ? "exam-type:update" : "exam-type:create", id);
    saveDb(db);
    return sendJson(res, 200, { examType: publicExamType(examType) });
  }

  const examTypeDelete = url.pathname.match(/^\/api\/admin\/exam-types\/([^/]+)$/);
  if (req.method === "DELETE" && examTypeDelete) {
    const user = requireAdmin(req, res, db);
    if (!user) return;
    const id = decodeURIComponent(examTypeDelete[1]);
    const index = db.examTypes.findIndex((item) => item.id === id);
    if (index < 0) return sendJson(res, 404, { message: "考试类型不存在。" });
    if (db.examTypes[index].builtIn) return sendJson(res, 400, { message: "内置考试类型不能删除，可以修改名称。" });
    if (papers.some((paper) => paper.category === id) || db.classes.some((klass) => klass.category === id)) {
      return sendJson(res, 409, { message: "已有试卷或班级正在使用该考试类型，不能删除。" });
    }
    db.examTypes.splice(index, 1);
    audit(db, user, "exam-type:delete", id);
    saveDb(db);
    return sendJson(res, 200, { ok: true });
  }

  const paperDelete = url.pathname.match(/^\/api\/admin\/papers\/([^/]+)$/);
  if (req.method === "DELETE" && paperDelete) {
    const user = requireTeacher(req, res, db);
    if (!user) return;
    const id = decodeURIComponent(paperDelete[1]);
    const index = papers.findIndex((paper) => paper.id === id);
    if (index < 0) return sendJson(res, 404, { message: "试卷不存在。" });
    if (!canManagePaper(user, papers[index])) return sendJson(res, 403, { message: "只能删除自己创建的试卷。" });
    papers.splice(index, 1);
    audit(db, user, "paper:delete", id);
    savePapers(papers);
    saveDb(db);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/classes") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const classes = db.classes.filter((klass) => canAccessClass(user, klass, db)).map((klass) => classPayload(klass, db, user));
    const classIds = new Set(classes.map((klass) => klass.id));
    const visiblePaperIds = new Set(papers.filter((paper) => !isPaperHidden(db, paper)).map((paper) => paper.id));
    return sendJson(res, 200, {
      classes,
      assignments: db.assignments
        .filter((item) => classIds.has(item.classId) && visiblePaperIds.has(item.paperId))
        .map((assignment) => ({
          ...assignment,
          paperTitle: papers.find((paper) => paper.id === assignment.paperId)?.title || assignment.title,
          className: db.classes.find((klass) => klass.id === assignment.classId)?.name || ""
        }))
    });
  }

  if (req.method === "POST" && url.pathname === "/api/classes") {
    const user = requireTeacher(req, res, db);
    if (!user) return;
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    if (!name) return sendJson(res, 400, { message: "班级名称不能为空。" });
    const category = String(body.category || "gesp").trim();
    const examType = db.examTypes.find((item) => item.id === category);
    if (!examType) return sendJson(res, 400, { message: "考试类型不存在。" });
    const klass = {
      id: crypto.randomUUID(),
      name,
      category,
      level: examType.levelEnabled ? Number(body.level || 1) : null,
      description: String(body.description || "").trim(),
      teacherId: user.id,
      inviteCode: crypto.randomBytes(3).toString("hex").toUpperCase(),
      createdAt: new Date().toISOString()
    };
    db.classes.unshift(klass);
    audit(db, user, "class:create", klass.id);
    saveDb(db);
    return sendJson(res, 201, { class: classPayload(klass, db, user) });
  }

  if (req.method === "POST" && url.pathname === "/api/classes/join") {
    const user = requireUser(req, res, db);
    if (!user) return;
    if (user.role !== "student") return sendJson(res, 403, { message: "只有学生账号可以加入班级。" });
    const body = await readBody(req);
    const code = String(body.inviteCode || "").trim().toUpperCase();
    const klass = db.classes.find((item) => item.inviteCode === code);
    if (!klass) return sendJson(res, 404, { message: "班级邀请码不存在。" });
    const exists = db.enrollments.some((item) => item.classId === klass.id && item.userId === user.id);
    if (!exists) {
      db.enrollments.push({ id: crypto.randomUUID(), classId: klass.id, userId: user.id, createdAt: new Date().toISOString() });
      audit(db, user, "class:join", klass.id);
      saveDb(db);
    }
    return sendJson(res, 200, { class: classPayload(klass, db, user) });
  }

  const classStudentsAdd = url.pathname.match(/^\/api\/classes\/([^/]+)\/students$/);
  if (req.method === "POST" && classStudentsAdd) {
    const user = requireTeacher(req, res, db);
    if (!user) return;
    const classId = decodeURIComponent(classStudentsAdd[1]);
    const klass = db.classes.find((item) => item.id === classId);
    if (!canManageClass(user, klass)) {
      return sendJson(res, 404, { message: "班级不存在或无权限。" });
    }
    const body = await readBody(req);
    const ids = Array.isArray(body.studentIds) ? body.studentIds.map((id) => String(id || "")) : [];
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (!uniqueIds.length) return sendJson(res, 400, { message: "请先选择学生。" });

    const allowedStudents = db.users.filter((item) => {
      if (item.role !== "student" || item.status === "disabled") return false;
      if (isAdmin(user)) return true;
      return item.teacherId === user.id;
    });
    const allowedIds = new Set(allowedStudents.map((item) => item.id));
    let added = 0;
    const skipped = [];
    uniqueIds.forEach((studentId) => {
      const student = db.users.find((item) => item.id === studentId);
      if (!student || !allowedIds.has(studentId)) {
        skipped.push({ id: studentId, message: "学生不存在或不属于当前教师。" });
        return;
      }
      const exists = db.enrollments.some((item) => item.classId === classId && item.userId === studentId);
      if (exists) {
        skipped.push({ id: studentId, username: student.username, message: "已在班级中。" });
        return;
      }
      db.enrollments.push({ id: crypto.randomUUID(), classId, userId: studentId, createdAt: new Date().toISOString(), addedBy: user.id });
      added += 1;
      audit(db, user, "class:add-student", `${classId}:${studentId}`);
    });
    if (added) saveDb(db);
    return sendJson(res, 200, { added, skipped, class: classPayload(klass, db, user) });
  }

  const assignmentCreate = url.pathname.match(/^\/api\/classes\/([^/]+)\/assignments$/);
  if (req.method === "POST" && assignmentCreate) {
    const user = requireTeacher(req, res, db);
    if (!user) return;
    const classId = decodeURIComponent(assignmentCreate[1]);
    const klass = db.classes.find((item) => item.id === classId);
    if (!klass || (!isAdmin(user) && klass.teacherId !== user.id)) {
      return sendJson(res, 404, { message: "班级不存在或无权限。" });
    }
    const body = await readBody(req);
    const paper = papers.find((item) => item.id === body.paperId);
    if (!paper) return sendJson(res, 404, { message: "试卷不存在。" });
    const assignment = {
      id: crypto.randomUUID(),
      classId,
      paperId: paper.id,
      title: String(body.title || paper.title).trim(),
      startAt: body.startAt || "",
      endAt: body.endAt || body.dueAt || "",
      dueAt: body.endAt || body.dueAt || "",
      createdBy: user.id,
      createdAt: new Date().toISOString()
    };
    db.assignments.unshift(assignment);
    audit(db, user, "assignment:create", assignment.id);
    saveDb(db);
    return sendJson(res, 201, { assignment });
  }

  const classReport = url.pathname.match(/^\/api\/classes\/([^/]+)\/report$/);
  if (req.method === "GET" && classReport) {
    const user = requireTeacher(req, res, db);
    if (!user) return;
    const classId = decodeURIComponent(classReport[1]);
    const klass = db.classes.find((item) => item.id === classId);
    if (!klass || (!isAdmin(user) && klass.teacherId !== user.id)) {
      return sendJson(res, 404, { message: "班级不存在或无权限。" });
    }
    return sendJson(res, 200, classReportPayload(klass, db, papers, user));
  }

  if (req.method === "GET" && url.pathname === "/api/admin/users") {
    const user = requireAdmin(req, res, db);
    if (!user) return;
    const attemptCounts = countAttemptsByUser();
    return sendJson(res, 200, {
      users: db.users.map((item) => ({
        ...publicUser(item, db),
        attemptCount: attemptCounts.get(item.id) || 0
      }))
    });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/users") {
    const user = requireAdmin(req, res, db);
    if (!user) return;
    const body = await readBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const role = ["admin", "teacher", "student"].includes(body.role) ? body.role : "student";
    const teacherId = role === "student" ? normalizeStudentTeacherId(db, body.teacherId) : "";
    if (!/^[A-Za-z][A-Za-z0-9_]{3,15}$/.test(username)) {
      return sendJson(res, 400, { message: "用户名需字母开头，4-16 位英文、数字或下划线。" });
    }
    if (password.length < 6) return sendJson(res, 400, { message: "密码至少 6 位。" });
    if (db.users.some((item) => item.username.toLowerCase() === username.toLowerCase())) {
      return sendJson(res, 409, { message: "用户名已存在。" });
    }
    const newUser = createUserRecord(db, username, password, role, teacherId);
    audit(db, user, "user:create", newUser.id);
    saveDb(db);
    return sendJson(res, 201, { user: publicUser(newUser, db) });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/users/import") {
    const user = requireAdmin(req, res, db);
    if (!user) return;
    const upload = parseMultipart(req, await readRawBody(req));
    const role = ["teacher", "student"].includes(upload.fields.role) ? upload.fields.role : "student";
    const teacherId = role === "student" ? normalizeStudentTeacherId(db, upload.fields.teacherId) : "";
    const file = upload.files.file;
    if (!file?.content?.length) return sendJson(res, 400, { message: "请上传 Excel 文件。" });
    const rows = parseUserRowsFromWorkbook(file.content);
    if (!rows.length) return sendJson(res, 400, { message: "表格中没有读取到用户名和密码。" });
    const existingNames = new Set(db.users.map((item) => item.username.toLowerCase()));
    const created = [];
    const skipped = [];
    const failed = [];
    rows.forEach((row, index) => {
      const username = String(row.username || "").trim();
      const password = String(row.password || "");
      const rowNumber = index + 2;
      const error = userValidationError(username, password);
      if (error) {
        failed.push({ row: rowNumber, username, message: error });
        return;
      }
      if (existingNames.has(username.toLowerCase())) {
        skipped.push({ row: rowNumber, username, message: "用户名已存在。" });
        return;
      }
      const newUser = createUserRecord(db, username, password, role, teacherId);
      existingNames.add(username.toLowerCase());
      created.push(publicUser(newUser, db));
      audit(db, user, "user:bulk-create", newUser.id);
    });
    if (created.length) saveDb(db);
    return sendJson(res, 200, {
      role,
      total: rows.length,
      created: created.length,
      skipped,
      failed,
      users: created
    });
  }

  const roleUpdate = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
  if (req.method === "POST" && roleUpdate) {
    const user = requireAdmin(req, res, db);
    if (!user) return;
    const target = db.users.find((item) => item.id === decodeURIComponent(roleUpdate[1]));
    if (!target) return sendJson(res, 404, { message: "用户不存在。" });
    const body = await readBody(req);
    if (!["admin", "teacher", "student"].includes(body.role)) return sendJson(res, 400, { message: "角色不正确。" });
    target.role = body.role;
    target.status = body.status === "disabled" ? "disabled" : "active";
    if (target.role === "student") {
      const nextTeacherId = Object.prototype.hasOwnProperty.call(body, "teacherId") ? body.teacherId : target.teacherId;
      target.teacherId = normalizeStudentTeacherId(db, nextTeacherId);
    }
    else delete target.teacherId;
    audit(db, user, "user:role", target.id);
    saveDb(db);
    return sendJson(res, 200, { user: publicUser(target, db) });
  }

  return sendJson(res, 404, { message: "接口不存在。" });
}

function staticFile(req, res) {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath.startsWith("/vendor/mathjax/")) {
    const requestPath = urlPath.replace("/vendor/mathjax/", "");
    const file = path.normalize(path.join(MATHJAX_DIR, requestPath));
    if (!file.startsWith(MATHJAX_DIR)) return send(res, 403, "禁止访问");
    fs.readFile(file, (error, content) => {
      if (error) return send(res, 404, "未找到文件");
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
      res.end(content);
    });
    return;
  }
  const requestPath = urlPath === "/" ? "/index.html" : urlPath;
  const file = path.normalize(path.join(PUBLIC_DIR, requestPath));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, "禁止访问");
  fs.readFile(file, (error, content) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) return send(res, 404, "未找到页面");
        res.writeHead(200, { "Content-Type": contentTypes[".html"] });
        res.end(fallback);
      });
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
    res.end(content);
  });
}

const db = loadDb();
saveDb(db);
savePapers(loadPapers());
scheduleBackups();

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    api(req, res).catch((error) => {
      const clientErrors = new Set(["请求体过大。", "JSON 格式不正确。", "上传文件过大。"]);
      sendJson(res, clientErrors.has(error.message) ? 400 : 500, { message: error.message || "服务器错误。" });
    });
    return;
  }
  staticFile(req, res);
});

server.listen(PORT, () => {
  console.log(`GESP practice platform is running at http://localhost:${PORT}`);
});
