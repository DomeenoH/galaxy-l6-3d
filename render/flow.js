import * as THREE from 'three';

/* =========================================================
   气流 / 能量流线（SU7「风阻」章那套掠过车身的发光曲线）
   做法：在车前方撒一批起点，沿 +X 积分出一条绕过车身的流线
        （越靠近车身中心抬得越高、向外张得越开），
        再套一根细管 + 沿管长流动的加法发光条
   ========================================================= */

const VERT = /* glsl */`
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uOpacity;
uniform vec3  uColor;
uniform vec3  uColor2;
uniform float uSpeed;
uniform float uDensity;
uniform float uHead;
void main(){
  float m = fract(vUv.x * uDensity - uTime * uSpeed);
  // 亮头 + 线身都要有：只有亮头会变成一串「逗号」，只有线身会变成静止的丝
  float head = smoothstep(0.0, uHead, m) * (1.0 - smoothstep(uHead, uHead + 0.42, m));
  float body = 0.30 + 0.22 * sin(vUv.x * 3.14159);
  float fade = smoothstep(0.0, 0.07, vUv.x) * (1.0 - smoothstep(0.72, 1.0, vUv.x));
  float a = (head * 0.58 + body * 0.50) * fade * uOpacity;
  vec3 c = mix(uColor, uColor2, head);
  // 加法混合：峰值控制在 1.3 以内，否则整屏发白
  // 峰值压到 1.0 以内：加法混合 + Bloom 一叠就整屏发白
  gl_FragColor = vec4(c * (0.22 + head * 0.78), a);
}`;

export function makeFlowLines({
  // 注意方向：气流是「车头 → 车尾」。x0 是流线的起点（车头 +X），
  // 配合片元里的 `- uTime*uSpeed`，游走的亮头正好从车头掠向车尾。
  count = 36, x0 = 3.9, x1 = -3.9, seg = 34,
  height = 2.10, radius = 0.0055, seed = 7,
} = {}) {
  const rnd = mulberry(seed);
  const group = new THREE.Group();
  group.name = 'flow-lines';

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(0xa8cdf0) },
      uColor2: { value: new THREE.Color(0xffffff) },
      uSpeed: { value: 0.34 },
      uDensity: { value: 1.5 },
      uHead: { value: 0.075 },
    },
  });

  const geos = [];
  for (let i = 0; i < count; i++) {
    const y0 = 0.30 + Math.pow(rnd(), 0.85) * 1.05;      // 起点高度 0.30~1.35
    const z0 = (rnd() * 2 - 1) * 1.45;
    const sgn = z0 >= 0 ? 1 : -1;
    // 侧面的线要保证从车顶上方绕过（车顶 1.489m、半宽 0.9375m），
    // 否则会直接穿进车身 —— cl 的下限不能太低
    const cl = Math.max(0.62, 1 - Math.abs(z0) / 3.0);
    const pts = [];
    for (let s = 0; s <= seg; s++) {
      const t = s / seg;
      const x = x0 + (x1 - x0) * t;
      const bump = Math.exp(-Math.pow((t - 0.44) / 0.30, 2));
      const y = y0 + bump * (height - y0) * cl;
      const z = z0 * (1 + bump * 0.55);                  // 掠过车身时向外张开
      pts.push(new THREE.Vector3(x, y, z + sgn * 0.02));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(curve, seg * 3, radius, 4, false);
    geos.push(g);
    group.add(new THREE.Mesh(g, material));
  }

  group.userData.material = material;
  group.userData.dispose = () => { geos.forEach(g => g.dispose()); material.dispose(); };
  group.visible = false;
  return group;
}

function mulberry(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
