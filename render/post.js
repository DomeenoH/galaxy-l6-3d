import * as THREE from 'three';

/* =========================================================
   后处理：亮度提取 → 5 级降采样 → 加法升采样 → ACES + sRGB
   SU7 实测只用了 Bloom + SMAA 两个效果，且 Bloom 的
   luminanceSmoothing / intensity 会被 tween（切章时呼吸一次）
   自己写一份，省掉 vendoring 一整套 examples 的依赖
   ========================================================= */

const QUAD_V = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT_F = /* glsl */`
precision highp float;
uniform sampler2D tSrc;
uniform float uThreshold;
uniform float uSmoothing;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb;
  float br = max(c.r, max(c.g, c.b));
  float knee = max(uThreshold * uSmoothing, 1e-4);
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float k = max(soft, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(c * k, 1.0);
}`;

const DOWN_F = /* glsl */`
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main(){
  vec2 t = uTexel;
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb;
  s += texture2D(tSrc, vUv + vec2( t.x, -t.y)).rgb;
  s += texture2D(tSrc, vUv + vec2(-t.x,  t.y)).rgb;
  s += texture2D(tSrc, vUv + vec2( t.x,  t.y)).rgb;
  s += texture2D(tSrc, vUv + vec2(-t.x, 0.0)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2( t.x, 0.0)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(0.0, -t.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(0.0,  t.y)).rgb * 2.0;
  gl_FragColor = vec4(s / 16.0, 1.0);
}`;

const UP_F = /* glsl */`
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uRadius;
varying vec2 vUv;
void main(){
  vec2 t = uTexel * uRadius;
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv + vec2(-t.x, 0.0)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2( t.x, 0.0)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(0.0, -t.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(0.0,  t.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb;
  s += texture2D(tSrc, vUv + vec2( t.x, -t.y)).rgb;
  s += texture2D(tSrc, vUv + vec2(-t.x,  t.y)).rgb;
  s += texture2D(tSrc, vUv + vec2( t.x,  t.y)).rgb;
  gl_FragColor = vec4(s / 16.0, 1.0);
}`;

