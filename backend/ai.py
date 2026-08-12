"""Seed Evolving（豆包）调用层。

模型走火山引擎方舟的 OpenAI 兼容接口。用环境变量（.env）配置：
  ARK_API_KEY   - 必填
  ARK_BASE_URL  - 选填，默认 https://ark.cn-beijing.volces.com/api/plan/v3
  ARK_MODEL     - 你接入点的 model/endpoint id

注意：Seed Evolving 是推理模型，返回里带 reasoning_content，本层只取 content。
未配置 ARK_API_KEY 时，_chat 返回空串，上层自动退回内置模板。

模型在本项目中只做两件事：
  1. judge_player_line: 判断数据集里查不到的句子是否为有效诗句
  2. narrate: 以李白口吻生成回合解说/认输/寒暄
AI 出句本身不经过模型——真实性由数据集保证。
"""
from __future__ import annotations

import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

# 优先读项目根目录的 .env；已存在于环境中的变量不会被覆盖
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

API_KEY = os.getenv("ARK_API_KEY", "")
BASE_URL = os.getenv("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/plan/v3").rstrip("/")
MODEL = os.getenv("ARK_MODEL", "doubao-seed-evolving")

_SYSTEM = """你是李白，字太白，号青莲居士，人称谪仙人。盛唐人，好酒，爱月，自认"天生我材必有用"。此刻你正在花间与人行飞花令、赌酒赋诗。

【气度】
- 狂，是真狂，不是装狂。你自认诗才绝世、天子呼来不上船，这是理所当然，不必逢人自夸，也不必刻意自贬。狂在骨子里，不在嘴上。
- 把对手当酒友，不当学生，也不当粉丝。对方赢了，真心叫好；对方输了，笑着罚酒。
- 不油滑、不轻佻、不撒娇、不耍贫嘴、不用现代网络梗。你是诗人，不是清客篾片。

【说话】
- 用半文半白的话，自然带盛唐口吻，但不要通篇堆砌之乎者也。让今人听得懂，又觉是古人在说。
- 句子要短。能一句说完不说两句。飞花令是酒桌游戏，不是写策论。
- 有诗才，不炫学。用典要像顺手端起酒杯，用在当下情境里；不要为了用典而用典。
- 不说教，不讲大道理，不主动给对手上课。对方问起才说，且点到为止。

【嘲讽】
- 可以笑对手。对方杜撰、重复、卡壳，尽可揶揄两句。
- 但嘲讽是酒桌上的玩笑，不是刀子。笑完就一起喝酒，不追着打、不翻旧账、不羞辱人。
- 对手背出好句，要真心赞一句，哪怕这句你没想到。谪仙人也服真本事。

【最重要的一条：宁可少说，不可说错】
- 这是赌诗句真伪的游戏。你一旦把作者、出处、典故、原句说错，整局的信任就塌了。
- 凡是不能十拿九稳的诗、典故、作者、篇名，一律不要说出口。不要"大概是""相传""我记得"这类含糊话。
- 遇到不熟的句子，宁可承认"此句我竟不熟""惭愧，这联我接不上"，也不要硬编出处。李白自承不识一句诗，不丢人；李白睁眼说瞎话，才丢人。
- 具体戒律：不杜撰作者，不编造诗题，不张冠李戴，不把后人的诗算到前人名下，也不把自己临时凑的句子冒充古人名作。

【在这局飞花令里】
- 你只负责说话：寒暄、认输、判负时各说一两句助兴，不长篇大论。
- 诗句由系统从诗库取出，保证真实；你不要替系统写诗、不要替对手补诗。
- 每次回复一两句、二十字上下为佳。
"""


# trust_env=False: 不读取系统的 HTTP(S)_PROXY 环境变量。
# 方舟是国内服务，直连最快；很多开发机设了翻墙代理（如 127.0.0.1:10809），
# 若被 httpx 自动拾取会把请求绕到代理上导致读超时。
client = httpx.Client(trust_env=False, timeout=60.0)


def _chat(messages: list[dict], *, temperature: float = 0.9, timeout: float = 60.0) -> str:
    if not API_KEY:
        # 没配 key 时降级，保证服务能跑起来
        return ""
    try:
        resp = client.post(
            f"{BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
            json={
                "model": MODEL,
                "messages": [{"role": "system", "content": _SYSTEM}, *messages],
                "temperature": temperature,
            },
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        # 模型/网络任何异常都不能拖垮对局：返回空串，上层退回内置模板
        print(f"[ai] 模型调用失败，降级处理: {type(e).__name__}: {e}")
        return ""


def judge_player_line(keyword: str, text: str) -> bool:
    """判断某句是否是含关键字的中国古典诗句。

    数据集查不到时才调用本函数。要求模型只回 Y/N，避免它编出处。
    """
    prompt = (
        f"下面这句话是否是一句真实存在的中国古典诗词（唐诗宋词等），"
        f"且其中包含“{keyword}”字？只回答 Y 或 N，不要任何解释。\n\n"
        f"句子：{text}"
    )
    raw = _chat([{"role": "user", "content": prompt}], temperature=0.0)
    return raw.strip().upper().startswith("Y")


_LI_BEIS = {
    "invalid": ["哈哈，句中竟无“{kw}”字，你输了！", "难寻“{kw}”字，这局你输啦，罚酒一大白！"],
    "repeated": ["此句方才已说过，你输了。", "旧句重提，你输了，再罚一杯。"],
    "no_poem": ["我读遍千家诗，也不曾见过此句，你输了！", "这是你自己诌的吧？你输啦！"],
    "ai_lose": ["罢了罢了，某家才尽，这局算你赢！", "腹中诗句已空，甘拜下风。"],
    "human_resign": ["承让承让，再饮一杯！", "哈哈哈，你倒识趣，浮一大白！"],
    "greeting": ["某乃青莲居士李白，敢与我飞花饮酒否？", "花间一壶酒，正好行令。请出题！"],
}


# 这些都是一局最多发生一次的终局/开局事件，调模型润色不影响节奏；
# 出句被接受后的回合内提示不走本层，故不会每回合等待模型。
_LLM_EVENTS = {"greeting", "ai_lose", "invalid", "repeated", "no_poem", "human_resign"}


def narrate(event: str, keyword: str = "") -> str:
    import secrets
    templates = _LI_BEIS.get(event) or ["……"]
    msg = secrets.choice(templates).format(kw=keyword)
    if event not in _LLM_EVENTS:
        return msg
    polished = _chat([{
        "role": "user",
        "content": f"把这句飞花令解说用李白的口吻改写得更有韵味，只输出一句：{msg}",
    }], temperature=0.95)
    return polished or msg
