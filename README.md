# 初赛考级练习平台

这是一个本地可运行、面向多教师和多学生使用的 GESP 与 CSP-J/S 初赛练习平台。当前已经具备试卷练习、账号登录、客观题判分、学习中心、错题本、练习记录、班级、作业、教师管理台和管理员用户管理。编程题提交默认关闭，待运行沙箱配置完成后可再开放。

## 启动

```powershell
npm start
```

访问：

```text
http://localhost:5173
```

健康检查：

```text
http://localhost:5173/api/health
```

系统启动时会自动准备 3 个演示账号：

```text
管理员：admin / admin123
教师：teacher / teacher123
学生：demo / demo123
```

公开注册只创建学生账号。教师和管理员账号应由管理员在管理台创建。

## 角色能力

- 学生：练习试卷、提交客观题、查看记录、通过邀请码加入班级、查看作业。
- 学生学习中心：查看待完成作业、按等级统计练习进度、汇总错题并回到原卷重练。
- 教师：可视化创建试卷、维护题库、创建班级、发布作业、查看班级学生提交概览。
- 管理员：拥有教师能力，并可创建教师/学生/管理员账号。

## 题库

题库文件：`data/papers.json`

教师可以在页面的“管理”中使用可视化表单新增或编辑试卷，也可以展开高级 JSON 做批量导入。题目结构：

- `single`：单选题，`answer` 是选项下标，从 0 开始。
- `judge`：判断题，`answer` 是 `true` 或 `false`。
- `multi`：多选题，`answer` 是选项下标数组，例如 `[0, 2]`。
- `reading`：阅读程序题，包含 `statement`、`code` 和 `subquestions`，子题支持判断、单选、多选。
- `completion`：完善程序题，包含 `statement`、`code` 和 `subquestions`，适合配置 ①②③ 等填空选择。
- `program`：编程题，`samples` 对学生可见，`tests` 是额外测试点。

试卷支持 `hidden: true`。隐藏后学生端不显示，教师仍可在管理台恢复显示。

试卷可以通过 `category` 区分方向：

- `gesp`：GESP 考级
- `cspj`：CSP-J 初赛
- `csps`：CSP-S 初赛
- `csp`：CSP-J/S 综合初赛

## 数据文件

运行数据保存在 SQLite 文件 `data/runtime.sqlite`。首次启动时，如果 SQLite 还没有初始化，系统会从 `data/db.json` 导入初始数据。

- `users`：用户和角色
- `classes`：班级
- `enrollments`：学生入班关系
- `assignments`：班级作业
- `attempts`：提交记录
- `auditLogs`：教师/管理员操作记录

试卷运行数据会写入 SQLite，同时同步一份 `data/papers.json` 作为人工检查和恢复镜像。

## 备份

服务启动时会自动备份一次，之后默认每 24 小时备份一次，备份目录为 `backups/`，默认保留最近 14 份。

也可以手动执行：

```bash
npm run backup
```

常用生产环境参数：

```bash
BACKUP_RETENTION=14
BACKUP_INTERVAL_HOURS=24
MAX_ATTEMPTS=100000
MAX_AUDIT_LOGS=10000
SESSION_MAX_AGE_DAYS=7
```

更多上线优化计划见 [生产环境优化计划](docs/production-optimization-plan.md)。

## 编程评测

编程题提交默认关闭，前端不会显示提交代码入口，后端 `/api/submit-code` 会返回暂未开放提示。

配置好独立运行沙箱后，可以通过环境变量临时恢复入口：

```bash
ENABLE_PROGRAM_SUBMISSION=true npm start
```

开启后，编程题通过本机 `g++` 编译运行。上线给真实学生使用前，建议把评测服务拆成独立沙箱，限制 CPU、内存、进程、文件系统和网络访问。

## 上线前建议

- 将 C++ 评测移动到 Docker 或专用沙箱队列。
- 使用 HTTPS、反向代理、访问日志、错误监控和定时备份。
- 增加找回密码、导入学生名单、错题本、知识点统计和考试模式。

## 部署文档

- [Ubuntu 22.04 部署说明](docs/ubuntu-22.04-deploy.md)

## 推送到 GitHub

第一次把本地项目推送到你创建的仓库：

```powershell
git init
git branch -M main
git remote add origin https://github.com/cuong25254625-hue/csppractice.git
git add .
git commit -m "Initial CSP practice platform"
git pull origin main --allow-unrelated-histories
git push -u origin main
```

如果远程仓库只有 GitHub 自动创建的 README，也可以在合并冲突处理后再 `git push`。

## 服务器部署

### 方案一：直接用 Node + PM2

服务器需要安装 Node.js、npm 和 git。开启编程题提交前，还需要准备 g++ 和运行沙箱。

```bash
git clone https://github.com/cuong25254625-hue/csppractice.git
cd csppractice
npm install --omit=dev
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

默认端口是 `5173`，可以通过环境变量修改：

```bash
PORT=8080 npm start
```

### 方案二：Docker

```bash
git clone https://github.com/cuong25254625-hue/csppractice.git
cd csppractice
docker build -t csppractice .
docker run -d --name csppractice -p 5173:5173 csppractice
```

### Nginx 反向代理示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

生产环境建议再配置 HTTPS、定时备份 `data/`、日志轮转和防火墙。
