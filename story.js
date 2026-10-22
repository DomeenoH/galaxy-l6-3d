import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { assembleCar, calibrateWheels, countTris, box3Of, buildBodyLiner, CAR_LEN, CAR_W, CAR_H, WB, FRONT_AXLE, REAR_AXLE } from './assemble.js';
import { buildRealMaterials, applyRealMaterials, setRealPaint, setRealInterior, setRealLights } from './realcar.js';
import { makeStudioEnv, makeStudioRoom, makeContactShadow } from './render/studio.js';
import { ReflectFloor } from './render/reflect.js';
import { Post } from './render/post.js';
import { CamRig, Ease } from './render/rig.js';
import { Annot } from './render/annot.js';
import { makeFlowLines } from './render/flow.js';

/* =========================================================
   吉利银河 L6 · 影棚分镜
   渲染路线照搬 gamemcu.com/su7：
     · 不用任何点/平行光源 —— 全靠影棚柔光箱烘的 IBL
     · 地面 = 实时平面反射（mip 模糊），不是镜像克隆
     · 后处理 = Bloom + ACES + 曝光（renderer 自身不做色调映射）
     · 机位 = 弹簧臂 + tween 状态机 + FBM 噪声漂移，恒定 33.4° 镜头
   ========================================================= */

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------- 渲染器 ---------------- */
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, alpha: false,
  powerPreference: 'high-performance', preserveDrawingBuffer: true,
  /* ⚠️⚠️ 这里的 `antialias: true` 对画面**几乎没用** —— 主场景渲染到
     render/post.js 的 sceneRT（离屏 target），而 MSAA 必须在那个 target 上开
     （见 post.js 里的 `sceneRT.samples = 4`）。真正修好「车身缝上的点状虚线」
     的是那一行，不是这一行。

     logarithmicDepthBuffer 试过并**否决**：门把手凹槽底面与门外板共面，
     对数深度确实能提精度，但实测局部对比度（p99 56.3）比纯 MSAA（49.8）还差，
     而且 FPS 从 77.5 掉到 70.5。既然 MSAA 就够了，就别付这个代价。 */
  logarithmicDepthBuffer: false,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NoToneMapping;      // 色调映射交给后处理
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x04060a, 1);
renderer.shadowMap.enabled = false;              // 影棚不用 shadowMap

const scene = new THREE.Scene();

/* ---------------- 影棚 ---------------- */
const envTex = makeStudioEnv(renderer);
scene.environment = envTex;
scene.environmentIntensity = 0.60;

const room = makeStudioRoom();
scene.add(room);

const floor = new ReflectFloor(renderer, { scale: 0.6, size: 120 });
scene.add(floor.mesh);

const contact = makeContactShadow(8.4, 3.7);
scene.add(contact);

const flow = makeFlowLines();
scene.add(flow);

const post = new Post(renderer, { mips: 5 });

/* ---------------- 相机 ---------------- */
/* ⚠️ near/far 别乱给。原来是 0.05 / 400（比值 8000）——
   后处理走的 RenderTarget 深度缓冲精度有限，7m 处的深度分辨率只剩 ~15mm，
   于是车身面板缝 / 门把手 / 充电口盖这些**几乎共面**的贴片全部 Z-fighting，
   渲染出一排规则的点状虚线，看着像「线稿」——这是廉价感的一大来源。
   收紧到 0.6 / 120（比值 200）后 7m 处约 1.2mm，条纹消失。
   0.6 是安全的：相机高 0.9m，画面下沿最近可见地面在 3.1m 外。 */
const camera = new THREE.PerspectiveCamera(33.4, innerWidth / innerHeight, 0.6, 120);
const rig = new CamRig(camera, {
  lookAt: [0, 0.80, 0], dist: 7.0, yaw: Math.PI * 0.5, pitch: 0.02, fov: 33.4,
  noiseAmp: REDUCED ? 0 : 0.045, noiseFreq: 0.42,
});

