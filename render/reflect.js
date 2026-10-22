import * as THREE from 'three';

/* =========================================================
   平面反射地面（照搬 SU7 的做法）
   - 用镜像虚拟相机把场景渲进一张 mipmap 贴图
   - 地面 shader 按「离车距离 + 粗糙度」用 textureLod 取不同模糊级别
     → 近处是镜子，远处糊成一片光晕，这就是 SU7 地面上那条长拖影
   - 光池 / 接触阴影都在同一个 shader 里算，省一个 pass
   ========================================================= */

const VERT = /* glsl */`
uniform mat4 uReflMatrix;
varying vec4 vReflUV;
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  // 注意：uReflMatrix 里已经乘过地面自己的 matrixWorld（照 three 官方 Reflector 的写法），
  // 所以这里必须喂 **局部坐标**。喂 wp 等于把 matrixWorld 应用两次
  // （地面绕 X 转 -90°，两次 = -180°，Y/Z 直接对调）→ 倒影会整体错位成"第二台车"。
  vReflUV = uReflMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */`
precision highp float;
uniform sampler2D uRefl;
uniform float uReflIntensity;
uniform float uRough;
uniform float uBlur;
uniform float uStretch;
uniform float uTime;
uniform vec3  uPoolColor;
uniform float uPoolIntensity;
uniform vec2  uPoolPos;
uniform float uPoolRadius;
// 光池的椭圆化：>1 = 该轴收窄。<1 = 该轴拉长。
// 俯视章节要把圆形光池压成「一道打在车身上的光柱」（车长沿 X），
// 否则相机抬高后 9m 半径的圆池会铺满整个画面，变成一片蓝雾。
uniform vec2  uPoolScale;
// 地面底色总开关。俯视章节要压到 ~0.1，让车旁边的地面接近纯黑。
uniform float uBaseMix;
uniform vec3  uTint;
uniform float uFade;
varying vec4 vReflUV;
varying vec3 vWorld;

