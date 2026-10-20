# 发布说明（把 mini-14 变成「浏览器能搜到」的开源项目）

> 这一步需要你本人操作：创建仓库、推送、开启 Pages。涉及账号与身份，我不代做。
> 下面每条命令都可直接复制。

## 1. 创建仓库

1. 打开 https://github.com/new
2. Repository name 填 **mini-14**
3. 选 **Public**（只有公开仓库才会被搜索引擎收录）
4. **不要**勾选 "Add a README"（本地已经有了）
5. Create repository

## 2. 推送本地代码

```powershell
cd D:\mini-14\open-source
git init
git add .
git commit -m "mini-14 v0.1: local offline AI assistant with sharded RAG"
git branch -M main
git remote add origin https://github.com/<你的用户名>/mini-14.git
git push -u origin main
```

推送时会要求登录：用 GitHub 的 **Personal Access Token**（Settings → Developer settings →
Personal access tokens → Fine-grained tokens，勾选 `Contents: Read and write`）作为密码。

## 3. 开启 GitHub Pages（让浏览器能打开网页）

仓库 → **Settings** → **Pages**：

- Source: **Deploy from a branch**
- Branch: **main** / folder: **/docs**
- Save

约 1 分钟后访问：`https://<你的用户名>.github.io/mini-14/`

## 4. 让搜索引擎收录（关键）

把 `docs/index.html`、`docs/sitemap.xml` 里的 `nike-cpu` 换成你的 GitHub 用户名，
以及 `README.md` 里的 `nike-cpu`，然后重新 push。

### Google

1. 打开 https://search.google.com/search-console
2. 添加资源 → URL 前缀 → 填 `https://<你的用户名>.github.io/mini-14/`
3. 验证：选「HTML 标记」，把给的 `<meta name="google-site-verification" ...>` 贴进
   `docs/index.html` 的 `<head>` 里，push 后回控制台点验证
4. 提交 `https://<你的用户名>.github.io/mini-14/sitemap.xml`

### Bing（国内也能用）

1. 打开 https://www.bing.com/webmasters
2. 添加站点，同样用 meta 标签验证
3. 提交站点地图

### 百度（可选）

百度站长平台 https://ziyuan.baidu.com —— 需要「网站验证」（meta 标签即可），
GitHub Pages 一般可以收录，但速度比 Bing 慢。

## 5. 搜索能搜到什么

仓库本身（GitHub 搜索）：
- 在仓库 About 里填一句 description：`Local offline AI assistant: small LLM + personal RAG`
- Topics 打上：`local-llm` `offline-ai` `rag` `llama-cpp` `qwen2` `privacy` `chinese`

网页（Google/Bing）：
- 首页标题：`mini-14 · 本地离线 AI 助手 | 开源小模型 + 个人知识库`
- 收录通常 **3 天 ~ 2 周**，先用 `site:你的域名` 自查

## 6. 之后想绑自己的域名

1. 在注册商买域名（阿里云/腾讯云/Namecheap 都行）
2. 仓库 Settings → Pages → Custom domain 填域名
3. 在 DNS 加 CNAME 记录指向 `<你的用户名>.github.io`
4. 把 `docs/index.html` 的 canonical、`sitemap.xml`、`robots.txt` 换成新域名

> 注意：GitHub Pages 在中国大陆访问不稳定，如果主要面向国内用户，
> 建议后续换到：Cloudflare Pages（免费、国内可访问较好）或国内对象存储 + 备案域名。
