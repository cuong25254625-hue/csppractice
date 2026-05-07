const state = {
  papers: [],
  user: null,
  attempts: [],
  classes: [],
  examTypes: [],
  authMode: "login",
  filters: { category: "all", level: "all", keyword: "" },
  manage: { papers: [], overview: null, users: [], editPaper: null, classReport: null, tab: "papers", importResult: null }
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
const logoutButton = document.querySelector("#logoutButton");
const codeInsertDialog = document.querySelector("#codeInsertDialog");
const codeLanguageInput = document.querySelector("#codeLanguageInput");
const codeSnippetInput = document.querySelector("#codeSnippetInput");
const codeSnippetPreview = document.querySelector("#codeSnippetPreview");
const insertCodeSnippet = document.querySelector("#insertCodeSnippet");
const closeCodeInsert = document.querySelector("#closeCodeInsert");
const cancelCodeInsert = document.querySelector("#cancelCodeInsert");
let pendingMarkdownTextarea = null;

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
  html = html.replace(/\$([^$\n]+)\$/g, '<span class="math-inline">$1</span>');
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return html;
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
      return `<div class="math-block">${escapeHtml(block.slice(2, -2).trim())}</div>`;
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
  const name = hash.startsWith("#/manage") ? "manage" : hash.startsWith("#/classes") ? "classes" : hash === "#/study" ? "study" : hash === "#/dashboard" ? "dashboard" : "home";
  document.querySelector(`[data-link="${name}"]`)?.classList.add("active");
}

function route() {
  const hash = location.hash || "#/";
  setActiveNav(hash);
  if (hash.startsWith("#/paper/")) return renderPaper(decodeURIComponent(hash.replace("#/paper/", "")));
  if (hash === "#/dashboard") return renderDashboard();
  if (hash === "#/study") return renderStudy();
  if (hash === "#/classes") return renderClasses();
  if (hash === "#/manage") return renderManage();
  renderHome();
}

