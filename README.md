# ds-harness-remote-server

DeepSeek Harness Remote 的**自建 Server**，从 [`liguobao/ds-harness-remote`](https://github.com/liguobao/ds-harness-remote) 的 `apps/server` 拆出，保留完整可运行能力。

它在 DSH Remote 拓扑里承担**控制面与中继**：

```
Host（装 dsh 插件的机器）──┐
                          ├──> 本 Server ──> 其他 Host / Client
Client（手机 / 桌面 / Web）─┘
```

- 负责账号授权、设备注册与凭据轮换、在线状态、连接协调
- 协调 WebRTC 的 `LAN → P2P → TURN → Relay` 四路选路
- 无法直连时用 WebSocket 中继**密文**（Noise IK），不接触业务明文

## 与上游的关系

| 项目 | 说明 |
|---|---|
| 上游 | `https://github.com/liguobao/ds-harness-remote` |
| 本仓库 | 上游 `apps/server` + `packages/protocol` + 测试所需的 `crypto` / `webrtc` |
| 版本基线 | 上游 `v0.6.3`（server 包版本 `0.5.21`） |
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
│   │   ├── store.ts      # 设备凭据持久化（state.json）
│   │   ├── ice.ts        # STUN/TURN 配置与短期凭据
│   │   ├── config.ts     # 参数归一化与合法区间
│   │   └── logger.ts     # 结构化日志
│   ├── web/              # 自建版 Web 前端（React + antd）
│   ├── tests/            # 52 个测试
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
│   └── design/           # 增量契约与设计文档
└── scripts/              # 测试辅助
```

**写客户端先读 [`docs/protocol.md`](./docs/protocol.md)**，协议类型定义的权威来源是 `packages/protocol/src/index.ts`。文档阅读顺序见 [`docs/README.md`](./docs/README.md)。

## 环境要求

- **Node.js ≥ 22**（本仓库已用 `volta` 钉到 `24.22.2`，只要装过 Volta 即自动切换）
  - 实测：Node 20.16 下 52 个测试有 1 个失败（`closes the production Client secure channel...`，卡在 `connect.incoming`）；切换到 Node 24.22.2 后 52/52 全通过。请勿用 Node 20 部署。
- **pnpm 9.15.4**

## 快速开始

```bash
pnpm install
pnpm build

cp apps/server/.env.example apps/server/.env
# 编辑 .env：至少设置 DSH_SERVER_ACCOUNT 与 DSH_SERVER_PASSWORD（≥12 字符）

cd apps/server
node --env-file=.env dist/main.js
```

打开 <http://localhost:8080>，Host 与客户端填写同一地址、同一账号密码登录。

## Docker

推送到 `main` 或打 `v*` tag 后，GitHub Actions 自动构建并推送镜像到
`ghcr.io/hourjia/ds-harness-remote-server`。在服务器上拉取预构建镜像部署：

```bash
cd apps/server
cp .env.example .env
# 设置账号、密码、DSH_SERVER_PUBLIC_URL
docker compose -f compose.deploy.yaml pull
docker compose -f compose.deploy.yaml up -d
```

数据保存在 `server-data` 卷。生产环境建议在 `.env` 中把 `DSH_SERVER_IMAGE_TAG` 固定到
具体版本（如 `0.6.3`）或 `sha-<commit>`，不要跟 `latest`。

从源码本地构建仍可用：

```bash
cd apps/server
docker compose up -d --build
```

> `DSH_SERVER_PUBLIC_URL` 必须与浏览器实际访问的 origin 完全一致（含协议、域名、非默认端口），否则 JS/CSS 会因 origin 校验返回 403 而白屏。

## 配置

完整说明见 `apps/server/.env.example`。关键项：

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_SERVER_ACCOUNT` | 必填 | 登录账号（建议邮箱格式） |
| `DSH_SERVER_PASSWORD` | 必填 | 至少 12 字符 |
| `DSH_SERVER_PUBLIC_URL` | `http://localhost:8080` | 浏览器访问地址 |
| `DSH_SERVER_HOST` | `127.0.0.1` | 监听地址；容器内用 `0.0.0.0` |
| `DSH_SERVER_PORT` | `8080` | 监听端口 |
| `DSH_SERVER_DATA_FILE` | `data/state.json` | 凭据持久化文件 |
| `DSH_SERVER_TRUSTED_PROXY_IPS` | 空 | 可信反代 IP，需覆盖 `X-Forwarded-For` |
| `DSH_SERVER_STUN_URLS` / `TURN_URLS` | 空 | 留空则 Relay-only |

## 测试

```bash
pnpm test
```

52 个测试，覆盖账号/设备授权、origin 校验、限流、网关握手状态机、连接协调、加密中继的篡改与重放拒绝等。

## 安全边界

- 服务端**只中继密文**，业务流量由 Client 加密、只有目标 Host 能解密（`Noise_IK_25519_ChaChaPoly_SHA256`）
- 账号 membership 与 Host 本地固定的设备 identity **必须同时**通过
- 公网部署必须走 HTTPS 反代，且 Server 端口不可直接暴露
- 密码以 scrypt 派生后存储；设备凭据持久化在 `state.json`

## 修改约定

- 扩展 API：在 `apps/server/src/server.ts` 的 `route()` 加分支
- 换存储：替换 `apps/server/src/store.ts` 的 `Store`
- 谨慎修改 `apps/server/src/gateway.ts`：它是协议状态机（握手超时、心跳、选路、Relay 授权），改动容易破坏与客户端的兼容性
- 改了 `packages/protocol` 必须同时重新构建 Host 插件与客户端，否则两侧帧格式不一致
