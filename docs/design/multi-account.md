# 多账号（环境变量预置）

状态：已实现 P1（多租户隔离），日期 2026-11-23。
适用范围：`apps/server`。协议 v1 与 Host/Client 实现不变。

## 1. 范围

本仓库的自部署 Server 支持**多个账号**，但账号仍然由部署配置预置：

- `DSH_SERVER_ACCOUNTS`：`account:password` 列表，逗号或换行分隔。
- `DSH_SERVER_ACCOUNTS_FILE`：JSON 数组 `[{"account","password"}]`。
- 旧的 `DSH_SERVER_ACCOUNT` + `DSH_SERVER_PASSWORD`：等价于一个账号，保留兼容。

两组配置互斥；`DSH_SERVER_ACCOUNTS` 与 `DSH_SERVER_ACCOUNTS_FILE` 可以叠加。
每个密码至少 12 字符，账号不能重复。

**不在范围内**：自助注册、邀请码、OAuth、组织/RBAC、管理后台、SQLite/Postgres。
这些仍属于独立 Server 项目的范围。

## 2. 授权不变量

1. 每个设备记录唯一 `owner`（账号名），注册时确定且终生不变。
2. 同一 `deviceId` 不能被第二个账号注册或"转移"；冲突返回 `409 PEER_IDENTITY_MISMATCH`。
3. membership 即 `owner` 相等，不建边表：
   - Client 的 `GET /api/v1/devices` 只返回同一 `owner` 的 Host。
   - `GET /api/v1/devices/{id}`、`/presence`、改名只允许同 `owner` 的异角色设备。
   - `connect.request` 要求双方设备 `owner` 相等，否则返回
     `MEMBERSHIP_REQUIRED`，且不创建 link、不向 Host 发送 `connect.incoming`。
   - TURN 凭据只签发给已建立 link 的两台设备，因此天然受同一约束。
4. `connect.incoming.authorization` 继续为 `"account"`；Host 仍通过设备详情接口交叉校验 Client。
5. `membershipId` 为 `account:<sha256(owner) 前 16 hex>`，按账号取值，格式对客户端不变。
6. 账号从配置在**启动时**同步：新增账号加入；密码变化吊销该账号 token；配置中移除的账号
   置为 `disabled` 并吊销其 token，设备记录保留。

## 3. 持久化

`state.json` 升到 `version: 2`：

```jsonc
{
  "version": 2,
  "accounts": { "<account>": { "salt": "…", "verifier": "…", "createdAt": 0, "disabled": false } },
  "devices": { "<deviceId>": { "owner": "…", "descriptor": {…}, "revoked": false, "lastSeenAt": 0 } },
  "tokens": { "<sha256(token)>": { "kind": "access", "deviceId": "…", "expires": 0, "used": false } }
}
```

- 每个账号独立 salt + scrypt verifier；磁盘上没有明文密码。
- token 仍按 digest 保存；设备 → owner 反查即可完成鉴权与隔离。
- 配额：每账号 128 台设备、全局 4096 台、全局 65536 条 token。
- v1 文件在首次启动时自动迁移：旧账号成为 `accounts` 条目，所有设备继承该 owner，
  token 保留；同时写 `state.json.v1.bak` 供回滚（旧版本无法读取 v2 文件）。
- 登录对未知/禁用账号也执行一次 scrypt，避免通过响应时间枚举账号。

## 4. 登录与会话

- `POST /api/v1/auth/login` 按账号查表并校验 verifier；失败统一 `401 AUTH_INVALID`。
- Web 会话在内存中保存 `{ account, expiresAt }`，HttpOnly Cookie 结构不变。
- 会话上限调整为全局 4096（原 256）。
- 登出仍只删除当前会话。

## 5. 已知限制 / 后续

| 项 | 现状 | 建议阶段 |
| --- | --- | --- |
| 登录限速 | 仍按客户端 IP 20/min | P2：增加按账号的失败计数，注意避免锁死账号 |
| 账号开通 | 仅部署配置 | P2：邀请码注册或管理接口 |
| 管理视图 | 无 | P3：管理员可列出全站设备（不含业务明文） |
| 共享 Host | 不支持跨账号 | P4：显式 membership 边表 |
| 存储 | 单 JSON，`touch` 全量重写 | P4：SQLite，替换 `store.ts` 即可 |

## 6. 验收

`apps/server/tests/server.test.ts` 的 `multi-account isolation`：

- 跨账号列表、设备详情、presence、改名、`connect.request` 全部拒绝；同账号连接正常。
- 同 `deviceId` 跨账号注册返回 `409`；`register-owned-role` 继承源设备 owner。
- 一个账号改密码只吊销该账号 token；移除账号后登录与其设备 token 均失效。
- v1 `state.json` 迁移后设备 token 继续可用，文件升级为 v2 并留下备份。

`apps/server/tests/accounts.test.ts` 覆盖三种配置形态、互斥、重复、弱密码与格式错误。
