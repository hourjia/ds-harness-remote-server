# 文档

本目录保留 DSH Remote 的**规范文档**，来源为上游 [`liguobao/ds-harness-remote`](https://github.com/liguobao/ds-harness-remote) 的 `docs/`，与上游 `v0.6.3` 一致。代码实现见 [`../apps/server`](../apps/server)，协议类型定义见 [`../packages/protocol/src/index.ts`](../packages/protocol/src/index.ts)。

> 本仓库是上游 `apps/server` 的独立拆分，只包含 Server。上游 `docs/README.md` 中描述 Host 插件、Android/VS Code 客户端、Browser 扩展的部分已不适用，此处改写为面向 Server 与自定义客户端的索引。

## 写客户端时按这个顺序读

| 顺序 | 文档 | 为什么要读 |
|---|---|---|
| 1 | [protocol.md](./protocol.md) | **规范正文，2128 行。** 帧格式、REST 通用格式、设备描述符、Control Channel、Noise 握手、Relay 帧、WebRTC signaling、RPC envelope、错误码 |
| 2 | [end-to-end-encryption.md](./end-to-end-encryption.md) | Noise IK 的具体用法、identity pinning、重放保护、Server 可见/不可见的边界 |
| 3 | [network.md](./network.md) | `LAN → P2P → TURN → Relay` 的选路与降级、断线恢复、帧与顺序、企业网络约束 |
| 4 | [compatibility.md](./compatibility.md) | Harness 版本兼容范围与 capability 协商 |
| 5 | [server.md](./server.md) | Server 侧设计：身份模型、membership、REST 清单、Gateway 状态机、数据模型 |

配合代码一起看：

- `packages/protocol/src/index.ts` — 49 KB，**所有帧与 payload 的权威 schema**（Zod + TS 类型）
- `packages/protocol/src/close-semantics.ts` — 关闭码语义
- `packages/crypto/src/noise.ts` — Noise IK 参考实现（约 5.8 KB，适合对照移植到 Kotlin）
- `packages/webrtc/src/index.ts` — `RelayTransport`，客户端最小可用传输

## 参考与背景

| 文档 | 内容 |
|---|---|
| [plugin-integration.md](./plugin-integration.md) | Host 插件接入指南：注册、凭据、连接、allowlist 边界 |
| [remote-tools.md](./remote-tools.md) | `remote_*` Agent 工具的语义与启用条件 |
| [design/webrtc-control-recovery.md](./design/webrtc-control-recovery.md) | 可选增量契约 `transport.webrtc.resume.v1`：控制面恢复 |
| [design/acp-session-archive.md](./design/acp-session-archive.md) | ACP 会话归档设计 |
| [design/README.md](./design/README.md) | 设计文档索引 |

## 未收录

以下上游文档属于 Host 插件与客户端产品层，拆分后未保留：

`acp-integration.md`、`acp-remote.md`、`codex-remote.md`、`installation.md`、`installation.zh.md`、`compatibility.zh.md`、`PRIVACY.md`、`TODO.md`、`CHANGELOG.md`、`intelligent-ui-android.md`、`official-menu-icons.md`

需要时到上游仓库取。`protocol.md` / `server.md` 中指向这些文件的链接会失效，属预期行为。

## 注意

`protocol.md` 中的 `harness.api.*` 系列（ApiProxy）**仅作为历史线协议保留**。当前版本的 Host 不注册这些方法，调用返回 `METHOD_NOT_FOUND`。新客户端应只实现 `harness.remote.v1` / `harness.remote.v3` 这条 Typert Remote carrier。
