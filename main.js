import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { createCar, createMaterials, setPaint, setInterior, setLights, setBodyOpacity, SPEC } from './car.js';
import { buildRealMaterials, applyRealMaterials, setRealPaint, setRealInterior, setRealLights, setRealBodyOpacity } from './realcar.js';
import { assembleCar, calibrateWheels, polishShadows, countTris, buildBodyLiner, CAR_LEN, CAR_W, CAR_H, WB } from './assemble.js';

/* ---------------- 渲染器 ---------------- */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

/* ---------------- 场景 / 相机 ---------------- */
const scene = new THREE.Scene();

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.1, 200);
camera.position.set(6.4, 2.55, 5.6);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.72, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 3.2;
controls.maxDistance = 22;
controls.minPolarAngle = 0.12;
controls.maxPolarAngle = Math.PI / 2 - 0.035;
controls.autoRotateSpeed = 0.9;
controls.update();

/* ---------------- 灯光 ---------------- */
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1b1d22, 0.55));

const key = new THREE.DirectionalLight(0xffffff, 2.6);
key.position.set(5.5, 8.5, 4.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1;
key.shadow.camera.far = 26;
const S = 4.2;
Object.assign(key.shadow.camera, { left: -S, right: S, top: S, bottom: -S });
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.035;   // 大尺寸车体防自阴影麻点
key.shadow.radius = 2.2;
scene.add(key);

const rimL = new THREE.DirectionalLight(0x9dc4ff, 1.5);
rimL.position.set(-6, 3.2, -4.2);
scene.add(rimL);

const rimR = new THREE.DirectionalLight(0xffd9a8, 0.9);
rimR.position.set(-3.5, 2.4, 6.5);
scene.add(rimR);

const fill = new THREE.DirectionalLight(0xffffff, 0.5);
fill.position.set(2, 1.2, -7);
scene.add(fill);

/* ---------------- 地面 ---------------- */
const ground = new THREE.Mesh(new THREE.CircleGeometry(22, 64), new THREE.ShadowMaterial({ opacity: 0.44 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0.001;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(24, 48, 0x2a3242, 0x1b2130);
grid.material.transparent = true;
grid.material.opacity = 0.35;
grid.position.y = 0.002;
scene.add(grid);

/* ---------------- 车 ---------------- */
const M = createMaterials();
const { car, body, interior, details, wheels } = createCar(M);
scene.add(car);

/* ---------------- 状态 ---------------- */
const state = { lights: false, xray: false, spin: true, doors: false };
controls.autoRotate = state.spin;

window.L6 = {
  scene, car, body, interior, details, wheels, camera, controls, materials: M, THREE,
  real: () => ({ root: realRoot, wheels: realWheels, mats: realMats, paint: currentPaint, interior: currentInterior, state }),
};

/* 真实 GLB 载入（声明提前，避免渲染循环 TDZ） */
const gltfLoader = new GLTFLoader();
let realRoot = null;
let realMats = null;
const realWheels = [];

/* ---------------- 车漆 / 内饰 ---------------- */
const PAINTS = {
  pearl:   { hex: 0xf4f6f9, metal: 0.58, rough: 0.24, label: '珍珠白' },
  silver:  { hex: 0xb9c0ca, metal: 0.78, rough: 0.28, label: '云曦银' },
  grey:    { hex: 0x6e747d, metal: 0.72, rough: 0.30, label: '星际灰' },
  black:   { hex: 0x14161a, metal: 0.66, rough: 0.22, label: '曜石黑' },
  blue:    { hex: 0x1d3f78, metal: 0.70, rough: 0.26, label: '星夜蓝' },
  green:   { hex: 0x2c4a3c, metal: 0.68, rough: 0.28, label: '极光绿' },
};
const INTERIORS = {
  brown: { hex: 0x7c4a28, dark: 0x5e3619, trim: 0x2b2723, label: '棕' },
  black: { hex: 0x24262b, dark: 0x17181c, trim: 0x2c2e33, label: '黑' },
  cream: { hex: 0xd8cfc0, dark: 0xb9ad9a, trim: 0x332f2a, label: '米白' },
};

let currentPaint = 'pearl';
let currentInterior = 'brown';

function applyPaint(k) {
  if (!PAINTS[k]) return;
  currentPaint = k;
  const p = PAINTS[k];
  if (realMats) setRealPaint(realMats, p.hex, p.metal, p.rough);
  else setPaint(M, p.hex, p.metal, p.rough);
  document.querySelectorAll('[data-paint]').forEach(b => b.classList.toggle('on', b.dataset.paint === k));
}
function applyInterior(k) {
  if (!INTERIORS[k]) return;
  currentInterior = k;
  const i = INTERIORS[k];
  if (realMats) setRealInterior(realMats, k);
  else setInterior(M, i.hex, i.dark, i.trim);
  document.querySelectorAll('[data-int]').forEach(b => b.classList.toggle('on', b.dataset.int === k));
}
function applyLights(on) {
  state.lights = on;
  if (realMats) setRealLights(realMats, on);
  else setLights(M, on);
  const b = document.getElementById('btn-lights');
  if (b) { b.classList.toggle('on', on); b.textContent = on ? '车灯 · 已点亮' : '车灯 · 熄灭'; }
}
function applyXray(on) {
  state.xray = on;
  if (realMats) setRealBodyOpacity(realMats, on ? 0.16 : 1);
  else setBodyOpacity(M, on ? 0.14 : 1);
  const b = document.getElementById('btn-xray');
  if (b) { b.classList.toggle('on', on); b.textContent = on ? '车身 · 透视中' : '车身 · 透视'; }
}
applyPaint('pearl');
applyInterior('brown');

/* ---------------- 视角预设 ---------------- */
const VIEWS = {
  front45: { p: [6.4, 2.55, 5.6], t: [0, 0.72, 0] },
  side:    { p: [0.15, 1.35, 8.6], t: [0, 0.70, 0] },
  rear45:  { p: [-6.2, 2.45, 5.3], t: [0, 0.72, 0] },
  front:   { p: [8.4, 1.55, 0.9], t: [0, 0.70, 0] },
  top:     { p: [3.9, 6.6, 4.4], t: [0, 0.60, 0] },
  inside:  { p: [1.35, 1.55, 2.35], t: [0.05, 0.86, 0] },
};

let tween = null;
function flyTo(v, ms = 850) {
  tween = { t0: performance.now(), ms, from: camera.position.clone(), to: new THREE.Vector3(...v.p),
            tFrom: controls.target.clone(), tTo: new THREE.Vector3(...v.t) };
}

/* ---------------- UI ---------------- */
document.querySelectorAll('[data-paint]').forEach(b => b.onclick = () => applyPaint(b.dataset.paint));
document.querySelectorAll('[data-int]').forEach(b => b.onclick = () => applyInterior(b.dataset.int));
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
  flyTo(VIEWS[b.dataset.view]);
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('on', x === b));
});

const btnLights = document.getElementById('btn-lights');
const btnSpin = document.getElementById('btn-spin');
const btnXray = document.getElementById('btn-xray');

btnLights.onclick = () => applyLights(!state.lights);
btnSpin.onclick = () => {
  state.spin = !state.spin;
  controls.autoRotate = state.spin;
  btnSpin.classList.toggle('on', state.spin);
};
btnXray.onclick = () => {
  applyXray(!state.xray);
  if (state.xray) flyTo(VIEWS.inside);
};
btnSpin.classList.toggle('on', state.spin);

document.getElementById('btn-reset').onclick = () => {
  applyPaint('pearl'); applyInterior('brown');
  applyLights(false);
  applyXray(false);
  state.spin = true; controls.autoRotate = true; btnSpin.classList.add('on');
  flyTo(VIEWS.front45);
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('on', x.dataset.view === 'front45'));
};

