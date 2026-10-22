import * as THREE from 'three';

/* =========================================================
   吉利银河 L6 (2024) — 程序化建模
   坐标：+X 车头，+Y 向上，+Z 车身右侧。单位：米
   整车 4782 × 1875 × 1489，轴距 2752
   ========================================================= */

export const SPEC = {
  name: '吉利银河 L6',
  year: '2024 款',
  length: 4.782, width: 1.875, height: 1.489,
  wheelbase: 2.752,
  frontAxle: 1.470,
  rearAxle: -1.282,
  wheelR: 0.335,
  archR: 0.372,
};

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* 平滑 max，避免轮拱切口产生硬折 */
function smax(a, b, k) {
  const h = clamp(0.5 + 0.5 * (a - b) / k, 0, 1);
  return lerp(b, a, h) + k * h * (1 - h);
}

/* ---------- 车身控制截面关键帧 ---------- */
// x, yBot, ySill, yBelt, yTop, wMax, wBelt, wTop
const KEYS = [
  [-2.391, 0.352, 0.556, 0.905, 1.000, 0.8120, 0.784, 0.706],
  [-2.345, 0.292, 0.502, 0.920, 1.016, 0.8720, 0.840, 0.740],
  [-2.280, 0.238, 0.464, 0.940, 1.036, 0.8930, 0.863, 0.770],
  [-2.180, 0.210, 0.440, 0.964, 1.060, 0.9160, 0.888, 0.798],
  [-2.060, 0.200, 0.430, 0.982, 1.082, 0.9280, 0.900, 0.812],
  [-1.920, 0.196, 0.426, 0.992, 1.104, 0.9340, 0.905, 0.808],
  [-1.800, 0.194, 0.424, 0.998, 1.146, 0.9375, 0.908, 0.784],
  [-1.680, 0.194, 0.424, 1.003, 1.226, 0.9375, 0.910, 0.754],
  [-1.560, 0.194, 0.424, 1.007, 1.314, 0.9375, 0.910, 0.728],
  [-1.440, 0.194, 0.424, 1.010, 1.386, 0.9375, 0.908, 0.708],
  [-1.300, 0.194, 0.424, 1.011, 1.446, 0.9375, 0.905, 0.694],
  [-1.140, 0.194, 0.424, 1.012, 1.472, 0.9375, 0.903, 0.686],
  [-0.960, 0.194, 0.424, 1.013, 1.485, 0.9375, 0.903, 0.681],
  [-0.760, 0.194, 0.424, 1.014, 1.489, 0.9375, 0.903, 0.678],
  [-0.560, 0.194, 0.424, 1.014, 1.489, 0.9375, 0.903, 0.677],
  [-0.360, 0.194, 0.424, 1.014, 1.487, 0.9375, 0.903, 0.676],
  [-0.160, 0.194, 0.424, 1.014, 1.482, 0.9375, 0.903, 0.674],
  [0.040, 0.194, 0.424, 1.013, 1.474, 0.9375, 0.901, 0.670],
  [0.240, 0.196, 0.426, 1.012, 1.462, 0.9375, 0.900, 0.664],
  [0.440, 0.200, 0.430, 1.010, 1.444, 0.9375, 0.898, 0.656],
  [0.620, 0.206, 0.436, 1.008, 1.420, 0.9370, 0.895, 0.648],
  [0.780, 0.214, 0.444, 1.004, 1.386, 0.9345, 0.891, 0.638],
  [0.940, 0.224, 0.454, 0.999, 1.330, 0.9305, 0.885, 0.624],
  [1.100, 0.236, 0.466, 0.993, 1.262, 0.9250, 0.878, 0.608],
  [1.260, 0.248, 0.478, 0.986, 1.180, 0.9185, 0.870, 0.594],
  [1.420, 0.260, 0.490, 0.980, 1.098, 0.9110, 0.862, 0.616],
  [1.580, 0.270, 0.500, 0.972, 1.056, 0.9030, 0.856, 0.686],
  [1.780, 0.278, 0.510, 0.962, 1.032, 0.8950, 0.849, 0.718],
  [1.980, 0.284, 0.518, 0.952, 1.014, 0.8880, 0.842, 0.726],
  [2.150, 0.290, 0.528, 0.941, 0.998, 0.8800, 0.834, 0.720],
  [2.290, 0.298, 0.542, 0.928, 0.982, 0.8700, 0.824, 0.708],
  [2.360, 0.308, 0.560, 0.912, 0.962, 0.8480, 0.812, 0.694],
  [2.391, 0.334, 0.596, 0.900, 0.946, 0.8020, 0.772, 0.662],
];

