# AI 斗地主

接入任意 OpenAI 兼容大模型的单机斗地主。支持「人机对战」与「AI 观战」两种模式——观战模式下 AI 的每一步决策理由都会实时展示在思考日志面板中；牌桌提供**自动过牌**开关，要不起时自动过牌、免手动操作。

## 环境要求

- Node.js **≥ 18**（需内置 `fetch`），推荐 20 / 22
- npm ≥ 9

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 开发模式（一条命令同时拉起前端与 Node 代理）
npm run dev
# 浏览器打开终端提示的地址（默认 http://localhost:5173，端口被占用会自动跳转，见下文「端口说明」）

# 3. 生产构建 + 运行（单进程同时托管页面与 /api）
npm run build
npm start
# 浏览器打开 http://localhost:8787
```

也可以直接双击 `start.bat`：自动检测环境、启动开发服务并打开浏览器（Windows）。

## 可用脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | 并发启动 Vite 与 Node 代理；后端端口被占用自动跳转 |
| `npm run dev:web` | 只启动前端 |
| `npm run dev:api` | 只启动后端代理 |
| `npm run build` | 类型检查 + 构建前端到 `dist/` |
| `npm start` | 生产模式单进程运行（托管 `dist/` + 提供 `/api`） |
| `npm test` | 运行单元测试 |
| `npm run test:coverage` | 运行测试并生成覆盖率报告 |
| `npm run lint` | ESLint 检查 |
| `npm run typecheck` | 仅做类型检查 |

## 端口说明（端口占用自动跳转）

开发模式下所有端口在被占用时**自动跳转**，不会强杀其他进程：

| 服务 | 默认端口 | 被占用时 |
|---|---|---|
| 前端 Vite | `5173` | 自动换 5174、5175…（`strictPort: false`） |
| 后端 Node 代理 | `8787` | 启动时遇 `EADDRINUSE` 自动 +1 重试（最多 20 次）；成功绑定后写入 `.apiport` 供 Vite 代理联动 |

- 后端实际端口写入根目录 `.apiport`（成功绑定后才写入），Vite 的 `/api` 代理读取该文件，保证前后端联动一致；
- 单独运行 `npm run dev:web` / `dev:api` 时回落到默认端口 8787；
- `start.bat` 会扫描 5173~5182 范围内实际监听的前端端口并自动打开浏览器；
- 生产模式（`npm start`）固定 `PORT ?? 8787`，不自动跳转。

## 目录结构

```
AI_DouDiZhu/
├─ server/                 # 极简 Node 代理（仅 CORS 透传 + 静态托管）
│  ├─ index.ts             # Express 入口（EADDRINUSE 自动跳转端口）
│  ├─ routes/llm.ts        # /api/llm/{models,chat,test}
│  ├─ routes/tts.ts        # /api/tts/synthesize
│  ├─ services/llmProxy.ts # 转发、超时、错误归一化
│  ├─ utils/logger.ts      # 统一日志 + apiKey 脱敏
│  └─ types.ts
├─ src/
│  ├─ engine/              # 规则引擎（纯函数、零 IO、零 React）
│  ├─ ai/                  # AI 编排与四层降级
│  ├─ store/               # Zustand 状态切片
│  ├─ api/                 # 前端 API 客户端
│  ├─ audio/               # 音效 / TTS 播报 / AI 台词
│  ├─ components/          # UI 组件
│  ├─ pages/               # 页面（牌桌、模型配置、AI 玩家、房间、历史）
│  ├─ hooks/  utils/  types/
│  ├─ router.tsx  App.tsx  main.tsx  index.css
└─ tests/                  # 单元测试（引擎 / AI / store / 组件）
```

## 功能特性

- **双模式对局**：人机对战（HUMAN_VS_AI）、AI 观战（AI_SPECTATE，含座位视角切换）；
- **自动过牌**：牌桌顶栏复选框，勾选后人类回合「要不起」时立即自动过牌（无需手动 / AI 思考），并播放固定过牌音效；取消勾选立即恢复手动；
- **AI 思考可视化**：观战模式下，AI 玩家出牌/叫分的完整决策链路与降级原因实时写入思考日志面板；人机模式侧栏展示双方出牌记录时间线；
- **倒计时机制**：人类 30s 超时自动出最小牌/过牌；AI 8s 硬超时（推理模型自动放宽），两者独立互不触发；
- **多模型配置**：任意 OpenAI 兼容服务，支持思考模式（off / low / medium / high / auto）、温度等参数，云端 TTS 与聊天可独立绑定密钥。

## 后端职责边界

后端**只做两件事**：LLM/TTS 请求透传代理、生产环境静态托管。

它不承载任何游戏逻辑、不做持久化、不存储 API Key、不做认证、不构造提示词。存在的唯一理由是绕开浏览器对第三方 LLM 服务的 CORS 限制。

### 接口一览

所有接口响应统一信封 `{ code, data, message }`，`code === 0` 为成功。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/llm/models` | 拉取模型列表（转发 `GET {baseUrl}/models`） |
| POST | `/api/llm/test` | 连通性探活，返回 `{ success, latencyMs }` |
| POST | `/api/llm/chat` | 对话补全（转发 `POST {baseUrl}/chat/completions`） |
| POST | `/api/tts/synthesize` | 云端 TTS 语音合成（转发上游 `/audio/speech`） |
| GET | `/api/health` | 健康检查 |

错误码分段：

| 码段 | 含义 |
|---|---|
| 0 | 成功 |
| 1000~1099 | 请求参数错误 |
| 2000~2099 | 上游 LLM 服务错误 |
| 3000~3099 | 网络与超时 |
| 9000 | 未知错误 |

### baseUrl 容错

以下写法等价，服务端会统一规范化：

```
https://api.openai.com
https://api.openai.com/
https://api.openai.com/v1
https://api.openai.com/v1/
```

## 安全说明

- API Key 保存在**浏览器 localStorage**（明文），仅在你自己的机器上。请勿在公共设备使用。
- Key 只在请求体中传递，不放 URL query；服务端仅在单次请求生命周期内持有，**不落盘、不进日志**。
- 服务端日志对 Key 强制脱敏：保留前 6 位与后 3 位，中间以 `***` 替换（不足 12 位时整体替换为 `***`）。
- 本地代理默认不对来源做鉴权（`cors()` 全放开），仅建议在本机使用；如部署到公网请自行加来源白名单。
- **配置导出/导入**（模型配置页「导出配置」按钮）：导出文件为 JSON，**包含 API Key 明文**，请妥善保管，勿上传到 git / 公开位置（`.gitignore` 已忽略默认导出文件名 `doudizhu-config-*.json`）；导入后自动刷新页面生效。

## 环境变量

复制 `.env.example` 为 `.env` 后按需修改：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8787` | Node 代理基础端口（开发模式被占用时自动跳转，生产模式固定） |
| `LLM_TIMEOUT_MS` | `15000` | 转发上游的默认超时 |
| `LOG_LEVEL` | `info` | 日志级别 |

## 许可证

仅供学习与个人使用。