function paperStats(paper) {
  const questions = paper.questions || [];
  return {
    fullScore: questions.reduce((sum, question) => sum + (question.score || 0), 0),
    objective: questions.filter((question) => question.type === "single" || question.type === "judge").length,
    program: questions.filter((question) => question.type === "program").length
  };
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
                ? `<p><strong>${escapeHtml(state.user.username)}</strong> · ${roleName(state.user.role)}</p><p class="muted">最近记录：${state.attempts.length} 条</p><div class="submit-row"><a class="secondary-btn" href="#/study">学习中心</a>${isTeacher() ? `<a class="primary-btn" href="#/manage">管理台</a>` : ""}</div>`
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

function renderPaper(paperId) {
  const paper = state.papers.find((item) => item.id === paperId);
  if (!paper) {
    app.innerHTML = `<div class="panel empty">试卷不存在</div>`;
    return;
  }
  const stats = paperStats(paper);
  const objectiveQuestions = paper.questions.filter((question) => question.type === "single" || question.type === "judge");
  const groups = [
    ["一、单选题", paper.questions.filter((question) => question.type === "single")],
    ["二、判断题", paper.questions.filter((question) => question.type === "judge")],
    ["三、编程题", paper.questions.filter((question) => question.type === "program")]
  ];

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

        ${paper.questions.length ? groups.map(([title, questions]) => renderQuestionGroup(title, questions)).join("") : `<div class="panel empty" style="margin-top: 18px;">这套试卷还没有题目。</div>`}
      </section>

      <aside class="panel answer-card">
        <div class="panel-head"><h2>答题卡</h2></div>
        <div class="panel-body">
          <div class="answer-grid">
            ${paper.questions.map((question, index) => `<a href="#q-${question.id}" data-card="${question.id}" data-jump-question="${question.id}">${index + 1}</a>`).join("")}
          </div>
          <div class="submit-row">
            <button class="primary-btn" type="button" id="submitObjective" ${objectiveQuestions.length ? "" : "disabled"}>提交</button>
          </div>
          <div class="score-box" id="scoreBox">
            <div class="muted">单选和判断题自动判分；编程题逐题提交。</div>
          </div>
        </div>
      </aside>
    </div>
  `;

  document.querySelectorAll("input[type='radio'], textarea").forEach((element) => {
    element.addEventListener("input", updateAnswerCard);
    element.addEventListener("change", updateAnswerCard);
  });
  document.querySelector("#submitObjective")?.addEventListener("click", () => submitObjective(paper.id));
  document.querySelectorAll("[data-run-code]").forEach((button) => button.addEventListener("click", () => submitCode(paper.id, button.dataset.runCode)));
  document.querySelectorAll("[data-jump-question]").forEach((link) => link.addEventListener("click", jumpToQuestion));
  updateAnswerCard();
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

function renderQuestion(question, index) {
  const typeLabel = question.type === "single" ? "单选" : question.type === "judge" ? "判断" : "编程";
  return `
    <article class="panel question" id="q-${question.id}" data-question="${question.id}" data-type="${question.type}">
      <div class="panel-body">
        <div class="question-head">
          <span>第 ${index + 1} 题 · ${typeLabel}</span>
          <span class="muted">${question.score} 分</span>
        </div>
        ${question.type === "program" ? renderProgramQuestion(question) : renderObjectiveQuestion(question)}
      </div>
    </article>
  `;
}

function renderObjectiveQuestion(question) {
  const options = question.type === "judge"
    ? [{ label: "A. 正确", value: "true" }, { label: "B. 错误", value: "false" }]
    : question.choices.map((choice, index) => ({ prefix: String.fromCharCode(65 + index), label: choice, value: String(index) }));
  return `
    <div class="stem rich-text">${renderMarkdown(question.stem)}</div>
    <div class="options">
      ${options.map((option) => `<label class="option" data-option="${question.id}:${option.value}"><input type="radio" name="${question.id}" value="${option.value}"><span>${option.prefix ? `${option.prefix}. ${renderInlineMarkdown(option.label)}` : escapeHtml(option.label)}</span></label>`).join("")}
    </div>
    <div class="score-box" hidden data-explain="${question.id}"></div>
  `;
}

function renderProgramQuestion(question) {
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
        <textarea class="code-editor" id="code-${question.id}" spellcheck="false">${escapeHtml(defaultCode())}</textarea>
        <div class="submit-row"><button class="primary-btn" type="button" data-run-code="${question.id}">提交代码</button></div>
        <div class="score-box" id="result-${question.id}"><div class="muted">提交后会编译 C++，并运行样例与测试点。</div></div>
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
      : Boolean(document.querySelector(`input[name="${id}"]:checked`));
    card.classList.toggle(type === "program" ? "program-done" : "done", done);
  });
}

async function submitObjective(paperId) {
  if (!state.user) {
    openAuth();
    notify("请先登录再提交。");
    return;
  }
  const answers = {};
  document.querySelectorAll("[data-question]").forEach((item) => {
    if (item.dataset.type === "program") return;
    const checked = document.querySelector(`input[name="${item.dataset.question}"]:checked`);
    if (checked) answers[item.dataset.question] = checked.value;
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
    }
    document.querySelectorAll(`[data-option^="${detail.id}:"]`).forEach((option) => {
      const value = option.dataset.option.split(":")[1];
      option.classList.toggle("correct", value === String(detail.answer));
      option.classList.toggle("wrong", !detail.correct && value === String(detail.userAnswer));
    });
  });
}

async function submitCode(paperId, questionId) {
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
  let summary = { totals: { attempts: 0, assignments: 0, pendingAssignments: 0, wrongQuestions: 0 }, assignments: [], wrongQuestions: [], progress: [] };
  try {
    summary = await api("/api/student/summary");
  } catch (error) {
    notify(error.message);
  }
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
        <div class="panel" style="margin-top: 18px;">
          <div class="panel-head"><h2>待完成作业</h2></div>
          <ul class="paper-list">
            ${summary.assignments.filter((item) => !item.done).map((item) => `<li class="paper-item"><span class="paper-icon">作业</span><div><h3><a href="#/paper/${item.paperId}">${escapeHtml(item.title)}</a></h3><div class="meta"><span>${escapeHtml(item.className)}</span><span>截止 ${escapeHtml(item.dueAt || "长期")}</span><span>${item.bestObjective ? renderScoreBadge(item.bestObjective.score, item.bestObjective.fullScore, "客观题") : "客观题未提交"}</span><span>编程题 ${item.acceptedPrograms}/${item.programTotal}</span></div></div><a class="primary-btn" href="#/paper/${item.paperId}">去完成</a></li>`).join("") || `<li class="empty">暂无待完成作业</li>`}
          </ul>
        </div>
        <div class="panel" style="margin-top: 18px;">
          <div class="panel-head"><h2>错题本</h2><span class="muted">${summary.wrongQuestions.length} 题</span></div>
          <div class="panel-body wrong-list">${summary.wrongQuestions.map((item) => renderWrongQuestion(item)).join("") || `<div class="empty">还没有错题，保持住。</div>`}</div>
        </div>
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
        <div class="panel">
          <div class="panel-head"><h2>已完成作业</h2></div>
          <div class="panel-body"><ul class="mini-list">${summary.assignments.filter((item) => item.done).slice(0, 8).map((item) => `<li><a href="#/paper/${item.paperId}">${escapeHtml(item.title)}</a><span class="status-ok">完成</span></li>`).join("") || `<li class="muted">暂无</li>`}</ul></div>
        </div>
      </aside>
    </div>
  `;
}

function renderWrongQuestion(item) {
  return `<article class="wrong-item"><div class="question-head"><span>${escapeHtml(item.paperTitle)}</span><a class="secondary-btn" href="#/paper/${item.paperId}">重练</a></div><div class="rich-text">${renderMarkdown(item.stem)}</div>${item.choices?.length ? `<ol class="choice-list">${item.choices.map((choice, index) => `<li>${String.fromCharCode(65 + index)}. ${renderInlineMarkdown(choice)}</li>`).join("")}</ol>` : ""}<div class="meta"><span>你的答案：${escapeHtml(formatAnswer(item, item.userAnswer))}</span><span>正确答案：${escapeHtml(formatAnswer(item, item.answer))}</span></div><div class="score-box rich-text">${renderMarkdown(item.explanation || "暂无解析")}</div></article>`;
}

function formatAnswer(item, value) {
  if (item.type === "judge") return value === true || value === "true" ? "正确" : "错误";
  const index = Number(value);
  return Number.isFinite(index) ? String.fromCharCode(65 + index) : "-";
}

function renderDashboard() {
  if (!state.user) {
    app.innerHTML = `<div class="grid"><section class="panel empty"><p>登录后可以查看练习记录。</p><button class="primary-btn" type="button" data-open-auth>登　录</button></section></div>`;
    document.querySelector("[data-open-auth]")?.addEventListener("click", openAuth);
    return;
  }
  app.innerHTML = `
    <div class="grid">
      <section class="panel">
        <div class="panel-head"><h1>练习记录</h1><span class="muted">${escapeHtml(state.user.username)} · ${roleName(state.user.role)}</span></div>
        ${state.attempts.length ? `<div class="panel-body"><table class="history-table"><thead><tr><th>时间</th><th>试卷</th><th>类型</th><th>结果</th></tr></thead><tbody>${state.attempts.map(renderAttemptRow).join("")}</tbody></table></div>` : `<div class="empty">还没有提交记录</div>`}
      </section>
      <aside class="side-stack"><div class="panel"><div class="panel-head"><h2>学习进度</h2></div><div class="panel-body"><p class="muted">提交次数：${state.attempts.length}</p><p class="muted">已加入班级：${state.classes.length}</p><a class="secondary-btn" href="#/study">进入学习中心</a></div></div></aside>
    </div>
  `;
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
  app.innerHTML = `
    <div class="grid">
      <section class="panel">
        <div class="panel-head"><h1>我的班级</h1><span class="muted">${state.classes.length} 个班级</span></div>
        <div class="panel-body">
          <div class="form-grid"><input id="joinCode" placeholder="输入教师给的邀请码"><button class="primary-btn" type="button" id="joinClass">加入班级</button></div>
          <ul class="paper-list" style="margin-top: 14px;">${state.classes.map((klass) => `<li class="paper-item"><span class="paper-icon">${examTypeById(klass.category).levelEnabled ? `${klass.level}级` : "初赛"}</span><div><h3>${escapeHtml(klass.name)}</h3><div class="meta"><span>${escapeHtml(klass.categoryName || categoryName(klass.category))}</span><span>教师 ${escapeHtml(klass.teacherName)}</span><span>学生 ${klass.studentCount}</span><span>作业 ${klass.assignmentCount}</span><span>邀请码 ${escapeHtml(klass.inviteCode)}</span></div></div></li>`).join("") || `<li class="empty">还没有加入班级</li>`}</ul>
        </div>
      </section>
      <aside class="side-stack"><div class="panel"><div class="panel-head"><h2>班级作业</h2></div><div class="panel-body"><ul class="mini-list">${(data.assignments || []).map((item) => `<li><a href="#/paper/${item.paperId}">${escapeHtml(item.title)}</a><span class="muted">${escapeHtml(item.dueAt || "长期")}</span></li>`).join("") || `<li class="muted">暂无作业</li>`}</ul></div></div></aside>
    </div>
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

async function renderManage() {
  if (!isTeacher()) {
    app.innerHTML = `<div class="panel empty">这里需要教师或管理员权限。</div>`;
    return;
  }
  try {
    const [overview, paperData, users] = await Promise.all([
      api("/api/teacher/overview"),
      api("/api/admin/papers"),
      isAdmin() ? api("/api/admin/users") : Promise.resolve({ users: [] })
    ]);
    state.manage.overview = overview;
    state.manage.papers = paperData.papers || [];
    state.manage.users = users.users || [];
  } catch (error) {
    notify(error.message);
  }

  const overview = state.manage.overview || { totals: {}, classes: [], assignments: [], recentAttempts: [] };
  state.manage.editPaper ||= samplePaper();
  const tab = state.manage.tab || "papers";
  app.innerHTML = `
    <section class="manage-shell">
      <div class="panel">
        <div class="panel-head"><h1>教学管理台</h1><span class="muted">${roleName(state.user.role)}</span></div>
        <div class="panel-body stat-grid">${statCard("试卷", overview.totals.papers || 0)}${statCard("班级", overview.totals.classes || 0)}${statCard("学生", overview.totals.students || 0)}${statCard("提交", overview.totals.attempts || 0)}</div>
      </div>
      <div class="manage-tabs" role="tablist">
        ${manageTabButton("papers", "试卷题库", tab)}
        ${manageTabButton("classes", "班级学情", tab)}
        ${manageTabButton("settings", "系统设置", tab)}
      </div>
      <div class="manage-section" ${tab === "papers" ? "" : "hidden"}>${renderManagePapersSection()}</div>
      <div class="manage-section" ${tab === "classes" ? "" : "hidden"}>${renderManageClassesSection(overview)}</div>
      <div class="manage-section" ${tab === "settings" ? "" : "hidden"}>${renderManageSettingsSection()}</div>
    </section>
  `;
  document.querySelectorAll("[data-manage-tab]").forEach((button) => button.addEventListener("click", () => {
    state.manage.tab = button.dataset.manageTab;
    renderManage();
  }));
  document.querySelector("#newPaper")?.addEventListener("click", createNewPaper);
  document.querySelector("#savePaper")?.addEventListener("click", savePaperFromEditor);
  document.querySelector("#syncJson")?.addEventListener("click", syncBuilderToJson);
  document.querySelector("#paperCategoryInput")?.addEventListener("change", () => {
    const examType = examTypeById(document.querySelector("#paperCategoryInput").value);
    document.querySelector("#paperLevelField").hidden = !examType.levelEnabled;
  });
  document.querySelector("#addSingle")?.addEventListener("click", () => addBuilderQuestion("single"));
  document.querySelector("#addJudge")?.addEventListener("click", () => addBuilderQuestion("judge"));
  document.querySelector("#addProgram")?.addEventListener("click", () => addBuilderQuestion("program"));
  document.querySelectorAll("[data-remove-question]").forEach((button) => button.addEventListener("click", () => removeBuilderQuestion(Number(button.dataset.removeQuestion))));
  document.querySelectorAll("[data-insert-markdown]").forEach((button) => button.addEventListener("click", () => insertMarkdownSnippet(button)));
  document.querySelectorAll("[data-edit-paper]").forEach((button) => button.addEventListener("click", () => loadPaperIntoEditor(button.dataset.editPaper)));
  document.querySelectorAll("[data-delete-paper]").forEach((button) => button.addEventListener("click", () => deletePaperById(button.dataset.deletePaper)));
  document.querySelector("#selectAllPapers")?.addEventListener("change", toggleAllPapers);
  document.querySelector("#deleteSelectedPapers")?.addEventListener("click", deleteSelectedPapers);
  document.querySelector("#createClass")?.addEventListener("click", createClass);
  document.querySelector("#classCategory")?.addEventListener("change", updateClassLevelVisibility);
  updateClassLevelVisibility();
  document.querySelectorAll("[data-class-report]").forEach((button) => button.addEventListener("click", () => loadClassReport(button.dataset.classReport)));
  document.querySelector("#createAssignment")?.addEventListener("click", createAssignment);
  document.querySelector("#createUser")?.addEventListener("click", createUser);
  document.querySelector("#importUsers")?.addEventListener("click", importUsersFromExcel);
  document.querySelector("#saveExamType")?.addEventListener("click", saveExamType);
  document.querySelectorAll("[data-delete-exam-type]").forEach((button) => button.addEventListener("click", () => deleteExamType(button.dataset.deleteExamType)));
}

function manageTabButton(id, label, active) {
  return `<button class="${active === id ? "active" : ""}" type="button" role="tab" aria-selected="${active === id}" data-manage-tab="${id}">${label}</button>`;
}

function renderManagePapersSection() {
  const editingPaper = state.manage.editPaper || samplePaper();
  const editingExisting = state.manage.papers.some((paper) => paper.id === editingPaper.id);
  return `
    <div class="manage-paper-layout">
      <div class="panel">
        <div class="panel-head"><h2>管理试卷</h2><span class="muted">${state.manage.papers.length} 套试卷</span></div>
        <div class="panel-body">
          <div class="paper-manage-actions">
            <label class="inline-check"><input id="selectAllPapers" type="checkbox">全选</label>
            <button class="danger-btn" type="button" id="deleteSelectedPapers">删除选中</button>
            <button class="primary-btn" type="button" id="newPaper">创建新试卷</button>
          </div>
          <div class="paper-manage-list">
            ${state.manage.papers.map(renderPaperManageRow).join("") || `<div class="empty">暂无试卷。</div>`}
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>${editingExisting ? "修改试卷" : "创建试卷"}</h2><span class="muted">可视化编辑题目和 Markdown 内容</span></div>
        <div class="panel-body">
        ${renderPaperBuilder(editingPaper)}
        <details class="advanced-json"><summary>高级 JSON 导入/导出</summary><textarea class="json-editor compact" id="paperJson" spellcheck="false">${escapeHtml(JSON.stringify(state.manage.editPaper || samplePaper(), null, 2))}</textarea></details>
        <div class="submit-row"><button class="primary-btn" type="button" id="savePaper">保存试卷</button><button class="secondary-btn" type="button" id="syncJson">同步到 JSON</button><span class="muted">日常用表单建卷；复杂导入可展开 JSON。</span></div>
      </div>
    </div>
    </div>
  `;
}

function renderPaperManageRow(paper) {
  const stats = paperStats(paper);
  return `
    <article class="paper-manage-row">
      <label class="paper-check"><input type="checkbox" data-paper-select="${paper.id}"></label>
      <div>
        <h3>${escapeHtml(paper.title)}</h3>
        <div class="meta"><span>${escapeHtml(categoryName(paper.category || "gesp"))}</span>${examTypeById(paper.category || "gesp").levelEnabled ? `<span>${paper.level} 级</span>` : ""}<span>${stats.fullScore} 分</span><span>${stats.objective} 客观题</span><span>${stats.program} 编程题</span></div>
      </div>
      <div class="paper-row-actions">
        <button class="secondary-btn" type="button" data-edit-paper="${paper.id}">修改</button>
        <button class="danger-btn" type="button" data-delete-paper="${paper.id}">删除</button>
      </div>
    </article>
  `;
}

function renderManageClassesSection(overview) {
  const classes = overview.classes || [];
  return `
    <div class="manage-class-layout">
      <div class="panel">
        <div class="panel-head"><h2>班级列表</h2><span class="muted">点击“查看学情”进入班级报告</span></div>
        <div class="panel-body">
          <div class="stack-form class-create-form"><input id="className" placeholder="班级名称，如 周六一级班"><select id="classCategory">${state.examTypes.map((type) => `<option value="${type.id}">${escapeHtml(type.name)}</option>`).join("")}</select><select id="classLevel">${Array.from({ length: 8 }, (_, index) => `<option value="${index + 1}">${index + 1} 级</option>`).join("")}</select><button class="primary-btn" type="button" id="createClass">创建班级</button></div>
          <div class="class-card-list">
            ${classes.map(renderClassManageCard).join("") || `<div class="empty">暂无班级，先创建一个班级。</div>`}
          </div>
        </div>
      </div>
      <div class="side-stack">
        ${renderClassReport()}
        <div class="panel"><div class="panel-head"><h2>发布作业</h2></div><div class="panel-body"><div class="stack-form"><select id="assignmentClass">${classes.map((klass) => `<option value="${klass.id}">${escapeHtml(klass.name)}</option>`).join("")}</select><select id="assignmentPaper">${state.manage.papers.map((paper) => `<option value="${paper.id}">${escapeHtml(paper.title)}</option>`).join("")}</select><input id="assignmentDue" type="date"><button class="primary-btn" type="button" id="createAssignment">发布作业</button></div></div></div>
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
        <button class="primary-btn" type="button" data-class-report="${klass.id}">查看学情</button>
      </div>
    </article>
  `;
}

function renderManageSettingsSection() {
  return `
    <div class="manage-settings-grid">
      ${isAdmin() ? renderExamTypeAdmin() : `<div class="panel"><div class="panel-head"><h2>考试类型</h2></div><div class="panel-body"><p class="muted">考试类型由管理员维护。</p></div></div>`}
      ${isAdmin() ? renderUserAdmin() : ""}
    </div>
  `;
}

function statCard(label, value) {
  return `<div class="stat-card"><strong>${value}</strong><span>${label}</span></div>`;
}

function renderPaperBuilder(paper) {
  const questions = paper.questions || [];
  const category = paper.category || "gesp";
  const isLevelEnabled = examTypeById(category).levelEnabled;
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
      <div class="builder-toolbar"><button class="secondary-btn" type="button" id="addSingle">添加单选题</button><button class="secondary-btn" type="button" id="addJudge">添加判断题</button><button class="secondary-btn" type="button" id="addProgram">添加编程题</button></div>
      <p class="builder-hint">题干、解析和编程题题面支持 Markdown，可直接粘贴 &#96;&#96;&#96;cpp 代码块。</p>
      <div class="builder-list">${questions.map((question, index) => renderBuilderQuestion(question, index)).join("") || `<div class="empty">还没有题目，先添加一题。</div>`}</div>
    </div>
  `;
}

function renderBuilderQuestion(question, index) {
  const typeName = question.type === "single" ? "单选题" : question.type === "judge" ? "判断题" : "编程题";
  return `<article class="builder-question" data-builder-question="${index}"><div class="question-head"><span>第 ${index + 1} 题 · ${typeName}</span><button class="danger-btn" type="button" data-remove-question="${index}">删除</button></div><input data-field="id" value="${escapeHtml(question.id || `q${index + 1}`)}" placeholder="题目 ID"><input data-field="score" type="number" value="${Number(question.score || 2)}" placeholder="分值">${question.type === "program" ? renderProgramBuilder(question) : renderObjectiveBuilder(question)}</article>`;
}

function markdownInsertTools(field) {
  return `<div class="markdown-tools"><button class="secondary-btn" type="button" data-insert-markdown="code" data-target-field="${field}">插入代码</button><button class="secondary-btn" type="button" data-insert-markdown="formula" data-target-field="${field}">插入公式</button><button class="secondary-btn" type="button" data-insert-markdown="image" data-target-field="${field}">插入图片</button></div>`;
}

function renderObjectiveBuilder(question) {
  const choices = question.type === "single" ? [...(question.choices || []), "", "", "", ""].slice(0, 4) : [];
  return `${markdownInsertTools("stem")}<textarea data-field="stem" placeholder="题干，支持 Markdown 代码块">${escapeHtml(question.stem || "")}</textarea>${question.type === "single" ? `<div class="choice-editor">${choices.map((choice, index) => `<label><span>${String.fromCharCode(65 + index)}</span><input data-choice="${index}" value="${escapeHtml(choice)}"></label>`).join("")}</div><label><span>正确选项</span><select data-field="answer">${choices.map((_, index) => `<option value="${index}" ${Number(question.answer || 0) === index ? "selected" : ""}>${String.fromCharCode(65 + index)}</option>`).join("")}</select></label>` : `<label><span>正确答案</span><select data-field="answer"><option value="true" ${question.answer !== false ? "selected" : ""}>正确</option><option value="false" ${question.answer === false ? "selected" : ""}>错误</option></select></label>`}${markdownInsertTools("explanation")}<textarea data-field="explanation" placeholder="解析，支持 Markdown">${escapeHtml(question.explanation || "")}</textarea>`;
}

function renderProgramBuilder(question) {
  return `<input data-field="title" value="${escapeHtml(question.title || "")}" placeholder="编程题标题">${markdownInsertTools("statement")}<textarea data-field="statement" placeholder="题面描述，支持 Markdown 代码块">${escapeHtml(question.statement || "")}</textarea><textarea data-field="input" placeholder="输入格式，支持 Markdown">${escapeHtml(question.input || "")}</textarea><textarea data-field="output" placeholder="输出格式，支持 Markdown">${escapeHtml(question.output || "")}</textarea><textarea data-field="samplesText" placeholder="样例，每组用 --- 分隔，输入和输出用 === 分隔">${escapeHtml(formatCases(question.samples || []))}</textarea><textarea data-field="testsText" placeholder="隐藏测试点，每组用 --- 分隔，输入和输出用 === 分隔">${escapeHtml(formatCases(question.tests || []))}</textarea>`;
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
    } else {
      question.stem = item.querySelector('[data-field="stem"]').value;
      question.explanation = item.querySelector('[data-field="explanation"]').value;
      if (type === "single") {
        question.choices = Array.from(item.querySelectorAll("[data-choice]")).map((input) => input.value);
        question.answer = Number(item.querySelector('[data-field="answer"]').value);
      } else {
        question.answer = item.querySelector('[data-field="answer"]').value === "true";
      }
    }
    paper.questions.push(question);
  });
  return paper;
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
  const question = button.closest("[data-builder-question]");
  const textarea = question?.querySelector(`textarea[data-field="${button.dataset.targetField}"]`);
  if (!textarea) return;
  const type = button.dataset.insertMarkdown;
  if (type === "code") {
    openCodeInsertDialog(textarea);
  } else if (type === "formula") {
    insertAtCursor(textarea, "\n$$\na^2 + b^2 = c^2\n$$\n");
  } else if (type === "image") {
    const url = window.prompt("请输入图片地址，例如 https://example.com/image.png");
    if (!url) return;
    insertAtCursor(textarea, `\n![图片说明](${url.trim()})\n`);
  }
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
  if (type === "program") Object.assign(base, { title: "", statement: "", input: "", output: "", samples: [], tests: [] });
  state.manage.editPaper.questions.push(base);
  renderManage();
}

