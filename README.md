# 飞花令 · 对诗李青莲

玩家与 AI 扮演的李白轮流背含同一个令字的诗句。

- AI **出句**全部来自本地 `chinese-poetry` 数据集，保证真实可核验、无幻觉；
- AI 的**李白口吻**与玩家"集外句"的判定由 Seed Evolving（豆包，火山方舟）完成；
- 后端 FastAPI，前端古风宣纸卷轴聊天界面，一个进程同时提供前后端。

## 目录结构

```
backend/    FastAPI 服务（main.py 入口、game.py 对局逻辑、poetry_data.py 建索引、ai.py 模型层）
frontend/   原生 HTML/CSS/JS，挂载在后端 / 路径下
data/       放 chinese-poetry 数据集（见 data/README.md）
.env        模型密钥（从 .env.example 复制，勿提交）
```

## 环境要求

- Python 3.10+
- Git（能访问 GitHub；如直连失败请自备代理或镜像）

## 安装与启动

```bash
# 1. 取数据（仓库较大，建议 --depth 1）
cd data
git clone --depth 1 https://github.com/chinese-poetry/chinese-poetry.git
cd ..

# 2. 创建并激活虚拟环境
python -m venv .venv
# Windows (Git Bash):
source .venv/Scripts/activate
# Windows (PowerShell):
# .venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

# 3. 安装依赖
pip install -r backend/requirements.txt

# 4. 配置模型密钥（可选；不配置也能玩，只是 AI 解说/集外句复核会降级为模板）
cp .env.example .env
# 然后编辑 .env，填入 ARK_API_KEY 和 ARK_MODEL（方舟接入点 id）

# 5. 启动（代码已在内部把输出切到 UTF-8，无需设置环境变量）
# 仅本机访问：
uvicorn main:app --reload --port 8000 --app-dir backend
# 局域网内（手机/其他电脑）也能访问：加 --host 0.0.0.0
# uvicorn main:app --reload --host 0.0.0.0 --port 8000 --app-dir backend
# Windows 首次会弹防火墙提示，点"允许"。
# 查本机 IP：ipconfig | findstr IPv4  (Windows) / ifconfig (macOS/Linux)
# 或先 cd backend 再运行：cd backend && uvicorn main:app --reload --port 8000
```

> **首次启动较慢**：服务会扫描数据集并建立"字→诗句"倒排索引（约 360 万句），
> 需数十秒，日志出现 `Uvicorn running on http://...` 后即就绪。之后每次启动都要重建索引（目前未做缓存）。

打开 http://localhost:8000 ，填一个令字（如"月"）即可开局。

## 不配置 ARK_API_KEY 会怎样

核心对弈完全可用——AI 出句来自数据集，判定含字/重复也在本地完成。
受限的只有两处：

1. 玩家输入数据集里没有的句子时，无法让模型复核，直接判为"无此句"；
2. AI 的寒暄/吐槽/认输用内置模板，而非李白口吻润色。
