const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const https = require('https');
const http = require('http');
const cron = require('node-cron');
const Parser = require('rss-parser');

const parser = new Parser({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const upload = multer({ dest: 'temp/' });

const TEMP_DIR = path.join(__dirname, 'temp');
const TEMPLATE_DIR = path.join(__dirname, 'Chinese_Resume_Template_中文简历模板___1_');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const newsCache = {};
const NEWS_CACHE_DURATION = 5 * 60 * 1000;

const BALLDONTLIE_API_KEY = '21bb7a28-e638-41ab-9065-30a101561436';

const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY || '';
const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

let aiGeneratedNews = {
    nba: [],
    cba: [],
    epl: [],
    csl: [],
    worldcup: [],
    tennis: []
};

const categoryKeywords = {
    all: ['sports', 'football', 'basketball', 'tennis', 'soccer'],
    nba: ['NBA', 'basketball', 'Lakers', 'Warriors', 'Celtics', '詹姆斯', '库里'],
    cba: ['CBA', '中国篮球', '男篮', '广东宏远', '辽宁男篮'],
    epl: ['英超', 'Premier League', 'Manchester', 'Liverpool', 'Arsenal', 'Chelsea', '曼城', '利物浦', '阿森纳'],
    csl: ['中超', 'Chinese Super League', '广州恒大', '北京国安', '上海申花', '山东泰山'],
    worldcup: ['世界杯', 'World Cup', 'FIFA'],
    tennis: ['网球', 'tennis', 'ATP', 'WTA', '大满贯', '澳网', '法网', '温网', '美网', '德约', '纳达尔', '阿尔卡拉斯', '辛纳', '郑钦文']
};

const RSS_FEEDS = {
    nba: [
        { url: 'https://www.espn.com/espn/rss/nba/news', source: 'ESPN NBA' }
    ],
    cba: [
        { url: 'https://www.espn.com/espn/rss/nba/news', source: 'ESPN篮球' }
    ],
    epl: [
        { url: 'https://www.espn.com/espn/rss/soccer/news', source: 'ESPN Soccer' }
    ],
    csl: [
        { url: 'https://www.espn.com/espn/rss/soccer/news', source: 'ESPN足球' }
    ],
    worldcup: [
        { url: 'https://www.espn.com/espn/rss/soccer/news', source: 'ESPN' }
    ],
    tennis: [
        { url: 'https://www.espn.com/espn/rss/tennis/news', source: 'ESPN Tennis' }
    ]
};

let rssNewsCache = {
    nba: [],
    cba: [],
    epl: [],
    csl: [],
    worldcup: [],
    tennis: []
};

async function fetchRSSFeed(url, source, category) {
    try {
        const feed = await parser.parseURL(url);
        return feed.items.slice(0, 9).map(item => ({
            title: item.title || '无标题',
            description: (item.contentSnippet || item.summary || '').substring(0, 150),
            source: source,
            category: category,
            publishedAt: item.pubDate || item.isoDate || new Date().toISOString(),
            views: Math.floor(Math.random() * 30000) + 10000,
            isHot: false,
            url: item.link || '#'
        }));
    } catch (e) {
        console.error(`RSS获取失败 [${source}]:`, e.message);
        return [];
    }
}

async function refreshRSSNews() {
    console.log('开始刷新RSS新闻...');
    
    for (const category of Object.keys(RSS_FEEDS)) {
        const feeds = RSS_FEEDS[category];
        let allArticles = [];
        
        for (const feed of feeds) {
            const articles = await fetchRSSFeed(feed.url, feed.source, category);
            allArticles = allArticles.concat(articles);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        allArticles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
        rssNewsCache[category] = allArticles.slice(0, 9);
        
        if (allArticles.length > 0) {
            console.log(`${category}新闻已更新: ${rssNewsCache[category].length}条`);
        }
    }
    
    console.log('RSS新闻刷新完成');
}

const categoryPrompts = {
    nba: '请生成3条今日NBA篮球新闻，包括比赛结果、球员表现、交易传闻等。每条新闻包含标题(20字内)和简介(50字内)，格式为JSON数组: [{"title":"...", "description":"...", "source":"来源"}]',
    cba: '请生成3条今日CBA中国篮球新闻，包括比赛结果、球员动态等。每条新闻包含标题(20字内)和简介(50字内)，格式为JSON数组: [{"title":"...", "description":"...", "source":"来源"}]',
    epl: '请生成3条今日英超足球新闻，包括比赛结果、积分榜变化、转会消息等。每条新闻包含标题(20字内)和简介(50字内)，格式为JSON数组: [{"title":"...", "description":"...", "source":"来源"}]',
    csl: '请生成3条今日中超足球新闻，包括比赛结果、球队动态等。每条新闻包含标题(20字内)和简介(50字内)，格式为JSON数组: [{"title":"...", "description":"...", "source":"来源"}]',
    worldcup: '请生成2条世界杯相关新闻，包括预选赛进展、筹备情况等。每条新闻包含标题(20字内)和简介(50字内)，格式为JSON数组: [{"title":"...", "description":"...", "source":"来源"}]',
    euro: '请生成2条欧洲杯相关新闻，包括预选赛、历史回顾等。每条新闻包含标题(20字内)和简介(50字内)，格式为JSON数组: [{"title":"...", "description":"...", "source":"来源"}]',
    tennis: '请生成3条今日网球新闻，包括ATP/WTA赛事、大满贯、中国球员表现等。每条新闻包含标题(20字内)和简介(50字内)，格式为JSON数组: [{"title":"...", "description":"...", "source":"来源"}]'
};

async function callZhipuAI(prompt) {
    if (!ZHIPU_API_KEY) {
        console.log('智谱AI API Key未配置，使用模拟数据');
        return null;
    }
    
    return new Promise((resolve, reject) => {
        const requestBody = JSON.stringify({
            model: 'glm-4-flash',
            messages: [
                {
                    role: 'system',
                    content: '你是一个体育新闻编辑，擅长生成简洁准确的体育新闻。请严格按照JSON格式返回数据，不要添加任何其他文字。'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.7,
            max_tokens: 1000
        });
        
        const options = {
            hostname: 'open.bigmodel.cn',
            path: '/api/paas/v4/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ZHIPU_API_KEY}`,
                'Content-Length': Buffer.byteLength(requestBody)
            }
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode !== 200) {
                        console.error('智谱AI API错误:', res.statusCode, data);
                        resolve(null);
                        return;
                    }
                    const json = JSON.parse(data);
                    const content = json.choices?.[0]?.message?.content || '';
                    
                    const jsonMatch = content.match(/\[[\s\S]*\]/);
                    if (jsonMatch) {
                        const articles = JSON.parse(jsonMatch[0]);
                        resolve(articles);
                    } else {
                        console.error('无法解析AI返回的JSON:', content);
                        resolve(null);
                    }
                } catch (e) {
                    console.error('解析智谱AI响应失败:', e.message);
                    resolve(null);
                }
            });
        });
        
        req.on('error', (e) => {
            console.error('智谱AI请求错误:', e.message);
            resolve(null);
        });
        
        req.write(requestBody);
        req.end();
    });
}

