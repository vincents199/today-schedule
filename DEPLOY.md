# 「今天谁干啥」自动化部署配置指南

## 前置准备

### 1. 腾讯云 API 密钥
1. 登录 [腾讯云控制台](https://console.cloud.tencent.com/)
2. 进入「访问管理」→「API密钥管理」
3. 创建新密钥，记录 `SecretId` 和 `SecretKey`
4. 授予权限：`TCBFullAccess`（云开发）

### 2. 小程序上传私钥
1. 登录 [微信公众平台](https://mp.weixin.qq.com/)
2. 进入「设置」→「开发设置」
3. 找到「小程序代码上传私钥」，下载 `.pem` 文件
4. 将私钥文件上传到 GitHub（推荐使用 Secrets 存储）

### 3. 云开发环境 ID
1. 登录 [云开发控制台](https://console.cloud.tencent.com/tcb/)
2. 进入你的环境
3. 在「设置」中复制环境 ID（格式：`xxx-yyyzzz`）

---

## GitHub Secrets 配置

在仓库 Settings → Secrets → Actions 中添加以下变量：

| Secret 名称 | 说明 | 示例 |
|------------|------|------|
| `TCB_SECRET_ID` | 腾讯云 API SecretId | `AKIDxxxxxxxxxxxxxxxxxxxxxxxx` |
| `TCB_SECRET_KEY` | 腾讯云 API SecretKey | `xxxxxxxxxxxxxxxxxxxxxxxx` |
| `TCB_ENV_ID` | 云开发环境 ID | `your-env-id-xxx` |
| `APP_ID` | 小程序 AppID | `wx5f051a32a828f581` |
| `UPLOAD_PRIVATE_KEY_PATH` | 私钥文件路径（CI 环境） | `/home/runner/private.key` |
| `PRIVATE_KEY_PATH` | 私钥文件本地路径（用于本地调试） | `/path/to/private.key` |

---

## 手动部署

如果不想使用 CI/CD，可以手动部署：

### 1. 安装 CloudBase CLI
```bash
npm install -g @cloudbase/cli
```

### 2. 登录
```bash
tcb login --secretId YOUR_SECRET_ID --secretKey YOUR_SECRET_KEY --env YOUR_ENV_ID
```

### 3. 部署云函数
```bash
# data 云函数
cd cloudfunctions/data
npm install --production
cd ../..
tcb fn deploy data --force

# reminders 云函数
cd cloudfunctions/reminders
npm install --production
cd ../..
tcb fn deploy reminders --force
```

### 4. 同步数据库索引
```bash
tcb db index sync indexes.json
```

### 5. 上传小程序代码
```bash
npm install -g miniprogram-ci
node scripts/upload.js --appid YOUR_APPID --privateKeyPath /path/to/private.key --version 1.0.1
```

---

## 版本控制建议

1. **triggers.json** 已纳入版本控制，每次部署会自动覆盖现有触发器
2. **indexes.json** 包含所有集合的索引定义，确保数据库查询性能
3. 建议为每个功能分支创建独立环境，主分支部署到生产环境

---

## 回滚机制

如需回滚到上一个版本：

```bash
# 查看云函数历史版本
tcb fn list data

# 回滚到指定版本
tcb fn rollback data --version VERSION_ID
```

或在 GitHub Actions 中重新运行成功的工作流。
