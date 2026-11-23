# 上游同步记录

本仓库从 [`liguobao/ds-harness-remote`](https://github.com/liguobao/ds-harness-remote) 拆出，保留 Server 运行与测试所需的部分。上游迭代很快（客户端、移动端、Host 插件同仓），所以**本仓库版本号自增，与上游版本解耦**；上游基线单独记录在下面。

- 机器可读的当前基线：根 `package.json` 的 `upstream` 字段（`tag` / `commit` / `syncedAt`）
- 本文按时间倒序记录每次同步的范围、上游提交与已知偏差
- 判断“我们是否落后”时看 `upstream.commit`，不要看版本号

## 当前基线

| 项 | 值 |
|---|---|
| 上游 tag | `v0.6.7` |
| 上游提交 | `d026990`（比 `v0.6.7` 多 16 个提交，2026-11-23 08:18 +0800） |
| 上游 server 包版本 | `0.5.21`（上游未随 tag 递增） |
| 线协议 | Protocol v1（`PROTOCOL_VERSION = 1`，本次同步为纯加法，无破坏性变更） |
| 本仓库版本 | `0.7.0` |

## 同步历史

| 日期 | 本仓库版本 | 上游基线 | 内容 |
|---|---|---|---|
| 2026-11-23 | `0.7.0` | `v0.6.7` / `d026990`（自 `v0.6.3`） | 见下方明细 |
| 2026-11-06 | `0.6.3` | `v0.6.3` / `bd0eade` | 初始拆分：`apps/server` + `packages/protocol` + 测试所需 `crypto` / `webrtc` |

### `0.7.0` 明细

**Server（`apps/server/src`）**

- `store.ts`：refresh 响应丢失时用「旧 bearer 作 HMAC 密钥 + nonce + deviceId + 用途域」派生后继 pair，幂等恢复；消耗旧 token、写恢复元数据与后继记录原子提交，写失败时旧 token 保持可用（上游 `90cd188`, #340）
- `gateway.ts`：心跳保留最近两个 ping nonce，迟到的 pong 仍可续命（`1195754`, #503）
- `gateway.ts`：已关闭链路保留 5 分钟墓碑，迟到帧静默丢弃并走独立预算；控制帧限流可配 `DSH_SERVER_MAX_FRAMES_PER_SEC`（`f0d8c6c`, #339/#358）
- `gateway.ts`：计划停机时清空 peers/links/droppedLinks，避免把正常断开报成 `CONNECTION_FAILED`（`9551cdd`, #530）
- `gateway.ts`：无 TURN 时直连回退预算 3s；`hello.ack.webrtcEnabled` 按协商结果；鸿蒙 NetStack 省略端口的 Origin 兼容（`f88cea8` #515、`7cc2bea`）
- `gateway.ts`：链路 ready 后仍可领取 TURN 凭据，支持带内传输升级；`connect.request` 立即回收心跳超时的 Host（`7ad25e8`）
- `server.ts`：REST 请求体改用 `parseWireJson`，拒绝重复键与非法 UTF-8（`32dc741`）
- `config.ts` / `main.ts`：新增 `DSH_SERVER_MAX_FRAMES_PER_SEC`（64–65536，默认 512）

**协议与依赖包（与上游逐字节一致）**

- `packages/protocol`：新增 `transport-upgrade`、`workspace-git`、`binary-upload`、`lan-upload`、`dsh-web` 模块；新增 RPC 方法 / capability / 事件；`export parseWireJson`；Relay 与 `secure.handshake` payload 二次校验；`connect.accepted` 新增 `webrtcFallbackTimeoutMs` / `parallelConnections`
- `packages/crypto`：Noise IK 支持可选 ChaChaPoly 加速钩子（不改变线格式）
- `packages/webrtc`：`direct-preferred-race`、`upgraded-rtc-transport` 等（仅测试构造真实 Client 通道时使用）
- `fixtures/`：增补 conformance 向量（connect、wire-json、remaining-control、capabilities 等）

**测试**：server 58 → 63（新增 refresh 恢复用例并适配多账号 Store）；protocol 113、webrtc 74、crypto 10 全绿；`pnpm build` / `pnpm -r check` 通过。

**文档**：`docs/protocol.md` §8.2 补上本仓库的 refresh 恢复语义；`.env.example` / `README` 补 `DSH_SERVER_MAX_FRAMES_PER_SEC`。

## 同步范围与不取的部分

取：`apps/server`（`src` / `tests` / `web` 按需）、`packages/protocol`、`packages/crypto`、`packages/webrtc`、`fixtures/`。

不取（及原因）：

- `apps/android`、`apps/ios`、`apps/harmony`、`apps/web`、Desktop/VS Code 客户端：不在本仓库定位内
- `packages/plugin`：只保留测试需要的 3 个文件（`client-secure-transport.ts` / `identity-store.ts` / `ids.ts`）
- `docs/server.md`：上游把 400+ 行完整站点设计文档删除并迁往独立 Server 仓库；本仓库保留自己的设计说明，**不要**用上游版本覆盖
- `docs/protocol.md` 整篇：上游新增内容多为 Host/客户端特性（`workspace.git.*`、`dsh.web.*`、会话迁移、传输升级细节），且引用本仓库不存在的 `design/*` 文档；只按需摘取与本仓库实现相关的章节
- `patches/`、根 `package.json` 的 RN/Expo 依赖、CHANGELOG：与 Server 无关

## 已知偏差（合并上游时保留）

- **多账号隔离**：上游 Server 仍是单账号（`state.json` v1）。本仓库是 v2，账号由环境变量预置、设备按 `owner` 隔离，`store.ts` / `server.ts` / `gateway.ts` 的 `connect.request` 都有账号边界校验
- **自建 Web UI**：`apps/server/web` 是本仓库自己的 React + antd 前端
- **设备列表分页**：`docs/protocol.md` 已描述 `limit`/`cursor` 语义，但当前实现仍返回完整列表（`nextCursor: null`），属于待补项

## 下次同步怎么做

1. 拉取上游，确认目标 `commit`（tag 之后可能还有提交）：
   ```bash
   git clone --filter=blob:none https://github.com/liguobao/ds-harness-remote.git /tmp/upstream
   git -C /tmp/upstream log --oneline -5
   ```
2. 只导出关心的路径，避免检出移动端资源：
   ```bash
   git -C /tmp/upstream archive HEAD -- apps/server packages/protocol packages/crypto packages/webrtc fixtures | tar -x -C /tmp/upstream-head
   ```
3. `packages/protocol|crypto|webrtc` 与 `fixtures` 按目录整包替换（本仓库对它们没有改动）；`apps/server/src` 做三方合并，基准取上一次的 `upstream.commit`：
   ```bash
   git merge-file -p --diff3 apps/server/src/store.ts <base>/store.ts <upstream>/store.ts
   ```
   注意先统一换行（CRLF/LF 混用会让合并整文件冲突）。
4. 预期需要手改的位置只有：`server.ts` 的 import 段、`store.ts` 的 schema 段与 `issue()`/`refresh()`、`gateway.ts` 的 `connect.request` 账号校验。
5. `pnpm build && pnpm -r check && pnpm -r test`；上游改了既有行为时，同步更新本仓库对应断言（别把上游有意的行为变更当回归）。
6. 更新 `package.json` 的 `upstream` 字段、上面两张表，并自增本仓库版本号（发版方式见 [release.md](./release.md)）。