async function generateNewsForCategory(category) {
    const prompt = categoryPrompts[category];
    if (!prompt) return [];
    
    try {
        const articles = await callZhipuAI(prompt);
        if (articles && Array.isArray(articles)) {
            return articles.map((article, index) => ({
                title: article.title || '未知标题',
                description: article.description || '',
                source: article.source || 'AI生成',
                category: category,
                publishedAt: new Date(Date.now() - index * 3600000).toISOString(),
                views: Math.floor(Math.random() * 50000) + 10000,
                isHot: index === 0,
                url: '#'
            }));
        }
    } catch (e) {
        console.error(`生成${category}新闻失败:`, e.message);
    }
    return [];
}

async function refreshAllAINews() {
    console.log('开始刷新AI新闻...');
    const categories = ['nba', 'cba', 'epl', 'csl', 'worldcup', 'euro', 'tennis'];
    
    for (const category of categories) {
        const news = await generateNewsForCategory(category);
        if (news.length > 0) {
            aiGeneratedNews[category] = news;
            console.log(`${category}新闻已更新: ${news.length}条`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('AI新闻刷新完成');
}

async function fetchNBAGames() {
    return new Promise((resolve, reject) => {
        const dates = [];
        for (let i = 0; i < 7; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            dates.push(date.toISOString().split('T')[0]);
        }
        
        const datesQuery = dates.map(d => `dates[]=${d}`).join('&');
        
        const options = {
            hostname: 'api.balldontlie.io',
            path: `/v1/games?${datesQuery}&per_page=25`,
            method: 'GET',
            headers: {
                'Authorization': BALLDONTLIE_API_KEY
            }
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode !== 200) {
                        console.error('NBA API状态码:', res.statusCode, data.substring(0, 200));
                        resolve([]);
                        return;
                    }
                    const json = JSON.parse(data);
                    resolve(json.data || []);
                } catch (e) {
                    console.error('NBA API解析错误:', e.message, data.substring(0, 200));
                    resolve([]);
                }
            });
        });
        
        req.on('error', (e) => {
            console.error('NBA API请求错误:', e.message);
            resolve([]);
        });
        req.end();
    });
}

async function fetchNBAPlayers() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.balldontlie.io',
            path: '/v1/players?per_page=25',
            method: 'GET',
            headers: {
                'Authorization': BALLDONTLIE_API_KEY
            }
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode !== 200) {
                        resolve([]);
                        return;
                    }
                    const json = JSON.parse(data);
                    resolve(json.data || []);
                } catch (e) {
                    resolve([]);
                }
            });
        });
        
        req.on('error', () => resolve([]));
        req.end();
    });
}

