# 设计:打开本机文件超链接(file:// / 绝对路径 / 自定义协议)

- 日期:2026-06-27
- 任务:`d457c986`「反馈:文件超链接无法打开(本机的文件地址)」
- 分支:`release/open-local-file-links`

## 问题

Berth 渲染的 markdown(聊天记录、任务上下文文档等)里若包含指向**本机文件地址**的超链接,点击无反应:

- 主场景是**浏览器访问 localhost**(`berth start` 后浏览器开 `http://127.0.0.1:7777/app/`)。浏览器出于安全策略禁止从 http 页面导航到 `file://` 或任意本机绝对路径,点击被静默拦死。
- 桌面 App(Electron)模式下 `setWindowOpenHandler` 把 `file://` 交给 `shell.openExternal`,无法正确打开本机文件。

现状(调研结论):`web/src/components/Markdown.tsx` 用 `marked` 渲染、DOMPurify 清洗,`<a>` 标签**无任何点击拦截**;后端 `src/` **无打开本机文件的端点**。

## 目标 / 验收标准

- 在**浏览器**和 **Electron 桌面 App** 两种模式下,点击 markdown 中的本机文件链接都能用**系统默认 App 打开**(macOS `open`)。
- 支持三种链接形态:
  - `file://…`(标准本地文件 URL)
  - 裸绝对路径 `/…` 与家目录 `~/…`
  - 自定义协议 `obsidian://…`、`vscode://…` 等已在系统注册的 scheme
- 普通 `http`/`https` 链接行为不变(新标签页打开)。
- 跨站本地网页无法借 loopback 端点打开任意文件(安全约束)。

## 非目标(YAGNI)

- 不做「在 Finder 中定位(reveal)」「指定用某编辑器打开」等可选行为——本期只做「系统默认 App 打开」。
- 不改 `public/`(已冻结的 1.0 前端)。
- 不为 Windows/Linux 做专门验收(按平台兜底实现,但仅在 macOS 验收)。**已知缺口**:win32 的 `cmd /c start` 分支存在命令注入面(见后端 ② 设计内的 ⚠️ 说明),Windows 正式支持前必须先加固,勿当作已就绪。

## 方案

统一的「宿主机打开」方案:前端拦截本机链接点击 → POST 给后端 → 后端用宿主机命令打开。因为 `berth start` 的服务进程就跑在用户本机,后端 `open` 既能开文件、又能转交已注册协议。浏览器与 Electron **共用同一条后端路径**,无需改 `electron/main.cjs`。

(已否决的备选:仅 Electron IPC + `shell.openPath` 帮不到浏览器主场景;纯前端 rewrite/`window.open` 在浏览器中根本无法访问本机文件。)

### ① 后端:`POST /api/open-local`

- 位置:`src/server/`(沿用现有 REST 路由风格,与既有 `/api/*` 端点同处)。
- 入参:JSON `{ target: string }`。
- 归一化 `target` → 可打开目标:
  - `file://…` → 解码成本地文件路径
  - `~/…` → 展开为 `$HOME/…`
  - 裸 `/…` → 原样
  - `scheme://…`(非 file 的已注册协议,如 `obsidian://`、`vscode://`)→ 原样透传给 `open`
- 打开:用 `execFile`(**数组传参,不经 shell**,杜绝命令注入):
  - darwin → `open <target>`
  - linux → `xdg-open <target>`
  - win32 → `cmd /c start "" <target>` ⚠️ **已知未验收缺口**:`cmd.exe` 会二次解析命令行,`<target>` 中的 `& | ^ "` 等元字符可越权执行——Windows 非本期验收平台(见非目标),此分支按兜底实现随包发布但**未做注入加固**。不能用「拒绝元字符」来挡,因为 `&` 等在 macOS(本期目标平台)是合法文件名字符,拒绝会误伤真实目标。Windows 正式支持时须改用不二次解析的打开方式(如 `Start-Process` 绑定参数)。
