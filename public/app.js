const state = {
  papers: [],
  user: null,
  attempts: [],
  classes: [],
  examTypes: [],
  authMode: "login",
  filters: { category: "all", level: "all", keyword: "" },
  programSubmissionEnabled: false,
  allowRegistration: true,
  dashboard: { attemptsPage: 1, attemptsPagination: null },
  study: { completedPage: 1, wrongPage: 1, activeTab: "pending" },
  workbench: null,
  workbenchTab: "classes",
  examSession: null,
  examTimerId: null,
  examHeartbeatId: null,
  manage: { papers: [], overview: null, users: [], userTeachers: [], students: [], usersPagination: null, studentsPagination: null, backups: [], archives: [], editPaper: null, classReport: null, overviewAttemptsPage: 1, classReportPages: { studentsPage: 1, attemptsPage: 1 }, tab: "papers", paperView: "list", importResult: null, paperFilter: { category: "all", keyword: "" }, classKeyword: "", classDetailTab: "students", _dataLoaded: false }
};

const app = document.querySelector("#app");
const authButton = document.querySelector("#authButton");
const authDialog = document.querySelector("#authDialog");
const authTitle = document.querySelector("#authTitle");
const authHint = document.querySelector("#authHint");
const authUsername = document.querySelector("#authUsername");
const authPassword = document.querySelector("#authPassword");
const submitAuth = document.querySelector("#submitAuth");
const toggleAuth = document.querySelector("#toggleAuth");
const closeAuth = document.querySelector("#closeAuth");
const toast = document.querySelector("#toast");
const accountMenu = document.querySelector("#accountMenu");
const accountManageLink = document.querySelector("#accountManageLink");
const accountWorkbenchLink = document.querySelector("#accountWorkbenchLink");
const changePasswordButton = document.querySelector("#changePasswordButton");
const logoutButton = document.querySelector("#logoutButton");
const passwordDialog = document.querySelector("#passwordDialog");
const currentPassword = document.querySelector("#currentPassword");
const newPassword = document.querySelector("#newPassword");
const confirmNewPassword = document.querySelector("#confirmNewPassword");
const savePassword = document.querySelector("#savePassword");
const closePasswordDialog = document.querySelector("#closePasswordDialog");
const cancelPasswordDialog = document.querySelector("#cancelPasswordDialog");
const codeInsertDialog = document.querySelector("#codeInsertDialog");
const codeLanguageInput = document.querySelector("#codeLanguageInput");
const codeSnippetInput = document.querySelector("#codeSnippetInput");
const codeSnippetPreview = document.querySelector("#codeSnippetPreview");
const insertCodeSnippet = document.querySelector("#insertCodeSnippet");
const closeCodeInsert = document.querySelector("#closeCodeInsert");
const cancelCodeInsert = document.querySelector("#cancelCodeInsert");
const formulaInsertDialog = document.querySelector("#formulaInsertDialog");
const formulaSnippetInput = document.querySelector("#formulaSnippetInput");
const formulaSnippetPreview = document.querySelector("#formulaSnippetPreview");
const formulaDisplayMode = document.querySelector("#formulaDisplayMode");
const insertFormulaSnippet = document.querySelector("#insertFormulaSnippet");
const closeFormulaInsert = document.querySelector("#closeFormulaInsert");
const cancelFormulaInsert = document.querySelector("#cancelFormulaInsert");
const submitConfirmDialog = document.querySelector("#submitConfirmDialog");
const submitStats = document.querySelector("#submitStats");
const confirmSubmitBtn = document.querySelector("#confirmSubmit");
const cancelSubmitBtn = document.querySelector("#cancelSubmit");
const closeSubmitConfirm = document.querySelector("#closeSubmitConfirm");
let pendingMarkdownTextarea = null;
let pendingSubmitPaperId = null;
let draftSaveTimer = null;
let draftIntervalTimer = null;
let activeDraftPaperId = "";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function nl2br(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function renderInlineMarkdown(value) {
  let html = escapeHtml(value);
  html = html.replace(/!\[([^\]]*)\]\(((?:https?:\/\/|\/)[^)\s]+)\)/g, '<img class="markdown-image" src="$2" alt="$1">');
  html = html.replace(/\$([^$\n]+)\$/g, (_, formula) => `<span class="math-inline">\\(${formula}\\)</span>`);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return html;
}

function typesetMath(root = app) {
  if (!window.MathJax?.typesetPromise) return;
  window.MathJax.typesetPromise([root]).catch(() => {});
}

function renderMarkdown(value) {
  const text = String(value || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";

  const html = [];
  const fence = /(`{3,})([a-zA-Z0-9+#-]*)\n([\s\S]*?)\1/g;
  let cursor = 0;
  let match;
  while ((match = fence.exec(text))) {
    html.push(renderMarkdownBlocks(text.slice(cursor, match.index)));
    const lang = match[2] ? ` data-lang="${escapeHtml(match[2])}"` : "";
    html.push(renderCodeBlock(match[3].trimEnd(), lang));
    cursor = match.index + match[0].length;
  }
  html.push(renderMarkdownBlocks(text.slice(cursor)));
  return html.join("");
}

function renderCodeBlock(code, lang = "") {
  const lines = String(code || "").split("\n");
  return `<pre class="code-block"${lang}><code>${lines.map((line) => `<span class="code-line">${escapeHtml(line) || " "}</span>`).join("")}</code></pre>`;
}

function renderMarkdownBlocks(value) {
  const blocks = String(value || "").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return blocks.map((block) => {
    if (/^\$\$[\s\S]*\$\$$/.test(block)) {
      return `<div class="math-block">\\[${escapeHtml(block.slice(2, -2).trim())}\\]</div>`;
    }
    const lines = block.split("\n");
    if (isMarkdownTable(lines)) return renderMarkdownTable(lines);
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      return `<ul>${lines.map((line) => `<li>${renderInlineMarkdown(line.replace(/^\s*[-*]\s+/, ""))}</li>`).join("")}</ul>`;
    }
    if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
      return `<ol>${lines.map((line) => `<li>${renderInlineMarkdown(line.replace(/^\s*\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`;
    }
    return `<p>${renderInlineMarkdown(lines.join("\n")).replace(/\n/g, "<br>")}</p>`;
  }).join("");
}

function isMarkdownTable(lines) {
  return lines.length >= 2 && lines[0].includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[1]);
}

function renderMarkdownTable(lines) {
  const rows = lines
    .filter((_, index) => index !== 1)
    .map((line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()));
  const head = rows.shift() || [];
  return `
    <table>
      <thead><tr>${head.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  `;
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "请求失败");
  return data;
}

function isTeacher() {
  return state.user && (state.user.role === "teacher" || state.user.role === "admin");
}

function isAdmin() {
  return state.user?.role === "admin";
}

function roleName(role) {
  return { admin: "管理员", teacher: "教师", student: "学生" }[role] || role;
}

function categoryName(category) {
  return state.examTypes.find((item) => item.id === category)?.name || { gesp: "GESP", cspj: "CSP-J 初赛", csps: "CSP-S 初赛" }[category] || category || "综合";
}

function examTypeById(id) {
  return state.examTypes.find((item) => item.id === id) || { id, name: categoryName(id), levelEnabled: id === "gesp" };
}

function setActiveNav(hash) {
  document.querySelectorAll("[data-link]").forEach((link) => link.classList.remove("active"));
  const name = hash.startsWith("#/manage") || hash === "#/guide" || hash === "#/workbench" ? "manage" : hash.startsWith("#/classes") ? "classes" : hash === "#/study" ? "study" : hash === "#/dashboard" ? "dashboard" : "home";
  document.querySelector(`[data-link="${name}"]`)?.classList.add("active");
}

function route() {
  const hash = location.hash || "#/";
  if (!hash.startsWith("#/paper/")) {
    stopPaperDraftAutoSave();
    stopExamTimers();
  }
  setActiveNav(hash);
  if (hash.startsWith("#/paper/")) renderPaper(decodeURIComponent(hash.replace("#/paper/", "")));
  else if (hash === "#/dashboard") renderDashboard();
  else if (hash === "#/study") renderStudy();
  else if (hash === "#/workbench") renderTeacherWorkbench();
  else if (hash === "#/classes" || hash.startsWith("#/classes/")) renderClasses();
  else if (hash.startsWith("#/manage")) renderManage();
  else if (hash === "#/guide") renderGuide();
  else renderHome();
  window.setTimeout(() => typesetMath(app), 0);
}

function paperStats(paper) {
  const questions = paper.questions || [];
  const objective = flattenObjectiveQuestions(questions);
  return {
    fullScore: questions.reduce((sum, question) => sum + (question.score || 0), 0),
    objective: objective.length,
    program: questions.filter((question) => question.type === "program").length
  };
}

function isObjectiveType(type) {
  return type === "single" || type === "judge" || type === "multi";
}

function isCompositeType(type) {
  return type === "reading" || type === "completion";
}

function objectiveAnswerId(parent, question) {
  return parent ? `${parent.id}__${question.id}` : question.id;
}

function flattenObjectiveQuestions(questions, parent = null) {
  return (questions || []).flatMap((question) => {
    if (isObjectiveType(question.type)) return [{ ...question, answerId: objectiveAnswerId(parent, question), parentId: parent?.id || "" }];
    if (isCompositeType(question.type)) return flattenObjectiveQuestions(question.subquestions || [], question);
    return [];
  });
}

function answerValues(id, type) {
  const inputs = Array.from(document.getElementsByName(id));
  if (type === "multi") {
    return inputs.filter((input) => input.checked).map((input) => input.value);
  }
  const checked = inputs.find((input) => input.checked);
  return checked ? checked.value : "";
}

function isAnswerComplete(id, type) {
  const value = answerValues(id, type);
  return Array.isArray(value) ? value.length > 0 : value !== "";
}

function percent(score, fullScore) {
  return fullScore ? Math.round((Number(score || 0) / Number(fullScore || 0)) * 100) : 0;
}

function scoreLevel(score, fullScore) {
  const value = percent(score, fullScore);
  if (value >= 90) return "excellent";
  if (value >= 60) return "pass";
  return "low";
}

function renderScoreBadge(score, fullScore, label = "得分") {
  const value = percent(score, fullScore);
  return `<span class="score-badge ${scoreLevel(score, fullScore)}"><strong>${value}</strong><small>%</small><em>${label} ${score}/${fullScore}</em></span>`;
}

function filteredPapers() {
  return state.papers.filter((paper) => {
    const category = paper.category || "gesp";
    const byCategory = state.filters.category === "all" || category === state.filters.category;
    const byLevel = !examTypeById(category).levelEnabled || state.filters.category !== category || state.filters.level === "all" || String(paper.level) === state.filters.level;
    const text = `${paper.title} ${paper.summary} ${paper.language} ${categoryName(paper.category)}`.toLowerCase();
    const byKeyword = !state.filters.keyword || text.includes(state.filters.keyword.toLowerCase());
    return byCategory && byLevel && byKeyword;
  });
}

function renderHome() {
  const papers = filteredPapers();
  const latest = [...state.papers].sort((a, b) => `${b.year}${b.month}`.localeCompare(`${a.year}${a.month}`)).slice(0, 8);
  const ranks = rankUsers();

  app.innerHTML = `
    <div class="grid">
      <section>
        <div class="panel intro">
          <div class="panel-head">
            <h1>初赛考级练习平台</h1>
            <div class="filters">
              <select id="categoryFilter" aria-label="考试类型筛选">
                <option value="all">全部类型</option>
                ${state.examTypes.map((type) => `<option value="${type.id}">${escapeHtml(type.name)}</option>`).join("")}
              </select>
              <select id="levelFilter" aria-label="等级筛选">
                <option value="all">全部等级</option>
                ${Array.from({ length: 8 }, (_, index) => `<option value="${index + 1}">${index + 1} 级</option>`).join("")}
              </select>
              <input id="keywordFilter" placeholder="搜索试卷、专题或关键词" value="${escapeHtml(state.filters.keyword)}">
            </div>
          </div>
          <div class="panel-body">
            <p>平台面向 GESP 考级与 CSP-J/S 初赛练习，学生可以按类型和等级刷题，教师可以建班、布置作业、维护题库。</p>
            <p>客观题自动判分，编程题支持 C++ 编译评测；学习中心会汇总作业、错题和等级进度。</p>
          </div>
        </div>

        <div class="panel" style="margin-top: 18px;">
          <div class="panel-head">
            <h2>试卷列表</h2>
            <span class="muted">共 ${papers.length} 套</span>
          </div>
          <ul class="paper-list">
            ${papers.map(renderPaperItem).join("") || `<li class="empty">没有匹配的试卷</li>`}
          </ul>
        </div>
      </section>

      <aside class="side-stack">
        <div class="panel">
          <div class="panel-head"><h2>账号</h2></div>
          <div class="panel-body">
            ${
              state.user
                ? `<p><strong>${escapeHtml(state.user.username)}</strong> · ${roleName(state.user.role)}</p><p class="muted">最近记录：${state.attempts.length} 条</p><div class="submit-row"><a class="secondary-btn" href="#/study">学习中心</a>${isTeacher() ? `<a class="secondary-btn" href="#/workbench">教师工作台</a><a class="primary-btn" href="#/manage">管理台</a>` : ""}</div>`
                : `<p class="muted">登录后可以保存练习记录、加入班级和查看错题。</p><button class="primary-btn" type="button" data-open-auth>登　录</button>`
            }
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>最新试卷</h2></div>
          <div class="panel-body">
            <ul class="mini-list">
              ${latest.map((paper) => `<li><a href="#/paper/${paper.id}">${escapeHtml(paper.title)}</a><span class="muted">${paper.views || 0}</span></li>`).join("")}
            </ul>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>练习榜</h2></div>
          <div class="panel-body">
            <ul class="mini-list">
              ${ranks.map((rank) => `<li><span class="rank-user"><span class="avatar">${escapeHtml(rank.name.slice(0, 1).toUpperCase())}</span>${escapeHtml(rank.name)}</span><span class="muted">${rank.count} 次</span></li>`).join("")}
            </ul>
          </div>
        </div>
      </aside>
    </div>
  `;

  document.querySelector("#categoryFilter").value = state.filters.category;
  document.querySelector("#levelFilter").value = state.filters.level;
  document.querySelector("#levelFilter").hidden = !examTypeById(state.filters.category).levelEnabled;
  document.querySelector("#categoryFilter").addEventListener("change", (event) => {
    state.filters.category = event.target.value;
    if (!examTypeById(state.filters.category).levelEnabled) state.filters.level = "all";
    renderHome();
  });
  document.querySelector("#levelFilter").addEventListener("change", (event) => {
    state.filters.level = event.target.value;
    renderHome();
  });
  document.querySelector("#keywordFilter").addEventListener("input", (event) => {
    state.filters.keyword = event.target.value.trim();
    renderHome();
  });
  document.querySelector("[data-open-auth]")?.addEventListener("click", openAuth);
}

function renderPaperItem(paper) {
  const stats = paperStats(paper);
  const category = paper.category || "gesp";
  return `
    <li class="paper-item">
      <span class="paper-icon">${examTypeById(category).levelEnabled ? `${paper.level}级` : "初赛"}</span>
      <div>
        <h3><a href="#/paper/${paper.id}">${escapeHtml(paper.title)}</a></h3>
        <div class="meta">
          <span>${categoryName(category)}</span>
          ${examTypeById(category).levelEnabled ? `<span>${paper.level} 级</span>` : ""}
          <span>${escapeHtml(paper.language || "C++")}</span>
          <span>${paper.year || ""}-${paper.month || ""}</span>
          <span>客观题 ${stats.objective}</span>
          <span>编程题 ${stats.program}</span>
          <span>满分 ${stats.fullScore}</span>
        </div>
      </div>
      <a class="primary-btn" href="#/paper/${paper.id}">开始练习</a>
    </li>
  `;
}

function rankUsers() {
  const counts = new Map();
  state.attempts.forEach((attempt) => counts.set(attempt.username, (counts.get(attempt.username) || 0) + 1));
  const localRanks = [...counts.entries()].map(([name, count]) => ({ name, count }));
  const fallback = [
    { name: "demo", count: 8 },
    { name: "student01", count: 6 },
    { name: "student02", count: 4 }
  ];
  return [...localRanks, ...fallback].sort((a, b) => b.count - a.count).slice(0, 8);
}

async function renderPaper(paperId) {
  const paper = state.papers.find((item) => item.id === paperId);
  if (!paper) {
    app.innerHTML = `<div class="panel empty">试卷不存在</div>`;
    return;
  }

  // Parse assignment ID from URL hash
  const hashParams = new URLSearchParams((location.hash || "").split("?")[1] || "");
  const assignmentId = hashParams.get("assignmentId") || "";
  let examData = null;
  let examDuration = 0;

  if (assignmentId && state.user) {
    try {
      const sessionResp = await api(`/api/exam/session?assignmentId=${encodeURIComponent(assignmentId)}`);
      const existingSession = sessionResp.session;
      if (existingSession && existingSession.remainingSeconds > 0) {
        examData = existingSession;
        examDuration = existingSession.remainingSeconds;
      } else if (!existingSession) {
        const startResp = await api("/api/exam/start", { method: "POST", body: { assignmentId } });
        if (startResp.session && startResp.session.remainingSeconds > 0) {
          examData = startResp.session;
          examDuration = startResp.session.remainingSeconds;
        }
      }
    } catch (e) {
      // Not a timed exam or exam start failed — just continue normally
    }
  }

  state.examSession = examData;
  if (state.examTimerId) { clearInterval(state.examTimerId); state.examTimerId = null; }

  const stats = paperStats(paper);
  const objectiveQuestions = flattenObjectiveQuestions(paper.questions);
  const groups = [
    ["单选题", paper.questions.filter((question) => question.type === "single")],
    ["判断题", paper.questions.filter((question) => question.type === "judge")],
    ["多选题", paper.questions.filter((question) => question.type === "multi")],
    ["阅读程序题", paper.questions.filter((question) => question.type === "reading")],
    ["完善程序题", paper.questions.filter((question) => question.type === "completion")],
    ["编程题", paper.questions.filter((question) => question.type === "program")]
  ].filter(([, questions]) => questions.length);

  const timerHtml = examData ? `
    <div class="exam-timer" id="examTimer">
      <div class="exam-timer-label">剩余时间</div>
      <div class="exam-timer-value" id="examTimerDisplay">${formatExamTime(examDuration)}</div>
    </div>
  ` : "";

  app.innerHTML = `
    <div class="paper-layout">
      <section>
        <div class="panel">
          <div class="panel-head paper-title">
            <div>
              <h1>${escapeHtml(paper.title)}</h1>
              <div class="meta" style="margin-top: 8px;">
                <span>${categoryName(paper.category || "gesp")}</span>
                ${examTypeById(paper.category || "gesp").levelEnabled ? `<span>${paper.level} 级</span>` : ""}
                <span>${escapeHtml(paper.language || "C++")}</span>
                <span>满分 ${stats.fullScore}</span>
                <span>客观题 ${stats.objective}</span>
                <span>编程题 ${stats.program}</span>
              </div>
            </div>
            <a class="secondary-btn" href="#/">返回列表</a>
          </div>
        </div>

        ${paper.questions.length ? groups.map(([title, questions], index) => renderQuestionGroup(`${sectionNumber(index + 1)}、${title}`, questions)).join("") : `<div class="panel empty" style="margin-top: 18px;">这套试卷还没有题目。</div>`}
      </section>

      <aside class="panel answer-card">
        <div class="panel-head"><h2>答题卡</h2></div>
        <div class="panel-body">
          ${timerHtml}
          <div class="answer-grid">
            ${paper.questions.map((question, index) => `<a href="#q-${question.id}" data-card="${question.id}" data-jump-question="${question.id}">${index + 1}</a>`).join("")}
          </div>
          <div class="submit-row">
            <button class="primary-btn" type="button" id="submitObjective" ${objectiveQuestions.length ? "" : "disabled"}>提交</button>
            <button class="secondary-btn" type="button" id="clearDraft">清除草稿</button>
          </div>
          <div class="muted draft-status" id="draftStatus">答题草稿会自动保存在本机浏览器。</div>
          <div class="score-box" id="scoreBox">
            <div class="muted">${state.programSubmissionEnabled ? "单选和判断题自动判分；编程题逐题提交。" : "单选和判断题自动判分；编程题提交暂时关闭。"}</div>
          </div>
        </div>
      </aside>
    </div>
  `;

  // Set up exam timer
  if (examData) {
    const timerDisplay = document.querySelector("#examTimerDisplay");
    const timerContainer = document.querySelector("#examTimer");
    let remaining = examDuration;
    let autoSubmitted = false;

    // Cleanup all timers
    function stopExamTimers() {
      if (state.examTimerId) { clearInterval(state.examTimerId); state.examTimerId = null; }
      if (state.examHeartbeatId) { clearInterval(state.examHeartbeatId); state.examHeartbeatId = null; }
      state.examSession = null;
    }

    const heartbeat = async () => {
      try {
        const resp = await api("/api/exam/heartbeat", { method: "POST", body: { sessionId: examData.id } });
        if (resp.expired && !autoSubmitted) {
          remaining = 0;
        }
      } catch (e) { /* ignore heartbeat errors */ }
    };

    state.examTimerId = setInterval(() => {
      remaining--;
      if (timerDisplay) {
        timerDisplay.textContent = formatExamTime(Math.max(0, remaining));
      }
      if (timerContainer) {
        timerContainer.classList.toggle("warning", remaining <= 300 && remaining > 60);
        timerContainer.classList.toggle("danger", remaining <= 60);
      }
      if (remaining <= 0 && !autoSubmitted) {
        autoSubmitted = true;
        stopExamTimers();
        notify("考试时间到，正在自动提交...");
        doSubmitObjective(paper.id);
      }
    }, 1000);

    state.examHeartbeatId = setInterval(heartbeat, 30000);
  }

  const restored = restorePaperDraft(paper.id);
  startPaperDraftAutoSave(paper.id);
  document.querySelectorAll("input[type='radio'], input[type='checkbox'], textarea").forEach((element) => {
    element.addEventListener("input", updateAnswerCard);
    element.addEventListener("change", updateAnswerCard);
    element.addEventListener("input", () => schedulePaperDraftSave(paper.id));
    element.addEventListener("change", () => schedulePaperDraftSave(paper.id));
  });
  document.querySelector("#submitObjective")?.addEventListener("click", () => submitObjective(paper.id));
  document.querySelector("#clearDraft")?.addEventListener("click", () => {
    clearPaperDraft(paper.id, "草稿已清除。");
    document.querySelectorAll("[data-objective-id] input").forEach((input) => { input.checked = false; });
    document.querySelectorAll(".code-editor[id^='code-']").forEach((editor) => { editor.value = defaultCode(); });
    updateAnswerCard();
  });
  document.querySelectorAll("[data-run-code]").forEach((button) => button.addEventListener("click", () => submitCode(paper.id, button.dataset.runCode)));
  document.querySelectorAll("[data-jump-question]").forEach((link) => link.addEventListener("click", jumpToQuestion));
  updateAnswerCard();
  updateDraftStatus(paper.id, restored ? "已恢复上次未提交的草稿。" : "");
}

