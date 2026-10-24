// 杭州武林夜市 — 现代古风（宋韵江南）游戏主界面与暂停设置菜单
import { QUALITY_PRESETS } from '../systems/player/settings.js';

const CONTROLS = [
  ['前后左右漫步', ['W', 'A', 'S', 'D']],
  ['环顾四周街景', ['鼠标移动']],
  ['快步疾行', ['Shift 键']],
  ['跨越石阶', ['空格键']],
  ['俯身慢行', ['C 键']],
  ['第一与第三人称切换', ['V 键']],
  ['乘坐或离开车辆', ['F 键']],
  ['街坊交谈与登楼观景', ['F 键']],
  ['显示或隐藏界面', ['H 键']],
  ['三维工坊与模型生成', ['B 键']],
  ['展开系统书卷菜单', ['Esc 键']],
  ['车辆前行、转向与手刹', ['WASD', '空格']],
];

const QUALITY_LABELS = {
  low: '流畅画质',
  medium: '均衡画质',
  high: '高清画质',
  ultra: '极致画质',
};

const SETTINGS = [
  { key: 'quality', label: '画卷渲染品质', type: 'enum', options: QUALITY_PRESETS, fmt: (v) => QUALITY_LABELS[v] || '高清画质', desc: '调整整体江南夜景渲染品质（青石板水面倒影、苏式宫灯光影与街巷视野距离）。修改后可点击确认重新加载生效。' },
  { key: 'fov', label: '视野开阔度', type: 'range', min: 55, max: 100, step: 5, fmt: (v) => `${v}度`, desc: '漫步夜市时的视野宽广程度，快步疾行时视野将自然舒展。' },
  { key: 'sensitivity', label: '环顾灵敏度', type: 'range', min: 0.3, max: 2.5, step: 0.1, fmt: (v) => v.toFixed(1), desc: '移动鼠标环顾武林夜市街景时的转向轻重。' },
  { key: 'invertY', label: '反转俯仰视角', type: 'bool', desc: '反转鼠标上下移动时的仰望与俯瞰方向。' },
  { key: 'headBob', label: '漫步步履起伏', type: 'bool', desc: '行走于青石板路时的自然步伐律动，若感到眩晕可随时关闭。' },
  { key: 'cameraSway', label: '镜头呼吸韵律', type: 'bool', desc: '第一人称视角下的自然呼吸感与转身平滑惯性。' },
  { key: 'minimapRotate', label: '舆图随向旋转', type: 'bool', desc: '开启后右上角街区舆图随角色朝向旋转；关闭则固定上北下南。' },
  { key: 'hud', label: '显示画面导览界面', type: 'bool', desc: '开启或隐藏屏幕四周的古风导览与体能状态界面。' },
];

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const key = (k) => `<span class="nk-key">${k}</span>`;

export class Menus {
  constructor(root, settings, cb) {
    this.root = root; this.settings = settings; this.cb = cb;
    this.buildTitle();
    this.buildPause();
    this.sel = 0; this.setSel = 0; this.tab = 'main';
    addEventListener('keydown', (e) => this.onKey(e));
  }