const COMP_F = /* glsl */`
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uExposure;
uniform float uVignette;
uniform vec2  uTexel;      // 1/分辨率，供锐化采样相邻像素
uniform float uSharp;      // unsharp mask 强度（0 = 关）
uniform float uGrade;      // split-tone 总量（0 = 关）
uniform float uSb;
uniform float uSbXl;
uniform float uSbYl;
uniform float uSbXa;
uniform float uSbXb;
uniform float uSbYr;
uniform float uSbXr;
uniform float uSbYf;
uniform vec3  uLift;
varying vec2 vUv;

vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){
  return mix(12.92 * c, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
/* 相对亮度（Rec.709），给 split-tone 分阴影/高光用 */
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main(){
  vec3 c = texture2D(tScene, vUv).rgb;

  /* ========== Unsharp mask 锐化（线性空间、色调映射前）==========
     整体「发软」是因为：主场景走离屏 target + 多级 bloom，再 ACES 一压，
     中频细节（轮辐、格栅、门缝、字牌）对比被整体拉平。
     做法：用十字 5-tap 估一个小半径模糊，再把「原值 - 模糊」这部分高频
     按 uSharp 加回去 → 边缘反差回来，但不引入新色噪。
     ⚠️ 半径固定 1 texel，强度克制（默认 0.35）：过大车漆大面会出「描边」。 */
  if (uSharp > 0.001) {
    vec3 blur = (
      texture2D(tScene, vUv + vec2( uTexel.x, 0.0)).rgb +
      texture2D(tScene, vUv + vec2(-uTexel.x, 0.0)).rgb +
      texture2D(tScene, vUv + vec2(0.0,  uTexel.y)).rgb +
      texture2D(tScene, vUv + vec2(0.0, -uTexel.y)).rgb
    ) * 0.25;
    c += (c - blur) * uSharp;
  }

  c += texture2D(tBloom, vUv).rgb * uBloom;
  c = c * uExposure + uLift;
  c = aces(c);

  // 注意：smoothstep 的 edge0 必须 < edge1，反过来在 GLSL 里是未定义行为
  float v = 1.0 - smoothstep(0.30, 1.28, length((vUv - 0.5) * vec2(1.62, 1.18)));
  c *= mix(1.0, v, uVignette);

  /* 顶部光板 —— 「影棚感」最大的单一来源。
     ⚠️⚠️ 参考站实测：它**不是**一条全宽的白色横条。它是**一块天花板柔光箱
     在透视下的样子**。逐列扫「白板下沿 y」得到的真实轮廓：

       第1章（侧视）**梯形**：左臂 (0.08,0.012)→(0.14,0.069)，
                            平底 0.069 一路铺到 x=0.86，
                            右臂 (0.86,0.069)→(0.92,0.012)
       第2章（3/4） **三角形**：左臂 (0.00,0.000)→(0.36,0.082)，
                             右臂 (0.36,0.082)→(0.74,0.000)

     边缘是**硬边**（1~2px 过渡），不是渐变。做成「全宽软横条」会被读成一条
     UI 横幅 —— 这是「廉价感」里最刺眼的那一项。
     用屏幕空间做：几何上那块板子跟着机位走，同一块板在两章里的屏幕位置差 3 倍，
     几何方案只能对上一章（而且会在俯视章漏出一大片灰白）。 */
  float yy = 1.0 - vUv.y;                       // 0 = 画面顶部
  // 左臂：从 (uSbXl, uSbYl) 线性升到 (uSbXa, uSbYf)，之后保持平底。
  // x < uSbXl 时会外推出负值 → plate 自然归零，不用额外裁剪。
  float eL = (vUv.x <= uSbXa)
    ? mix(uSbYl, uSbYf, (vUv.x - uSbXl) / max(uSbXa - uSbXl, 1e-3))
    : uSbYf;
  // 右臂：从 (uSbXb, uSbYf) 线性降到 (uSbXr, uSbYr)。
  // uSbXb == uSbXa 时梯形退化成三角形（第2章就是这种）。
  float eR = (vUv.x >= uSbXb)
    ? mix(uSbYf, uSbYr, (vUv.x - uSbXb) / max(uSbXr - uSbXb, 1e-3))
    : uSbYf;
  float edge = min(eL, eR);
  float plate = 1.0 - smoothstep(edge - 0.0014, edge + 0.0014, yy);
  /* ⚠️ 2026-10-22：原来是「mix(c, vec3(1.0), plate*uSb)」—— 纯白、硬边、
     平填充，读起来像一条 UI 横幅而不是「柔光箱」。真实柔光箱的下边缘是
     ⚠️ 注意：这段注释在 GLSL 模板字符串内部，**绝对不能出现反引号**，
     否则会提前闭合模板串，报 "Unexpected identifier"。
     **一条从亮到暗的辉光**，不是刀切的白块。这里拆成两层：
       1) plate 本体仍是硬边（保留原来那条干净轮廓），但颜色给**微冷白**
          （而不是绝对 1.0），避免 bloom 再叠后烧成死白。
       2) 在 plate 下沿 0.05 屏高内补一条向下衰减的辉光 glow，让「板子」和
          「场景」之间有个柔和过渡 —— 这是柔光箱的「软边」。 */
  float plateY = edge;                                  // 板子下沿的 y
  vec3 sbCol = vec3(0.97, 0.985, 1.0);                  // 微冷白
  c = mix(c, sbCol, plate * uSb * 0.96);
  // 下沿柔光：从板沿往下 0.055 屏高内 1→0 衰减，平方收尾更柔
  float glow = 1.0 - smoothstep(plateY, plateY + 0.055, yy);
  glow = glow * glow * (1.0 - plate);                   // 只在板子之外
  c += sbCol * glow * uSb * 0.28;

  vec3 o = toSRGB(c);

  /* ========== Split-tone 色彩分级（sRGB 感知空间）==========
     阴影掺一丝青蓝、高光掺一丝暖，中间调不动 —— 冷暖分离让白车「有膜」。
     ⚠️⚠️ 第一版踩坑：放在 ACES 之后、sRGB 之前（线性空间），还加了以 0.5
     为轴的 S 曲线。线性 0.5 ≈ sRGB 0.73，画面几乎全在轴下 → 车身暗部
     （线性 ~0.05）被压到 ~0.005，**白车变黑车**。分级必须在感知空间做，
     而且不要加以 0.5 为轴的反差曲线。 */
  if (uGrade > 0.001) {
    float L = luma(o);
    float sw = 1.0 - smoothstep(0.05, 0.45, L);      // 阴影权重
    float hw = smoothstep(0.60, 0.95, L);            // 高光权重
    o += (vec3(-0.010, 0.000, 0.016) * sw + vec3(0.012, 0.005, -0.008) * hw) * uGrade;
  }

  gl_FragColor = vec4(clamp(o, 0.0, 1.0), 1.0);
}`;

