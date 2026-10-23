# 生产诊断脚本（scripts/prod）

这些脚本用于**生产环境排查与验收**，全部指向 `89.106.84.135`。正常使用前必须先读本文。

## 环境变量（必设，脚本内不存任何密钥）

| 变量 | 用途 | 示例 |
|---|---|---|
| `GEO_ADMIN_PASSWORD` | elmo 后台登录密码（用于 UI 类脚本） | 从 Owner 处获取，不入库 |
| `PROD_WATCH_TOKEN` | 生产 agent-bridge token（消息收发脚本用） | `D:/let-them-talk/agent-bridge/prod-watch.token` |

## 脚本清单

| 脚本 | 作用 | 依赖 |
|---|---|---|
| `prod_m3_uat.mjs` | 品牌研究管道端到端验收（登录 → 触发研究 → 轮询 draft） | Playwright + `GEO_ADMIN_PASSWORD` |
| `prod_research_flow_v2.mjs` | 研究全流程（研究 → review → confirm → profile） | 同上 |
| `scan_interactive.mjs` / `rescan_zh.mjs` | 中文态 i18n 残留扫描 | 同上 |
| `prod-dump2.mjs` | 经 HTTP gateway 取生产 agent-bridge 完整消息（preview 截断时用） | `PROD_WATCH_TOKEN` |
| `prod-send.js` | 生产 agent-bridge 消息发送器（300s 超时 ×3 重试，适配慢网关） | `PROD_WATCH_TOKEN` |
| `prod-last2.mjs` | 取最近消息全文 | `PROD_WATCH_TOKEN` |
| `prod-agents.mjs` | 查生产 agent 在线状态 | `PROD_WATCH_TOKEN` |

## 用法示例

```bash
# 触发一次品牌研究并等结果
GEO_ADMIN_PASSWORD='...' node scripts/prod/prod_m3_uat.mjs

# 给生产侧 agent 发消息
PROD_WATCH_TOKEN='...' node scripts/prod/prod-send.js FDEV "内容"
```

## 注意

- Playwright 脚本必须带 `--no-proxy-server`（本机代理会劫持生产请求，报 502 假象）
- 生产服务器海外直连可用；**本地**调海外 API 需要 Clash TUN 模式
- 脚本只读/只调公开接口，不做数据删除；涉及删除的测试请用专门的一次性品牌