/* ---------------- 循环 ---------------- */
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = clock.getDelta();

  if (tween) {
    const k = Math.min(1, (performance.now() - tween.t0) / tween.ms);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    camera.position.lerpVectors(tween.from, tween.to, e);
    controls.target.lerpVectors(tween.tFrom, tween.tTo, e);
    if (k >= 1) tween = null;
  }

  if (state.spin) {
    wheels.forEach(w => { w.rotation.x -= dt * 1.4; });
    // 真实轮组：左右两侧的 holder 局部轴相反，方向由 userData.spin 决定
    realWheels.forEach(w => { w.rotation.x += (w.userData.spin ?? -1) * dt * 1.4; });
  }

  controls.update();
  renderer.render(scene, camera);
}
tick();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ---------------- 真实 GLB 载入 ---------------- */
function showReal(bodyGltf, wheelGltf, label) {
  const RM = buildRealMaterials();
  const { wrap, wheels: rw, group } = assembleCar(bodyGltf, wheelGltf);

  applyRealMaterials(group, RM);
  // 车身内衬：把面板缝里的白点虚线变成一条暗线。见 assemble.js 的 buildBodyLiner()
  buildBodyLiner(group, RM);
  realMats = RM;
  polishShadows(group);

  if (realRoot) scene.remove(realRoot);
  scene.remove(car);
  realRoot = wrap;
  realWheels.length = 0;
  realWheels.push(...rw);
  scene.add(wrap);

  if (rw.length) {
    try {
      const info = calibrateWheels(wrap, rw);
      console.log('[L6] 轮径校准 →', info.wheelDiameter, 'm');
    } catch (e) { console.warn('轮子校准失败', e); }
  }

  // 应用当前 UI 选择
  applyPaint(currentPaint);
  applyInterior(currentInterior);
  applyLights(state.lights);
  applyXray(state.xray);

  document.body.classList.add('has-real');
  toast(`已载入真实模型 · ${label} · ${(countTris(group) / 1000).toFixed(0)}k 三角面`);
  flyTo(VIEWS.front45);
}

