import * as THREE from 'three';

/* =========================================================
   影棚（Studio）—— 照搬 gamemcu SU7 的做法：
   1) 全场景只有 IBL + 反射，不用任何点/平行光源（实测 ambientLightColor = 0）
   2) 环境贴图不是随便找个 HDR，而是「一排柔光箱」渲染成的 PMREM
      —— 车漆上的高光形状 = 柔光箱的形状，这才是"贵"的来源
   3) 房间本体（天花板灯板 / 深色墙 / 地面）用简单几何 + 渐变贴图，
      天花板灯板要够大够远，才会正好落在画面上沿
   ========================================================= */

export const STUDIO = {
  // 房间要"够小"：天花板落在画面上沿的那条线在 ~20m，房间进深决定了
  // 天花板那条亮带占画面多少（进深越大带越宽，太宽就变帐篷了）
  room:   { w: 46, h: 20, d: 48, cy: 9, cz: 0 },
  // 灯板：抬高 + 缩小 + 边缘极柔。太大太低会变成画面上方一块灰色硬边三角。
  panel:  { w: 30, h: 34, y: 8.6, z: 0, soft: 0.84 },
  // 墙面渐变。
  // ⚠️⚠️ 这里曾经写 wallTop = 0xf2f6fb 想「让墙面自己出一条白带」——**是错的**。
  //  几何方案做不到：第1章机位接近水平（画面顶 = 水平线上 ~18°），
  //  第2章俯 6.6°（画面顶 = ~10°），同一块天花板板子在两章里的屏幕位置差 3 倍，
  //  怎么摆都只能对上一章，而且会在俯视章里漏出一大片灰白。
  //  → 顶部那条「V 形光板」改由 **屏幕空间后处理** 画（见 render/post.js 的 uSb*），
  //    跟机位无关，稳。墙色这边只需要「别死黑」就行。
  wallTop: 0x24282e, wallMid: 0x13161b, wallBot: 0x080a0e,
};