  buildTitle() {
    const t = el('div', 'nk-title', `
      <div class="frame">
        <i class="c-orn tl"></i><i class="c-orn tr"></i><i class="c-orn bl"></i><i class="c-orn br"></i>
      </div>
      <div class="topline"></div>
      <div class="corner-tl">
        <div class="seal-stamp" aria-hidden="true"><span>武林</span><span>夜集</span></div>
        <div class="tiny">钱塘风物志 · 宋韵江南夜集<br>西子湖畔 · 武林门古今街巷 · 实景漫游长卷</div>
      </div>
      <div class="corner-tr">
        <span class="season-meta">岁在丙午 · 江南微雨夜 · 灯火万家</span>
      </div>
      <div class="vert">钱塘自古繁华地 · 十万人家烟火起 · 杭州武林夜市</div>

      <div class="poetic-scroll" aria-hidden="true">
        <div class="scroll-line">夜市千灯照碧云 · 高楼红袖客纷纷</div>
        <div class="scroll-line">水光潋滟晴方好 · 山色空蒙雨亦奇</div>
        <div class="scroll-seal">西湖<br>烟雨</div>
      </div>

      <div class="logo">
        <div class="kicker"><span class="k-line"></span><span>宋韵江南 · 钱塘繁华夜集</span></div>
        <div class="nk-logo-wrap">
          <div class="nk-logo">
            <span>杭州</span>
            <span>武林夜市</span>
          </div>
          <div class="title-seal" aria-hidden="true"><span>钱塘</span><span>风物</span></div>
        </div>
        <div class="jpline"><i></i><span class="orn">◇</span><span class="jp">西湖微雨 · 灯火武林</span><span class="orn">◇</span><i style="width:72px"></i></div>
        <div class="tagline">十里银湖灯火满 · 千年运河夜未央</div>
        <div class="scenery-strip">
          <span>一 · 河坊灯巷</span>
          <span aria-hidden="true">/</span>
          <span>二 · 知味茶酒</span>
          <span aria-hidden="true">/</span>
          <span>三 · 拱宸映月</span>
          <span aria-hidden="true">/</span>
          <span>四 · 西湖绸伞</span>
        </div>
      </div>

      <div class="press">
        <button type="button" class="btn btn-enter">${key('入卷')}<span class="blink">步入武林夜市</span></button>
        <button type="button" class="btn btn-studio">${key('工坊')}<span>古风三维工坊</span></button>
        <div class="tiny">点击画卷任意位置或按任意键启程漫步杭城<br>支持鼠标环顾、街坊寻访与雷火三维模型实时生成</div>
      </div>

      <div class="legal">
        <div class="tiny">本作品以现代古风视觉呈现杭州武林夜市与江南水乡街巷风貌。街区中的奎元片儿川、知味观小笼、西湖龙井茶庄、太和酒家与河坊古街灯笼巷皆取意江南传统市井文化。</div>
        <div class="ver">宋韵江南版 · 实时三维渲染<br>杭州武林夜市漫游指南</div>
      </div>
      <div class="flash"></div>`);
    this.root.appendChild(t);
    this.title = t;
    const studioBtn = t.querySelector('.btn-studio');
    if (studioBtn) {
      studioBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const abBtn = document.querySelector('.nk-aibridge-btn');
        if (abBtn) abBtn.click();
      });
    }
    t.addEventListener('click', () => this.cb.start());
  }

  buildPause() {
    const m = el('div', 'nk-menu', `
      <div class="grid"></div><div class="topbar"></div>
      <div class="header"><div class="ico">武<br>林</div><h1>钱塘游记 · 小憩书卷</h1></div>
      <div class="tabs"><span class="on" data-t="main"></span><span data-t="settings"></span><span data-t="controls"></span></div>
      <div class="subtitle">三潭印月微雨落 · 武林夜市灯火明</div>
      <div class="protocol"><div class="tiny">杭州武林夜市漫游向导<br>可在设置中调节视野与画卷品质<br>支持三维模型实时生成与导入</div></div>
      <div class="vert">西子湖畔 · 武林商圈 · 河坊古街 · 拱宸映月</div>
      <div class="left"><h2>书卷目录</h2><div class="items"></div></div>
      <div class="right">
        <div class="panel on" data-p="main"><h2>当前夜游录</h2>
          <div class="stats"><div><div class="k">盘缠银两</div><div class="v st-ed">0</div></div><div><div class="k">已访足迹</div><div class="v c st-gigs">0</div></div><div><div class="k">街坊口碑</div><div class="v st-cred">0</div></div></div>
          <div class="stats"><div><div class="k">当前所在街巷</div><div class="v c st-zone" style="font-size:18px">—</div></div><div><div class="k">当前寻访目标</div><div class="v st-gig" style="font-size:18px">—</div></div><div><div class="k">夜游时长</div><div class="v c st-time" style="font-size:18px">0:00</div></div></div>
          <h2 style="margin-top:28px">武林夜市寻访手札</h2><div class="journal"></div>
          <div class="quote">“微雨落青石，灯笼映茶楼。不妨慢下脚步，去片儿川面馆吃一碗热面，再去河坊巷听一曲江南评弹。”</div>
        </div>
        <div class="panel" data-p="settings"><h2>画卷与漫游设置</h2><div class="sets"></div><div class="desc"></div></div>
        <div class="panel" data-p="controls"><h2>漫步操作指南</h2><div class="nk-ctrls">${CONTROLS.map(([n, ks]) => `<div class="c"><span>${n}</span><span class="k">${ks.map(key).join('')}</span></div>`).join('')}</div></div>
      </div>
      <div class="foot"><div class="logo-s">杭州<br>武林夜市</div><div class="tiny">您的游览偏好设置均自动保存在本地浏览器中，随时为您呈现温润典雅的江南夜游体验。</div></div>
      <div class="legend"><span>${key('返回键')} 继续夜游</span><span>${key('确认键')} 选定条目</span><span>${key('◀')}${key('▶')} 调节数值</span></div>`);
    this.root.appendChild(m);
    this.menu = m;
    this.items = [
      { label: '继续漫步夜市', act: () => this.cb.resume() },
      { label: '画卷与游览设置', panel: 'settings' },
      { label: '漫步操作指南', panel: 'controls' },
      { label: '返回卷首画屏', act: () => this.cb.quitToTitle() },
    ];
    const box = m.querySelector('.items');
    this.itemEls = this.items.map((it, i) => {
      const e = el('div', 'nk-mi', `<span>${it.label}</span><span class="ix">0${i + 1}</span>`);
      e.addEventListener('mouseenter', () => this.select(i));
      e.addEventListener('click', () => this.activate(i));
      box.appendChild(e);
      return e;
    });
    const sets = m.querySelector('.sets');
    this.setEls = SETTINGS.map((s, i) => {
      const e = el('div', 'nk-set', `<div class="lab"><span>${s.label}</span><span class="v"></span></div><div class="ctl"><div class="arrow l">◁</div><div class="pips"></div><div class="arrow r">▷</div></div>${s.key === 'quality' ? '<div class="note"></div>' : ''}`);
      e.querySelector('.l').addEventListener('click', () => { this.setSel = i; this.adjust(-1); });
      e.querySelector('.r').addEventListener('click', () => { this.setSel = i; this.adjust(1); });
      e.addEventListener('mouseenter', () => { this.setSel = i; this.renderSettings(); });
      if (s.key === 'quality') e.querySelector('.note').addEventListener('click', () => this.settings.qualityPending && this.settings.applyQualityReload());
      sets.appendChild(e);
      return e;
    });
    this.select(0);
    this.renderSettings();
  }

  select(i) {
    this.sel = i;
    this.itemEls.forEach((e, j) => e.classList.toggle('sel', j === i));
    const it = this.items[i];
    this.showPanel(it.panel || 'main');
  }

  showPanel(p) {
    this.panel = p;
    this.menu.querySelectorAll('.panel').forEach((e) => e.classList.toggle('on', e.dataset.p === p));
    this.menu.querySelectorAll('.tabs span').forEach((e) => e.classList.toggle('on', e.dataset.t === p));
  }

  activate(i) {
    const it = this.items[i];
    if (it.act) it.act();
    else { this.select(i); this.tab = it.panel; this.renderSettings(); }
  }

  adjust(dir) {
    const s = SETTINGS[this.setSel]; const v = this.settings.get(s.key);
    let nv = v;
    if (s.type === 'bool') nv = !v;
    else if (s.type === 'enum') { const i = s.options.indexOf(v); nv = s.options[Math.max(0, Math.min(s.options.length - 1, i + dir))]; }
    else nv = Math.round(Math.max(s.min, Math.min(s.max, v + dir * s.step)) * 100) / 100;
    if (nv !== v) this.settings.set(s.key, nv);
    this.renderSettings();
  }

  renderSettings() {
    SETTINGS.forEach((s, i) => {
      const e = this.setEls[i]; const v = this.settings.get(s.key);
      e.classList.toggle('sel', this.tab === 'settings' && i === this.setSel);
      e.querySelector('.v').textContent = s.type === 'bool' ? (v ? '开启' : '关闭') : s.fmt(v);
      let n = 8, on = 0;
      if (s.type === 'bool') { n = 2; on = v ? 2 : 1; }
      else if (s.type === 'enum') { n = s.options.length; on = s.options.indexOf(v) + 1; }
      else { n = 10; on = Math.round(((v - s.min) / (s.max - s.min)) * 10); }
      const pips = e.querySelector('.pips');
      if (s.type === 'bool') { pips.innerHTML = `<b class="${v ? '' : 'on'}">关闭</b><b class="${v ? 'on' : ''}">开启</b>`; pips.classList.add('bool'); }
      else pips.innerHTML = Array.from({ length: n }, (_, j) => `<i class="${j < on ? 'on' : ''}"></i>`).join('');
      if (i === this.setSel) this.menu.querySelector('.desc').innerHTML = `<b>${s.label}</b>${s.desc || ''}`;
      if (s.key === 'quality') e.querySelector('.note').textContent = this.settings.qualityPending ? `▶ 点击此处或按回车键重新加载并应用「${QUALITY_LABELS[v] || v}」` : `当前生效画质：${QUALITY_LABELS[this.settings.activeQuality] || '极致画质'}`;
    });
  }

  updateStats(s) {
    const q = (c) => this.menu.querySelector(c);
    q('.st-ed').textContent = `¥ ${Math.round(s.eddies).toLocaleString('zh-CN')}`;
    q('.st-gigs').textContent = String(s.gigs);
    q('.st-cred').textContent = String(s.cred);
    q('.st-zone').textContent = s.zone || '—';
    q('.st-gig').textContent = s.gig || '—';
    if (s.journal) {
      q('.journal').innerHTML = s.journal.map((g) => `<div class="jr ${g.status}"><span class="st">${{ done: '✓', active: '◆', locked: '·' }[g.status]}</span><span class="tt">${g.title}</span><span class="ar">${g.area}</span><span class="rw">${g.status === 'locked' ? '待寻访' : '¥ ' + g.reward.toLocaleString('zh-CN')}</span></div>`).join('');
    }
    const t = Math.floor(s.time); q('.st-time').textContent = `${Math.floor(t / 60)}分${String(t % 60).padStart(2, '0')}秒`;
  }

  onKey(e) {
    if (document.querySelector('.nk-aibridge.open')) return;
    const state = this.cb.state();
    if (state === 'title') {
      if (e.code === 'Escape' || e.code === 'KeyB' || e.repeat) return;
      this.cb.start();
      return;
    }
    if (state !== 'paused') return;
    if (this.tab === 'settings') {
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { this.setSel = (this.setSel + SETTINGS.length - 1) % SETTINGS.length; this.renderSettings(); }
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') { this.setSel = (this.setSel + 1) % SETTINGS.length; this.renderSettings(); }
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.adjust(-1);
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.adjust(1);
      else if (e.code === 'Enter') { if (SETTINGS[this.setSel].key === 'quality' && this.settings.qualityPending) this.settings.applyQualityReload(); else this.adjust(1); }
      else if (e.code === 'Escape' || e.code === 'Backspace') { this.tab = 'main'; this.renderSettings(); e.stopImmediatePropagation(); this.cb.consumeEsc(); }
      return;
    }
    if (this.tab === 'controls') {
      if (e.code === 'Escape' || e.code === 'Backspace' || e.code === 'Enter') { this.tab = 'main'; e.stopImmediatePropagation(); this.cb.consumeEsc(); }
      return;
    }
    if (e.code === 'ArrowUp' || e.code === 'KeyW') this.select((this.sel + this.items.length - 1) % this.items.length);
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') this.select((this.sel + 1) % this.items.length);
    else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'ArrowRight') this.activate(this.sel);
  }

  openPause() { this.tab = 'main'; this.select(0); this.renderSettings(); }
}
