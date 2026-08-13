# AutoLink Logo 设计规范与绘制逻辑

> **版本**:v3.2.1 增强版（本文档于 v3.4.3 同步，规格与 `build/logo.svg` 一致）
> **主矢量源**:`build/logo.svg`(512×512)
> **运行时源**:`public/icons/logo.svg`
> **本文件目的**:记录 Logo 的绘制逻辑、几何规格与两个已验证的 SVG 渲染陷阱,作为程序发布的一部分,确保品牌升级时有源可改、有规可循。

---

## 1. 设计理念

AutoLink Logo 由字母 **"A"**(AutoLink 首字母)与**网络拓扑节点**双重语义融合构成:
- **倒 V 两条腿**:构成 A 的主体轮廓,象征连接与架构
- **横线**:贯穿两腿外侧,完成 A 字识别,象征横向连通
- **5 个白色端点圆圈**:标记 A 的顶点、两底角、横线两端,呼应"网络拓扑节点"
- **5 个高光小圆点**:叠加于端点内侧,强化"发光节点/数据点"科技感(增强版新增)

**增强版(v3.2.1 起)**:在 v2.5.0 扁平版(蓝底白主体)基础上升级为 **天空蓝→蓝→紫罗兰三色渐变** 背景 + 玻璃高光(sheen) + 内描边,腿/横线改为同色系渐变描边并带辉光,节点带辉光——强化"AI 智算中心"的品牌调性,与产品 4 主题色体系(默认 sky)一致。

---

## 2. 几何规格(增强版定稿)

| 元素 | 规格 |
|---|---|
| 画布 | 512×512,viewBox `0 0 512 512` |
| 背景圆角方块 | `x=16 y=16 w=480 h=480 rx=104`,渐变 `#0EA5E9 → #2563EB → #7C3AED`(对角,`userSpaceOnUse`) |
| 玻璃高光 | 同区域叠加 `bgSheen` 渐变(白 0.28→0.04→0,对角) |
| 内描边 | `x=20 y=20 w=472 h=472 rx=100`,白 `#FFFFFF` 透明度 0.16,stroke-width=3 |
| 倒 V 两条腿 | `M 160 392 L 256 120 L 352 392`,stroke-width=40,渐变 `#7DD3FC→#FFFFFF→#C4B5FD`,round cap/join,带辉光(stdDeviation=4) |
| 横线 | `M 112 260 L 400 260`,stroke-width=40,渐变 `#7DD3FC→#FFFFFF→#C4B5FD`,round cap,**无辉光**(硬约束,见第 4 节) |
| 顶点圆圈 | cx=256 cy=120 r=18,纯白填充,带辉光(stdDeviation=6) |
| 左底角圆圈 | cx=160 cy=392 r=18,纯白填充,带辉光 |
| 右底角圆圈 | cx=352 cy=392 r=18,纯白填充,带辉光 |
| 横线左端圆圈 | cx=112 cy=260 r=18,纯白填充,带辉光 |
| 横线右端圆圈 | cx=400 cy=260 r=18,纯白填充,带辉光 |
| 高光小圆点 ×5 | `(256,112)(152,384)(344,384)(104,252)(392,252)`,r=5,纯白填充,无辉光 |
| 腿辉光 | `feGaussianBlur stdDeviation=4` + feMerge |
| 节点辉光 | `feGaussianBlur stdDeviation=6` + feMerge |
| 横线辉光 | **无**(硬约束,见第 4 节) |
| 大圆圈尺寸 | 全部统一 r=18(小尺寸下保证至少部分可见) |
| 横线长度 | 288px(400-112),与单条腿长度(≈288.4)等长 |
| 横线位置 | y=260(画布 60% 处),穿出腿外侧约 75px |

---

## 3. 完整 SVG 源码(增强版绘制逻辑)

