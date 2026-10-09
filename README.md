# 「今天谁干啥」日程管理小程序

一个面向家庭的儿童日程管理微信小程序，支持双栏看板、重复日程、批量录入、订阅提醒等功能。

## 功能特性

### 家庭管理
- 4位邀请码创建/加入家庭
- 三级权限：Admin（管理员）、Editor（编辑）、Member（只读）
- 后端强制归属校验

### 日程管理
- 添加/编辑：全天/定时、地点（地图选点）、每周重复
- 批量录入：自然语言多行文本解析器
- 完成状态：卡片快速勾选 + 详情切换
- 删除策略：重复日程可选仅删当天或全部

### 视图展示
- 双栏看板：按孩子分栏显示日程
- 月历视图：42格日历，节假日标记，冲突提示
- 模糊搜索：按名称搜索，倒序排列

### 提醒系统
- 订阅消息提醒：每晚20:00发明天汇总 + 日程开始前N分钟逐项提醒
- 自定义提前量：15/30/60/120分钟可选
- 本地额度估算：显示剩余订阅次数
- 测试发送：验证订阅通道是否畅通

## 技术栈

- 前端：微信原生小程序
- 后端：腾讯云云开发
- 部署：GitHub Actions + CloudBase CLI

## 快速开始

### 环境准备
1. 克隆仓库
2. 用微信开发者工具打开项目
3. 配置云开发环境（在 `project.config.json` 中设置 `cloudfunctionRoot`）

### 本地开发
```bash
# 安装 CloudBase CLI
npm install -g @cloudbase/cli

# 登录
tcb login --secretId YOUR_ID --secretKey YOUR_KEY --env YOUR_ENV_ID

# 部署云函数
cd cloudfunctions/data && npm install --production && cd ../..
tcb fn deploy data --force

cd cloudfunctions/reminders && npm install --production && cd ../..
tcb fn deploy reminders --force
```

### 数据库索引
在云开发控制台为以下集合创建索引（见 `indexes.json`）：
- `families`: inviteCode（唯一）
- `tasks`: familyId, child, date
- `completions`: familyId, taskId, date
- `reminderSubscriptions`: openid, enabled, familyId
- `reminderLog`: openid, logKey, sentAt
- `holidays`: year

## CI/CD 自动化部署

本项目配置了 GitHub Actions 自动化部署流水线，push 到 main/master 分支后自动：
1. 安装 CloudBase CLI
2. 登录云开发
3. 部署云函数 data 和 reminders
4. 上传小程序代码

### 配置 Secrets
在 GitHub 仓库 Settings → Secrets → Actions 中添加：
- `TCB_SECRET_ID`: 腾讯云 API SecretId
- `TCB_SECRET_KEY`: 腾讯云 API SecretKey
- `TCB_ENV_ID`: 云开发环境 ID
- `APP_ID`: 小程序 AppID
- `PRIVATE_KEY_PATH`: 小程序上传私钥文件路径

详细说明见 [DEPLOY.md](./DEPLOY.md)

## 项目结构

```
├── pages/index/          # 主页面
│   ├── index.js          # 页面逻辑
│   ├── index.wxml        # 页面结构
│   └── index.wxss        # 页面样式
├── cloudfunctions/       # 云函数
│   ├── data/             # 数据操作云函数
│   └── reminders/        # 提醒云函数
├── utils/                # 工具函数
├── scripts/              # 部署脚本
├── docs/                 # 文档
└── .github/workflows/    # CI/CD 配置
```

## 许可证

MIT