const P_KEYS = ['yBot', 'ySill', 'yBelt', 'yTop', 'wMax', 'wBelt', 'wTop'];

/* 单调三次插值 */
function makeInterp(xs, ys) {
  const n = xs.length;
  const d = new Array(n - 1), m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = (d[i - 1] * d[i] <= 0) ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    const h = xs[hi] - xs[lo], t = (x - xs[lo]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * m[lo]
         + (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h * m[hi];
  };
}

const KX = KEYS.map(k => k[0]);
const F = {};
P_KEYS.forEach((name, i) => { F[name] = makeInterp(KX, KEYS.map(k => k[i + 1])); });

/* 玻璃区域 */
function glassModeAt(x) {
  if (x >= -1.700 && x <= -1.395) return 'top';   // 后风挡
  if (x > -1.395 && x < 0.800) return 'side';     // 侧窗
  if (x >= 0.800 && x <= 1.470) return 'top';     // 前风挡
  return null;
}

/* 轮拱缺口 */
function notchY(x) {
  let y = F.yBot(x);
  for (const ax of [SPEC.frontAxle, SPEC.rearAxle]) {
    const dx = x - ax;
    if (Math.abs(dx) < SPEC.archR) {
      const ay = SPEC.wheelR + Math.sqrt(SPEC.archR * SPEC.archR - dx * dx);
      y = smax(y, ay, 0.055);
    }
  }
  return y;
}

function stationAt(x) {
  const yBot = notchY(x);
  const ySill = smax(F.ySill(x), yBot + 0.085, 0.11);
  const yBelt = smax(F.yBelt(x), ySill + 0.075, 0.11);
  return {
    x, yBot, ySill, yBelt,
    yTop: F.yTop(x), wMax: F.wMax(x), wBelt: F.wBelt(x), wTop: F.wTop(x),
  };
}

/* 截面右半控制点（底中 → 顶中） */
function halfControl(s) {
  const w = s.wMax, wb = s.wBelt, wt = s.wTop;
  const yb = s.yBot, ys = s.ySill;
  const gY = s.yBelt + (s.yTop - s.yBelt) * 0.44;
  return [
    new THREE.Vector3(0, yb, 0),
    new THREE.Vector3(w * 0.70, yb + 0.005, 0),
    new THREE.Vector3(w * 0.960, lerp(yb, ys, 0.60), 0),
    new THREE.Vector3(w, ys, 0),
    new THREE.Vector3(wb, s.yBelt, 0),
    new THREE.Vector3(wb * 0.958, gY, 0),
    new THREE.Vector3(wt, s.yTop, 0),
    new THREE.Vector3(0, s.yTop + 0.003, 0),
  ];
}

const NSEG = 72;
const NST = 96;

function sectionCurve(s) {
  const h = halfControl(s);
  const pts = [];
  for (let i = 0; i < h.length; i++) pts.push(h[i].clone());
  for (let i = h.length - 2; i >= 1; i--) pts.push(new THREE.Vector3(-h[i].x, h[i].y, 0));
  return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
}

/* 车身某高度上的前后轮廓线（用于灯带贴合） */
function heightContour(yTarget, xFrom, xTo, sign, zMax = 9) {
  const out = [];
  const steps = 110;
  for (let k = 0; k <= steps; k++) {
    const x = lerp(xFrom, xTo, k / steps);
    const pts = sectionCurve(stationAt(x)).getPoints(180);
    let best = null, bd = 1e9;
    for (const p of pts) {
      if (sign * p.x <= 0.03) continue;
      const d = Math.abs(p.y - yTarget);
      if (d < bd) { bd = d; best = p; }
    }
    if (best && bd < 0.012 && Math.abs(best.x) <= zMax) {
      out.push(new THREE.Vector3(x, best.y, sign * best.x));
    }
  }
  return out;
}

/* 竖直分缝线（门缝） */
function verticalSeam(x, sign, yFrom, yTo) {
  const s = stationAt(x);
  return sectionCurve(s).getPoints(240)
    .filter(p => sign * p.x > 0.10 && p.y > yFrom && p.y < yTo)
    .map(p => new THREE.Vector3(x, p.y, sign * p.x * 1.004))
    .sort((a, b) => a.y - b.y);
}

/* 顶部肩线（发动机盖 / 行李箱盖侧缝） */
function shoulderSeam(xFrom, xTo, sign, offset = 1.004) {
  const pts = [];
  const n = Math.max(2, Math.round(Math.abs(xTo - xFrom) / 0.07));
  for (let k = 0; k <= n; k++) {
    const x = lerp(xFrom, xTo, k / n);
    const h = halfControl(stationAt(x));
    pts.push(new THREE.Vector3(x, h[6].y, sign * h[6].x * offset));
  }
  return pts;
}

/* =========================================================
   材质
   ========================================================= */
export function createMaterials() {
  const M = {};
  M.paint = new THREE.MeshPhysicalMaterial({
    color: 0xf2f4f7, metalness: 0.60, roughness: 0.24,
    clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.3,
  });
  M.glass = new THREE.MeshPhysicalMaterial({
    color: 0x0a0f16, metalness: 0.0, roughness: 0.04,
    transparent: true, opacity: 0.66, envMapIntensity: 2.4,
    side: THREE.DoubleSide, depthWrite: false,
  });
  M.dark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5, metalness: 0.4 });
  M.darkMatte = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.88, metalness: 0.05 });
  M.chrome = new THREE.MeshStandardMaterial({ color: 0xe2e7ee, roughness: 0.10, metalness: 1.0, envMapIntensity: 1.7 });
  M.tire = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.93, metalness: 0.02 });
  M.rim = new THREE.MeshStandardMaterial({ color: 0xbcc2cb, roughness: 0.20, metalness: 1.0, envMapIntensity: 1.5 });
  M.rimDark = new THREE.MeshStandardMaterial({ color: 0x272a30, roughness: 0.42, metalness: 0.9 });
  M.disc = new THREE.MeshStandardMaterial({ color: 0x4e5259, roughness: 0.5, metalness: 0.9 });
  M.headGlass = new THREE.MeshPhysicalMaterial({
    color: 0xdde8f6, roughness: 0.05, metalness: 0.0,
    transparent: true, opacity: 0.40, envMapIntensity: 2.6, side: THREE.DoubleSide,
  });
  M.led = new THREE.MeshStandardMaterial({ color: 0xd6dbe2, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.18, metalness: 0.25 });
  M.tail = new THREE.MeshStandardMaterial({ color: 0x4a0b0e, emissive: 0xff0d0d, emissiveIntensity: 0, roughness: 0.16, metalness: 0.2 });

  M.seatLeather = new THREE.MeshStandardMaterial({ color: 0x7c4a28, roughness: 0.66, metalness: 0.02 });
  M.seatLeatherDark = new THREE.MeshStandardMaterial({ color: 0x5a3317, roughness: 0.72, metalness: 0.02 });
  M.intTrim = new THREE.MeshStandardMaterial({ color: 0x2b2723, roughness: 0.55, metalness: 0.15 });
  M.intPlastic = new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.74, metalness: 0.05 });
  M.screen = new THREE.MeshStandardMaterial({
    color: 0x0a0d12, roughness: 0.14, metalness: 0.4,
    emissive: 0x14304a, emissiveIntensity: 0.6,
  });
  M.alu = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.3, metalness: 1.0 });
  return M;
}

