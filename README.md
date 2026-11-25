# Cloudflare Draw AI

基于 **Cloudflare Pages** 与 [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) 构建的轻量级在线 AI 绘画应用。零第三方依赖、无需构建步骤，仅凭 `index.html` 和 `_worker.js` 两个文件即可直接部署。

## 功能特性

- **零依赖部署**：纯原生 HTML / CSS / JavaScript 与 Pages Advanced Mode（`_worker.js`），无需 `package.json` 或构建命令。
- **6 款 Cloudflare 托管生图模型**：覆盖新一代 FLUX.2、FLUX.1 以及 Leonardo 系列模型，兼容 `multipart` 传参、JSON 传参及 `ReadableStream` / Base64 响应。
- **分级鉴权保护**：公开开放高性价比日常模型（`flux-2-klein-4b`、`flux-1-sch/ell`），其余高消耗模型通过环境变量 `ADMIN_PASSWORD` 校验密码后方可使用，防止免费额度被快速刷完。
- **实用前端体验**：支持浅色/深色主题切换、随机提示词、常用比例与自定义分辨率、反向提示词（Phoenix 1.0）、快捷键 `Ctrl / Cmd + Enter` 生成、一键下载与本地缩略图历史记录。

## 支持的模型列表

以下 6 款均为 Cloudflare 托管模型，共享 [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/) 提供的 **每日 10,000 Neurons 免费额度**（UTC 00:00 重置）：

| 模型标识 | 官方文档 | 访问权限 | 特点与参考免费量（1024×1024） |
| :--- | :--- | :--- | :--- |
| `flux-2-klein-4b` | [flux-2-klein-4b](https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/) | 公开免密（默认） | 蒸馏超高速 FLUX.2 模型，约 95 张/天 |
| `flux-1-schnell` | [flux-1-schnell](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/) | 公开免密 | 4 步快速出图，免费额度最耐用，约 173 张/天 |
| `flux-2-klein-9b` | [flux-2-klein-9b](https://developers.cloudflare.com/workers-ai/models/flux-2-klein-9b/) | 需 `ADMIN_PASSWORD` | 9B 参数高画质，约 7 张/天 |
| `flux-2-dev` | [flux-2-dev](https://developers.cloudflare.com/workers-ai/models/flux-2-dev/) | 需 `ADMIN_PASSWORD` | 高写实度与丰富细节，约 3–6 张/天（视步数而定） |
| `lucid-origin` | [lucid-origin](https://developers.cloudflare.com/workers-ai/models/lucid-origin/) | 需 `ADMIN_PASSWORD` | 平面设计、海报排版与文字渲染精准，最高 2500×2500，约 3 张/天 |
| `phoenix-1.0` | [phoenix-1.0](https://developers.cloudflare.com/workers-ai/models/phoenix-1.0/) | 需 `ADMIN_PASSWORD` | 强提示词遵循与连贯文字生成，支持反向提示词，约 4 张/天 |

## 项目结构

```text
cloudflare-draw-ai/
├── index.html   # 前端交互页面
├── _worker.js   # Cloudflare Pages Advanced Mode 后端（鉴权 + Workers AI 调用）
└── README.md
```

## 部署指南（Cloudflare Pages）

1. **连接 Git 仓库**
   在 Cloudflare 控制台进入 **Workers 和 Pages → 创建 → Pages → 连接到 Git**，选择本仓库（`kafuneri/cloudflare-draw-ai`）。

2. **构建配置**
   - **生产分支**：`main`
   - **构建命令**：留空
   - **构建输出目录**：留空（或填 `/`）

3. **添加 Workers AI 绑定**
   进入 Pages 项目的 **设置 → 绑定 → 添加**：
   - 类型选择 **Workers AI**
   - 变量名称填写 `AI`

4. **配置管理员密码（环境变量）**
   进入 Pages 项目的 **设置 → 变量和机密 → 添加**：
   - 类型选择 **机密（加密）**
   - 名称填写 `ADMIN_PASSWORD`
   - 值填写自定义的管理员密码

   > 未配置 `ADMIN_PASSWORD` 时，两款公开模型仍可正常使用；调用需鉴权的高级模型将返回 `503` 提示。

5. **重新部署与绑定自定义域**
   保存绑定与环境变量后触发一次重新部署即可生效。如需在国内稳定访问，可在项目的 **自定义域** 中绑定自己的域名。

## 接口说明

前端与外部客户端均可向站点根目录发送 `POST` 请求直接获取图片二进制流：

```bash
# 调用公开模型（无需密码）
curl -X POST https://your-domain.example/ \
  -H "Content-Type: application/json" \
  -d '{
    "model": "flux-2-klein-4b",
    "prompt": "a cozy Japanese cafe in the rain, warm lighting",
    "resolution": { "width": 1024, "height": 1024 }
  }' \
  --output output.png

# 调用高级模型（需在请求头传入 X-Admin-Password）
curl -X POST https://your-domain.example/ \
  -H "Content-Type: application/json" \
  -H "X-Admin-Password: your-admin-password" \
  -d '{
    "model": "phoenix-1.0",
    "prompt": "minimalist poster with bold text HELLO",
    "negative_prompt": "blurry, low quality",
    "resolution": { "width": 1024, "height": 1024 }
  }' \
  --output output.png
```