function paperDraftKey(paperId) {
  return `csppractice:draft:${state.user?.id || "guest"}:${paperId}`;
}

function collectPaperDraft(paperId) {
  const answers = {};
  document.querySelectorAll("[data-objective-id]").forEach((item) => {
    const value = answerValues(item.dataset.objectiveId, item.dataset.objectiveType);
    if (Array.isArray(value) ? value.length : value !== "") answers[item.dataset.objectiveId] = value;
  });
  const code = {};
  document.querySelectorAll(".code-editor[id^='code-']").forEach((editor) => {
    const id = editor.id.replace(/^code-/, "");
    if (editor.value && editor.value !== defaultCode()) code[id] = editor.value;
  });
  return { paperId, userId: state.user?.id || "guest", answers, code, savedAt: new Date().toISOString() };
}

function restorePaperDraft(paperId) {
  const raw = window.localStorage.getItem(paperDraftKey(paperId));
  if (!raw) return false;
  let draft = null;
  try {
    draft = JSON.parse(raw);
  } catch (error) {
    return false;
  }
  Object.entries(draft.answers || {}).forEach(([id, value]) => {
    const values = Array.isArray(value) ? value.map(String) : [String(value)];
    Array.from(document.querySelectorAll("[data-objective-id] input")).filter((input) => input.name === id).forEach((input) => {
      input.checked = values.includes(input.value);
    });
  });
  Object.entries(draft.code || {}).forEach(([id, value]) => {
    const editor = document.querySelector(`#code-${CSS.escape(id)}`);
    if (editor) editor.value = value;
  });
  return true;
}

function schedulePaperDraftSave(paperId) {
  window.clearTimeout(draftSaveTimer);
  draftSaveTimer = window.setTimeout(() => savePaperDraft(paperId), 800);
}

function startPaperDraftAutoSave(paperId) {
  stopPaperDraftAutoSave(false);
  activeDraftPaperId = paperId;
  draftIntervalTimer = window.setInterval(() => {
    if (activeDraftPaperId) savePaperDraft(activeDraftPaperId);
  }, 20000);
}

function stopPaperDraftAutoSave(saveFirst = true) {
  if (saveFirst && activeDraftPaperId) savePaperDraft(activeDraftPaperId);
  window.clearTimeout(draftSaveTimer);
  window.clearInterval(draftIntervalTimer);
  draftSaveTimer = null;
  draftIntervalTimer = null;
  activeDraftPaperId = "";
}

function savePaperDraft(paperId) {
  const draft = collectPaperDraft(paperId);
  if (!Object.keys(draft.answers).length && !Object.keys(draft.code).length) {
    window.localStorage.removeItem(paperDraftKey(paperId));
    updateDraftStatus(paperId);
    return;
  }
  window.localStorage.setItem(paperDraftKey(paperId), JSON.stringify(draft));
  updateDraftStatus(paperId);
}

function clearPaperDraft(paperId, message = "已提交，草稿已清除。") {
  window.localStorage.removeItem(paperDraftKey(paperId));
  updateDraftStatus(paperId, message);
}

function updateDraftStatus(paperId, message = "") {
  const box = document.querySelector("#draftStatus");
  if (!box) return;
  const raw = window.localStorage.getItem(paperDraftKey(paperId));
  if (message) {
    box.textContent = message;
    return;
  }
  if (!raw) {
    box.textContent = "答题草稿会自动保存在本机浏览器。";
    return;
  }
  try {
    const draft = JSON.parse(raw);
    box.textContent = `草稿已保存：${formatDateTime(draft.savedAt)}`;
  } catch (error) {
    box.textContent = "答题草稿会自动保存在本机浏览器。";
  }
}

function jumpToQuestion(event) {
  event.preventDefault();
  const target = document.querySelector(`#q-${CSS.escape(event.currentTarget.dataset.jumpQuestion)}`);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.classList.add("focus-flash");
  window.setTimeout(() => target.classList.remove("focus-flash"), 900);
}

function renderQuestionGroup(title, questions) {
  if (!questions.length) return "";
  return `<div class="section-label">${title}</div>${questions.map((question, index) => renderQuestion(question, index)).join("")}`;
}

function sectionNumber(value) {
  return ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][value] || String(value);
}

function renderQuestion(question, index) {
  const typeLabel = questionTypeName(question.type);
  return `
    <article class="panel question" id="q-${question.id}" data-question="${question.id}" data-type="${question.type}">
      <div class="panel-body">
        <div class="question-head">
          <span>第 ${index + 1} 题 · ${typeLabel}</span>
          <span class="muted">${question.score} 分</span>
        </div>
        ${renderQuestionBody(question)}
      </div>
    </article>
  `;
}

function questionTypeName(type) {
  return { single: "单选", judge: "判断", multi: "多选", program: "编程", reading: "阅读程序", completion: "完善程序" }[type] || "题目";
}

function renderQuestionBody(question) {
  if (question.type === "program") return renderProgramQuestion(question);
  if (question.type === "reading") return renderCompositeQuestion(question, "阅读程序");
  if (question.type === "completion") return renderCompositeQuestion(question, "完善程序");
  return renderObjectiveQuestion(question);
}

function renderObjectiveQuestion(question, answerId = question.id, number = "") {
  const options = question.type === "judge"
    ? [{ label: "A. 正确", value: "true" }, { label: "B. 错误", value: "false" }]
    : (question.choices || []).map((choice, index) => ({ prefix: String.fromCharCode(65 + index), label: choice, value: String(index) }));
  const inputType = question.type === "multi" ? "checkbox" : "radio";
  return `
    <div data-objective-id="${answerId}" data-objective-type="${question.type}">
    ${number ? `<h3>${escapeHtml(number)}</h3>` : ""}
    <div class="stem rich-text">${renderMarkdown(question.stem)}</div>
    <div class="options">
      ${options.map((option) => `<label class="option" data-option="${answerId}:${option.value}"><input type="${inputType}" name="${answerId}" value="${option.value}"><span class="option-content">${option.prefix ? `<span class="option-prefix">${option.prefix}.</span><span class="rich-text">${renderMarkdown(option.label)}</span>` : `<span>${escapeHtml(option.label)}</span>`}</span></label>`).join("")}
    </div>
    <div class="score-box" hidden data-explain="${answerId}"></div>
    </div>
  `;
}

function renderCompositeQuestion(question, label) {
  return `
    <div class="rich-text">${renderMarkdown(question.statement || "")}</div>
    ${question.code ? renderCodeBlock(question.code, ' data-lang="cpp"') : ""}
    <div class="subquestion-list">
      ${(question.subquestions || []).map((subquestion, index) => renderObjectiveQuestion(subquestion, objectiveAnswerId(question, subquestion), `${label}小题 ${index + 1}`)).join("")}
    </div>
  `;
}

function renderProgramQuestion(question) {
  const submitPanel = state.programSubmissionEnabled
    ? `<textarea class="code-editor" id="code-${question.id}" spellcheck="false">${escapeHtml(defaultCode())}</textarea>
        <div class="submit-row"><button class="primary-btn" type="button" data-run-code="${question.id}">提交代码</button></div>
        <div class="score-box" id="result-${question.id}"><div class="muted">提交后会编译 C++，并运行样例与测试点。</div></div>`
    : `<div class="score-box"><div class="muted">编程题提交暂时关闭，待运行沙箱配置完成后再开放。</div></div>`;
  return `
    <div class="program-grid">
      <div>
        <h2>${escapeHtml(question.title)}</h2>
        <div class="rich-text">${renderMarkdown(question.statement)}</div>
        <h3>输入格式</h3><div class="rich-text">${renderMarkdown(question.input)}</div>
        <h3>输出格式</h3><div class="rich-text">${renderMarkdown(question.output)}</div>
        <h3>样例</h3>
        ${(question.samples || []).map((sample, index) => `<div class="sample"><strong>样例 #${index + 1}</strong><div>输入</div><pre>${escapeHtml(sample.input)}</pre><div>输出</div><pre>${escapeHtml(sample.output)}</pre></div>`).join("")}
      </div>
      <div>
        ${submitPanel}
      </div>
    </div>
  `;
}

function defaultCode() {
  return `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    return 0;
}
`;
}

function updateAnswerCard() {
  document.querySelectorAll("[data-question]").forEach((item) => {
    const id = item.dataset.question;
    const type = item.dataset.type;
    const card = document.querySelector(`[data-card="${id}"]`);
    if (!card) return;
    const done = type === "program"
      ? (document.querySelector(`#code-${id}`)?.value || "").replace(defaultCode(), "").trim().length > 0
      : isCompositeType(type)
        ? Array.from(item.querySelectorAll("[data-objective-id]")).every((objective) => isAnswerComplete(objective.dataset.objectiveId, objective.dataset.objectiveType))
        : isAnswerComplete(id, type);
    card.classList.toggle(type === "program" ? "program-done" : "done", done);
  });
}

async function submitObjective(paperId) {
  if (!state.user) {
    openAuth();
    notify("请先登录再提交。");
    return;
  }
  const items = document.querySelectorAll("[data-objective-id]");
  let total = 0, answered = 0, unanswered = 0;
  items.forEach((item) => {
    total += 1;
    if (isAnswerComplete(item.dataset.objectiveId, item.dataset.objectiveType)) {
      answered += 1;
    } else {
      unanswered += 1;
    }
  });
  if (unanswered > 0) {
    submitStats.innerHTML = `
      <div class="submit-warning">
        <strong>⚠ 还有 ${unanswered} 道题未作答</strong>
        <p>未作答的题目将计 0 分。确定要提交吗？</p>
      </div>
      <div class="submit-counts">
        <span>已作答：<strong>${answered}</strong></span>
        <span>未作答：<strong class="unanswered-count">${unanswered}</strong></span>
        <span>共 <strong>${total}</strong> 题</span>
      </div>
    `;
  } else {
    submitStats.innerHTML = `
      <div class="submit-all-answered">全部 <strong>${total}</strong> 道题已作答，确认提交？</div>
    `;
  }
  pendingSubmitPaperId = paperId;
  submitConfirmDialog.showModal();
}

async function doSubmitObjective(paperId) {
  const answers = {};
  document.querySelectorAll("[data-objective-id]").forEach((item) => {
    const value = answerValues(item.dataset.objectiveId, item.dataset.objectiveType);
    if (Array.isArray(value) ? value.length : value !== "") {
      answers[item.dataset.objectiveId] = value;
    }
  });
  try {
    const data = await api("/api/submit-objective", { method: "POST", body: { paperId, answers } });
    state.attempts.unshift(data.attempt);
    const correctCount = data.details.filter((item) => item.correct).length;
    const wrongCount = data.details.length - correctCount;
    document.querySelector("#scoreBox").innerHTML = `
      <div class="score-summary ${scoreLevel(data.score, data.fullScore)}">
        <div>
          <span>成绩</span>
          <strong>${percent(data.score, data.fullScore)}<small>%</small></strong>
        </div>
        <p>${data.score} / ${data.fullScore} 分</p>
      </div>
      <div class="score-metrics">
        <span class="status-ok">正确 ${correctCount}</span>
        <span class="status-bad">错误 ${wrongCount}</span>
        <span class="muted">共 ${data.details.length} 题</span>
      </div>
      <div class="muted">已保存到练习记录。</div>
    `;
    applyObjectiveResult(data.details);
    clearPaperDraft(paperId);
    notify("提交完成。");
  } catch (error) {
    notify(error.message);
  }
}

function applyObjectiveResult(details) {
  details.forEach((detail) => {
    const explain = document.querySelector(`[data-explain="${detail.id}"]`);
    if (explain) {
      explain.hidden = false;
      explain.innerHTML = `<div class="${detail.correct ? "status-ok" : "status-bad"}">${detail.correct ? "回答正确" : "回答错误"}</div><div class="rich-text">${renderMarkdown(detail.explanation || "")}</div>`;
      typesetMath(explain);
    }
    document.querySelectorAll(`[data-option^="${detail.id}:"]`).forEach((option) => {
      const value = option.dataset.option.split(":")[1];
      const answers = Array.isArray(detail.answer) ? detail.answer.map(String) : [String(detail.answer)];
      const userAnswers = Array.isArray(detail.userAnswer) ? detail.userAnswer.map(String) : [String(detail.userAnswer)];
      option.classList.toggle("correct", answers.includes(value));
      option.classList.toggle("wrong", !detail.correct && userAnswers.includes(value) && !answers.includes(value));
    });
  });
}

async function submitCode(paperId, questionId) {
  if (!state.programSubmissionEnabled) {
    notify("编程题提交暂时关闭。");
    return;
  }
  if (!state.user) {
    openAuth();
    notify("请先登录再提交代码。");
    return;
  }
  const editor = document.querySelector(`#code-${questionId}`);
  const resultBox = document.querySelector(`#result-${questionId}`);
  resultBox.innerHTML = `<span class="status-warn">正在编译和评测...</span>`;
  try {
    const data = await api("/api/submit-code", { method: "POST", body: { paperId, questionId, code: editor.value } });
    state.attempts.unshift(data.attempt);
    resultBox.innerHTML = renderJudgeResult(data.result);
    notify(data.result.message || "评测完成。");
  } catch (error) {
    resultBox.innerHTML = `<span class="status-bad">${escapeHtml(error.message)}</span>`;
  }
}

function renderJudgeResult(result) {
  if (result.status === "compile_error" || result.status === "error" || result.status === "compile_timeout") {
    return `<div class="status-bad">${escapeHtml(result.message)}</div>${result.status === "compile_error" ? `<pre class="result-output">${escapeHtml(result.message)}</pre>` : ""}`;
  }
  const cls = result.status === "accepted" ? "status-ok" : "status-bad";
  return `<div class="${cls}">${escapeHtml(result.message)} ${result.passed}/${result.total}</div>${(result.results || []).map((item) => `<div class="sample"><strong>${item.sample ? "样例" : "测试点"} #${item.index}：${item.passed ? "通过" : "未通过"}</strong>${item.passed ? "" : `<div>期望输出</div><pre>${escapeHtml(item.expected)}</pre><div>实际输出</div><pre>${escapeHtml(item.actual || item.stderr || "")}</pre>`}</div>`).join("")}`;
}

async function renderStudy() {
  if (!state.user) {
    app.innerHTML = `<div class="grid"><section class="panel empty"><p>登录后可以查看学习进度、作业和错题。</p><button class="primary-btn" type="button" data-open-auth>登　录</button></section></div>`;
    document.querySelector("[data-open-auth]")?.addEventListener("click", openAuth);
    return;
  }
  let summary = { totals: { attempts: 0, assignments: 0, pendingAssignments: 0, wrongQuestions: 0 }, assignments: [], pendingAssignments: [], completedAssignments: [], wrongQuestions: [], progress: [], pagination: {} };
  try {
    const params = new URLSearchParams({
      completedPage: String(state.study.completedPage || 1),
      wrongPage: String(state.study.wrongPage || 1)
    });
    summary = await api(`/api/student/summary?${params.toString()}`);
  } catch (error) {
    notify(error.message);
  }
  const pendingAssignments = summary.pendingAssignments || summary.assignments.filter((item) => !item.done);
  const completedAssignments = summary.completedAssignments || summary.assignments.filter((item) => item.done);
  const activeTab = state.study.activeTab || "pending";

  const renderTabContent = () => {
    if (activeTab === "pending") {
      return `
        <div class="panel">
          <div class="panel-head"><h2>待完成作业</h2><span class="muted">${pendingAssignments.length} 个</span></div>
          <ul class="paper-list">
            ${pendingAssignments.map((item) => `<li class="paper-item"><span class="paper-icon">作业</span><div><h3><a href="#/paper/${item.paperId}">${escapeHtml(item.title)}</a></h3><div class="meta"><span>${escapeHtml(item.className)}</span><span>${assignmentStatusText(item)}</span><span>${assignmentTimeText(item)}</span><span>${item.bestObjective ? renderScoreBadge(item.bestObjective.score, item.bestObjective.fullScore, "客观题") : "客观题未提交"}</span><span>编程题 ${item.acceptedPrograms}/${item.programTotal}</span></div></div><a class="${item.status === "open" ? "primary-btn" : "secondary-btn"}" href="#/paper/${item.paperId}?assignmentId=${item.id}">${item.status === "not_started" ? "预览" : "去完成"}</a></li>`).join("") || `<li class="empty">暂无待完成作业</li>`}
          </ul>
        </div>`;
    }
    if (activeTab === "completed") {
      return `
        <div class="panel">
          <div class="panel-head"><h2>已完成作业</h2><span class="muted">${summary.pagination?.completedAssignments?.total ?? completedAssignments.length} 个</span></div>
          <div class="panel-body"><ul class="completed-assignment-list">${completedAssignments.map(renderCompletedAssignmentItem).join("") || `<li class="muted">暂无</li>`}</ul>${renderPager(summary.pagination?.completedAssignments, "study-completed")}</div>
        </div>`;
    }
    return `
      <div class="panel">
        <div class="panel-head"><h2>错题本</h2><span class="muted">${summary.pagination?.wrongQuestions?.total ?? summary.wrongQuestions.length} 题</span></div>
        <div class="panel-body wrong-list">${renderWrongBook(summary.wrongQuestions)}${renderPager(summary.pagination?.wrongQuestions, "study-wrong")}</div>
      </div>`;
  };

  app.innerHTML = `
    <div class="grid">
      <section>
        <div class="panel">
          <div class="panel-head"><h1>学习中心</h1><span class="muted">${escapeHtml(state.user.username)}</span></div>
          <div class="panel-body stat-grid">
            ${statCard("提交次数", summary.totals.attempts)}
            ${statCard("班级作业", summary.totals.assignments)}
            ${statCard("待完成", summary.totals.pendingAssignments)}
            ${statCard("错题", summary.totals.wrongQuestions)}
          </div>
        </div>
        <div class="study-tabs">
          <button class="study-tab-btn ${activeTab === "pending" ? "active" : ""}" type="button" data-study-tab="pending">待完成作业</button>
          <button class="study-tab-btn ${activeTab === "completed" ? "active" : ""}" type="button" data-study-tab="completed">已完成作业</button>
          <button class="study-tab-btn ${activeTab === "wrong" ? "active" : ""}" type="button" data-study-tab="wrong">错题本</button>
        </div>
        ${renderTabContent()}
      </section>
      <aside class="side-stack">
        <div class="panel">
          <div class="panel-head"><h2>等级进度</h2></div>
          <div class="panel-body">
            ${summary.progress.map((item) => {
              const percent = item.total ? Math.round((item.practiced / item.total) * 100) : 0;
              return `<div class="progress-row"><div><strong>${item.level} 级</strong><span class="muted">${item.practiced}/${item.total}</span></div><div class="progress-bar"><span style="width:${percent}%"></span></div></div>`;
            }).join("")}
          </div>
        </div>
      </aside>
    </div>
  `;
  document.querySelectorAll("[data-study-tab]").forEach((button) => button.addEventListener("click", () => {
    state.study.activeTab = button.dataset.studyTab;
    state.study.completedPage = 1;
    state.study.wrongPage = 1;
    renderStudy();
  }));
  document.querySelectorAll("[data-page-target^='study-']").forEach((button) => button.addEventListener("click", () => {
    const page = Math.max(1, Number(button.dataset.page || 1));
    if (button.dataset.pageTarget === "study-completed") state.study.completedPage = page;
    if (button.dataset.pageTarget === "study-wrong") state.study.wrongPage = page;
    renderStudy();
  }));
  typesetMath(app);
}

