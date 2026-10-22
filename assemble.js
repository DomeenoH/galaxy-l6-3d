import * as THREE from 'three';

/* =========================================================
   吉利银河 L6 真实模型装配（index.html / story.html 共用）
   源：BeamNG mod → Sketchfab GLB（车身）+ 源包 DAE 转出的轮子
   模型局部坐标：x=车宽、y=车高、z=车长，车头朝 +Z
   ========================================================= */

export const CAR_LEN = 4.782;      // 车长 m
export const CAR_W = 1.875;
export const CAR_H = 1.489;
export const WB = 2.752;           // 轴距
export const FRONT_AXLE = 1.470;   // 前轴心（前悬 921）
export const REAR_AXLE = FRONT_AXLE - WB;   // -1.282
export const HALF_TRACK = 0.790;
export const TIRE_R = 0.334;       // 215/55 R17 ≈ Ø668

/* 源 mod 里方向盘是「可拆卸件」，在 DAE 里被摆在原点地面上，
   按驾驶位（FL = +x）摆回舱内。用 attach 保证不受父级坐标系影响 */
const STEER_POS = [0.339, 0.780, 0.440];
const STEER_TILT = -1.13;          // 转向柱后倾约 25°

function placeLooseParts(model) {
  const steer = model.getObjectByName('gsrgalal6_steer');
  if (!steer) return false;

  const pivot = new THREE.Group();
  pivot.position.set(...STEER_POS);
  pivot.rotation.set(STEER_TILT, 0, 0);
  model.add(pivot);
  model.updateMatrixWorld(true);

  pivot.attach(steer);
  steer.position.set(0, 0, 0);
  steer.quaternion.identity();
  steer.scale.set(1, 1, 1);
  pivot.updateMatrixWorld(true);

  const toPivot = new THREE.Matrix4().copy(pivot.matrixWorld).invert();
  const b = new THREE.Box3().setFromObject(steer).applyMatrix4(toPivot);
  steer.position.sub(b.getCenter(new THREE.Vector3()));
  steer.updateMatrixWorld(true);
  return true;
}

/**
 * 轮子挂到 4 个轴心。
 * 关键：轴心位置是相对「车身包围盒中心」量的，不是相对模型原点 ——
 * 这个 mod 的模型原点不在包围盒中心（偏前 0.117m），按原点摆轮子会整体前移。
 * 尺寸与居中在挂进场景后由 calibrateWheels() 量出来做。
 */
/**
 * 包围盒，但跳过 `userData.noBounds` 的辅助片。
 *
 * ⚠️ `Box3.setFromObject` **不看 visible**，也不支持排除 ——
 * 轮拱 AO 片会伸到轮胎下面 0.35R，直接用 setFromObject 会把整车抬起来浮空。
 * 所以这里自己遍历一遍。
 */
