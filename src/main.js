import { Engine } from './engine/Engine.js';
import { SYSTEMS } from './systems/index.js';

const loading = document.getElementById('loading');
const fill = loading.querySelector('.fill');
const label = loading.querySelector('.label');

const SYS_LABELS = {
  atmosphere: '构建西湖夜空与江南烟雨',
  ground: '铺设青石板与武林路网',
  buildings: '营造武林夜市街区与临街商铺',
  landmarks: '架设拱宸桥与运河水道',
  signage: '点亮武林夜市招牌与红灯笼',
  vehicles: '调度杭城街区车流',
  crowd: '生成夜市漫步游人',
  weather: '渲染江南微雨与水面倒影',
  audio: '合成江南夜市环境音景',
  player: '准备步入杭州武林夜市',
};

const engine = new Engine(document.getElementById('app'));
await engine.init(SYSTEMS, (p, name) => {
  fill.style.width = `${(p * 100).toFixed(0)}%`;
  label.textContent = SYS_LABELS[name] || '正在加载江南街区';
});
label.textContent = '正在点亮武林夜市灯火…';
for (let i = 0; i < 2; i++) { engine.postfx.render(); await new Promise((r) => requestAnimationFrame(r)); }
loading.classList.add('done');
engine.start();