function renderWrongBook(items) {
  if (!items.length) return `<div class="empty">还没有错题，保持住。</div>`;
  const groups = new Map();
  items.forEach((item) => {
    if (!groups.has(item.paperId)) groups.set(item.paperId, { title: item.paperTitle, items: [] });
    groups.get(item.paperId).items.push(item);
  });
  return Array.from(groups.entries()).map(([paperId, group]) => `
    <details class="wrong-group" open>
      <summary><span>${escapeHtml(group.title)}</span><span class="muted">${group.items.length} 题</span></summary>
      <div class="wrong-group-body">${group.items.map((item, index) => renderWrongQuestion(item, index)).join("")}</div>
    </details>
  `).join("");
}

function renderWrongQuestion(item, index = 0) {
  return `<details class="wrong-item"><summary><div><strong>${index + 1}. ${escapeHtml(questionTypeName(item.type))}</strong><div class="wrong-stem-preview rich-text">${renderMarkdown(item.stem)}</div><div class="meta"><span>你的答案：${escapeHtml(formatAnswer(item, item.userAnswer))}</span><span>正确答案：${escapeHtml(formatAnswer(item, item.answer))}</span></div></div><a class="secondary-btn" href="#/paper/${item.paperId}">重练</a></summary><div class="wrong-detail">${item.choices?.length ? `<ol class="choice-list">${item.choices.map((choice, choiceIndex) => `<li><span class="option-prefix">${String.fromCharCode(65 + choiceIndex)}.</span><span class="rich-text">${renderMarkdown(choice)}</span></li>`).join("")}</ol>` : ""}<div class="score-box rich-text">${renderMarkdown(item.explanation || "暂无解析")}</div></div></details>`;
}

function formatAnswer(item, value) {
  if (item.type === "judge") return value === true || value === "true" ? "正确" : "错误";
  if (item.type === "multi") {
    const values = Array.isArray(value) ? value : [value];
    return values.map((entry) => String.fromCharCode(65 + Number(entry))).join("、") || "-";
  }
  const index = Number(value);
  return Number.isFinite(index) ? String.fromCharCode(65 + index) : "-";
}

function assignmentScoreBadge(item) {
  if (!item.bestObjective) return `<span class="assignment-score muted">未提交</span>`;
  const { score, fullScore } = item.bestObjective;
  return `<span class="assignment-score ${scoreLevel(score, fullScore)}"><strong>${score}/${fullScore}</strong><small>${percent(score, fullScore)}%</small></span>`;
}

function renderCompletedAssignmentItem(item) {
  return `
    <li class="completed-assignment-item">
      <div class="completed-assignment-left">
        <div class="completed-assignment-header">
          <a class="completed-assignment-title" href="#/paper/${item.paperId}">${escapeHtml(item.title)}</a>
          <span class="completed-assignment-class muted">${escapeHtml(item.className)}</span>
        </div>
        <div class="completed-assignment-times">
          ${item.startAt ? `<div class="muted">开始 ${escapeHtml(item.startAt.replace("T", " "))}</div>` : ""}
          ${item.endAt || item.dueAt ? `<div class="muted">结束 ${escapeHtml((item.endAt || item.dueAt).replace("T", " "))}</div>` : ""}
          ${!item.startAt && !item.endAt && !item.dueAt ? `<div class="muted">长期</div>` : ""}
        </div>
      </div>
      <div class="completed-assignment-right">
        ${assignmentScoreBadge(item)}
        <a class="secondary-btn compact-action" href="#/paper/${item.paperId}">再次做题</a>
      </div>
    </li>
  `;
}

function renderClassAssignmentItem(item) {
  const isTeacherRole = state.user && (state.user.role === "teacher" || state.user.role === "admin");
  if (isTeacherRole) {
    return `
      <li class="class-assignment-item">
        <div class="class-assignment-main">
          <a class="class-assignment-title" href="#/paper/${item.paperId}">${escapeHtml(item.paperTitle || item.title)}</a>
          <div class="meta"><span>${assignmentTimeText(item)}</span></div>
        </div>
        <a class="primary-btn compact-action" href="#/paper/${item.paperId}">查看试卷</a>
      </li>
    `;
  }
  return `
    <li class="class-assignment-item">
      <div class="class-assignment-main">
        <a class="class-assignment-title" href="#/paper/${item.paperId}?assignmentId=${item.id}">${escapeHtml(item.paperTitle || item.title)}</a>
        <div class="meta"><span>${assignmentTimeText(item)}</span>${item.bestObjective ? `<span>已答 ${assignmentScoreText(item)}</span>` : `<span>未答题</span>`}</div>
      </div>
      ${assignmentScoreBadge(item)}
      <a class="primary-btn compact-action" href="#/paper/${item.paperId}?assignmentId=${item.id}">${item.bestObjective ? "再次做题" : "去完成"}</a>
    </li>
  `;
}

function renderDashboard() {
  if (!state.user) {
    app.innerHTML = `<div class="grid"><section class="panel empty"><p>登录后可以查看练习记录。</p><button class="primary-btn" type="button" data-open-auth>登　录</button></section></div>`;
    document.querySelector("[data-open-auth]")?.addEventListener("click", openAuth);
    return;
  }
  const attemptMeta = state.dashboard.attemptsPagination || { total: state.attempts.length };
  app.innerHTML = `
    <div class="grid">
      <section class="panel">
        <div class="panel-head"><h1>练习记录</h1><span class="muted">${escapeHtml(state.user.username)} · ${roleName(state.user.role)}</span></div>
        ${state.attempts.length ? `<div class="panel-body"><table class="history-table"><thead><tr><th>时间</th><th>试卷</th><th>类型</th><th>结果</th></tr></thead><tbody>${state.attempts.map(renderAttemptRow).join("")}</tbody></table>${renderPager(state.dashboard.attemptsPagination, "dashboard-attempts")}</div>` : `<div class="empty">还没有提交记录</div>`}
      </section>
      <aside class="side-stack"><div class="panel"><div class="panel-head"><h2>学习进度</h2></div><div class="panel-body"><p class="muted">提交次数：${attemptMeta.total}</p><p class="muted">已加入班级：${state.classes.length}</p><a class="secondary-btn" href="#/study">进入学习中心</a></div></div></aside>
    </div>
  `;
  document.querySelectorAll("[data-page-target='dashboard-attempts']").forEach((button) => button.addEventListener("click", async () => {
    state.dashboard.attemptsPage = Math.max(1, Number(button.dataset.page || 1));
    await refreshMe();
    renderDashboard();
  }));
}

function renderAttemptRow(attempt) {
  const time = new Date(attempt.createdAt).toLocaleString("zh-CN", { hour12: false });
  const type = attempt.type === "objective" ? "客观题" : "编程题";
  const result = attempt.type === "objective" ? renderScoreBadge(attempt.score, attempt.fullScore) : renderProgramStatus(attempt);
  return `<tr><td>${escapeHtml(time)}</td><td><a href="#/paper/${attempt.paperId}">${escapeHtml(attempt.paperTitle)}</a>${attempt.questionTitle ? `<div class="muted">${escapeHtml(attempt.questionTitle)}</div>` : ""}</td><td>${type}</td><td>${result}</td></tr>`;
}

function renderProgramStatus(attempt) {
  const accepted = attempt.status === "accepted";
  return `<span class="program-status ${accepted ? "accepted" : "failed"}">${accepted ? "通过" : attempt.status} ${attempt.passed}/${attempt.total}</span>`;
}

function renderPager(meta, target) {
  if (!meta || Number(meta.totalPages || 1) <= 1) return "";
  const page = Number(meta.page || 1);
  const totalPages = Number(meta.totalPages || 1);
  return `
    <div class="pager-row">
      <button class="secondary-btn" type="button" data-page-target="${target}" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button>
      <span class="muted">第 ${page}/${totalPages} 页 · 共 ${Number(meta.total || 0)} 条</span>
      <button class="secondary-btn" type="button" data-page-target="${target}" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>下一页</button>
    </div>
  `;
}

async function renderClasses() {
  if (!state.user) {
    app.innerHTML = `<div class="grid"><section class="panel empty"><p>登录后可以加入班级和查看作业。</p><button class="primary-btn" type="button" data-open-auth>登　录</button></section></div>`;
    document.querySelector("[data-open-auth]")?.addEventListener("click", openAuth);
    return;
  }
  let data = { classes: state.classes, assignments: [] };
  try {
    data = await api("/api/classes");
    state.classes = data.classes || [];
  } catch (error) {
    notify(error.message);
  }
  const selectedId = (location.hash || "").startsWith("#/classes/") ? decodeURIComponent((location.hash || "").replace("#/classes/", "")) : "";
  const selectedClass = selectedId ? state.classes.find((klass) => klass.id === selectedId) || null : null;
  const classAssignments = selectedClass ? (data.assignments || []).filter((item) => item.classId === selectedClass.id) : [];
  if (selectedClass) {
    app.innerHTML = `
      <section class="panel">
        <div class="panel-head"><h1>${escapeHtml(selectedClass.name)}</h1><a class="secondary-btn compact-action" href="#/classes">返回班级</a></div>
        <div class="panel-body">
          <div class="meta"><span>${escapeHtml(selectedClass.categoryName || categoryName(selectedClass.category))}</span><span>教师 ${escapeHtml(selectedClass.teacherName)}</span><span>学生 ${selectedClass.studentCount}</span><span>作业 ${classAssignments.length}</span></div>
          <div class="class-detail-block"><h2>作业列表</h2><ul class="class-assignment-list">${classAssignments.map(renderClassAssignmentItem).join("") || `<li class="muted">这个班级还没有发布作业</li>`}</ul></div>
        </div>
      </section>
    `;
    return;
  }
  app.innerHTML = `
    <section class="panel">
        <div class="panel-head"><h1>我的班级</h1><span class="muted">${state.classes.length} 个班级</span></div>
        <div class="panel-body">
          <div class="form-grid"><input id="joinCode" placeholder="输入教师给的邀请码"><button class="primary-btn" type="button" id="joinClass">加入班级</button></div>
          <ul class="paper-list" style="margin-top: 14px;">${state.classes.map((klass) => `<li class="paper-item ${selectedClass?.id === klass.id ? "active" : ""}"><span class="paper-icon">${examTypeById(klass.category).levelEnabled ? `${klass.level}级` : "初赛"}</span><div><h3><a href="#/classes/${encodeURIComponent(klass.id)}">${escapeHtml(klass.name)}</a></h3><div class="meta"><span>${escapeHtml(klass.categoryName || categoryName(klass.category))}</span><span>教师 ${escapeHtml(klass.teacherName)}</span><span>学生 ${klass.studentCount}</span><span>作业 ${klass.assignmentCount}</span></div></div><a class="secondary-btn" href="#/classes/${encodeURIComponent(klass.id)}">查看作业</a></li>`).join("") || `<li class="empty">还没有加入班级</li>`}</ul>
        </div>
    </section>
  `;
  document.querySelector("#joinClass").addEventListener("click", joinClass);
}

async function joinClass() {
  try {
    await api("/api/classes/join", { method: "POST", body: { inviteCode: document.querySelector("#joinCode").value } });
    await refreshMe();
    notify("加入班级成功。");
    renderClasses();
  } catch (error) {
    notify(error.message);
  }
}

async function renderManage(options = {}) {
  if (!isTeacher()) {
    app.innerHTML = `<div class="panel empty">这里需要教师或管理员权限。</div>`;
    return;
  }
  const routeClassId = (location.hash || "").startsWith("#/manage/classes/")
    ? decodeURIComponent((location.hash || "").replace("#/manage/classes/", "").split("?")[0])
    : "";
  const routeParams = new URLSearchParams((location.hash || "").split("?")[1] || "");
  if (!routeClassId && routeParams.get("tab")) state.manage.tab = routeParams.get("tab");
  const shouldFetch = !options.skipFetch || !state.manage._dataLoaded;
  try {
    if (shouldFetch) {
      const overviewParams = new URLSearchParams({
        attemptsPage: String(state.manage.overviewAttemptsPage || 1)
      });
      const userParams = new URLSearchParams({
        usersPage: String(state.manage.usersPagination?.page || 1)
      });
      const studentParams = new URLSearchParams({
        studentsPage: String(state.manage.studentsPagination?.page || 1)
      });
      const [overview, paperData, users, studentData] = await Promise.all([
        api(`/api/teacher/overview?${overviewParams.toString()}`),
        api("/api/admin/papers"),
        isAdmin() ? api(`/api/admin/users?${userParams.toString()}`) : Promise.resolve({ users: [], teachers: [], pagination: {} }),
        api(`/api/teacher/students?${studentParams.toString()}`)
      ]);
      state.manage.overview = overview;
      state.manage.papers = paperData.papers || [];
      state.manage.users = users.users || [];
      state.manage.userTeachers = users.teachers || [];
      state.manage.usersPagination = users.pagination?.users || null;
      state.manage.students = studentData.students || [];
      state.manage.studentsPagination = studentData.pagination?.students || null;
      state.manage._dataLoaded = true;
    }
    if (routeClassId) {
      state.manage.tab = "classes";
      if (routeParams.get("tab")) state.manage.classDetailTab = routeParams.get("tab");
      if (state.manage.classReport?.class?.id !== routeClassId) {
        state.manage.classReportPages = { studentsPage: 1, attemptsPage: 1 };
        if (!routeParams.get("tab")) state.manage.classDetailTab = "students";
      }
      const pages = state.manage.classReportPages || { studentsPage: 1, attemptsPage: 1 };
      const params = new URLSearchParams({
        studentsPage: String(pages.studentsPage || 1),
        attemptsPage: String(pages.attemptsPage || 1)
      });
      state.manage.classReport = await api(`/api/classes/${encodeURIComponent(routeClassId)}/report?${params.toString()}`);
    } else if (!(location.hash || "").startsWith("#/manage/classes/")) {
      state.manage.classReport = null;
    }
  } catch (error) {
    notify(error.message);
  }

  const overview = state.manage.overview || { totals: {}, classes: [], assignments: [], recentAttempts: [] };
  state.manage.editPaper ||= samplePaper();
  const tab = state.manage.tab || "papers";
  app.innerHTML = `
    <section class="manage-shell">
      <div class="panel">
        <div class="panel-head"><h1>教学管理台</h1><div class="submit-row"><a class="secondary-btn" href="#/guide">使用说明</a><span class="muted">${roleName(state.user.role)}</span></div></div>
        <div class="panel-body stat-grid">${statCard("试卷", overview.totals.papers || 0)}${statCard("班级", overview.totals.classes || 0)}${statCard("学生", overview.totals.students || 0)}${statCard("提交", overview.totals.attempts || 0)}</div>
      </div>
      <div class="manage-tabs" role="tablist">
        ${manageTabButton("papers", "试卷题库", tab)}
        ${manageTabButton("classes", "班级管理", tab)}
        ${manageTabButton("settings", "系统设置", tab)}
      </div>
      <div class="manage-section" ${tab === "papers" ? "" : "hidden"}>${renderManagePapersSection()}</div>
      <div class="manage-section" ${tab === "classes" ? "" : "hidden"}>${renderManageClassesSection(overview)}</div>
      <div class="manage-section" ${tab === "settings" ? "" : "hidden"}>${renderManageSettingsSection()}</div>
    </section>
  `;
  document.querySelectorAll("[data-manage-tab]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.manageTab !== "classes" && (location.hash || "").startsWith("#/manage/classes/")) {
      history.replaceState(null, "", "#/manage");
    }
    state.manage.tab = button.dataset.manageTab;
    renderManage({ skipFetch: true });
  }));
  document.querySelector("#backPaperList")?.addEventListener("click", showPaperList);
  document.querySelector("#newPaper")?.addEventListener("click", createNewPaper);
  document.querySelectorAll("[data-paper-editor-action='save']").forEach((button) => button.addEventListener("click", savePaperFromEditor));
  document.querySelectorAll("[data-paper-editor-action='sync-json']").forEach((button) => button.addEventListener("click", syncBuilderToJson));
  document.querySelector("#paperCategoryInput")?.addEventListener("change", () => {
    const examType = examTypeById(document.querySelector("#paperCategoryInput").value);
    document.querySelector("#paperLevelField").hidden = !examType.levelEnabled;
  });
  document.querySelectorAll("[data-add-question]").forEach((button) => button.addEventListener("click", () => addBuilderQuestion(button.dataset.addQuestion)));
  document.querySelectorAll("[data-add-sub-question]").forEach((button) => button.addEventListener("click", () => addSubQuestion(Number(button.dataset.parentQuestion), button.dataset.addSubQuestion)));
  document.querySelectorAll("[data-remove-sub-question]").forEach((button) => button.addEventListener("click", () => removeSubQuestion(Number(button.dataset.parentQuestion), Number(button.dataset.removeSubQuestion))));
  document.querySelectorAll("[data-remove-question]").forEach((button) => button.addEventListener("click", () => removeBuilderQuestion(Number(button.dataset.removeQuestion))));
  document.querySelectorAll("[data-insert-markdown]").forEach((button) => button.addEventListener("click", () => insertMarkdownSnippet(button)));
  document.querySelectorAll("[data-jump-builder-question]").forEach((button) => button.addEventListener("click", () => jumpToBuilderQuestion(Number(button.dataset.jumpBuilderQuestion))));
  document.querySelectorAll("[data-apply-score]").forEach((button) => button.addEventListener("click", () => applyBulkScore(button.dataset.applyScore)));
  document.querySelectorAll("[data-edit-paper]").forEach((button) => button.addEventListener("click", () => loadPaperIntoEditor(button.dataset.editPaper)));
  document.querySelectorAll("[data-delete-paper]").forEach((button) => button.addEventListener("click", () => deletePaperById(button.dataset.deletePaper)));
  document.querySelectorAll("[data-toggle-paper-hidden]").forEach((button) => button.addEventListener("click", () => togglePaperHidden(button.dataset.togglePaperHidden)));
  document.querySelector("#selectAllPapers")?.addEventListener("change", toggleAllPapers);
  document.querySelector("#hideSelectedPapers")?.addEventListener("click", () => setSelectedPapersVisibility(true));
  document.querySelector("#showSelectedPapers")?.addEventListener("click", () => setSelectedPapersVisibility(false));
  document.querySelector("#deleteSelectedPapers")?.addEventListener("click", deleteSelectedPapers);
  document.querySelector("#exportSelectedPapers")?.addEventListener("click", () => exportPapersToWord(selectedPaperIds()));
  document.querySelector("#exportFilteredPapers")?.addEventListener("click", () => exportPapersToWord(filteredManagePapers().map((paper) => paper.id)));
  document.querySelector("#importWordPaperFile")?.addEventListener("change", importPapersFromWord);
  document.querySelector("#managePaperCategoryFilter")?.addEventListener("change", (event) => {
    state.manage.paperFilter.category = event.target.value;
    renderManage({ skipFetch: true });
  });
  const keywordInput = document.querySelector("#managePaperKeywordFilter");
  if (keywordInput) {
    let keywordTimer;
    keywordInput.addEventListener("input", (event) => {
      window.clearTimeout(keywordTimer);
      keywordTimer = window.setTimeout(() => {
        state.manage.paperFilter.keyword = event.target.value.trim();
        renderManage({ skipFetch: true });
      }, 300);
    });
  }
  document.querySelector("#clearPaperFilter")?.addEventListener("click", () => {
    state.manage.paperFilter = { category: "all", keyword: "" };
    renderManage({ skipFetch: true });
  });
  document.querySelector("#classKeyword")?.addEventListener("input", (event) => {
    state.manage.classKeyword = event.target.value;
  });
  document.querySelector("#classSearchBtn")?.addEventListener("click", () => {
    state.manage.classKeyword = document.querySelector("#classKeyword")?.value || "";
    renderManage({ skipFetch: true });
  });
  document.querySelector("[data-back-class-list]")?.addEventListener("click", (event) => {
    event.preventDefault();
    state.manage.classReport = null;
    state.manage.classDetailTab = "students";
    history.replaceState(null, "", "#/manage");
    renderManage({ skipFetch: true });
  });
  document.querySelector("#exportClassStudents")?.addEventListener("click", exportActiveClassStudents);
  document.querySelectorAll("[data-class-detail-tab]").forEach((button) => button.addEventListener("click", () => {
    state.manage.classDetailTab = button.dataset.classDetailTab;
    renderManage({ skipFetch: true });
  }));
  document.querySelector("#createClass")?.addEventListener("click", createClass);
  document.querySelector("#classCategory")?.addEventListener("change", updateClassLevelVisibility);
  updateClassLevelVisibility();
  document.querySelectorAll("[data-class-report]").forEach((button) => button.addEventListener("click", () => loadClassReport(button.dataset.classReport, { reset: true })));
  document.querySelectorAll("[data-page-target^='report-']").forEach((button) => button.addEventListener("click", () => {
    const page = Math.max(1, Number(button.dataset.page || 1));
    if (button.dataset.pageTarget === "report-students") state.manage.classReportPages.studentsPage = page;
    if (button.dataset.pageTarget === "report-attempts") state.manage.classReportPages.attemptsPage = page;
    const classId = state.manage.classReport?.class?.id;
    if (classId) loadClassReport(classId);
  }));
  document.querySelectorAll("[data-page-target='manage-users']").forEach((button) => button.addEventListener("click", () => {
    state.manage.usersPagination = { ...(state.manage.usersPagination || {}), page: Math.max(1, Number(button.dataset.page || 1)) };
    renderManage();
  }));
  document.querySelectorAll("[data-page-target='manage-students']").forEach((button) => button.addEventListener("click", () => {
    state.manage.studentsPagination = { ...(state.manage.studentsPagination || {}), page: Math.max(1, Number(button.dataset.page || 1)) };
    renderManage();
  }));
  document.querySelector("#createAssignment")?.addEventListener("click", createAssignment);
  document.querySelector("#addSelectedStudents")?.addEventListener("click", () => addStudentsToActiveClass(false));
  document.querySelector("#addAllStudents")?.addEventListener("click", () => addStudentsToActiveClass(true));
  document.querySelector("#createUser")?.addEventListener("click", createUser);
  document.querySelector("#importUsers")?.addEventListener("click", importUsersFromExcel);
  document.querySelector("#createBackup")?.addEventListener("click", createBackup);
  document.querySelector("#saveRegistrationSettings")?.addEventListener("click", saveRegistrationSettings);
  document.querySelector("#refreshBackups")?.addEventListener("click", loadBackups);
  document.querySelectorAll("[data-restore-backup]").forEach((button) => button.addEventListener("click", () => restoreBackup(button.dataset.restoreBackup)));
  document.querySelector("#bindStudentTeacher")?.addEventListener("click", bindStudentTeacher);
  document.querySelector("#resetSelectedPasswords")?.addEventListener("click", resetSelectedPasswords);
  document.querySelector("#resetTeacherStudents")?.addEventListener("click", resetTeacherStudentsPasswords);
  document.querySelector("#exportTeacherStudents")?.addEventListener("click", exportTeacherStudents);
  document.querySelector("#archiveTermButton")?.addEventListener("click", archiveTermData);
  document.querySelector("#refreshArchives")?.addEventListener("click", loadArchives);
  document.querySelectorAll("[data-restore-archive]").forEach((button) => button.addEventListener("click", () => restoreArchive(button.dataset.restoreArchive)));
  document.querySelector("#newRole")?.addEventListener("change", updateUserTeacherField);
  document.querySelector("#bulkRole")?.addEventListener("change", updateUserTeacherField);
  updateUserTeacherField();
  document.querySelector("#saveExamType")?.addEventListener("click", saveExamType);
  document.querySelectorAll("[data-delete-exam-type]").forEach((button) => button.addEventListener("click", () => deleteExamType(button.dataset.deleteExamType)));
  typesetMath(app);
}

