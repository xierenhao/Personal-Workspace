# 个人网站

一个包含摸鱼小游戏、简历编辑器和体育新闻追踪功能的个人网站。

## 功能特性

### 1. 摸鱼小游戏
- 贪吃蛇
- 2048
- 打地鼠
- 记忆翻牌

### 2. 简历编辑器
- 支持自定义简历模块
- LaTeX代码实时预览
- PDF自动生成
- 智能页面布局调整
- 简历版本管理

### 3. 体育新闻追踪
- 实时比分和积分榜
- 多联赛支持（NBA、CBA、英超、中超、网球等）
- AI智能新闻聚合
- RSS源集成

## 本地运行

### 前端
直接在浏览器中打开 `index.html` 文件即可。

### 后端
```bash
cd server
npm install
npm start
```

后端服务将在 `http://localhost:3000` 运行。

## 技术栈
- 前端：HTML/CSS/JavaScript + Tailwind CSS
- 后端：Node.js + Express
- PDF生成：LaTeX + xelatex
- AI集成：智谱AI API
- 数据存储：文件系统

## 在线部署

### 前端部署到 GitHub Pages
1. 将代码推送到 GitHub 仓库
2. 在仓库设置中启用 GitHub Pages
3. 选择 `main` 分支作为源

### 后端部署
后端需要部署到支持 Node.js 的云服务，如：
- Vercel
- Render
- Railway
- Heroku

## 许可证
MIT License