async function fetchNBAStats() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.balldontlie.io',
            path: '/v1/stats?per_page=25',
            method: 'GET',
            headers: {
                'Authorization': BALLDONTLIE_API_KEY
            }
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode !== 200) {
                        resolve([]);
                        return;
                    }
                    const json = JSON.parse(data);
                    resolve(json.data || []);
                } catch (e) {
                    resolve([]);
                }
            });
        });
        
        req.on('error', () => resolve([]));
        req.end();
    });
}

async function fetchEPLStandings() {
    return new Promise((resolve) => {
        resolve(null);
    });
}

async function fetchEPLMatches() {
    return new Promise((resolve) => {
        resolve(null);
    });
}

async function fetchTennisRankings() {
    return new Promise((resolve) => {
        resolve(null);
    });
}

async function fetchTennisNews() {
    return new Promise((resolve) => {
        resolve(null);
    });
}

const mockNewsData = {
    nba: [
        { title: 'NBA全明星周末精彩落幕，新秀挑战赛创收视新高', description: '2025年NBA全明星周末圆满结束，新秀挑战赛吸引了全球数亿观众观看...', source: 'NBA官网', category: 'nba', publishedAt: new Date(Date.now() - 3600000).toISOString(), views: 125000, isHot: true },
        { title: '库里三分大赛再夺冠，追平历史纪录', description: '斯蒂芬·库里在全明星三分大赛中再次夺冠，追平历史最多夺冠纪录...', source: 'ESPN', category: 'nba', publishedAt: new Date(Date.now() - 7200000).toISOString(), views: 98000 },
        { title: '东契奇全明星MVP，砍下40分带队获胜', description: '卢卡·东契奇在全明星正赛中表现出色，砍下40分荣膺MVP...', source: 'NBA官网', category: 'nba', publishedAt: new Date(Date.now() - 14400000).toISOString(), views: 76000 }
    ],
    cba: [
        { title: '广东宏远主场大胜，易建联退役仪式隆重举行', description: '广东宏远在主场为功勋球员易建联举办退役仪式，全场球迷起立致敬...', source: 'CBA官网', category: 'cba', publishedAt: new Date(Date.now() - 5400000).toISOString(), views: 89000, isHot: true },
        { title: '辽宁男篮客场险胜，郭艾伦复出表现亮眼', description: '郭艾伦伤愈复出，全场贡献25分8助攻，帮助球队客场取胜...', source: '新浪体育', category: 'cba', publishedAt: new Date(Date.now() - 10800000).toISOString(), views: 67000 }
    ],
    epl: [
        { title: '曼城 3-1 切尔西，哈兰德梅开二度', description: '英超第25轮，曼城主场迎战切尔西，哈兰德打入两球帮助球队取胜...', source: '英超官网', category: 'epl', publishedAt: new Date(Date.now() - 1800000).toISOString(), views: 156000, isHot: true },
        { title: '利物浦 2-0 纽卡斯尔，萨拉赫点球破门', description: '利物浦主场轻取纽卡斯尔，萨拉赫点球命中，球队继续追赶榜首...', source: 'BBC Sport', category: 'epl', publishedAt: new Date(Date.now() - 5400000).toISOString(), views: 134000 },
        { title: '阿森纳客场1-1战平，争冠形势严峻', description: '阿森纳在客场被对手逼平，与榜首分差扩大到5分...', source: '天空体育', category: 'epl', publishedAt: new Date(Date.now() - 9000000).toISOString(), views: 112000 },
        { title: '曼联换帅传闻不断，滕哈格压力山大', description: '曼联近期战绩不佳，关于主帅滕哈格的去留问题成为焦点...', source: '每日邮报', category: 'epl', publishedAt: new Date(Date.now() - 18000000).toISOString(), views: 89000 }
    ],
    csl: [
        { title: '山东泰山主场取胜，继续领跑积分榜', description: '山东泰山主场2-0战胜对手，继续稳居积分榜榜首...', source: '中超官网', category: 'csl', publishedAt: new Date(Date.now() - 7200000).toISOString(), views: 45000, isHot: true },
        { title: '上海申花客场抢分，亚冠资格争夺白热化', description: '上海申花在客场取得宝贵一分，亚冠资格争夺进入白热化阶段...', source: '新浪体育', category: 'csl', publishedAt: new Date(Date.now() - 14400000).toISOString(), views: 38000 }
    ],
    worldcup: [
        { title: '2026世界杯筹备工作有序推进', description: '国际足联公布2026年世界杯最新筹备进展，三主办国场馆建设顺利...', source: 'FIFA官网', category: 'worldcup', publishedAt: new Date(Date.now() - 86400000).toISOString(), views: 78000 },
        { title: '世界杯预选赛激战正酣，多支强队提前出线', description: '世界杯预选赛各大洲比赛正在进行，多支传统强队已提前锁定出线名额...', source: 'FIFA官网', category: 'worldcup', publishedAt: new Date(Date.now() - 172800000).toISOString(), views: 56000 }
    ],
    tennis: [
        { title: 'ATP多哈站：辛纳夺冠，世界第一稳如泰山', description: '意大利名将辛纳在多哈站决赛中直落两盘取胜，继续领跑ATP排名...', source: 'ATP官网', category: 'tennis', publishedAt: new Date(Date.now() - 3600000).toISOString(), views: 145000, isHot: true },
        { title: '郑钦文迪拜站晋级四强，世界排名创新高', description: '中国选手郑钦文在迪拜站表现出色，世界排名升至第7位...', source: 'WTA官网', category: 'tennis', publishedAt: new Date(Date.now() - 7200000).toISOString(), views: 167000 },
        { title: '德约科维奇宣布参加印第安维尔斯大师赛', description: '德约科维奇确认将参加印第安维尔斯大师赛，继续追逐更多冠军...', source: 'ATP官网', category: 'tennis', publishedAt: new Date(Date.now() - 14400000).toISOString(), views: 98000 },
        { title: '阿尔卡拉斯因伤退出阿卡普尔科站', description: '西班牙新星阿尔卡拉斯因腿部伤势退出阿卡普尔科站的比赛...', source: 'ATP官网', category: 'tennis', publishedAt: new Date(Date.now() - 21600000).toISOString(), views: 76000 }
    ]
};

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