function renderGuide() {
  if (!isTeacher()) {
    app.innerHTML = `<div class="panel empty">这里需要教师或管理员权限。</div>`;
    return;
  }
  app.innerHTML = `
    <section class="guide-shell">
      <div class="panel guide-hero">
        <div class="panel-head">
          <div>
            <h1>网站使用说明</h1>
            <p class="muted">面向管理员和教师，覆盖账号、试卷、Word 导入导出、班级、作业、学生端使用和服务器维护。</p>
          </div>
          <a class="secondary-btn" href="#/manage">返回管理台</a>
        </div>
      </div>

      <div class="guide-layout">
        <aside class="guide-nav">
          <button type="button" data-guide-target="guide-start">快速开始</button>
          <button type="button" data-guide-target="guide-roles">账号与角色</button>
          <button type="button" data-guide-target="guide-papers">试卷设置</button>
          <button type="button" data-guide-target="guide-word">Word 导入导出</button>
          <button type="button" data-guide-target="guide-classes">班级与作业</button>
          <button type="button" data-guide-target="guide-students">学生管理</button>
          <button type="button" data-guide-target="guide-student-view">学生端使用</button>
          <button type="button" data-guide-target="guide-ops">更新与备份</button>
          <button type="button" data-guide-target="guide-faq">常见问题</button>
        </aside>

        <div class="guide-content">
          <section class="panel guide-section" id="guide-start">
            <div class="panel-head"><h2>快速开始</h2></div>
            <div class="panel-body">
              <ol class="guide-steps">
                <li><strong>管理员登录。</strong>使用管理员账号进入管理后台，先确认考试类型、教师账号和学生账号是否准备好。</li>
                <li><strong>创建或导入试卷。</strong>可以在“试卷题库”里手动建卷，也可以先导出 Word 模板，线下编辑后再导入。</li>
                <li><strong>创建班级。</strong>在“班级管理”中创建班级，选择考试类型和等级。</li>
                <li><strong>添加学生。</strong>学生可以用邀请码加入，也可以由教师或管理员进入班级后批量添加。</li>
                <li><strong>发布作业。</strong>在班级页右侧“发布作业”选择班级、试卷和截止日期。</li>
                <li><strong>查看班级。</strong>点击班级的“进入班级”，查看学生练习次数、最好成绩、作业和最近答题。</li>
              </ol>
              <p class="guide-note">建议先用一个测试班级完整走一遍流程，确认试卷、作业和学生账号都正常后，再正式给学生使用。</p>
            </div>
          </section>

          <section class="panel guide-section" id="guide-roles">
            <div class="panel-head"><h2>账号与角色</h2></div>
            <div class="panel-body">
              <h3>管理员</h3>
              <p>管理员拥有全部管理能力：创建教师、学生和管理员账号，维护考试类型，管理全部试卷，查看全部班级，并能把任意学生添加到任意班级。</p>
              <h3>教师</h3>
              <p>教师可以创建和维护试卷、创建自己的班级、发布作业、查看自己班级的学情，并把自己名下学生批量添加到班级。</p>
              <h3>学生</h3>
              <p>学生可以浏览未隐藏试卷、参加练习、查看记录、加入班级、查看班级作业和修改自己的密码。学生端不会显示班级邀请码。</p>
              <h3>修改密码</h3>
              <p>登录后点击右上角账号菜单里的“修改密码”，输入当前密码和新密码即可。管理员不需要知道学生当前密码，也建议不要长期共用默认密码。</p>
            </div>
          </section>

          <section class="panel guide-section" id="guide-papers">
            <div class="panel-head"><h2>试卷设置</h2></div>
            <div class="panel-body">
              <h3>试卷基础信息</h3>
              <ul>
                <li><strong>试卷 ID：</strong>每套试卷唯一标识。导入 Word 时，如果 ID 已存在会更新原试卷；如果不存在会新建试卷。</li>
                <li><strong>标题：</strong>学生端和管理端显示的试卷名称，建议包含考试类型、等级、年份或专题。</li>
                <li><strong>考试类型：</strong>如 GESP、CSP-J 初赛、CSP-S 初赛。GESP 支持等级，CSP-J/S 一般不需要等级。</li>
                <li><strong>等级：</strong>仅在该考试类型启用等级时显示，范围为 1-8。</li>
                <li><strong>年份、月份、语言、说明：</strong>用于检索、展示和区分试卷版本。</li>
              </ul>
              <h3>题型说明</h3>
              <ul>
                <li><strong>单选题：</strong>设置 4 个或更多选项，答案为一个选项。</li>
                <li><strong>多选题：</strong>可设置多个正确选项，学生必须选中完整答案才得分。</li>
                <li><strong>判断题：</strong>答案为“正确”或“错误”，未作答会按 0 分处理。</li>
                <li><strong>阅读程序题 / 完善程序题：</strong>属于复合题，先填写题面和代码，再添加判断、单选或多选子题。</li>
                <li><strong>编程题：</strong>当前默认关闭提交入口，待运行沙箱配置完成后再开放。</li>
              </ul>
              <h3>编辑建议</h3>
              <ul>
                <li>题目 ID 在同一套试卷内应保持唯一，方便错题本、提交记录和后续更新定位。</li>
                <li>分值可以在建卷页面用“批量修改分值”工具统一设置。</li>
                <li>题干、选项和解析支持 Markdown，可插入代码块、图片链接和数学公式。</li>
                <li>试卷暂时不想给学生看到时，使用“隐藏”功能，不要直接删除。</li>
              </ul>
            </div>
          </section>

          <section class="panel guide-section" id="guide-word">
            <div class="panel-head"><h2>Word 导入导出</h2></div>
            <div class="panel-body">
              <h3>导出 Word</h3>
              <ol class="guide-steps">
                <li>进入“管理台 - 试卷题库”。</li>
                <li>勾选需要导出的试卷，点击“导出选中 Word”；也可以先按考试类型或名称筛选，再点击“导出筛选结果”。</li>
                <li>系统会下载 <code>.docx</code> 文件，教师可以在 Word 或 WPS 中编辑。</li>
              </ol>
              <h3>导入 Word</h3>
              <ol class="guide-steps">
                <li>建议先导出一份系统 Word 模板，再在模板基础上复制和改题。</li>
                <li>保留关键标签，例如“试卷ID:”“标题:”“题型:”“题目ID:”“题干:”“选项:”“答案:”“解析:”。</li>
                <li>回到“试卷题库”，点击“导入 Word”，选择编辑后的 <code>.docx</code> 文件。</li>
                <li>导入时，同 ID 试卷会更新；不存在的 ID 会新建。</li>
              </ol>
              <h3>Word 编写规则</h3>
              <ul>
                <li>每套试卷必须有“试卷ID”和“标题”。</li>
                <li>每道题用“--- 题目 1 ---”这类分隔行开始，后面填写题型、题目 ID、分值等信息。</li>
                <li>单选和多选的选项建议写成 <code>A. 内容</code>、<code>B. 内容</code>、<code>C. 内容</code>、<code>D. 内容</code>。</li>
                <li>单选答案可写 <code>A</code> 或 <code>1</code>；多选答案可写 <code>A, C</code>；判断题答案写“正确”或“错误”。</li>
                <li>如果导入失败，通常是关键标签被删除或试卷 ID/标题为空。可以重新导出模板，对照格式修改。</li>
              </ul>
            </div>
          </section>

          <section class="panel guide-section" id="guide-classes">
            <div class="panel-head"><h2>班级与作业</h2></div>
            <div class="panel-body">
              <h3>创建班级</h3>
              <p>进入“班级管理”，填写班级名称，选择考试类型和等级后点击“创建班级”。每个班级会自动生成邀请码，邀请码仅教师和管理员可见。</p>
              <h3>学生加入班级</h3>
              <ul>
                <li><strong>学生自行加入：</strong>教师把邀请码发给学生，学生进入“班级”页面输入邀请码。</li>
                <li><strong>教师批量添加：</strong>进入某个班级，在“添加学生到班级”中勾选学生或点击“添加全部可选学生”。</li>
              </ul>
              <h3>发布作业</h3>
              <ol class="guide-steps">
                <li>在“班级管理”进入某个班级后，找到“发布作业”。</li>
                <li>选择班级和试卷，按需要设置截止日期。</li>
                <li>点击“发布作业”。学生进入该班级后即可看到该班级作业。</li>
              </ol>
              <h3>查看班级</h3>
              <p>点击班级列表中的“进入班级”，可以看到学生数量、作业数量、答题次数、学生练习数据、已发布作业和最近答题记录。</p>
            </div>
          </section>

          <section class="panel guide-section" id="guide-students">
            <div class="panel-head"><h2>学生管理</h2></div>
            <div class="panel-body">
              <h3>单个创建学生</h3>
              <p>管理员进入“系统设置 - 用户管理”，填写账号、初始密码，角色选择“学生”。如果需要让某位教师管理该学生，请选择“所属老师”。</p>
              <h3>批量导入学生</h3>
              <p>Excel 第一行表头包含“用户名”和“密码”即可，也支持 <code>username</code> / <code>password</code>。导入前可以选择创建为学生账号或教师账号；创建学生账号时可以统一绑定所属老师。</p>
              <h3>所属老师的作用</h3>
              <ul>
                <li>教师在“添加学生到班级”时，只能看到自己名下学生。</li>
                <li>管理员可以看到全部学生，不受所属老师限制。</li>
                <li>如果学生没有绑定老师，管理员仍可管理，普通教师不会在批量添加列表中看到该学生。</li>
              </ul>
            </div>
          </section>

          <section class="panel guide-section" id="guide-student-view">
            <div class="panel-head"><h2>学生端使用</h2></div>
            <div class="panel-body">
              <ul>
                <li><strong>试卷：</strong>学生首页显示所有未隐藏试卷，可按考试类型、等级和关键词筛选。</li>
                <li><strong>提交：</strong>客观题提交前会弹出确认框，未作答题目会提示并按 0 分处理。</li>
                <li><strong>记录：</strong>“记录”页面显示学生历史练习提交。</li>
                <li><strong>学习中心：</strong>汇总待完成作业、练习进度和错题。</li>
                <li><strong>班级：</strong>学生先点击进入某个班级，再查看该班级发布的试卷作业。</li>
                <li><strong>改密码：</strong>右上角账号菜单可修改自己的登录密码。</li>
              </ul>
            </div>
          </section>

          <section class="panel guide-section" id="guide-ops">
            <div class="panel-head"><h2>更新与备份</h2></div>
            <div class="panel-body">
              <h3>服务器更新</h3>
              <pre class="code-block"><code><span class="code-line">cd /opt/csppractice</span><span class="code-line">git pull origin main</span><span class="code-line">npm install --omit=dev</span><span class="code-line">pm2 restart csppractice</span><span class="code-line">pm2 save</span></code></pre>
              <h3>重要数据</h3>
              <ul>
                <li><strong>data/papers.json：</strong>试卷题库。</li>
                <li><strong>data/runtime.sqlite：</strong>账号、班级、作业、提交记录、隐藏状态等运行数据。</li>
                <li><strong>.env：</strong>如果服务器上配置过环境变量，也建议备份。</li>
              </ul>
              <h3>后台备份与恢复</h3>
              <p>管理员可在“系统设置 - 数据备份”中一键备份，也可以查看备份列表并恢复到某个备份。恢复前系统会自动创建一份当前数据的安全备份。</p>
              <h3>备份命令示例</h3>
              <pre class="code-block"><code><span class="code-line">BACKUP=~/csppractice-backup-$(date +%Y%m%d-%H%M%S)</span><span class="code-line">mkdir -p "$BACKUP"</span><span class="code-line">cp data/papers.json "$BACKUP/"</span><span class="code-line">cp data/runtime.sqlite "$BACKUP/" 2>/dev/null || true</span><span class="code-line">cp .env "$BACKUP/" 2>/dev/null || true</span></code></pre>
            </div>
          </section>

          <section class="panel guide-section" id="guide-faq">
            <div class="panel-head"><h2>常见问题</h2></div>
            <div class="panel-body">
              <h3>学生看不到试卷</h3>
              <p>检查试卷是否被隐藏；如果是班级作业，还要确认作业是否发布到学生所在班级。</p>
              <h3>Word 导入后变成更新原试卷</h3>
              <p>这是因为 Word 中的“试卷ID”与已有试卷相同。需要新建试卷时，请修改为新的唯一试卷 ID。</p>
              <h3>教师批量添加学生时看不到某些学生</h3>
              <p>普通教师只能看到绑定到自己名下的学生。管理员可以在用户管理中创建学生时绑定所属老师，或由管理员直接添加。</p>
              <h3>线上更新后页面还是旧的</h3>
              <p>先确认服务器执行了 <code>git pull</code>、<code>npm install --omit=dev</code>、<code>pm2 restart</code>，然后让浏览器强制刷新：Windows 用 <code>Ctrl + F5</code>，macOS 用 <code>Cmd + Shift + R</code>。</p>
            </div>
          </section>
        </div>
      </div>
    </section>
  `;
  document.querySelectorAll("[data-guide-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.guideTarget);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

async function renderTeacherWorkbench() {
  if (!isTeacher()) {
    app.innerHTML = `<div class="panel empty">教师工作台需要教师或管理员权限。</div>`;
    return;
  }
  if (!state.workbench) {
    try {
      state.workbench = await api("/api/teacher/workbench");
    } catch (error) {
      notify(error.message);
    }
  }
  const data = state.workbench || { totals: {}, classes: [], assignments: [], attentionClasses: [], recentAttempts: [] };
  const tab = state.workbenchTab || "classes";

  function workbenchTabButton(id, label) {
    return `<button class="wb-tab-btn ${tab === id ? "active" : ""}" type="button" data-workbench-tab="${id}">${label}</button>`;
  }

  app.innerHTML = `
    <section class="manage-shell teacher-workbench">
      <div class="panel">
        <div class="panel-head"><h1>教师工作台</h1><a class="primary-btn" href="#/manage">进入管理台</a></div>
        <div class="panel-body stat-grid"><a class="stat-card stat-card-link" href="#/manage?tab=classes"><strong>${data.totals.classes || 0}</strong><span>班级</span></a><a class="stat-card stat-card-link" href="#/manage?tab=classes"><strong>${data.totals.students || 0}</strong><span>学生</span></a><a class="stat-card stat-card-link" href="#/manage?tab=classes"><strong>${data.assignments.length || 0}</strong><span>作业</span></a><div class="stat-card"><strong>${data.attentionClasses.length || 0}</strong><span>待查看</span></div></div>
      </div>
      <div class="workbench-tabs">${workbenchTabButton("classes", "班级总览")}${workbenchTabButton("assignments", "作业中心")}${workbenchTabButton("attempts", "近期答题")}</div>

      <div class="workbench-panel" ${tab !== "classes" ? "hidden" : ""}>
        <div class="panel">
          <div class="panel-head"><h2>我的班级</h2><a class="secondary-btn" href="#/manage?tab=classes">创建班级</a></div>
          <div class="panel-body">
            <ul class="paper-list">${(data.classes || []).map((klass) => `<li class="paper-item"><span class="paper-icon">${klass.level ? `${klass.level}级` : "班级"}</span><div><h3>${escapeHtml(klass.name)}</h3><div class="meta"><span>${escapeHtml(klass.categoryName || categoryName(klass.category))}</span><span>${klass.studentCount} 名学生</span><span>${klass.assignmentCount} 个作业</span></div></div><div class="paper-row-actions"><a class="secondary-btn" href="#/manage/classes/${encodeURIComponent(klass.id)}?tab=assignments">发布作业</a><a class="primary-btn" href="#/manage/classes/${encodeURIComponent(klass.id)}">查看</a></div></li>`).join("") || `<li class="empty">暂无班级，去管理台创建第一个班级。</li>`}</ul>
          </div>
        </div>
      </div>

      <div class="workbench-panel" ${tab !== "assignments" ? "hidden" : ""}>
        <div class="wb-two-col">
          <div class="panel">
            <div class="panel-head"><h2>最近作业</h2><a class="secondary-btn" href="#/manage?tab=classes">快捷发布</a></div>
            <div class="panel-body">
              <ul class="mini-list">${(data.assignments || []).map((item) => `<li><a class="mini-link" href="#/paper/${item.paperId}"><span>${escapeHtml(item.paperTitle || item.title)}<div class="muted">${escapeHtml(item.className || "")} · ${assignmentTimeText(item)}</div></span></a></li>`).join("") || `<li class="muted">暂无作业</li>`}</ul>
            </div>
          </div>
          <div class="panel">
            <div class="panel-head"><h2>待查看学情</h2></div>
            <div class="panel-body">
              <ul class="mini-list">${(data.attentionClasses || []).map((klass) => `<li><span>${escapeHtml(klass.name)}<div class="muted">${klass.studentCount} 名学生 · ${klass.assignmentCount} 个作业</div></span><a class="secondary-btn compact-action" href="#/manage/classes/${encodeURIComponent(klass.id)}">查看</a></li>`).join("") || `<li class="muted">暂无需要查看的班级</li>`}</ul>
            </div>
          </div>
        </div>
      </div>

      <div class="workbench-panel" ${tab !== "attempts" ? "hidden" : ""}>
        <div class="panel">
          <div class="panel-head"><h2>近期答题</h2></div>
          <div class="panel-body">
            <ul class="mini-list">${(data.recentAttempts || []).map((item) => `<li><a class="mini-link" href="#/paper/${item.paperId}"><span>${escapeHtml(item.username || "")}<div class="muted">${escapeHtml(item.paperTitle || item.questionTitle || "")}</div></span><span class="muted">${item.type === "objective" ? `${item.score}/${item.fullScore}` : `${item.passed || 0}/${item.total || 0}`}</span></a></li>`).join("") || `<li class="muted">暂无答题记录</li>`}</ul>
          </div>
        </div>
      </div>
    </section>
  `;

  document.querySelectorAll("[data-workbench-tab]").forEach((button) => button.addEventListener("click", () => {
    state.workbenchTab = button.dataset.workbenchTab;
    app.innerHTML = "";
    renderTeacherWorkbench();
  }));
}

function manageTabButton(id, label, active) {
  return `<button class="${active === id ? "active" : ""}" type="button" role="tab" aria-selected="${active === id}" data-manage-tab="${id}">${label}</button>`;
}

function renderManagePapersSection() {
  if ((state.manage.paperView || "list") !== "editor") return renderPaperListSection();
  return renderPaperEditorSection();
}

function renderPaperListSection() {
  const filtered = filteredManagePapers();
  const hasFilter = state.manage.paperFilter.category !== "all" || state.manage.paperFilter.keyword;
  return `
    <div class="panel">
      <div class="panel-head"><h2>管理试卷</h2><span class="muted">${filtered.length} / ${state.manage.papers.length} 套</span></div>
      <div class="panel-body">
        <div class="paper-manage-filters">
          <select id="managePaperCategoryFilter" aria-label="按类型筛选">
            <option value="all" ${state.manage.paperFilter.category === "all" ? "selected" : ""}>全部类型</option>
            ${state.examTypes.map((type) => `<option value="${type.id}" ${state.manage.paperFilter.category === type.id ? "selected" : ""}>${escapeHtml(type.name)}</option>`).join("")}
          </select>
          <input id="managePaperKeywordFilter" type="search" placeholder="搜索试卷名称…" value="${escapeHtml(state.manage.paperFilter.keyword)}" aria-label="搜索试卷">
          ${hasFilter ? `<button class="secondary-btn" type="button" id="clearPaperFilter">清除筛选</button>` : ""}
        </div>
        <div class="paper-manage-actions">
          <label class="inline-check"><input id="selectAllPapers" type="checkbox">全选</label>
          <button class="secondary-btn" type="button" id="hideSelectedPapers">隐藏选中</button>
          <button class="secondary-btn" type="button" id="showSelectedPapers">显示选中</button>
          <button class="secondary-btn" type="button" id="exportSelectedPapers">导出选中 Word</button>
          <button class="secondary-btn" type="button" id="exportFilteredPapers">导出筛选结果</button>
          <label class="secondary-btn file-action" for="importWordPaperFile">导入 Word</label>
          <input id="importWordPaperFile" type="file" accept=".docx" hidden>
          <button class="danger-btn" type="button" id="deleteSelectedPapers">删除选中</button>
          <button class="primary-btn" type="button" id="newPaper">创建新试卷</button>
        </div>
        <div class="paper-manage-list">
          ${filtered.map(renderPaperManageRow).join("") || `<div class="empty">${hasFilter ? "没有匹配的试卷，尝试调整筛选条件。" : "暂无试卷。"}</div>`}
        </div>
      </div>
    </div>
  `;
}

function renderPaperEditorSection() {
  const editingPaper = state.manage.editPaper || samplePaper();
  const editingExisting = state.manage.papers.some((paper) => paper.id === editingPaper.id);
  const canEdit = !editingExisting || editingPaper.canManage !== false;
  return `
    <div class="panel">
      <div class="panel-head">
        <h2>${editingExisting ? (canEdit ? "修改试卷" : "查看试卷") : "创建试卷"}</h2>
        <button class="secondary-btn" type="button" id="backPaperList">返回管理试卷</button>
      </div>
      <div class="panel-body">
        ${canEdit ? renderPaperEditorActions("top") : ""}
        ${canEdit ? renderPaperBuilder(editingPaper) : `<fieldset class="readonly-paper" disabled>${renderPaperBuilder(editingPaper)}</fieldset>`}
        ${canEdit ? `<details class="advanced-json"><summary>高级 JSON 导入/导出</summary><textarea class="json-editor compact" id="paperJson" spellcheck="false">${escapeHtml(JSON.stringify(state.manage.editPaper || samplePaper(), null, 2))}</textarea></details>
        ${renderPaperEditorActions("bottom")}` : `<div class="submit-row"><span class="muted">这套试卷由其他账号创建，只能查看和发布，不能修改。</span></div>`}
      </div>
    </div>
  `;
}

function renderPaperEditorActions(position) {
  return `
    <div class="paper-editor-actions ${position === "top" ? "paper-editor-actions-top" : ""}">
      <div>
        <button class="primary-btn" type="button" data-paper-editor-action="save">保存试卷</button>
        <button class="secondary-btn" type="button" data-paper-editor-action="sync-json">同步到 JSON</button>
      </div>
      <span class="muted">日常用表单建卷；复杂导入可展开 JSON。</span>
    </div>
  `;
}

function filteredManagePapers() {
  return state.manage.papers.filter((paper) => {
    const byCategory = state.manage.paperFilter.category === "all" || paper.category === state.manage.paperFilter.category;
    const keyword = state.manage.paperFilter.keyword.toLowerCase();
    const byKeyword = !keyword || paper.title.toLowerCase().includes(keyword);
    return byCategory && byKeyword;
  });
}

function renderPaperManageRow(paper) {
  const stats = paperStats(paper);
  const canManage = paper.canManage !== false;
  return `
    <article class="paper-manage-row">
      <label class="paper-check"><input type="checkbox" data-paper-select="${paper.id}"></label>
      <div>
        <h3>${escapeHtml(paper.title)}</h3>
        <div class="meta"><span>${escapeHtml(categoryName(paper.category || "gesp"))}</span>${examTypeById(paper.category || "gesp").levelEnabled ? `<span>${paper.level} 级</span>` : ""}<span>${stats.fullScore} 分</span><span>${stats.objective} 客观题</span><span>${stats.program} 编程题</span>${paper.hidden ? `<span class="status-warn">已隐藏</span>` : ""}${canManage ? "" : `<span>只读</span>`}</div>
      </div>
      <div class="paper-row-actions">
        ${canManage ? `<button class="secondary-btn" type="button" data-toggle-paper-hidden="${paper.id}">${paper.hidden ? "显示" : "隐藏"}</button>` : ""}
        <button class="secondary-btn" type="button" data-edit-paper="${paper.id}">${canManage ? "修改" : "查看"}</button>
        ${canManage ? `<button class="danger-btn" type="button" data-delete-paper="${paper.id}">删除</button>` : ""}
      </div>
    </article>
  `;
}

function renderManageClassesSection(overview) {
  const classes = overview.classes || [];
  if (state.manage.classReport) return renderClassManagementDetail(overview);
  const keyword = (state.manage.classKeyword || "").trim().toLowerCase();
  const filtered = classes.filter((klass) => {
    if (!keyword) return true;
    return `${klass.name} ${klass.teacherName} ${klass.categoryName || categoryName(klass.category)} ${klass.inviteCode || ""}`.toLowerCase().includes(keyword);
  });
  return `
    <div class="panel">
        <div class="panel-head"><h2>班级管理</h2><span class="muted" id="classCountText">${filtered.length} / ${classes.length} 个班级</span></div>
        <div class="panel-body">
          <div class="class-manage-toolbar">
            <input id="classKeyword" placeholder="搜索班级、教师或邀请码" value="${escapeHtml(state.manage.classKeyword || "")}"><button class="primary-btn compact-action" type="button" id="classSearchBtn">搜索</button>
          </div>
          <div class="stack-form class-create-form"><input id="className" placeholder="班级名称，如 周六一级班"><select id="classCategory">${state.examTypes.map((type) => `<option value="${type.id}">${escapeHtml(type.name)}</option>`).join("")}</select><select id="classLevel">${Array.from({ length: 8 }, (_, index) => `<option value="${index + 1}">${index + 1} 级</option>`).join("")}</select><button class="primary-btn" type="button" id="createClass">创建班级</button></div>
          <div class="class-card-list">
            ${filtered.map(renderClassManageCard).join("") || `<div class="empty">${keyword ? "没有匹配的班级。" : "暂无班级，先创建一个班级。"}</div>`}
          </div>
        </div>
    </div>
  `;
}

function renderClassManagementDetail(overview) {
  const report = state.manage.classReport;
  if (!report) return "";
  const classes = overview.classes || [];
  const activeTab = state.manage.classDetailTab || "students";
  return `
    <div class="manage-class-detail">
      <div class="panel">
        <div class="panel-head"><h2>${escapeHtml(report.class.name)}</h2><div class="submit-row"><button class="secondary-btn compact-action" type="button" id="exportClassStudents">导出名单</button><a class="secondary-btn compact-action" href="#/manage" data-back-class-list>返回班级列表</a></div></div>
        <div class="panel-body">
          ${renderClassHeader(report)}
          <div class="class-detail-tabs">
            <button class="class-detail-tab-btn ${activeTab === "students" ? "active" : ""}" type="button" data-class-detail-tab="students">学生</button>
            <button class="class-detail-tab-btn ${activeTab === "assignments" ? "active" : ""}" type="button" data-class-detail-tab="assignments">作业</button>
            <button class="class-detail-tab-btn ${activeTab === "attempts" ? "active" : ""}" type="button" data-class-detail-tab="attempts">答题</button>
          </div>
          ${activeTab === "students" ? renderClassStudentsTab(report) : ""}
          ${activeTab === "assignments" ? renderClassAssignmentsTab(report, classes) : ""}
          ${activeTab === "attempts" ? renderClassAttemptsTab(report) : ""}
        </div>
      </div>
    </div>
  `;
}

function renderClassHeader(report) {
  const klass = report.class;
  const assignments = report.assignments || [];
  const students = report.students || [];
  const studentMeta = report.pagination?.students || { total: students.length };
  const attemptMeta = report.pagination?.recentAttempts || { total: students.reduce((sum, s) => sum + Number(s.attemptCount || 0), 0) };
  return `
    <div class="class-report-card">
      <div class="class-detail-summary">
        <div class="meta"><span>${escapeHtml(klass.categoryName || categoryName(klass.category))}${klass.level ? ` · ${klass.level} 级` : ""}</span><span>邀请码 ${escapeHtml(klass.inviteCode || "")}</span><a href="#/classes/${encodeURIComponent(klass.id)}">查看学生端作业页</a></div>
        <div class="stat-grid compact-stats">
          ${statCard("学生", studentMeta.total)}
          ${statCard("作业", assignments.length)}
          ${statCard("答题", attemptMeta.total)}
        </div>
      </div>
    </div>`;
}

function renderClassStudentsTab(report) {
  const klass = report.class;
  const students = report.students || [];
  return `
    <div class="class-report-grid">
      ${renderClassStudentAdder(klass)}
      <section>
        <h3 class="subhead">学生列表</h3>
        <table class="report-table">
          <thead><tr><th>学生</th><th>练习</th><th>客观题最好成绩</th><th>编程通过</th></tr></thead>
          <tbody>
            ${students.map((student) => `<tr><td>${escapeHtml(student.username)}</td><td>${student.attemptCount} 次</td><td>${student.bestObjective ? `${renderScoreBadge(student.bestObjective.score, student.bestObjective.fullScore, "最好")}<div class="muted">${escapeHtml(student.bestObjective.paperTitle || "")}</div>` : `<span class="muted">暂无</span>`}</td><td>${student.acceptedPrograms} 题</td></tr>`).join("") || `<tr><td colspan="4" class="muted">暂无学生</td></tr>`}
          </tbody>
        </table>
        ${renderPager(report.pagination?.students, "report-students")}
      </section>
    </div>`;
}

function renderClassAssignmentsTab(report, classes) {
  const assignments = report.assignments || [];
  return `
    <div class="class-tab-content">
      ${renderAssignmentPublisher(classes)}
      <div class="panel" style="margin-top: 18px;">
        <div class="panel-head"><h2>已发布作业</h2><span class="muted">${assignments.length} 个</span></div>
        <div class="panel-body">
          <ul class="paper-list">${assignments.map((item) => `<li class="paper-item"><span class="paper-icon">作业</span><div><h3><a href="#/paper/${item.paperId}">${escapeHtml(item.paperTitle || item.title)}</a></h3><div class="meta"><span>${assignmentTimeText(item)}</span></div></div><a class="primary-btn compact-action" href="#/paper/${item.paperId}">查看试卷</a></li>`).join("") || `<li class="empty">暂无作业</li>`}</ul>
        </div>
      </div>
    </div>`;
}

function renderClassAttemptsTab(report) {
  const students = report.students || [];
  const attempts = report.recentAttempts || [];
  return `
    <div class="class-tab-content">
      <section>
        <h3 class="subhead">学生练习数据</h3>
        <table class="report-table">
          <thead><tr><th>学生</th><th>练习</th><th>客观题最好成绩</th><th>编程通过</th></tr></thead>
          <tbody>
            ${students.map((student) => `<tr><td>${escapeHtml(student.username)}</td><td>${student.attemptCount} 次</td><td>${student.bestObjective ? `${renderScoreBadge(student.bestObjective.score, student.bestObjective.fullScore, "最好")}<div class="muted">${escapeHtml(student.bestObjective.paperTitle || "")}</div>` : `<span class="muted">暂无</span>`}</td><td>${student.acceptedPrograms} 题</td></tr>`).join("") || `<tr><td colspan="4" class="muted">暂无学生数据</td></tr>`}
          </tbody>
        </table>
        ${renderPager(report.pagination?.students, "report-students")}
      </section>
      <div class="panel" style="margin-top: 18px;">
        <div class="panel-head"><h2>最近答题</h2><span class="muted">${report.pagination?.recentAttempts?.total ?? attempts.length} 条</span></div>
        <div class="panel-body">
          <ul class="mini-list">${attempts.map((item) => `<li><span>${escapeHtml(item.username || "")}<div class="muted">${escapeHtml(item.paperTitle || item.questionTitle || "")}</div></span><span class="muted">${item.type === "objective" ? `${item.score}/${item.fullScore}` : `${item.passed || 0}/${item.total || 0}`}</span></li>`).join("") || `<li class="muted">暂无答题记录</li>`}</ul>
          ${renderPager(report.pagination?.recentAttempts, "report-attempts")}
        </div>
      </div>
    </div>`;
}

function renderPublishedAssignments(report) {
  const assignments = report.assignments || [];
  return `
    <div class="panel action-panel">
      <div class="panel-head"><h2>已发布作业</h2><span class="muted">${assignments.length} 个</span></div>
      <div class="panel-body">
        <ul class="mini-list">${assignments.map((item) => `<li><span>${escapeHtml(item.paperTitle || item.title)}<div class="muted">${assignmentTimeText(item)}</div></span></li>`).join("") || `<li class="muted">暂无作业</li>`}</ul>
      </div>
    </div>
  `;
}

function renderClassRecentAttempts(report) {
  const attempts = report.recentAttempts || [];
  return `
    <div class="panel action-panel">
      <div class="panel-head"><h2>最近答题</h2><span class="muted">${report.pagination?.recentAttempts?.total ?? attempts.length} 条</span></div>
      <div class="panel-body">
        <ul class="mini-list">${attempts.map((item) => `<li><span>${escapeHtml(item.username || "")}<div class="muted">${escapeHtml(item.paperTitle || item.questionTitle || "")}</div></span><span class="muted">${item.type === "objective" ? `${item.score}/${item.fullScore}` : `${item.passed || 0}/${item.total || 0}`}</span></li>`).join("") || `<li class="muted">暂无答题记录</li>`}</ul>
        ${renderPager(report.pagination?.recentAttempts, "report-attempts")}
      </div>
    </div>
  `;
}

function renderAssignmentPublisher(classes) {
  const activeClassId = state.manage.classReport?.class?.id || classes[0]?.id || "";
  const scopedClass = state.manage.classReport?.class || null;
  return `
    <div class="panel action-panel">
      <div class="panel-head"><h2>发布作业</h2></div>
      <div class="panel-body">
        <div class="stack-form">
          <label><span>发布到班级</span><select id="assignmentClass" ${scopedClass ? "disabled" : ""}>${classes.map((klass) => `<option value="${klass.id}" ${activeClassId === klass.id ? "selected" : ""}>${escapeHtml(klass.name)}</option>`).join("")}</select></label>
          <label><span>选择试卷</span><select id="assignmentPaper">${state.manage.papers.map((paper) => `<option value="${paper.id}">${escapeHtml(paper.title)}</option>`).join("")}</select></label>
          <label><span>开始时间</span><input id="assignmentStart" type="datetime-local"></label>
          <label><span>结束时间</span><input id="assignmentEnd" type="datetime-local"></label>
          <label><span>答题时长</span><select id="assignmentDuration"><option value="0">不限时</option><option value="10">10 分钟</option><option value="20">20 分钟</option><option value="30">30 分钟</option><option value="45">45 分钟</option><option value="60">60 分钟</option><option value="90">90 分钟</option><option value="120">120 分钟</option></select></label>
          <button class="primary-btn" type="button" id="createAssignment">确认发布作业</button>
        </div>
      </div>
    </div>
  `;
}

function renderClassManageCard(klass) {
  const active = state.manage.classReport?.class?.id === klass.id;
  return `
    <article class="class-manage-card ${active ? "active" : ""}">
      <div>
        <h3>${escapeHtml(klass.name)}</h3>
        <div class="meta"><span>${escapeHtml(klass.categoryName || categoryName(klass.category))}</span>${klass.level ? `<span>${klass.level} 级</span>` : ""}<span>邀请码 ${escapeHtml(klass.inviteCode)}</span></div>
      </div>
      <div class="class-card-actions">
        <span class="muted">${klass.studentCount} 名学生 · ${klass.assignmentCount} 个作业</span>
        <a class="primary-btn" href="#/manage/classes/${encodeURIComponent(klass.id)}">进入班级</a>
      </div>
    </article>
  `;
}

function renderManageSettingsSection() {
  if (!isAdmin()) {
    return `<div class="settings-shell"><div class="panel"><div class="panel-head"><h2>考试类型</h2></div><div class="panel-body"><p class="muted">考试类型由管理员维护。</p></div></div></div>`;
  }
  return `
    <div class="settings-shell">
      ${renderUserAdmin()}
      <div class="settings-top-grid">
        ${renderRegistrationAdmin()}
        ${renderBackupAdmin()}
        ${renderExamTypeAdmin()}
        ${renderArchiveAdmin()}
      </div>
    </div>
  `;
}

function renderArchiveAdmin() {
  const archives = state.manage.archives || [];
  return `
    <div class="panel settings-card">
      <div class="panel-head"><h2>数据归档</h2></div>
      <div class="panel-body">
        <p class="muted settings-card-note">按截止日期归档旧班级、旧作业和旧答题记录；归档后默认不出现在日常页面。</p>
        <div class="settings-compact-form">
          <input id="archiveTerm" placeholder="学期名称，如 2026 春季">
          <input id="archiveBeforeDate" type="date">
          <button class="danger-btn" type="button" id="archiveTermButton">执行归档</button>
          <button class="secondary-btn" type="button" id="refreshArchives">查看归档</button>
        </div>
        <div class="backup-result muted" id="archiveResult">建议归档前先创建备份。</div>
        <details class="backup-restore-box" ${archives.length ? "open" : ""}>
          <summary><span>历史归档</span><span class="muted">${archives.length ? `${archives.length} 个学期` : "点击查看归档"}</span></summary>
          <ul class="mini-list backup-list">
            ${archives.map((archive) => `
              <li>
                <span>
                  <strong>${escapeHtml(archive.archiveTerm)}</strong>
                  <div class="muted">${escapeHtml(formatDateTime(archive.archivedAt))} · 班级 ${archive.classes || 0} 个 · 作业 ${archive.assignments || 0} 个 · 答题 ${archive.attempts || 0} 条</div>
                </span>
                <button class="secondary-btn" type="button" data-restore-archive="${escapeHtml(archive.archiveTerm)}">恢复</button>
              </li>
            `).join("") || `<li class="muted">还没有加载归档列表。</li>`}
          </ul>
        </details>
      </div>
    </div>
  `;
}

function renderRegistrationAdmin() {
  return `
    <div class="panel settings-card">
      <div class="panel-head"><h2>注册开放</h2></div>
      <div class="panel-body">
        <label class="inline-check"><input id="allowRegistration" type="checkbox" ${state.allowRegistration ? "checked" : ""}>允许学生公开注册</label>
        <p class="muted settings-card-note">关闭后，登录窗口不再提供创建账号入口，学生账号需要由管理员在用户管理中创建或导入。</p>
        <div class="settings-action-row">
          <button class="primary-btn" type="button" id="saveRegistrationSettings">保存设置</button>
        </div>
      </div>
    </div>
  `;
}

function statCard(label, value) {
  return `<div class="stat-card"><strong>${value}</strong><span>${label}</span></div>`;
}

function stopExamTimers() {
  if (state.examTimerId) { clearInterval(state.examTimerId); state.examTimerId = null; }
  if (state.examHeartbeatId) { clearInterval(state.examHeartbeatId); state.examHeartbeatId = null; }
  state.examSession = null;
}

function formatExamTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function assignmentTimeText(item) {
  const parts = [];
  if (item.startAt) parts.push(`开始 ${escapeHtml(item.startAt.replace("T", " "))}`);
  if (item.endAt || item.dueAt) parts.push(`结束 ${escapeHtml((item.endAt || item.dueAt).replace("T", " "))}`);
  return parts.join("；") || "长期";
}

function assignmentStatusText(item) {
  if (item.status === "not_started") return "未开始";
  if (item.status === "ended") return "已结束";
  return "进行中";
}

function assignmentScoreText(item) {
  return item.bestObjective ? `${item.bestObjective.score}/${item.bestObjective.fullScore}` : "未提交";
}

function renderPaperBuilder(paper) {
  const questions = paper.questions || [];
  const category = paper.category || "gesp";
  const isLevelEnabled = examTypeById(category).levelEnabled;
  const toolbar = renderQuestionAddToolbar();
  return `
    <div class="builder">
      <div class="builder-meta">
        <label><span>试卷 ID</span><input id="paperIdInput" value="${escapeHtml(paper.id)}"></label>
        <label><span>标题</span><input id="paperTitleInput" value="${escapeHtml(paper.title)}"></label>
        <label><span>考试类型</span><select id="paperCategoryInput">${state.examTypes.map((type) => `<option value="${type.id}" ${category === type.id ? "selected" : ""}>${escapeHtml(type.name)}</option>`).join("")}</select></label>
        <label id="paperLevelField" ${isLevelEnabled ? "" : "hidden"}><span>等级</span><select id="paperLevelInput">${Array.from({ length: 8 }, (_, index) => `<option value="${index + 1}" ${Number(paper.level || 1) === index + 1 ? "selected" : ""}>${index + 1} 级</option>`).join("")}</select></label>
        <label><span>月份</span><input id="paperMonthInput" value="${escapeHtml(paper.month || "06")}"></label>
        <label class="span-2"><span>说明</span><input id="paperSummaryInput" value="${escapeHtml(paper.summary || "")}"></label>
      </div>
      ${toolbar}
      ${renderBuilderUtilityBar()}
      ${renderBuilderQuestionNav(questions)}
      <p class="builder-hint">题干、解析和编程题题面支持 Markdown，可直接粘贴 &#96;&#96;&#96;cpp 代码块。</p>
      <div class="builder-list">${questions.map((question, index) => renderBuilderQuestion(question, index)).join("") || `<div class="empty">还没有题目，先添加一题。</div>`}</div>
      ${toolbar}
    </div>
  `;
}

function renderQuestionAddToolbar() {
  return `<div class="builder-toolbar"><button class="secondary-btn" type="button" data-add-question="single">添加单选题</button><button class="secondary-btn" type="button" data-add-question="judge">添加判断题</button><button class="secondary-btn" type="button" data-add-question="multi">添加多选题</button><button class="secondary-btn" type="button" data-add-question="reading">添加阅读程序题</button><button class="secondary-btn" type="button" data-add-question="completion">添加完善程序题</button>${state.programSubmissionEnabled ? `<button class="secondary-btn" type="button" data-add-question="program">添加编程题</button>` : ""}</div>`;
}

function renderBuilderUtilityBar() {
  return `<div class="builder-utility"><div class="bulk-score-tools"><input id="bulkScoreInput" type="number" min="0" step="0.5" placeholder="分值"><button class="secondary-btn" type="button" data-apply-score="all">全部题</button><button class="secondary-btn" type="button" data-apply-score="objective">客观题</button><button class="secondary-btn" type="button" data-apply-score="subquestions">复合题子题</button></div></div>`;
}

function renderBuilderQuestionNav(questions) {
  const nav = questions.map((question, index) => `<button class="secondary-btn" type="button" data-jump-builder-question="${index}">${index + 1}</button>`).join("");
  return `<div class="builder-floating-nav"><span>题号</span><div class="builder-jump-list">${nav || `<span class="muted">暂无题目</span>`}</div></div>`;
}

function renderBuilderQuestion(question, index) {
  const typeName = `${questionTypeName(question.type)}题`;
  const score = isCompositeType(question.type) ? (question.subquestions || []).reduce((sum, item) => sum + Number(item.score || 0), 0) : Number(question.score || 2);
  return `<article class="builder-question" id="builder-question-${index}" data-builder-question="${index}"><div class="question-head"><span class="builder-question-title"><strong>${index + 1}</strong><span>第 ${index + 1} 题 · ${typeName}</span></span><button class="danger-btn" type="button" data-remove-question="${index}">删除</button></div><div class="builder-question-meta"><input data-field="id" value="${escapeHtml(question.id || `q${index + 1}`)}" placeholder="题目 ID"><input data-field="score" type="number" value="${score}" placeholder="分值" ${isCompositeType(question.type) ? "readonly" : ""}></div>${renderBuilderQuestionBody(question, index)}</article>`;
}

function renderBuilderQuestionBody(question, index) {
  if (question.type === "program") return renderProgramBuilder(question);
  if (isCompositeType(question.type)) return renderCompositeBuilder(question, index);
  return renderObjectiveBuilder(question);
}

function markdownInsertTools(field, choiceIndex = null) {
  const choiceAttr = choiceIndex === null ? "" : ` data-target-choice="${choiceIndex}"`;
  return `<div class="markdown-tools"><button class="secondary-btn" type="button" data-insert-markdown="code" data-target-field="${field}"${choiceAttr}>插入代码</button><button class="secondary-btn" type="button" data-insert-markdown="formula" data-target-field="${field}"${choiceAttr}>插入公式</button><button class="secondary-btn" type="button" data-insert-markdown="image" data-target-field="${field}"${choiceAttr}>插入图片</button></div>`;
}

function renderObjectiveBuilder(question) {
  const hasChoices = question.type === "single" || question.type === "multi";
  const choices = hasChoices ? [...(question.choices || []), "", "", "", ""].slice(0, 4) : [];
  const answer = Array.isArray(question.answer) ? question.answer.map(Number) : [];
  return `${markdownInsertTools("stem")}<textarea data-field="stem" placeholder="题干，支持 Markdown 代码块">${escapeHtml(question.stem || "")}</textarea>${hasChoices ? `<div class="choice-editor">${choices.map((choice, index) => `<label class="choice-edit-item"><span>${String.fromCharCode(65 + index)}</span><div>${markdownInsertTools("choice", index)}<textarea data-choice="${index}" placeholder="选项内容，支持代码、图片和公式">${escapeHtml(choice)}</textarea></div></label>`).join("")}</div>${question.type === "multi" ? `<label><span>正确选项（可多选）</span><div class="option-answer-grid">${choices.map((_, index) => `<label class="inline-check"><input type="checkbox" data-answer-choice="${index}" ${answer.includes(index) ? "checked" : ""}>${String.fromCharCode(65 + index)}</label>`).join("")}</div></label>` : `<label><span>正确选项</span><select data-field="answer">${choices.map((_, index) => `<option value="${index}" ${Number(question.answer || 0) === index ? "selected" : ""}>${String.fromCharCode(65 + index)}</option>`).join("")}</select></label>`}` : `<label><span>正确答案</span><select data-field="answer"><option value="true" ${question.answer !== false ? "selected" : ""}>正确</option><option value="false" ${question.answer === false ? "selected" : ""}>错误</option></select></label>`}${markdownInsertTools("explanation")}<textarea data-field="explanation" placeholder="解析，支持 Markdown">${escapeHtml(question.explanation || "")}</textarea>`;
}

function renderCompositeBuilder(question, index) {
  const subquestions = question.subquestions || [];
  return `<input data-field="title" value="${escapeHtml(question.title || "")}" placeholder="${question.type === "reading" ? "阅读程序标题" : "完善程序标题"}">${markdownInsertTools("statement")}<textarea data-field="statement" placeholder="题目说明，支持 Markdown">${escapeHtml(question.statement || "")}</textarea><textarea data-field="code" placeholder="程序代码">${escapeHtml(question.code || "")}</textarea><div class="sub-builder-list">${subquestions.map((subquestion, subIndex) => renderSubQuestionBuilder(subquestion, index, subIndex)).join("") || `<div class="empty">还没有子题。</div>`}</div><div class="builder-toolbar"><button class="secondary-btn" type="button" data-add-sub-question="judge" data-parent-question="${index}">添加判断子题</button><button class="secondary-btn" type="button" data-add-sub-question="single" data-parent-question="${index}">添加单选子题</button><button class="secondary-btn" type="button" data-add-sub-question="multi" data-parent-question="${index}">添加多选子题</button></div>`;
}

function renderSubQuestionBuilder(question, parentIndex, subIndex) {
  return `<article class="builder-question sub-builder-question" data-sub-question="${subIndex}"><div class="question-head"><span>子题 ${subIndex + 1} · ${questionTypeName(question.type)}题</span><button class="danger-btn" type="button" data-parent-question="${parentIndex}" data-remove-sub-question="${subIndex}">删除</button></div><input data-field="id" value="${escapeHtml(question.id || `s${subIndex + 1}`)}" placeholder="子题 ID"><input data-field="score" type="number" value="${Number(question.score || (question.type === "judge" ? 1.5 : 3))}" placeholder="分值">${renderObjectiveBuilder(question)}</article>`;
}

function renderProgramBuilder(question) {
  return `<input data-field="title" value="${escapeHtml(question.title || "")}" placeholder="编程题标题">${markdownInsertTools("statement")}<textarea data-field="statement" placeholder="题面描述，支持 Markdown 代码块">${escapeHtml(question.statement || "")}</textarea><textarea data-field="input" placeholder="输入格式，支持 Markdown">${escapeHtml(question.input || "")}</textarea><textarea data-field="output" placeholder="输出格式，支持 Markdown">${escapeHtml(question.output || "")}</textarea><textarea data-field="samplesText" placeholder="样例，每组用 --- 分隔，输入和输出用 === 分隔">${escapeHtml(formatCases(question.samples || []))}</textarea><textarea data-field="testsText" placeholder="隐藏测试点，每组用 --- 分隔，输入和输出用 === 分隔">${escapeHtml(formatCases(question.tests || []))}</textarea>`;
}

function jumpToBuilderQuestion(index) {
  const target = document.querySelector(`#builder-question-${index}`);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.classList.add("focus-flash");
  window.setTimeout(() => target.classList.remove("focus-flash"), 900);
}

function applyBulkScore(scope) {
  const input = document.querySelector("#bulkScoreInput");
  const score = Number(input?.value);
  if (!Number.isFinite(score) || score < 0) return notify("请输入有效分值。");
  const questions = Array.from(document.querySelectorAll("[data-builder-question]"));
  let changed = 0;
  questions.forEach((item) => {
    const source = state.manage.editPaper.questions[Number(item.dataset.builderQuestion)];
    if (!source) return;
    if (scope === "all") {
      if (isCompositeType(source.type)) changed += applyScoreToSubquestions(item, score);
      else if (setScoreInput(item, score)) changed += 1;
      return;
    }
    if (scope === "objective" && isObjectiveType(source.type) && setScoreInput(item, score)) changed += 1;
    if (scope === "subquestions" && isCompositeType(source.type)) changed += applyScoreToSubquestions(item, score);
  });
  notify(changed ? `已修改 ${changed} 处题目分值。` : "没有符合条件的题目。");
}

function applyScoreToSubquestions(item, score) {
  let changed = 0;
  item.querySelectorAll("[data-sub-question]").forEach((subItem) => {
    if (setScoreInput(subItem, score)) changed += 1;
  });
  const total = Array.from(item.querySelectorAll("[data-sub-question] input[data-field='score']")).reduce((sum, input) => sum + Number(input.value || 0), 0);
  const parentScore = item.querySelector(":scope > .builder-question-meta input[data-field='score']");
  if (parentScore) parentScore.value = total;
  return changed;
}

function setScoreInput(root, score) {
  const input = root.querySelector("input[data-field='score']");
  if (!input || input.readOnly) return false;
  input.value = score;
  return true;
}

function formatCases(cases) {
  return cases.map((item) => `${item.input || ""}\n===\n${item.output || ""}`).join("\n---\n");
}

function parseCases(text) {
  return String(text || "").split(/\n---\n/g).map((block) => block.split(/\n===\n/g)).filter((parts) => parts.length >= 2 && (parts[0].trim() || parts.slice(1).join("\n").trim())).map((parts) => ({ input: parts[0].trimEnd() + "\n", output: parts.slice(1).join("\n===\n").trimEnd() + "\n" }));
}

function collectBuilderPaper() {
  const category = document.querySelector("#paperCategoryInput").value;
  const examType = examTypeById(category);
  const paper = {
    id: document.querySelector("#paperIdInput").value.trim(),
    title: document.querySelector("#paperTitleInput").value.trim(),
    category,
    level: examType.levelEnabled ? Number(document.querySelector("#paperLevelInput").value) : null,
    language: "C++",
    year: new Date().getFullYear(),
    month: document.querySelector("#paperMonthInput").value.trim() || "06",
    participants: 0,
    views: 0,
    hidden: Boolean(state.manage.editPaper?.hidden),
    summary: document.querySelector("#paperSummaryInput").value.trim(),
    questions: []
  };
  document.querySelectorAll("[data-builder-question]").forEach((item) => {
    const source = state.manage.editPaper.questions[Number(item.dataset.builderQuestion)];
    const type = source.type;
    const question = { id: item.querySelector('[data-field="id"]').value.trim(), type, score: Number(item.querySelector('[data-field="score"]').value || 0) };
    if (type === "program") {
      Object.assign(question, {
        title: item.querySelector('[data-field="title"]').value.trim(),
        statement: item.querySelector('[data-field="statement"]').value,
        input: item.querySelector('[data-field="input"]').value,
        output: item.querySelector('[data-field="output"]').value,
        samples: parseCases(item.querySelector('[data-field="samplesText"]').value),
        tests: parseCases(item.querySelector('[data-field="testsText"]').value)
      });
    } else if (isCompositeType(type)) {
      Object.assign(question, {
        title: item.querySelector('[data-field="title"]').value.trim(),
        statement: item.querySelector('[data-field="statement"]').value,
        code: item.querySelector('[data-field="code"]').value,
        subquestions: Array.from(item.querySelectorAll("[data-sub-question]")).map((subItem) => {
          const subSource = source.subquestions[Number(subItem.dataset.subQuestion)];
          return collectObjectiveBuilder(subItem, subSource?.type || "single");
        })
      });
      question.score = question.subquestions.reduce((sum, subquestion) => sum + Number(subquestion.score || 0), 0);
    } else {
      Object.assign(question, collectObjectiveBuilder(item, type));
    }
    paper.questions.push(question);
  });
  return paper;
}

function collectObjectiveBuilder(item, type) {
  const question = {
    id: item.querySelector('[data-field="id"]')?.value.trim() || "",
    type,
    score: Number(item.querySelector('[data-field="score"]')?.value || 0),
    stem: item.querySelector('[data-field="stem"]').value,
    explanation: item.querySelector('[data-field="explanation"]').value
  };
  if (type === "single" || type === "multi") {
    question.choices = Array.from(item.querySelectorAll("[data-choice]")).map((input) => input.value);
    question.answer = type === "multi"
      ? Array.from(item.querySelectorAll("[data-answer-choice]:checked")).map((input) => Number(input.dataset.answerChoice))
      : Number(item.querySelector('[data-field="answer"]').value);
  } else {
    question.answer = item.querySelector('[data-field="answer"]').value === "true";
  }
  return question;
}

function syncBuilderState() {
  state.manage.editPaper = collectBuilderPaper();
}

function syncBuilderToJson() {
  try {
    syncBuilderState();
    document.querySelector("#paperJson").value = JSON.stringify(state.manage.editPaper, null, 2);
    notify("已同步到 JSON。");
  } catch (error) {
    notify(error.message);
  }
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  textarea.value = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
  textarea.focus();
  textarea.selectionStart = start + text.length;
  textarea.selectionEnd = start + text.length;
}

function insertMarkdownSnippet(button) {
  const question = button.closest("[data-sub-question]") || button.closest("[data-builder-question]");
  const textarea = button.dataset.targetChoice !== undefined
    ? question?.querySelector(`textarea[data-choice="${button.dataset.targetChoice}"]`)
    : question?.querySelector(`textarea[data-field="${button.dataset.targetField}"]`);
  if (!textarea) return;
  const type = button.dataset.insertMarkdown;
  if (type === "code") {
    openCodeInsertDialog(textarea);
  } else if (type === "formula") {
    openFormulaInsertDialog(textarea);
  } else if (type === "image") {
    const url = window.prompt("请输入图片地址，例如 https://example.com/image.png");
    if (!url) return;
    insertAtCursor(textarea, `\n![图片说明](${url.trim()})\n`);
  }
}

function openFormulaInsertDialog(textarea) {
  pendingMarkdownTextarea = textarea;
  const selected = textarea.value.slice(textarea.selectionStart || 0, textarea.selectionEnd || 0);
  formulaSnippetInput.value = selected.replace(/^\s*\${1,2}|\${1,2}\s*$/g, "") || "a^2 + b^2 = c^2";
  formulaDisplayMode.checked = true;
  updateFormulaSnippetPreview();
  formulaInsertDialog.showModal();
  formulaSnippetInput.focus();
}

function formulaMarkdown(formula, display) {
  const value = String(formula || "").trim();
  return display ? `\n$$\n${value}\n$$\n` : `$${value}$`;
}

function updateFormulaSnippetPreview() {
  const formula = formulaSnippetInput.value.trim();
  formulaSnippetPreview.innerHTML = formula
    ? renderMarkdown(formulaMarkdown(formula, formulaDisplayMode.checked))
    : `<div class="muted">公式预览会显示在这里。</div>`;
  typesetMath(formulaSnippetPreview);
}

function confirmFormulaInsert() {
  if (!pendingMarkdownTextarea) return;
  const formula = formulaSnippetInput.value.trim();
  if (!formula) return notify("请先输入公式。");
  insertAtCursor(pendingMarkdownTextarea, formulaMarkdown(formula, formulaDisplayMode.checked));
  formulaInsertDialog.close();
  pendingMarkdownTextarea = null;
}

function openCodeInsertDialog(textarea) {
  pendingMarkdownTextarea = textarea;
  const selected = textarea.value.slice(textarea.selectionStart || 0, textarea.selectionEnd || 0);
  codeSnippetInput.value = selected || "";
  codeLanguageInput.value = "cpp";
  updateCodeSnippetPreview();
  codeInsertDialog.showModal();
  codeSnippetInput.focus();
}

function codeFenceFor(value) {
  return String(value || "").includes("```") ? "````" : "```";
}

function updateCodeSnippetPreview() {
  const code = codeSnippetInput.value;
  const language = codeLanguageInput.value.trim() || "cpp";
  const fence = codeFenceFor(code);
  codeSnippetPreview.innerHTML = code.trim()
    ? renderMarkdown(`${fence}${language}\n${code}\n${fence}`)
    : `<div class="muted">代码预览会显示在这里。</div>`;
}

function confirmCodeInsert() {
  if (!pendingMarkdownTextarea) return;
  const code = codeSnippetInput.value;
  if (!code.trim()) return notify("请先粘贴代码。");
  const language = codeLanguageInput.value.trim() || "cpp";
  const fence = codeFenceFor(code);
  insertAtCursor(pendingMarkdownTextarea, `\n${fence}${language}\n${code.replace(/\s+$/g, "")}\n${fence}\n`);
  codeInsertDialog.close();
  pendingMarkdownTextarea = null;
}

function addBuilderQuestion(type) {
  syncBuilderState();
  const id = `q${state.manage.editPaper.questions.length + 1}`;
  const base = { id, type, score: type === "program" ? 25 : 2 };
  if (type === "single") Object.assign(base, { stem: "", choices: ["", "", "", ""], answer: 0, explanation: "" });
  if (type === "judge") Object.assign(base, { stem: "", answer: true, explanation: "" });
  if (type === "multi") Object.assign(base, { stem: "", choices: ["", "", "", ""], answer: [], explanation: "" });
  if (type === "reading") Object.assign(base, readingQuestionTemplate(id));
  if (type === "completion") Object.assign(base, completionQuestionTemplate(id));
  if (type === "program") Object.assign(base, { title: "", statement: "", input: "", output: "", samples: [], tests: [] });
  state.manage.editPaper.questions.push(base);
  renderManage({ skipFetch: true });
}

function addSubQuestion(parentIndex, type) {
  syncBuilderState();
  const parent = state.manage.editPaper.questions[parentIndex];
  if (!parent || !isCompositeType(parent.type)) return;
  parent.subquestions ||= [];
  parent.subquestions.push(objectiveQuestionTemplate(type, `s${parent.subquestions.length + 1}`));
  renderManage({ skipFetch: true });
}

function removeSubQuestion(parentIndex, subIndex) {
  syncBuilderState();
  const parent = state.manage.editPaper.questions[parentIndex];
  if (!parent?.subquestions) return;
  parent.subquestions.splice(subIndex, 1);
  renderManage({ skipFetch: true });
}

function removeBuilderQuestion(index) {
  syncBuilderState();
  state.manage.editPaper.questions.splice(index, 1);
  renderManage({ skipFetch: true });
}

function objectiveQuestionTemplate(type, id) {
  if (type === "judge") return { id, type, score: 1.5, stem: "", answer: true, explanation: "" };
  if (type === "multi") return { id, type, score: 3, stem: "", choices: ["", "", "", ""], answer: [], explanation: "" };
  return { id, type: "single", score: 3, stem: "", choices: ["", "", "", ""], answer: 0, explanation: "" };
}

function readingQuestionTemplate(id) {
  return {
    title: "阅读程序",
    statement: "阅读下面程序并回答问题。",
    code: "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    return 0;\n}",
    subquestions: [
      objectiveQuestionTemplate("judge", "s1"),
      objectiveQuestionTemplate("judge", "s2"),
      objectiveQuestionTemplate("judge", "s3"),
      objectiveQuestionTemplate("single", "s4"),
      objectiveQuestionTemplate("single", "s5"),
      objectiveQuestionTemplate("single", "s6")
    ]
  };
}

function completionQuestionTemplate(id) {
  return {
    title: "完善程序",
    statement: "阅读题目说明和程序，选择各空应填内容。",
    code: "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    __①__;\n    return 0;\n}",
    subquestions: ["s1", "s2", "s3", "s4", "s5"].map((subId) => objectiveQuestionTemplate("single", subId))
  };
}

function nextPaperId() {
  const used = new Set(state.manage.papers.map((paper) => String(paper.id || "")));
  let index = 1;
  while (used.has(String(index).padStart(4, "0"))) index += 1;
  return String(index).padStart(4, "0");
}

function samplePaper(id = nextPaperId()) {
  return {
    id,
    title: "新建练习卷",
    category: "gesp",
    level: 1,
    language: "C++",
    year: new Date().getFullYear(),
    month: "06",
    participants: 0,
    views: 0,
    summary: "请填写试卷说明",
    hidden: false,
    questions: [{ id: "q1", type: "single", score: 2, stem: "示例单选题", choices: ["A 选项", "B 选项", "C 选项", "D 选项"], answer: 0, explanation: "这里写解析。" }]
  };
}

function showPaperList() {
  state.manage.paperView = "list";
  renderManage({ skipFetch: true });
}

function createNewPaper() {
  state.manage.editPaper = samplePaper();
  state.manage.paperView = "editor";
  renderManage({ skipFetch: true });
}

function loadPaperIntoEditor(id) {
  const paper = state.manage.papers.find((item) => item.id === id) || samplePaper();
  state.manage.editPaper = JSON.parse(JSON.stringify(paper));
  state.manage.paperView = "editor";
  renderManage({ skipFetch: true });
}

async function savePaperFromEditor() {
  try {
    const baseUpdatedAt = state.manage.editPaper?.updatedAt || state.manage.editPaper?.createdAt || "";
    let paper = collectBuilderPaper();
    const jsonDetails = document.querySelector(".advanced-json");
    if (jsonDetails?.open && document.querySelector("#paperJson").value.trim()) paper = JSON.parse(document.querySelector("#paperJson").value);
    const data = await api("/api/admin/papers", { method: "POST", body: { paper, baseUpdatedAt } });
    state.manage.editPaper = JSON.parse(JSON.stringify(data.paper || paper));
    await refreshPapers();
    notify("试卷已保存。");
    renderManage();
  } catch (error) {
    notify(error.message);
  }
}

async function deletePaperById(id) {
  if (!id) return;
  if (!window.confirm("确定删除这套试卷吗？")) return;
  try {
    await api(`/api/admin/papers/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshPapers();
    if (state.manage.editPaper?.id === id) state.manage.editPaper = samplePaper();
    state.manage.paperView = "list";
    notify("试卷已删除。");
    renderManage();
  } catch (error) {
    notify(error.message);
  }
}

async function togglePaperHidden(id) {
  const paper = state.manage.papers.find((item) => item.id === id);
  if (!paper) return;
  try {
    const hidden = !paper.hidden;
    await api("/api/admin/papers/visibility", { method: "POST", body: { id, hidden } });
    paper.hidden = hidden;
    await refreshPapers();
    if (state.manage.editPaper?.id === id) state.manage.editPaper.hidden = hidden;
    notify(hidden ? "试卷已隐藏。" : "试卷已显示。");
    await renderManage();
  } catch (error) {
    notify(error.message);
  }
}

function toggleAllPapers(event) {
  document.querySelectorAll("[data-paper-select]").forEach((item) => {
    item.checked = event.target.checked;
  });
}

function selectedPaperIds() {
  return Array.from(document.querySelectorAll("[data-paper-select]:checked")).map((item) => item.dataset.paperSelect);
}

function editableSelectedPaperIds() {
  return selectedPaperIds().filter((id) => {
    const paper = state.manage.papers.find((item) => item.id === id);
    return paper?.canManage !== false;
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function exportPapersToWord(ids) {
  if (!ids.length) return notify("请先选择或筛选要导出的试卷。");
  try {
    const response = await fetch("/api/admin/papers/export-word", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || "导出失败。");
    }
    const blob = await response.blob();
    downloadBlob(blob, `试卷导出-${new Date().toISOString().slice(0, 10)}.docx`);
    notify(`已导出 ${ids.length} 套试卷。`);
  } catch (error) {
    notify(error.message);
  }
}

function showImportProgress() {
  const container = document.querySelector(".paper-manage-list");
  if (!container) return;
  let bar = document.querySelector("#importProgressBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "importProgressBar";
    bar.className = "import-progress-bar";
    bar.innerHTML = `<div class="import-progress-fill"></div><span class="import-progress-text">正在导入 Word 试卷…</span>`;
  }
  bar.querySelector(".import-progress-fill").style.width = "0%";
  const fill = bar.querySelector(".import-progress-fill");
  container.parentNode.insertBefore(bar, container);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fill.style.width = "90%";
    });
  });
}

async function importPapersFromWord(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  showImportProgress();
  const body = new FormData();
  body.append("file", file);
  try {
    const response = await fetch("/api/admin/papers/import-word", { method: "POST", credentials: "include", body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "导入失败。");
    await refreshPapers();
    state.manage.editPaper = data.papers?.[0] || state.manage.editPaper;
    notify(`导入完成：新增 ${data.created} 套，更新 ${data.updated} 套。`);
    renderManage();
  } catch (error) {
    notify(error.message);
    renderManage();
  }
}

async function setSelectedPapersVisibility(hidden) {
  const selectedIds = selectedPaperIds();
  const ids = editableSelectedPaperIds();
  if (!selectedIds.length) return notify("请先勾选试卷。");
  if (!ids.length) return notify("选中的试卷没有可修改项。");
  try {
    await api("/api/admin/papers/visibility", { method: "POST", body: { ids, hidden } });
    await refreshPapers();
    if (state.manage.editPaper && ids.includes(state.manage.editPaper.id)) state.manage.editPaper.hidden = hidden;
    const skipped = selectedIds.length - ids.length;
    notify(`${hidden ? "已隐藏" : "已显示"} ${ids.length} 套试卷。${skipped ? `已跳过 ${skipped} 套只读试卷。` : ""}`);
    await renderManage();
  } catch (error) {
    notify(error.message);
  }
}

async function deleteSelectedPapers() {
  const selectedIds = selectedPaperIds();
  const ids = editableSelectedPaperIds();
  if (!selectedIds.length) return notify("请先勾选要删除的试卷。");
  if (!ids.length) return notify("选中的试卷没有可删除项。");
  if (!window.confirm(`确定删除选中的 ${ids.length} 套试卷吗？`)) return;
  try {
    for (const id of ids) {
      await api(`/api/admin/papers/${encodeURIComponent(id)}`, { method: "DELETE" });
    }
    await refreshPapers();
    if (ids.includes(state.manage.editPaper?.id)) state.manage.editPaper = samplePaper();
    state.manage.paperView = "list";
    const skipped = selectedIds.length - ids.length;
    notify(`已删除 ${ids.length} 套试卷。${skipped ? `已跳过 ${skipped} 套只读试卷。` : ""}`);
    renderManage();
  } catch (error) {
    notify(error.message);
  }
}

function updateClassLevelVisibility() {
  const categoryInput = document.querySelector("#classCategory");
  const levelInput = document.querySelector("#classLevel");
  if (!categoryInput || !levelInput) return;
  levelInput.hidden = !examTypeById(categoryInput.value).levelEnabled;
}

function renderClassStudentAdder(klass) {
  const candidates = (state.manage.students || []).filter((student) => !(student.enrolledClassIds || []).includes(klass.id));
  return `
    <div class="class-student-adder">
      <h3 class="subhead">添加学生到班级</h3>
      <div class="student-pick-list">
        ${candidates.map((student) => `<label class="inline-check"><input type="checkbox" data-student-add="${student.id}"><span>${escapeHtml(student.username)}${student.teacherName ? `<small>${escapeHtml(student.teacherName)}</small>` : ""}</span></label>`).join("") || `<div class="muted">暂无可添加学生。</div>`}
      </div>
      <div class="submit-row">
        <button class="secondary-btn" type="button" id="addSelectedStudents" ${candidates.length ? "" : "disabled"}>添加选中学生</button>
        <button class="primary-btn" type="button" id="addAllStudents" ${candidates.length ? "" : "disabled"}>添加全部可选学生</button>
      </div>
      ${renderPager(state.manage.studentsPagination, "manage-students")}
    </div>
  `;
}

function renderExamTypeAdmin() {
  return `
    <div class="panel settings-card">
      <div class="panel-head"><h2>考试类型</h2></div>
      <div class="panel-body">
        <div class="settings-compact-form">
          <input id="newExamTypeId" placeholder="类型 ID，如 noip">
          <input id="newExamTypeName" placeholder="显示名称，如 NOIP 初赛">
          <label class="inline-check"><input id="newExamTypeLevelEnabled" type="checkbox">需要等级</label>
          <button class="primary-btn" type="button" id="saveExamType">保存类型</button>
        </div>
        <ul class="mini-list exam-type-list setting-list">
          ${state.examTypes.map((type) => `<li><span>${escapeHtml(type.name)}<div class="muted">${escapeHtml(type.id)} · ${type.levelEnabled ? "有等级" : "无等级"}${type.builtIn ? " · 内置" : ""}</div></span>${type.builtIn ? `<span class="muted">固定</span>` : `<button class="danger-btn" type="button" data-delete-exam-type="${type.id}">删除</button>`}</li>`).join("")}
        </ul>
      </div>
    </div>
  `;
}

function renderBackupAdmin() {
  const backups = state.manage.backups || [];
  return `
    <div class="panel settings-card">
      <div class="panel-head"><h2>数据备份</h2></div>
      <div class="panel-body">
        <p class="muted settings-card-note">立即备份当前运行数据、试卷镜像和 SQLite 数据库，备份文件保存在服务器的 backups 目录。</p>
        <div class="settings-action-row">
          <button class="primary-btn" type="button" id="createBackup">一键备份</button>
          <button class="secondary-btn" type="button" id="refreshBackups">查看备份</button>
        </div>
        <div class="backup-result muted" id="backupResult">自动备份会在服务启动时执行，之后按配置定时执行。</div>
        <details class="backup-restore-box" ${backups.length ? "open" : ""}>
          <summary><span>可恢复备份</span><span class="muted">${backups.length ? `${backups.length} 份` : "点击查看备份"}</span></summary>
          <ul class="mini-list backup-list">
            ${backups.map((backup) => `
              <li>
                <span>
                  <strong>${escapeHtml(backup.name)}</strong>
                  <div class="muted">${escapeHtml(formatDateTime(backup.createdAt))} · ${escapeHtml(backup.reason || "manual")} · ${backup.papers || 0} 套试卷 · ${backup.attempts || 0} 条提交</div>
                </span>
                <button class="danger-btn" type="button" data-restore-backup="${escapeHtml(backup.name)}">恢复</button>
              </li>
            `).join("") || `<li class="muted">还没有加载备份列表。</li>`}
          </ul>
        </details>
      </div>
    </div>
  `;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

async function createBackup() {
  const button = document.querySelector("#createBackup");
  const result = document.querySelector("#backupResult");
  if (button) button.disabled = true;
  if (result) result.textContent = "正在备份，请稍候...";
  try {
    const data = await api("/api/admin/backup", { method: "POST" });
    const backup = data.backup || {};
    if (result) {
      result.innerHTML = `备份完成：<strong>${escapeHtml(backup.name || "")}</strong><br>文件：${(backup.files || []).map(escapeHtml).join("、") || "无"}；试卷 ${backup.papers || 0} 套。`;
    }
    await loadBackups(false);
    notify("备份已完成。");
  } catch (error) {
    if (result) result.textContent = error.message;
    notify(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

async function saveRegistrationSettings() {
  try {
    const allowRegistration = document.querySelector("#allowRegistration").checked;
    const data = await api("/api/admin/settings", { method: "POST", body: { allowRegistration } });
    state.allowRegistration = data.settings?.allowRegistration !== false;
    notify("注册设置已保存。");
    renderManage();
  } catch (error) {
    notify(error.message);
  }
}

async function loadBackups(rerender = true) {
  try {
    const data = await api("/api/admin/backups");
    state.manage.backups = data.backups || [];
    if (rerender) renderManage();
  } catch (error) {
    notify(error.message);
  }
}

async function restoreBackup(name) {
  if (!name) return;
  const message = `确定恢复到备份 ${name} 吗？\n\n恢复前系统会自动创建一份当前数据的安全备份。恢复后当前账号、班级、作业、提交记录和试卷会回到该备份状态。`;
  if (!window.confirm(message)) return;
  try {
    const data = await api(`/api/admin/backups/${encodeURIComponent(name)}/restore`, { method: "POST" });
    const restored = data.restored || {};
    state.manage.backups = [];
    notify(`已恢复备份。安全备份：${restored.safetyBackup || "已创建"}`);
    await Promise.all([refreshPapers(), refreshMe(), refreshExamTypes()]);
    renderManage();
  } catch (error) {
    notify(error.message);
  }
}

async function loadClassReport(classId, options = {}) {
  try {
    state.manage.tab = "classes";
    if (options.reset) {
      state.manage.classReportPages = { studentsPage: 1, attemptsPage: 1 };
      state.manage.classDetailTab = "students";
    }
    const pages = state.manage.classReportPages || { studentsPage: 1, attemptsPage: 1 };
    const params = new URLSearchParams({
      studentsPage: String(pages.studentsPage || 1),
      attemptsPage: String(pages.attemptsPage || 1)
    });
    state.manage.classReport = await api(`/api/classes/${encodeURIComponent(classId)}/report?${params.toString()}`);
    if (!options.silent) notify("班级已加载。");
    renderManage();
  } catch (error) {
    notify(error.message);
  }
}

async function saveExamType() {
  try {
    const id = document.querySelector("#newExamTypeId").value;
    const name = document.querySelector("#newExamTypeName").value;
    const levelEnabled = document.querySelector("#newExamTypeLevelEnabled").checked;
    await api("/api/admin/exam-types", { method: "POST", body: { id, name, levelEnabled } });
    await refreshExamTypes();
    notify("考试类型已保存。");
    renderManage();
  } catch (error) {
    notify(error.message);
  }
}

async function deleteExamType(id) {
  try {
    await api(`/api/admin/exam-types/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshExamTypes();
    notify("考试类型已删除。");
    renderManage();
  } catch (error) {
    notify(error.message);
  }
}

async function createClass() {
  try {
    const category = document.querySelector("#classCategory").value;
    const examType = examTypeById(category);
    await api("/api/classes", {
      method: "POST",
      body: {
        name: document.querySelector("#className").value,
        category,
        level: examType.levelEnabled ? document.querySelector("#classLevel").value : null
      }
    });
    await refreshMe();
    notify("班级已创建。");
    renderManage();
  } catch (error) {
    notify(error.message);
  }
}

async function createAssignment() {
  const classId = document.querySelector("#assignmentClass").value;
  const paperId = document.querySelector("#assignmentPaper").value;
  if (!classId || !paperId) return notify("请先选择班级和试卷。");
  try {
    await api(`/api/classes/${encodeURIComponent(classId)}/assignments`, {
      method: "POST",
      body: {
        paperId,
        startAt: document.querySelector("#assignmentStart").value,
        endAt: document.querySelector("#assignmentEnd").value,
        duration: Number(document.querySelector("#assignmentDuration").value) || 0
      }
    });
    notify("作业已发布。");
    if (state.manage.classReport?.class?.id === classId) {
      await loadClassReport(classId, { silent: true });
    } else {
      renderManage();
    }
  } catch (error) {
    notify(error.message);
  }
}

async function addStudentsToActiveClass(all) {
  const classId = state.manage.classReport?.class?.id;
  if (!classId) return notify("请先进入一个班级。");
  const candidates = (state.manage.students || []).filter((student) => !(student.enrolledClassIds || []).includes(classId));
  const selectedIds = all
    ? candidates.map((student) => student.id)
    : Array.from(document.querySelectorAll("[data-student-add]:checked")).map((input) => input.dataset.studentAdd);
  if (!selectedIds.length) return notify("请先选择学生。");
  try {
    const data = await api(`/api/classes/${encodeURIComponent(classId)}/students`, { method: "POST", body: { studentIds: selectedIds } });
    notify(`已添加 ${data.added} 名学生。`);
    await loadClassReport(classId, { silent: true });
  } catch (error) {
    notify(error.message);
  }
}

function renderUserAdmin() {
  const teachers = state.manage.userTeachers.length ? state.manage.userTeachers : state.manage.users.filter((user) => user.role === "teacher" || user.role === "admin");
  const students = state.manage.students || [];
  const teacherOptions = `<option value="">不绑定老师</option>${teachers.map((teacher) => `<option value="${teacher.id}">${escapeHtml(teacher.username)} · ${roleName(teacher.role)}</option>`).join("")}`;
  const studentOptions = students.map((student) => `<option value="${student.id}">${escapeHtml(student.username)}${student.teacherName ? ` · 当前 ${escapeHtml(student.teacherName)}` : ""}</option>`).join("");
  const userTotal = state.manage.usersPagination?.total ?? state.manage.users.length;
  return `
    <div class="panel settings-user-panel">
      <div class="panel-head"><h2>用户管理</h2><span class="muted">${userTotal} 个账号</span></div>
      <div class="panel-body">
        <div class="user-admin-grid">
          <section class="settings-block">
            <h3 class="subhead">单个创建</h3>
            <div class="stack-form">
              <input id="newUsername" placeholder="新账号">
              <input id="newPassword" type="password" placeholder="初始密码">
              <select id="newRole"><option value="student">学生</option><option value="teacher">教师</option><option value="admin">管理员</option></select>
              <select id="newStudentTeacher">${teacherOptions}</select>
              <button class="primary-btn" type="button" id="createUser">创建用户</button>
            </div>
          </section>
          <section class="settings-block">
            <h3 class="subhead">Excel 批量导入</h3>
            <div class="bulk-import-box">
              <select id="bulkRole"><option value="student">创建为学生账号</option><option value="teacher">创建为教师账号</option></select>
              <select id="bulkStudentTeacher">${teacherOptions}</select>
              <input id="bulkUserFile" type="file" accept=".xlsx,.xls,.csv">
              <button class="primary-btn" type="button" id="importUsers">上传并创建</button>
            </div>
            <p class="muted import-hint">Excel 第一行表头包含“用户名”和“密码”即可；也支持 username/password。</p>
            ${renderImportResult()}
          </section>
          <section class="settings-block">
            <h3 class="subhead">绑定已有学生</h3>
            <div class="stack-form">
              <select id="bindStudentId">${studentOptions || `<option value="">暂无学生账号</option>`}</select>
              <select id="bindTeacherId">${teacherOptions}</select>
              <button class="primary-btn" type="button" id="bindStudentTeacher" ${students.length ? "" : "disabled"}>保存绑定</button>
            </div>
          </section>
          <section class="settings-block">
            <h3 class="subhead">批量维护</h3>
            <div class="stack-form">
              <input id="bulkResetPassword" type="password" placeholder="给勾选账号设置新密码">
              <button class="danger-btn" type="button" id="resetSelectedPasswords">批量重置密码</button>
              <select id="exportTeacherId">${teacherOptions}</select>
              <button class="danger-btn" type="button" id="resetTeacherStudents">重置该教师学生密码</button>
              <button class="secondary-btn" type="button" id="exportTeacherStudents">按教师导出学生</button>
            </div>
          </section>
          <details class="settings-block user-list-block user-list-dropdown">
            <summary><span>账号列表</span><span class="muted">分页显示</span></summary>
            <ul class="mini-list user-admin-list">${state.manage.users.map((user) => `<li><label class="inline-check"><input type="checkbox" data-user-select="${user.id}"><span>${escapeHtml(user.username)}<div class="muted">${roleName(user.role)}${user.teacherName ? ` · ${escapeHtml(user.teacherName)}` : ""}</div></span></label><span class="muted">${user.attemptCount} 次</span></li>`).join("")}</ul>
            ${renderPager(state.manage.usersPagination, "manage-users")}
          </details>
        </div>
      </div>
    </div>
  `;
}

function updateUserTeacherField() {
  const newRole = document.querySelector("#newRole");
  const newStudentTeacher = document.querySelector("#newStudentTeacher");
  if (newRole && newStudentTeacher) newStudentTeacher.hidden = newRole.value !== "student";
  const bulkRole = document.querySelector("#bulkRole");
  const bulkStudentTeacher = document.querySelector("#bulkStudentTeacher");
  if (bulkRole && bulkStudentTeacher) bulkStudentTeacher.hidden = bulkRole.value !== "student";
}

function renderImportResult() {
  const result = state.manage.importResult;
  if (!result) return "";
  const problems = [...(result.failed || []), ...(result.skipped || [])].slice(0, 8);
  return `
    <div class="import-result">
      <strong>导入完成：成功 ${result.created} 个 / 共 ${result.total} 行</strong>
      <span class="muted">角色：${roleName(result.role)}</span>
      ${problems.length ? `<ul>${problems.map((item) => `<li>第 ${item.row} 行 ${escapeHtml(item.username || "")}：${escapeHtml(item.message)}</li>`).join("")}</ul>` : ""}
    </div>
  `;
}

async function createUser() {
  try {
    await api("/api/admin/users", {
      method: "POST",
      body: {
        username: document.querySelector("#newUsername").value,
        password: document.querySelector("#newPassword").value,
        role: document.querySelector("#newRole").value,
        teacherId: document.querySelector("#newStudentTeacher")?.value || ""
      }
    });
    notify("用户已创建。");
    renderManage();
  } catch (error) {
    notify(error.message);
  }
}

async function importUsersFromExcel() {
  const fileInput = document.querySelector("#bulkUserFile");
  const file = fileInput?.files?.[0];
  if (!file) return notify("请先选择 Excel 文件。");
  const body = new FormData();
  body.append("role", document.querySelector("#bulkRole").value);
  body.append("teacherId", document.querySelector("#bulkStudentTeacher")?.value || "");
  body.append("file", file);
  try {
    const response = await fetch("/api/admin/users/import", { method: "POST", credentials: "include", body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "导入失败。");
    state.manage.importResult = data;
    notify(`导入完成，成功创建 ${data.created} 个账号。`);
    renderManage();
  } catch (error) {
    notify(error.message);
  }
}

async function bindStudentTeacher() {
  const studentId = document.querySelector("#bindStudentId")?.value;
  const teacherId = document.querySelector("#bindTeacherId")?.value || "";
  if (!studentId) return notify("请先选择学生账号。");
  try {
    await api(`/api/admin/users/${encodeURIComponent(studentId)}/role`, {
      method: "POST",
      body: { role: "student", status: "active", teacherId }
    });
    notify("学生所属老师已更新。");
    renderManage();
  } catch (error) {
    notify(error.message);
  }
}

function selectedUserIds() {
  return Array.from(document.querySelectorAll("[data-user-select]:checked")).map((input) => input.dataset.userSelect);
}

async function resetSelectedPasswords() {
  const userIds = selectedUserIds();
  const password = document.querySelector("#bulkResetPassword")?.value || "";
  if (!userIds.length) return notify("请先在账号列表中勾选账号。");
  if (password.length < 6) return notify("新密码至少 6 位。");
  if (!window.confirm(`确定重置 ${userIds.length} 个账号的密码吗？`)) return;
  try {
    const data = await api("/api/admin/users/reset-passwords", { method: "POST", body: { userIds, password } });
    notify(`已重置 ${data.updated || 0} 个账号的密码。`);
    document.querySelector("#bulkResetPassword").value = "";
    renderManage();
  } catch (error) {
    notify(error.message);
  }
}

async function resetTeacherStudentsPasswords() {
  const teacherId = document.querySelector("#exportTeacherId")?.value || "";
  const password = document.querySelector("#bulkResetPassword")?.value || "";
  if (!teacherId) return notify("请先选择教师。");
  if (password.length < 6) return notify("新密码至少 6 位。");
  if (!window.confirm("确定重置该教师名下所有学生的密码吗？")) return;
  try {
    const data = await api("/api/admin/users/reset-passwords", { method: "POST", body: { teacherId, password } });
    notify(`已重置 ${data.updated || 0} 个学生账号的密码。`);
    document.querySelector("#bulkResetPassword").value = "";
    renderManage();
  } catch (error) {
    notify(error.message);
  }
}

async function exportTeacherStudents() {
  const teacherId = document.querySelector("#exportTeacherId")?.value || "";
  if (!teacherId) return notify("请先选择教师。");
  try {
    const response = await fetch(`/api/admin/users/export?teacherId=${encodeURIComponent(teacherId)}`, { credentials: "include" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || "导出失败。");
    }
    downloadBlob(await response.blob(), `teacher-students-${new Date().toISOString().slice(0, 10)}.csv`);
  } catch (error) {
    notify(error.message);
  }
}

async function exportActiveClassStudents() {
  const classId = state.manage.classReport?.class?.id;
  if (!classId) return notify("请先进入一个班级。");
  try {
    const response = await fetch(`/api/classes/${encodeURIComponent(classId)}/students/export`, { credentials: "include" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || "导出失败。");
    }
    downloadBlob(await response.blob(), `class-students-${new Date().toISOString().slice(0, 10)}.csv`);
  } catch (error) {
    notify(error.message);
  }
}

async function archiveTermData() {
  const archiveTerm = document.querySelector("#archiveTerm")?.value || "";
  const beforeDate = document.querySelector("#archiveBeforeDate")?.value || "";
  const result = document.querySelector("#archiveResult");
  if (!beforeDate) return notify("请先选择归档截止日期。");
  if (!window.confirm(`确定归档 ${beforeDate} 之前的旧班级、旧作业和旧答题记录吗？建议先备份。`)) return;
  try {
    const data = await api("/api/admin/archive/term", { method: "POST", body: { archiveTerm, beforeDate } });
    const archive = data.archive || {};
    if (result) result.textContent = `归档完成：班级 ${archive.classes || 0} 个，作业 ${archive.assignments || 0} 个，答题记录 ${archive.attempts || 0} 条。`;
    state.manage._dataLoaded = false;
    await loadArchives(false);
    await Promise.all([refreshMe(), refreshPapers()]);
    renderManage();
  } catch (error) {
    notify(error.message);
  }
}

async function loadArchives(rerender = true) {
  try {
    const data = await api("/api/admin/archive/terms");
    state.manage.archives = data.archives || [];
    if (rerender) renderManage();
  } catch (error) {
    notify(error.message);
  }
}

async function restoreArchive(archiveTerm) {
  if (!archiveTerm) return;
  if (!window.confirm(`确定恢复归档「${archiveTerm}」吗？恢复后对应班级、作业和答题记录会重新进入日常页面。`)) return;
  try {
    const data = await api("/api/admin/archive/restore", { method: "POST", body: { archiveTerm } });
    const restored = data.restored || {};
    notify(`已恢复：班级 ${restored.classes || 0} 个，作业 ${restored.assignments || 0} 个，答题 ${restored.attempts || 0} 条。`);
    state.manage._dataLoaded = false;
    await Promise.all([loadArchives(false), refreshMe(), refreshPapers()]);
    renderManage();
  } catch (error) {
    notify(error.message);
  }
}

function openAuth() {
  closeAccountMenu();
  state.authMode = "login";
  renderAuthMode();
  authDialog.showModal();
  authUsername.focus();
}

function renderAuthMode() {
  if (!state.allowRegistration && state.authMode === "register") state.authMode = "login";
  const isLogin = state.authMode === "login";
  authTitle.textContent = isLogin ? "登录" : "创建学生账号";
  authHint.textContent = isLogin
    ? (state.allowRegistration ? "登录后可以保存记录、加入班级或进入管理台。" : "公开注册已关闭，请使用管理员分配的账号登录。")
    : "公开注册只创建学生账号；教师账号由管理员创建。";
  submitAuth.textContent = isLogin ? "登录" : "创建并登录";
  toggleAuth.textContent = isLogin ? "创建账号" : "已有账号，去登录";
  toggleAuth.hidden = isLogin && !state.allowRegistration;
  authPassword.autocomplete = isLogin ? "current-password" : "new-password";
}

async function handleAuth() {
  try {
    const data = await api(state.authMode === "login" ? "/api/login" : "/api/register", { method: "POST", body: { username: authUsername.value, password: authPassword.value } });
    state.user = data.user;
    authDialog.close();
    authUsername.value = "";
    authPassword.value = "";
    await refreshMe();
    updateAuthButton();
    route();
    notify(state.authMode === "login" ? "登录成功。" : "账号创建成功。");
  } catch (error) {
    notify(error.message);
  }
}

async function logout() {
  closeAccountMenu();
  await api("/api/logout", { method: "POST" });
  state.user = null;
  state.attempts = [];
  state.classes = [];
  state.dashboard.attemptsPage = 1;
  state.dashboard.attemptsPagination = null;
  updateAuthButton();
  route();
  notify("已退出登录。");
}

function openPasswordDialog() {
  closeAccountMenu();
  currentPassword.value = "";
  newPassword.value = "";
  confirmNewPassword.value = "";
  passwordDialog.showModal();
  currentPassword.focus();
}

async function changePassword() {
  const next = newPassword.value;
  if (next.length < 6) return notify("新密码至少 6 位。");
  if (next !== confirmNewPassword.value) return notify("两次输入的新密码不一致。");
  try {
    await api("/api/me/password", { method: "POST", body: { currentPassword: currentPassword.value, newPassword: next } });
    passwordDialog.close();
    notify("密码已修改。");
  } catch (error) {
    notify(error.message);
  }
}

function closeAccountMenu() {
  accountMenu.hidden = true;
  authButton.setAttribute("aria-expanded", "false");
}

function toggleAccountMenu() {
  if (!state.user) {
    openAuth();
    return;
  }
  accountMenu.hidden = !accountMenu.hidden;
  authButton.setAttribute("aria-expanded", String(!accountMenu.hidden));
}

function updateAuthButton() {
  const canManage = Boolean(isTeacher());
  accountWorkbenchLink.hidden = !canManage;
  accountWorkbenchLink.style.display = canManage ? "" : "none";
  accountManageLink.hidden = !canManage;
  accountManageLink.style.display = canManage ? "" : "none";
  authButton.textContent = state.user ? state.user.username : "登录";
  if (!state.user) closeAccountMenu();
}

async function refreshMe() {
  const params = new URLSearchParams({
    attemptsPage: String(state.dashboard.attemptsPage || 1)
  });
  const data = await api(`/api/me?${params.toString()}`);
  state.user = data.user;
  state.attempts = data.attempts || [];
  state.dashboard.attemptsPagination = data.pagination?.attempts || null;
  state.classes = data.classes || [];
  updateAuthButton();
}

async function refreshPapers() {
  const papersData = await api("/api/papers");
  state.papers = papersData.papers || [];
}

async function refreshExamTypes() {
  const data = await api("/api/exam-types");
  state.examTypes = data.examTypes || [];
}

async function refreshAppConfig() {
  const data = await api("/api/health");
  state.programSubmissionEnabled = Boolean(data.programSubmissionEnabled);
  state.allowRegistration = data.settings?.allowRegistration !== false;
}

async function init() {
  try {
    await Promise.all([refreshAppConfig(), refreshExamTypes(), refreshPapers(), refreshMe()]);
  } catch (error) {
    app.innerHTML = `<div class="panel empty">启动失败：${escapeHtml(error.message)}</div>`;
    return;
  }
  route();
}

authButton.addEventListener("click", toggleAccountMenu);
changePasswordButton.addEventListener("click", openPasswordDialog);
logoutButton.addEventListener("click", logout);
accountMenu.addEventListener("click", (event) => {
  if (event.target.closest("a")) closeAccountMenu();
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".account-menu")) closeAccountMenu();
});
closeAuth.addEventListener("click", () => authDialog.close());
savePassword.addEventListener("click", changePassword);
closePasswordDialog.addEventListener("click", () => passwordDialog.close());
cancelPasswordDialog.addEventListener("click", () => passwordDialog.close());
toggleAuth.addEventListener("click", () => {
  state.authMode = state.authMode === "login" ? "register" : "login";
  renderAuthMode();
});
submitAuth.addEventListener("click", handleAuth);
authPassword.addEventListener("keydown", (event) => {
  if (event.key === "Enter") handleAuth();
});
codeSnippetInput.addEventListener("input", updateCodeSnippetPreview);
codeLanguageInput.addEventListener("input", updateCodeSnippetPreview);
insertCodeSnippet.addEventListener("click", confirmCodeInsert);
closeCodeInsert.addEventListener("click", () => codeInsertDialog.close());
cancelCodeInsert.addEventListener("click", () => codeInsertDialog.close());
formulaSnippetInput.addEventListener("input", updateFormulaSnippetPreview);
formulaDisplayMode.addEventListener("change", updateFormulaSnippetPreview);
insertFormulaSnippet.addEventListener("click", confirmFormulaInsert);
closeFormulaInsert.addEventListener("click", () => formulaInsertDialog.close());
cancelFormulaInsert.addEventListener("click", () => formulaInsertDialog.close());
confirmSubmitBtn.addEventListener("click", () => {
  submitConfirmDialog.close();
  if (pendingSubmitPaperId) doSubmitObjective(pendingSubmitPaperId);
});
cancelSubmitBtn.addEventListener("click", () => submitConfirmDialog.close());
closeSubmitConfirm.addEventListener("click", () => submitConfirmDialog.close());
window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", () => {
  if (activeDraftPaperId) savePaperDraft(activeDraftPaperId);
  stopExamTimers();
});

init();