/* ---------- 环境贴图：一排柔光箱 → PMREM ---------- */
export function makeStudioEnv(renderer, opts = {}) {
  const O = { ...STUDIO, ...opts };
  const s = new THREE.Scene();

  const room = new THREE.Mesh(
    new THREE.BoxGeometry(60, 30, 60),
    new THREE.MeshStandardMaterial({ side: THREE.BackSide, color: 0x10141a, roughness: 0.9, metalness: 0 })
  );
  room.position.set(0, 8, 0);
  s.add(room);

  const box = new THREE.BoxGeometry();
  const soft = (i, hex = 0xffffff) => {
    const m = new THREE.MeshBasicMaterial();
    m.color.setScalar(i);
    if (hex !== 0xffffff) m.color.setHex(hex).multiplyScalar(i);
    return m;
  };

  // 顶部主柔光箱 —— 决定车顶 / 引擎盖的高光形状。
  // ⚠️ 三个互相拉扯的约束：
  //  1) **面积不能太大**。20×16 这种大面光在车漆上只是一片均匀的灰白（＝塑料感）。
  //  2) **厚度不能是 0**。原来给了 0.2 —— 那是一块「纸」。侧视机位看车身肩线时，
  //     反射方向几乎贴着这块板子擦过去，0.2 厚的板子张角≈0，肩线上根本没有高光。
  //     （这就是「车身一片平、读不出型面」的直接原因。）
  //  3) ⚠️⚠️ **车宽方向（Z）必须窄**。曾经给到 9 —— 而车宽只有 1.875m，
  //     9m 等于车宽的 5 倍，等于一块「无限大面光」，在车门上就是一片均匀灰白。
  //     压到 3.0（车宽的 1.6 倍）之后，车顶/引擎盖上才会出现**一条纵向亮带**，
  //     车身重新读得出型面。这是「车身平」的最后一个开关。
  const top = new THREE.Mesh(box, soft(1.5));
  top.position.set(0, 11.4, -1);
  top.scale.set(13, 1.8, 3.0);
  s.add(top);

  // 左右长条柔光箱 —— 沿「车长方向」拉长（车长 = X），
  // 车身肩线上那道又长又细的高光就是这两条的倒影。别摆错轴。
  //
  // ⚠️ 位置要**高**。摆在 y=2~4（车身腰线高度）会把车门整片照亮，
  // 车身失去「上亮下暗」的纵向层次 → 变成一块均匀的灰白塑料。
  // 抬到 y≈6 只照肩线以上，下半身只剩暗地板，车才「沉」得下去。
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(box, soft(sx < 0 ? 1.90 : 1.30, 0xf2f7ff));
    p.position.set(0, 6.2, sx * 14);
    p.scale.set(20, 1.2, 0.22);
    s.add(p);

    // 肩线灯 —— 又细又长又亮的一条，位置**更高**。
    // 侧视机位看车身时，肩线（腰线以上那道转折）的法线朝上外方，
    // 反射方向指向「高处 + 相机这一侧」→ 正好打到这条上。
    // 它给出的是**一条线**而不是一片光，这是参考站车身上最贵的那个细节。
    // ⚠️ 强度别过 1.5：这条灯打的是**清漆层**，车漆 roughness 0.14 时反射很锐，
    //    过亮会在肩线上烧出一条纯白硬边（比没有更假）。
    const pl = new THREE.Mesh(box, soft(sx < 0 ? 1.55 : 1.10, 0xffffff));
    pl.position.set(0, 8.8, sx * 13);
    pl.scale.set(23, 0.42, 0.5);
    s.add(pl);

    // 一条很弱的低位补光，只负责别让下裙死黑成剪影。
    // ⚠️ 0.05 → 0.02：地面倒影提亮之后，下裙再亮就跟地面糊在一起，
    //    「车浮在地面上」的分离感全靠这一块暗。宁暗勿亮。
    const p2 = new THREE.Mesh(box, soft(0.02, 0xdfe9ff));
    p2.position.set(0, 3.4, sx * 14);
    p2.scale.set(24, 0.4, 0.22);
    s.add(p2);
  }

  // 车头方向（+X）一盏大面光 —— 车头/前脸的主光。
  // 白车漆 + 这盏灯最容易把前翼子板顶到纯白（实测 L=215，形状全丢），强度要克制。
  const front = new THREE.Mesh(box, soft(0.42, 0xffffff));
  front.position.set(17, 4.8, 0);
  front.scale.set(0.25, 4.4, 8.0);
  s.add(front);

  // 车尾方向（-X）一盏 —— 尾部轮廓光
  const rear = new THREE.Mesh(box, soft(0.40, 0xe8f0ff));
  rear.position.set(-17, 4.6, 0);
  rear.scale.set(0.25, 4.0, 7.5);
  s.add(rear);

  // 地面：暗，但有一点亮度，让车底有微弱反光。
  // 压得更暗一点 —— 下半球越暗，车身下半部越沉，对比度越高。
  const fl = new THREE.Mesh(box, soft(0.008, 0x9fb0c4));
  fl.position.set(0, -0.6, 0);
  fl.scale.set(50, 0.2, 50);
  s.add(fl);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromScene(s, 0.035, 0.1, 100);
  pmrem.dispose();
  s.traverse(o => { if (o.isMesh) { o.geometry.dispose?.(); o.material.dispose?.(); } });
  return rt.texture;
}

