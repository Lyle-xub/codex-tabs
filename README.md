# Codex Tabs

给 macOS Codex 桌面端增加顶部任务标签栏的小型运行时 hack。

项目同时提供原生的 **Codex Tabs.app** 菜单栏管理器，可在软件内启停注入器、调整外观并管理各项功能开关；应用不会出现在 Dock 中。

管理器包含原创的三层标签线条图标、“关于与支持”纵向卡片、每日自动检查 GitHub Releases、
手动检查更新及 Donate 入口。Donate 面板支持支付宝、微信收款码和 GitHub Sponsors 链接；正式发布前可在 `macos/Info.plist` 中替换更新源和 Sponsors 地址。
语言选项支持在中文与 English 之间即时切换，并同步应用到菜单栏弹窗、完整设置页、运行状态、
Codex 内的任务标签、悬浮用量卡片和同窗任务提示。

它不会修改 `/Applications/Codex.app`、`app.asar` 或应用签名，而是通过仅监听
`127.0.0.1` 的 Chromium DevTools 端口注入一段 JavaScript/CSS。Codex 更新后，
只要任务列表的 DOM 结构没有彻底改变，工具仍可继续使用。

> 这是一个非官方、实验性质的个人研究项目，与 OpenAI 无隶属或授权关系。请仅在自己有权
> 控制的设备和 Codex 会话中使用。项目不绕过账号权限、订阅限制或服务端安全机制。

## 我的破解思路

这里的“破解”不是修改 Codex 安装包，也不是逆向并替换签名后的二进制，而是利用 Codex
桌面端基于 Chromium/Electron 渲染页面这一事实，在运行时给现有界面增加一层可撤销的 UI。
整体思路可以拆成五层：

1. **先找到真实 Codex，而不是猜应用名称。** 启动器会遍历常见应用目录并读取
   `Info.plist`，以 bundle id `com.openai.codex` 识别应用，因此新版即使显示为
   `ChatGPT.app` 也能找到正确的可执行文件。
2. **只开放本机调试入口。** 启动 Codex 时分配一个随机空闲端口，并传入
   `--remote-debugging-port` 和 `--remote-debugging-address=127.0.0.1`。端口不监听局域网，
   也不会写入或重签名 Codex 的 `app.asar`。
3. **通过 CDP 注入可撤销的前端补丁。** Node 启动器从 `/json/list` 找到 renderer，使用
   Chrome DevTools Protocol 的 `Runtime.evaluate` 注入 [`src/injected.js`](src/injected.js)。
   注入脚本创建独立根节点、样式和事件监听；退出时调用 `destroy()`，可以把新增 DOM、监听器
   和计时器完整移除。
4. **复用原生任务入口，而不是复制业务状态。** 脚本从稳定的 `data-testid`、任务链接和
   ARIA 语义中识别侧边栏任务。点击自定义标签时，实际触发 Codex 原生任务入口，因此路由、
   会话状态和权限仍由 Codex 自己管理。`MutationObserver` 监听页面变化并重新渲染标签，
   `localStorage` 只保存标签顺序、关闭状态、面板宽度等纯 UI 数据。
5. **从本地会话记录补充状态。** [`src/usage.mjs`](src/usage.mjs) 只读扫描
   `~/.codex/sessions` 和 `~/.codex/archived_sessions` 的 JSONL 尾部，把 token、缓存输入、
   上下文窗口和额度快照回传给悬浮卡片。它按文件修改时间与大小缓存，不上传会话内容。

同窗任务是这套思路中实验性最强的一层：它在同一个 renderer 内创建同源 iframe，加载第二套
Codex 前端，并转发顶层 preload 的入站消息。这样可以在不创建第二个 BrowserWindow 的情况下
显示另一个任务；代价是它依赖当前前端入口和消息协议，Codex 更新后比普通标签栏更容易失效。

这套方案的核心取舍是：**不追求永久修改，而追求低侵入、易撤销、可快速适配。** Codex 的
DOM 或消息协议变化时，只需要更新任务发现与桥接适配器，不需要重新修改官方应用包。