/* =========================================================
   章节配置（每个状态 = 机位 + 灯光氛围 + 叠加物）
   pscale = 光池椭圆化 [x, z]；base = 地面底色强度
   sb* = 顶部光板（V 形天花板柔光箱）：sb 强度、sbx/sby 谷底、sbyl/sbyr 左右臂、sbxr 右端
   ========================================================= */
const STAGES = [
  { nm: 'L6',
    cam: { lookAt: [0, 0.80, 0], dist: 6.25, yaw: Math.PI * 0.5, pitch: 0.020, fov: 33.4 },
    env: 0.86, exposure: 0.90, bloom: 0.40, thr: 1.15, smooth: 0.45, vig: 0.92,
    pool: 0.50, refl: 1.25, pscale: [1, 1], base: 1.0,
    sb: 1.0, sbxl: 0.08, sbyl: 0.012, sbxa: 0.14, sbxb: 0.86, sbyr: 0.012, sbxr: 0.92, sbyf: 0.069,
    lights: false, flow: 0, annot: 0,
    colorbar: true, sliders: false, wm: false, dur: 2.4 },

  { nm: '车身',
    cam: { lookAt: [0, 0.78, 0], dist: 6.35, yaw: -0.90, pitch: 0.115, fov: 33.4 },
    env: 0.88, exposure: 0.92, bloom: 0.34, thr: 1.20, smooth: 0.40, vig: 0.86,
    pool: 0.50, refl: 1.10, pscale: [1, 1], base: 1.0,
    sb: 1.0, sbxl: 0.00, sbyl: 0.000, sbxa: 0.36, sbxb: 0.36, sbyr: 0.000, sbxr: 0.74, sbyf: 0.092,
    lights: false, flow: 0, annot: 1,
    colorbar: true, sliders: false, wm: false, dur: 1.9 },

  { nm: '电混',
    cam: { lookAt: [0.10, 0.72, 0], dist: 6.5, yaw: -0.62, pitch: -0.045, fov: 33.4 },
    env: 0.94, exposure: 0.88, bloom: 0.22, thr: 1.24, smooth: 0.50, vig: 0.90,
    pool: 0.46, refl: 1.02, pscale: [1, 1], base: 1.0,
    sb: 0.0, sbxl: 0.08, sbyl: 0.012, sbxa: 0.14, sbxb: 0.86, sbyr: 0.012, sbxr: 0.92, sbyf: 0.069,
    lights: true, flow: 0.34, annot: 0,
    colorbar: false, sliders: false, wm: false, dur: 2.1 },

  // 俯视：相机抬到 13.3m，9m 半径的圆光池会铺满整屏 → 必须压成「一道光柱」，
  // 同时把地面底色关掉，让车旁边的地面落到近黑（参考站实测 (3,5,5)）。
  { nm: '续航',
    cam: { lookAt: [0.16, 0.80, 0], dist: 11.6, yaw: Math.PI, pitch: 1.17, fov: 33.4 },
    env: 0.90, exposure: 0.92, bloom: 0.40, thr: 1.16, smooth: 0.42, vig: 0.84,
    pool: 1.05, refl: 0.72, pscale: [0.62, 3.2], base: 0.12,
    sb: 0.0, sbxl: 0.08, sbyl: 0.012, sbxa: 0.14, sbxb: 0.86, sbyr: 0.012, sbxr: 0.92, sbyf: 0.069,
    lights: true, flow: 0, annot: 0,
    colorbar: false, sliders: false, wm: false, dur: 2.0 },

  { nm: '定制',
    cam: { lookAt: [0.16, 0.78, 0], dist: 6.5, yaw: -0.72, pitch: 0.055, fov: 33.4 },
    env: 0.88, exposure: 0.90, bloom: 0.40, thr: 1.16, smooth: 0.44, vig: 0.88,
    pool: 0.48, refl: 1.20, pscale: [1, 1], base: 1.0,
    sb: 0.0, sbxl: 0.08, sbyl: 0.012, sbxa: 0.14, sbxb: 0.86, sbyr: 0.012, sbxr: 0.92, sbyf: 0.069,
    lights: false, flow: 0, annot: 0,
    colorbar: true, sliders: true, wm: true, dur: 1.8 },
];

