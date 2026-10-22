import * as THREE from 'three';

/* =========================================================
   真实模型（BeamNG 吉利银河 L6 mod → GLB）材质重建
   GLB 导出时丢了贴图，这里按材质名把源包里的 UV 图集接回去
   ========================================================= */

export const MAT_MAP = {
  'gsrgalal6': 'paint',
  'gsrgalal6_silver_matt': 'silver',
  'mirror': 'silver',
  'gsrgalal6_chrome': 'chrome',
  'gsrgalal6_plastic': 'plastic',
  'gsrgalal6_plastic.001': 'plastic',
  'gsrgalal6_black_gloss': 'blackGloss',
  'gsrgalal6_tire': 'tire',
  'gsrgalal6_interior': 'interior',
  'gsrgalal6_interior2': 'interior2',
  'gsrgalal6_seat': 'seat',
  'gsrgalal6_carpet': 'carpet',
  'gsrgalal6_roofint': 'roofint',
  'gsrgalal6_details': 'details',
  'gsrgalal6_windowglass': 'glass',
  'gsrgalal6_clearglass': 'glassClear',
  'gsrgalal6_windowglass_dark': 'glassDark',
  'gsrgalal6_headlights': 'headlight',
  'gsrgalal6_drl': 'led',
  'gsrgalal6_drl_L1': 'led',
  'gsrgalal6_drl_L2': 'led',
  'gsrgalal6_drl_R1': 'led',
  'gsrgalal6_drl_R2': 'led',
  'gsrgalal6_taillights': 'taillight',
  'gsrgalal6_brakelights': 'taillight',
  'gsrgalal6_red': 'caliper',
  'gsrgalal6_signal_L': 'signal',
  'gsrgalal6_signal_R': 'signal',
  'gsrgalal6_screen': 'screen',
};

/* 内饰件：受「棕 / 黑 / 米白」配色控制 */
export const INTERIOR_KEYS = ['interior', 'interior2', 'seat', 'carpet', 'roofint', 'details'];

export const INTERIOR_PRESETS = {
  brown: { label: '棕', tint: 0x9a6438, trim: 0x5a3a20 },
  black: { label: '黑', tint: 0x4a4a50, trim: 0x26262a },
  cream: { label: '米白', tint: 0xd9cfbe, trim: 0xb3a692 },
};