function removeBuilderQuestion(index) {
  syncBuilderState();
  state.manage.editPaper.questions.splice(index, 1);
  renderManage();
}

function samplePaper() {
  return {
    id: "new-paper-id",
    title: "新建练习卷",
    category: "gesp",
    level: 1,
    language: "C++",
    year: new Date().getFullYear(),
    month: "06",
    participants: 0,
    views: 0,
    summary: "请填写试卷说明",
    questions: [{ id: "q1", type: "single", score: 2, stem: "示例单选题", choices: ["A 选项", "B 选项", "C 选项", "D 选项"], answer: 0, explanation: "这里写解析。" }]
  };
}

function createNewPaper() {
  state.manage.editPaper = samplePaper();
  renderManage();
}

function loadPaperIntoEditor(id) {
  const paper = state.manage.papers.find((item) => item.id === id) || samplePaper();
  state.manage.editPaper = JSON.parse(JSON.stringify(paper));
  renderManage();
}

async function savePaperFromEditor() {
  try {
    let paper = collectBuilderPaper();
    const jsonDetails = document.querySelector(".advanced-json");
    if (jsonDetails?.open && document.querySelector("#paperJson").value.trim()) paper = JSON.parse(document.querySelector("#paperJson").value);
    await api("/api/admin/papers", { method: "POST", body: { paper } });
    state.manage.editPaper = JSON.parse(JSON.stringify(paper));
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
    notify("试卷已删除。");
    renderManage();
  } catch (error) {
    notify(error.message);
  }
}

