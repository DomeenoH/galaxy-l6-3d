import * as THREE from 'three';

/* =========================================================
   3D → 2D 尺寸标注（SU7 第 2 章那套虚线 + mm 数字）
   每个标注 = 一条 svg 虚线 + 一个标签，每帧按相机投影更新
   ========================================================= */

const NS = 'http://www.w3.org/2000/svg';

export class Annot {
  constructor(host) {
    this.host = host;
    this.items = [];
    this.opacity = 0;
    this._v = new THREE.Vector3();
  }

  add(o) {
    const wrap = document.createElement('div');
    wrap.className = 'an';
    wrap.innerHTML = `<svg><line class="an-l" x1="0" y1="0" x2="0" y2="0"/>` +
      `<line class="an-t" x1="0" y1="0" x2="0" y2="0"/><line class="an-t" x1="0" y1="0" x2="0" y2="0"/>` +
      `</svg><span class="an-lb"></span>`;
    this.host.appendChild(wrap);
    const item = {
      a: new THREE.Vector3(...o.a),
      b: new THREE.Vector3(...o.b),
      label: o.label || '',
      pad: o.pad ?? 0.55,        // 线往两端延长多少（米）
      off: o.off ?? 26,          // 标签相对线的屏幕偏移 px
      side: o.side ?? 1,
      el: wrap,
      svg: wrap.querySelector('svg'),
      line: wrap.querySelector('.an-l'),
      ticks: [...wrap.querySelectorAll('.an-t')],
      lb: wrap.querySelector('.an-lb'),
    };
    item.lb.textContent = item.label;
    this.items.push(item);
    return item;
  }

  clear() { this.items.forEach(i => i.el.remove()); this.items.length = 0; }

  update(camera, w, h) {
    const vis = this.opacity > 0.01;
    for (const it of this.items) {
      it.el.style.opacity = this.opacity.toFixed(3);
      it.el.style.display = vis ? '' : 'none';
      if (!vis) continue;

      // 两端沿方向延长一点，像真正的尺寸线
      const dir = new THREE.Vector3().subVectors(it.b, it.a);
      const len = dir.length() || 1;
      dir.normalize();
      const A = it.a.clone().addScaledVector(dir, -it.pad);
      const B = it.b.clone().addScaledVector(dir, it.pad);

      const pa = this._v.copy(A).project(camera);
      const ax = (pa.x * 0.5 + 0.5) * w, ay = (-pa.y * 0.5 + 0.5) * h;
      const pb = this._v.copy(B).project(camera);
      const bx = (pb.x * 0.5 + 0.5) * w, by = (-pb.y * 0.5 + 0.5) * h;

      const x = Math.min(ax, bx), y = Math.min(ay, by);
      const sw = Math.max(1, Math.abs(bx - ax)), sh = Math.max(1, Math.abs(by - ay));
      const svg = it.svg;
      svg.style.left = x + 'px';
      svg.style.top = y + 'px';
      svg.setAttribute('width', sw);
      svg.setAttribute('height', sh);
      svg.setAttribute('viewBox', `0 0 ${sw} ${sh}`);
      it.line.setAttribute('x1', (ax - x).toFixed(1));
      it.line.setAttribute('y1', (ay - y).toFixed(1));
      it.line.setAttribute('x2', (bx - x).toFixed(1));
      it.line.setAttribute('y2', (by - y).toFixed(1));

      // 两端小竖线
      const ux = (bx - ax) / (sw || 1), uy = (by - ay) / (sh || 1);
      const nl = Math.hypot(bx - ax, by - ay) || 1;
      const nx = -(by - ay) / nl * 7, ny = (bx - ax) / nl * 7;
      it.ticks.forEach((t, i) => {
        const px = i === 0 ? ax - x : bx - x, py = i === 0 ? ay - y : by - y;
        t.setAttribute('x1', (px - nx).toFixed(1)); t.setAttribute('y1', (py - ny).toFixed(1));
        t.setAttribute('x2', (px + nx).toFixed(1)); t.setAttribute('y2', (py + ny).toFixed(1));
      });

      // 标签：放在线中点的法线方向
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const ox = nx * 1.6 * it.side, oy = ny * 1.6 * it.side;
      it.lb.style.transform = `translate(${(mx + ox).toFixed(1)}px, ${(my + oy).toFixed(1)}px) translate(-50%,-50%)`;
      void ux; void uy;
    }
  }
}
