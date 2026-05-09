const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const BACKUP_DIR = path.join(ROOT, "backups");
const SQLITE_FILE = path.join(DATA_DIR, "runtime.sqlite");
const PAPERS_FILE = path.join(DATA_DIR, "papers.json");
const DB_FILE = path.join(DATA_DIR, "db.json");
const RETENTION = Number(process.env.BACKUP_RETENTION || 14);

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function copyIfExists(source, target) {
  if (!fs.existsSync(source)) return false;
  fs.copyFileSync(source, target);
  return true;
}

function readPapersFromSqlite() {
  if (!fs.existsSync(SQLITE_FILE)) return null;
  const db = new Database(SQLITE_FILE, { readonly: true });
  try {
    const row = db.prepare("SELECT value FROM app_state WHERE key = ?").get("papers");
    return row ? JSON.parse(row.value) : null;
  } finally {
    db.close();
  }
}

function pruneBackups() {
  if (RETENTION <= 0 || !fs.existsSync(BACKUP_DIR)) return;
  const backups = fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .sort();
  backups.slice(0, Math.max(0, backups.length - RETENTION)).forEach((name) => {
    fs.rmSync(path.join(BACKUP_DIR, name), { recursive: true, force: true });
  });
}

async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const targetDir = path.join(BACKUP_DIR, `${timestamp()}-manual`);
  fs.mkdirSync(targetDir, { recursive: true });

  const papers = readPapersFromSqlite() || readJson(PAPERS_FILE, []);
  writeJson(path.join(targetDir, "papers.json"), papers);
  copyIfExists(DB_FILE, path.join(targetDir, "db.json"));

  if (fs.existsSync(SQLITE_FILE)) {
    const source = new Database(SQLITE_FILE, { readonly: true });
    try {
      await source.backup(path.join(targetDir, "runtime.sqlite"));
    } finally {
      source.close();
    }
  }

  writeJson(path.join(targetDir, "manifest.json"), {
    createdAt: new Date().toISOString(),
    reason: "manual",
    files: fs.readdirSync(targetDir),
    papers: papers.length
  });
  pruneBackups();
  console.log(`Backup created: ${targetDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
