# AutoLink V2.3 部署指南

## 环境准备

### Windows
```powershell
# 1. 安装 Node.js (>= 22)
winget install OpenJS.NodeJS.LTS

# 2. 安装 Python (>= 3.10)
winget install Python.Python.3.12

# 3. 安装 Python 依赖
pip install openpyxl pandas

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
pip3 install openpyxl pandas

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
pip3 install openpyxl pandas

# 4. 克隆仓库
git clone https://github.com/bangbang8000-cell/AutoLink.git
cd AutoLink
npm install
```

## 开发模式

```bash
# 启动开发环境 (Vite HMR + Electron)
npm run dev:all

# 仅前端 (浏览器访问 http://localhost:5173)
npm run dev
```

## 构建安装包

### Windows (NSIS 安装包)
```bash
npm run dist:win
# 输出: release/AutoLink-Setup-2.3.0.exe
```

### macOS
```bash
npm run dist:mac
# 输出: release/AutoLink-2.3.0-mac.zip
```

### Linux
```bash
npm run dist:linux
# 输出: release/AutoLink-2.3.0.AppImage / .deb
```

## 生产部署

### 方式一：从安装包安装 (推荐)

1. 下载对应平台的安装包
2. Windows: 双击 `.exe` 安装包，按向导安装
3. macOS: 将 `.app` 拖入 Applications 文件夹
4. Linux: `chmod +x AutoLink-*.AppImage && ./AutoLink-*.AppImage`

### 方式二：从源码运行

```bash
npm run build
npm start
```

## Python 引擎说明

AutoLink 通过子进程调用 Python 引擎 (`backend/engine.py`)，通信方式为 JSON stdin/stdout。

- 引擎在 `backend/` 目录下
- 默认使用系统 `python` 命令
- 需要 `openpyxl` 和 `pandas` 依赖
- 可通过 `backend/network_config.ini` 配置默认网络参数

## 设计流程

1. 在**项目浏览器**中创建或选择一个项目
2. 进入**拓扑设计**面板，配置网络参数 (GPU 数量 / 交换机端口 / 网络速度等)
3. 点击「生成拓扑」调用 Python 引擎计算
4. 查看设计摘要 (Leaf/Spine 数量、总交换机数)
5. 切换到**拓扑可视化**查看网络拓扑图
6. 在**机柜规划**中分配设备上架位置
7. 在**输出结果**中导出 Excel 文件

## CI/CD 自动构建

### 触发 CI 检查
向 `main` 分支推送代码或创建 PR 自动运行：
- TypeScript 类型检查
- ESLint 代码检查
- Vite 前端构建

### 触发 Release 构建
```bash
# 打 tag 并推送
git tag v2.0.0
git push origin v2.0.0
```
GitHub Actions 自动构建 Windows 安装包并发布到 Releases 页面。

## 常见问题

**Q: Python 引擎报错 "No module named 'openpyxl'"**
```bash
pip install openpyxl pandas
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
确保 Python 已添加到系统 PATH 环境变量，或在用户目录创建 `.autolinkrc` 指定路径。
