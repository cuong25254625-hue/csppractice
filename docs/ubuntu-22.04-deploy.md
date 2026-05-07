# Ubuntu 22.04 部署说明

本文档适用于 Ubuntu 22.04 x64 云服务器，使用 Node.js + PM2 + Nginx 部署本练习平台。

## 1. 登录服务器

```bash
ssh root@你的服务器IP
```

如果使用普通用户登录，后续涉及系统安装和 Nginx 配置的命令需要加 `sudo`。

## 2. 安装基础环境

```bash
apt update
apt install -y git curl build-essential nginx
```

安装 Node.js 20：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
```

检查版本：

```bash
node -v
npm -v
g++ --version
```

## 3. 拉取项目

```bash
cd /opt
git clone https://github.com/cuong25254625-hue/csppractice.git
cd csppractice
```

安装依赖：

```bash
npm install --omit=dev
```

## 4. 使用 PM2 启动

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

`pm2 startup` 会输出一行命令，请复制并执行一次，用来配置开机自启。

检查运行状态：

```bash
pm2 status
curl http://127.0.0.1:5173/api/health
```

如果正常，会看到类似：

```json
{"ok":true,"service":"csppractice"}
```

此时可以先通过端口访问：

```text
http://你的服务器IP:5173
```

## 5. 配置 Nginx 反向代理

创建 Nginx 配置：

```bash
nano /etc/nginx/sites-available/csppractice
```

填入以下内容。如果已经绑定域名，把 `server_name` 改成你的域名；如果暂时没有域名，可以填写服务器 IP。

```nginx
server {
    listen 80;
    server_name 你的服务器IP或域名;

    client_max_body_size 10m;

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

启用配置：

```bash
ln -s /etc/nginx/sites-available/csppractice /etc/nginx/sites-enabled/csppractice
nginx -t
systemctl reload nginx
```

现在可以访问：

```text
http://你的服务器IP
```

或：

```text
http://你的域名
```

## 6. 防火墙

如果服务器启用了 UFW：

```bash
ufw allow 22
ufw allow 80
ufw allow 443
ufw enable
```

云服务器控制台里的安全组也需要放行 80、443、22 端口。

## 7. 更新代码

以后本仓库有新版本时，在服务器执行：

```bash
cd /opt/csppractice
git pull
npm install --omit=dev
pm2 restart csppractice
```

## 8. 首次上线后的必要操作

默认演示账号：

```text
管理员：admin / admin123
教师：teacher / teacher123
学生：demo / demo123
```

首次上线后请立刻：

1. 登录 `admin / admin123`。
2. 创建你自己的管理员账号。
3. 停用或删除默认演示账号。
4. 定期备份 `data/db.json` 和 `data/papers.json`。

## 9. 安全提醒

当前 C++ 评测会在服务器本机编译并运行学生提交的代码。小范围试用可以，但正式开放给大量学生前，建议升级为 Docker/沙箱评测，限制 CPU、内存、文件系统和网络访问。

后续正式上线还建议：

- 配置 HTTPS。
- 添加数据库备份。
- 将 `data/db.json` 迁移到 SQLite、PostgreSQL 或 MySQL。
- 增加日志监控和异常报警。
