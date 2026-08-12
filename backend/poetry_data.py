"""加载 chinese-poetry 数据集，按单字建立诗句倒排索引。

数据集需放在 ../data/chinese-poetry 下（见 data/README.md）。
本模块只做离线建库，不含任何模型调用——AI 出句的真实性由此保证。
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

try:
    from opencc import OpenCC
    _t2s = OpenCC("t2s").convert  # 繁体 -> 简体，用于统一存储与匹配
except ImportError:  # opencc 未装时退化为原样
    print("[poetry_data] 未安装 opencc，繁简转换不可用；建议 pip install opencc-python-reimplemented")
    _t2s = lambda s: s

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "chinese-poetry"

# 跳过这些目录（非诗作 / 损坏数据）
_SKIP_DIRS = {"error", "images", "loader", "strains", "rank", ".git"}
# 作者信息等非诗作 JSON，按文件名前缀排除
_SKIP_PREFIXES = ("authors", "author")

# 标点归一化：校验和索引用无标点文本。
_PUNCT = re.compile(r"[，。！？；：、\s]+")
# 出句边界：只按句末标点/换行切分，保留逗号前后的整联。
_SENTENCE_END = re.compile(r"[。！？；\r\n]+")


@dataclass(frozen=True)
class Verse:
    text: str          # 展示用整句/整联，保留句内标点
    author: str
    title: str
    source: str        # 文件路径，便于排查

    def __hash__(self) -> int:
        return hash((self.text, self.author))


@dataclass
class PoetryIndex:
    # 字 -> 含该字的诗句集合
    by_char: dict[str, set[Verse]] = field(default_factory=lambda: defaultdict(set))
    # 去标点句文本 -> Verse，用于校验玩家输入
    by_text: dict[str, Verse] = field(default_factory=dict)
    loaded: bool = False

    def verses_with(self, char: str) -> set[Verse]:
        return self.by_char.get(char, set())

    def find(self, text: str) -> Verse | None:
        return self.by_text.get(_normalize(text))


def _normalize(text: str) -> str:
    """归一化：去标点空格、繁转简。库中诗句与玩家输入都过这里。"""
    return _t2s(_PUNCT.sub("", text).strip())


def _iter_json_files(root: Path) -> Iterable[Path]:
    """递归扫描数据集，只收诗作 JSON。

    数据集以中文目录分类（全唐诗/宋词/...），故不硬编码目录名，
    改为全量递归，靠 _SKIP_* 过滤非诗作文件。
    """
    for path in sorted(root.rglob("*.json")):
        rel_parts = path.relative_to(root).parts
        if any(part in _SKIP_DIRS for part in rel_parts):
            continue
        if path.name.startswith(_SKIP_PREFIXES):
            continue
        yield path


def load(root: Path = DATA_DIR) -> PoetryIndex:
    idx = PoetryIndex()
    if not root.exists():
        # 数据缺失时不崩，让服务仍能启动并给出明确提示
        print(f"[poetry_data] 未找到数据集目录: {root}")
        print("[poetry_data] 请按 data/README.md 说明克隆 chinese-poetry。")
        return idx

    count_files = 0
    count_verses = 0
    for path in _iter_json_files(root):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            print(f"[poetry_data] 跳过 {path.name}: {e}")
            continue
        if not isinstance(data, list):
            continue
        count_files += 1
        for item in data:
            if not isinstance(item, dict):
                continue
            author = _t2s(str(item.get("author") or "佚名"))
            title = _t2s(str(item.get("title") or item.get("rhythmic") or ""))
            for para in item.get("paragraphs") or []:
                for line in _SENTENCE_END.split(str(para)):
                    display_text = _t2s(str(line).strip())
                    norm_text = _normalize(display_text)
                    if len(norm_text) < 2:        # 过滤掉空串和单字残句
                        continue
                    v = Verse(text=display_text, author=author, title=title, source=path.name)
                    idx.by_text[norm_text] = v
                    for ch in set(norm_text):     # 同一句里同一字只索引一次
                        idx.by_char[ch].add(v)
                    count_verses += 1

    idx.loaded = True
    print(f"[poetry_data] 已加载 {count_files} 个文件，{count_verses} 个整句，"
          f"索引 {len(idx.by_char)} 个字。")
    return idx


# 全局单例，启动时建一次
INDEX = load()
