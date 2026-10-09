# 提醒模板字段映射

当前提醒消息模板字段配置：

## 汇总消息（每晚 20:00）
| 字段 | 含义 | 示例值 |
|------|------|--------|
| name1 | 标题 | 家庭日程提醒 |
| thing3 | 内容摘要 | Angel 3项，Max 2项 |
| thing4 | 操作提示 | 点击进入查看明天安排 |
| time13 | 日期 | 2026-10-10 |

## 单项提醒（日程开始前 N 分钟）
| 字段 | 含义 | 示例值 |
|------|------|--------|
| name1 | 孩子名字 | Angel ♊ / Max ♏ |
| thing3 | 任务名称 | 钢琴课 |
| thing4 | 地点 | 琴行三楼 |
| thing1 | 备注（可选） | 带耳机、的水壶 |
| time13 | 时间 | 2026-10-10 08:00 |

## 自定义提前量
用户可在订阅时选择提醒提前量：15分钟 / 30分钟 / 1小时（默认）/ 2小时

---

# 数据库索引要求

为确保查询性能，请在云开发控制台创建以下索引：

## families 集合
- inviteCode（唯一索引）
- members（文本索引）

## tasks 集合
- familyId（文本索引）
- child（文本索引）
- date（文本索引）

## completions 集合
- familyId（文本索引）
- taskId（文本索引）
- date（文本索引）

## reminderSubscriptions 集合
- openid（文本索引）
- enabled（文本索引）
- familyId（文本索引）

## reminderLog 集合
- openid（文本索引）
- logKey（文本索引）
- sentAt（文本索引）

## holidays 集合
- year（文本索引）

索引配置文件见 `indexes.json`
