// 杭州武林夜市 — 街区导航与状态界面（包含左下角视角、乘坐、界面、工坊等完整快捷键提示）
import './hud.css';
import { Minimap } from './minimap.js';
import { AIBridgePanel } from './aiBridgePanel.js';

const ICON = {
  rain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 15a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 7.5a3.75 3.75 0 0 1 .5 7.5H7z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M12 9v-1.5M15 12h1.5"/></svg>',
  car: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 15v-3l2.2-4.4A2 2 0 0 1 7 6.5h10a2 2 0 0 1 1.8 1.1L21 12v3a1 1 0 0 1-1 1h-1.5M5.5 16H4a1 1 0 0 1-1-1M8.5 16h7"/><circle cx="7" cy="16" r="1.8"/><circle cx="17" cy="16" r="1.8"/><path d="M5 12h14"/></svg>',
  hud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3"/><path d="M8 12h8M12 8v8"/></svg>',
  cube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2l9 5v10l-9 5-9-5V7l9-5z"/><path d="M12 22V12M21 7l-9 5-9-5"/></svg>',
  stand: '<svg viewBox="0 0 22 30" fill="currentColor"><circle cx="11" cy="4" r="3"/><path d="M7 9h8l1 9h-2l-1 11h-2.2l-.8-8-.8 8H7l-1-11H4z"/></svg>',
  run: '<svg viewBox="0 0 22 30" fill="currentColor"><circle cx="13" cy="4" r="3"/><path d="M9 9l6 1 2 6-2 .6-1.4-3.6-1.6 5 4 4-1 6.5-2.2-.4.8-5.2-4-3.6L6 26l-2-1 3.3-8.3L8 12l-3 3-1.4-1.5z"/></svg>',
  crouch: '<svg viewBox="0 0 22 30" fill="currentColor"><circle cx="12" cy="10" r="3"/><path d="M7 14h9l1 6-2 .5-1 2.5 3 6h-2.4l-3-5-2 5H7l1.6-6.5L6 20z"/></svg>',
};

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const fmt = (n) => Math.round(n).toLocaleString('zh-CN');
const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${Math.round(m)} 米`);

export class HUD {
  constructor(ctx, settings) {
    this.ctx = ctx; this.settings = settings;
    const host = document.getElementById('hud') || document.body;
    const root = el('div'); root.id = 'nk';
    this.root = root;
    host.appendChild(root);
    const hud = el('div', 'hud'); root.appendChild(hud);
    this.hudEl = hud;

    // --- status (Hangzhou Wulin Night Market visitor status)
    hud.appendChild(el('div', 'nk-status hud-fade', `
      <div class="head"><span class="tiny">夜游体能状态</span><span class="tiny">杭州武林夜市 · 江南漫游</span></div>
      <div class="row">
        <div class="nk-level">杭</div>
        <div class="nk-hp">
          <div class="bar"><div class="ghost"></div><div class="fill"></div></div>
          <div class="sub"><span class="tiny">气血 · 充沛</span><span class="tiny">步履轻盈</span></div>
        </div>
        <div class="nk-hpnum">100<small>/100</small></div>
      </div>
      <div class="nk-ram"><span class="lbl">精力</span>${'<i></i>'.repeat(8)}<span class="val">8/8</span></div>
      <div class="nk-buffs"><span>武林夜市：灯火通明</span><span class="c">西湖微雨夜</span></div>`));
    this.hpFill = hud.querySelector('.nk-hp .fill');
    this.hpGhost = hud.querySelector('.nk-hp .ghost');
    this.hpNum = hud.querySelector('.nk-hpnum');
    this.ramCells = [...hud.querySelectorAll('.nk-ram i')];
    this.ramVal = hud.querySelector('.nk-ram .val');

    // --- compass
    const comp = el('div', 'nk-compass');
    const strip = el('div', 'strip');
    this.pxPerDeg = 4;
    const labels = { 0: '北', 45: '东北', 90: '东', 135: '东南', 180: '南', 225: '西南', 270: '西', 315: '西北' };
    let sh = '';
    for (let d = -360; d <= 720; d += 5) {
      const x = (d + 360) * this.pxPerDeg;
      const dd = ((d % 360) + 360) % 360;
      if (labels[dd] !== undefined) sh += `<span class="lab ${dd % 90 === 0 ? 'card' : ''} ${dd === 0 ? 'n' : ''}" style="left:${x}px">${labels[dd]}</span>`;
      else if (dd % 15 === 0) sh += `<span class="lab" style="left:${x}px;font-size:11px;top:0;opacity:.6">${dd}</span>`;
      else sh += `<i class="tick ${dd % 15 === 0 ? 'm' : ''}" style="left:${x}px"></i>`;
    }
    strip.innerHTML = sh;
    comp.append(strip, el('div', 'base'), el('div', 'caret'));
    this.compGig = el('div', 'gig', '<div class="d"></div><div class="m"></div>');
    comp.appendChild(this.compGig);
    hud.appendChild(comp);
    this.compStrip = strip;
    this.heading = el('div', 'nk-heading', '000°');
    hud.appendChild(this.heading);

    // --- minimap
    const mw = el('div', 'nk-mapwrap');
    mw.innerHTML = `
      <div class="nk-maphead"><div class="nk-time">23:47<small>夜间</small></div><div class="nk-weather">${ICON.rain}<span>江南微雨 · 18°C</span></div></div>
      <div class="nk-map"><canvas></canvas><div class="scan"></div><div class="n">北</div><div class="corner">杭州·武林</div></div>
      <div class="nk-mapfoot"><span class="loc"><b>杭州武林夜市</b> · 延安路主街</span><span class="tiny">海拔 0米</span></div>
      <div class="nk-eddies"><div class="v"><small>¥</small><span>1,200</span></div><div class="delta">+0</div></div>`;
    hud.appendChild(mw);
    this.timeEl = mw.querySelector('.nk-time');
    this.weatherEl = mw.querySelector('.nk-weather span');
    this.mapNorth = mw.querySelector('.n');
    this.mapLoc = mw.querySelector('.loc');
    this.mapLevel = mw.querySelector('.nk-mapfoot .tiny');
    this.eddiesEl = mw.querySelector('.nk-eddies .v span');
    this.eddiesDelta = mw.querySelector('.nk-eddies .delta');
    this.minimap = new Minimap(ctx.layout, mw.querySelector('canvas'), ctx.api.buildings?.lots);
    this.eddiesShown = 1200; this.eddiesTarget = 1200;

    // --- objective
    this.obj = el('div', 'nk-obj', `<div class="tag">武林夜市 · 街坊寻访</div><div class="title"></div><div class="line"><span class="ic"></span><span class="txt"></span></div><div class="dist"></div>`);
    hud.appendChild(this.obj);
    this.objTag = this.obj.querySelector('.tag'); this.objTitle = this.obj.querySelector('.title');
    this.objTxt = this.obj.querySelector('.txt'); this.objDist = this.obj.querySelector('.dist');

    // --- crosshair, prompt, waypoint
    this.cross = el('div', 'nk-cross', '<i class="dot"></i><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i>');
    hud.appendChild(this.cross);
    this.promptEl = el('div', 'nk-prompt', '<div class="sub">街坊互动</div><div class="opt"><span class="nk-key">F 键</span><span class="txt"></span></div>');
    hud.appendChild(this.promptEl);
    this.promptTxt = this.promptEl.querySelector('.txt'); this.promptKey = this.promptEl.querySelector('.nk-key'); this.promptSub = this.promptEl.querySelector('.sub');
    this.wp = el('div', 'nk-wp', '<div class="d"></div><div class="m"></div>');
    hud.appendChild(this.wp);
    this.wpDist = this.wp.querySelector('.m');

    // --- district pop-up + toasts
    this.district = el('div', 'nk-district', `<div class="pre">正在步入</div><div class="name" data-t=""></div><div class="rule"><span class="area"></span></div><span class="jp"></span>`);
    hud.appendChild(this.district);
    this.toasts = el('div', 'nk-toasts'); hud.appendChild(this.toasts);

    // --- bottom-left slots with explicit keyboard shortcut badges & interactive bar
    const bl = el('div', 'nk-bl hud-fade', `
      <div class="nk-slots">
        <div class="nk-slotw" data-s="v" title="按 V 键切换第一/第三人称视角" style="pointer-events:auto;cursor:pointer">
          <div class="nk-slot"><span class="slot-badge">V</span>${ICON.eye}</div>
          <span class="nk-key">V 键</span>
          <span class="lb">视角切换</span>
        </div>
        <div class="nk-slotw" data-s="f" title="靠近车辆按 F 键乘坐或下车" style="pointer-events:auto;cursor:pointer">
          <div class="nk-slot"><span class="slot-badge">F</span>${ICON.car}</div>
          <span class="nk-key">F 键</span>
          <span class="lb">乘坐车辆</span>
        </div>
        <div class="nk-slotw" data-s="h" title="按 H 键显示或隐藏界面" style="pointer-events:auto;cursor:pointer">
          <div class="nk-slot"><span class="slot-badge">H</span>${ICON.hud}</div>
          <span class="nk-key">H 键</span>
          <span class="lb">界面显隐</span>
        </div>
        <div class="nk-slotw" data-s="b" title="按 B 键打开三维工坊" style="pointer-events:auto;cursor:pointer">
          <div class="nk-slot"><span class="slot-badge">B</span>${ICON.cube}</div>
          <span class="nk-key">B 键</span>
          <span class="lb">三维工坊</span>
        </div>
      </div>
      <div class="nk-keybar">
        <span class="kb-item"><kbd>WASD</kbd>漫步</span>
        <span class="kb-item"><kbd>Shift</kbd>疾行</span>
        <span class="kb-item"><kbd>空格</kbd>跨越</span>
        <span class="kb-item"><kbd>C</kbd>俯身</span>
        <span class="kb-item"><kbd>V</kbd>视角</span>
        <span class="kb-item"><kbd>F</kbd>乘坐/互动</span>
        <span class="kb-item"><kbd>Esc</kbd>菜单</span>
      </div>
      <div class="tiny">杭州武林夜市 · 西湖江南街区 · <span class="fps"></span></div>`);
    hud.appendChild(bl);
    this.slotV = bl.querySelector('[data-s="v"]');
    this.slotF = bl.querySelector('[data-s="f"]');
    this.slotH = bl.querySelector('[data-s="h"]');
    this.slotB = bl.querySelector('[data-s="b"]');
    this.slotVLbl = this.slotV.querySelector('.lb');
    this.slotFLbl = this.slotF.querySelector('.lb');
    this.fpsEl = bl.querySelector('.fps');

    // --- bottom-right stance + speedometer
    const br = el('div', 'nk-br hud-fade', `<div class="nk-stance"><span class="lbl">闲庭漫步</span>${ICON.stand}</div>`);
    hud.appendChild(br);
    this.stance = br.querySelector('.nk-stance'); this.stanceLbl = br.querySelector('.lbl'); this.stanceKind = 'stand';
    this.speedo = el('div', 'nk-speedo', `<svg viewBox="0 0 300 170"></svg><div class="car">江南代步车</div><div class="gear">行<small>档位</small></div><div class="hint"><span class="nk-key">F 键</span> 下车 <span class="nk-key">R 键</span> 回正 <span class="nk-key">空格</span> 驻车</div><div class="num">0</div><div class="unit">公里/时</div>`);
    hud.appendChild(this.speedo);
    this.buildSpeedo();
    this.speedNum = this.speedo.querySelector('.num'); this.speedGear = this.speedo.querySelector('.gear'); this.speedCar = this.speedo.querySelector('.car');

    this.glitch = el('div', 'nk-glitchbar'); hud.appendChild(this.glitch);

    // --- Local Blender MCP + Leihuo Tripo 3D Studio Panel
    this.aiBridge = new AIBridgePanel(ctx, this);
    this.slotB.addEventListener('click', (e) => { e.stopPropagation(); this.aiBridge.toggle(); });
    this.slotV.addEventListener('click', (e) => {
      e.stopPropagation();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v' }));
      setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyV', key: 'v' })), 40);
    });
    this.slotF.addEventListener('click', (e) => {
      e.stopPropagation();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f' }));
      setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', key: 'f' })), 40);
    });
    this.slotH.addEventListener('click', (e) => {
      e.stopPropagation();
      this.settings.set('hud', !this.settings.get('hud'));
    });

    this._last = {};
    this.clock = 21 * 60 + 30;
    this.fpsAcc = 0; this.fpsN = 0;
    this.applySettings();
    settings.addEventListener('change', () => this.applySettings());
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const z = Math.max(0.55, Math.min(2.2, innerHeight / 1080));
    this.root.style.zoom = z;
    this.zoom = z;
  }

  applySettings() { this.root.classList.toggle('hud-hidden', !this.settings.get('hud')); }

  set(key, elx, val, prop = 'textContent') { if (this._last[key] !== val) { this._last[key] = val; elx[prop] = val; } }

  buildSpeedo() {
    const svg = this.speedo.querySelector('svg');
    const N = 34; const cx = 230, cy = 150, r = 130;
    let s = '';
    for (let i = 0; i < N; i++) {
      const a = Math.PI * (1.02 + 0.5 * (i / (N - 1)));
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      const deg = (a * 180) / Math.PI + 90;
      const h = i % 5 === 0 ? 18 : 12;
      s += `<rect class="seg" data-i="${i}" x="${x - 3}" y="${y - h / 2}" width="6" height="${h}" transform="rotate(${deg} ${x} ${y})" fill="rgba(223,190,127,.22)"/>`;
    }
    s += `<path d="M ${cx - r - 16} ${cy + 4} A ${r + 16} ${r + 16} 0 0 1 ${cx} ${cy - r - 16}" stroke="rgba(223,190,127,.38)" fill="none" stroke-width="1"/>`;
    s += `<path d="M 40 160 L 290 160" stroke="rgba(223,190,127,.45)" stroke-width="1"/><path d="M 280 160 L 290 150" stroke="rgba(200,75,49,.85)" stroke-width="2"/>`;
    svg.innerHTML = s;
    this.segs = [...svg.querySelectorAll('.seg')];
  }

  // ---------------- per-frame ----------------
  update(dt, st) {
    // fps
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.set('fps', this.fpsEl, `${Math.round(this.fpsN / this.fpsAcc)} 帧`); this.fpsAcc = 0; this.fpsN = 0; }
    // clock
    this.clock += dt / 4;
    const mins = Math.floor(this.clock) % (24 * 60);
    const h = Math.floor(mins / 60), m = mins % 60;
    const h12 = ((h + 11) % 12) + 1;
    const period = h >= 22 || h < 5 ? '子夜' : h < 8 ? '清晨' : h < 12 ? '上午' : h < 14 ? '正午' : h < 18 ? '午后' : '夜晚';
    this.set('time', this.timeEl, `${h12}:${String(m).padStart(2, '0')}<small>${period}</small>`, 'innerHTML');
    const rain = st.rain ?? 0.25;
    this.set('wx', this.weatherEl, `${rain > 0.65 ? '江南夜雨' : rain > 0.2 ? '西湖微雨' : rain > 0.05 ? '细雨蒙蒙' : '月朗风清'} · ${Math.round(19 - rain * 2)}°C`);

    // health / ram
    const hp = st.hp ?? 100;
    this.set('hp', this.hpNum, `${Math.round(hp)}<small>/100</small>`, 'innerHTML');
    this.hpFill.style.transform = `scaleX(${hp / 100})`; this.hpGhost.style.transform = `scaleX(${hp / 100})`;
    const ram = Math.round(st.ram ?? 8);
    if (this._last.ram !== ram) { this._last.ram = ram; this.ramCells.forEach((c, i) => c.classList.toggle('off', i >= ram)); this.ramVal.textContent = `${ram}/8`; }

    // compass
    const heading = ((((-st.yaw * 180) / Math.PI) % 360) + 360) % 360;
    this.compStrip.style.transform = `translateX(${280 - (heading + 360) * this.pxPerDeg}px)`;
    const card = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][Math.round(heading / 45) % 8];
    this.set('hd', this.heading, `${String(Math.round(heading) % 360).padStart(3, '0')}° ${card}`);
    if (st.target) {
      const dx = st.target.x - st.pos.x, dz = st.target.z - st.pos.z;
      const bt = (Math.atan2(dx, -dz) * 180) / Math.PI;
      let rel = (((bt - heading) % 360) + 540) % 360 - 180;
      const vis = Math.abs(rel) < 68;
      rel = Math.max(-68, Math.min(68, rel));
      this.compGig.style.left = `${280 + rel * this.pxPerDeg}px`;
      this.compGig.style.opacity = vis ? 1 : 0.55;
      this.set('cgd', this.compGig.lastChild, fmtDist(st.targetDist));
    }
    this.compGig.style.display = st.target ? '' : 'none';

    // minimap
    const r = this.minimap.draw(dt, st.pos, st.yaw, st.target, { car: st.mode === 'car', rotate: this.settings.get('minimapRotate'), dpr: (devicePixelRatio || 1) * this.zoom, pois: st.pois });
    if (r) {
      const W = 288, H = 238; const cx = W / 2, cy = H * 0.56;
      const s = Math.sin(r.rot), c = Math.cos(r.rot);
      const ix = s, iy = -c; const m = 14;
      const tx = ix > 0 ? (W - m - cx) / ix : ix < 0 ? (m - cx) / ix : Infinity;
      const ty = iy > 0 ? (H - m - cy) / iy : iy < 0 ? (m - cy) / iy : Infinity;
      const t = Math.min(tx, ty);
      this.mapNorth.style.left = `${cx + ix * t + 1}px`; this.mapNorth.style.top = `${cy + iy * t + 1}px`;
    }
    if (st.zone) this.set('loc', this.mapLoc, `<b>${st.zone.district}</b> · ${st.zone.area}`, 'innerHTML');
    this.set('lvl', this.mapLevel, `海拔 ${Math.round(st.pos.y)}米`);

    // eddies tween
    if (Math.abs(this.eddiesShown - this.eddiesTarget) > 0.5) {
      this.eddiesShown += (this.eddiesTarget - this.eddiesShown) * Math.min(1, dt * 3);
      if (Math.abs(this.eddiesShown - this.eddiesTarget) < 1) this.eddiesShown = this.eddiesTarget;
      this.eddiesEl.textContent = fmt(this.eddiesShown);
    }

    // objective distance
    if (st.target) this.set('od', this.objDist, `${fmtDist(st.targetDist)} · ${st.gig?.area || ''}`);

    // crosshair
    this.cross.classList.toggle('hidden', st.mode === 'car' || st.view === 'tp' && st.speed > 0.5);
    this.cross.classList.toggle('wide', st.sprinting);

    // waypoint on screen
    if (st.wp) {
      this.wp.style.opacity = st.wp.visible ? 1 : 0;
      this.wp.style.transform = `translate(${st.wp.x / this.zoom}px, ${st.wp.y / this.zoom}px) translate(-50%,-50%)`;
      this.wp.classList.toggle('edge', st.wp.edge);
      this.set('wpd', this.wpDist, fmtDist(st.targetDist));
    } else this.wp.style.opacity = 0;

    // prompt
    const p = st.prompt;
    const pk = p ? `${p.key}|${p.text}|${p.sub || ''}` : '';
    if (this._last.prompt !== pk) {
      this._last.prompt = pk;
      if (p) { this.promptKey.textContent = p.key === 'F' ? 'F 键' : (p.key || 'F 键'); this.promptTxt.textContent = p.text; this.promptSub.textContent = p.sub || '街坊互动'; }
      this.promptEl.classList.toggle('show', !!p);
    }

    // slots & dynamic labels
    this.slotV.classList.toggle('active', st.view === 'tp');
    this.slotF.classList.toggle('active', st.mode === 'car' || !!p);
    this.set('slotVLbl', this.slotVLbl, st.view === 'tp' ? '第三人称' : '第一人称');
    this.set('slotFLbl', this.slotFLbl, st.mode === 'car' ? '下车离开' : (p ? p.text : '乘坐车辆'));

    // stance
    const kind = st.mode === 'car' ? 'car' : st.crouch ? 'crouch' : st.sprinting ? 'run' : 'stand';
    if (kind !== this.stanceKind) {
      this.stanceKind = kind;
      this.stance.style.display = kind === 'car' ? 'none' : '';
      this.stance.classList.toggle('crouch', kind === 'crouch');
      this.stance.innerHTML = `<span class="lbl">${{ crouch: '俯身慢行', run: '快步疾行', stand: '闲庭漫步' }[kind] || ''}</span>${ICON[kind] || ''}`;
    }

    // speedometer
    this.speedo.classList.toggle('show', st.mode === 'car');
    if (st.mode === 'car') {
      const kmh = Math.round(st.carSpeed * 3.6);
      this.set('spd', this.speedNum, String(kmh));
      const lit = Math.round(Math.min(1, kmh / 240) * this.segs.length);
      if (this._last.lit !== lit) {
        this._last.lit = lit;
        this.segs.forEach((sg, i) => sg.setAttribute('fill', i < lit ? (i > this.segs.length * 0.8 ? '#c84b31' : '#dfbe7f') : 'rgba(223,190,127,.22)'));
      }
      const gear = st.carReverse ? '倒' : kmh < 2 ? '停' : `${Math.min(6, 1 + Math.floor(kmh / 38))}档`;
      this.set('gear', this.speedGear, `${gear}<small>档位</small>`, 'innerHTML');
      this.set('carname', this.speedCar, st.carName || '江南代步车');
    }
  }

  // ---------------- events ----------------
  newGig(g, first = false) {
    this.obj.classList.add('out');
    setTimeout(() => {
      this.objTag.textContent = `武林夜市 · 掌柜引路：${g.fixer}`;
      this.objTitle.textContent = g.title;
      this.objTxt.textContent = g.text;
      this.obj.classList.remove('out');
      this.obj.classList.remove('flash'); void this.obj.offsetWidth; this.obj.classList.add('flash');
    }, first ? 0 : 450);
    if (!first) this.toast({ kind: 'info', k: `街坊传信 · ${g.fixer}`, h: '收到新的夜游寻访', body: `<span>${g.title}</span>` }, 4200);
    this.sweep();
  }

  gigComplete(g, eddies) {
    this.eddiesTarget = eddies;
    this.eddiesDelta.textContent = `+¥${fmt(g.reward)}`;
    this.eddiesDelta.classList.add('show');
    setTimeout(() => this.eddiesDelta.classList.remove('show'), 3000);
    this.objTitle.textContent = '寻访已达成'; this.objTxt.textContent = '稍歇片刻，即将开启下一处杭州夜市寻访';
    this.set('od', this.objDist, '酬礼已收悉 · 漫步游览中');
    this.toast({ k: `${g.fixer} · 酬礼奉上`, h: '夜市寻访完成', body: `<span><b>+¥${fmt(g.reward)}</b> 盘缠</span><span><b class="c">+${g.cred}</b> 街坊口碑</span>` }, 5200);
    this.sweep();
  }

  toast({ kind = '', k, h, body }, ms = 4500) {
    const t = el('div', `nk-toast ${kind}`, `<div class="k">${k}</div><div class="h">${h}</div><div class="rw">${body}</div>`);
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 600); }, ms);
  }

  showDistrict(z) {
    const d = this.district;
    d.className = `nk-district tint-${z.tint || 'yellow'}`;
    const name = d.querySelector('.name');
    name.textContent = z.district; name.dataset.t = z.district;
    d.querySelector('.area').textContent = z.area;
    d.querySelector('.jp').textContent = z.jp || '';
    void d.offsetWidth; d.classList.add('show');
  }

  sweep() { this.glitch.classList.remove('go'); void this.glitch.offsetWidth; this.glitch.classList.add('go'); }
}