float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 uv = vReflUV.xy / max(vReflUV.w, 1e-4);
  float d = length(vWorld.xz);

  /* ================= 地面材质 =================
     ⚠️⚠️ 参考站的地面是「打磨过的湿水泥」：有**方向性很强的横向拉丝**，
     倒影的清晰度还**局部变化**（有的地方清楚、有的地方糊），整体明暗斑驳。
     我们原来只有一层低频、低振幅的**各向同性**噪声 —— 视觉上完全看不出纹理，
     地面就是一块光滑塑料板，倒影像「贴上去的一张图」，再亮也不对。
     这里拆成三层：

       1) 拉丝   —— X（车长）方向拉长、Z（车宽）方向高频 → 横向细纹。
                  它扰动的是倒影采样的 **V 坐标**，所以倒影会被撕成横向条纹。
       2) 斑驳   —— 中频噪声，调制 mip lod → 倒影「局部清晰、局部糊」。
                  这一层是「湿地面」和「镜面」的分水岭。
       3) 明暗   —— 低频噪声，让地面自身的亮度不均匀（不要一块均匀灰）。 */
  // 1) 拉丝
  // ⚠️ Z（车宽）方向的频率决定条纹在屏幕上的粗细。3.4 → 周期 0.29m，
  // 在 5.4m 处折算成 80px —— 那不是「细纹」是「大波浪」。22 → 15px，才像拉丝。
  vec2 q = vec2(vWorld.x * 0.16, vWorld.z * 22.0);
  // ⚠️ 拉丝强度本身要**被低频噪声调制** —— 均匀铺满的条纹会被读成「贴图」。
  // 参考站的条纹是「有的区域明显、有的区域干净」，这才是湿水泥。
  float streakAmp = vnoise(vWorld.xz * 0.55 + 63.0);
  float streak = ((vnoise(q) * 0.62 + vnoise(q * 2.9 + 23.1) * 0.38) - 0.5) * (0.30 + streakAmp * 1.45);
  // 2) 粗糙度斑驳
  float grain = vnoise(vWorld.xz * 0.40) * 0.62 + vnoise(vWorld.xz * 1.30 + 7.7) * 0.38;
  // 3) 明暗斑驳
  float mottle = vnoise(vWorld.xz * 0.28 + 41.0) - 0.5;

  // 近处也不是镜子。参考站实测：倒影中心和车身同位置比，亮度只有 0.5~0.8 倍，
  // 而且**明显更糊** —— 轮辐、门缝这些细节在倒影里是读不出来的。
  // 给 1:1 清晰镜面 = 「玻璃桌上的玩具」，这就是廉价感的来源。
  // ⚠️ grain 那一项让模糊量随位置变，倒影才有「湿地面」的呼吸感。
  float lod = uBlur + grain * 3.2 + smoothstep(1.5, 26.0, d) * 4.5 + uRough * 3.0;

  // 拉丝扰动：只动 V（纵向）→ 倒影被横向拉成条纹
  /* ⚠️⚠️ 幅度是关键：这里给的是**屏幕 UV 空间**的偏移。
     0.075 = 画面高度的 7.5% = 900px 里的 68px —— 每个像素的倒影被随机上下搬 ±34px，
     倒影结构被彻底打散，地面变成一块均匀灰。
     0.014（±6px）又太小，倒影变回「清晰镜面」，反而失去参考站那种水光感。
     0.040（±18px）是实测的甜点：结构保住了，条纹也读得出来。 */
  vec2 off = vec2(streak * 0.0018, streak * 0.040);

  // 纵向拉伸 —— SU7 地面上那条长拖影就是这么来的。
  // 但纯 9-tap 求平均 = 一次 30px 方框模糊，轮毂辐条全糊没了。
  // 所以拆成两路：近处取「清晰的低 mip」，远处取「拉伸糊掉的高 mip」，再按距离混。
  vec3 sharp = textureLod(uRefl, uv + off, lod).rgb;

  vec3 blur = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 7; i++) {
    float t = (float(i) - 3.0) * 0.3333;               // -1 .. 1
    float w = 1.0 - abs(t) * 0.60;
    blur += textureLod(uRefl, uv + off + vec2(0.0, t * uStretch), lod + 2.5).rgb * w;
    wsum += w;
  }
  blur /= wsum;

  /* ⚠️⚠️ 这一行是「车轮倒影像不像参考站」的总开关。
     参考站的车轮倒影是一个**纵向拉长的模糊团**，不是清晰的圆。
     原来 mixK = smoothstep(2.0, 15.0, d) —— 车轮正下方 d≈1m，mixK = 0，
     永远走 sharp 分支 → 倒影是镜子。这是和参考站差得最明显的一处。
     改成「近处也至少混 42% 的拉伸模糊」，车轮倒影才糊得对。
     （注：GLSL 注释里**不能出现反引号** —— 整个 shader 是 JS 模板字符串，
       一个反引号就会把字符串截断，报 "Unexpected identifier"。） */
  float mixK = smoothstep(0.5, 9.0, d);
  vec3 refl = mix(sharp, blur, 0.42 + mixK * 0.50);

  // 出界处 ClampToEdge 会拉出亮边 —— 软化掉
  vec2 lo = smoothstep(vec2(0.0), vec2(0.06), uv);
  vec2 hi = 1.0 - smoothstep(vec2(0.94), vec2(1.0), uv);
  refl *= lo.x * lo.y * hi.x * hi.y;

  // 倒影只在靠近车的范围内明显，越远越淡 —— 整块地面铺满倒影会很假。
  // 参考站的倒影基本在「一台车高」内就淡没了，所以衰减要比直觉更狠。
  /* ⚠️ 衰减尺度 4.6 → 7.0、指数 2.0 → 1.8：原来倒影在「一台车高」外就没了，
     画面最下方（世界坐标离车 ~3.1m）几乎全黑，看着像地面「干」了。
     放宽之后倒影能铺到画面下沿，SU7 那种「整片湿地面」的感觉才出来。
     常数项 0.10 → 0.16 保证远处还有一层极淡的底反射，不是硬切。 */
  float nearCar = 0.16 + 0.84 * exp(-pow(d / 7.0, 1.8));
  refl *= uReflIntensity * nearCar;

  // 影棚光池：车正下方/后方一片柔和的亮
  vec2 pd = (vWorld.xz - uPoolPos) * uPoolScale;
  float pr = length(pd) / uPoolRadius;
  float pool = exp(-pr * pr * 1.35);

  // 地面自身的底色。
  // ⚠️ 这里必须是**近黑**。实测 SU7：地面中景 (23,23,24)、地平线 (4,5,5)，
  // 而倒影中心是 (56,108,118) —— 亮的是倒影，不是地面。
  // 早先把 uTint 调成亮灰(0x767c84)是反的：地面 107~129，倒影 142，
  // 只差 1.2 倍 → 倒影和地面糊成一片灰雾，怎么调模糊参数都救不回来。
  // 衰减指数从 d/10.5^1.6 收紧到 d/7.5^1.4：实测参考站墙脚 L=10，
  // 我们原来那条曲线在墙脚还有 46 —— 远场地面亮 = 上半屏糊一层灰。
  vec3 base = uTint * uBaseMix * (0.02 + 0.98 * exp(-pow(d / 7.5, 1.4)));
  // 明暗斑驳：地面不能是一块均匀灰。±15% 就够，多了会像脏。
  base *= 0.78 + mottle * 0.44;

  vec3 col = base + refl + uPoolColor * pool * uPoolIntensity;

  // 边缘淡出，避免看到地面边界
  col *= 1.0 - smoothstep(uFade * 0.42, uFade, d);   // edge0 必须 < edge1

  // 细噪点，去掉色带
  col += (hash(gl_FragCoord.xy) - 0.5) * 0.004;

  gl_FragColor = vec4(col, 1.0);
}`;

export class ReflectFloor {
  constructor(renderer, { scale = 0.7, size = 90, y = 0 } = {}) {
    this.renderer = renderer;
    this.scale = scale;
    this.hidden = [];

    const dpr = renderer.getPixelRatio();
    this.rt = new THREE.WebGLRenderTarget(
      Math.max(2, Math.floor(innerWidth * dpr * scale)),
      Math.max(2, Math.floor(innerHeight * dpr * scale)),
      {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: true,
        depthBuffer: true,
        stencilBuffer: false,
      }
    );
    this.rt.texture.colorSpace = THREE.NoColorSpace;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      toneMapped: false,
      uniforms: {
        uRefl:           { value: this.rt.texture },
        uReflMatrix:     { value: new THREE.Matrix4() },
        uReflIntensity:  { value: 0.85 },
        uRough:          { value: 0.10 },
        // 模糊基数。2.3 时倒影完全读不出形状（车轮倒影只剩一团灰），
        // 参考站的车轮倒影是能看出圆形轮廓的 —— 降到 1.4，
        // 再靠 shader 里的 patch（粗糙度斑驳）做出「局部清晰局部糊」。
        uBlur:           { value: 1.60 },
        // 纵向拉伸。原来 0.075 是「模糊拉伸」的主力，现在拉丝纹理已经在做这件事，
        // 这里收到 0.05，避免两层叠加把倒影揉成一团。
        uStretch:        { value: 0.085 },
        uTime:           { value: 0 },
        uPoolColor:      { value: new THREE.Color(0x73737a) },
        uPoolIntensity:  { value: 0.60 },
        uPoolPos:        { value: new THREE.Vector2(0, 0) },
        uPoolRadius:     { value: 10.5 },
        uPoolScale:      { value: new THREE.Vector2(1, 1) },
        uBaseMix:        { value: 1.0 },
        // 地面底色。参考站第2章实测：地面 34~74，倒影中心 138 ——
        // 地面是「中灰偏暗」，不是黑。给 0x1e222a 会让整个下半屏塌成黑块，
        // 车看着像浮在虚空里。车底那块黑由接触阴影负责，不是由地面底色负责。
        // ⚠️ 色相必须**中性**。原来给 0x343a43（B 比 R 高 15）—— 实测我们地面
        // (71,80,95) B/R=1.34，而参考站的地面是 (81,81,82) B/R=1.01。
        // 白车的倒影本来就该是中性灰，底色偏蓝会让整个下半屏泛蓝。
        uTint:           { value: new THREE.Color(0x333335) },
        uFade:           { value: 15.0 },
      },
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = y;
    this.mesh.name = 'reflect-floor';
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;

    // 复用的临时量
    this._plane = new THREE.Plane();
    this._normal = new THREE.Vector3();
    this._rp = new THREE.Vector3();
    this._cp = new THREE.Vector3();
    this._rot = new THREE.Matrix4();
    this._lookAt = new THREE.Vector3();
    this._view = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._q = new THREE.Vector4();
    this._texMat = new THREE.Matrix4();
    this.vcam = new THREE.PerspectiveCamera();
  }

  /** 每帧在渲染主画面之前调用 */
  update(scene, camera) {
    const m = this.mesh, vcam = this.vcam, tm = this._texMat;

    m.updateMatrixWorld();
    camera.updateMatrixWorld();

    this._rp.setFromMatrixPosition(m.matrixWorld);
    this._cp.setFromMatrixPosition(camera.matrixWorld);
    this._rot.extractRotation(m.matrixWorld);
    this._normal.set(0, 0, 1).applyMatrix4(this._rot).normalize();

    this._view.subVectors(this._rp, this._cp);
    if (this._view.dot(this._normal) > 0) return false;   // 相机在地面背面
    this._view.reflect(this._normal).negate().add(this._rp);

    this._rot.extractRotation(camera.matrixWorld);
    this._lookAt.set(0, 0, -1).applyMatrix4(this._rot).add(this._cp);
    this._target.subVectors(this._rp, this._lookAt);
    this._target.reflect(this._normal).negate().add(this._rp);

    vcam.position.copy(this._view);
    vcam.up.set(0, 1, 0).applyMatrix4(this._rot).reflect(this._normal);
    vcam.lookAt(this._target);
    vcam.near = camera.near;
    vcam.far = camera.far;
    vcam.updateMatrixWorld();
    vcam.projectionMatrix.copy(camera.projectionMatrix);

    tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    tm.multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse).multiply(m.matrixWorld);
    this.material.uniforms.uReflMatrix.value.copy(tm);

    // 反射 pass：藏掉地面自己和接触阴影
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    this.hidden = [m];
    for (const o of this.extraHidden) this.hidden.push(o);
    for (const o of this.hidden) o.visible = false;

    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, vcam);

    for (const o of this.hidden) o.visible = true;
    r.setRenderTarget(prevTarget);
    return true;
  }

  set extraHide(list) { this.extraHidden = list; }

  setSize(w, h) {
    const dpr = this.renderer.getPixelRatio();
    this.rt.setSize(Math.max(2, Math.floor(w * dpr * this.scale)), Math.max(2, Math.floor(h * dpr * this.scale)));
  }
}
ReflectFloor.prototype.extraHidden = [];