app.get('/api/news', async (req, res) => {
    const category = req.query.category || 'all';
    const now = Date.now();
    
    if (newsCache[category] && (now - newsCache[category].timestamp) < NEWS_CACHE_DURATION) {
        return res.json({ articles: newsCache[category].data });
    }
    
    try {
        let articles = [];
        
        if (category === 'nba' || category === 'all') {
            try {
                const games = await fetchNBAGames();
                const stats = await fetchNBAStats();
                
                const nbaArticles = [];
                
                if (games && games.length > 0) {
                    games.slice(0, 5).forEach(game => {
                        const homeTeam = game.home_team?.full_name || '主队';
                        const visitorTeam = game.visitor_team?.full_name || '客队';
                        const homeScore = game.home_team_score || 0;
                        const visitorScore = game.visitor_team_score || 0;
                        const status = game.status || '';
                        const time = game.time || '';
                        
                        let title = '';
                        let description = '';
                        
                        if (status === 'Final') {
                            const winner = homeScore > visitorScore ? homeTeam : visitorTeam;
                            title = `${homeTeam} vs ${visitorTeam} - ${winner}获胜`;
                            description = `最终比分: ${homeTeam} ${homeScore} - ${visitorScore} ${visitorTeam}`;
                        } else {
                            title = `${homeTeam} vs ${visitorTeam} - ${status}`;
                            description = `比赛时间: ${time || '进行中'}`;
                        }
                        
                        nbaArticles.push({
                            title,
                            description,
                            source: 'NBA Live',
                            category: 'nba',
                            publishedAt: game.date || new Date().toISOString(),
                            views: Math.floor(Math.random() * 50000) + 10000,
                            isHot: status === 'Final' || status === 'In Progress',
                            url: '#'
                        });
                    });
                }
                
                if (stats && stats.length > 0) {
                    const topPerformers = stats.slice(0, 3);
                    topPerformers.forEach(stat => {
                        const player = stat.player;
                        if (player) {
                            const name = `${player.first_name} ${player.last_name}`;
                            const team = player.team?.full_name || '';
                            const pts = stat.pts || 0;
                            const reb = stat.reb || 0;
                            const ast = stat.ast || 0;
                            
                            nbaArticles.push({
                                title: `${name}表现出色，砍下${pts}分`,
                                description: `${team}球员${name}贡献${pts}分${reb}篮板${ast}助攻`,
                                source: 'NBA Stats',
                                category: 'nba',
                                publishedAt: new Date().toISOString(),
                                views: Math.floor(Math.random() * 30000) + 20000,
                                isHot: pts >= 30,
                                url: '#'
                            });
                        }
                    });
                }
                
                if (rssNewsCache.nba && rssNewsCache.nba.length > 0) {
                    if (category === 'nba') {
                        articles = rssNewsCache.nba;
                    } else {
                        articles = articles.concat(rssNewsCache.nba.slice(0, 3));
                    }
                } else if (nbaArticles.length > 0) {
                    if (category === 'nba') {
                        articles = nbaArticles;
                    } else {
                        articles = articles.concat(nbaArticles.slice(0, 3));
                    }
                } else {
                    if (category === 'nba') {
                        articles = mockNewsData.nba || [];
                    } else {
                        articles = articles.concat((mockNewsData.nba || []).slice(0, 2));
                    }
                }
            } catch (e) {
                console.error('获取NBA数据失败:', e.message);
                if (rssNewsCache.nba && rssNewsCache.nba.length > 0) {
                    if (category === 'nba') {
                        articles = rssNewsCache.nba;
                    } else {
                        articles = articles.concat(rssNewsCache.nba.slice(0, 2));
                    }
                } else if (category === 'nba') {
                    articles = mockNewsData.nba || [];
                } else {
                    articles = articles.concat((mockNewsData.nba || []).slice(0, 2));
                }
            }
        }
        
        if (category === 'epl' || category === 'all') {
            if (rssNewsCache.epl && rssNewsCache.epl.length > 0) {
                if (category === 'epl') {
                    articles = rssNewsCache.epl;
                } else {
                    articles = articles.concat(rssNewsCache.epl.slice(0, 2));
                }
            } else {
                if (category === 'epl') {
                    articles = mockNewsData.epl || [];
                } else {
                    articles = articles.concat((mockNewsData.epl || []).slice(0, 2));
                }
            }
        }
        
        if (category === 'tennis' || category === 'all') {
            if (rssNewsCache.tennis && rssNewsCache.tennis.length > 0) {
                if (category === 'tennis') {
                    articles = rssNewsCache.tennis;
                } else {
                    articles = articles.concat(rssNewsCache.tennis.slice(0, 2));
                }
            } else {
                if (category === 'tennis') {
                    articles = mockNewsData.tennis || [];
                } else {
                    articles = articles.concat((mockNewsData.tennis || []).slice(0, 2));
                }
            }
        }
        
        const otherCategories = ['cba', 'csl', 'worldcup'];
        if (category === 'all') {
            for (const cat of otherCategories) {
                if (rssNewsCache[cat] && rssNewsCache[cat].length > 0) {
                    articles = articles.concat(rssNewsCache[cat].slice(0, 2));
                } else if (aiGeneratedNews[cat] && aiGeneratedNews[cat].length > 0) {
                    articles = articles.concat(aiGeneratedNews[cat].slice(0, 2));
                } else if (mockNewsData[cat]) {
                    articles = articles.concat(mockNewsData[cat].slice(0, 2));
                }
            }
        } else if (otherCategories.includes(category)) {
            if (rssNewsCache[category] && rssNewsCache[category].length > 0) {
                articles = rssNewsCache[category];
            } else if (aiGeneratedNews[category] && aiGeneratedNews[category].length > 0) {
                articles = aiGeneratedNews[category];
            } else {
                articles = mockNewsData[category] || [];
            }
        }
        
        if (articles.length === 0) {
            if (rssNewsCache[category] && rssNewsCache[category].length > 0) {
                articles = rssNewsCache[category];
            } else if (aiGeneratedNews[category] && aiGeneratedNews[category].length > 0) {
                articles = aiGeneratedNews[category];
            } else {
                articles = mockNewsData[category] || [];
            }
            if (articles.length === 0 && category === 'all') {
                for (const cat of Object.keys(mockNewsData)) {
                    articles = articles.concat(mockNewsData[cat].slice(0, 2));
                }
            }
        }
        
        articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
        
        newsCache[category] = {
            data: articles,
            timestamp: now
        };
        
        res.json({ articles });
    } catch (error) {
        console.error('获取新闻失败:', error);
        res.status(500).json({ error: '获取新闻失败', articles: [] });
    }
});

