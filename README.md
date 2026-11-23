# ds-harness-remote-server

DeepSeek Harness Remote 的**自建 Server**，从 [`liguobao/ds-harness-remote`](https://github.com/liguobao/ds-harness-remote) 的 `apps/server` 拆出，保留完整可运行能力。

它在 DSH Remote 拓扑里承担**控制面与中继**：

```
Host（装 dsh 插件的机器）──┐
                          ├──> 本 Server ──> 其他 Host / Client
Client（手机 / 桌面 / Web）─┘
```

- 负责账号授权、设备注册与凭据轮换、在线状态、连接协调
- 支持多账号：同一账号下的 Host/Client 互相可见可连，不同账号之间设备、连接与 TURN 凭据完全隔离（账号通过环境变量预置）
- 协调 WebRTC 的 `LAN → P2P → TURN → Relay` 四路选路
- 无法直连时用 WebSocket 中继**密文**（Noise IK），不接触业务明文

## 与上游的关系

| 项目 | 说明 |
|---|---|
| 上游 | `https://github.com/liguobao/ds-harness-remote` |
| 本仓库 | 上游 `apps/server` + `packages/protocol` + 测试所需的 `crypto` / `webrtc` |
| 本仓库版本 | `0.7.0`，独立自增，与上游版本解耦 |
| 上游基线 | `v0.6.7` + 16 提交 = `d026990`（server 包版本 `0.5.21`） |
| 同步记录 | 基线与每次同步明细见 [docs/upstream-sync.md](./docs/upstream-sync.md)；机器可读值在根 `package.json` 的 `upstream` 字段 |
| 协议 | DSH Remote Protocol v1，见上游 `docs/protocol.md` |
| 许可 | MIT，版权归 `DSH Remote contributors`，见 [LICENSE](./LICENSE) |

**不含**：Host 插件（`packages/plugin`）、Android / Web / VS Code 客户端、上游 Models 的完整 Server Web。
本仓库只保留 Server 运行与测试真正需要的文件。

## 目录结构

```
.
├── apps/server/          # Server 本体
│   ├── src/
│   │   ├── main.ts       # 入口：读环境变量、监听端口
│   │   ├── server.ts     # HTTP 路由、登录、设备注册、TURN 凭据
│   │   ├── gateway.ts    # Control WebSocket、连接协调、WebRTC signaling、Relay
│   │   ├── store.ts      # 多账号与设备凭据持久化（state.json，含 v1 迁移）
│   │   ├── accounts.ts   # 账号配置解析（env 列表 / JSON 文件 / 旧单账号）
│   │   ├── ice.ts        # STUN/TURN 配置与短期凭据
│   │   ├── config.ts     # 参数归一化与合法区间
│   │   └── logger.ts     # 结构化日志
│   ├── web/              # 自建版 Web 前端（React + antd）
│   ├── tests/            # 63 个测试
│   ├── Dockerfile
│   └── compose.yaml
├── packages/
│   ├── protocol/         # 协议 v1：帧、schema、错误码（运行时依赖）
│   ├── crypto/           # Noise IK 实现（测试依赖）
│   ├── webrtc/           # RelayTransport 等（测试依赖）
│   └── plugin/           # 仅保留 3 个文件，供测试构造真实 Client 安全通道
├── fixtures/             # 协议与 Noise 黄金向量（测试用）
├── docs/                 # 规范文档
│   ├── protocol.md       # Protocol v1 规范正文（2128 行）
│   ├── server.md         # Server 设计说明
│   ├── network.md        # 网络与传输、四路选路
│   ├── end-to-end-encryption.md
│   ├── compatibility.md
│   ├── upstream-sync.md   # 上游同步基线与历史
│   └── design/           # 增量契约与设计文档
└── scripts/              # 测试辅助
```

**写客户端先读 [`docs/protocol.md`](./docs/protocol.md)**，协议类型定义的权威来源是 `packages/protocol/src/index.ts`。文档阅读顺序见 [`docs/README.md`](./docs/README.md)。

## 环境要求

- **Node.js ≥ 22**（本仓库已用 `volta` 钉到 `24.22.2`，只要装过 Volta 即自动切换）
  - 实测：Node 20.16 下旧版 52 个测试有 1 个失败（`closes the production Client secure channel...`，卡在 `connect.incoming`）；切换到 Node 24.22.2 后全通过。请勿用 Node 20 部署。
- **pnpm 9.15.4**

## 快速开始

```bash
pnpm install
pnpm build

cp apps/server/.env.example apps/server/.env
# 编辑 .env：至少设置 DSH_SERVER_ACCOUNT 与 DSH_SERVER_PASSWORD（≥12 字符）
# 多人使用改设 DSH_SERVER_ACCOUNTS（见下方配置说明）

cd apps/server
node --env-file=.env dist/main.js
```

打开 <http://localhost:8080>，Host 与客户端填写同一地址、同一账号密码登录。

## 发版与镜像

镜像发布由**提交标题**触发，不再依赖 `git tag`：只有标题为 `tag:<version>`（如
`tag:0.7.1`）且与 `package.json` 版本一致的提交，才会构建并推送镜像；普通提交只跑校验。
镜像标签为精确版本、`<major>.<minor>`、`latest` 和 `sha-<commit>`（预发布版本不动
`latest` 与 minor 标签）。完整流程与失败处理见 [`docs/release.md`](./docs/release.md)。

### 用预构建镜像部署

在服务器上拉取镜像：

```bash
cd apps/server
cp .env.example .env
# 设置账号、密码、DSH_SERVER_PUBLIC_URL
docker compose -f compose.deploy.yaml pull
docker compose -f compose.deploy.yaml up -d
```

数据保存在 `server-data` 卷。生产环境建议在 `.env` 中把 `DSH_SERVER_IMAGE_TAG` 固定到
具体版本（如 `0.7.0`）或 `sha-<commit>`，不要跟 `latest`。

### 从源码本地构建

```bash
cd apps/server
docker compose up -d --build
```

> `DSH_SERVER_PUBLIC_URL` 必须与浏览器实际访问的 origin 完全一致（含协议、域名、非默认端口），否则 JS/CSS 会因 origin 校验返回 403 而白屏。

## 配置

完整说明见 `apps/server/.env.example`。关键项：

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_SERVER_ACCOUNT` | 必填* | 单账号登录账号（建议邮箱格式）；与 `DSH_SERVER_ACCOUNTS` 互斥 |
| `DSH_SERVER_PASSWORD` | 必填* | 单账号密码，至少 12 字符 |
| `DSH_SERVER_ACCOUNTS` | 空 | 多账号列表 `account:password`，逗号或换行分隔；与上面的单账号变量互斥 |
| `DSH_SERVER_ACCOUNTS_FILE` | 空 | 账号 JSON 文件路径 `[{"account","password"}]` |
| `DSH_SERVER_PUBLIC_URL` | `http://localhost:8080` | 浏览器访问地址 |
| `DSH_SERVER_HOST` | `127.0.0.1` | 监听地址；容器内用 `0.0.0.0` |
| `DSH_SERVER_PORT` | `8080` | 监听端口 |
| `DSH_SERVER_DATA_FILE` | `data/state.json` | 凭据持久化文件 |
| `DSH_SERVER_TRUSTED_PROXY_IPS` | 空 | 可信反代 IP，需覆盖 `X-Forwarded-For` |
| `DSH_SERVER_MAX_FRAMES_PER_SEC` | `512` | 单连接控制帧限流（64–65536）；已关闭链路的迟到帧走独立预算静默丢弃 |
| `DSH_SERVER_STUN_URLS` / `TURN_URLS` | 空 | 留空则 Relay-only |

\* `DSH_SERVER_ACCOUNT`/`DSH_SERVER_PASSWORD` 与 `DSH_SERVER_ACCOUNTS`/`DSH_SERVER_ACCOUNTS_FILE` 二选一：至少配置一组，且不能同时配置。账号从配置启动时同步；从配置中移除的账号会被禁用并吊销设备 token，设备记录保留。旧版单账号 `state.json` 会自动迁移。

## 测试

```bash
pnpm test
```

63 个测试，覆盖账号/设备授权、多账号隔离与迁移、origin 校验、限流、网关握手状态机、连接协调、凭据刷新恢复、加密中继的篡改与重放拒绝等。

## 安全边界

- 服务端**只中继密文**，业务流量由 Client 加密、只有目标 Host 能解密（`Noise_IK_25519_ChaChaPoly_SHA256`）
- 账号 membership 与 Host 本地固定的设备 identity **必须同时**通过
- 公网部署必须走 HTTPS 反代，且 Server 端口不可直接暴露
- 密码以 scrypt 派生后存储；设备凭据持久化在 `state.json`
- refresh 响应丢失时旧 token 可幂等换回同一后继 pair（不延长有效期、不撤销设备凭据）；恢复元数据只含摘要、nonce 与过期时间

## 修改约定

- 扩展 API：在 `apps/server/src/server.ts` 的 `route()` 加分支
- 换存储：替换 `apps/server/src/store.ts` 的 `Store`
- 谨慎修改 `apps/server/src/gateway.ts`：它是协议状态机（握手超时、心跳、选路、Relay 授权），改动容易破坏与客户端的兼容性
- 改了 `packages/protocol` 必须同时重新构建 Host 插件与客户端，否则两侧帧格式不一致