export function box3Of(root, target = new THREE.Box3()) {
  target.makeEmpty();
  root.updateWorldMatrix(true, true);
  root.traverse(o => {
    if (!o.isMesh || o.userData.noBounds || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    target.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return target;
}

/**
 * 轮拱假 AO。
 *
 * 场景里没有 SSAO，轮拱内壁吃到的是和车身一样的 IBL → 轮拱不黑，
 * 轮胎就像「贴」在车身上，整车立刻变塑料玩具。
 * 参考站的车轮拱是死黑的，这块黑把车「垫」起来了。
 *
 * 做法：在轮胎**内侧**放一片朝外的暗渐变圆片，直径比轮胎大 35%。
 * 轮胎把中心挡住，只在轮拱缝里露出一圈黑 —— 就是轮拱阴影。
 * 放在轮胎内侧而不是轮心平面上，是为了不让它从轮辐缝里穿出来。
 */
let _archTex = null;
function archTexture() {
  if (_archTex) return _archTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const cx = cv.getContext('2d');
  const g = cx.createRadialGradient(128, 128, 4, 128, 128, 126);
  g.addColorStop(0.00, 'rgba(0,0,0,1)');
  g.addColorStop(0.68, 'rgba(0,0,0,0.96)');
  g.addColorStop(0.82, 'rgba(0,0,0,0.52)');
  g.addColorStop(1.00, 'rgba(0,0,0,0)');
  cx.fillStyle = g; cx.fillRect(0, 0, 256, 256);
  _archTex = new THREE.CanvasTexture(cv);
  _archTex.colorSpace = THREE.SRGBColorSpace;
  return _archTex;
}

function mountWheels(parent, wheelGltf, K, wheels, bodyCenterZ) {
  const src = wheelGltf.scene || wheelGltf.scenes[0];
  const track = HALF_TRACK / K;
  const front = bodyCenterZ + FRONT_AXLE / K;
  const rear  = bodyCenterZ + REAR_AXLE / K;

  const archMat = new THREE.MeshBasicMaterial({
    map: archTexture(), transparent: true, depthWrite: false,
    side: THREE.FrontSide, toneMapped: false, opacity: 0.92,
  });
  const R = TIRE_R / K;
  const archGeo = new THREE.PlaneGeometry(R * 2.7, R * 2.7);

  for (const [ax, az] of [[track, front], [-track, front], [track, rear], [-track, rear]]) {
    const pivot = new THREE.Group();
    pivot.position.set(ax, TIRE_R / K, az);
    pivot.rotation.y = ax > 0 ? 0 : Math.PI;      // 让轮辋朝外

    const holder = new THREE.Group();
    holder.add(src.clone(true));
    // 轮轴 = 模型局部 X。wrap 又绕 Y 转了 90°（车头 +Z → +X），于是：
    //   ax>0（+Z 侧）holder 局部 X → 世界 -Z，绕它「正向」转正好是前进
    //   ax<0（-Z 侧）holder 局部 X → 世界 +Z，得反着转，否则左右两组反向
    // （前进 = 绕世界 Z 轴负方向，即 ωz<0）
    holder.userData.spin = ax > 0 ? 1 : -1;

    pivot.add(holder);
    parent.add(pivot);

    // 轮拱 AO 片：轮胎内侧 0.12m，面朝外
    const ao = new THREE.Mesh(archGeo, archMat);
    ao.position.set(ax - Math.sign(ax) * (0.12 / K), TIRE_R / K, az);
    ao.rotation.y = ax > 0 ? Math.PI / 2 : -Math.PI / 2;
    ao.renderOrder = 1;
    ao.name = 'wheel-arch-ao';
    ao.userData.noBounds = true;      // 见 box3Of()
    parent.add(ao);

    wheels.push(holder);
  }
}

/**
 * 把车身 + 4 个轮子装配成一个 wrap（已居中、已按真实车长归一、车头朝 +X）
 * 返回 { wrap, wheels, group, model }；wheels 是 4 个 holder，直接转 rotation.x 就是转轮
 */
export function assembleCar(bodyGltf, wheelGltf) {
  const group = new THREE.Group();
  const model = bodyGltf.scene || bodyGltf.scenes[0];
  group.add(model);

  placeLooseParts(model);

  // 车身包围盒（模型局部）—— 车长换算、轴心定位都以它为准
  const bbBody = new THREE.Box3().setFromObject(model);
  const sizeBody = bbBody.getSize(new THREE.Vector3());
  const ctrBody = bbBody.getCenter(new THREE.Vector3());
  const K = CAR_LEN / Math.max(sizeBody.z, 0.001);

  const wheels = [];
  if (wheelGltf) mountWheels(group, wheelGltf, K, wheels, ctrBody.z);

  // 居中：车身中心 → 原点（x/z）；全车最低点 → 地面（y）
  // 用 box3Of 而不是 setFromObject —— 轮拱 AO 片会伸到轮胎下面，不能算进来
  const bbAll = box3Of(group);
  group.position.set(-ctrBody.x, -bbAll.min.y + 0.002, -ctrBody.z);

  const wrap = new THREE.Group();
  wrap.add(group);
  wrap.scale.setScalar(K);
  wrap.rotation.y = Math.PI / 2;                             // 车头 +Z → +X
  return { wrap, wheels, group, model, K };
}

/**
 * 必须把 wrap 加进场景之后再调：
 * 1) 量出轮子真实半径并缩放到 215/55 R17
 * 2) 把轮心对到轴心（否则自转时会绕圈甩出去）
 * 3) 让轮胎最低点贴地
 */
export function calibrateWheels(wrap, wheels) {
  const inner = wrap.children[0];
  const saved = wheels.map(h => h.rotation.x);
  wheels.forEach(h => { h.rotation.x = 0; });
  wrap.updateMatrixWorld(true);

  const k = wrap.scale.x || 1;
  const rTarget = TIRE_R / k;                     // 目标半径（模型局部单位）

  for (const h of wheels) {
    const p = h.parent;
    p.updateMatrixWorld(true);
    const toPivot = new THREE.Matrix4().copy(p.matrixWorld).invert();

    let box = new THREE.Box3().setFromObject(h).applyMatrix4(toPivot);
    const sz = box.getSize(new THREE.Vector3());
    const rNow = Math.max(sz.y, sz.z) / 2;
    if (rNow < 1e-4) continue;

    h.scale.multiplyScalar(rTarget / rNow);

    p.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(h).applyMatrix4(toPivot);
    h.position.sub(box.getCenter(new THREE.Vector3()));
  }

  wrap.updateMatrixWorld(true);
  const gb = box3Of(wrap);
  inner.position.y -= (gb.min.y - 0.002) / k;

  wheels.forEach((h, i) => { h.rotation.x = saved[i]; });
  wrap.updateMatrixWorld(true);

  const wb = new THREE.Box3().setFromObject(wheels[0]);
  return { wheelDiameter: +wb.getSize(new THREE.Vector3()).y.toFixed(3) };
}

/* =========================================================
   车身内衬（body liner）—— 消灭面板缝上的点状虚线
   =========================================================

   ⚠️⚠️ 症状：门缝 / 翼子板缝 / 门把手凹槽上排着一串**白色点状虚线**，
   像线稿，是「粗糙廉价感」最刺眼的一项。

   实测定位过程（别再走弯路）：
     · 关掉 details / plastic / blackGloss 全无效
     · 关掉 paint 整组 → 缝一起消失（说明缝属于车身面板自己的边界）
     · 相机 near/far 从 0.05/400 收到 0.6/120 → 无效（**不是**深度精度问题）
     · 给材质 polygonOffset ±30 → 无效（门与门框**共用同一个材质实例**，
       两边一起偏移，相对关系不变 —— 这是 polygonOffset 的经典失效场景）
     · 把 details 顶点沿径向外推 14mm → 无效（根本不是 details 画的）
     · 隐藏 gsrgalal6-material_1 → **整个前门消失**，露出橙色内饰
       （门是独立 mesh，而且是**薄壳**，门内板后面直接就是座椅）

   结论：门（material_1 / material_10）与门框之间是一条**真实的几何缝**，
   宽约 1~2mm。在 1440×900 / 33.4° FOV / 7m 距离下这条缝只有 ~1px 宽，
   光栅化时覆盖在相邻像素间抖动 → 有的像素采到门框边缘的**亮面**（被 IBL
   照亮的漆面），有的采到门板 → 断续的白点。

   修法：**不改几何**，在车身内侧 1.4cm 处放一层纯黑内衬（把 paint 的几何
   沿车身包围盒中心缩到 0.985）。缝里看进去立刻打到内衬 → 缝从「白点虚线」
   变成「一条干净的暗线」—— 正是真车照片里门缝的样子。
   内衬从外面看完全被车身挡住（深度测试），只在缝里露出来。

   ⚠️ 缩比别给太小：第 1 章是近水平侧视，视线几乎贴着车身擦过去，
   穿过 2mm 的缝只能「看」进去约 2.2cm。缩到 0.97（内缩 2.8cm）就挡不住了。
   0.985（内缩 1.4cm）是实测能挡住又不会顶到内饰的下限。
   ========================================================= */
export function buildBodyLiner(group, M, shrink = 0.985) {
  const paints = [];
  group.traverse(o => { if (o.isMesh && o.material && o.material.name === 'paint') paints.push(o); });
  if (!paints.length) return null;

  group.updateMatrixWorld(true);

  // 车身包围盒中心（group 空间）—— 径向缩放的锚点
  const bb = new THREE.Box3();
  for (const m of paints) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    bb.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld));
  }
  const c = bb.getCenter(new THREE.Vector3());

  const linerMat = new THREE.MeshBasicMaterial({ color: 0x08090c, side: THREE.FrontSide });
  linerMat.name = 'liner';
  if (M) M.liner = linerMat;

  const v = new THREE.Vector3();
  for (const m of paints) {
    const g = m.geometry.clone();
    const p = g.attributes.position;
    const inv = new THREE.Matrix4().copy(m.matrixWorld).invert();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      v.set(c.x + (v.x - c.x) * shrink, c.y + (v.y - c.y) * shrink, c.z + (v.z - c.z) * shrink);
      v.applyMatrix4(inv);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingBox();

    const mesh = new THREE.Mesh(g, linerMat);
    mesh.name = 'liner-' + m.name;
    mesh.position.copy(m.position);
    mesh.quaternion.copy(m.quaternion);
    mesh.scale.copy(m.scale);
    mesh.userData.noBounds = true;
    mesh.userData.isLiner = true;
    m.parent.add(mesh);
  }
  return linerMat;
}

/** 整棵树开阴影、统一抬一点环境反射强度 */
export function polishShadows(root, minEnv = 1.0) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(m => {
      if (m && m.envMapIntensity !== undefined) m.envMapIntensity = Math.max(m.envMapIntensity, minEnv);
    });
  });
}

export function countTris(root) {
  let n = 0;
  root.traverse(o => {
    if (o.isMesh && o.geometry) {
      const g = o.geometry;
      n += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return n;
}