app.get('/api/live-scores', async (req, res) => {
    const category = req.query.category || 'all';
    
    try {
        let matches = [];
        
        if (category === 'nba') {
            matches = await fetchNBALiveScores();
        } else if (category === 'cba') {
            matches = await fetchCBALiveScores();
        } else if (category === 'epl') {
            matches = await fetchEPLLiveScores();
        } else if (category === 'csl') {
            matches = await fetchCSLLiveScores();
        } else if (category === 'worldcup') {
            matches = await fetchWorldCupLiveScores();
        } else if (category === 'tennis') {
            matches = await fetchTennisLiveScores();
        } else if (category === 'all') {
            const [nba, epl] = await Promise.all([
                fetchNBALiveScores(),
                fetchEPLLiveScores()
            ]);
            matches = [...nba.slice(0, 3), ...epl.slice(0, 3)];
        }
        
        res.json({ matches });
    } catch (error) {
        console.error('获取比分失败:', error);
        res.json({ matches: [] });
    }
});

app.get('/api/standings', async (req, res) => {
    const category = req.query.category || 'all';
    
    try {
        let standings = [];
        
        if (category === 'nba') {
            standings = await fetchNBAStandings();
        } else if (category === 'cba') {
            standings = await fetchCBAStandings();
        } else if (category === 'epl') {
            standings = await fetchEPLStandings();
        } else if (category === 'csl') {
            standings = await fetchCSLStandings();
        } else if (category === 'worldcup') {
            standings = await fetchWorldCupStandings();
        } else if (category === 'tennis') {
            standings = await fetchTennisStandings();
        } else if (category === 'all') {
            const [nba, epl] = await Promise.all([
                fetchNBAStandings(),
                fetchEPLStandings()
            ]);
            standings = [...nba.slice(0, 5), ...epl.slice(0, 5)];
        }
        
        res.json({ standings });
    } catch (error) {
        console.error('获取积分榜失败:', error);
        res.json({ standings: [] });
    }
});