export function buildRealMaterials() {
  const tl = new THREE.TextureLoader();
  const tex = (file, srgb = true, rep) => {
    const t = tl.load('./textures/' + file);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (rep) t.repeat.set(rep[0], rep[1]);
    return t;
  };

  const M = {};

  /* 车漆：可切换颜色。
     ⚠️ metalness 必须低（0.05~0.15）。真车漆是「介质漆 + 清漆」，
     metalness 给到 0.5 会让车身变成「白色金属镜」——环境反射被基色染白，
     整台车就是一片均匀的亮灰，没有明暗层次，也就是所谓的「白模 / 塑料感」。
     光泽交给 clearcoat，颜色交给 diffuse 基色。

     ⚠️⚠️ roughness 是「贵 / 廉价」的第二个开关，和 metalness 一样重要。
     参考站 SU7 的车门上能**看清柔光箱的形状**（一条从车头斜向车尾的亮带）——
     那是镜面反射，不是漫反射。我们原来给 0.24，环境贴图被糊成一片均匀灰白，
     车身就「平」了；降到 0.14 + clearcoatRoughness 0.02 之后反射重新成形。
     注意别过 0.10：清漆反射会开始出现环境贴图的像素块（影棚柔光箱的边角）。 */
  M.paint = new THREE.MeshPhysicalMaterial({
    color: 0xeff2f7, metalness: 0.08, roughness: 0.14,
    clearcoat: 1.0, clearcoatRoughness: 0.015, envMapIntensity: 1.45,
  });
  /* 照搬 SU7 那招：粗糙度越高，环境反射越强。
     标准 PBR 里 roughness 变大 = 反射变糊 + 变暗，漆面会「发灰发哑」；
     这里在 getIBLRadiance 的返回值上乘一个粗糙度增益，漆面就一直是「亮」的。
     ⚠️ 增益系数要跟着 roughness 一起调：roughness 从 0.24 降到 0.14 后，
     同样的 1.0 增益会让反射整体暗掉 10%，所以这里提到 2.0。
     （vendor 里 `return envMapColor.rgb * envMapIntensity;` 全局只出现 1 次）

     ⬆⬆ 2026-10-22 质感升级：在保留上面那条 roughness 增益的前提下，再叠一个
     **菲涅尔边缘增亮**。症状：白车身中段一片均匀灰，只有「平光」没有「边缘」——
     型面转折（肩线、轮眉、A/C 柱、引擎盖棱线）本该因掠射角吃到更强的清漆反射
     而发亮，原来只有 roughness 增益是**各向同性**的，边缘和中段一样亮 → 车「扁」。

     ⚠️⚠️ 第一版踩的坑（别再犯）：把 fresnel 乘进 getIBLRadiance() 的 return，
     用了 vViewPosition / vNormal —— 它俩是**主片元的 varying**，不在
     getIBLRadiance 这个**独立函数**的作用域里 → 引用未定义变量 → shader
     编译失败 → paint 材质回退 → **整台车变黑**。
     正解：两处注入分开做——
       1) roughness 增益仍改 getIBLRadiance 的 return（原样保留，别动）；
       2) fresnel 放到主片元的 `#include <lights_fragment_end>` 之后，那里
          three r169 保证有 geometryNormal（含法线贴图）和 geometryViewDir。
     ⚠️ 强度克制（0.9）：过大白车边缘会烧成纯白光圈（比没有更假）。 */
  M.paint.onBeforeCompile = shader => {
    shader.uniforms.uFresnel = { value: 0.9 };
    // ⚠️ onBeforeCompile 加的新 uniform，three **不会**自动声明进 GLSL——
    //    必须手动在片元源码顶部补 `uniform float uFresnel;`，否则报
    //    `'uFresnel' : undeclared identifier`，shader 编译失败、车漆变黑。
    shader.fragmentShader = 'uniform float uFresnel;\n' + shader.fragmentShader;
    // 1) roughness 增益（原始那行，原样保留）
    shader.fragmentShader = shader.fragmentShader.replace(
      'return envMapColor.rgb * envMapIntensity;',
      'return envMapColor.rgb * envMapIntensity * ( 1.0 + roughness * 2.0 );'
    );
    // 2) 菲涅尔边缘光（在主片元作用域内，用 geometryNormal + geometryViewDir）
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
       {
         float _fr = pow( clamp( 1.0 - dot( geometryNormal, geometryViewDir ), 0.0, 1.0 ), 5.0 );
         reflectedLight.indirectSpecular *= ( 1.0 + _fr * uFresnel );
       }`
    );
  };

  /* 轮胎。⚠️ 必须「真黑」。
     参考站的车之所以看着贵，很大一部分是轮胎/轮拱/下裙这几块死黑把车身「垫」起来了。
     给 0x2a2a2c 这种中灰，整车立刻变成白模 —— 这一条比任何后处理都管用。 */
  M.tire = new THREE.MeshStandardMaterial({
    color: 0x0e0e11, map: tex('tire.jpg'), roughness: 0.95, metalness: 0.0,
    envMapIntensity: 0.55,
  });
  M.tire.normalMap = tex('tire_n.jpg', false);
  M.tire.normalScale = new THREE.Vector2(1.0, 1.0);

  /* 内饰（贴图 × 色调） */
  const mk = (file, rough, metal = 0.02) => new THREE.MeshStandardMaterial({
    map: tex(file), color: 0xffffff, roughness: rough, metalness: metal,
  });
  M.interior = mk('interior.jpg', 0.68);
  M.interior2 = mk('interior2.jpg', 0.72);
  M.seat = mk('seat.jpg', 0.62);
  M.carpet = mk('carpet.jpg', 0.92, 0.0);
  M.roofint = mk('roofint.jpg', 0.88, 0.0);
  M.details = mk('details.jpg', 0.42, 0.15);
  /* ⚠️ 这里曾经给 details 加 polygonOffset 想消掉车身缝上的点状虚线 —— **完全无效**。
     真正的原因是「门与门框之间的 1~2mm 几何缝被亚像素光栅化成断续白点」，
     缝不是 details 画的（关掉 details 整组，缝原样还在）。
     正解见 assemble.js 的 buildBodyLiner()：在车身内侧 1.4cm 放一层纯黑内衬。
     polygonOffset 在这里还有个经典失效场景：门与门框**共用同一个材质实例**，
     给材质加偏移等于两边一起推，相对关系不变。 */

  /* 外饰。
     轮辋（silver_matt）别做成亮铬：0.92 金属度 + 0.28 粗糙度在暗棚里会变成
     一块「镜面塑料」，塑料感极强。参考站的轮辋是哑光银，暗部占大头。 */
  M.silver = new THREE.MeshStandardMaterial({ color: 0xb6bcc5, metalness: 0.70, roughness: 0.34, envMapIntensity: 1.55 });
  M.chrome = new THREE.MeshStandardMaterial({ color: 0xd6dbe2, metalness: 1.0, roughness: 0.15, envMapIntensity: 1.45 });
  M.plastic = new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 0.78, metalness: 0.06 });
  M.blackGloss = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.14, metalness: 0.5, envMapIntensity: 1.35 });

  /* 玻璃。参考站的车窗是接近纯黑的 —— 舱内看不见，只反一点点天光。
     ⚠️⚠️ 这是「廉价感」的第二大来源（第一是顶部光板形状）：
     玻璃只要透，橙色内饰就会整片露出来，整车立刻从「车」变成「玩具」。
     参考站实测：侧窗基本读不出内饰，只剩座椅一个很暗的轮廓。
     另注意：玻璃是 DoubleSide + transparent —— 一块侧窗会**穿两层**
     （近侧 + 远侧），所以单层 opacity 0.42 实际等效只有 0.34，必须往上提。
     反射率反而要给高（envMapIntensity 1.9）：深色 + 强反射 = 玻璃；
     深色 + 弱反射 = 一块黑塑料。 */
  M.glass = new THREE.MeshPhysicalMaterial({
    color: 0x05080d, roughness: 0.045, metalness: 0.0,
    transparent: true, opacity: 0.93, envMapIntensity: 1.60, side: THREE.DoubleSide,
  });
  M.glassClear = new THREE.MeshPhysicalMaterial({
    color: 0x5a6673, roughness: 0.04, metalness: 0.0,
    transparent: true, opacity: 0.82, envMapIntensity: 1.70, side: THREE.DoubleSide,
  });
  /* 全景天幕（glassDark 只有 1 个网格，就是那块大玻璃顶）。
     ⚠️⚠️ 俯视章（第 4 章）最容易露馅：天幕如果只是「一块黑」，
     从上往下看车顶就是一个纯黑的洞，整车像被挖空了。
     参考站俯视时车顶是**深灰带渐变**的 —— 那是天幕在反射天花板柔光箱。
     要出这个反射必须满足两条：
       1) metalness 必须低。给 0.35 会把反射用近黑基色染掉 → 反射变成黑，
          等于没有反射（这是原来「车顶纯黑洞」的直接原因）。
       2) 反射率交给 clearcoat，和车漆同一套路。
     envMapIntensity 也要给足，否则暗棚里反射不出来。 */
  M.glassDark = new THREE.MeshPhysicalMaterial({
    color: 0x05070b, roughness: 0.06, metalness: 0.0,
    transparent: true, opacity: 0.96, envMapIntensity: 1.55,
    clearcoat: 1.0, clearcoatRoughness: 0.03,
  });

  /* 灯具 */
  M.headlight = new THREE.MeshPhysicalMaterial({
    color: 0xc9d8ea, roughness: 0.05, metalness: 0.0,
    transparent: true, opacity: 0.30, envMapIntensity: 1.8, side: THREE.DoubleSide,
  });
  /* ⚠️ emissive 用「冷白偏蓝」而不是纯白：真车 DRL 是 ~6500K 冷光，纯白 0xffffff
     过辉光后会糊成一团没有色温。点亮强度见 setRealLights()，要冲过 post 的
     bloom threshold（第3章 thr=1.24）才会在灯带外缘拉出光晕。 */
  M.led = new THREE.MeshStandardMaterial({ color: 0xdfe6f0, emissive: 0xcfe2ff, emissiveIntensity: 0, roughness: 0.18, metalness: 0.3 });
  M.taillight = new THREE.MeshStandardMaterial({ color: 0x4a0b0e, emissive: 0xff1418, emissiveIntensity: 0, roughness: 0.16, metalness: 0.25 });
  M.signal = new THREE.MeshStandardMaterial({ color: 0x6a5410, emissive: 0xffb020, emissiveIntensity: 0, roughness: 0.2 });
  M.caliper = new THREE.MeshStandardMaterial({ color: 0xb3111a, roughness: 0.4, metalness: 0.4 });
  M.screen = new THREE.MeshStandardMaterial({
    color: 0x0a0d12, emissive: 0x1b3a58, emissiveIntensity: 0.75, roughness: 0.14, metalness: 0.35,
  });

  // 给重建材质带上 key 当名字。GLB 里的材质名在替换后就丢了，
  // 没有名字的话调试时（控制台 / Playwright）根本没法按材质分组开关网格。
  for (const k of Object.keys(M)) if (M[k] && !M[k].name) M[k].name = k;

  return M;
}

/* 把真实模型上的材质换成重建版 */
export function applyRealMaterials(root, M) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const swap = m => (m && MAT_MAP[m.name]) ? M[MAT_MAP[m.name]] : m;
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
}

/* 内饰配色 */
export function setRealInterior(M, key) {
  const p = INTERIOR_PRESETS[key];
  if (!p) return;
  const main = ['interior', 'interior2', 'seat', 'roofint', 'details'];
  main.forEach(k => M[k] && M[k].color.set(p.tint));
  M.carpet.color.set(p.trim);
  M.seat.color.set(p.tint);
  M.details.color.set(0xffffff);   // 细节图集保持原色（屏幕/按键）
}

export function setRealPaint(M, hex, metal, rough) {
  M.paint.color.set(hex);
  if (metal !== undefined) M.paint.metalness = metal;
  if (rough !== undefined) M.paint.roughness = rough;
}

export function setRealLights(M, on) {
  /* ⚠️ 2026-10-22：原来 DRL 3.2 / 尾灯 2.6 在第3章（bloom thr 1.24）外缘几乎
     不起辉光，灯「亮着却看不出」。emissive 走的是线性 HDR，要把灯芯顶到
     threshold 的数倍才会在 bright-pass 里被提取出来、再 5 级模糊成光晕。
     提到 DRL 6.5 / 尾灯 5.0：灯带本体不再是「浅色塑料条」，外缘拉出一圈光晕。
     headlight 透明罩点亮时也开大一点，露出里面的反射杯。 */
  M.led.emissiveIntensity = on ? 6.5 : 0;
  M.taillight.emissiveIntensity = on ? 5.0 : 0;
  M.signal.emissiveIntensity = on ? 3.0 : 0;
  M.screen.emissiveIntensity = on ? 1.35 : 0.80;
  M.headlight.opacity = on ? 0.62 : 0.42;
}

/* 透视：车身漆面半透明，内饰/灯具保留，便于看舱内 */
export function setRealBodyOpacity(M, o) {
  const xray = o < 1;
  M.paint.transparent = xray;
  M.paint.opacity = o;
  M.paint.depthWrite = !xray;
  M.paint.needsUpdate = true;
  /* 内衬必须跟着一起透明 —— 否则透视模式下它会变成一堵黑墙把内饰全挡住，
     「看舱内」这个功能就废了。 */
  if (M.liner) {
    M.liner.transparent = xray;
    M.liner.opacity = o;
    M.liner.depthWrite = !xray;
    M.liner.needsUpdate = true;
  }
  if (M.silver) { M.silver.transparent = xray; M.silver.opacity = xray ? 0.28 : 1; M.silver.depthWrite = !xray; M.silver.needsUpdate = true; }
  if (M.plastic) { M.plastic.transparent = xray; M.plastic.opacity = xray ? 0.3 : 1; M.plastic.depthWrite = !xray; M.plastic.needsUpdate = true; }
}
