# 发版

镜像由 GitHub Actions 构建并推送到 `ghcr.io/hourjia/ds-harness-remote-server`。
发版入口是**一次提交的标题**，不是 git tag，也不是每次 push。

## 触发规则

推送（或合并）到 `main` 的提交，只要**标题**（第一行）匹配下面这条规则，就会发版：

```
^tag:\ ?v?<major>.<minor>.<patch>(-<prerelease>)?$
```

即 `tag:` + 可选空格 + 可选 `v` + 三段 semver，可带 `-rc.1` 这类预发布后缀。标题之后的
正文随意。同时要求版本号与根 `package.json` 的 `version` **完全一致**。

| 标题 | 结果 |
|---|---|
| `tag:0.7.1` | ✅ 发版 0.7.1 |
| `tag: v0.7.1` | ✅ 发版 0.7.1 |
| `tag:0.7.1` + 正文 | ✅ 只解析第一行 |
| `tag:0.7.1-rc.1`（`package.json` 为 `0.7.1-rc.1`） | ✅ 预发布，只发精确版本 + sha |
| `tag:0.7` / `tag:v1` | ❌ 发版作业失败（标题不合法），不推送任何镜像 |
| `Tag:0.7.1` / `release:0.7.1` | ❌ 不进入发版作业（大小写与前缀必须精确） |
| `tag:0.7.1` 但 `package.json` 为 `0.7.0` | ❌ 发版作业失败（版本不一致） |
| 其他任意标题 | 只跑校验，不发版 |

## 一次发版做什么

工作流：[`.github/workflows/release.yml`](../.github/workflows/release.yml)

1. `Workspace check and tests`：`pnpm install --frozen-lockfile` → `pnpm build` →
   `pnpm -r check` → `pnpm -r test`。
2. `Build and publish image`（仅在标题命中 `tag:` 时运行）：解析版本、核对
   `package.json`、构建 `apps/server/Dockerfile` 并推送 GHCR。

镜像标签：

| 版本类型 | 产出标签 |
|---|---|
| 正式版 `X.Y.Z` | `X.Y.Z`、`X.Y`、`latest`、`sha-<短提交>` |
| 预发布 `X.Y.Z-rc.N` | `X.Y.Z-rc.N`、`sha-<短提交>`（**不动** `latest` 和 `X.Y`） |

`latest` 只在正式版发版时移动，普通提交不再覆盖它。

## 怎么发一版

```bash
# 1. 改版本号（根 package.json 的 version）
#    同时更新 docs/upstream-sync.md 之类需要记录版本的地方
git add -A
git commit -m "chore(release): 0.7.1"   # 这个提交只用来改代码/版本
git push

# 2. 真正触发发版：标题必须是 tag:<version>，且与 package.json 一致
git commit --allow-empty -m "tag:0.7.1"
git push
```

也可以把版本改动直接放进 `tag:0.7.1` 这一个提交里，少一次 push。

## 确认结果

- Actions 页面：`Release` 工作流，`Workspace check and tests` 与
  `Build and publish image` 都成功。
- 镜像存在（需要能访问 GHCR）：
  ```bash
  docker manifest inspect ghcr.io/hourjia/ds-harness-remote-server:0.7.1 >/dev/null && echo ok
  ```
- 部署端固定版本：
  ```bash
  DSH_SERVER_IMAGE_TAG=0.7.1 docker compose -f compose.deploy.yaml up -d
  ```

## 失败与重试

- **标题不合法 / 版本不一致**：发版作业在 `Resolve release version` 失败并打印原因，
  不会推送任何镜像。修正后重新提交一个标题正确的提交即可（版本号相同也可以）。
- **校验失败**：发版作业不会开始（`needs: verify`）。修好后重新提交。
- **只想重跑**：在 Actions 里对同一次运行点 “Re-run failed jobs”。工作流按提交内容
  解析版本，重跑不会改变标签。
- 不要把触发条件改回 `tags: ['v*']` 或“每次 push 都发版”：`latest` 会被普通提交覆盖，
  这正是本流程要避免的。

## 为什么不直接打 git tag

`on.push` 无法按提交信息过滤，只能按分支/ git tag 过滤，所以本流程把“发版意图”写在
提交标题里：写代码的会话只需要一次普通 `git push`，不必创建并推送 tag，也不会因为
忘记推 tag 而漏发。代价是普通 push 也会创建一个工作流运行，但发版作业会被 `if` 跳过，
只跑校验。