- 校验与错误:
  - `target` 必须为非空字符串,否则 `400`。
  - 对文件路径形态(file:// / 绝对 / ~)做存在性检查,不存在返回 `404` 结构化错误;协议透传形态不检查存在性。
  - `execFile` 失败返回 `500` 结构化错误 `{ ok:false, error }`。
  - 成功返回 `{ ok:true }`。
- **安全**:
  - 服务已绑 loopback(`127.0.0.1`)。
  - 校验请求 `Origin` 头的 **hostname 为 loopback**(`127.0.0.1` / `localhost` / `::1`,**端口不限**),否则返回 `403`;缺失 `Origin`(非浏览器客户端如 curl/Electron)放行。**有意放宽到「任意 loopback 端口」**而非精确 origin:开发态前端跑在 Vite(`localhost:5173`)、API 在另一端口,精确匹配会打断 dev。跨端口的其它本地网页仍被下一条 `application/json` 预检挡住。
  - 端点**显式只接受 `application/json`**(路由内 `req.is('application/json')` 校验,非则 `415`)。这既是防御纵深,也不再依赖「`express.json` 是唯一 body parser」这一隐式前提:`application/json` 属非简单请求,跨站调用会触发浏览器 CORS 预检,而本服务不应答预检 → 被浏览器拦下。

### ② 前端:Markdown 链接点击拦截

- 位置:`web/src/components/Markdown.tsx`。
- 在渲染容器上挂 `onClick` 事件委托:从 `event.target` 向上找最近的 `<a>`。
- 判定「本机链接」依据 `anchor.getAttribute('href')`(**取原始 href**,避免浏览器把 `/Users/…` 解析成同源 URL):
  - `file://` 开头 → 是
  - `/…`(且非 `//`)或 `~/…` → 是
  - 含 scheme 且 scheme **不属于** `http`/`https`/`mailto`/`tel`,且非 `#` 锚点 → 是(覆盖 `obsidian://`、`vscode://` 等)
  - 其余 → 否(保持现状)
- 命中:`event.preventDefault()`,`fetch('/api/open-local', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ target: 原始href }) })`。
  - 失败(网络错误 / 非 2xx)→ 轻量提示(toast 或 console.warn),不阻断页面。
- 未命中(http/https):不拦截,保持现有「新标签页打开」行为。
- 前端拦截后不再发生导航,故 Electron `setWindowOpenHandler` 不被触发,桌面 App 自动复用后端路径。

### 判定逻辑拆为纯函数(便于测试)

- 前端:`isLocalHref(href: string): boolean` —— 纯函数,输入原始 href 返回是否本机链接。
- 后端:`resolveOpenTarget(target: string): { kind: 'file'|'scheme', value: string }` —— 纯函数,做归一化与分类;`open-local` 路由调用它,再决定是否做存在性检查、构造 `execFile` 参数。

## 测试

- 后端 `resolveOpenTarget` 单测:`file:///a/b`→`/a/b`;`~/x`→`$HOME/x`;`/a/b`→原样;`obsidian://open?x`→scheme 透传。
- 后端路由单测:缺 `target`→400;Origin 不匹配→403;文件不存在→404;mock `execFile` 验证按平台构造的参数数组正确、成功→`{ok:true}`。
- 前端 `isLocalHref` 单测:`file://…`/`/Users/…`/`~/…`/`obsidian://…`→true;`http(s)://…`/`mailto:`/`#sec`→false。
- 前端组件单测:点击本机链接触发 `preventDefault` + 以正确 body 调 `/api/open-local`;点击 http 链接不拦截。

## 受影响文件

- 新增后端路由 + `resolveOpenTarget`(`src/server/…`)。
- `web/src/components/Markdown.tsx`:容器 `onClick` 委托。
- 新增 `web/src/…` 的 `isLocalHref` 纯函数 + 单测。
- 相应单测文件。
- `electron/main.cjs`:**不改**(前端拦截后无导航)。