export class Post {
  constructor(renderer, { mips = 5 } = {}) {
    this.renderer = renderer;
    this.mips = mips;

    const opts = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false };
    this.sceneRT = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    /* ⚠️⚠️ 这一行是「车身缝上的点状虚线」的真正解药。
       `new THREE.WebGLRenderer({ antialias: true })` **只对默认 framebuffer 有效**，
       而我们把主场景渲染到 sceneRT 这个离屏 target —— 它默认 samples = 0，
       也就是说**整条链路上场景根本没有抗锯齿**。
       于是 1px 宽的车身面板缝 / 门把手凹槽边缘被硬采样成断续的点，
       Bloom 再一放大就是那排刺眼的「白色点状虚线」（＝廉价感最重的来源）。
       给 sceneRT 开 4x MSAA 后边缘变成干净的 1px 过渡。
       ⚠️ 必须是 WebGL2（three 的 WebGLRenderer 默认走 WebGL2），samples 才生效。
       ⚠️ 开着 MSAA 时 depthBuffer 走的是 multisample resolve，深度精度不受影响。 */
    this.sceneRT.samples = 4;
    this.sceneRT.texture.colorSpace = THREE.NoColorSpace;

    this.chain = [];
    for (let i = 0; i < mips; i++) {
      const rt = new THREE.WebGLRenderTarget(2, 2, opts);
      rt.texture.colorSpace = THREE.NoColorSpace;
      this.chain.push(rt);
    }

    this.params = {
      exposure: 1.0,
      bloom: 0.85,
      threshold: 0.92,
      smoothing: 0.42,
      vignette: 0.55,
      /* 2026-10-22 质感升级：锐化 + split-tone 分级（可被 STAGES tween）。
         sharp 默认 0.35（克制，避免车漆大面出描边）；grade 1.0 = 阴影/高光
         各偏 ~4/255，肉眼刚好读得出冷暖，白车不偏色。 */
      sharp: 0.35,
      grade: 1.0,
      /* 顶部光板（透视下的天花板柔光箱）。参数含义见 COMP_F 里的注释。
         默认 = 第1章的「梯形」。 */
      sb: 0.0,
      sbxl: 0.08, sbyl: 0.012, sbxa: 0.14,
      sbxb: 0.86, sbyr: 0.012, sbxr: 0.92, sbyf: 0.069,
      lift: new THREE.Color(0, 0, 0),
    };

