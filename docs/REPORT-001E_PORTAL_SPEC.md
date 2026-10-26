# REPORT-001E 统一门户规范与接入契约 (PORTAL SPEC)

更新日期：2026-10-26。适用于 `elmo` 仓库与 Python 基准微服务之间的门户集成。

---

## 1. 架构定位与复用原则

- **统一门户入口**：内部操作员在 elmo Web 门户 (`/app/$brand/reports`) 集中完成企业档案核验、题集映射、手动触发有限诊断、分析师诊断录入、报告多版本追加、合规审核与三格式下载。
- **职责归属**：
  - `elmo`：负责多租户组织管理、客户档案与题库维护、操作员会话、报告界面交互与服务端鉴权代理。
  - `NegencyGEO` (D 微服务)：负责采样执行状态机、不可变归档存储、A 核心指标计算、B 报告装配及 PDF/HTML 渲染。
- **唯一采集责任**：D→C 保持唯一真实采集流水线。elmo Worker 旧采集路径已永久完全封死 (E2-R03 / E3-R05)，严禁通过任何环境变量或布尔标记重新开启，彻底封堵隐式自动续采与重放入口。

---

## 2. 环境变量配置契约

elmo Web 服务端在调用 Python 后端微服务时，读取以下环境变量（通过 `apps/web/src/server/baseline.server.ts` 集中管理）：

| 环境变量名 | 类型 | 说明 | 默认值 / 约束 |
|---|---|---|---|
| `BASELINE_API_URL` | string (URL) | Python 基准后端服务基础地址 | 必填，兼容别名 `BASELINE_BACKEND_URL`。缺省拒绝发起通信。 |
| `BASELINE_SERVICE_TOKEN` | string | 内部微服务调用强令牌 | 必填，通过 `X-Service-Token` 传递。无公开默认测试令牌。 |
| `BASELINE_ADMIN_TOKEN` | string | 管理级授权与登记凭据 | 可选，通过 `X-Admin-Token` 传递，供管理员执行运行级授权。 |

> [!IMPORTANT]
> 严禁在浏览器端引入上述凭据或配置。所有内部微服务调用必须通过 TanStack Start `createServerFn` 代理并在服务端执行。

---

## 3. 多租户与权限门禁 (RBAC)

### 3.1 品牌与组织解耦映射 (E-R08)
- 历史架构中部分客户的 `brand.id === organization.id`，但实际业务常存在 `brand.id !== organization.id`（例如品牌 `ALPHA` 属于组织 `org_alpha`）。
- 路由布局 `apps/web/src/routes/_authed/app/$brand.tsx` 与鉴权辅助函数 `apps/web/src/lib/auth/helpers.ts` 统一首先依据 `brand.id` 查询 `brands` 记录获取其真实 `organizationId`，并在 `member` 表中核验用户对该组织的成员身份。严禁将品牌标识当作组织标识导致 404。

### 3.2 操作员与审核员分级门禁 (E-R07)
- **普通操作员 (Operator)**：
  - 门槛：当前组织的有效成员 (`member` 记录存在)。
  - 权限：冻结通用输入快照、发起离线合成/受控诊断、录入与暂存分析草稿、查看运行进度与证据明细。
- **审核签发人 (Reviewer / Admin)**：
  - 门槛：系统超级管理员 (`user.role === 'admin'`) 或当前组织的管理员/拥有者 (`member.role IN ('admin', 'owner')`)。
  - 权限：审批或驳回报告修订版 (`reviewBaselineReportRevisionFn`)、登记服务端真实运行级授权 (`registerBaselineServerAuthFn`)。
  - 主体安全：审核主体硬绑定会话中的可信 `session.user.id`，严禁由客户端伪造。

---

## 4. 客户端打包与服务端隔离 (E-R01)

为彻底解决 TanStack Start 客户端代码被打包带入 Node.js 专有模块（如 `pg`、`Buffer`、`crypto`）引发的崩溃问题：
1. **纯服务端模块**：创建 `apps/web/src/server/baseline.server.ts`，存放数据库直连、环境变量读取、权限核验及 HTTP 通信逻辑。
2. **安全客户端桩**：`apps/web/src/server/baseline.ts` 严格只导出 `createServerFn` 函数。在各函数的 `.handler(...)` 内部使用动态 `await import("./baseline.server")`。
3. **验证标准**：打包产物 `apps/web/.output/public/assets/reports-*.js` 严禁出现 `Buffer` 或 `postgres-bytea`。

---

## 5. 档案题库映射与冻结规范 (E-R04)

- **主数据复用**：读取已有 `brands`、`brandProductLines`、`brandCredentials`，不重复开发客户 CRUD。
- **稳定题码映射**：
  - 预览阶段与冻结阶段使用完全相同的排序规则 (`createdAt ASC, id ASC`) 与映射逻辑。
  - 正式题目统一映射为 `Q01`, `Q02`, ...
  - 探针题目统一映射为 `PR01`, `PR02`, ...
  - 冻结 payload 显式保存 `original_prompt_id: p.id`，保证可回溯原题。
  - 若存在未设置业务分类/维度的题目，系统强制拦截冻结并提示操作员补齐分类。

---

## 6. 人工分析与多版本报告工作台 (E-R05 / E-R06 / E3-R02 / E3-R04)

- **表单无预填、无编造**：移除所有写死的预填结论（如“王分析师”、“波斯湾光伏”等），默认输入均为空或明确标识待核。
- **行动项 6 字段可逆往返 (E3-R02)**：
  - 行动项恢复与保存统一采用 `题码 | 建议行动 | 优先级 | 决策依据 | 交付件 | 验证方法` 格式。
  - 保证首次保存、刷新重登恢复、修改任一字段再保存时，`evidence_refs` 与各字段 100% 原样保留，绝不转为不可逆单向展示句。
- **任务运行选择器 (Run Selector)**：支持在工作台顶部下拉选择历史运行任务，切换任务时自动重置分析和修订状态。
- **多版本报告递增与审核状态 (E3-R04)**：
  - 支持基于同一运行追加 `rev_01`, `rev_02`, ... 不可变修订版本，避免 `revision_conflict`。
  - 刚生成的新版本自动保持为当前选中版本，避免旧数据竞态将选择回退；下载通道动态绑定当前所选修订。
  - 修订审核标签严格读取 `review_status`（已批准/已退回/草稿），状态单义清晰。
- **指标口径一致性**：自有域名引用率等直接消费后端口径，前端不进行任何除法或百分比备用计算，缺失明确标识“待核”。
- **全证据与引用展开**：支持完整查看大模型原始回答全文及解析出的引用 URL 列表；未知 token 统一兜底为“未知”。

---

## 7. 本地测试账号快速初始化 (E-R10)

在本地开发与测试环境中，可一键执行种子数据初始化脚本：
```bash
pnpm --filter @workspace/web run seed:local
```
该脚本将自动初始化：
- 组织：`org_alpha` (远景海工组织)
- 品牌：`ALPHA` (归属 `org_alpha`)
- 管理员账号：`admin@alpha.internal` (角色: `admin`)
- 操作员账号：`operator@alpha.internal` (角色: `member`)
- 预置题库：3 道正式工程题 + 1 道探针题
