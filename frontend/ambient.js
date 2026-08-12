/* 飞花令 · 动态意象背景
 * 分层：CSS 静态层（宣纸纹理 / 令字水印 / 月轮远山等大形状 / 色温罩染）
 *       + Canvas 层（粒子、墨晕涟漪、脉冲）
 * 驱动：每字一份配置（full / light / base），对局事件通过 API 触发脉冲。
 */
(function () {
  "use strict";

  const reduced =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isMobile = () =>
    !!(window.matchMedia && window.matchMedia("(max-width: 720px)").matches);

  // ---------- 令字配置 ----------
  // tier: full=大形状+专属粒子  light=仅色温+粒子变体  base=浮尘微光
  // tint: 低饱和色温(hex)；shape: CSS 大形状类名；particle/front: 粒子类型
  // count: 桌面端后景粒子基数（移动端减半）；moodScale: 氛围浓时是否提速
  const C = {
    月: { tier: "full", tint: "#8aa0ad", shape: "moon",     particle: "mote",   count: 28 },
    花: { tier: "full", tint: "#c98a8a", shape: "",         particle: "petal",  front: "petal",  count: 38 },
    风: { tier: "full", tint: "#6a5840", shape: "",         particle: "wind",   count: 22, moodScale: 1 },
    山: { tier: "full", tint: "#5a6b5e", shape: "mountain", particle: "mote",   count: 22 },
    雪: { tier: "full", tint: "#aebfcc", shape: "",         particle: "snow",   front: "snow",   count: 46, moodScale: 1 },
    雨: { tier: "full", tint: "#7d8fa3", shape: "",         particle: "rain",   count: 56, moodScale: 1 },
    酒: { tier: "full", tint: "#b8893a", shape: "glow",     particle: "mote",   count: 24 },
    云: { tier: "full", tint: "#9a8f7a", shape: "cloud",    particle: "mist",   count: 18 },
    柳: { tier: "full", tint: "#8a9a6e", shape: "",         particle: "catkin", front: "catkin", count: 32 },

    春: { tier: "light", tint: "#c9a06a", particle: "glow", count: 24 },
    秋: { tier: "light", tint: "#b08d3e", particle: "leaf", front: "leaf", count: 28 },
    江: { tier: "light", tint: "#6f8a99", particle: "wave", count: 28 },
    夜: { tier: "light", tint: "#4a5a6e", particle: "mote", count: 16, dark: 0.22 },
    水: { tier: "light", tint: "#7a9a9a", particle: "wave", count: 28 },
    雁: { tier: "light", tint: "#8a7a6a", particle: "bird", count: 9 },

    // 抽象字：统一浮尘微光，只靠水印上的字表意
    人: {}, 天: {}, 南: {}, 梦: {}, 愁: {},
  };
  const BASE = { tint: "#8a7a5a", particle: "mote", count: 20 };
  const cfg = (kw) => C[kw] || BASE;

  // ---------- 工具 ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const hexToRgb = (hex) => {
    const h = hex.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };

  // ---------- 引擎 ----------
  class Ambient {
    constructor() {
      this.kw = null;
      this.particles = [];
      this.frontParticles = [];
      this.ripples = [];
      this.mood = 0;
      this.targetMood = 0;
      this.freezeUntil = 0;
      this.last = 0;
      this.raf = 0;
      this.bg = this.fg = null;
      this.bgCtx = this.fgCtx = null;
      this.wm = null;
    }

    init() {
      this._buildDOM();
      this._bindResize();
      this._bindVisibility();
      if (reduced) {
        // 无障碍：只画一帧静态，不启动循环
        this.buildParticles();
        this.draw(1 / 60);
        return;
      }
      this.buildParticles();
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this.loop(t));
    }

    _buildDOM() {
      const bg = document.createElement("div");
      bg.className = "ambient-bg";
      bg.innerHTML = `
        <div class="ambient-tint"></div>
        <div class="ambient-dark"></div>
        <div class="shape shape-moon"></div>
        <div class="shape shape-mountain"></div>
        <div class="shape shape-cloud"></div>
        <div class="shape shape-glow"></div>
        <div class="ambient-wm"></div>
        <canvas class="ambient-canvas ambient-back"></canvas>
      `;
      const fg = document.createElement("div");
      fg.className = "ambient-fg";
      fg.innerHTML = `<canvas class="ambient-canvas ambient-front"></canvas>`;
      const shock = document.createElement("div");
      shock.className = "ambient-shock";
      document.body.appendChild(bg);
      document.body.appendChild(fg);
      document.body.appendChild(shock);

      this.bg = bg.querySelector(".ambient-back");
      this.fg = fg.querySelector(".ambient-front");
      this.bgCtx = this.bg.getContext("2d");
      this.fgCtx = this.fg.getContext("2d");
      this.wm = bg.querySelector(".ambient-wm");
      this.shock = shock;
      this._resizeCanvas();
    }

    _bindResize() {
      let t;
      window.addEventListener("resize", () => {
        clearTimeout(t);
        t = setTimeout(() => {
          this._resizeCanvas();
          this.buildParticles();
          if (reduced) this.draw(1 / 60);
        }, 150);
      });
    }

    _bindVisibility() {
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          if (this.raf) cancelAnimationFrame(this.raf);
          this.raf = 0;
        } else if (!reduced && !this.raf) {
          this.last = performance.now();
          this.raf = requestAnimationFrame((t) => this.loop(t));
        }
      });
    }

    _resizeCanvas() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      for (const c of [this.bg, this.fg]) {
        c.width = Math.floor(w * dpr);
        c.height = Math.floor(h * dpr);
        c.style.width = w + "px";
        c.style.height = h + "px";
        const ctx = c.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }

    // ---------- 对外 API ----------
    setKeyword(kw) {
      if (!kw || kw === this.kw) return;
      this.kw = kw;
      const c = cfg(kw);
      const [r, g, b] = hexToRgb(c.tint || BASE.tint);
      document.documentElement.style.setProperty("--ambient-tint-rgb", `${r},${g},${b}`);
      document.documentElement.style.setProperty("--ambient-dark", String(c.dark || 0));
      document.body.setAttribute("data-kw", kw);
      if (this.wm) this.wm.textContent = kw;

      if (reduced) {
        this.buildParticles();
        this.draw(1 / 60);
        return;
      }
      // 淡出 → 重建粒子 → 淡入
      this.bg.style.opacity = "0";
      this.fg.style.opacity = "0";
      clearTimeout(this._fadeTimer);
      this._fadeTimer = setTimeout(() => {
        this.buildParticles();
        this.bg.style.opacity = "1";
        this.fg.style.opacity = "1";
      }, 220);
    }

    onAccepted() {
      if (!this.kw) return;
      this._ripple();
      this.targetMood = Math.min(1, this.targetMood + 0.12);
    }

    onAIMove() {
      if (!this.wm || reduced) return;
      this.wm.classList.remove("pulse");
      // 触发重排以重启动画
      void this.wm.offsetWidth;
      this.wm.classList.add("pulse");
      setTimeout(() => this.wm.classList.remove("pulse"), 650);
    }

    onReject() {
      this.freezeUntil = performance.now() + 600;
      document.body.setAttribute("data-shock", "1");
      setTimeout(() => document.body.removeAttribute("data-shock"), 600);
    }

    onWin() {
      document.body.setAttribute("data-outcome", "win");
      this.targetMood = 1;
      this._ripple();
    }

    onLose() {
      document.body.setAttribute("data-outcome", "lose");
    }

    setRound(r) {
      const base = Math.min(1, Math.max(0, (r - 1) / 8));
      this.targetMood = Math.max(this.targetMood, base);
    }

    reset() {
      document.body.removeAttribute("data-outcome");
      document.body.removeAttribute("data-shock");
      this.targetMood = 0;
      this.ripples = [];
    }

    // ---------- 粒子 ----------
    buildParticles() {
      this.particles = [];
      this.frontParticles = [];
      const c = cfg(this.kw);
      const scale = isMobile() ? 0.5 : 1;
      const n = Math.round((c.count || BASE.count) * scale);
      for (let i = 0; i < n; i++) {
        this.particles.push(this._make(c.particle || BASE.particle, c, true));
      }
      if (c.front) {
        const fn = isMobile() ? 4 : 7;
        for (let i = 0; i < fn; i++) {
          this.frontParticles.push(this._make(c.front, c, true, true));
        }
      }
    }

    _make(type, c, initial, front) {
      const w = window.innerWidth, h = window.innerHeight;
      const tint = hexToRgb(c.tint || BASE.tint);
      const p = { type, front: !!front, alpha: 0.3, size: 2, phase: rand(0, 6.28) };

      const edge = () => this._spawnEdge(p, type, w, h);
      if (initial) {
        p.x = rand(0, w);
        p.y = rand(0, h);
      } else {
        edge();
      }

      switch (type) {
        case "petal":
          p.color = pick(["#d8a0a0", "#c98a8a", "#e0b8a8", "#d4a890"]);
          p.size = rand(4, 8); p.alpha = rand(0.35, 0.65);
          p.vx = rand(-0.25, 0.25); p.vy = rand(0.25, 0.6);
          p.rot = rand(0, 6.28); p.vr = rand(-0.02, 0.02); break;
        case "leaf":
          p.color = pick(["#b08d3e", "#9c6b2e", "#8a5a28", "#a9772e"]);
          p.size = rand(4, 8); p.alpha = rand(0.35, 0.6);
          p.vx = rand(-0.3, 0.3); p.vy = rand(0.4, 0.8);
          p.rot = rand(0, 6.28); p.vr = rand(-0.03, 0.03); break;
        case "snow":
          p.color = "#f4f6f8"; p.size = rand(1.2, 3);
          p.alpha = rand(0.4, 0.8); p.vx = 0; p.vy = rand(0.4, 1.1); break;
        case "rain": {
          p.color = tint; p.size = rand(10, 18);
          p.alpha = rand(0.1, 0.26);
          p.vx = rand(-0.4, -0.1); p.vy = rand(5, 8.5); break;
        }
        case "wind": {
          p.color = tint; p.size = rand(28, 60);
          p.alpha = rand(0.05, 0.13);
          p.vx = rand(3.5, 6); p.vy = rand(1, 2.4); break;
        }
        case "catkin":
          p.color = "#f0ece0"; p.size = rand(2.5, 5);
          p.alpha = rand(0.3, 0.55); p.vx = rand(-0.3, 0.3); p.vy = rand(-0.12, 0.18); break;
        case "mist":
          p.color = tint; p.size = rand(120, 260);
          p.alpha = rand(0.025, 0.06); p.vx = rand(-0.15, 0.15); p.vy = 0; break;
        case "wave":
          p.color = "#dde8ec"; p.size = rand(1, 2.4);
          p.alpha = rand(0.2, 0.5); p.vx = rand(-0.15, 0.15); p.vy = 0;
          p.base = p.alpha; break;
        case "bird": {
          const dir = Math.random() < 0.5 ? 1 : -1;
          p.color = "#3a3020"; p.size = rand(5, 9); p.alpha = 0.35;
          p.vx = rand(1.2, 2.4) * dir; p.vy = rand(-0.15, 0.15);
          p.y = rand(h * 0.12, h * 0.42);
          p.x = initial ? rand(0, w) : (dir > 0 ? -20 : w + 20);
          break;
        }
        case "glow":
          p.color = "#e8c887"; p.size = rand(1.6, 3.2);
          p.alpha = rand(0.2, 0.45); p.vx = rand(-0.1, 0.1); p.vy = rand(-0.3, -0.1);
          p.base = p.alpha; break;
        case "mote":
        default:
          p.color = tint; p.size = rand(1, 2.6);
          p.alpha = rand(0.1, 0.34); p.vx = rand(-0.12, 0.12); p.vy = rand(-0.2, -0.04);
          p.base = p.alpha; break;
      }
      return p;
    }

    _spawnEdge(p, type, w, h) {
      switch (type) {
        case "rain":
        case "petal":
        case "leaf":
        case "snow":
          p.x = rand(-20, w + 20); p.y = -20; break;
        case "wind":
          p.x = -80; p.y = rand(0, h * 0.8); break;
        case "mote":
        case "glow":
          p.x = rand(0, w); p.y = h + 10; break;
        case "mist":
        case "wave":
        case "catkin":
          p.x = rand(0, w); p.y = rand(0, h); break;
        case "bird":
          p.x = p.vx > 0 ? -20 : w + 20; p.y = rand(h * 0.12, h * 0.42); break;
        default:
          p.x = rand(0, w); p.y = rand(0, h);
      }
    }

    // ---------- 墨晕涟漪 ----------
    _ripple() {
      const w = window.innerWidth, h = window.innerHeight;
      const n = isMobile() ? 1 : 2;
      for (let i = 0; i < n; i++) {
        this.ripples.push({
          x: rand(w * 0.2, w * 0.8),
          y: rand(h * 0.25, h * 0.7),
          r: 0,
          alpha: 0.2,
        });
      }
    }

    // ---------- 主循环 ----------
    loop(t) {
      this.raf = requestAnimationFrame((ts) => this.loop(ts));
      let dt = (t - this.last) / 1000;
      this.last = t;
      if (dt > 0.05) dt = 0.05; // 切后台回来后防跳变
      // 移动端降帧到 ~30fps
      if (isMobile() && dt < 0.03) return;
      this.update(dt, t);
      this.draw(dt);
    }

    update(dt, t) {
      const frozen = t < this.freezeUntil;
      // mood 缓动：上升快、回落慢
      this.mood += (this.targetMood - this.mood) * (this.targetMood > this.mood ? 0.04 : 0.012);
      document.documentElement.style.setProperty("--ambient-mood", this.mood.toFixed(3));

      if (!frozen) {
        const c = cfg(this.kw);
        const moodBoost = c.moodScale ? 1 + this.mood * 0.9 : 1;
        for (const p of this.particles) this._updateParticle(p, dt, moodBoost);
        for (const p of this.frontParticles) this._updateParticle(p, dt, moodBoost);
      }

      for (let i = this.ripples.length - 1; i >= 0; i--) {
        const r = this.ripples[i];
        r.r += dt * 180;
        r.alpha -= dt * 0.55;
        if (r.alpha <= 0) this.ripples.splice(i, 1);
      }
    }

    _updateParticle(p, dt, moodBoost) {
      const w = window.innerWidth, h = window.innerHeight;
      p.phase += dt * 1.6;

      switch (p.type) {
        case "petal":
        case "leaf":
          p.vx += Math.sin(p.phase) * 0.012;
          p.x += p.vx * 60 * dt;
          p.y += p.vy * 60 * dt * moodBoost;
          p.rot += p.vr;
          if (p.y > h + 20 || p.x < -40 || p.x > w + 40)
            this._spawnEdge(p, p.type, w, h);
          break;
        case "snow":
          p.x += Math.sin(p.phase) * 0.3 + p.vx;
          p.y += p.vy * 60 * dt * moodBoost;
          if (p.y > h + 10) { p.y = -10; p.x = rand(0, w); }
          break;
        case "rain":
          p.x += p.vx * 60 * dt;
          p.y += p.vy * 60 * dt * moodBoost;
          if (p.y > h + 20) { p.y = -20; p.x = rand(0, w); }
          break;
        case "wind":
          p.x += p.vx * 60 * dt * moodBoost;
          p.y += p.vy * 60 * dt;
          if (p.x > w + 80) { p.x = -80; p.y = rand(0, h * 0.8); }
          break;
        case "catkin":
          p.x += (p.vx + Math.sin(p.phase) * 0.2) * 60 * dt;
          p.y += (p.vy + Math.cos(p.phase * 0.7) * 0.15) * 60 * dt;
          if (p.x < -20) p.x = w + 20;
          if (p.x > w + 20) p.x = -20;
          if (p.y < -20) p.y = h + 20;
          if (p.y > h + 20) p.y = -20;
          break;
        case "mist":
          p.x += p.vx * 60 * dt;
          if (p.x < -p.size) p.x = w + p.size;
          if (p.x > w + p.size) p.x = -p.size;
          break;
        case "wave":
          p.x += p.vx * 60 * dt;
          p.alpha = p.base * (0.45 + 0.55 * Math.sin(p.phase));
          if (p.x < -10) p.x = w + 10;
          if (p.x > w + 10) p.x = -10;
          break;
        case "bird":
          p.x += p.vx * 60 * dt;
          p.y += p.vy * 60 * dt + Math.sin(p.phase) * 0.15;
          if ((p.vx > 0 && p.x > w + 30) || (p.vx < 0 && p.x < -30))
            this._spawnEdge(p, "bird", w, h);
          break;
        case "mote":
        case "glow":
        default:
          p.x += p.vx * 60 * dt;
          p.y += p.vy * 60 * dt;
          if (p.base != null) p.alpha = p.base * (0.5 + 0.5 * Math.sin(p.phase));
          if (p.y < -10) { p.y = h + 10; p.x = rand(0, w); }
          if (p.x < -10) p.x = w + 10;
          if (p.x > w + 10) p.x = -10;
      }
    }

    // ---------- 绘制 ----------
    draw() {
      const w = window.innerWidth, h = window.innerHeight;
      this.bgCtx.clearRect(0, 0, w, h);
      this.fgCtx.clearRect(0, 0, w, h);

      for (const p of this.particles) this._drawParticle(this.bgCtx, p);
      for (const r of this.ripples) this._drawRipple(this.bgCtx, r);
      for (const p of this.frontParticles) this._drawParticle(this.fgCtx, p);
    }

    _drawParticle(ctx, p) {
      const col = p.color;
      switch (p.type) {
        case "petal":
        case "leaf": {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = rgba(col, p.alpha);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, 6.283);
          ctx.fill();
          ctx.restore();
          break;
        }
        case "snow":
        case "catkin":
        case "mote":
        case "glow": {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2.5);
          g.addColorStop(0, rgba(col, p.alpha));
          g.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 2.5, 0, 6.283);
          ctx.fill();
          break;
        }
        case "mist": {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          g.addColorStop(0, rgba(col, p.alpha));
          g.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, 6.283);
          ctx.fill();
          break;
        }
        case "wave": {
          ctx.fillStyle = rgba(col, p.alpha);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, 6.283);
          ctx.fill();
          break;
        }
        case "rain": {
          ctx.strokeStyle = rgba(col, p.alpha);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - 2, p.y + p.size);
          ctx.stroke();
          break;
        }
        case "wind": {
          ctx.strokeStyle = rgba(col, p.alpha);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.size, p.y - p.size * 0.4);
          ctx.stroke();
          break;
        }
        case "bird": {
          ctx.strokeStyle = rgba(col, p.alpha);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(p.x - p.size, p.y);
          ctx.quadraticCurveTo(p.x - p.size * 0.4, p.y - p.size * 0.5, p.x, p.y);
          ctx.quadraticCurveTo(p.x + p.size * 0.4, p.y - p.size * 0.5, p.x + p.size, p.y);
          ctx.stroke();
          break;
        }
      }
    }

    _drawRipple(ctx, r) {
      const g = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, r.r);
      g.addColorStop(0, `rgba(42,32,24,${r.alpha * 0.5})`);
      g.addColorStop(0.6, `rgba(42,32,24,${r.alpha * 0.18})`);
      g.addColorStop(1, "rgba(42,32,24,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, 6.283);
      ctx.fill();
    }
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function rgba(col, a) {
    if (typeof col === "string" && col[0] === "#") {
      const [r, g, b] = hexToRgb(col);
      return `rgba(${r},${g},${b},${a})`;
    }
    return `rgba(${col[0]},${col[1]},${col[2]},${a})`;
  }

  window.ambient = new Ambient();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => window.ambient.init());
  } else {
    window.ambient.init();
  }
})();