const N = STAGES.length;
let stage = -1;

/* =========================================================
   车漆色板
   ========================================================= */
/* 车漆色板。
   ⚠️ metal 别给高（白车尤其）。真车漆是「介质漆 + 清漆」，
   metalness 0.5 会让车身变成「白色金属镜」= 一片均匀亮灰 = 白模感。
   只有银/金这种真金属漆才给 0.4+。 */
/* 车漆色板。
   ⚠️⚠️ 这里的 `rough` 会**覆盖** realcar.js 里 M.paint 的 roughness ——
   `applyPalette(0, true)` 在加载完成后立刻跑一次，调的是 setRealPaint()。
   也就是说：**realcar.js 里那个 roughness 只是初值，真正生效的是这张表**。
   （踩过一次：在 realcar.js 里把 roughness 从 0.24 改到 0.14，画面没变化，
   因为这里还写着 0.26。）
   所以这张表的 rough 已经统一按「能看清柔光箱形状反射」的标准降了一档。
   ⚠️ 色相也要**中性**：原来珍珠白给 #f4f6f9（B 比 R 高 5）整个车身泛蓝，
   参考站的白车实测是 (64,64,63) —— 完全中性、略带一点暖。 */
const PALETTE = [
  { id: '珍珠白', c: '#f4f4f1', metal: 0.06, rough: 0.14 },
  { id: '云曦银', c: '#bdbdbe', metal: 0.52, rough: 0.17 },
  { id: '星际灰', c: '#717173', metal: 0.40, rough: 0.19 },
  { id: '曜石黑', c: '#151517', metal: 0.18, rough: 0.13 },
  { id: '星夜蓝', c: '#1d3f78', metal: 0.10, rough: 0.15 },
  { id: '极光绿', c: '#2c4a3c', metal: 0.12, rough: 0.16 },
  { id: '熔岩橙', c: '#c4551f', metal: 0.08, rough: 0.15 },
  { id: '赤霞红', c: '#8e1f22', metal: 0.10, rough: 0.14 },
  { id: '晨曦金', c: '#b08a4a', metal: 0.38, rough: 0.18 },
];

/* =========================================================
   小 tween 池（章节切换时给一堆标量发过渡）
   ========================================================= */
const tweens = [];
function tweenTo(obj, to, dur, { delay = 0, ease = Ease.inOutCubic, onUpdate, onDone } = {}) {
  const from = {};
  for (const k in to) from[k] = obj[k];
  tweens.push({ obj, from, to, dur: Math.max(1e-4, dur), delay, ease, t: -delay, onUpdate, onDone });
}
function killTweensOf(obj) { for (const t of tweens) if (t.obj === obj) t.done = true; }
function stepTweens(dt) {
  for (const t of tweens) {
    if (t.done) continue;
    t.t += dt;
    if (t.t < 0) continue;
    const k = clamp(t.t / t.dur, 0, 1), e = t.ease(k);
    for (const key in t.to) t.obj[key] = t.from[key] + (t.to[key] - t.from[key]) * e;
    t.onUpdate && t.onUpdate(t.obj, e);
    if (k >= 1) { t.done = true; t.onDone && t.onDone(); }
  }
  for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].done) tweens.splice(i, 1);
}

/* =========================================================
   UI 构建
   ========================================================= */
const navItems = document.getElementById('nav-items');
navItems.innerHTML = STAGES.map((s, i) =>
  `<button class="it${i === 0 ? ' on' : ''}" data-i="${i}"><span class="nm">${s.nm}</span><span class="pip"></span></button>`
).join('');
navItems.querySelectorAll('.it').forEach(b => { b.onclick = () => { blip(); go(+b.dataset.i); }; });

