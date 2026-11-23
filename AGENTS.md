# AGENTS.md

给后续的 AI / 自动化会话：动手前先读这一页。这个仓库是 **DSH Remote 的自建 Server**，
不是上游主仓，绝大多数上游改动与我们无关。

## 发版：只有一种方式

1. 把根 `package.json` 的 `version` 改成目标版本（例如 `0.7.1`）。
2. 提交时让**标题**（commit message 第一行）是 `tag:<version>`：

   ```bash
   git commit -m "tag:0.7.1"       # 标题版本必须与 package.json 完全一致
   git push origin main
   ```

3. GitHub Actions 的 `Release` 工作流会先跑校验，再构建并推送镜像到
   `ghcr.io/hourjia/ds-harness-remote-server`，标签为 `0.7.1`、`0.7`、`latest`、
   `sha-<短提交>`。预发布版本（`0.7.1-rc.1`）只发精确版本与 sha，**不动** `latest`。

硬性规则：

- **不要**用 `git tag`、`workflow_dispatch`、手动 `docker push` 发版。
- **不要**把 `.github/workflows/release.yml` 的触发条件改回“每次 push 发版”或
  `tags: ['v*']`：普通提交只跑校验，`latest` 只随正式发版移动。
- 标题写错（`tag:0.7`、`Tag:0.7.1`）或与 `package.json` 不一致时，发版作业会失败且
  不推送镜像；修正后再提交一次即可，版本号可以相同。
- 发版只在 `main` 上生效；PR 只跑校验。

详细规则、标签表和排错见 [`docs/release.md`](docs/release.md)。

## 版本与上游基线

- 本仓库版本**独立自增**，与上游版本无关，不要为了对齐上游而改版本号。
- 当前同步到哪个上游提交，看根 `package.json` 的 `upstream` 字段
  （`tag` / `commit` / `syncedAt`），人类可读版在 [`docs/upstream-sync.md`](docs/upstream-sync.md)。
- 同步上游时不要覆盖 `docs/server.md`，也不要整篇同步 `docs/protocol.md`；范围与步骤见
  `docs/upstream-sync.md`。
- 我们与上游的私有差异：多账号隔离（`state.json` v2）、自建 Web UI、设备列表分页尚未实现。

## 本地校验（与 CI 一致）

```bash
pnpm install --frozen-lockfile
pnpm build          # 必须先 build：workspace 包通过 dist 互相解析
pnpm -r check
pnpm -r test
```

改了 `packages/protocol` 之后必须重新 build，否则 `apps/server` 会用到旧的 `dist`。

## 关键约定

- 只中继密文：Server 不持有会话明文，改动 `gateway.ts` 时先读
  [`docs/protocol.md`](docs/protocol.md) 与 [`docs/server.md`](docs/server.md)。
- `gateway.ts` 是协议状态机（握手超时、心跳、选路、Relay 授权），改动容易破坏与客户端的兼容性。
- 协议版本仍是 v1；破坏兼容性的改动必须提升协议版本并同步文档。
- 用户可见文案与文档用中文，代码注释与提交信息沿用现有风格。

## 文档索引

| 文档 | 内容 |
|---|---|
| [`docs/release.md`](docs/release.md) | 发版触发规则、镜像标签、排错 |
| [`docs/upstream-sync.md`](docs/upstream-sync.md) | 上游基线、同步历史、下次同步步骤 |
| [`docs/protocol.md`](docs/protocol.md) | Protocol v1 规范正文 |
| [`docs/server.md`](docs/server.md) | Server 设计与对外契约 |
| [`README.md`](README.md) | 部署、配置、测试 |
