# AutoLink v3.6.0 部署指南

## 环境准备

### Windows
```powershell
# 1. 安装 Node.js (>= 22)
winget install OpenJS.NodeJS.LTS

# 2. 安装 Python (>= 3.12)
winget install Python.Python.3.12

# 3. 安装 Python 依赖
pip install -r backend/requirements.txt

# 4. 克隆仓库
git clone https://github.com/bangbang8000-cell/AutoLink.git
cd AutoLink
npm install
```

### macOS
```bash
# 1. 安装 Node.js
brew install node

# 2. 安装 Python
brew install python@3.12

# 3. 安装 Python 依赖
pip3 install -r backend/requirements.txt

# 4. 克隆仓库
git clone https://github.com/bangbang8000-cell/AutoLink.git
cd AutoLink
npm install
```

### Linux (Ubuntu/Debian)
```bash
# 1. 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 安装 Python
sudo apt-get install -y python3 python3-pip

# 3. 安装 Python 依赖
pip3 install -r backend/requirements.txt

# 4. 克隆仓库
git clone https://github.com/bangbang8000-cell/AutoLink.git
cd AutoLink
npm install
```

## 开发模式

```bash
# 启动开发环境 (Vite HMR + Electron)
npm run dev:all

# 仅前端 (浏览器访问 http://localhost:5174)
npm run dev
```

## 构建安装包

> V3.0.0 起，`npm run dist:*` 前会自动执行 **PyInstaller** 打包 Python 引擎（`scripts/pyinstaller.spec`），产物输出到 `dist/backend-dist`，安装包无需用户预装 Python。

### Windows (NSIS 安装包)
```bash
npm run dist:win
# 输出: release/AutoLink-Setup-3.6.0-win.exe
```

### macOS (DMG)
```bash
npm run dist:mac
# 输出: release/AutoLink-3.6.0-mac-x64.dmg / AutoLink-3.6.0-mac-arm64.dmg
```

### Linux (AppImage + DEB)
```bash
npm run dist:linux
# 输出: release/AutoLink-3.6.0-linux.AppImage / .deb
```

## 生产部署

### 方式一：从安装包安装（推荐）