    this.mBright = new THREE.ShaderMaterial({
      vertexShader: QUAD_V, fragmentShader: BRIGHT_F, toneMapped: false, depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null }, uThreshold: { value: 0.92 }, uSmoothing: { value: 0.42 } },
    });
    this.mDown = new THREE.ShaderMaterial({
      vertexShader: QUAD_V, fragmentShader: DOWN_F, toneMapped: false, depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
    });
    this.mUp = new THREE.ShaderMaterial({
      vertexShader: QUAD_V, fragmentShader: UP_F, toneMapped: false, depthTest: false, depthWrite: false,
      transparent: true, blending: THREE.AdditiveBlending,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.0 } },
    });
    this.mComp = new THREE.ShaderMaterial({
      vertexShader: QUAD_V, fragmentShader: COMP_F, toneMapped: false, depthTest: false, depthWrite: false,
      uniforms: {
        tScene: { value: this.sceneRT.texture }, tBloom: { value: this.chain[0].texture },
        uBloom: { value: 0.85 }, uExposure: { value: 1.0 }, uVignette: { value: 0.55 },
        uTexel: { value: new THREE.Vector2(1 / innerWidth, 1 / innerHeight) },
        uSharp: { value: 0.35 },
        uGrade: { value: 1.0 },
        uSb: { value: 0.0 },
        uSbXl: { value: 0.08 }, uSbYl: { value: 0.012 }, uSbXa: { value: 0.14 },
        uSbXb: { value: 0.86 }, uSbYr: { value: 0.012 }, uSbXr: { value: 0.92 },
        uSbYf: { value: 0.069 },
        uLift: { value: new THREE.Vector3(0, 0, 0) },
      },
    });

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mBright);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.setSize(innerWidth, innerHeight);
  }

  setSize(w, h) {
    const dpr = this.renderer.getPixelRatio();
    const W = Math.max(2, Math.floor(w * dpr));
    const H = Math.max(2, Math.floor(h * dpr));
    this.sceneRT.setSize(W, H);
    /* 锐化采样半径依赖真实像素尺寸（含 DPR），否则高 DPR 屏上半径会偏小、
       锐化几乎看不出；低 DPR 屏又会过冲。 */
    if (this.mComp) this.mComp.uniforms.uTexel.value.set(1 / W, 1 / H);
    let cw = W, ch = H;
    for (let i = 0; i < this.mips; i++) {
      cw = Math.max(2, Math.floor(cw / 2));
      ch = Math.max(2, Math.floor(ch / 2));
      this.chain[i].setSize(cw, ch);
    }
  }

  _blit(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  /** 渲染整个管线（含主场景），最后输出到画布 */
  render(scene, camera) {
    const r = this.renderer, p = this.params;

    // 1) 主场景 → sceneRT（线性 HDR）
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    // 2) 亮度提取 → chain[0]
    this.mBright.uniforms.tSrc.value = this.sceneRT.texture;
    this.mBright.uniforms.uThreshold.value = p.threshold;
    this.mBright.uniforms.uSmoothing.value = p.smoothing;
    this._blit(this.mBright, this.chain[0]);

    // 3) 降采样
    for (let i = 1; i < this.mips; i++) {
      const src = this.chain[i - 1];
      this.mDown.uniforms.tSrc.value = src.texture;
      this.mDown.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this._blit(this.mDown, this.chain[i]);
    }

    // 4) 加法升采样
    r.autoClear = false;
    for (let i = this.mips - 1; i > 0; i--) {
      const src = this.chain[i];
      this.mUp.uniforms.tSrc.value = src.texture;
      this.mUp.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.mUp.uniforms.uRadius.value = 1.0;
      this._blit(this.mUp, this.chain[i - 1]);
    }
    r.autoClear = true;

    // 5) 合成 → 画布
    this.mComp.uniforms.uBloom.value = p.bloom;
    this.mComp.uniforms.uExposure.value = p.exposure;
    this.mComp.uniforms.uVignette.value = p.vignette;
    this.mComp.uniforms.uSharp.value = p.sharp;
    this.mComp.uniforms.uGrade.value = p.grade;
    this.mComp.uniforms.uSb.value = p.sb;
    this.mComp.uniforms.uSbXl.value = p.sbxl;
    this.mComp.uniforms.uSbYl.value = p.sbyl;
    this.mComp.uniforms.uSbXa.value = p.sbxa;
    this.mComp.uniforms.uSbXb.value = p.sbxb;
    this.mComp.uniforms.uSbYr.value = p.sbyr;
    this.mComp.uniforms.uSbXr.value = p.sbxr;
    this.mComp.uniforms.uSbYf.value = p.sbyf;
    this.mComp.uniforms.uLift.value.set(p.lift.r, p.lift.g, p.lift.b);
    this._blit(this.mComp, null);
  }
}
