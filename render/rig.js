import * as THREE from 'three';

/* =========================================================
   相机弹簧臂 + tween 状态机（照搬 SU7 的 Hl 类）
   - 机位 = lookAt + R(yaw, pitch) * (dist, 0, 0)，永远是环绕运镜
   - 切章不是"跟着滚动线性插值"，而是发一条 tween（Cubic.InOut，1.5~4s）
   - 常驻 FBM 噪声漂移（SU7: amplitude .04 / frequency 1.5）→ 画面永远不死
   ========================================================= */

export const Ease = {
  linear: t => t,
  inQuad: t => t * t,
  outQuad: t => 1 - (1 - t) * (1 - t),
  inOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inCubic: t => t * t * t,
  outExpo: t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutQuart: t => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
};

class Tween {
  constructor(obj, to, dur, { delay = 0, ease = Ease.inOutCubic, onUpdate, onComplete } = {}) {
    this.obj = obj;
    this.from = {};
    for (const k in to) this.from[k] = obj[k];
    this.to = to;
    this.dur = Math.max(0.0001, dur);
    this.delay = delay;
    this.ease = ease;
    this.onUpdate = onUpdate;
    this.onComplete = onComplete;
    this.t = -delay;
    this.done = false;
  }
  step(dt) {
    if (this.done) return;
    this.t += dt;
    if (this.t < 0) return;
    const k = Math.min(1, this.t / this.dur);
    const e = this.ease(k);
    for (const key in this.to) this.obj[key] = this.from[key] + (this.to[key] - this.from[key]) * e;
    this.onUpdate && this.onUpdate(this.obj, e);
    if (k >= 1) { this.done = true; this.onComplete && this.onComplete(); }
  }
  kill() { this.done = true; }
}

export class CamRig {
  constructor(camera, o = {}) {
    this.camera = camera;
    this.lookAt = new THREE.Vector3(...(o.lookAt || [0, 0.8, 0]));
    this.dist = o.dist ?? 7;
    this.yaw = o.yaw ?? Math.PI / 2;
    this.pitch = o.pitch ?? 0;
    this.fov = o.fov ?? 33.4;

    this.targetLook = this.lookAt.clone();
    this.targetDist = this.dist;
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.targetFov = this.fov;

    this.fovLerp = 5.5;        // fov 单独平滑，切章时"推拉变焦"的感觉
    this.noiseAmp = o.noiseAmp ?? 0.045;
    this.noiseFreq = o.noiseFreq ?? 0.42;
    this.noiseOn = o.noise !== false;
    this.portrait = false;
    this._t = Math.random() * 100;
    this._pos = new THREE.Vector3();
    this._noise = new THREE.Vector3();
    this._tweens = [];
    this.enabled = true;
  }

  killTweens() { this._tweens.forEach(t => t.kill()); this._tweens.length = 0; }

  /** 发一条相机 tween；lookAt/dist/yaw/pitch 一起插值 */
  goto({ lookAt, dist, yaw, pitch, fov }, dur = 1.6, { delay = 0, ease = Ease.inOutCubic, onUpdate, onComplete } = {}) {
    this.killTweens();
    const to = {};
    if (lookAt) { this.targetLook.set(...lookAt); to.tlx = lookAt[0]; to.tly = lookAt[1]; to.tlz = lookAt[2]; }
    if (dist !== undefined) to.dist = dist;
    if (yaw !== undefined) to.yaw = yaw;
    if (pitch !== undefined) to.pitch = pitch;

    const obj = {
      tlx: this.targetLook.x, tly: this.targetLook.y, tlz: this.targetLook.z,
      dist: this.targetDist, yaw: this.targetYaw, pitch: this.targetPitch,
    };
    this.targetLook.set(obj.tlx, obj.tly, obj.tlz);
    this.targetDist = obj.dist; this.targetYaw = obj.yaw; this.targetPitch = obj.pitch;

    const tw = new Tween(obj, to, dur, {
      delay, ease,
      onUpdate: o => {
        this.targetLook.set(o.tlx, o.tly, o.tlz);
        this.targetDist = o.dist; this.targetYaw = o.yaw; this.targetPitch = o.pitch;
        onUpdate && onUpdate(o);
      },
      onComplete: onComplete,
    });
    this._tweens.push(tw);
    if (fov !== undefined) this.setFov(fov, dur, { delay, ease });
    return tw;
  }

  /** 用一条独立 tween 推 fov（不打断机位 tween） */
  setFov(v, dur = 1.2, { delay = 0, ease = Ease.inOutCubic } = {}) {
    this._fovTween = { from: this.targetFov, to: v, dur: Math.max(0.0001, dur), delay, ease, t: -delay };
    this.targetFov = v;
  }

  update(dt) {
    for (const t of this._tweens) t.step(dt);
    this._tweens = this._tweens.filter(t => !t.done);

    const ft = this._fovTween;
    if (ft) {
      ft.t += dt;
      if (ft.t >= 0) {
        const k = Math.min(1, ft.t / ft.dur);
        this.fov = ft.from + (ft.to - ft.from) * ft.ease(k);
        if (k >= 1) this._fovTween = null;
      }
    }

    this._t += dt * this.noiseFreq;
    const t = this._t, A = this.noiseAmp;
    if (this.noiseOn) {
      this._noise.set(
        (Math.sin(t * 1.7) * 0.5 + Math.sin(t * 3.9 + 2.1) * 0.3 + Math.sin(t * 8.3 + 4.7) * 0.2) * A,
        (Math.sin(t * 1.3 + 1.4) * 0.5 + Math.sin(t * 3.1 + 0.7) * 0.3 + Math.sin(t * 7.1 + 2.3) * 0.2) * A,
        (Math.sin(t * 1.9 + 3.2) * 0.5 + Math.sin(t * 4.3 + 5.1) * 0.3 + Math.sin(t * 9.1 + 1.1) * 0.2) * A
      );
    } else this._noise.set(0, 0, 0);

    const d = this.targetDist;
    const cp = Math.cos(this.targetPitch), sp = Math.sin(this.targetPitch);
    this._pos.set(
      d * cp * Math.cos(this.targetYaw),
      d * sp,
      -d * cp * Math.sin(this.targetYaw)
    ).add(this.targetLook).add(this._noise);

    this.camera.position.copy(this._pos);
    this.camera.lookAt(this.targetLook);

    if (Math.abs(this.camera.fov - this.fov) > 0.005) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