```xml
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#0EA5E9"/>
      <stop offset="55%" stop-color="#2563EB"/>
      <stop offset="100%" stop-color="#7C3AED"/>
    </linearGradient>
    <linearGradient id="bgSheen" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.28"/>
      <stop offset="45%" stop-color="#FFFFFF" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="legGrad" x1="160" y1="392" x2="352" y2="120" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#7DD3FC"/>
      <stop offset="55%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#C4B5FD"/>
    </linearGradient>
    <linearGradient id="barGrad" x1="112" y1="260" x2="400" y2="260" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#7DD3FC"/>
      <stop offset="50%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#C4B5FD"/>
    </linearGradient>
    <filter id="glowLeg" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="nodeGlow" x="-120%" y="-120%" width="340%" height="340%">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="104" fill="url(#bgGrad)"/>
  <rect x="16" y="16" width="480" height="480" rx="104" fill="url(#bgSheen)"/>
  <rect x="20" y="20" width="472" height="472" rx="100" fill="none" stroke="#FFFFFF" stroke-opacity="0.16" stroke-width="3"/>
  <g filter="url(#glowLeg)">
    <path d="M 160 392 L 256 120 L 352 392" fill="none" stroke="url(#legGrad)" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <path d="M 112 260 L 400 260" fill="none" stroke="url(#barGrad)" stroke-width="40" stroke-linecap="round"/>
  <g filter="url(#nodeGlow)" fill="#FFFFFF">
    <circle cx="256" cy="120" r="18"/>
    <circle cx="160" cy="392" r="18"/>
    <circle cx="352" cy="392" r="18"/>
    <circle cx="112" cy="260" r="18"/>
    <circle cx="400" cy="260" r="18"/>
  </g>
  <g fill="#FFFFFF">
    <circle cx="256" cy="112" r="5"/>
    <circle cx="152" cy="384" r="5"/>
    <circle cx="344" cy="384" r="5"/>
    <circle cx="104" cy="252" r="5"/>
    <circle cx="392" cy="252" r="5"/>
  </g>
</svg>
```

---

## 4. SVG 渲染陷阱(已验证,务必规避)

### 陷阱 1:水平线的渐变模式失效

**错误写法**(横线会渲染为透明/不可见):
```xml
<linearGradient id="barGrad" x1="0%" y1="0%" x2="100%" y2="0%">
```

**根因**:默认 `gradientUnits="objectBoundingBox"` 基于元素包围盒计算渐变。水平线 `M 112 260 L 400 260` 的包围盒高度为 0,属于退化包围盒,浏览器无法计算渐变方向,导致横线透明。

**正确写法**:
```xml
<linearGradient id="barGrad" x1="112" y1="260" x2="400" y2="260" gradientUnits="userSpaceOnUse">
```

**规则**:**所有 `linearGradient` 必须使用 `gradientUnits="userSpaceOnUse"` + 绝对坐标**,不可依赖默认的 `objectBoundingBox`。本 Logo 全部 4 个渐变(bgGrad/bgSheen/legGrad/barGrad)均采用此模式。

### 陷阱 2:filter 辉光互相遮挡

**错误写法**(横线中间段被腿辉光"洗"成背景色而消失):
```xml
<g filter="url(#glow)">
  <path d="横线"/>   <!-- 横线带辉光 -->
</g>
<g filter="url(#glow)">
  <path d="腿"/>     <!-- 腿也带辉光 -->
</g>
```

**根因**:即使横线画在腿之上,腿的辉光在两腿之间形成光晕,与横线辉光叠加,把横线中间段洗成背景色。即使是极弱的辉光(stdDeviation=1.5)也会触发此问题(已两次验证)。

**正确写法**:**横线不带任何 filter**,仅腿带辉光:
```xml
<g filter="url(#glowLeg)">
  <path d="腿"/>
</g>
<path d="横线" filter="无"/>   <!-- 横线锐利渲染,无 filter -->
```

**规则**:**横线严禁加任何 filter**,否则被腿辉光在两腿间隙遮挡而消失。腿保留辉光(stdDeviation=4)增加立体感;节点独立辉光(stdDeviation=6)与腿辉光互不重叠,可安全使用。

> 增强版注意:背景高光 `bgSheen` 与内描边为整幅叠加层,不影响辉光判定;两个 filter(glowLeg/nodeGlow)作用区域无重叠,符合陷阱 2 的规避要求。

---

## 5. 多尺寸输出物

由 `scripts/generate-icons.mjs` 从 `build/logo.svg` 生成:

| 文件 | 尺寸 | 用途 | 格式要求 |
|---|---|---|---|
| `build/logo.svg` | 512×512 | 主矢量源 | SVG |
| `build/icon.png` | 1024×1024 | electron-builder 主图标 | PNG |
| `build/icon.ico` | 16/32/48/64/128/256 | Windows 任务栏/安装包 | **合法 ICO(文件头 `00 00 01 00`),不可 PNG 改名** |
| `build/icon.icns` | 多尺寸 | macOS | 由 electron-builder 生成 |
| `public/icons/logo.svg` | 512×512 | 运行时引用(关于弹窗/顶部 Header 等) | SVG |
| `public/icons/icon.png` | 512×512 | 运行时引用(主窗口任务栏图标) | PNG |
| `public/splash.html` 内嵌 SVG | — | 启动屏 | 同步替换内嵌 SVG |
| `resourcesPath/branding/logo.svg` | 512×512 | **随程序发布的 Logo 绘制源码**(由 extraResources 打包) | SVG |
| `resourcesPath/branding/logo_specification.md` | — | **随程序发布的本规范文档**(由 extraResources 打包) | Markdown |

> 用户可在「关于 AutoLink」弹窗点击「Logo 设计规范」链接,经 `app:showBrandingAsset` IPC 在系统文件管理器中直达 `branding/` 目录,查看/二次创作 Logo 绘制逻辑。开发环境下分别指向 `build/logo.svg` 与 `docs/v2.5/logo_specification.md`。

### 重新生成图标

```bash
node scripts/generate-icons.mjs
```

依赖:`@resvg/resvg-js`(SVG→PNG)、`png-to-ico`(PNG→ICO)。

---

## 6. 尺寸适配规范

| 最小尺寸 | 用途 | 可见性预期 |
|---|---|---|
| 16px | favicon / 任务栏 | A 轮廓可辨,5 节点可能不可见(可接受) |
| 32px | 任务栏 | A 轮廓清晰,节点开始可见 |
| 48px | 桌面快捷方式 | A 完整,节点清晰 |
| 80px | 关于弹窗 | 完整展示 |
| 120px | 启动屏 | 完整展示 |

**安全区**:Logo 主体居于 80% 安全区内,圆角背景留 16px 边距。增强版内描边位于安全区边界内(rx=100),不缩小有效视觉面积。

---

## 7. 背景适配

- **主用法**:天空蓝→蓝→紫罗兰渐变底白主体(本 Logo 默认)
- **深色背景**:渐变底白主体可直接使用
- **浅色背景**:渐变底白主体可直接使用(渐变足够醒目)
- **水印/单色场景**:使用纯白或纯深蓝 `#0F172A` 单色版(去除渐变与辉光)

---

## 8. 修改与品牌升级流程

1. 修改 `build/logo.svg`(遵循第 2 节规格与第 4 节陷阱规避)
2. 同步修改 `public/icons/logo.svg`(关于弹窗/Header 引用)
3. 运行 `node scripts/generate-icons.mjs` 重新生成 icon.png/icon.ico/public/icons/icon.png
4. 同步更新 `public/splash.html` 内嵌 SVG
5. 更新本规范文档(如规格变更)
6. 三平台构建验证图标

**切勿**:
- 给横线加任何 filter(第 4 节陷阱 2)
- 使用默认 `objectBoundingBox` 渐变模式(第 4 节陷阱 1)
- 用 PNG 改名为 .ico(必须合法 ICO 格式)
- 删除 5 个端点圆圈(品牌辨识特征)

---

## 9. 版本演进

| 版本 | 说明 |
|---|---|
| v2.5.0 | 扁平版定稿:纯蓝渐变背景 `#0EA5E9→#2563EB`、纯白腿/横线、5 个端点圆 |
| v3.2.1 | 品牌主题升级:天空蓝→蓝→紫罗兰三色渐变背景 + 玻璃高光 + 内描边 + 腿/横线渐变 + 腿/节点辉光 + 5 个高光小圆点 |
| v3.4.3 | 全渠道 logo 一致性修复:重新生成安装包/桌面/任务栏图标、同步 splash 内嵌 SVG 与版本号,本文档同步至增强版规格 |