const cbPill = document.getElementById('cb-pill');
cbPill.innerHTML = PALETTE.map((p, i) =>
  `<button class="bar${i === 0 ? ' on' : ''}" data-i="${i}" title="${p.id}" style="background-image:radial-gradient(circle at 34% 30%, ${shade(p.c, 1.28)}, ${p.c} 62%, ${shade(p.c, 0.62)})"></button>`
).join('');
cbPill.querySelectorAll('.bar').forEach(b => {
  b.onclick = () => { blip(); applyPalette(+b.dataset.i, true); };
});
function shade(hex, k) {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return '#' + c.getHexString();
}

const chapters = [...document.querySelectorAll('.ch')];
const annotHost = document.getElementById('annot');
const annot = new Annot(annotHost);
const elColorbar = document.getElementById('colorbar');
const elSliders = document.getElementById('sliders');
const elFlash = document.getElementById('flash');
const elHint = document.getElementById('hint');
const elWm = document.getElementById('wm');

/* 第 2 章的尺寸标注（世界坐标；车长沿 X，车头 +X）
   ⚠️ 尺寸线要**贴着车**。放在 2.2m 外（车半宽才 0.94m）会横穿整个画面、
   压在倒影上，看着像工程图而不是产品页。参考站的线都收在车自己的footprint 边上。 */
const AX = CAR_LEN / 2, AZ = CAR_W / 2;
const A = {
  len:   annot.add({ a: [-AX, 0.03, 1.28], b: [AX, 0.03, 1.28], label: '车长 4782mm', pad: 0.26, side: -1 }),
  wheel: annot.add({ a: [REAR_AXLE, 0.03, 0.92], b: [FRONT_AXLE, 0.03, 0.92], label: '轴距 2752mm', pad: 0.14, side: -1 }),
  hgt:   annot.add({ a: [-AX, 0.03, 1.28], b: [-AX, CAR_H, 1.28], label: '车高 1489mm', pad: 0.10, side: 1 }),
  wid:   annot.add({ a: [AX + 0.22, 0.03, -AZ], b: [AX + 0.22, 0.03, AZ], label: '车宽 1875mm', pad: 0.20, side: 1 }),
};
void A;

/* =========================================================
   滑杆（第 5 章）
   ========================================================= */
const S = {
  hue: document.getElementById('s-hue'),
  sat: document.getElementById('s-sat'),
  val: document.getElementById('s-val'),
  metal: document.getElementById('s-metal'),
  rough: document.getElementById('s-rough'),
};
const V = {
  hue: document.getElementById('v-hue'), sat: document.getElementById('v-sat'), val: document.getElementById('v-val'),
  metal: document.getElementById('v-metal'), rough: document.getElementById('v-rough'),
};
let paintState = { h: 212, s: 6, v: 96, metal: 0.52, rough: 0.24 };

function paintFromSliders() {
  const h = +S.hue.value, s = +S.sat.value, v = +S.val.value;
  const metal = +S.metal.value / 100, rough = +S.rough.value / 100;
  paintState = { h, s, v, metal, rough };
  V.hue.textContent = h; V.sat.textContent = s; V.val.textContent = v;
  V.metal.textContent = S.metal.value; V.rough.textContent = S.rough.value;
  const c = new THREE.Color().setHSL(h / 360, s / 100, v / 200);
  if (realMats) setRealPaint(realMats, c.getHex(), metal, rough);
}
Object.values(S).forEach(el => el.addEventListener('input', paintFromSliders));

function applyPalette(i, syncSliders) {
  const p = PALETTE[i];
  cbPill.querySelectorAll('.bar').forEach((b, k) => b.classList.toggle('on', k === i));
  const c = new THREE.Color(p.c);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  paintState = { h: Math.round(hsl.h * 360), s: Math.round(hsl.s * 100), v: Math.round(hsl.l * 200), metal: p.metal, rough: p.rough };
  if (realMats) setRealPaint(realMats, p.c, p.metal, p.rough);
  if (syncSliders) {
    S.hue.value = paintState.h; S.sat.value = paintState.s; S.val.value = paintState.v;
    S.metal.value = Math.round(p.metal * 100); S.rough.value = Math.round(p.rough * 100);
    Object.entries(V).forEach(([k, el]) => {
      el.textContent = k === 'metal' || k === 'rough' ? S[k].value : paintState[k];
    });
  }
}