function toggleAllPapers(event) {
  document.querySelectorAll("[data-paper-select]").forEach((item) => {
    item.checked = event.target.checked;
  });
}

async function deleteSelectedPapers() {
  const ids = Array.from(document.querySelectorAll("[data-paper-select]:checked")).map((item) => item.dataset.paperSelect);
  if (!ids.length) return notify("请先勾选要删除的试卷。");
  if (!window.confirm(`确定删除选中的 ${ids.length} 套试卷吗？`)) return;
  try {
    for (const id of ids) {
      await api(`/api/admin/papers/${encodeURIComponent(id)}`, { method: "DELETE" });
    }
    await refreshPapers();
    if (ids.includes(state.manage.editPaper?.id)) state.manage.editPaper = samplePaper();
    notify(`已删除 ${ids.length} 套试卷。`);
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

function renderClassReport() {
  const report = state.manage.classReport;
  if (!report) {
    return `<div class="panel class-report-card report-empty"><div class="panel-head"><h2>班级学情</h2></div><div class="panel-body"><div class="report-empty-icon">学情</div><p>选择左侧班级，点击 <strong>查看学情</strong>。</p><p class="muted">这里会显示学生练习次数、客观题最好成绩、编程题通过数、作业和最近答题记录。</p></div></div>`;
  }
  const klass = report.class;
  const assignments = report.assignments || [];
  const students = report.students || [];
  const attempts = report.recentAttempts || [];
  const totalAttempts = students.reduce((sum, student) => sum + Number(student.attemptCount || 0), 0);
  return `
    <div class="panel class-report-card">
      <div class="panel-head">
        <h2>${escapeHtml(klass.name)}</h2>
        <span class="muted">${escapeHtml(klass.categoryName || categoryName(klass.category))}${klass.level ? ` · ${klass.level} 级` : ""}</span>
      </div>
      <div class="panel-body">
        <div class="stat-grid compact-stats">
          ${statCard("学生", students.length)}
          ${statCard("作业", assignments.length)}
          ${statCard("答题", totalAttempts)}
        </div>
        <h3 class="subhead">学生练习数据</h3>
        <table class="report-table">
          <thead><tr><th>学生</th><th>练习</th><th>客观题最好成绩</th><th>编程通过</th></tr></thead>
          <tbody>
            ${students.map((student) => `<tr><td>${escapeHtml(student.username)}</td><td>${student.attemptCount} 次</td><td>${student.bestObjective ? `${renderScoreBadge(student.bestObjective.score, student.bestObjective.fullScore, "最好")}<div class="muted">${escapeHtml(student.bestObjective.paperTitle || "")}</div>` : `<span class="muted">暂无</span>`}</td><td>${student.acceptedPrograms} 题</td></tr>`).join("") || `<tr><td colspan="4" class="muted">暂无学生</td></tr>`}
          </tbody>
        </table>
        <h3 class="subhead">已发布作业</h3>
        <ul class="mini-list">${assignments.map((item) => `<li><span>${escapeHtml(item.paperTitle || item.title)}<div class="muted">${item.dueAt ? `截止 ${escapeHtml(item.dueAt)}` : "未设置截止日期"}</div></span></li>`).join("") || `<li class="muted">暂无作业</li>`}</ul>
        <h3 class="subhead">最近答题</h3>
        <ul class="mini-list">${attempts.slice(0, 6).map((item) => `<li><span>${escapeHtml(item.username || "")}<div class="muted">${escapeHtml(item.paperTitle || item.questionTitle || "")}</div></span><span class="muted">${item.type === "objective" ? `${item.score}/${item.fullScore}` : `${item.passed || 0}/${item.total || 0}`}</span></li>`).join("") || `<li class="muted">暂无答题记录</li>`}</ul>
      </div>
    </div>
  `;
}

function renderExamTypeAdmin() {
  return `
    <div class="panel">
      <div class="panel-head"><h2>考试类型</h2></div>
      <div class="panel-body">
        <div class="stack-form">
          <input id="newExamTypeId" placeholder="类型 ID，如 noip">
          <input id="newExamTypeName" placeholder="显示名称，如 NOIP 初赛">
          <label class="inline-check"><input id="newExamTypeLevelEnabled" type="checkbox">需要等级</label>
          <button class="primary-btn" type="button" id="saveExamType">保存类型</button>
        </div>
        <ul class="mini-list exam-type-list" style="margin-top: 12px;">
          ${state.examTypes.map((type) => `<li><span>${escapeHtml(type.name)}<div class="muted">${escapeHtml(type.id)} · ${type.levelEnabled ? "有等级" : "无等级"}${type.builtIn ? " · 内置" : ""}</div></span>${type.builtIn ? `<span class="muted">固定</span>` : `<button class="danger-btn" type="button" data-delete-exam-type="${type.id}">删除</button>`}</li>`).join("")}
        </ul>
      </div>
    </div>
  `;
}

async function loadClassReport(classId) {
  try {
    state.manage.tab = "classes";
    state.manage.classReport = await api(`/api/classes/${encodeURIComponent(classId)}/report`);
    notify("班级学情已加载。");
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
    await api(`/api/classes/${encodeURIComponent(classId)}/assignments`, { method: "POST", body: { paperId, dueAt: document.querySelector("#assignmentDue").value } });
    notify("作业已发布。");
    renderManage();
  } catch (error) {
    notify(error.message);
  }
}

function renderUserAdmin() {
  return `
    <div class="panel">
      <div class="panel-head"><h2>用户管理</h2><span class="muted">${state.manage.users.length} 个账号</span></div>
      <div class="panel-body">
        <h3 class="subhead">单个创建</h3>
        <div class="stack-form">
          <input id="newUsername" placeholder="新账号">
          <input id="newPassword" type="password" placeholder="初始密码">
          <select id="newRole"><option value="student">学生</option><option value="teacher">教师</option><option value="admin">管理员</option></select>
          <button class="primary-btn" type="button" id="createUser">创建用户</button>
        </div>
        <h3 class="subhead">Excel 批量导入</h3>
        <div class="bulk-import-box">
          <select id="bulkRole"><option value="student">创建为学生账号</option><option value="teacher">创建为教师账号</option></select>
          <input id="bulkUserFile" type="file" accept=".xlsx,.xls,.csv">
          <button class="primary-btn" type="button" id="importUsers">上传并创建</button>
        </div>
        <p class="muted import-hint">Excel 第一行表头包含“用户名”和“密码”即可；也支持 username/password。</p>
        ${renderImportResult()}
        <ul class="mini-list" style="margin-top: 12px;">${state.manage.users.slice(0, 8).map((user) => `<li><span>${escapeHtml(user.username)}<div class="muted">${roleName(user.role)}</div></span><span class="muted">${user.attemptCount} 次</span></li>`).join("")}</ul>
      </div>
    </div>
  `;
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
    await api("/api/admin/users", { method: "POST", body: { username: document.querySelector("#newUsername").value, password: document.querySelector("#newPassword").value, role: document.querySelector("#newRole").value } });
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

function openAuth() {
  closeAccountMenu();
  state.authMode = "login";
  renderAuthMode();
  authDialog.showModal();
  authUsername.focus();
}

function renderAuthMode() {
  const isLogin = state.authMode === "login";
  authTitle.textContent = isLogin ? "登录" : "创建学生账号";
  authHint.textContent = isLogin ? "登录后可以保存记录、加入班级或进入管理台。" : "公开注册只创建学生账号；教师账号由管理员创建。";
  submitAuth.textContent = isLogin ? "登录" : "创建并登录";
  toggleAuth.textContent = isLogin ? "创建账号" : "已有账号，去登录";
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
  updateAuthButton();
  route();
  notify("已退出登录。");
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
  accountManageLink.hidden = !isTeacher();
  authButton.textContent = state.user ? state.user.username : "登录";
  if (!state.user) closeAccountMenu();
}

async function refreshMe() {
  const data = await api("/api/me");
  state.user = data.user;
  state.attempts = data.attempts || [];
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

async function init() {
  try {
    await Promise.all([refreshExamTypes(), refreshPapers(), refreshMe()]);
  } catch (error) {
    app.innerHTML = `<div class="panel empty">启动失败：${escapeHtml(error.message)}</div>`;
    return;
  }
  route();
}

authButton.addEventListener("click", toggleAccountMenu);
logoutButton.addEventListener("click", logout);
accountMenu.addEventListener("click", (event) => {
  if (event.target.closest("a")) closeAccountMenu();
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".account-menu")) closeAccountMenu();
});
closeAuth.addEventListener("click", () => authDialog.close());
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
window.addEventListener("hashchange", route);

init();