/* =========================================================
   车身壳体
   ========================================================= */
function buildBody(M) {
  const stations = [];
  for (let i = 0; i < NST; i++) stations.push(stationAt(lerp(-2.391, 2.391, i / (NST - 1))));
  const sections = stations.map(s => sectionCurve(s).getPoints(NSEG).slice(0, NSEG));
  const N = NSEG;

  const pos = [];
  for (let i = 0; i < NST; i++) {
    const x = stations[i].x;
    for (let j = 0; j < N; j++) pos.push(x, sections[i][j].y, sections[i][j].x);
  }

  const buckets = { paint: [], glass: [], dark: [] };
  const idx = (i, j) => i * N + (j % N);
  const PY = (i, j) => pos[idx(i, j) * 3 + 1];
  const PZ = (i, j) => pos[idx(i, j) * 3 + 2];

  for (let i = 0; i < NST - 1; i++) {
    const sA = stations[i], sB = stations[i + 1];
    const belt = (sA.yBelt + sB.yBelt) / 2;
    const top = (sA.yTop + sB.yTop) / 2;
    const wb = (sA.wBelt + sB.wBelt) / 2;
    const mode = glassModeAt((sA.x + sB.x) / 2);
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      const a = idx(i, j), b = idx(i, j2), c = idx(i + 1, j2), d = idx(i + 1, j);
      const ay = (PY(i, j) + PY(i, j2) + PY(i + 1, j) + PY(i + 1, j2)) / 4;
      const az = Math.abs(PZ(i, j) + PZ(i, j2) + PZ(i + 1, j) + PZ(i + 1, j2)) / 4;
      let mat = 'paint';
      if (mode && ay > belt + 0.035) {
        if (mode === 'top') mat = (az < wb * 0.900) ? 'glass' : 'paint';
        else mat = (ay < top - 0.060 && az > wb * 0.62) ? 'glass' : 'paint';
      } else if (ay < 0.300 && az > wb * 0.35) {
        mat = 'dark';
      }
      buckets[mat].push(a, c, b, a, d, c);
    }
  }

  const capFan = (i, flip) => {
    const cx = stations[i].x;
    let cy = 0, cz = 0;
    for (let j = 0; j < N; j++) { cy += PY(i, j); cz += PZ(i, j); }
    cy /= N; cz /= N;
    const ci = pos.length / 3;
    pos.push(cx, cy, cz);
    for (let j = 0; j < N; j++) {
      const a = idx(i, j), b = idx(i, (j + 1) % N);
      if (flip) buckets.paint.push(ci, b, a); else buckets.paint.push(ci, a, b);
    }
  };
  capFan(0, true);
  capFan(NST - 1, false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const order = [];
  let off = 0;
  ['paint', 'glass', 'dark'].forEach((key, mi) => {
    const arr = buckets[key];
    for (const v of arr) order.push(v);
    geo.addGroup(off, arr.length, mi);
    off += arr.length;
  });
  geo.setIndex(order);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, [M.paint, M.glass, M.dark]);
  mesh.castShadow = true;
  mesh.name = 'body';
  return mesh;
}