/* 内饰 / 车灯 */
let interiorKey = 'brown';
const INT_ORDER = ['brown', 'black', 'cream'];
document.getElementById('btn-cover').onclick = e => {
  blip();
  interiorKey = INT_ORDER[(INT_ORDER.indexOf(interiorKey) + 1) % INT_ORDER.length];
  if (realMats) setRealInterior(realMats, interiorKey);
  e.currentTarget.classList.toggle('on', interiorKey !== 'brown');
  e.currentTarget.textContent = { brown: '内饰·棕', black: '内饰·黑', cream: '内饰·米' }[interiorKey];
};
let lightsOn = false;
document.getElementById('btn-lights').onclick = e => {
  blip();
  lightsOn = !lightsOn;
  if (realMats) setRealLights(realMats, lightsOn);
  e.currentTarget.classList.toggle('on', lightsOn);
};

/* =========================================================
   载入
   ========================================================= */
let realMats = null, realWheels = [], carRoot = null;
const gltfLoader = new GLTFLoader();

const plArc = document.getElementById('pl-arc');
const plPct = document.getElementById('pl-pct');
const plTip = document.getElementById('pl-tip');
let shown = 0;
function setProgress(v, tip) {
  shown = Math.max(shown, v);
  plPct.textContent = Math.round(shown);
  plArc.style.strokeDashoffset = String(283 * (1 - shown / 100));
  if (tip) plTip.textContent = tip;
}

function loadOne(url, weight, base, tip) {
  return new Promise((res, rej) => {
    gltfLoader.load(url, res,
      x => { if (x.total) setProgress(base + (x.loaded / x.total) * weight, tip); },
      rej);
  });
}

async function boot() {
  setProgress(3, '正在装配模型…');
  try {
    const body = await loadOne('./model.glb', 84, 3, '载入车身（46 MB）…');
    setProgress(89, '载入轮组…');
    let wheels = null;
    try { wheels = await loadOne('./wheels.glb', 8, 89, '载入轮组…'); } catch (e) { console.warn(e); }
    setProgress(97, '接回贴图…');
    await new Promise(r => setTimeout(r, 50));

    const RM = buildRealMaterials();
    const { wrap, wheels: rw, group } = assembleCar(body, wheels);
    // 调试钩子：控制台里可以直接 __car.traverse(...) 开关网格 / 材质
    window.__car = group;
    applyRealMaterials(group, RM);
    // 车身内衬：把面板缝里的白点虚线变成一条暗线。见 assemble.js 的 buildBodyLiner()
    buildBodyLiner(group, RM);
    realMats = RM;

    scene.add(wrap);
    carRoot = wrap;
    realWheels = rw;
    if (rw.length) calibrateWheels(wrap, rw);

    applyPalette(0, true);
    setRealInterior(RM, 'brown');
    setRealLights(RM, false);

    // 接触阴影跟着车身包围盒（plane 局部 x→世界 x，局部 y→世界 z）
    // 用 box3Of：轮拱 AO 片会伸到轮胎下面，算进包围盒会让阴影偏大
    const bb = box3Of(wrap);
    const sx = ((bb.max.x - bb.min.x) * 1.18) / 8.4;
    const sy = ((bb.max.z - bb.min.z) * 1.40) / 3.7;
    contact.scale.set(sx, sy, 1);

    setProgress(100, '就绪');
    console.log('[L6] 三角面', (countTris(group) / 1000).toFixed(0) + 'k');
  } catch (e) {
    console.error(e);
    plTip.textContent = '模型载入失败：' + (e && e.message ? e.message : e);
    plArc.style.stroke = '#c0392b';
    return;
  }
  setTimeout(() => {
    document.getElementById('preloader').classList.add('gone');
    document.body.classList.remove('loading');
    document.body.classList.add('ready');
    go(0, true);
  }, 260);
}

