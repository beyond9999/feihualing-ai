"""FastAPI 入口：飞花令对战接口。"""
from __future__ import annotations

import sys

# Windows 控制台默认 GBK，poetry_data 导入时会打印中文日志，先把输出切到 UTF-8，
# 这样不必再依赖外部 PYTHONUTF8=1 环境变量（PowerShell/bash 都能直接启动）。
for _stream in (sys.stdout, sys.stderr):
    if _stream and hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8")
        except Exception:
            pass

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from ai import judge_player_line, narrate
from game import (
    Role, Session, TurnResult, apply_move, check_player_move,
)
from poetry_data import INDEX, _normalize

app = FastAPI(title="飞花令 · AI 李白")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # 本地开发；上线前收敛
    allow_methods=["*"],
    allow_headers=["*"],
)

# 内存里的对局表。进程重启即清空，足够骨架用。
SESSIONS: dict[str, Session] = {}


# 随机令字池：飞花令常见字。实际抽取时还会按诗库句数过滤。
RANDOM_KEYWORDS = list("春月花风山酒云人天水夜秋江雨雪南雁柳梦愁")


def _random_keyword() -> str:
    import secrets
    # 只在句数充足(>=1000)的字里抽，避免冷门字几轮就词穷
    pool = [c for c in RANDOM_KEYWORDS if len(INDEX.verses_with(c)) >= 1000]
    return secrets.choice(pool or ["月"])


class StartGame(BaseModel):
    keyword: str | None = Field(None, max_length=1, description="令字；留空则随机")


class PlayerMove(BaseModel):
    text: str
    ask_model: bool = True  # 数据集查不到时是否调模型复核


@app.get("/api/keyword")
def draw_keyword():
    """抽一个随机令字（开局前可反复抽来换字）。"""
    return {"keyword": _random_keyword()}


@app.post("/api/games")
def start_game(body: StartGame):
    raw = _normalize(body.keyword) if body.keyword else ""
    if raw:
        if len(raw) != 1:
            raise HTTPException(400, "令字需是单个汉字。")
        if not INDEX.verses_with(raw):
            raise HTTPException(400, f"诗库里没有含“{raw}”的诗句，换个字吧。")
        kw = raw
    else:
        kw = _random_keyword()
    s = Session(keyword=kw)
    SESSIONS[s.id] = s
    return {
        "session_id": s.id,
        "keyword": kw,
        "round": s.round,
        "next_turn": s.next_turn,
        "greeting": narrate("greeting", kw),
        "ai_pool_size": len(INDEX.verses_with(kw)),
    }


@app.get("/api/games/{sid}")
def get_game(sid: str):
    s = _get(sid)
    return {
        "keyword": s.keyword,
        "round": s.round,
        "next_turn": s.next_turn,
        "over": s.over,
        "winner": s.winner,
        "history": [
            {"role": m.role, "text": m.text, "author": m.author, "title": m.title}
            for m in s.history
        ],
    }


@app.post("/api/games/{sid}/move")
def player_move(sid: str, body: PlayerMove):
    s = _get(sid)
    if s.over:
        raise HTTPException(400, "本局已结束。")
    if s.next_turn != Role.HUMAN:
        raise HTTPException(400, "还没轮到你。")

    # 先纯本地校验，再决定要不要问模型
    result, verse = check_player_move(s, body.text, model_verdict=None)
    if result == TurnResult.NO_POEM and body.ask_model:
        verdict = judge_player_line(s.keyword, body.text)
        result, verse = check_player_move(s, body.text, model_verdict=verdict)

    if result != TurnResult.ACCEPTED:
        # 任一校验不通过即判玩家负，本局结束
        s.over = True
        s.winner = Role.AI
        return {
            "accepted": False,
            "reason": result.value,
            "comment": narrate(result.value, s.keyword),
            "over": True,
            "winner": Role.AI,
            "round": s.round,
            "stats": _stats(s),
        }

    apply_move(s, Role.HUMAN, body.text, verse)

    # 轮到 AI
    ai_verse = s.ai_pick()
    if ai_verse is None:
        s.over = True
        s.winner = Role.HUMAN
        return {
            "accepted": True,
            "player": {"text": verse.text, "author": verse.author, "title": verse.title},
            "ai": None,
            "over": True,
            "winner": Role.HUMAN,
            "comment": narrate("ai_lose", s.keyword),
            "round": s.round,
            "stats": _stats(s),
        }

    apply_move(s, Role.AI, ai_verse.text, ai_verse)
    return {
        "accepted": True,
        "player": {"text": verse.text, "author": verse.author, "title": verse.title},
        "ai": {"text": ai_verse.text, "author": ai_verse.author, "title": ai_verse.title},
        "next_turn": s.next_turn,
        "over": False,
        "round": s.round,
        "remaining": len(INDEX.verses_with(s.keyword)) - len(s.used),
    }


@app.post("/api/games/{sid}/resign")
def resign(sid: str):
    s = _get(sid)
    s.over = True
    s.winner = Role.AI
    return {
        "over": True,
        "winner": Role.AI,
        "comment": narrate("human_resign", s.keyword),
        "round": s.round,
        "stats": _stats(s),
    }


def _stats(s: Session) -> dict:
    """结算数据，供前端段位卡使用。"""
    return {
        "round": s.round,
        "player_moves": s.player_moves,
        "total_moves": len(s.history),
    }


def _get(sid: str) -> Session:
    s = SESSIONS.get(sid)
    if not s:
        raise HTTPException(404, "找不到这局。")
    return s


# 顺便把前端静态页挂上去，一个进程同时提供前后端
_frontend = __import__("pathlib").Path(__file__).resolve().parent.parent / "frontend"
if _frontend.is_dir():
    app.mount("/", StaticFiles(directory=str(_frontend), html=True), name="frontend")