/* =========================================================
   轮拱内衬
   ========================================================= */
function buildArchLiners(M) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x090a0c, roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
  for (const ax of [SPEC.frontAxle, SPEC.rearAxle]) {
    const r = SPEC.archR - 0.014;
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.86, 30, 1, true, 0, Math.PI), mat);
    shell.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    shell.position.set(ax, SPEC.wheelR, 0);
    shell.receiveShadow = true;
    g.add(shell);
    const cap = new THREE.Mesh(new THREE.PlaneGeometry(1.86, r), mat);
    cap.rotation.x = -Math.PI / 2;
    cap.position.set(ax, SPEC.wheelR, 0);
    g.add(cap);
  }
  return g;
}

/* =========================================================
   车轮
   ========================================================= */
function buildWheel(M, mirror) {
  const g = new THREE.Group();
  const R = SPEC.wheelR;

  const tp = [[0.232, -0.118], [0.288, -0.121], [0.325, -0.100], [R, -0.052],
              [R, 0.052], [0.325, 0.100], [0.288, 0.121], [0.232, 0.118]]
    .map(p => new THREE.Vector2(p[0], p[1]));
  const tire = new THREE.Mesh(new THREE.LatheGeometry(tp, 60), M.tire);
  tire.rotation.x = Math.PI / 2;
  tire.castShadow = true;
  g.add(tire);

  const rimOuter = new THREE.Mesh(new THREE.CylinderGeometry(0.234, 0.234, 0.205, 52, 1, true), M.rim);
  rimOuter.rotation.x = Math.PI / 2;
  g.add(rimOuter);

  const faceZ = 0.086;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.05, 24), M.rim);
  hub.rotation.x = Math.PI / 2; hub.position.z = faceZ; g.add(hub);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.018, 20), M.rimDark);
  cap.rotation.x = Math.PI / 2; cap.position.z = faceZ + 0.028; g.add(cap);

  const spoke = new THREE.BoxGeometry(0.205, 0.032, 0.042);
  const spoke2 = new THREE.BoxGeometry(0.195, 0.020, 0.026);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2, rr = 0.132;
    const s1 = new THREE.Mesh(spoke, M.rim);
    s1.position.set(Math.cos(a) * rr, Math.sin(a) * rr, faceZ); s1.rotation.z = a; g.add(s1);
    const s2 = new THREE.Mesh(spoke2, M.rimDark);
    s2.position.set(Math.cos(a) * rr, Math.sin(a) * rr, faceZ - 0.028); s2.rotation.z = a; g.add(s2);
  }

  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.170, 0.170, 0.022, 40), M.disc);
  disc.rotation.x = Math.PI / 2; g.add(disc);
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.128, 0.05), M.rimDark);
  caliper.position.set(-0.098, 0.098, 0); g.add(caliper);

  g.rotation.y = Math.PI / 2;
  if (mirror) g.scale.z = -1;
  return g;
}

