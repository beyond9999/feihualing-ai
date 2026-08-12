# 诗词数据

本项目使用 [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry) 数据集。

克隆到本目录下，使结构为：

```
data/
  chinese-poetry/
    全唐诗/
    宋词/
    诗经/
    ...
```

命令：

```bash
cd data
git clone --depth 1 https://github.com/chinese-poetry/chinese-poetry.git
```

注意：

- 该仓库约数百 MB，`--depth 1` 可只取最新版本。
- 启动后端时会**递归扫描整个数据集目录**，凡是含 `paragraphs` 字段的 JSON 都会被收录；
  作者信息文件（`authors.*`）和 `error/images/loader` 等目录会自动跳过。
- 库中繁体诗句会经 opencc 转为简体后建索引，玩家用简体输入即可匹配。
- 如需调整收录范围，改 `backend/poetry_data.py` 里的 `_SKIP_DIRS` / `_SKIP_PREFIXES`。
