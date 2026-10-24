# 杭州武林夜市 · 霓虹钱塘

一个基于 **Three.js WebGPU + TSL + Rapier3D** 的浏览器端 3D 江南赛博街区漫游项目。

将杭州的延安路、河坊街、柳浪闻莺、拱宸桥、武林夜市与天际观景台，重构为一座雨夜霓虹下的可步行、可驾车、可生成模型的开放街区。

---

## 功能特性

1. **程序化城市**：全部建筑、路网、招牌、人群、车辆与天气均由代码实时生成，无预制场景文件。
2. **江南招牌系统**：运行时用 Canvas 2D 绘制 4096×4096 霓虹/彩绘双图集，生成片儿川、西湖龙井、知味小笼、河坊灯笼等杭州特色灯牌与牌匾。
3. **雨夜渲染**：MRT 后处理链（SSR 湿地反射 + 雾气散射 + TRAA + Bloom + AgX 调色），配合 GPU Compute 雨滴、屋檐滴水与地面水花。
4. **混合人群渲染**：近景骨骼蒙皮 NPC + 远景 VAT 顶点动画实例化，兼顾生动度与同屏人数。
5. **程序化音频**：不依赖任何音频文件，Web Worker 内用 DSP 合成雨声、脚步、霓虹嗡鸣、车流与江南丝竹环境音，并按 HRTF 做 3D 空间定位。
6. **可驾驶车辆**：路边停靠车、AI 车流、空中无人机；靠近按 `F` 上车，Rapier 射线悬挂物理 + 追尾相机。
7. **AI 三维工坊**：内置雷火 Tripo 3D 文生/图生模型面板，以及本地 Blender MCP 实时桥接，模型可直接投放到街头并可缩放、旋转、碰撞、导出 GLB。

---

## 运行环境

- Node.js ≥ 20
- 支持 WebGPU 的浏览器（Chrome / Edge 113+）；不支持时自动降级 WebGL2

```bash
npm install
npm run dev
```

打开 `http://localhost:3000/`。

生产构建：

```bash
npm run build
npm run preview
```

> 无需任何 `.env` 文件或 API Key 即可运行全部场景与漫游功能。AI 工坊的密钥在页面面板内填写，保存在浏览器 localStorage。

---

## 操作说明

| 按键 | 功能 |
| --- | --- |
| `W` `A` `S` `D` | 移动 |
| 鼠标移动 | 环顾（点击画面锁定指针） |
| `Shift` | 疾行 |
| `Space` | 跳跃 |
| `C` | 俯身慢行 |
| `V` | 第一 / 第三人称切换 |
| `F` | 上车 / 下车、街坊互动、搭乘观景升降梯 |
| `H` | 显示 / 隐藏 HUD |
| `B` | 打开三维模型工坊 |
| `Esc` | 暂停与设置菜单 |
| `Tab` | 委托日志 |

---

## 调试参数

| 参数 | 说明 |
| --- | --- |
| `?q=low\|medium\|high\|ultra` | 画质预设（影响粒子数、灯光池大小） |
| `?only=ground,buildings` | 仅加载指定子系统，便于隔离调试 |
| `?shot=street\|overlook\|river\|alley\|aerial\|ground&frames=90` | 固定机位确定性截图模式（禁用输入与 UI） |
| `?pfx=nossr,noscatter,nobloom,nostreak,notraa` | 单独关闭后处理通道做性能对比 |
| `?wxoff=1` 或 `?wxoff=rain,splash,drips,steam` | 关闭天气粒子与 GPU Compute |

---

## 三维工坊配置

### 雷火 Tripo 3D

1. 游戏内按 `B` 打开「三维模型工坊」。
2. 在「雷火三维生成」页填写网关地址（默认 `https://ai.leihuo.netease.com`）、专属令牌、请求头名称与前缀。
3. 输入提示词或上传图片即可发起文生 / 图生三维任务，完成后模型自动投放到玩家面前。
4. 未配置密钥时，面板会回退到内置的程序化角色合成器，仍可生成带骨骼动画的江南角色并导出 GLB。

### 本地 Blender MCP

1. 在面板「本地建模连接」页下载内置的 `blender_mcp_bridge.py`。
2. 本机启动 Blender 并开启 MCP 插件（TCP `127.0.0.1:9876`）。
3. 运行 `python blender_mcp_bridge.py`（HTTP `127.0.0.1:8765`，同时兼任雷火内网代理）。
4. 网页端即可 Ping Blender、拉取当前选中物体或完整场景、或直接下发 `bpy` 脚本建模。

---

## 项目结构

```
assets/                 模型、贴图、字体（GLB / PNG / WOFF2）
src/
  engine/               渲染器、后处理、资源加载、输入
  materials/            共享 TSL 材质（湿地面、噪声）
  world/layout.js       全局城市布局单一真源
  systems/
    atmosphere/         夜空、雾、PMREM 环境、体积光
    ground/             路面、人行道、水洼与碰撞体
    buildings/          建筑体块、商铺、室内视差、古巷
    landmarks/          轻轨、高架、运河、樱花树、拱宸桥、天际线
    signage/            霓虹图集、招牌、灯笼、广告牌、路牌
    vehicles/           车辆模型、LOD、车流、驾驶
    crowd/              骨骼行人 + VAT 远景人群
    weather/            雨、水花、滴水、蒸汽、闪电
    audio/              程序化 DSP 合成与环境音景
    player/             角色控制器、街区触发、委托任务、HUD 挂载
  ui/                   HUD、菜单、小地图、AI 工坊面板
```

---

## 技术栈

- Three.js `0.186.1`（WebGPURenderer + TSL 节点材质）
- Rapier3D `0.20.0`（角色、车辆、动态投放物体碰撞）
- Vite `8.3.2`
- 无前端框架，纯 ES Module