/* =========================================================
   内饰
   ========================================================= */
function buildInterior(M) {
  const g = new THREE.Group();
  g.name = 'interior';
  const box = (w, h, d, mat, x, y, z, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.z = rz;
    m.castShadow = true; m.receiveShadow = true;
    g.add(m); return m;
  };

  box(4.00, 0.05, 1.60, M.intPlastic, -0.15, 0.395, 0);

  // 仪表台
  box(0.60, 0.19, 1.62, M.intTrim, 0.96, 0.79, 0);
  box(0.34, 0.30, 1.62, M.intPlastic, 1.19, 0.64, 0);
  const scr = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.20, 0.66), M.screen);
  scr.position.set(0.68, 0.965, 0); scr.rotation.z = 0.30; g.add(scr);
  const scr2 = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.15, 0.32), M.screen);
  scr2.position.set(0.72, 0.955, -0.46); scr2.rotation.z = 0.30; g.add(scr2);

  // 中央通道
  box(0.90, 0.22, 0.30, M.intTrim, 0.28, 0.545, 0);
  box(0.28, 0.045, 0.16, M.intPlastic, 0.00, 0.663, 0);

  // 方向盘
  const sw = new THREE.Group();
  sw.add(new THREE.Mesh(new THREE.TorusGeometry(0.172, 0.021, 12, 36), M.intTrim));
  for (let k = 0; k < 3; k++) {
    const ang = k * 2.094 + 1.047;
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.026, 0.018), M.intTrim);
    sp.position.set(Math.cos(ang) * 0.082, Math.sin(ang) * 0.082, 0);
    sp.rotation.z = ang; sw.add(sp);
  }
  const swHub = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.028, 16), M.intPlastic);
  swHub.rotation.x = Math.PI / 2; sw.add(swHub);
  sw.position.set(0.62, 0.885, -0.352);
  sw.rotation.set(0, Math.PI / 2, 0, 'YZX'); sw.rotation.z = -0.42;
  g.add(sw);

  // 座椅
  const seat = (x, z) => {
    const s = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.115, 0.46), M.seatLeather);
    base.position.set(0, 0.585, 0); s.add(base);
    const cush = new THREE.Mesh(new THREE.BoxGeometry(0.455, 0.055, 0.42), M.seatLeatherDark);
    cush.position.set(0.012, 0.655, 0); s.add(cush);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.60, 0.46), M.seatLeather);
    back.position.set(-0.19, 0.915, 0); back.rotation.z = 0.17; s.add(back);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.42, 0.33), M.seatLeatherDark);
    pad.position.set(-0.122, 0.935, 0); pad.rotation.z = 0.17; s.add(pad);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.15, 0.235), M.seatLeather);
    head.position.set(-0.255, 1.262, 0); s.add(head);
    s.position.set(x, 0, z);
    s.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.add(s);
  };
  seat(0.30, -0.345);
  seat(0.30, 0.345);

  // 后排
  const rBase = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.13, 1.34), M.seatLeather);
  rBase.position.set(-1.02, 0.59, 0); g.add(rBase);
  const rBack = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 1.32), M.seatLeather);
  rBack.position.set(-1.31, 0.885, 0); rBack.rotation.z = 0.19; g.add(rBack);
  for (const zz of [-0.43, 0, 0.43]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, 0.21), M.seatLeather);
    h.position.set(-1.41, 1.168, zz); g.add(h);
  }

  // 门内板
  for (const sgn of [-1, 1]) {
    box(1.30, 0.34, 0.05, M.intTrim, 0.22, 0.715, sgn * 0.858);
    box(1.02, 0.22, 0.04, M.intTrim, -1.00, 0.715, sgn * 0.858);
    box(0.28, 0.05, 0.06, M.alu, 0.30, 0.895, sgn * 0.845);
  }

  // 后隔板
  box(0.35, 0.30, 1.34, M.intTrim, -1.71, 0.85, 0);

  // 顶棚
  const head = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.028, 1.30), M.intTrim);
  head.position.set(-0.30, 1.432, 0);
  g.add(head);
  // A 柱内饰
  for (const sgn of [-1, 1]) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.055, 0.075), M.intTrim);
    a.position.set(1.05, 1.235, sgn * 0.735);
    a.rotation.z = -0.62;
    g.add(a);
  }

  g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  return g;
}