### 运行链路

```text
Codex Tabs.app（SwiftUI 菜单栏管理器）
        │ 启停、配置、打包 Node 运行时
        ▼
Node 启动器 ── 127.0.0.1 随机 CDP 端口 ──► Codex renderer
        │                                        │
        │ 只读解析本地 JSONL                     │ 注入 JS/CSS、复用原生导航
        ▼                                        ▼
Token / 状态数据                           标签栏、悬浮卡片、同窗任务
```

### 主要代码位置

- [`src/cli.mjs`](src/cli.mjs)：发现、启动或连接 Codex，维护 renderer 与配置同步。
- [`src/cdp.mjs`](src/cdp.mjs)：最小 CDP WebSocket 客户端。
- [`src/injected.js`](src/injected.js)：标签栏、拖动、悬浮卡片、纵向栏与同窗任务。
- [`src/usage.mjs`](src/usage.mjs)：只读会话用量解析器。
- [`macos/CodexTabsManager`](macos/CodexTabsManager)：原生 SwiftUI 菜单栏管理软件。
- [`scripts/build-macos-app.sh`](scripts/build-macos-app.sh)：构建并临时签名 `.app`。

## 已实现

- 将侧边栏任务镜像到窗口顶部
- 点击标签切换原任务
- 同步当前标签和工作中/完成状态
- 拖动标签调整顶部显示顺序（保存在 Codex 页面本地存储中）
- `Control+1`～`Control+9` 在 Codex 任意区域切换标签
- 单击（按下主键）立即切换标签
- `×` 和 `Control+W` 只关闭顶部标签，不归档或删除任务
- 点击标签栏的下拉图标可从列表重新打开已关闭的标签；`Control+Shift+T` 恢复最近关闭的标签
- 从侧边栏再次打开任务时，已关闭的顶部标签会恢复
- 悬浮标签显示运行状态、累计 token、缓存命中、当前上下文和额度使用
- 悬浮卡片实时显示当前工作，如思考、修改代码、执行命令或处理工具结果
- 运行中任务会实时显示运行时长和当前步骤，如“正在运行，3分24秒”“当前步骤：执行 xcodebuild”
- Token 使用率显示当前标签最近上下文占模型上下文窗口的比例
- 显示非缓存输入、账号剩余额度，以及任务期间剩余额度变化（并行任务下为估算值）
- 仅在任务详情页显示标签栏，进入其他 Codex 页面时自动隐藏
- 左侧原生侧边栏折叠时自动切换为任务区左侧纵向标签栏，重新展开后恢复顶部横向布局
- 持久保存标签标题、顺序、当前标签和关闭状态；重启时即使侧边栏已隐藏也能恢复纵向标签栏
- 历史纵向标签通过 Codex 原生侧栏导航切换任务；纵向栏避开左侧原生控制轨道
- 打开项目或目录预览时暂时隐藏纵向标签栏，关闭预览后自动恢复
- 长按标签约 350ms 后可拖动虚影排序，支持越界拖动与边缘自动滚动
- 当前标签使用蓝色描边、淡蓝背景、光晕和加粗文字高亮
- 管理软件可自由设置当前标签的高亮颜色、背景/描边/阴影强度和标签圆角
- 悬浮预览内容可逐项选择：标题、运行状态、当前步骤、Token、输入、输出、缓存、上下文、额度和进度条
- 侧边栏暴露新建按钮时显示 `+`
- 页面刷新、窗口新增后自动重连和重新注入
- 悬浮标签后点击 `◫`，可在同一个 Codex renderer 的右半边启动第二套任务界面（实验功能）
- 同窗任务支持键盘、鼠标、复制和滚动；关闭面板不会归档任务或创建第二窗口
- 拖动同窗面板左边缘可调整宽度并自动记忆，双击分隔条恢复 50%
- `Control-C` 安全移除标签栏；不会退出 Codex

## 运行

### 使用 macOS 管理软件（推荐）

已构建的应用位于：

```text
dist/Codex Tabs.app
```

