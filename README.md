# 吉利银河 L6 · 3D 展厅

影棚级实时渲染的分镜式 3D 车型展厅。Three.js r169（vendor 本地版，非压缩），无构建步骤，静态托管即可跑。

```
python3 -m http.server 8000
# story.html  → 分镜展厅（5 章，带注解与色彩定制）
# index.html  → 自由环视版（OrbitControls）
```

## 渲染架构

| 层 | 文件 | 做什么 |
|---|---|---|
| 装配 | `assemble.js` `car.js` `realcar.js` | GLB 载入、节点寻址、PBR 材质重建（车漆 / 玻璃 / 车灯 / 内饰） |
| 环境 | `render/studio.js` | 影棚 IBL——PMREM 烘焙柔光箱，无点光源、无平行光 |
| 地面 | `render/reflect.js` | 实时平面反射——镜像虚拟相机 + mipmap 模糊，逐帧更新 |
| 相机 | `render/rig.js` | 弹簧臂 + tween 状态机 + FBM 噪声漂移 |
| 后处理 | `render/post.js` | 亮度提取 → 5 级降采样 → 加法升采样 → Bloom + ACES + sRGB |
| 分镜 | `story.js` `render/annot.js` `render/flow.js` | STAGES 配置、注解淡入、风阻流线 |

## 质感要点

- **车漆**：低 metalness + clearcoat + 基于 roughness 的 IBL 增益；`onBeforeCompile` 注入菲涅尔边缘光（掠射角反射增益，轮廓浮出背景）
- **色彩分级**：split-tone 阴影微青、高光微暖，做在 sRGB 感知空间（线性空间做会把白车压成黑车）
- **细节**：unsharp mask 锐化，ACES 之前、线性空间
- **顶部柔光箱**：微冷白 + 下沿辉光梯度，替代硬边纯白光板
- **车灯**：DRL 冷白偏蓝、尾灯正红，emissive 与点亮强度单独调

## 已知踩坑

- 菲涅尔注入必须在主片元 `#include <lights_fragment_end>` 之后，且新 uniform 要手动 `shader.fragmentShader = 'uniform float uFresnel;\n' + ...` 声明——three 不会自动注入，漏了会 shader 编译失败、材质回退、整车变黑
- 往 GLSL 模板字符串的注释里写反引号会提前闭合模板串
- `model.glb` 44MB / `wheels.glb` 1.3MB，均随仓库分发，clone 首次会稍慢

## 素材来源

模型 BeamNG mod → Sketchfab；贴图 `textures/` 自备。`tools/convert-dae.html` 是当初的 DAE→GLB 转换器。
