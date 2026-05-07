# GESP 练习平台

这是一个本地可运行、面向多教师和多学生使用的 GESP/CSP C++ 练习平台原型。当前已经具备试卷练习、账号登录、客观题判分、C++ 编程题评测、学习中心、错题本、练习记录、班级、作业、教师管理台和管理员用户管理。

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

- 学生：练习试卷、提交客观题和编程题、查看记录、通过邀请码加入班级、查看作业。
- 学生学习中心：查看待完成作业、按等级统计练习进度、汇总错题并回到原卷重练。
- 教师：可视化创建试卷、维护题库、创建班级、发布作业、查看班级学生提交概览。
- 管理员：拥有教师能力，并可创建教师/学生/管理员账号。

## 题库

题库文件：`data/papers.json`

教师可以在页面的“管理”中使用可视化表单新增或编辑试卷，也可以展开高级 JSON 做批量导入。题目结构：

- `single`：单选题，`answer` 是选项下标，从 0 开始。
- `judge`：判断题，`answer` 是 `true` 或 `false`。
- `program`：编程题，`samples` 对学生可见，`tests` 是额外测试点。

## 数据文件

运行数据在 `data/db.json`：

- `users`：用户和角色
- `classes`：班级
- `enrollments`：学生入班关系
- `assignments`：班级作业
- `attempts`：提交记录
- `auditLogs`：教师/管理员操作记录

## 编程评测

编程题通过本机 `g++` 编译运行。服务会优先尝试 C++17/C++14/C++11，老版本编译器会自动降级。

上线给真实学生使用前，建议把评测服务拆成独立沙箱，限制 CPU、内存、进程、文件系统和网络访问。

## 上线前建议

- 将 `data/db.json` 迁移到 SQLite、PostgreSQL 或 MySQL。
- 将 C++ 评测移动到 Docker 或专用沙箱队列。
- 使用 HTTPS、反向代理、访问日志、错误监控和定时备份。
- 增加找回密码、导入学生名单、错题本、知识点统计和考试模式。

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

服务器需要安装 Node.js、npm、git、g++。

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