/* =========================================================
   状态切换
   ========================================================= */
let press = 0;               // 按住时的强度 0..1
let pressTween = null;

function go(i, instant = false) {
  i = clamp(i, 0, N - 1);
  if (i === stage) return;
  const prev = stage;
  stage = i;
  const st = STAGES[i];

  navItems.querySelectorAll('.it').forEach((b, k) => b.classList.toggle('on', k === i));
  chapters.forEach((el, k) => el.classList.toggle('on', k === i));

  if (prev >= 0 && !instant && !REDUCED) {
    elFlash.classList.remove('on'); void elFlash.offsetWidth; elFlash.classList.add('on');
  }

  const dur = instant || REDUCED ? 0.001 : st.dur;
  rig.goto(st.cam, dur, { delay: instant ? 0 : 0.06, ease: Ease.inOutCubic });
  if (instant) { rig.targetLook.set(...st.cam.lookAt); rig.fov = st.cam.fov; }

  tweenTo(scene, { environmentIntensity: st.env }, dur, { delay: 0.1 });
  tweenTo(post.params, {
    exposure: st.exposure, bloom: st.bloom, threshold: st.thr,
    smoothing: st.smooth, vignette: st.vig,
    sb: st.sb,
    sbxl: st.sbxl, sbyl: st.sbyl, sbxa: st.sbxa,
    sbxb: st.sbxb, sbyr: st.sbyr, sbxr: st.sbxr, sbyf: st.sbyf,
  }, dur, { delay: 0.1 });
  tweenTo(floor.material.uniforms.uPoolIntensity, { value: st.pool }, dur, { delay: 0.1 });
  tweenTo(floor.material.uniforms.uReflIntensity, { value: st.refl }, dur, { delay: 0.1 });
  // Vector2 的 x/y 是普通标量，直接喂给 tweenTo 就行
  tweenTo(floor.material.uniforms.uPoolScale.value, { x: st.pscale[0], y: st.pscale[1] }, dur, { delay: 0.1 });
  tweenTo(floor.material.uniforms.uBaseMix, { value: st.base }, dur, { delay: 0.1 });
  // 天花板灯板：面积已经缩小，亮度要跟上才像"灯"而不是"一块灰"
  tweenTo(room.userData.panelMat.uniforms.uColor.value,
    { r: st.env * 1.22, g: st.env * 1.23, b: st.env * 1.26 }, dur, { delay: 0.1 });

  const fm = flow.userData.material;
  tweenTo(fm.uniforms.uOpacity, { value: st.flow }, st.flow > 0 ? dur : dur * 0.55, {
    delay: 0.1,
    onDone: () => { flow.visible = fm.uniforms.uOpacity.value > 0.01; },
  });
  if (st.flow > 0) flow.visible = true;

  tweenTo(annot, { opacity: st.annot }, dur, { delay: st.annot > 0 ? 0.75 : 0 });

  // 俯视章节收起天花板
  room.userData.setCeiling(st.cam.pitch < 0.6);

  const wantLights = st.lights || lightsOn;
  if (realMats) setRealLights(realMats, wantLights);

  elColorbar.classList.toggle('on', !!st.colorbar);
  elSliders.classList.toggle('on', !!st.sliders);
  elWm.classList.toggle('on', !!st.wm);

  if (i > 0) document.body.classList.add('scrolled');
  blip(i === 0 ? 880 : 660 + i * 90);
}