/* =========================================================
   外部细节
   ========================================================= */
function tube(pts, radius, mat, closed = false) {
  const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.4);
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.max(30, pts.length * 5), radius, 10, closed), mat);
}

function buildDetails(M) {
  const g = new THREE.Group();
  g.name = 'details';

  const bar = (x, y, zHalf, r, mat, bulge = 0.012) => {
    const pts = [];
    const n = 22;
    for (let k = 0; k <= n; k++) {
      const z = lerp(-zHalf, zHalf, k / n);
      const t = Math.abs(z) / zHalf;
      pts.push(new THREE.Vector3(x - Math.sign(x) * bulge * t * t, y, z));
    }
    return tube(pts, r, mat);
  };

  /* ---- 前脸：贯穿灯带 ---- */
  g.add(bar(2.397, 0.900, 0.700, 0.017, M.led));

  /* 前大灯（灯带两端的灯组） */
  for (const sgn of [-1, 1]) {
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.5, 22, 16), M.headGlass);
    lens.scale.set(0.20, 0.115, 0.20);
    lens.position.set(2.372, 0.862, sgn * 0.612);
    lens.rotation.z = -0.22;
    g.add(lens);
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.085, 0.20), M.led);
    core.position.set(2.386, 0.862, sgn * 0.612);
    g.add(core);
  }

  /* 前保险杠竖向日行灯 */
  for (const sgn of [-1, 1]) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.170, 0.030), M.led);
    v.position.set(2.392, 0.618, sgn * 0.640);
    g.add(v);
  }

  /* 前脸封闭格栅（暗色饰板） */
  const grill = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.105, 1.02), M.dark);
  grill.position.set(2.382, 0.760, 0);
  g.add(grill);
  /* 下进气口 */
  const intake = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.115, 0.94), M.darkMatte);
  intake.position.set(2.386, 0.470, 0);
  g.add(intake);
  /* 前唇 */
  const lip = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.030, 1.24), M.darkMatte);
  lip.position.set(2.262, 0.318, 0);
  g.add(lip);

  /* 车标 */
  const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.014, 6), M.chrome);
  badge.rotation.set(Math.PI / 2, 0, 0);
  badge.position.set(2.396, 0.845, 0);
  g.add(badge);

  /* ---- 尾部：贯穿尾灯 ---- */
  g.add(bar(-2.396, 0.882, 0.690, 0.017, M.tail, 0.014));
  for (const sgn of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.10, 0.16), M.tail);
    t.position.set(-2.378, 0.878, sgn * 0.618);
    g.add(t);
  }

  /* 后包围 / 扩散器 */
  const diff = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 1.02), M.darkMatte);
  diff.position.set(-2.370, 0.418, 0);
  g.add(diff);
  const rearLip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.028, 1.20), M.darkMatte);
  rearLip.position.set(-2.320, 0.318, 0);
  g.add(rearLip);

  /* 侧裙 */
  for (const sgn of [-1, 1]) {
    const rocker = new THREE.Mesh(new THREE.BoxGeometry(2.00, 0.065, 0.05), M.darkMatte);
    rocker.position.set(-0.05, 0.262, sgn * 0.905);
    g.add(rocker);
  }

  /* 后视镜 */
  for (const sgn of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.030, 0.10), M.dark);
    arm.position.set(0.815, 1.056, sgn * 0.928);
    g.add(arm);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.075, 0.10), M.paint);
    shell.position.set(0.778, 1.076, sgn * 0.995);
    shell.rotation.y = sgn * 0.14;
    g.add(shell);
    const gl = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.064, 0.078), M.dark);
    gl.position.set(0.712, 1.076, sgn * 0.995);
    g.add(gl);
  }

  /* B 柱黑饰条 */
  for (const sgn of [-1, 1]) {
    const s = stationAt(-0.28);
    const h = halfControl(s);
    const pts = [h[4], h[5], h[6]].map(p => new THREE.Vector3(s.x, p.y, sgn * p.x * 1.006));
    g.add(tube(pts, 0.032, M.darkMatte));
  }

  /* 腰线饰条 */
  for (const sgn of [-1, 1]) {
    const pts = [];
    for (let x = -1.72; x <= 1.44; x += 0.08) {
      const s = stationAt(x);
      pts.push(new THREE.Vector3(x, s.yBelt - 0.012, sgn * (s.wBelt * 1.004)));
    }
    g.add(tube(pts, 0.009, M.darkMatte));
  }

  /* 门缝 / 机盖缝 / 尾盖缝 */
  const seam = M.darkMatte;
  for (const sgn of [-1, 1]) {
    for (const dx of [0.620, -0.300, -1.190]) {
      const s = stationAt(dx);
      const pts = verticalSeam(dx, sgn, s.yBot + 0.075, s.yBelt - 0.018);
      if (pts.length > 4) g.add(tube(pts, 0.0075, seam));
    }
    const hood = shoulderSeam(1.560, 2.330, sgn);
    if (hood.length > 3) g.add(tube(hood, 0.0075, seam));
    const deck = shoulderSeam(-2.320, -1.880, sgn);
    if (deck.length > 3) g.add(tube(deck, 0.0075, seam));
  }

  /* 门把手（隐藏式） */
  for (const sgn of [-1, 1]) {
    for (const px of [0.34, -0.70]) {
      const hd = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.028, 0.012), M.chrome);
      hd.position.set(px, 0.975, sgn * 0.930);
      g.add(hd);
    }
  }

  /* 鲨鱼鳍 */
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.045, 0.042), M.dark);
  fin.position.set(-1.30, 1.462, 0);
  fin.rotation.z = -0.32;
  g.add(fin);

  /* 鸭尾 */
  const duck = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.028, 1.44), M.paint);
  duck.position.set(-1.955, 1.112, 0);
  duck.rotation.z = 0.10;
  g.add(duck);

  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/* =========================================================
   组装
   ========================================================= */