app.post('/api/translate', async (req, res) => {
    const { text, title } = req.body;
    
    if (!text) {
        return res.json({ translatedText: '' });
    }
    
    if (!ZHIPU_API_KEY) {
        return res.json({ translatedText: text });
    }
    
    try {
        const response = await fetch(ZHIPU_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ZHIPU_API_KEY}`
            },
            body: JSON.stringify({
                model: 'glm-4-flash',
                messages: [{
                    role: 'user',
                    content: `请将以下体育新闻翻译成中文，保持专业术语准确，语言流畅自然：\n\n标题：${title || ''}\n\n内容：${text}`
                }],
                max_tokens: 1000
            })
        });
        
        const data = await response.json();
        const translatedText = data.choices?.[0]?.message?.content || text;
        
        res.json({ translatedText });
    } catch (error) {
        console.error('翻译失败:', error);
        res.json({ translatedText: text });
    }
});

app.post('/api/news-detail', async (req, res) => {
    const { url, title, description } = req.body;
    
    if (!url) {
        return res.json({ content: '', translatedContent: '' });
    }
    
    let content = description || '';
    let translatedContent = '';
    
    if (ZHIPU_API_KEY) {
        try {
            const prompt = `你是一个体育新闻编辑。请根据以下新闻标题和概述，生成一段详细的新闻内容（约200-300字），内容要专业、真实感强，包含比赛细节、球员表现、数据统计等：\n\n标题：${title || ''}\n概述：${description || ''}`;
            
            const response = await fetch(ZHIPU_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${ZHIPU_API_KEY}`
                },
                body: JSON.stringify({
                    model: 'glm-4-flash',
                    messages: [{
                        role: 'user',
                        content: prompt
                    }],
                    max_tokens: 500
                })
            });
            
            const data = await response.json();
            content = data.choices?.[0]?.message?.content || description || '';
            
            const translateResponse = await fetch(ZHIPU_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${ZHIPU_API_KEY}`
                },
                body: JSON.stringify({
                    model: 'glm-4-flash',
                    messages: [{
                        role: 'user',
                        content: `请将以下体育新闻翻译成流畅的中文：\n\n${content}`
                    }],
                    max_tokens: 500
                })
            });
            
            const translateData = await translateResponse.json();
            translatedContent = translateData.choices?.[0]?.message?.content || '';
        } catch (error) {
            console.error('生成详情失败:', error);
        }
    }
    
    res.json({ content, translatedContent });
});

async function fetchNBALiveScores() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const response = await fetch(`https://api.balldontlie.io/v1/games?dates[]=${today}`, {
            headers: { 'Authorization': BALLDONTLIE_API_KEY }
        });
        const data = await response.json();
        
        return (data.data || []).map(game => ({
            homeTeam: game.home_team?.full_name || game.home_team?.abbreviation || '主队',
            awayTeam: game.visitor_team?.full_name || game.visitor_team?.abbreviation || '客队',
            homeScore: game.home_team_score || 0,
            awayScore: game.visitor_team_score || 0,
            status: game.status === 'Final' ? '已结束' : (game.status === 'In Progress' ? '进行中' : game.status),
            time: game.period ? `第${game.period}节` : '',
            isLive: game.status === 'In Progress'
        }));
    } catch (e) {
        console.error('获取NBA比分失败:', e.message);
        return [];
    }
}