首次使用时，先在 Codex 中按 `⌘Q` 正常退出，再打开 Codex Tabs，点击菜单栏图标并选择“启动 Codex Tabs”。
应用启动后只常驻菜单栏，不显示 Dock 图标；通过“打开管理面板…”进入完整设置。
管理软件包含运行所需的 Node.js，无需另外打开终端。功能页可以管理用量悬停及其具体内容、
快捷键、拖动排序、同窗任务、纵向面板和目录预览避让；外观页可以设置标签高亮颜色与强度，
以及纵向面板的透明度、宽度、上下间距和圆角。

重新构建应用：

```bash
cd codex-tabs
npm run build:mac
```

应用采用本地临时签名，配置保存在 `~/Library/Application Support/Codex Tabs/config.json`。
GitHub Releases 中的 ZIP 解压后即可得到 `Codex Tabs.app`。由于当前构建采用临时签名且未进行
Apple 公证，首次启动可能需要在 Finder 中右键选择“打开”，并在系统提示中确认。

### 从终端运行

要求 Node.js 22 或更高版本。本项目没有第三方依赖，无需 `npm install`。

1. 正常退出当前 Codex（`⌘Q`，不要强制结束）。
2. 在终端执行：

   ```bash
   cd codex-tabs
   npm start
   ```

3. 保持这个终端进程运行。按 `Control-C` 会移除注入的标签栏，但 Codex 继续运行。

Electron 的单实例机制不会给一个已经运行的 Codex 补加调试参数，所以第 1 步不能省略。
启动器会根据 bundle id `com.openai.codex` 自动识别 `Codex.app` 或新版名称
`ChatGPT.app`。

如果应用装在自定义位置，可以手动指定 `.app` 或其可执行文件：

```bash
CODEX_APP_PATH="/自定义位置/ChatGPT.app" npm start
```

## 先看离线演示

```bash
cd codex-tabs
npm run demo
```

然后打开 <http://127.0.0.1:41739>。演示页不连接或修改真实 Codex。

## 连接手动启动的 Codex

如果 Codex 已经通过固定端口启动：

```bash
/Applications/Codex.app/Contents/MacOS/Codex \
  --remote-debugging-port=9229 \
  --remote-debugging-address=127.0.0.1

cd codex-tabs
npm run attach -- 9229
```

## 验证代码

```bash
npm run check
npm test
```

## 打包发布

```bash
npm run build:mac
mkdir -p release
ditto -c -k --sequesterRsrc --keepParent \
  "dist/Codex Tabs.app" "release/Codex-Tabs-0.36.0-macOS.zip"
```

构建脚本会编译 SwiftUI 管理器、生成应用和菜单栏图标、复制 Node 运行时与注入脚本、放入捐赠
二维码资源，最后对应用执行本地临时签名。发布前建议在干净的 macOS 用户环境中再次验证启动、
标签注入、二维码扫码和 `Control-C` 清理流程。

## 兼容性与安全

查找任务的逻辑集中在 [`src/injected.js`](src/injected.js) 的 `findTabs()` 中，依次尝试
稳定的 `data-testid`、任务链接和 ARIA tab。Codex 更新后若显示“暂未识别到侧边栏任务”，
应优先在这里增加新版本适配器，不要依赖压缩 CSS 类名。

调试端口具有页面控制权限。工具使用随机端口并显式绑定 `127.0.0.1`，不要把参数改成
`0.0.0.0`，也不要把端口转发到局域网或公网。

用量悬浮卡片只读解析 `~/.codex/sessions` 与 `~/.codex/archived_sessions` 中对应任务的
本地 JSONL 记录，不上传数据。累计 token 是历次模型请求的累计值；“当前上下文”来自
最近一次请求，不能与累计值直接比较。读取器只读取文件末尾并按修改时间缓存，避免重复
扫描完整会话历史。

同窗任务使用同源 iframe 加载 Codex 自带的前端入口，并把顶层 preload 的入站消息复制给
第二套界面。它不会修改或重签名 `app.asar`，也不会创建第二个 BrowserWindow。该能力依赖
Codex 当前的前端入口和消息协议，应用更新后可能需要适配。