1. 前往 [Releases](https://github.com/bangbang8000-cell/AutoLink/releases) 下载对应平台安装包
2. **Windows**：双击 `.exe` 安装包，按向导安装
3. **macOS**：将 `.app` 拖入 Applications 文件夹
4. **Linux**：`chmod +x AutoLink-*.AppImage && ./AutoLink-*.AppImage` 或 `sudo dpkg -i AutoLink-*.deb`

安装后首次启动会自动创建 3 个示例项目（H100-100台/H100-128台/L20-推理-64），内置 19 套场景模板和 120 款设备库。

### 方式二：从源码运行

```bash
npm run build
npm start
```

## Python 引擎说明

AutoLink 通过子进程调用 Python 引擎（`backend/facade.py` CLI 入口），通信方式为 JSON stdin/stdout。

- 引擎在 `backend/` 目录下（打包后位于 `resourcesPath/backend`；V3.0.0+ 优先使用 PyInstaller 产物 `resourcesPath/backend-dist`，免 Python 运行）
- 开发模式默认使用系统 `python` 命令，Windows 支持 `py` launcher 回退
- 依赖见 `backend/requirements.txt`（pandas / openpyxl / reportlab），CI/打包额外使用 `backend/requirements-dev.txt`（pytest / PyInstaller）
- 支持 20+ 种 action（engine 注册表自动发现）：
  - `design`：生成拓扑（含 PUE/收敛比估算、三合一融合网、1 分 2 扇出）
  - `validate`：拓扑校验（22 条规则 V001-V022）
  - `export`：导出 Excel/PDF（连接表/布线表/BOM/设备清单/PDF 报告）
  - `estimate`：参数化 PUE/收敛比重新估算
  - `report`：生成完整报告数据
  - `pdfReport`：生成 PDF 报告
  - `capacity:recommend` / `capacity:list-presets`：容量规划（FP8 精确通信 / Pipeline 显存 / TCO 成本 / 17 档案含国产场景）
  - `atop:recommend`：ATOP 自动拓扑优化（模型通信特征 → ZCube 拓扑，V020 校验）
  - `optimize:suggest` / `optimize:apply`：批量优化（收敛比/成本/散热建议 + 应用）
  - `repair:plan` / `repair:apply`：智能修复（校验错误 → 修复 patch → 复核闭环）
  - `room:*`：机房智能落位（optimize / set-type / place）与矩阵管理

## 打包资源说明

V3.0.0 安装包内置以下资源（通过 `extraResources` 打包）：

| 资源 | 位置 | 说明 |
|------|------|------|
| 后端引擎 | `resourcesPath/backend-dist` | PyInstaller 打包产物（V3.0.0+，免 Python 运行） |
| 后端源码 | `resourcesPath/backend` | Python 引擎与算法（开发模式回退） |
| 模板 | `resourcesPath/template` | 19 套场景模板 |
| 设备库 | `resourcesPath/template/device_library` | 120 款设备 JSON |
| 光模块库 | `resourcesPath/template/device_library/optical_modules` | 35 款光模块（含 1 分 2 分裂线缆） |
| 用户指南 | `resourcesPath/docs` | Markdown 格式离线用户指南 |
| 品牌资源 | `resourcesPath/branding` | Logo SVG 与设计规范 |

首次启动时，应用会在 `userData/workspace` 目录自动创建 3 个示例项目。

## 自动更新机制

V2.7.0 对自动更新进行了彻底重构，解决国内网络环境下「检查到新版本但无法下载」的问题。

### 双通道检查

- **主通道**：`electron-updater` 模块（GitHub Releases 标准协议）
- **备用通道**：Electron `net` 模块直接请求 `latest.yml`/`latest-mac.yml`/`latest-linux.yml`（按平台选择），走 Chromium 网络栈，对国内网络更友好
- 主通道失败时自动切换备用通道，备用通道解析 `version` 字段判断是否新版本，同时解析 `path` 字段缓存下载信息

### 正向下载（V2.7.0 新增）

检测到新版本后，`downloadUpdate()` 按以下优先级正向下载：

1. **electron-updater 下载**：主通道成功时使用，支持断点续传与 SHA512 校验
2. **直接下载安装包**：主通道失败或备用通道检测时使用
   - 用 Electron `net` 模块直接下载安装包到本地「下载」目录
   - 手动处理 GitHub Releases 的 302 重定向（跟随到 `objects.githubusercontent.com`）
   - 实时发送下载进度到前端
   - 下载完成点击「重启安装」时调用 `shell.openPath` 启动安装程序并退出应用
3. **打开 Releases 页面**：上述均失败时的最终 fallback

### 关键文件

- `electron/services/update.service.ts`：更新服务核心（检查/下载/安装/降级）
- `electron/ipc/handlers.ts`：IPC 处理器（`app:check-update`/`app:download-update`/`app:quit-and-install`/`app:open-releases-page`）
- `src/components/layout/UpdatePopover.tsx`：顶部栏更新弹层 UI
- `src/components/layout/AboutDialog.tsx`：关于弹窗更新 UI

### 其他说明

- **依赖位置**：`electron-updater` 必须在 `dependencies`（非 `devDependencies`），否则打包后 asar 内模块缺失
- **更新源**：GitHub Releases（配置见 `package.json` 的 `build.publish`）
- **检测时机**：应用启动后自动检测（首次提示，可在设置中关闭）
- **手动检查**：菜单「帮助 → 检查更新」或关于对话框中点击「检查更新」

## 数据持久化

V2.6.2+ 拓扑与机柜数据按项目持久化：

| 文件 | 位置 | 说明 |
|------|------|------|
| `topology.json` | 项目根目录 | 拓扑节点/边/摘要/校验/估算 |
| `rack_layout.json` | 项目根目录 | 机柜布局（防抖 500ms 自动保存） |
| `network_config.ini` | 项目根目录 | V2.0 格式网络配置（向后兼容） |
| `project_config.json` | 项目根目录 | V2.1+ 格式项目配置（优先读取） |

- 切换项目时自动加载对应拓扑/机柜数据
- 项目导出/导入 ZIP 完整保留拓扑与机柜数据
- 旧项目无 `topology.json` 显示「尚未生成拓扑」

## 设计流程

1. 在**项目浏览器**中创建或选择一个项目（或使用内置示例/从模板创建）
2. 进入**拓扑设计**面板，配置网络参数（GPU 数量 / 交换机端口 / 网络速度等）
3. 点击「生成拓扑」调用 Python 引擎计算
4. 查看设计摘要（Leaf/Spine 数量、总交换机数、收敛比）
5. 查看 **PUE 估算**面板（能耗分解、达标判断、参数调整）
6. 切换到**拓扑可视化**查看网络拓扑图（react-flow 渲染，支持拖拽/缩放/小地图）
7. 在**机柜规划**中分配设备上架位置（自动保存到 `rack_layout.json`）
8. 在**工作台**中选择输出类型并渲染导出：
   - 连接表（Excel）
   - 布线指导表（Excel，含光模块型号与成本）
   - BOM 成本估算（Excel）
   - 设备清单（Excel）
   - PDF 报告（6 章节）
   - 报告视图（内置，可折叠查看）

## CI/CD 自动构建

### 触发 CI 检查
向 `main` 分支推送代码或创建 PR 自动运行：
- TypeScript 类型检查
- ESLint 代码检查
- Vite 前端构建 + Electron 主进程/preload 编译
- 前端 vitest 测试（520 cases）
- 后端 pytest 测试（1010 cases）
- 模板验证（`validate_templates.py`，19 模板）
- golden 基线比对（`gen_golden.py --check`）

### 触发 Release 构建
```bash
# 1. 更新 package.json version（含 VERSION 文件）
# 2. 提交代码（含 [skip ci] 避免触发 Actions 编译）
git commit -m "chore: v3.6.0 版本号更新 [skip ci]"
# 3. 合并到 main 后打 tag 并推送（tag 推送即触发 build.yml 三平台编译 + 自动创建 Release）
git checkout main && git merge --no-ff feat/3.6.0-polish
git push origin main
git tag v3.6.0
git push origin v3.6.0
```

GitHub Actions 自动构建三平台安装包并发布到 Releases 页面：
- **Windows**：NSIS `.exe` 安装包
- **macOS**：DMG（x64 + arm64）
- **Linux**：AppImage + DEB

> 注意：tag 必须推送在 `main`（默认分支）路径上才会触发 `build.yml`（`on.push.tags: ['v*']`）；打在未合并分支上的 tag 不会触发。
> 构建矩阵配置见 [.github/workflows/build.yml](../.github/workflows/build.yml)。

## 常见问题

**Q: Python 引擎报错 "No module named 'openpyxl'"**
```bash
pip install openpyxl pandas reportlab
```

**Q: Electron 窗口无法启动**
确保 Node.js >= 22, Electron 28 需要对应版本的 Node。

**Q: npm install 失败**
```bash
# 清除缓存重试
rm -rf node_modules package-lock.json
npm install
```

**Q: 如何在 Windows 上设置 Python 路径**
确保 Python 已添加到系统 PATH 环境变量，应用会依次尝试 `python` / `python3` / `py` 命令。

**Q: 安装后看不到设备库或模板**
V2.6 安装包已内置所有资源。若从源码运行，确保 `template/` 目录完整。打包后资源位于 `resourcesPath/` 下，应用会自动定位。

**Q: PUE 估算面板不显示**
PUE 估算在生成拓扑后自动显示。若未显示，检查设计摘要是否生成成功（后端 `estimation` 字段）。

**Q: react-flow 拓扑图加载白屏**
确保依赖已正确安装：`npm install @xyflow/react`。V2.6 使用 react-flow 12.x 替代 ECharts 拓扑渲染。

**Q: 更新功能提示"已是最新版本"但实际有新版本**
V2.6.2 已修复此问题（`electron-updater` 依赖位置错误）。V2.7.0 进一步重构为双通道检查 + 正向下载。请确保使用 V2.7.0 及以上版本。旧版本需手动下载最新安装包一次。

**Q: 检查到新版本后点击下载无反应或下载失败**
V2.7.0 已彻底解决此问题：检测到新版本后程序会直接下载安装包到本地「下载」目录（支持 GitHub 302 重定向跟随），下载完成点击「重启安装」即可启动安装程序。若网络完全无法访问 GitHub，可点击「手动下载」打开 Releases 页面。

**Q: 切换项目后拓扑/机柜数据还是上一个项目的**
V2.6.2+ 已修复此问题，拓扑和机柜数据按项目持久化到 `topology.json` / `rack_layout.json`。请确保使用 V2.6.2 及以上版本。

**Q: 工作区 Tab 状态丢失**
Tab 状态持久化在 localStorage，可通过设置面板「Reset Workspace」按钮重置。V2.6.1+ 加载时会校验项目存在性，无效 tabs 自动过滤。
