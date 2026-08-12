"""飞花令对局逻辑。

规则（混合方案 C）：
- 双方围绕同一个令字轮流背诗，句中须含令字；
- 玩家出句须满足：真实存在、含令字、未被使用过——任一不满足即判负；
- AI 出句永远来自数据集（真实、可核验，绝不编造）；
- 玩家出句先在数据集里查，查不到再交给模型判断是否为有效诗句；
- 同一句不可重复（双方都算）；
- AI 按回合数提升难度：前期只出唐宋名家，后期放开到全部作者；
- AI 无句可出即认输；玩家也可主动认输。
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass, field
from enum import Enum

from poetry_data import INDEX, Verse


class Role(str, Enum):
    HUMAN = "human"
    AI = "ai"


class TurnResult(str, Enum):
    ACCEPTED = "accepted"     # 出句有效，轮到对方
    INVALID = "invalid"       # 不含令字 -> 玩家负
    REPEATED = "repeated"     # 已用过   -> 玩家负
    NO_POEM = "no_poem"       # 查无此句 -> 玩家负


# 前期只让 AI 出这些名家的句子（数据已繁转简，故用简体名）。
# 不必追求权威，覆盖最广为人知的诗人即可。
FAMOUS_POETS = {
    "李白", "杜甫", "白居易", "王维", "苏轼", "辛弃疾", "李清照", "陆游",
    "李商隐", "杜牧", "刘禹锡", "孟浩然", "王昌龄", "柳宗元", "韩愈",
    "王安石", "欧阳修", "晏殊", "晏几道", "秦观", "柳永", "范仲淹",
    "岳飞", "文天祥", "王勃", "张若虚", "张九龄", "元稹", "杨万里",
    "贺知章", "岑参", "高适", "李贺", "黄庭坚", "秦观",
}
FAMOUS_ONLY_ROUNDS = 3


@dataclass
class Move:
    role: Role
    text: str
    author: str = ""
    title: str = ""


@dataclass
class Session:
    keyword: str
    used: set[str] = field(default_factory=set)
    history: list[Move] = field(default_factory=list)
    next_turn: Role = Role.HUMAN
    over: bool = False
    winner: Role | None = None
    id: str = field(default_factory=lambda: secrets.token_hex(6))

    @property
    def round(self) -> int:
        """当前回合数（1 起算）。玩家与 AI 各出一句算一回合，
        故开局为第 1 回合，完成一次对答后进入第 2 回合。"""
        return (len(self.history) // 2) + 1

    @property
    def player_moves(self) -> int:
        """玩家成功出句的次数（用于段位评定）。"""
        return sum(1 for m in self.history if m.role == Role.HUMAN)

    def ai_pick(self) -> Verse | None:
        """AI 挑一句没用过、含令字的诗，难度随回合上升。

        策略（生僻度）：前 FAMOUS_ONLY_ROUNDS 回合只出唐宋名家的句子，
        让开局温和；之后放开到全部作者，等于把生僻句也打出来。
        名家池被掏空时自动回落到全集，保证不提前认输。
        """
        from poetry_data import _normalize
        all_candidates = [v for v in INDEX.verses_with(self.keyword)
                          if _normalize(v.text) not in self.used]
        if not all_candidates:
            return None

        if self.round <= FAMOUS_ONLY_ROUNDS:
            famous = [v for v in all_candidates if v.author in FAMOUS_POETS]
            pool = famous or all_candidates
        else:
            pool = all_candidates
        return secrets.choice(pool)


def _contains_keyword(text: str, keyword: str) -> bool:
    return keyword in text


def check_player_move(session: Session, text: str, model_verdict: bool | None = None) -> tuple[TurnResult, Verse | None]:
    """校验玩家出句。

    model_verdict: 数据集没命中时，模型给出的二次判定（True=认可为诗句）。
                   为 None 表示还没问模型，调用方应据此决定是否调用模型。
    """
    from poetry_data import _normalize
    norm = _normalize(text)

    if not _contains_keyword(norm, session.keyword):
        return TurnResult.INVALID, None
    if norm in session.used:
        return TurnResult.REPEATED, None

    verse = INDEX.find(norm)
    if verse is not None:
        return TurnResult.ACCEPTED, verse

    # 数据集里没有：交给模型裁定
    if model_verdict is True:
        # 模型认可，但数据集无据——只记录文本，无作者/出处
        return TurnResult.ACCEPTED, Verse(text=norm, author="（待考）", title="", source="model")
    if model_verdict is False:
        return TurnResult.NO_POEM, None
    # model_verdict is None -> 调用方需要去问模型
    return TurnResult.NO_POEM, None


def apply_move(session: Session, role: Role, text: str, verse: Verse | None = None) -> None:
    from poetry_data import _normalize
    norm = _normalize(text)
    session.used.add(norm)
    session.history.append(Move(
        role=role,
        text=norm,
        author=verse.author if verse else "",
        title=verse.title if verse else "",
    ))
    session.next_turn = Role.AI if role == Role.HUMAN else Role.HUMAN