/* 按住 = 给一点"冲刺"的反馈：镜头拉远、广角、辉光增强 */
function setPress(on) {
  if (REDUCED) return;
  const st = STAGES[Math.max(0, stage)];
  tweenTo({ v: press }, { v: on ? 1 : 0 }, on ? 0.55 : 0.9, {
    ease: on ? Ease.outCubic : Ease.inOutCubic,
    onUpdate: o => { press = o.v; },
  });
  rig.setFov(on ? 41.5 : st.cam.fov, on ? 0.5 : 0.9);
  killTweensOf(post.params);
  tweenTo(post.params, { bloom: on ? st.bloom * 1.45 : st.bloom }, on ? 0.5 : 0.9, { delay: on ? 0 : 0.05 });
  killTweensOf(flow.userData.material.uniforms.uSpeed);
  tweenTo(flow.userData.material.uniforms.uSpeed, { value: on ? 1.5 : 0.34 }, on ? 0.5 : 1.0);
}

/* =========================================================
   输入
   ========================================================= */
let lock = 0;
function wheelStep(d) {
  const now = performance.now();
  if (now - lock < 620) return;
  lock = now;
  go(stage + d);
}

addEventListener('wheel', e => {
  e.preventDefault();
  const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  if (Math.abs(d) < 4) return;
  wheelStep(d > 0 ? 1 : -1);
}, { passive: false });

let ty = 0;
addEventListener('touchstart', e => { ty = e.touches[0].clientY; }, { passive: true });
addEventListener('touchend', e => {
  const dy = ty - (e.changedTouches[0]?.clientY ?? ty);
  if (Math.abs(dy) > 42) wheelStep(dy > 0 ? 1 : -1);
}, { passive: true });

addEventListener('keydown', e => {
  if (['ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); wheelStep(1); }
  else if (['ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); wheelStep(-1); }
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(N - 1);
  else if (e.key === 'ArrowRight') go(stage + 1);
  else if (e.key === 'ArrowLeft') go(stage - 1);
});

canvas.addEventListener('pointerdown', () => setPress(true));
addEventListener('pointerup', () => setPress(false));
addEventListener('pointercancel', () => setPress(false));
addEventListener('blur', () => setPress(false));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
  floor.setSize(innerWidth, innerHeight);
});

/* 存图 */
document.getElementById('shot').onclick = () => {
  blip();
  const a = document.createElement('a');
  a.download = 'geely-galaxy-l6.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
};

/* 静音 */
let muted = false;
const btnMute = document.getElementById('mute');
btnMute.onclick = () => { muted = !muted; btnMute.classList.toggle('off', muted); };

/* 极简点击音（不加载音频资源） */
let actx = null;
function blip(freq = 1100) {
  if (muted) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.035, actx.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.10);
    o.connect(g).connect(actx.destination);
    o.start(); o.stop(actx.currentTime + 0.11);
  } catch (e) { /* 忽略 */ }
}

/* =========================================================
   主循环
   ========================================================= */
const clock = new THREE.Clock();
let fpsN = 0, fpsT = 0;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  stepTweens(dt);
  rig.update(dt);

  // 气流线时间 + 按住时加速
  flow.userData.material.uniforms.uTime.value = time;

  // 轮子：按住时转快一点（方向按左右侧分开算，见 assemble.js）
  if (realWheels.length && !REDUCED) {
    const sp = dt * (0.55 + press * 7.5);
    realWheels.forEach(w => { w.rotation.x += (w.userData.spin ?? -1) * sp; });
  }

  // 光池跟着相机方位轻微偏移，反射更"活"
  const fu = floor.material.uniforms;
  fu.uPoolPos.value.set(rig.targetLook.x, rig.targetLook.z);
  fu.uTime.value = time;

  // 反射 pass（接触阴影 + 影棚房间都不能出现在反射里：
  // 房间天花板灯板反射到地面上会变成一片死白的硬边块）
  floor.extraHide = [contact, room];
  floor.update(scene, camera);

  // 标注
  if (annot.opacity > 0.01) annot.update(camera, innerWidth, innerHeight);

  post.render(scene, camera);

  // FPS
  fpsN++; fpsT += dt;
  if (fpsT > 3) { console.log('[L6] FPS', (fpsN / fpsT).toFixed(1)); fpsN = 0; fpsT = 0; }
}

/* 启动 */
tick();
boot();
