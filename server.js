const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const PAPERS_FILE = path.join(DATA_DIR, "papers.json");
const PORT = Number(process.env.PORT || 5173);
const MAX_BODY = 1024 * 1024;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.passwordHash, "hex"));
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

  db.users.forEach((user) => {
    user.role ||= "student";
    user.status ||= "active";
    user.createdAt ||= new Date().toISOString();
  });

  seedUser(db, "admin", "admin123", "admin");
  seedUser(db, "teacher", "teacher123", "teacher");
  seedUser(db, "demo", "demo123", "student");
  seedExamTypes(db);
  db.classes.forEach((klass) => {
    klass.category ||= "gesp";
    const examType = db.examTypes.find((item) => item.id === klass.category);
    if (!examType?.levelEnabled) klass.level = null;
  });
  return db;
}

function seedExamTypes(db) {
  const defaults = [
    { id: "gesp", name: "GESP", levelEnabled: true, builtIn: true },
    { id: "cspj", name: "CSP-J 初赛", levelEnabled: false, builtIn: true },
    { id: "csps", name: "CSP-S 初赛", levelEnabled: false, builtIn: true },
    { id: "csp", name: "CSP-J/S 初赛", levelEnabled: false, builtIn: true }
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
  return normalizeDb(readJson(DB_FILE, {}));
}

function saveDb(db) {
  writeJson(DB_FILE, db);
}

function loadPapers() {
  return readJson(PAPERS_FILE, []);
}

function savePapers(papers) {
  writeJson(PAPERS_FILE, papers);
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
  const user = db.users.find((item) => item.id === session.userId);
  if (!user || user.status === "disabled") return null;
  return user;
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt
  };
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

function publicPaper(paper) {
  return {
    ...paper,
    questions: (paper.questions || []).map((question) => {
      const { answer, explanation, tests, ...visible } = question;
      return visible;
    })
  };
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
  db.attempts.unshift(item);
  db.attempts = db.attempts.slice(0, 1000);
  saveDb(db);
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
  db.auditLogs = db.auditLogs.slice(0, 500);
}

function validatePaper(input, db) {
  const category = String(input.category || "gesp").trim();
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
    summary: String(input.summary || "").trim(),
    questions: Array.isArray(input.questions) ? input.questions : []
  };
  if (!paper.title) throw new Error("试卷标题不能为空。");
  if (examType.levelEnabled && (paper.level < 1 || paper.level > 8)) throw new Error("等级需在 1-8 之间。");
  paper.questions.forEach((question, index) => {
    question.id ||= `${paper.id}-q${index + 1}`;
    question.score = Number(question.score || 0);
  });
  return paper;
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

function classPayload(klass, db) {
  const teacher = db.users.find((user) => user.id === klass.teacherId);
  const studentCount = db.enrollments.filter((item) => item.classId === klass.id).length;
  const assignmentCount = db.assignments.filter((item) => item.classId === klass.id).length;
  const examType = db.examTypes.find((item) => item.id === klass.category);
  return {
    ...klass,
    categoryName: examType?.name || klass.category || "GESP",
    teacherName: teacher?.username || "unknown",
    studentCount,
    assignmentCount
  };
}

function classReportPayload(klass, db, papers) {
  const enrollments = db.enrollments.filter((item) => item.classId === klass.id);
  const students = enrollments
    .map((item) => db.users.find((user) => user.id === item.userId))
    .filter(Boolean);
  const assignments = db.assignments.filter((item) => item.classId === klass.id);
  const assignmentPaperIds = new Set(assignments.map((item) => item.paperId));
  const studentIds = new Set(students.map((item) => item.id));
  const attempts = db.attempts
    .filter((item) => studentIds.has(item.userId) && (assignmentPaperIds.size === 0 || assignmentPaperIds.has(item.paperId)))
    .slice(0, 100);
  const studentRows = students.map((student) => {
    const studentAttempts = attempts.filter((item) => item.userId === student.id);
    const bestObjective = studentAttempts
      .filter((item) => item.type === "objective")
      .sort((a, b) => ((b.score || 0) / (b.fullScore || 1)) - ((a.score || 0) / (a.fullScore || 1)))[0];
    return {
      ...publicUser(student),
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
    class: classPayload(klass, db),
    assignments: assignments.map((assignment) => ({
      ...assignment,
      paperTitle: papers.find((paper) => paper.id === assignment.paperId)?.title || assignment.title
    })),
    students: studentRows,
    recentAttempts: attempts.slice(0, 30)
  };
}

function buildStudentSummary(user, db, papers) {
  const attempts = db.attempts.filter((item) => item.userId === user.id);
  const classIds = new Set(db.enrollments.filter((item) => item.userId === user.id).map((item) => item.classId));
  const assignments = db.assignments
    .filter((item) => classIds.has(item.classId))
    .map((assignment) => {
      const paper = papers.find((item) => item.id === assignment.paperId);
      const related = attempts.filter((item) => item.paperId === assignment.paperId);
      const objective = related
        .filter((item) => item.type === "objective")
        .sort((a, b) => (b.score || 0) - (a.score || 0))[0];
      const programs = related.filter((item) => item.type === "program" && item.status === "accepted");
      const programTotal = (paper?.questions || []).filter((item) => item.type === "program").length;
      const objectiveDone = Boolean(objective);
      const programDone = programTotal === 0 || programs.length >= programTotal;
      return {
        ...assignment,
        paperTitle: paper?.title || assignment.title,
        className: db.classes.find((item) => item.id === assignment.classId)?.name || "",
        done: objectiveDone && programDone,
        bestObjective: objective ? { score: objective.score, fullScore: objective.fullScore } : null,
        acceptedPrograms: programs.length,
        programTotal
      };
    });

  const wrongMap = new Map();
  attempts
    .filter((item) => item.type === "objective")
    .forEach((attempt) => {
      const paper = papers.find((item) => item.id === attempt.paperId);
      (attempt.details || []).forEach((detail) => {
        if (detail.correct) return;
        const question = (paper?.questions || []).find((item) => item.id === detail.id);
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
    const levelPapers = papers.filter((paper) => (paper.category || "gesp") === "gesp" && Number(paper.level) === level);
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
      papers: papers.length
    });
  }

  if (req.method === "GET" && url.pathname === "/api/papers") {
    return sendJson(res, 200, { papers: papers.map(publicPaper) });
  }

  if (req.method === "GET" && url.pathname === "/api/exam-types") {
    return sendJson(res, 200, { examTypes: db.examTypes.map(publicExamType) });
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    const user = currentUser(req, db);
    const attempts = user ? db.attempts.filter((item) => item.userId === user.id).slice(0, 80) : [];
    const classes = user ? db.classes.filter((klass) => canAccessClass(user, klass, db)).map((klass) => classPayload(klass, db)) : [];
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
    const sid = crypto.randomBytes(24).toString("hex");
    db.sessions[sid] = { userId: user.id, createdAt: new Date().toISOString() };
    saveDb(db);
    return sendJson(res, 201, { user: publicUser(user) }, {
      "Set-Cookie": `sid=${sid}; HttpOnly; SameSite=Lax; Path=/`
    });
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const user = db.users.find((item) => item.username.toLowerCase() === username.toLowerCase());
    if (!user || user.status === "disabled" || !verifyPassword(password, user)) {
      return sendJson(res, 401, { message: "账号或密码不正确。" });
    }
    const sid = crypto.randomBytes(24).toString("hex");
    db.sessions[sid] = { userId: user.id, createdAt: new Date().toISOString() };
    saveDb(db);
    return sendJson(res, 200, { user: publicUser(user) }, {
      "Set-Cookie": `sid=${sid}; HttpOnly; SameSite=Lax; Path=/`
    });
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.sid) delete db.sessions[cookies.sid];
    saveDb(db);
    return sendJson(res, 200, { ok: true }, {
      "Set-Cookie": "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
    });
  }

  if (req.method === "POST" && url.pathname === "/api/submit-objective") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const body = await readBody(req);
    const paper = papers.find((item) => item.id === body.paperId);
    if (!paper) return sendJson(res, 404, { message: "试卷不存在。" });
    const answers = body.answers || {};
    const objectiveQuestions = (paper.questions || []).filter((item) => item.type === "single" || item.type === "judge");
    let score = 0;
    const details = objectiveQuestions.map((question) => {
      const raw = answers[question.id];
      const userAnswer = question.type === "judge" ? raw === true || raw === "true" : Number(raw);
      const correct = userAnswer === question.answer;
      if (correct) score += question.score;
      return {
        id: question.id,
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
    const user = requireUser(req, res, db);
    if (!user) return;
    const body = await readBody(req);
    const { paper, question } = findQuestion(papers, body.paperId, body.questionId);
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
    const studentAttempts = db.attempts.filter((attempt) => studentIds.has(attempt.userId));
    return sendJson(res, 200, {
      totals: {
        papers: papers.length,
        classes: teacherClasses.length,
        students: studentIds.size,
        attempts: studentAttempts.length
      },
      classes: teacherClasses.map((klass) => classPayload(klass, db)),
      recentAttempts: studentAttempts.slice(0, 20),
      assignments: db.assignments.filter((item) => classIds.has(item.classId)).slice(0, 30)
    });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/papers") {
    const user = requireTeacher(req, res, db);
    if (!user) return;
    return sendJson(res, 200, { papers });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/papers") {
    const user = requireTeacher(req, res, db);
    if (!user) return;
    const body = await readBody(req);
    const paper = validatePaper(body.paper || body, db);
    const index = papers.findIndex((item) => item.id === paper.id);
    const now = new Date().toISOString();
    if (index >= 0) {
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

  if (req.method === "POST" && url.pathname === "/api/admin/exam-types") {
    const user = requireAdmin(req, res, db);
    if (!user) return;
    const body = await readBody(req);
    const id = String(body.id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const name = String(body.name || "").trim();
    if (!/^[a-z][a-z0-9_-]{1,20}$/.test(id)) {
      return sendJson(res, 400, { message: "考试类型 ID 需字母开头，2-21 位英文、数字、下划线或短横线。" });
    }
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
    papers.splice(index, 1);
    audit(db, user, "paper:delete", id);
    savePapers(papers);
    saveDb(db);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/classes") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const classes = db.classes.filter((klass) => canAccessClass(user, klass, db)).map((klass) => classPayload(klass, db));
    const classIds = new Set(classes.map((klass) => klass.id));
    return sendJson(res, 200, {
      classes,
      assignments: db.assignments.filter((item) => classIds.has(item.classId))
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
    return sendJson(res, 201, { class: classPayload(klass, db) });
  }

  if (req.method === "POST" && url.pathname === "/api/classes/join") {
    const user = requireUser(req, res, db);
    if (!user) return;
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
    return sendJson(res, 200, { class: classPayload(klass, db) });
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
      dueAt: body.dueAt || "",
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
    return sendJson(res, 200, classReportPayload(klass, db, papers));
  }

  if (req.method === "GET" && url.pathname === "/api/admin/users") {
    const user = requireAdmin(req, res, db);
    if (!user) return;
    return sendJson(res, 200, {
      users: db.users.map((item) => ({
        ...publicUser(item),
        attemptCount: db.attempts.filter((attempt) => attempt.userId === item.id).length
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
    if (!/^[A-Za-z][A-Za-z0-9_]{3,15}$/.test(username)) {
      return sendJson(res, 400, { message: "用户名需字母开头，4-16 位英文、数字或下划线。" });
    }
    if (password.length < 6) return sendJson(res, 400, { message: "密码至少 6 位。" });
    if (db.users.some((item) => item.username.toLowerCase() === username.toLowerCase())) {
      return sendJson(res, 409, { message: "用户名已存在。" });
    }
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
    db.users.push(newUser);
    audit(db, user, "user:create", newUser.id);
    saveDb(db);
    return sendJson(res, 201, { user: publicUser(newUser) });
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
    audit(db, user, "user:role", target.id);
    saveDb(db);
    return sendJson(res, 200, { user: publicUser(target) });
  }

  return sendJson(res, 404, { message: "接口不存在。" });
}

function staticFile(req, res) {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
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

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    api(req, res).catch((error) => {
      sendJson(res, 500, { message: error.message || "服务器错误。" });
    });
    return;
  }
  staticFile(req, res);
});

server.listen(PORT, () => {
  console.log(`GESP practice platform is running at http://localhost:${PORT}`);
});