export function createCar(M) {
  const car = new THREE.Group();
  car.name = 'L6';

  const body = buildBody(M);
  car.add(body);
  car.add(buildArchLiners(M));

  const interior = buildInterior(M);
  car.add(interior);

  const details = buildDetails(M);
  car.add(details);

  const wheels = [];
  for (const [ax, mir] of [[SPEC.frontAxle, false], [SPEC.frontAxle, true],
                           [SPEC.rearAxle, false], [SPEC.rearAxle, true]]) {
    const w = buildWheel(M, mir);
    w.position.set(ax, SPEC.wheelR, mir ? -0.792 : 0.792);
    car.add(w);
    wheels.push(w);
  }
  return { car, body, interior, details, wheels, materials: M };
}

/* =========================================================
   对外接口
   ========================================================= */
export function setPaint(M, hex, metal = 0.60, rough = 0.24) {
  M.paint.color.set(hex); M.paint.metalness = metal; M.paint.roughness = rough;
}
export function setInterior(M, hex, dark, trim) {
  M.seatLeather.color.set(hex); M.seatLeatherDark.color.set(dark); M.intTrim.color.set(trim);
}
export function setLights(M, on) {
  M.led.emissiveIntensity = on ? 3.2 : 0.0;
  M.tail.emissiveIntensity = on ? 2.6 : 0.0;
  M.headGlass.opacity = on ? 0.55 : 0.40;
}
export function setBodyOpacity(M, op) {
  const solid = op >= 0.99;
  M.paint.transparent = !solid;
  M.paint.opacity = op;
  M.paint.depthWrite = solid;
  M.dark.transparent = !solid;
  M.dark.opacity = solid ? 1 : Math.max(op * 1.6, 0.18);
  M.glass.opacity = solid ? 0.66 : Math.min(0.66, op * 1.2 + 0.06);
}
