# 部署指南

## 概述

本项目包含两个部分：
1. **前端**：静态HTML文件（index.html），可以部署到GitHub Pages
2. **后端**：Node.js服务器（server目录），需要部署到云服务

---

## 第一步：创建GitHub仓库并上传代码

### 1.1 创建GitHub仓库
1. 访问 https://github.com/new
2. 仓库名称：`personal-website`（或你喜欢的名字）
3. 选择 Public（公开）
4. 不要初始化README
5. 点击"Create repository"

### 1.2 上传代码到GitHub

**方法A：使用GitHub Desktop（推荐）**
1. 下载并安装 GitHub Desktop
2. 点击"File" → "Add local repository"
3. 选择 `d:\个人网站` 文件夹
4. 填写仓库名称和描述
5. 点击"Publish repository"

**方法B：使用Git命令行**
```bash
# 1. 初始化Git仓库
cd d:\个人网站
git init

# 2. 添加所有文件
git add .

# 3. 提交
git commit -m "Initial commit"

# 4. 添加远程仓库（替换YOUR_USERNAME为你的GitHub用户名）
git remote add origin https://github.com/YOUR_USERNAME/personal-website.git

# 5. 推送到GitHub
git branch -M main
git push -u origin main
```

---

## 第二步：部署前端到GitHub Pages

### 2.1 启用GitHub Pages
1. 访问你的GitHub仓库
2. 点击"Settings"标签
3. 在左侧菜单找到"Pages"
4. 在"Build and deployment"部分：
   - Source：选择 `Deploy from a branch`
   - Branch：选择 `main` 和 `/ (root)`
5. 点击"Save"

### 2.2 等待部署
- GitHub会自动部署你的网站
- 通常需要1-2分钟
- 部署完成后会显示网址，如：`https://YOUR_USERNAME.github.io/personal-website`

### 2.3 访问网站
在浏览器中打开你的GitHub Pages网址即可访问前端。

**注意**：前端部署后，后端API调用会失败（因为后端在本地）。需要继续第三步部署后端。

---

## 第三步：部署后端到云服务

由于后端是Node.js应用，需要部署到支持Node.js的云服务。以下是几个推荐选项：

### 选项A：Vercel（推荐，免费）

#### 3.1 准备后端代码
1. 在GitHub仓库中创建 `vercel.json` 文件：
```json
{
  "version": 2,
  "builds": [
    {
      "src": "server/server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/server/server.js",
      "dest": "/api"
    }
  ]
}
```

#### 3.2 部署到Vercel
1. 访问 https://vercel.com
2. 使用GitHub账号登录
3. 点击"Add New Project"
4. 选择你的 `personal-website` 仓库
5. 点击"Import"
6. 配置：
   - Framework Preset：Other
   - Root Directory：`./server`
   - Build Command：留空
   - Output Directory：留空
7. 点击"Deploy"

#### 3.3 获取后端URL
部署完成后，Vercel会提供一个URL，如：`https://your-project.vercel.app`

#### 3.4 更新前端API地址
在 `index.html` 中，将所有 `http://localhost:3000` 替换为你的Vercel URL：
```javascript
// 将这行：
const response = await fetch('http://localhost:3000/api/resumes');

// 改为：
const response = await fetch('https://your-project.vercel.app/api/resumes');
```

### 选项B：Render（免费）

1. 访问 https://render.com
2. 使用GitHub账号登录
3. 点击"New +"
4. 选择"Web Service"
5. 连接你的GitHub仓库
6. 配置：
   - Name：`personal-website-backend`
   - Runtime：`Node`
   - Build Command：留空
   - Start Command：`node server.js`
7. 点击"Create Web Service"

### 选项C：Railway（免费）

1. 访问 https://railway.app
2. 使用GitHub账号登录
3. 点击"New Project"
4. 选择你的GitHub仓库
5. 选择"Deploy from GitHub repo"
6. Railway会自动检测Node.js并部署

---

## 第四步：配置CORS（跨域问题）

如果前端和后端部署在不同的域名，需要在后端配置CORS。

在 `server/server.js` 中添加：
```javascript
const cors = require('cors');
app.use(cors({
    origin: '*',  // 允许所有来源（生产环境应该指定具体域名）
    credentials: true
}));
```

安装cors包：
```bash
cd server
npm install cors
```

---

## 完整部署架构

```
┌─────────────────┐
│  GitHub Pages  │  ← 前端（index.html）
│  (免费)       │     https://yourname.github.io/personal-website
└────────┬────────┘
         │
         │ API调用
         │
┌─────────────────┐
│   Vercel      │  ← 后端（Node.js）
│  (免费)        │     https://your-project.vercel.app
└─────────────────┘
```

---

## 常见问题

### Q1: 前端能访问，但保存简历失败？
A: 后端还没有部署，或者API地址没有更新。请完成第三步并更新前端API地址。

### Q2: 如何更新网站？
A:
1. 修改代码
2. 提交到GitHub：`git add . && git commit -m "update" && git push`
3. GitHub Pages和Vercel会自动重新部署

### Q3: 如何查看部署日志？
A:
- GitHub Pages：在仓库的Actions标签查看
- Vercel：在Vercel项目页面查看Logs

### Q4: 免费额度够用吗？
A:
- GitHub Pages：完全免费
- Vercel：免费100GB带宽/月，个人使用足够
- Render：免费750小时/月
- Railway：免费$5/月额度

---

## 安全建议

1. **不要提交敏感信息**：
   - `.gitignore` 已配置，不会提交 `node_modules/` 和 `server/resumes/`
   - 确保没有API密钥在代码中

2. **使用环境变量**：
   - 在云服务中使用环境变量存储敏感信息
   - 在代码中使用 `process.env.VARIABLE_NAME` 读取

3. **限制CORS**：
   - 生产环境应该指定允许的前端域名
   - 不要使用 `origin: '*'`

---

## 下一步

部署完成后，你可以：
1. 分享GitHub Pages链接给朋友
2. 继续开发新功能
3. 添加域名（可选）
4. 配置HTTPS（GitHub Pages和Vercel都自动提供）
