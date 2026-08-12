const $ = (s) => document.querySelector(s);

let sessionId = null;
let keyword = "";
let lastStats = null;
let drawnKw = "";   // 当前抽到/选中的令字

// 动态意象背景（ambient.js 可能尚未就绪，调用前判空）
const ambient = () => window.ambient;

// ---------- 消息渲染 ----------
function addMsg(role, text, meta = "", extraClass = "") {
  const chat = $("#chat");
  const wrap = document.createElement("div");
  wrap.className = `msg ${role} ${extraClass}`.trim();
  if (role === "ai") {
    wrap.innerHTML =
      `<div class="bubble"><span class="name">李白：</span>${escapeHtml(text)}</div>`;
  } else {
    wrap.innerHTML = `<div class="bubble">${escapeHtml(text)}</div>`;
  }
  if (meta) {
    const m = document.createElement("div");
    m.className = "meta";
    m.textContent = meta;
    wrap.appendChild(m);
  }
  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;
  return wrap;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------- 顶部状态 ----------
function setTopbar(kw, round) {
  if (kw) $("#kwChar").textContent = kw;
  if (round != null) $("#roundNum").textContent = round;
}

// ---------- 抽令字 ----------
async function drawKeyword(prefer) {
  const display = $("#drawnChar");
  if (prefer) {
    drawnKw = prefer;
    display.textContent = prefer;
    ambient()?.setKeyword(drawnKw);
    return;
  }
  display.classList.add("loading");
  try {
    const res = await fetch("/api/keyword");
    const data = await res.json();
    drawnKw = data.keyword;
    display.textContent = drawnKw;
  } catch (e) {
    drawnKw = "月";
    display.textContent = "月";
  } finally {
    display.classList.remove("loading");
  }
  ambient()?.setKeyword(drawnKw);
}

// ---------- 开局 ----------
async function startGame() {
  $("#setupErr").textContent = "";
  if (!drawnKw) { $("#setupErr").textContent = "请先抽一个令字。"; return; }

  try {
    const res = await fetch("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: drawnKw }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "开局失败");

    sessionId = data.session_id;
    keyword = data.keyword;
    setTopbar(keyword, data.round || 1);

    $("#setup").hidden = true;
    $(".chat-col").classList.remove("setup-mode");
    $("#composer").hidden = false;
    $("#chat").innerHTML = "";
    addMsg("system", `令字「${keyword}」——诗库可背之句约 ${data.ai_pool_size} 联。`);
    addMsg("ai", data.greeting);
    $("#lineInput").focus();
  } catch (e) {
    $("#setupErr").textContent = e.message;
  }
}

// ---------- 出句 ----------
async function sendMove() {
  const input = $("#lineInput");
  const sendBtn = $("#sendBtn");
  const text = input.value.trim();
  if (!text || sendBtn.disabled) return;
  input.value = "";
  addMsg("human", text);

  const thinking = addMsg("ai", "李白捻须沉思中…", "", "thinking");
  input.disabled = true;
  sendBtn.disabled = true;

  let data;
  try {
    const res = await fetch(`/api/games/${sessionId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    data = await res.json();
  } catch (e) {
    thinking.querySelector(".bubble").innerHTML =
      '<span class="name">李白：</span>（一时语塞，连接出了问题，再试一句？）';
    input.disabled = false; sendBtn.disabled = false; input.focus();
    return;
  }
  thinking.remove();
  input.disabled = false; sendBtn.disabled = false; input.focus();

  if (data.round != null) {
    setTopbar(keyword, data.round);
    ambient()?.setRound(data.round);
  }

  if (!data.accepted) {
    addMsg("ai", data.comment || "此句不妥，你输了。");
    ambient()?.onReject();
    if (data.over) endGame(data.winner, data);
    return;
  }

  // 给玩家那句补出处
  const p = data.player;
  if (p && (p.author || p.title)) {
    const last = $("#chat").lastElementChild;
    if (last) {
      const m = document.createElement("div");
      m.className = "meta";
      m.textContent = `—— ${p.author}${p.title ? "《" + p.title + "》" : ""}`;
      last.appendChild(m);
    }
  }

  if (data.ai) {
    addMsg("ai", data.ai.text,
      data.ai.author ? `—— ${data.ai.author}${data.ai.title ? "《" + data.ai.title + "》" : ""}` : "");
  }
  if (data.comment) addMsg("ai", data.comment);
  ambient()?.onAccepted();
  if (data.ai) ambient()?.onAIMove();
  if (data.over) endGame(data.winner, data);
}

// ---------- 认输 ----------
async function resign() {
  if (!sessionId) return;
  const thinking = addMsg("ai", "…", "", "thinking");
  try {
    const res = await fetch(`/api/games/${sessionId}/resign`, { method: "POST" });
    const data = await res.json();
    thinking.remove();
    if (data.comment) addMsg("ai", data.comment);
    endGame("ai", data);
  } catch (e) {
    thinking.remove();
  }
}

// ---------- 终局：段位卡 ----------
const RANKS = [
  // [minMoves, 称号]
  [20, "状元及第"],
  [14, "榜眼"],
  [9, "探花"],
  [5, "进士"],
  [3, "举人"],
  [1, "秀才"],
  [0, "童生"],
];

function rankFor(moves, won) {
  // 赢了李白按所背句数定档；输了最高到进士，0 句为童生
  if (won) {
    for (const [min, title] of RANKS) if (moves >= min) return title;
  }
  if (moves >= 5) return "进士";
  if (moves >= 1) return "秀才";
  return "童生";
}

function endGame(winner, data) {
  $("#sendBtn").disabled = true;
  $("#resignBtn").disabled = true;
  $("#lineInput").disabled = true;

  const stats = data.stats || {};
  const moves = stats.player_moves || 0;
  const rounds = stats.round || data.round || 1;
  const won = winner === "human";
  lastStats = {
    won, moves, rounds, keyword,
    rank: rankFor(moves, won),
    comment: data.comment || "",
  };

  $("#rankTitle").textContent = lastStats.rank;
  $("#rankResult").textContent = won ? "你赢了李白！" : "李白胜出";
  $("#rankKw").textContent = keyword;
  $("#rankRound").textContent = rounds;
  $("#rankMoves").textContent = moves;
  $("#rankQuote").textContent = won
    ? "斗酒诗百篇，君亦敌手。"
    : (lastStats.comment || "诗酒趁年华，改日再战。");
  $("#rankOverlay").hidden = false;
  if (won) ambient()?.onWin(); else ambient()?.onLose();
}

function resetUI() {
  sessionId = null; keyword = ""; lastStats = null;
  ambient()?.reset();
  $("#rankOverlay").hidden = true;
  $("#chat").innerHTML = "";
  $("#setup").hidden = false;
  $(".chat-col").classList.add("setup-mode");
  $("#composer").hidden = true;
  $("#sendBtn").disabled = false;
  $("#resignBtn").disabled = false;
  $("#lineInput").disabled = false;
  drawKeyword();   // 再来一局重新抽字
}

// ---------- 段位卡截图（纯 canvas，零依赖） ----------
function downloadRankCard() {
  const s = lastStats; if (!s) return;
  const W = 750, H = 1000;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");

  // 背景（米黄宣纸）
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#fbf4de"); bg.addColorStop(1, "#efe0b8");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // 纸张纹理点
  ctx.fillStyle = "rgba(120,80,20,0.05)";
  for (let i = 0; i < 400; i++) {
    ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }

  // 金边
  ctx.strokeStyle = "#b08d3e"; ctx.lineWidth = 5;
  ctx.strokeRect(34, 34, W - 68, H - 68);
  ctx.strokeStyle = "#9c3324"; ctx.lineWidth = 2;
  const corner = (x, y, sx, sy) => {
    ctx.beginPath(); ctx.moveTo(x, y + 40 * sy); ctx.lineTo(x, y); ctx.lineTo(x + 40 * sx, y); ctx.stroke();
  };
  corner(60, 60, 1, 1); corner(W - 60, 60, -1, 1);
  corner(60, H - 60, 1, -1); corner(W - 60, H - 60, -1, -1);

  ctx.textAlign = "center";

  // 标题
  ctx.fillStyle = "#9c3324";
  ctx.font = "bold 56px KaiTi, STKaiti, serif";
  ctx.fillText("飞 花 令", W / 2, 165);

  // 段位绶带
  const rw = 320, rh = 78, rx = W / 2 - rw / 2, ry = 220;
  ctx.fillStyle = "#9c3324";
  ctx.fillRect(rx, ry, rw, rh);
  ctx.fillStyle = "#7d281c";
  ctx.fillRect(rx, ry + rh - 8, rw, 8);
  ctx.fillStyle = "#fbf0cf";
  ctx.font = "bold 44px KaiTi, STKaiti, serif";
  ctx.fillText(s.rank, W / 2, ry + 56);

  // 结果
  ctx.fillStyle = "#2a2018";
  ctx.font = "40px KaiTi, STKaiti, serif";
  ctx.fillText(s.won ? "你赢了李白" : "李白胜出", W / 2, 380);

  // 令字
  ctx.fillStyle = "#6a5840";
  ctx.font = "28px KaiTi, STKaiti, serif";
  ctx.fillText("令字", W / 2, 440);
  ctx.fillStyle = "#9c3324";
  ctx.font = "bold 96px KaiTi, STKaiti, serif";
  ctx.fillText(s.keyword, W / 2, 555);

  // 数据
  ctx.fillStyle = "#2a2018";
  ctx.font = "bold 64px KaiTi, STKaiti, serif";
  ctx.fillText(s.rounds, W / 2 - 120, 700);
  ctx.fillText(s.moves, W / 2 + 120, 700);
  ctx.fillStyle = "#6a5840";
  ctx.font = "26px KaiTi, STKaiti, serif";
  ctx.fillText("交锋回合", W / 2 - 120, 745);
  ctx.fillText("所背诗句", W / 2 + 120, 745);
  ctx.strokeStyle = "rgba(120,80,20,0.3)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(W / 2, 660); ctx.lineTo(W / 2, 760); ctx.stroke();

  // 评语
  ctx.fillStyle = "#2a2018";
  ctx.font = "italic 32px KaiTi, STKaiti, serif";
  wrapText(ctx, s.won ? "斗酒诗百篇，君亦敌手。" : "诗酒趁年华，改日再战。",
    W / 2, 840, W - 160, 44);

  // 落款
  ctx.fillStyle = "#8a6d2c";
  ctx.font = "22px KaiTi, STKaiti, serif";
  ctx.fillText("—— 飞花令 · 对诗李青莲", W / 2, 930);

  // 下载
  c.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `飞花令-${s.rank}-令字${s.keyword}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, "image/png");
}

function wrapText(ctx, text, x, y, maxW, lh) {
  let line = "";
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y); line = ch; y += lh;
    } else line = test;
  }
  ctx.fillText(line, x, y);
}

// ---------- 事件绑定 ----------
$("#startBtn").addEventListener("click", () => startGame());
$("#rerollBtn").addEventListener("click", () => drawKeyword());
document.querySelectorAll(".quick").forEach((b) =>
  b.addEventListener("click", () => drawKeyword(b.dataset.kw)));
$("#sendBtn").addEventListener("click", sendMove);
$("#lineInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendMove(); });
$("#resignBtn").addEventListener("click", resign);
$("#shotBtn").addEventListener("click", downloadRankCard);
$("#againBtn").addEventListener("click", resetUI);

// 进页面先抽一个字
drawKeyword();