async function fetchCBALiveScores() {
    try {
        const response = await fetch('https://m.zhibo8.cc/zuqiu/', {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        return [];
    } catch (e) {
        console.error('获取CBA比分失败:', e.message);
        return [];
    }
}

async function fetchEPLLiveScores() {
    try {
        const today = new Date();
        const dateFrom = today.toISOString().split('T')[0];
        const dateTo = new Date(today.getTime() + 86400000).toISOString().split('T')[0];
        
        const response = await fetch(`https://api.football-data.org/v4/competitions/PL/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`, {
            headers: { 'X-Auth-Token': '8f5e6e7c9a4b4d8e9f0a1b2c3d4e5f6a' }
        });
        const data = await response.json();
        
        return (data.matches || []).map(match => {
            let status = '未开始';
            let isLive = false;
            let time = '';
            
            if (match.status === 'FINISHED') {
                status = '已结束';
            } else if (match.status === 'IN_PLAY') {
                status = '进行中';
                isLive = true;
                time = match.minute ? `${match.minute}'` : '';
            } else if (match.status === 'PAUSED') {
                status = '中场休息';
                isLive = true;
            } else if (match.status === 'TIMED') {
                status = '即将开始';
                time = new Date(match.utcDate).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            }
            
            return {
                homeTeam: match.homeTeam?.name || '主队',
                awayTeam: match.awayTeam?.name || '客队',
                homeScore: match.score?.fullTime?.home ?? match.score?.halfTime?.home ?? 0,
                awayScore: match.score?.fullTime?.away ?? match.score?.halfTime?.away ?? 0,
                status,
                time,
                isLive,
                homeLogo: '',
                awayLogo: ''
            };
        });
    } catch (e) {
        console.error('获取英超比分失败:', e.message);
        return [];
    }
}

async function fetchCSLLiveScores() {
    try {
        const response = await fetch('https://api.football-data.org/v4/competitions/CNCSL/matches', {
            headers: { 'X-Auth-Token': '8f5e6e7c9a4b4d8e9f0a1b2c3d4e5f6a' }
        });
        const data = await response.json();
        
        return (data.matches || []).slice(0, 6).map(match => ({
            homeTeam: match.homeTeam?.name || '主队',
            awayTeam: match.awayTeam?.name || '客队',
            homeScore: match.score?.fullTime?.home ?? 0,
            awayScore: match.score?.fullTime?.away ?? 0,
            status: match.status === 'FINISHED' ? '已结束' : (match.status === 'IN_PLAY' ? '进行中' : '未开始'),
            time: match.minute ? `${match.minute}'` : '',
            isLive: match.status === 'IN_PLAY'
        }));
    } catch (e) {
        console.error('获取中超比分失败:', e.message);
        return [];
    }
}

async function fetchWorldCupLiveScores() {
    try {
        const response = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
            headers: { 'X-Auth-Token': '8f5e6e7c9a4b4d8e9f0a1b2c3d4e5f6a' }
        });
        const data = await response.json();
        
        return (data.matches || []).slice(0, 6).map(match => ({
            homeTeam: match.homeTeam?.name || '主队',
            awayTeam: match.awayTeam?.name || '客队',
            homeScore: match.score?.fullTime?.home ?? 0,
            awayScore: match.score?.fullTime?.away ?? 0,
            status: match.status === 'FINISHED' ? '已结束' : (match.status === 'IN_PLAY' ? '进行中' : '未开始'),
            time: match.minute ? `${match.minute}'` : '',
            isLive: match.status === 'IN_PLAY'
        }));
    } catch (e) {
        console.error('获取世界杯比分失败:', e.message);
        return [];
    }
}

async function fetchTennisLiveScores() {
    return [];
}

async function fetchNBAStandings() {
    try {
        const response = await fetch('https://api.balldontlie.io/v1/standings', {
            headers: { 'Authorization': BALLDONTLIE_API_KEY }
        });
        const data = await response.json();
        
        const teams = {};
        (data.data || []).forEach(team => {
            const name = team.team?.full_name || team.team?.abbreviation || '未知';
            if (!teams[name]) {
                teams[name] = { name, won: 0, lost: 0, draw: 0, points: 0 };
            }
            teams[name].won += team.wins || 0;
            teams[name].lost += team.losses || 0;
            teams[name].points = teams[name].won * 1;
        });
        
        return Object.values(teams).sort((a, b) => b.points - a.points).slice(0, 10);
    } catch (e) {
        console.error('获取NBA积分榜失败:', e.message);
        return [];
    }
}

async function fetchCBAStandings() {
    return [];
}

async function fetchEPLStandings() {
    try {
        const response = await fetch('https://api.football-data.org/v4/competitions/PL/standings', {
            headers: { 'X-Auth-Token': '8f5e6e7c9a4b4d8e9f0a1b2c3d4e5f6a' }
        });
        const data = await response.json();
        
        const table = data.standings?.[0]?.table || [];
        return table.map(team => ({
            name: team.team?.name || '未知',
            won: team.won || 0,
            lost: team.lost || 0,
            draw: team.draw || 0,
            points: team.points || 0
        }));
    } catch (e) {
        console.error('获取英超积分榜失败:', e.message);
        return [];
    }
}

async function fetchCSLStandings() {
    return [];
}

async function fetchWorldCupStandings() {
    return [];
}

async function fetchTennisStandings() {
    return [];
}