/* ---------- 可见的影棚房间 ---------- */
export function makeStudioRoom() {
  const O = STUDIO;
  const g = new THREE.Group();
  g.name = 'studio-room';

  // 墙面：垂直渐变贴图（底黑 → 顶略亮），贴在一个大盒子的内壁
  const cv = document.createElement('canvas');
  cv.width = 4; cv.height = 512;
  const cx = cv.getContext('2d');
  // 注意 flipY：canvas 顶行 = 墙面顶部
  const grd = cx.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0.00, hex(O.wallTop));
  grd.addColorStop(0.30, hex(O.wallTop));
  grd.addColorStop(0.58, hex(O.wallMid));
  grd.addColorStop(1.00, hex(O.wallBot));
  cx.fillStyle = grd; cx.fillRect(0, 0, 4, 512);
  const wallTex = new THREE.CanvasTexture(cv);
  wallTex.colorSpace = THREE.SRGBColorSpace;
  wallTex.wrapS = wallTex.wrapT = THREE.ClampToEdgeWrapping;

  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(O.room.w, O.room.h, O.room.d),
    new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.BackSide, depthWrite: false })
  );
  shell.position.set(0, O.room.cy, O.room.cz);
  shell.renderOrder = -10;
  g.add(shell);

  // 天花板柔光：一整块，靠 shader 把边缘化开 —— 任何机位看过去都是
  // "上沿一片亮、往四周暗下去"，不会出现帐篷一样的硬边三角形
  const panelMat = new THREE.ShaderMaterial({
    toneMapped: false,
    uniforms: {
      uColor: { value: new THREE.Color(0.72, 0.73, 0.76) },
      uSoft:  { value: O.panel.soft },
      uCenter: { value: new THREE.Vector2(0.0, 0.5) },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      uniform vec3 uColor;
      uniform float uSoft;
      uniform vec2 uCenter;
      void main(){
        vec2 d = abs(vUv - uCenter) * 2.0;
        float m = max(d.x, d.y);
        float a = 1.0 - smoothstep(1.0 - uSoft, 1.0, m);
        a *= a;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(O.panel.w, O.panel.h), panelMat);
  panel.rotation.x = Math.PI / 2;                 // 朝下
  panel.position.set(0, O.panel.y, O.panel.z);
  panel.renderOrder = -9;
  // ⚠️ 常闭。顶部那条光板改由屏幕空间后处理画（render/post.js 的 uSb*）。
  // 这块几何板子留着只是备查 —— 它在俯视章会糊满整个画面，
  // 在侧视章又因为机位差 3 倍对不上，属于「怎么做都错」的方案。
  panel.visible = false;
  g.add(panel);

  // 更上一层：纯黑，挡住盒子自身的顶面。
  // 高度要**抬到柔光箱之上很多** —— 压在 10.2 会把墙上那条白带切掉。
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(O.room.w, O.room.d),
    new THREE.MeshBasicMaterial({ color: 0x010204, side: THREE.DoubleSide })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, O.panel.y + 4.6, O.room.cz);
  ceil.renderOrder = -11;
  g.add(ceil);

  g.userData = {
    shell, panel, ceil, panelMat,
    // 俯视章节要把天花板收掉，否则会挡住整个画面
    setCeiling(v) { panel.visible = v; ceil.visible = v; },
  };
  return g;
}

function hex(v) { return '#' + v.toString(16).padStart(6, '0'); }

/* ---------- 车底接触阴影（不用 shadowMap，用一张径向渐变） ---------- */
export function makeContactShadow(w = 7.6, d = 3.4) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const cx = cv.getContext('2d');
  const grd = cx.createRadialGradient(128, 128, 2, 128, 128, 126);
  grd.addColorStop(0.00, 'rgba(0,0,0,0.88)');
  grd.addColorStop(0.26, 'rgba(0,0,0,0.70)');
  grd.addColorStop(0.50, 'rgba(0,0,0,0.38)');
  grd.addColorStop(0.76, 'rgba(0,0,0,0.11)');
  grd.addColorStop(1.00, 'rgba(0,0,0,0)');
  cx.fillStyle = grd; cx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;

  // 车底接触阴影。参考站车底实测 L≈10（死黑），而周围地面 34~74 ——
  // 车「压」在地面上靠的就是这一块黑。给太浅（0.62）车会浮起来。
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.94 })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.010;
  m.renderOrder = 4;
  m.name = 'contact-shadow';
  return m;
}