function loadReal(label) {
  Promise.all([
    new Promise((res, rej) => gltfLoader.load('./model.glb', res, undefined, rej)),
    new Promise(res => gltfLoader.load('./wheels.glb', res, undefined, () => res(null))),
  ]).then(([body, wheels]) => showReal(body, wheels, label || 'model.glb'))
    .catch(e => { console.warn('GLB 载入失败', e); toast('模型载入失败，用程序化车模顶着'); });
}

function loadGLBFromFile(file) {
  const r = new FileReader();
  r.onload = () => {
    gltfLoader.parse(r.result, './', g => {
      if (file.name.toLowerCase().includes('wheel')) {
        toast('这是轮子文件，请把车身 glb 拖进来');
        return;
      }
      showReal(g, null, file.name);
    }, e => { console.error(e); toast('这个文件解析不了，换一个试试'); });
  };
  r.readAsArrayBuffer(file);
}

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('on'), 4600);
}

loadReal('吉利银河L6（BeamNG mod）');

// 拖拽 / 选择文件
const dz = document.getElementById('dropzone');
['dragenter', 'dragover'].forEach(ev => addEventListener(ev, e => {
  e.preventDefault(); document.body.classList.add('dragging');
}));
['dragleave', 'drop'].forEach(ev => addEventListener(ev, e => {
  e.preventDefault();
  if (ev === 'drop' || (e.relatedTarget === null && ev === 'dragleave')) {
    document.body.classList.remove('dragging');
  }
}));
addEventListener('drop', e => {
  const f = e.dataTransfer?.files?.[0];
  if (f && /\.(glb|gltf)$/i.test(f.name)) loadGLBFromFile(f);
});
if (dz) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.glb,.gltf';
  inp.onchange = () => inp.files[0] && loadGLBFromFile(inp.files[0]);
  dz.onclick = () => inp.click();
}

/* ---------------- 加载遮罩 ---------------- */
requestAnimationFrame(() => {
  const l = document.getElementById('loader');
  if (l) { l.classList.add('done'); setTimeout(() => l.remove(), 700); }
});

/* ---------------- Sketchfab 懒加载 ---------------- */
document.querySelectorAll('[data-sf]').forEach(box => {
  const uid = box.dataset.sf;
  const btn = box.querySelector('button');
  btn.addEventListener('click', () => {
    const f = document.createElement('iframe');
    f.src = `https://sketchfab.com/models/${uid}/embed?autospin=0.35&autostart=1&ui_theme=dark&ui_infos=0`;
    f.allow = 'autoplay; fullscreen; xr-spatial-tracking';
    f.setAttribute('allowfullscreen', '');
    box.querySelector('.sf-frame').appendChild(f);
    box.classList.add('loaded');
  }, { once: true });
});

document.getElementById('specs').innerHTML = `
  <div class="sp"><b>4,782</b><span>车长 mm</span></div>
  <div class="sp"><b>1,875</b><span>车宽 mm</span></div>
  <div class="sp"><b>1,489</b><span>车高 mm</span></div>
  <div class="sp"><b>2,752</b><span>轴距 mm</span></div>
  <div class="sp"><b>275/40 R18</b><span>轮胎</span></div>
  <div class="sp"><b>0.26</b><span>风阻系数 Cd</span></div>
`;