app.post('/api/refresh-ai-news', async (req, res) => {
    try {
        await refreshAllAINews();
        res.json({ success: true, message: 'AI新闻已刷新' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

const RESUMES_DIR = path.join(__dirname, 'resumes');
if (!fs.existsSync(RESUMES_DIR)) {
    fs.mkdirSync(RESUMES_DIR, { recursive: true });
}

app.post('/api/resumes', (req, res) => {
    try {
        const resume = req.body;
        resume.id = uuidv4();
        if (!resume.createdAt) {
            resume.createdAt = new Date().toISOString();
        }
        resume.updatedAt = new Date().toISOString();
        
        const resumePath = path.join(RESUMES_DIR, `${resume.id}.json`);
        fs.writeFileSync(resumePath, JSON.stringify(resume, null, 2), 'utf8');
        
        res.json({ success: true, id: resume.id });
    } catch (error) {
        console.error('保存简历失败:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/resumes', (req, res) => {
    try {
        const files = fs.readdirSync(RESUMES_DIR).filter(f => f.endsWith('.json'));
        const resumes = files.map(file => {
            const filePath = path.join(RESUMES_DIR, file);
            const content = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(content);
        });
        
        resumes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        
        res.json({ resumes });
    } catch (error) {
        console.error('获取简历列表失败:', error);
        res.status(500).json({ success: false, message: error.message, resumes: [] });
    }
});

app.get('/api/resumes/:id', (req, res) => {
    try {
        const { id } = req.params;
        const resumePath = path.join(RESUMES_DIR, `${id}.json`);
        
        if (!fs.existsSync(resumePath)) {
            return res.status(404).json({ success: false, message: '简历不存在' });
        }
        
        const content = fs.readFileSync(resumePath, 'utf8');
        const resume = JSON.parse(content);
        
        res.json({ success: true, resume });
    } catch (error) {
        console.error('获取简历失败:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/resumes/:id', (req, res) => {
    try {
        const { id } = req.params;
        const resumePath = path.join(RESUMES_DIR, `${id}.json`);
        
        if (!fs.existsSync(resumePath)) {
            return res.status(404).json({ success: false, message: '简历不存在' });
        }
        
        fs.unlinkSync(resumePath);
        
        res.json({ success: true });
    } catch (error) {
        console.error('删除简历失败:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/generate-pdf', async (req, res) => {
    const jobId = uuidv4();
    const jobDir = path.join(TEMP_DIR, jobId);
    
    try {
        fs.mkdirSync(jobDir, { recursive: true });
        
        const { latexContent, avatarData } = req.body;
        
        if (!latexContent) {
            return res.status(400).json({ error: '缺少LaTeX内容' });
        }
        
        const templateFiles = [
            'resume.cls',
            'zh_CN-Adobefonts_external.sty',
            'linespacing_fix.sty',
            'fontawesome.sty'
        ];
        
        templateFiles.forEach(file => {
            const srcPath = path.join(TEMPLATE_DIR, file);
            const destPath = path.join(jobDir, file);
            if (fs.existsSync(srcPath)) {
                fs.copyFileSync(srcPath, destPath);
            }
        });
        
        const fontsDir = path.join(TEMPLATE_DIR, 'fonts');
        const destFontsDir = path.join(jobDir, 'fonts');
        if (fs.existsSync(fontsDir)) {
            copyDir(fontsDir, destFontsDir);
        }
        
        if (avatarData) {
            const imagesDir = path.join(jobDir, 'images');
            fs.mkdirSync(imagesDir, { recursive: true });
            const base64Data = avatarData.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            fs.writeFileSync(path.join(imagesDir, 'you.jpg'), buffer);
        }
        
        const texPath = path.join(jobDir, 'resume.tex');
        fs.writeFileSync(texPath, latexContent, 'utf8');
        
        const pdfPath = path.join(jobDir, 'resume.pdf');
        
        await compileLatex(jobDir, 'resume.tex');
        
        if (fs.existsSync(pdfPath)) {
            const pdfBuffer = fs.readFileSync(pdfPath);
            
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename="resume.pdf"');
            res.send(pdfBuffer);
            
            setTimeout(() => {
                cleanupJob(jobDir);
            }, 5000);
        } else {
            throw new Error('PDF生成失败');
        }
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ 
            error: 'PDF生成失败', 
            details: error.message 
        });
        cleanupJob(jobDir);
    }
});

function compileLatex(workDir, texFile) {
    return new Promise((resolve, reject) => {
        const command = process.platform === 'win32' ? 'xelatex' : 'xelatex';
        
        const proc = spawn(command, [
            '-interaction=nonstopmode',
            '-halt-on-error',
            texFile
        ], {
            cwd: workDir,
            env: { ...process.env }
        });
        
        let stdout = '';
        let stderr = '';
        
        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        proc.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                const logPath = path.join(workDir, 'resume.log');
                let logContent = '';
                if (fs.existsSync(logPath)) {
                    logContent = fs.readFileSync(logPath, 'utf8');
                }
                reject(new Error(`LaTeX编译失败 (code ${code})\n${logContent}`));
            }
        });
        
        proc.on('error', (err) => {
            if (err.code === 'ENOENT') {
                reject(new Error('未找到xelatex命令，请确保已安装LaTeX环境（如TeX Live或MiKTeX）'));
            } else {
                reject(err);
            }
        });
    });
}

function copyDir(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function cleanupJob(jobDir) {
    try {
        if (fs.existsSync(jobDir)) {
            fs.rmSync(jobDir, { recursive: true, force: true });
        }
    } catch (e) {
        console.error('Cleanup error:', e);
    }
}

cron.schedule('0 * * * *', async () => {
    console.log('定时任务: 刷新RSS新闻');
    await refreshRSSNews();
});

if (require.main === module) {
    app.listen(PORT, async () => {
        console.log(`简历生成服务运行在 http://localhost:${PORT}`);
        console.log(`模板目录: ${TEMPLATE_DIR}`);
        console.log(`临时目录: ${TEMP_DIR}`);
        
        console.log('正在获取RSS实时新闻...');
        await refreshRSSNews();
    });
}

module.exports = app;
