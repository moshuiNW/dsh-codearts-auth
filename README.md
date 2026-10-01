# dsh-codearts-auth

> ## ⚠️ 本仓库已归档（ARCHIVED）
>
> **请改用上游项目：[iJetLi/deepseek-harness-codearts](https://gitee.com/iJetLi/deepseek-harness-codearts)**
>
> 本仓库已停止维护并归档为只读。上游是**严格超集**，且已支持国际站 ——
> 迁移不会丢失任何功能，反而会得到更多。
>
> ### 为什么迁移
>
> | | 本仓库 | 上游 |
> |---|---|---|
> | provider 数量 | 11 | **12**（多出 `minimax`） |
> | 国际站支持 | ✅ | ✅ |
> | 维护状态 | 已归档（只读） | 活跃维护 |
>
> 上游包含本仓库的全部 provider：`buddy`、`workbuddy`、`lobsterai`、`qoder`、
> `qodercn`、`trae`、`cline`、`loomy`、`raccoon`、`zcode`、`codearts`，
> 另有本仓库没有的 `minimax`（MiniMax Code 中国版）。
>
> ⚠️ 本仓库曾修复的几个缺陷（空体 429 不触发换号、账号在 `state.json` 丢失后
> 静默消失）**是否已并入上游未经核实** —— 上游 README 中未见相关记载。
> 若你正依赖这些修复，请先在上游实测确认，再决定是否切换。
>
> ### 如何迁移
>
> 1. 在 Jet Hub 中记录你已登录的账号。凭据本身存在 `~/.dsh/.credentials.yaml`，
>    **卸载插件不会删除凭据**，装上游后重新登录即可；
> 2. 卸载本插件（`dsh plugin` 把参数**原样转发给 pnpm**，故命令与 pnpm 一致；
>    把 `<name>` 换成你的 profile 名）：
>
>    ```sh
>    dsh plugin --profile <name> remove dsh-codearts-auth
>    ```
>
>    若提示找不到该依赖（不同安装方式下依赖名可能不同），用
>    `dsh plugin --profile <name> list` 看实际名称，或直接编辑 profile 的
>    `package.json` 移除后重跑安装；
> 3. 安装上游：
>
>    ```sh
>    dsh plugin --profile <name> add "https://gitee.com/iJetLi/deepseek-harness-codearts.git"
>    ```
>
>    ⚠️ **这一步别指望一次成功** —— pnpm 10/11 会拦截依赖的构建脚本，且**两代
>    要求的放行键写法不兼容**，写错就装不上。上游 README 的「安装」章节给了完整
>    步骤（先跑一次让 pnpm 打印它期望的键，再按报错类型选写法），**请直接照它做**。
>
> ### 本仓库的历史内容
>
> 下方的 README 正文、源码与提交历史**保持原样**，仅作存档参考。
> ⚠️ **其中的安装命令指向本仓库，归档后已不可用**；新增开发请基于上游进行。

deepseek-harness 插件：执行 CodeArts（华为云）登录流程，默认走新式 IAM OAuth
（portal `/authorize` 授权 → 本地 `/oauth/callback` 回调 → STS token 端点换取含
`refresh_token` 的凭据），到期前静默续期，无需再次打开浏览器；旧 ticket 流程保留
为显式回退（`flow: 'ticket'`）。插件还注册一个 `codearts` LLM provider 路由，使该
凭证可直接用于 CodeArts 后端模型调用。

> **来源与致谢**：本仓库派生自 [iJetLi/deepseek-harness-codearts](https://gitee.com/iJetLi/deepseek-harness-codearts)
> （MIT），跟随上游同步。原版权声明见 [LICENSE](LICENSE)。

此外插件内置另外五个 provider 路由：

- **buddy（腾讯 CodeBuddy）** — 见 [buddy provider](#buddy-provider)；
  另支持「一键领取积分」（每日签到）与「**锁定永久积分**」。
- **workbuddy（腾讯 WorkBuddy 国际版）** — 见 [WorkBuddy provider](#workbuddy-provider)；
  支持「**锁定永久积分**」。
- **lobsterai（有道 LobsterAI / 龙虾）** — 见 [LobsterAI provider](#lobsterai-provider)；
  另支持「一键领取积分」（每日签到）。
- **qoder（阿里系 Qoder）** — 见 [Qoder provider](#qoder-provider)；
  **支持积分余额与每日领取**（每日 100 Credits，10:00（UTC+8）刷新）；
  走**加密推理端点**，模型池与客户端一致（含 Qwen3.8 系列）。
- **loomy（讯飞 Loomy 办公助手）** — 见 [Loomy provider](#loomy-provider讯飞办公助手)；
  **唯一用短信验证码登录**、**唯一不能自动续期**的 provider；
  支持积分余额（两个池）、每日额度签到、**新手任务一键领取 10000 积分**，
  以及「**锁定永久积分**」（CodeBuddy / WorkBuddy 也有同名按钮，但判据不同）。

`codearts` 面板同样支持**积分账户检测、积分余额与「一键领取积分」**
（华为云「每日签到得积分」活动，走 `SDK-HMAC-SHA256` 签名）——
见 [CodeArts 积分](#codearts-积分华为云每日签到得积分)。

十一个 provider 的 Jet Hub 面板都提供「**显示列表**」按钮，可逐个开关模型以控制其
是否出现在对话框的模型选择里（黑名单制，默认全部显示）——
见 [模型列表开关](#模型列表开关黑名单)。

## 安装

> ⚠️ **本节已过时**：以下命令指向**本仓库**，而本仓库已归档（只读），
> 安装会失败或停留在旧版本。**请改用上游**
> [iJetLi/deepseek-harness-codearts](https://gitee.com/iJetLi/deepseek-harness-codearts)，
> 安装步骤见其 README 的「安装」章节。下方内容仅作存档。

该包尚未发布到 npm registry。提供两种安装方式：**git 仓库安装**（推荐，自动拉取
并构建）和**源码目录安装**（本地开发联调）。

### 方式一：从 git 仓库安装（推荐）

先在 profile 的 `pnpm-workspace.yaml` 中放行该包的 build 脚本
（路径形如 `~/.dsh/profiles/<name>/pnpm-workspace.yaml`）：

```yaml
allowBuilds:
  dsh-codearts-auth@git+https://github.com/moshuiNW/dsh-codearts-auth.git: true
```

再用 `dsh plugin add` 从 GitHub 拉取并安装：

```sh
dsh plugin --profile <name> add "https://github.com/moshuiNW/dsh-codearts-auth.git"
```

`add` 以 `git+https` 方式安装，pnpm 会运行 `prepare` 脚本自动构建 `lib/`，无需
手动 `pnpm build`。每次升级时重新 `add` 即可拉取最新版本并重建。

### 方式二：从源码目录安装（本地开发）

先在本仓库中构建 `lib/`，再用 `dsh plugin install` 将本地检出安装为 pnpm `link:`
依赖（指向本目录）：

```sh
pnpm build:all
dsh plugin --profile <name> install <path-to-this-repo>
```

> `dsh plugin install` 以 `link:` 方式安装，pnpm 不会为 `link:` 依赖运行
> `prepare` 脚本，因此必须先手动执行 `pnpm build:all` 生成 `lib/`，否则 dsh 启动时
> 报 `ERR_MODULE_NOT_FOUND: ... dsh-codearts-auth/lib/index.js`。
> 注意必须用 `build:all` 而非 `build`：后者只编译宿主侧，不产出
> `lib/client/jet-hub.js`。

每次修改 `src/` 或 `plugin-src/` 后都需要重新执行 `pnpm build:all`——dsh 启动时
不会自动重建。

### 通用说明

该包声明了 `dsh.bundle` 补丁（`cordis.patch.yml`），因此 profile 的 layer 栈会
自动拾取 `codearts-auth` 行。插件注入由 dsh base 提供的 `credentials`、
`commands` 和 `llm` 服务。

## 用法

**登录入口：Jet Hub 设置页的 CodeArts 面板**（与其余五个 provider 一致）。

⚠️ **不注册任何斜杠命令**。早期的 `/codearts-login`、`/codearts-status`、
`/codearts-refresh` 三个命令已移除 —— 登录、状态查看与续期统一在 Jet Hub 完成。
编程式调用仍可用：`ctx.codeartsAuth.login()` / `startLogin()` /
`refreshAccountCredential(refName)` / `refreshAll(pool)`。

## LLM provider

插件在 `ctx.llm` 上注册了一个 `codearts` provider 路由（OpenAI 兼容端点
`https://snap-access.cn-north-4.myhuaweicloud.com/api/v2`）。每个模型请求都使用
存储的 AK/SK/SecurityToken 按华为 `SDK-HMAC-SHA256` 方案签名，并附带
`Chat-Id`/`Session-Id` 请求头。默认广告的模型为 GLM-5.2、GLM-5.1、
GLM-5、GLM-5.3 Flash（`glm-5.3-flash`，1M 上下文）、盘古
openpangu-2.0-flash (92B) / openpangu-2.0-pro (505B)，
以及 DeepSeek V4 deepseek-v4-flash / deepseek-v4-pro（UI 标注每日 1000 万免费
Tokens 福利）。
登录后在 dsh Models 页面选择该 provider 即可。

> 注 1：CodeArts Agent IDE 模型列表显示的 flash ID 为 `deepseek-v4-flash-0731`
> （带日期后缀），但后端实际注册的可用 ID 是 `deepseek-v4-flash`（无后缀）。
> 用 `deepseek-v4-flash-0731` 调用会返回 `InferHub.002002009.404 The model is
> not registered`，因此本插件只注册无后缀的 `deepseek-v4-flash`。
>
> 注 2：`glm-5.3-flash`（GLM-5.3 Flash，2026-08 加入，1M 上下文）是 benefit
> （免费额度）模型：其 chat 请求必须携带 `maas_type: benefit` 请求头且该头
> 参与 `SDK-HMAC-SHA256` 签名，否则后端返回 `InferHub.002002009.404 The model
> is not registered`。适配器已自动处理，无需手动配置。
> （逆向自 CodeArts Agent IDE mitmproxy 抓包，对齐 deveco-code-rust 90aeb17d。）

凭据来自默认的新式 IAM OAuth 流程（含 `refresh_token`）。请求发起时会解析最新
凭据，若已过期则先静默续期，再用新 AK/SK/SecurityToken 签名，无需重新打开浏览器。

除 `codearts` 外，插件另注册十个独立的 provider 路由：`buddy`（见
[buddy provider](#buddy-provider)）、`workbuddy`（见
[WorkBuddy provider](#workbuddy-provider)）、`lobsterai`（见
[LobsterAI provider](#lobsterai-provider有道龙虾)）、`qoder`（见
[Qoder provider](#qoder-provider)）、`qodercn`（见
[Qoder CN provider](#qoder-cn-providerqoder-中国版)）、`trae`（见
[TRAE provider](#trae-provider字节跳动-trae)）、`cline`（见
[Cline provider](#cline-provider)）、`loomy`（见
[Loomy provider](#loomy-provider讯飞办公助手)）、`raccoon`（见
[Raccoon Work provider](#raccoon-work-provider商汤小浣熊)）与 `zcode`（见
[ZCode provider](#zcode-provider智谱-zai-免费额度)）。十一个互不覆盖，可同时使用。

## 凭证

- ⚠️ **只支持账号池**：每个账号的凭据存储在 `CODEARTS_ACCOUNT_XXX`（Ref 为 POSIX
  标识符格式的凭证 ref），由 Jet Hub 设置页管理。
- **单凭据模式已移除**：早期那条「登录写固定 ref `CODEARTS_ACCESS_TOKEN`、
  适配器在账号池取不到时回退读它」的路径已删除。固定的
  `CODEARTS_ACCESS_TOKEN` 不再被写入或读取 —— 若你此前只用它登录过，
  模型列表会变空，请在 Jet Hub 的 CodeArts 面板重新登录一次。
- 值：JSON 字符串 `{ access_key_id, secret_access_key, security_token,
  expires_at, domain_id?, user_id?, user_name? }` — AK/SK 对用于给每个 CodeArts
  后端 API 请求签名。

## 续期（refresh）

- 默认登录流程为**新式 IAM OAuth**（PKCE + DPoP）：portal `/authorize` 授权 → 本地
  `/oauth/callback` 回调收取 `code` → `sts.cn-north-4.myhuaweicloud.com/v1/oauth2/tokens`
  换取含 `refresh_token` 的凭据。
- 凭据在过期前 1 小时静默续期（`getFirstRefreshTime` 语义：距过期 ≤1h 立即刷，
  否则 `now+1h` 叠加随机秒偏移），全程无浏览器、无人工操作。
- 刷新失败后 10 分钟重试（异常网络 1 分钟）；`refresh_token` 失效后停止续期并提示
  重新登录。
- 旧 ticket 流程保留为显式回退：编程式调用
  `ctx.codeartsAuth.login({ flow: 'ticket' })`。ticket 凭据没有 `refresh_token`，
  其续期仍意味着重新运行浏览器登录流程。
- **续期按账号**：`refreshAccountCredential(refName)`（账号卡片的「刷新」按钮）
  与 `refreshAll(pool)`（定时调度器）。早期的 `refresh()` / `logout()` /
  `status()` / `scheduleRefresh()` / `scheduleModelRefresh()` 只服务于单凭据路径，
  已随该模式一并移除。
- 运行时依赖新增 `jose`（用于 DPoP JWS 签发，与 CodeArts Agent 插件实现一致）。

### ⚠️ 停用的账号同样会被续期

`refreshAll()` 与续期调度器**只按 `refreshable` 过滤，不看 `enabled`**。

停用只应影响「账号池的自动选号」，与「凭据是否需要保持新鲜」无关 ——
停用账号仍然出现在 Jet Hub 里，也仍然参与积分领取。

> **真实缺陷**：两个**曾停用**的 CodeBuddy 账号显示「凭证过期」，点「一键领取
> 积分」报 `Unexpected token '<', "<html> <h"... is not valid JSON`。
> 根因是两处都按 `enabled` 过滤：
>
> - `refreshAll()` 里的 `if (!entry.enabled || !entry.refreshable) continue`
>   → 停用期间 `refresh_token` 一路放到失效；
> - `src/index.ts` 的 `accounts.some(a => a.refreshable && a.enabled)`
>   → **所有账号都停用时，续期定时器根本不启动**。
>
> 用户重新启用后拿到的是死凭据，只能重新登录。四个 provider 的 `refreshAll`
> 与调度器都必须保持只看 `refreshable`。

### 凭据失效时不再抛 `Unexpected token '<'`

积分请求原本直接 `await response.json()`。凭据失效时腾讯网关返回的是
**HTML 错误页**，于是抛出 `Unexpected token '<', "<html> <h"... is not valid
JSON` —— 用户既不知道发生了什么，也看不出该重新登录。

现在先取文本再解析，非 JSON 时给出可读原因：

- HTTP 401/403 → 「凭据已失效（HTTP 401），请重新登录该账号」
- 其他状态 → 「服务端返回了非 JSON 响应（HTTP 502）：&lt;片段&gt;」

`src/credits.ts`（CodeBuddy 系）与 `src/lobsterai-credits.ts` 都已按此处理。

## 开发

- `pnpm test` — 单元测试（快速，无网络）。
- `pnpm test:e2e` — 针对华为线上端点的真实登录流程；需要在打开的浏览器中由人工
  点击授权按钮（续期为静默刷新，无需再次点击）。
- `pnpm typecheck`、`pnpm build:all`。

### 构建

- `pnpm build` — 用 tsc 将 `src/` 编译到 `lib/`（生成 `.js`、`.d.ts` 和 source
  map）。插件**宿主侧**入口是 `lib/index.js`。
- `pnpm build:client` — 用 esbuild 将 `plugin-src/client/` 打包为
  `lib/client/jet-hub.js`（Jet Hub 设置页的客户端 bundle，由 `exports["./client"]`
  引用）。它**不在** `tsc` 的编译范围内，必须单独构建。
- `pnpm build:all` — 依次执行上面两步（`build` + `build:client`），是完整的构建。
- `pnpm typecheck` — 只做类型检查（`tsc --noEmit`），不产出文件，可在构建前快速
  验证。

`lib/` 已被 gitignore，因此构建是安装或运行前的必需步骤。只执行 `pnpm build`
会漏掉客户端 bundle，dsh 启动时会因 `exports["./client"]` 指向的文件不存在而
加载失败（Jet Hub 设置页不显示），请改用 `pnpm build:all`。

每次修改 `src/` 或 `plugin-src/` 后都需要重新执行 `pnpm build:all`——dsh 启动时
不会自动重建。

### 安装到 profile 之前先构建

详见「安装」小节。`dsh plugin install` 以 `link:` 方式安装，pnpm 不会为 `link:`
依赖运行 `prepare` 脚本，因此必须先 `pnpm build:all` 生成 `lib/`（含客户端
bundle）。

## 工作原理

默认登录流程（新式 IAM OAuth，PKCE + DPoP）：

1. 生成 PKCE 配对与 DPoP ES256 密钥对，并启动本地 `127.0.0.1` 回调服务器。
2. 构造 portal `/authorize` URL 并打开华为云授权页面。
3. 授权后浏览器回调本地 `/oauth/callback`，携带授权码 `code`。
4. 向 STS token 端点（`sts.cn-north-4.myhuaweicloud.com/v1/oauth2/tokens`）用
   `code` 换取含 `refresh_token` 的凭据 JSON，并存储到 `CODEARTS_ACCESS_TOKEN` 下。
5. 凭据到期前静默续期（见「续期（refresh）」），无需再次打开浏览器。

旧 ticket 流程保留为显式回退（编程式调用 `ctx.codeartsAuth.login({ flow: 'ticket' })`）：
生成 `ticket_id`，打开 `devcloud.cn-north-4.huaweicloud.com/doer/redirect` 认证页，
回调后轮询 snap-manager ticket 端点（120 × 1 秒）获取临时凭证；此类凭据没有
`refresh_token`，其续期仍意味着重新运行浏览器登录流程。

## buddy provider

独立路由 `buddy`（腾讯 CodeBuddy，OpenAI 兼容端点
`https://copilot.tencent.com/v2/chat/completions`），Bearer `access_token` 鉴权。

登录采用 external-link-v2 轮询式（与 CodeArts 的本地回调服务器不同，CodeBuddy
不起本地端口，而是轮询后端 API）：

1. `POST /v2/plugin/auth/state?platform=ide` → 取得 `state` 与 `authUrl`。
2. 打开浏览器到 `https://www.codebuddy.cn/login/?platform=ide&state=...`。
3. 轮询 `GET /v2/plugin/auth/token?state=...`（1 秒间隔、5 分钟超时）→ 令牌；
   错误码 `11217` 表示 token 未就绪，继续轮询。
4. 轮询 `GET /v2/plugin/login/account?state=...` → 账户信息；错误码 `12151`
   表示账户信息未就绪，继续轮询。
5. 续期：`POST /v2/plugin/auth/token/refresh`，通过 `X-Refresh-Token` 头提交
   refresh_token。

- **登录入口：Jet Hub 设置页的 CodeBuddy 面板**（支持多账号与账号池自动切换）。
  已不再注册斜杠命令 —— 设置面板已覆盖登录、状态查看与续期，命令式入口冗余。
- 编程式调用：`ctx.buddyAuth.login()` / `status()` / `refresh()` / `logout()` /
  `fetchModels()`。
- 模型列表：以内置的产品目录为准（`src/product.ts` 的 `fallbackModels`），
  远端 `GET /v3/config` 可用时优先采用其元数据。
- 请求头：除 `Authorization: Bearer` 外，还需 `X-Domain`、`X-Product`、
  `X-Product-Code` 以及伪装为 `CodeBuddyIDE/1.106.1` 的 `User-Agent`。
- 凭据 ref：`BUDDY_ACCESS_TOKEN`，值为含 `access_token` / `refresh_token` /
  `expires_at` 的 JSON 字符串。

> **流式工具调用 id 稳定性**：CodeBuddy 仅首个工具调用分片携带真实 id
> （`chatcmpl-tool-xxx`），后续参数分片只有 `index`。适配器按 index 缓存并沿用
> 真实 id（缺失时回退 `call_{index}`），保证同一工具的所有分片 id 一致——否则
> 跨轮次（每轮都从 `call_0` 重新编号）会把 `tool/result` 配对到错误的历史条目。

### 安全策略拦截（11140）：会自动换号，被拦账号冷却 30 分钟

腾讯侧业务码 `11140`（`request illegal`）的文案写的是「内容未通过安全审核，请调整后重试」，
但**实测是按账号生效**：同一份请求体（哪怕只有「你好」两个字）发往池里 7 个账号，
结果是「2 个正常、4 个被拦、1 个限流」，换一个会话照样被拦。所以它的出路是**换号**，
不是让用户改内容。

适配器对它的处理（CodeBuddy 与 WorkBuddy 共用同一实现）：

- **三条通道都会继续换号**：首发 401/403 的认证换号、首发限流的换号、以及
  HTTP 200 + SSE 流内的错误帧 —— 坏账号排在池里任何位置都不会中断这一轮。
- **被拦的账号会在「该模型」上冷却 30 分钟**，避免每一轮都重撞它
  （池的候选顺序由你在 Jet Hub 拖拽决定，排在前面的坏账号否则每次都会先吃一发）。
  ⚠️ 账号卡片因此会亮「**限额重置 · <模型> · 30 分钟后**」徽章 ——
  这个徽章现在同时承载两种原因（服务端限流 / 策略拦截冷却），
  因为账号池里只有「模型 → 解禁时刻」这一个「暂时不可用」的载体，没有单独的字段。
  若确认该账号是好的，点「重测」（它会真发一条最小消息，正常返回就清掉标记）
  或「重置」即可立即解禁。
- **报错不会显示「API 密钥无效」**：这类错误归 `PERMISSION_DENIED` 而不是 `AUTH`。
  DSH 客户端对 `AUTH` 一律替换成「API 密钥无效」并丢掉原文，会把用户引向重新登录
  —— 而实测这些账号的 token 全部有效。现在看到的是原文，例如：

  ```
  workbuddy: 全部账号均被服务端安全策略拦截（HTTP 403，已逐个换号重试）。
  该拦截按账号生效（同一请求在其他账号可正常返回），请在 Jet Hub 停用或更换被拦账号：
  内容未通过安全审核，请调整后重试。 request illegal
  ```

### 单次输出上限（`max_tokens`）

**远端下发 `maxOutputTokens`，适配器必须消费它并写进请求体。** 这是「回答被
截断、UI 报『已达到输出 token 上限』」的唯一根因修复。

- 请求体 `max_tokens` 取值优先级：
  **`options.maxTokens`（DSH 注入）→ 远端 `data.models[].maxOutputTokens` → 产品兜底表**。
  三者皆无则**不发该字段**，交回网关默认值（不编造数值）。
- `resolveModel()` 同时把该值声明为 `defaultMaxTokens`。DSH 只在调用方未显式
  给值时用声明的默认值兜底；适配器不声明就等于把上限永久交给网关默认。
- ⚠️ **远端非法值必须过滤**：DSH 对 `defaultMaxTokens` 有硬校验（非安全整数
  或 ≤0 直接抛 `INVALID_MODEL_MAX_TOKENS`，整轮对话起不来），故远端是外部
  输入，`0` / 负数 / `NaN` 一律视为未声明（见 `positiveMaxTokens`）。

实测（2026-09-19，`node scripts/dump-max-output.mjs`）：

| 模型 | 中国版 scoped 端点 | 中国版 `/v3/config` | 国际版 `/v3/config` |
|---|---|---|---|
| `deepseek-v4.1-flash` | 128000 | 131072 | 128000 |
| `deepseek-v4-pro` | 128000 | 131072 | — |
| `deepseek-v4-flash` | 50000 | 50000 | — |
| `hy4-preview` | 64000 | 64000 | 64000 |

⚠️ **网关默认值恰好是 32000**（远端 `auto` / `glm-4.6` / `kimi-k2.6` 等模型
声明的就是 32000），这正是未下发 `max_tokens` 时 `deepseek-v4.1-flash` 在
32000 处被截断的原因 —— 不是「网关固定上限」，而是上游声明的额度被适配器丢了。

网关**确实接受** `max_tokens` 且**精确生效**（`node scripts/verify-max-tokens.mjs`，
国际版 `deepseek-v4.1-flash`，当时处于官方限免期 `credit: 0`）：

| 请求 | 结果 |
|---|---|
| 不带 `max_tokens` | HTTP 200，`finish_reason=stop` |
| `max_tokens: 128000` | HTTP 200，接受 |
| `max_tokens: 64` | HTTP 200，**`finish_reason=length`、`completion_tokens=64`** |

第三行是关键证据：输出被精确截断在 64，证明该字段被服务端真实消费，而不是
被静默忽略。

> **单次请求 ≠ 单轮**：每个 step 都是独立请求、各有各的预算。因此
> 「拆多步写文件」仍是超出单次额度时最有效的手段；`max_tokens` 只是把单次
> 额度提升到上游声明的真实值。
>
> **思考档位与输出预算共享同一额度**：`reasoning_tokens` 计入
> `completion_tokens`（实测 `thinking` 内容与正文同池），故思考开到 `max`
> 时正文更早撞上上限。

### 模型计费倍率与同名模型

模型切换列表里每个模型后面会显示它的**计费倍率**：

```
Deepseek-V4.1-Flash · x0.03
GLM-5.3 · x0.79→x0.50          ← 有促销活动时显示 原价→促销价
```

倍率拼在**模型名**（`name`）后面，而不是说明（`description`）里 ——
composer 的模型切换菜单**只渲染 `name`**，`description` 仅用于 `/model` 弹窗。
`name` 纯属展示，DSH 的选择与持久化只用 `id`，所以附加价格不会影响会话。

各 provider 的倍率字段**形态互不相同**，实现里是分开解析的：

| provider | 远端字段 | 真实形态 |
|---|---|---|
| `buddy` / `workbuddy` | `data.models[].credits` | 字符串 `"x0.29"`（可为空串） |
| `buddy` / `workbuddy` | `modelPromotions[].discount.discountedCredits` | 字符串 `"0.50x"`（**x 在后**）；`factor: 0` = 免费。⚠️ **只由 `/v3/config` 下发**，企业模型端点没有；且须按 `schedule` 判时段 |
| `lobsterai` | `data[].costMultiplier` | 裸数字 `0.05` |
| `qoder` | 目录 `chat[].price_factor` | 裸数字，**`0` = 免费** |
| `trae` | `display_contact_config.consumption_rate.data.rate` | **裸数字** `0.08`；`0` = 免费（⚠️ `display_contact_config` 本身是 **JSON 字符串**，须二次解析） |
| `codearts` | 无 | 两个目录端点都不含计费字段 |

腾讯系的促销值带 `schedule`（每日时段 + 有效期 + 时区），**必须按当前时间本地
推算此刻是否生效**，不能只看 `enabled`；`factor: 0` 表示**免费**（如
`hy4-preview` 的夜间免费），只有**没有时间窗口**的 `"0x"` 才当作「已结束」占位。

TRAE 的活动折扣只用**当前确实生效**的那一档：`activity_discount.enable` 为
`true` 也可能是「无折扣」（`discount_type: "none"`、原价==折后价，实测 `off_peak`
型即如此），照显会得到 `x0.13→x0.13`；已过 `end_at` 的活动同样不展示。

Qoder 的免费模型（`price_factor: 0`）显示为「免费」而不是 `x0`；有错峰折扣的
模型在**折扣时段内**显示「原价→折后价」，时段外只显示原价：

```
Qwen3.8-Flash · 免费
Qwen3.8-Max · x0.5→x0.2          ← 22:00–08:00（UTC+8）内
Qwen3.8-Max · x0.5               ← 时段外
DeepSeek-V4-Pro · x0.5
```

> ⚠️ **折扣形态三个 provider 统一为「原价→折后价」**（TRAE `x0.4→x0.2`、
> buddy `x0.79→x0.50`、Qoder `x0.5→x0.2`）。Qoder 早期是「只有折后价 +
> 中文角标」（`x0.2 错峰 4 折`），问题有二：① 看不出原价与折扣幅度；
> ② 角标与数字**冗余**（0.2/0.5 本就是 4 折）。

> ⚠️ `credits` 与 `discountedCredits` 的 `x` **位置相反**（`"x0.29"` vs
> `"0.50x"`）。早期版本只认前缀写法，导致促销价被静默丢弃。
>
> ⚠️ **腾讯系两个端点下发的模型 id 集合不同，必须取并集** —— 促销可能只挂在
> 其中一个端点独有的 id 上。实测 `hy4-preview-f`（新用户限时免费）**只由
> `/v3/config` 下发**且被 agent 引用，而 scoped 端点给的是 `hy4-preview`
> （无促销）。只采信 scoped 就会显示 `x0.29` 而 IDE 显示免费（用户报障
> 「hy4 preview 现在 ide 是免费我们还是 0.29」）。**不同账号下发的变体 id
> 也不同**，排查时须多账号对照。
>
> ⚠️ **腾讯系的促销只在 `/v3/config` 下发，企业模型端点没有** —— 而后者被优先
> 返回，所以早期实现**永远不显示促销**（用户报障「codebuddy 的倍率显示也是
> 没折扣的，GLM-5.2 是 0.5，现在显示 0.79」）。现补取促销表并合并。
> 且**必须按 `schedule` 判此刻是否生效**（`glm-5.2` 夜间/白天是两条互补活动，
> 不看时段会全天显示折扣价）；**`factor: 0` 是「免费」而非「已结束」**
> （`hy4-preview` 夜间免费，用户报障「夜间 0，现在显示 0.29」）。
> ⚠️ `/v3/config` **有 UA 校验**，UA 不对返回 HTTP 200 + `code:12403`，
> 极易误判为「该端点没有促销数据」。
>
> ⚠️ 产品兜底表是**白名单**（不在表里的 id 会被丢弃），但**被 agent 引用的
> 模型例外保留**（服务端自己的「可选」信号）—— 否则 `hy4-preview-f` 会被丢掉。
> 判据**不是**猜 id 后缀（`-f`/`-x`/`-sg` 含义各异，猜错会放进不可用的模型）。
>
> ⚠️ Qoder 的字段是 `price_factor`，**不是** `cost_multiplier`（后者是
> LobsterAI 的）。而 `price_factor: 0` 是**合法的免费值**，不能用 `> 0`
> 过滤掉。
>
> ⚠️ 倍率**不能**放进 `description`：那在切换模型列表里根本不可见
> （用户报障「消耗倍率没有显示在切换模型列表的后面」）。
>
> ⚠️ **Qoder 的错峰时段按 `windowStart`/`windowEnd` 本地推算，不采信目录的
> `promotion.active`** —— 后者是目录下发那一刻的快照，客户端长时间不重启
> 就会与真实时段脱节（用户在时段外看到折后价、或时段内看不到折扣）。
> 生效价由 `beforePromotionPriceFactor × discountFactor` 推出（实测三条全部吻合）。
> **真实缺陷**：早期表里存的是「采集时刻的生效价」却当成恒定值展示，
> 且 14 个模型的数值本身也是过期估值（`smodel` 写 3.2 实际 8），
> 用户报障「qwen3.8-max 是 0.5 打折到 0.2，界面显示的是 0.5」。

#### 同名模型会自动区分

服务端会给**不同 id 配同一个展示名**，实测三组：

| 模型 id | 远端展示名 | 实际差异 |
|---|---|---|
| `deepseek-v4.1-flash` / `deepseek-v4.1-flash-sg` | 都是 `Deepseek-V4.1-Flash` | 新加坡区，倍率 x0.00 vs x0.03 |
| `hy3` / `hy3-x` | 都是 `Hy3` | — |
| `hy4-preview-f` / `hy4-preview` | 都是 `Hy4 preview` | — |

由于选择器按展示名渲染，这些会变成无法区分的重复条目（用户报障：
「workbuddy 国际版同时显示 2 个 ds v4.1 flash，IDE 只有一个」——IDE 按展示名
归并，本插件按 id 列出）。二者是**不同区域的独立计费实体**，不能简单丢弃其一，
故对撞车的 id 求公共前缀、把剩余段追加到名字后：

```
Deepseek-V4.1-Flash · x0.00        (deepseek-v4.1-flash)
Deepseek-V4.1-Flash · x0.03 SG     (deepseek-v4.1-flash-sg)
Hy3 · x0.00                        (hy3)
Hy3 · x0.05 X                      (hy3-x)
```

用公共前缀而不是硬编码 `-sg`，是因为撞车组会随服务端上新变化（本次实测三组
里只有一组带 `-sg`）。LobsterAI 实测无同名（28 个模型 0 组重名），故不做消歧。

## WorkBuddy provider（国际版）

独立路由 `workbuddy`（腾讯 **WorkBuddy 国际版 / WorkBuddy AI**），与
[buddy provider](#buddy-provider) **同源**：共用同一 CLI 内核与同一认证协议
（cli-external-link 轮询式），Bearer `access_token` 鉴权。差异收敛在
`src/product.ts` 的产品配置里：

| 项 | CodeBuddy（中国） | WorkBuddy（国际版） |
|---|---|---|
| `endpoint` | `https://copilot.tencent.com` | **`https://www.workbuddy.ai`** |
| `platform` | `ide` | **`workbuddy-ai`** |
| 登录 URL 附加参数 | 无 | **`version` / `loginSessionId`** |
| `pluginVersion` | — | `5.5.2` |

**模型列表不能与中国版共用**：两者的路径与响应解析完全相同
（`GET /v3/config` → `data.data.models` / `data.data.agents`），差异只来自
`endpoint` —— 不同区域的后端返回不同模型池（中国版含 glm / hy / deepseek 系，
国际版含 claude / gpt / gemini / kimi 系）。因此 `endpoint` 必须随产品切换，
不能被当成全局常量。

登录流程与 CodeBuddy 一致（`auth/state` → 浏览器授权 → 轮询 `auth/token` →
轮询 `login/account`），仅身份标识与端点按上表区分。`X-Product-Code` 为
`workbuddy`，`X-Domain` 随 `apiDomain` 切换为 `www.workbuddy.ai`。

**没有每日签到积分**：国际版后端不提供**签到**接口（内核中只有
`/v2/billing/meter/get-dosage-notify` 用量通知），因此 Jet Hub 的 WorkBuddy
面板**不显示「一键领取积分」按钮**；签到领取在 CodeBuddy 面板完成。

> **但积分余额（Credits Balance）可以查。** 签到与余额是两项独立能力：国际版
> 确实没有签到，但**有**积分余额查询接口，见下节。不要因为"没有签到"就推断
> 也查不到余额。

- **登录入口：Jet Hub 设置页的 WorkBuddy 面板**（支持多账号与账号池自动切换）。
  同样不注册斜杠命令。
- 编程式调用：`ctx.workbuddyAuth.login()` / `status()` / `refresh()` / `logout()` /
  `fetchModels()`。
- 凭据 ref：
  - 单账号：`WORKBUDDY_ACCESS_TOKEN`，值为含 `access_token` / `refresh_token` /
    `expires_at` 的 JSON 字符串（与 `BUDDY_ACCESS_TOKEN` 同构）。
  - 多账号：`WORKBUDDY_ACCOUNT_<UUID_SHORT>`，由 Jet Hub 设置页「+ 新建账号」
    登录时自动生成并登记到账号池；每条账号记录带 `provider: 'workbuddy'`，
    与 CodeBuddy 的 `BUDDY_ACCOUNT_*` 相互隔离，不会串用凭据或限流标记。
- **从中国版升级**：本插件早期版本把 `workbuddy` 指向中国版
  （`copilot.tencent.com`）。启动时会自动清理凭据 `domain` 与当前
  `apiDomain` 不符的旧账号（这类凭据在新端点必然失败），清理结果记入日志，
  请在 Jet Hub 重新登录。
- 续期：与 CodeBuddy 共用同一套机制，插件启动后每 30 分钟对可续期账号静默刷新
  （`refresh_token` 经 `X-Refresh-Token` 头提交），无需重新打开浏览器。
- 请求头、模型列表拉取与流式工具调用 id 处理均与 CodeBuddy 一致，详见上一节。

### 与 Jet Hub 设置页的关系

Jet Hub（设置页）的账号面板按 provider 分组展示，WorkBuddy 是其中一栏：

- 面板提供账号列表、新建账号（浏览器登录入池）、启用/停用、删除、**拖拽排序**，
  以及「重测 / 重测所有 / 重置 / 重置所有」限流标记操作，行为与 CodeBuddy
  面板一致，但只操作 `provider: 'workbuddy'` 的账号。
- 账号卡片展示 credentialRef、有效期（含「自动续期」标记）、限流状态与**积分
  余额**（见下节）。「一键领取积分」按钮**仅 CodeBuddy 面板提供**，结果来自
  RPC 端点 `credits.claimAll`（实现见 `src/jet-hub-rpc.ts`，签到客户端见
  `src/credits.ts`）。
- 后端另实现了 `credits.status`（查询某 provider 下全部启用账号的签到状态），
  但**前端尚无消费者**：`plugin-src/client/jet-hub.js` 只调用 `credits.claimAll`，
  `credits.status` 目前仅供外部脚本或直接 RPC 调用使用。
- 对应 LLM provider 的设置命名空间为 `llm-workbuddy`。

### 「+ 新建账号」必须走两步式登录（四个 provider 一致）

`account.create` 对**全部四个 provider** 都遵守同一契约：**在用户完成授权之前
就返回 `loginUrl`**，由前端立即 `window.open`，后台再异步等回调。

这不是风格偏好，而是浏览器安全模型的硬约束：`window.open` 只在用户点击后的
**transient activation** 窗口（约 5 秒）内被允许。若 `account.create` 阻塞到
用户授权完成才返回（数十秒），拿到 URL 时手势早已过期，弹窗必被拦截并返回
`null`，前端若兜底执行 `window.location.href = loginUrl`，就会把**整个设置页**
导航到外部登录页 —— 用户报障「codearts 新建账号应该弹出新的页面，现在主页面
直接跳转过去了」正是此因。

| provider | 后端实现 | 前端交互 |
|---|---|---|
| `buddy` / `workbuddy` | `runBuddyLoginFlow` 不 await，立即返回 URL | 弹小窗 + 轮询 `login.poll` |
| `codearts` | `CodeArtsAuth.startLogin()` | 同上 |
| `lobsterai` | `LobsteraiAuth.startLogin()` | 同上 |

- 两步式的入口在 `src/login.ts` 的 `startOAuthFlow` 与 `src/lobsterai-oauth.ts`
  的 `startLobsteraiLoginFlow`；原阻塞式 `runOAuthFlow` /
  `runLobsteraiLoginFlow` 保留（CLI、e2e 仍用），现由前者实现。
- 两步式路径**没有外层 `try/finally` 兜底**，故超时与「结果落定即关闭回调
  服务器」都收在 `start*` 内部，避免泄漏监听端口。
- 前端**不再**保留 `window.location.href` 兜底：弹窗被拦截时改为展示一个可点击
  的登录链接（`loginUrlForManual`），轮询照常进行，用户手动打开也能完成登录。
- 回归测试见 `tests/unit/jet-hub-rpc.spec.ts` 的
  「account.create 必须立即返回 loginUrl」：用「授权永不完成」的替身模拟用户
  尚未操作 —— 旧实现会超时失败，新实现立即返回。

### 账号拖拽排序（顺序 = 选号优先级）

Jet Hub 各 provider 面板的账号卡片可**拖动调整顺序**，卡片左上角显示序号。

**这不是纯 UI 装饰**：账号列表的数组顺序就是 `getAvailableAccount` 的候选
优先级 —— 自动选号、以及限流后换号重试，都按这个顺序取「第一个可用账号」。
把常用账号拖到前面，它就会优先被使用。

语义是「**手动顺序优先，限流豁免**」：

- 顺序完全由用户决定（不按任何服务端字段重排）；
- 但当前正处于**限流期**的账号会被跳过，不会选到 —— 即使它排在第一位。

> ⚠️ 早期实现有一个 `candidates.sort((a,b) => resetAtA - resetAtB)`（按限流
> 重置时间最早到期优先）。它会让拖拽形同虚设：用户把某账号拖到首位，只要
> 另一个账号的重置时间更早，实际选中的仍是后者。该排序已移除，
> `tests/unit/account-pool.spec.ts` 有回归用例锁死。

交互细节：

- 拖动整张卡片，或抓住左侧的 `⠿` 手柄；
- 插入位置按指针落在目标卡片的**上半 / 下半**决定（前插 / 后插），
  并以卡片上方或下方的蓝线指示。只支持「前插」时把卡片往下拖一格会变成
  空操作，因此必须区分方向；
- 顺序**乐观更新**（本地先变、再提交），失败则回滚并提示；
- 提交期间禁用拖拽，避免并发提交互相覆盖；
- 只有 1 个账号时不启用拖拽（排序无意义）。

实现：RPC `account.reorder` → `AccountPool.reorderAccounts()`
（只动本 provider 占用的下标，其他 provider 账号位置不变）；
前端拖拽逻辑在 `plugin-src/client/account-order.js`（纯函数，可单测）。

### 积分余额（Credits Balance）

账号卡片上的「积分」一行显示该账号的**可用积分**，与 IDE 顶部显示的
`Credits Balance` 是同一个数值。鼠标悬停可看到各资源包的明细与到期时间。

两个 buddy 的卡片还会**额外显示「临时 X · 永久 Y」分桶**（与下方
[锁定永久积分](#锁定永久积分codebuddy--workbuddy)同一判据），tooltip 里每个包
标出「距到期 N 天」。这条也直接解释了"锁上为什么没号可用"——临时桶是 0。

⚠️ **分类在渲染的那一刻现算，不缓存**：它是「距扣费截止是否满 15 天」的判断，
而宿主长期开着、时间只向前流——一笔距到期 15 天 30 秒的余额，用户什么都不做，
半分钟后就越过了线。所以选号侧缓存的也只是 `get-user-resource` 的**原始包列表**
（TTL 60 秒只用于抑制网络请求），命中缓存同样重新分桶；面板侧每次渲染传当下的
`Date.now()`，不存分类、不设常驻定时器。

**两个产品通用**——CodeBuddy 中国版与 WorkBuddy 国际版都实现同一接口
（只是 baseURL 随 `product.endpoint` 切换）：

```
POST /v2/billing/meter/get-user-resource    body {}
```

### 锁定永久积分（CodeBuddy / WorkBuddy）

面板上的「锁定永久积分 / 解锁永久积分」按钮用来**保住不会马上作废的积分**，
语义与 [Loomy 的同名功能](#锁定永久积分)一致，但**判据必须自己算**——腾讯系
的响应里没有「永久 / 临时」这个字段。

**判定规则（用户定）：距扣费截止不足 15 天的积分算临时（优先烧掉），其余算永久。**

⚠️ 「到期」只能看 `DeductionEndTime`（毫秒时间戳）。实测 2026-09-29 两站真实账号：

| 包 | `ExpiredTime` | `CycleEndTime` | **`DeductionEndTime`** | 归入 |
|---|---|---|---|---|
| WorkBuddy「Bonus Pack」 | `''` | 9 天后 | **9 天后** | 临时 |
| WorkBuddy「Free Plan Subscription」 | `''` | **2 天后** | **3008 天后** | 永久 |
| CodeBuddy「个人体验版」 | `''` | 已过期 | 3008 天后 | 永久（本周期已无余额） |
| CodeBuddy「拉新权益包 / 国内运营裂变包」 | `''` | 同下 | **17～208 天后** | ≥15 天者永久 |

- `ExpiredTime` **没有区分力**：有效包一律是空串，它只在包**真正失效之后**才回填
  （此时 `Status` 已变 3、余额已归零）。
- `CycleEndTime` **会把套餐误判**：订阅包的计量周期是月度的（月底清零），但扣费
  截止在 8 年后。取前者会把每月刷新的套餐当成「马上作废」，锁定就形同虚设。
- 余额口径取 **`CycleCapacityRemain`（本计费周期剩余）**，与 IDE 顶部的
  `Credits Balance` 一致：实测体验版**终身**还剩 500 而**本周期**剩 0，
  那 500 实际扣不到，算进可用额度会出现「看起来有钱却用不了」。
- 到期时间**未知**（服务端没给 `DeductionEndTime`）的包归入永久桶——保守方向，
  最坏是少用一个号，而不是误把长期积分当快到期烧掉。

**选号策略**（与 Loomy 同构）：有 15 天内到期积分的号优先 → 只剩永久积分的号
→ 无余额 / 查询失败排最后；**档内保持你在 Jet Hub 拖拽的手动顺序**。余额查询带
60 秒缓存（该端点响应实测可达数百 KB，一个账号可能有 105 个资源包）。

| 状态 | 行为 |
|---|---|
| 解锁（默认） | 先烧快到期的积分，这类用完**继续用永久积分** |
| **锁定** | **只消耗 15 天内到期的积分**；只剩永久积分的账号视为不可用 |

锁定后若所有账号都没有 15 天内到期的积分，请求报**明确错误**提示你解锁，
而不是偷偷消耗永久积分。

⚠️ **中国版的一个直接推论**（实测，不是缺陷）：CodeBuddy 的赠送包按 30 天发放，
「距到期」天然落在 17～30 天区间 ⇒ 默认 15 天窗口下**整池都算永久**，锁上就立刻
「无可用账号」。想在这种池上用锁定，把窗口放宽即可（重启插件生效）：

```
DSH_BUDDY_EXPIRING_WINDOW_DAYS=31
```

实测（窗口 31 天）：该账号 10064 积分里 6264.61 改判临时、3799.99 仍是永久，
锁定后仍可正常选号。面板与报错文案会**跟随后端回传的实际天数**渲染，
不会出现「提示说 15 天、实际按 31 天筛号」。

开关是 **provider 级**（CodeBuddy 与 WorkBuddy 各一份，互不影响），持久化在独立文档
`$DSH_HOME/jet-hub/permanent-locks.json` 的 `locks` 表（形如 `{ buddy: true }`，
缺键即未锁定）；RPC 端点 `credits.permanentLock`（`loomy.permanentLock` 是同一
实现的历史别名）。

⚠️ **为什么不与账号池同放 `state.json`**：那份文档是 **dsh home 级、同机多 profile
共享**的，而本插件的存储是整体替换语义。若你像我一样把 desktop 与 web 分成两个
工作区（两份代码版本不同），另一侧的旧版本代码任何一次整体写入（加删账号、改模型
开关、命中限流）都会把它不认识的字段抹掉 —— 于是这侧的锁定**静默失效**，而失效的
后果是真把永久积分烧掉，不可撤回。拆成独立文档后旧代码从不碰它，两个工作区才真正
互不影响。Loomy 那一项仍会同步一份镜像到 `state.json` 的 `loomyPermanentLocked`
（旧版本只读它），所以另一侧的 Loomy 面板也不会显示错值。

### 模型列表开关（黑名单）

Jet Hub 面板标题栏的「**显示列表**」按钮展开该 provider 的**全部模型**，每个模型
后面带一个开关，**默认打开**。关闭后该模型不再出现在对话框的模型选择列表里。

采用**黑名单制**：只有被显式关闭的模型会被隐藏，未记录的模型（含服务端后续新增的
模型）一律默认显示。这与白名单制的关键差别在于——新模型上线时无需任何配置就会
自动出现在选择器里，不会被静默挡在门外。

- 开关状态持久化在 `jet-hub` settings 命名空间的 `disabledModels` 字段
  （形如 `{ buddy: { 'glm-5.2': true } }`），与账号池同处一个 namespace。
- 模型列表来自 `ctx.llm.listModels()`，**即对话框模型选择器读取的同一份目录**
  （会话控制器的 `buildModelCatalog`），因此设置页展示的模型与实际可选集合始终
  一致，不会出现「设置里有、选择器里没有」的错位。
- 过滤发生在适配器的 `listModels`（`src/llm-adapter.ts` / `src/buddy-adapter.ts` /
  `src/lobsterai-adapter.ts`），
  每次调用都直接读账号池的黑名单，因此**改开关后下一轮模型目录刷新即生效**，
  无需重启或重建适配器。
- **只影响目录播报，不改变路由能力**：被关闭的模型仍可被 `resolveModel` 解析、
  仍能正常收发请求。这是 DSH 对 `listModels` 的约定（目录是建议性的，缺省不构成
  请求拒绝）。好处是已有会话若正用着某个被关闭的模型，不会被强制中断。
- 开关按 provider 隔离，CodeArts / CodeBuddy / WorkBuddy / LobsterAI 四份黑名单互不影响。
- 相关 RPC 端点：`model.list`（列出模型并回填 `disabled`）、`model.setDisabled`
  （打开/关闭单个模型），实现见 `src/jet-hub-rpc.ts`。

### 没有已登录账号就不显示该 provider（目录门控）

**需求**：若某供应商没有已登录的账号，就不显示该供应商的所有模型 —— 这样对
大多数用户来说模型选择选项卡臃肿的问题能改善很多。

**机制**：DSH 的 `buildModelCatalog` 显式 `.filter(group => group.models.length > 0)`
（注释 *"successful non-empty provider groups"*），所以适配器 `listModels`
返回**空数组**即可让整个 provider 分组从模型选择器消失 —— **无需任何前端改动**。

- **判据是「凭据能否解析」**，不是「有没有账号条目」：登出（`logout()`）只清凭据、
  保留条目，若只看条目则登出后模型仍会显示，门控形同虚设。
- **不看 `enabled`**：停用只影响自动选号，与「是否已登录」无关。把所有账号停用的
  用户仍能看到模型（与「续期只看 `refreshable`」是同一条约定）。
- ⚠️ **CodeArts 是唯一保留单凭据模式的 provider**：它额外把
  `CODEARTS_ACCESS_TOKEN` 计入判据，只用单凭据登录的老用户不会受影响。
  其余五个 provider 只看账号池。
- ⚠️ **返回空数组而非抛错**：抛错会被归入 catalog 的 `failures`，界面反而多出
  一条 provider 报错。
- ⚠️ **不影响路由**：`routableProviders` 单独生成（不经该 filter），已持久化的
  模型仍可正常收发 —— 与黑名单同一契约。
- ⚠️ **门控只作用于对话框目录**；Jet Hub 的「显示列表」（`listAllModels`）仍列出
  全部模型，否则用户关掉模型后连开关都看不到、无法重新打开。
- **判据不可用时保守放行**（无账号池 / 替身未实现 / 读凭据异常）：门控是展示优化
  而非安全边界，宁多勿少。
- 开关：`DSH_HIDE_MODELS_WITHOUT_ACCOUNT`（**默认开启**，设 `0`/`false`/`no`/`off`
  可关闭）。实现见 `src/account-pool.ts` 的 `hasLoggedInAccount` /
  `providerCatalogVisible`。

### 积分余额（Credits Balance）

账号卡片上的「积分」一行显示该账号的**可用积分**，与 IDE 顶部显示的
`Credits Balance` 是同一个数值。鼠标悬停可看到各资源包的明细与到期时间。

**支持范围**：四个 provider 都支持，但**三套协议各不相同**：

**CodeBuddy 中国版与 WorkBuddy 国际版**（同一接口，只是 baseURL 随
`product.endpoint` 切换）：

```
POST /v2/billing/meter/get-user-resource    body {}
```

**LobsterAI**：`GET /api/user/profile-summary` → `data.totalCreditsRemaining`。

**CodeArts**（华为云，见 `src/codearts-credits.ts`）：

```
GET {snapEngineUrl}/snap-manager/v1/statistics/plugin
```

余额取自响应的 `metrics[]` 中 `usageTotalPackageCredit` 的
`package_credit_remain`（**不累加**基础/按需/赠送分类明细——它们是总额的
构成项，相加会重复计算）。非积分计费账户不显示「查询失败」，而是如实提示
「Token 计费账户，无积分余额」——那是账户类型差异，不是故障。

> 能力矩阵在 `plugin-src/client/credits-capabilities.js`，由客户端在
> **请求前**判定，而非等后端返回错误再吞掉。
>
> 历史缺陷：早期客户端在面板挂载时对所有 provider 无条件调用
> `credits.balances`，而当时 CodeArts 没有积分能力，于是每次打开 CodeArts
> 面板都会在控制台报 `unsupported provider: codearts`，并把每个账号卡片的
> 「积分」渲染成「查询失败」。修法是不发起该请求——后端 `productById()` 的
> 拒绝是正确的契约行为，不该被当作运行时故障展示。

### 一键领取积分（每日签到）

**四个 provider 中三个提供**该按钮（三套签到协议完全不同，实现各自独立）。
WorkBuddy 国际版后端没有签到接口，故其面板不显示。

在 Jet Hub 对应面板标题栏点击「**一键领取积分**」，插件会对该面板下
**全部账号**顺序执行每日签到领取：

> **含已停用账号。** 停用只影响账号池的自动选择与限流切换，不改变账号本身
> 是否已签到——用户点「一键领取」时期望所有账号都尝试一遍。

**CodeBuddy（两步）**：

1. 先查签到活动状态（`POST /v2/billing/meter/checkin-activity-status`）；
2. 活动未开启或今日已签到则跳过领取请求，只报告状态；
3. 否则调用领取端点（`POST /v2/billing/meter/daily-checkin`）领取当日积分。

**LobsterAI（三步，见 `src/lobsterai-credits.ts`）**：

1. 查活动槽位（`GET /api/client-activities/slot`，带固定的
   `placement` / `containerApiVersion` / `platform` 参数）；
2. 查活动上下文（`GET /api/client-activities/{code}/context`），
   读 `claimedToday` 与 `actions` 决定是否可领；
3. 领取（`POST /api/client-activities/{code}/actions/check_in`，
   请求带客户端幂等键 `idempotencyKey`）。

> LobsterAI 的 `clientVersion` 是签到**必填**参数，由插件动态拉取
> （`api-overmind.youdao.com` 的更新接口，缓存 12 小时）；
> 拉取失败时回退内置兜底版本并在日志告警 —— 比参考实现的
> 「取不到就完全放弃签到」更宽容。

**CodeArts（四步，见 [CodeArts 积分](#codearts-积分华为云每日签到得积分)）**：
账户类型检测 → 活动列表预检 → `POST /v1/ops/claim` →（必要时）
`POST /v1/ops/confirm`。

完成后按钮下方给出结果摘要（如「3 个账号领取成功（+300 积分），1 个今日已领取」）。
领取按账号隔离：单个账号凭据缺失、损坏或请求失败不会中断整批，只计入失败数；
摘要**只显示各类计数**（如「1 个失败」），不展示每个账号的失败原因——原因保留在
`results[].outcome.message` 中，需要时请通过 RPC 响应或日志查看。

几点实现约定：

- 领取是**顺序执行**的，避免并发触发风控；账号较多时需要等待片刻。
- **CodeBuddy** 重复领取是幂等的：服务端返回 HTTP 400 + `code 10001`（「今天已签到，
  请明天再来」），插件把它识别为 `already-claimed` 而非失败。
- **LobsterAI** 的幂等由**客户端**保证：请求带 `idempotencyKey`，且领取前先读
  `context` 的 `claimedToday` 与 `actions`；重复领取会被识别为 `already-claimed`。
- **CodeArts** 的幂等由**活动列表预检**保证：没有幂等键、也没有「今天已签到」
  业务码可依赖，唯一的保护是 `claimable` / `status` 预检（见下节）。
- CodeBuddy 的状态查询用 `checkin-activity-status` 而非 `checkin-status`；后者返回
  占位数据（`active:false`、`checkin_dates:null`），会让人误判为活动未开启。
- CodeBuddy 的请求**不需要** `X-Device-Token`（图灵盾）——已实测验证。
- LobsterAI 的签到**不需要签名**，只用 `Authorization: Bearer`；也**不发**腾讯系的
  `X-Domain` / `X-Product` / `X-Product-Code` 头。

想单独验证领取闭环（会真实改动账号当日签到状态）可运行
`pnpm test:e2e:workbuddy-claim`、`pnpm test:e2e:lobsterai-claim` 或
`pnpm test:e2e:codearts-claim`，说明见 `tests/e2e/README.md`。

### CodeArts 积分（华为云「每日签到得积分」）

实现见 `src/codearts-credits.ts`。活动规则见
[华为云官方文档](https://support.huaweicloud.com/offers-codeartsagent/codeartsagent_offers_0004.html)：
完成每日签到得 **1000 积分**，积分自发放起 30 天内有效；**活动参与者限定
「已经升级到积分计费模式的用户」**——这正是必须先做账户类型检测的原因。

#### 认证走签名，不走 Cookie（关键结论）

官方文档给出的是**网页版**路径（`https://codearts.huaweicloud.com/portal/...`），
那是 portal BFF 接口，**依赖浏览器会话 Cookie**：实测不带 Cookie 时，无论是否
携带 AK/SK 签名，都返回 IAM 登录跳转 HTML（HTTP 200 + `text/html`）。
本插件没有可用的浏览器会话，因此**不能**复用那条路径。

可用的是**码道 IDE 直连**的 `snap-access` 端点，它接受
**`SDK-HMAC-SHA256` 签名**——与本仓库 `src/sign.ts` 逐字一致，
凭据就是现有的 `CodeArtsCredential`，**无需任何新的登录流程**。
协议逆向自本机安装的码道 IDE（`out/main.js` 的 `PackageInfoService`、
`out/vs/workbench/workbench.desktop.main.js` 的 `ActivityWelfarePane`）：

| 用途 | 端点（base = `snapEngineUrl`） |
|---|---|
| **账户类型检测** | `GET /snap-manager/v1/statistics/plugin` |
| 活动列表 | `GET /v1/ops/delivery?channel=IDE` |
| 领取 | `POST /v1/ops/claim` `{ campaignId, channel: 'IDE' }` |
| 领取确认 | `POST /v1/ops/confirm` `{ campaignId }` |

`snapEngineUrl` = `https://snap-access.cn-north-4.myhuaweicloud.com`
（与 `src/models.ts` 的 `SNAP_MODEL_BUILTIN_URL` **同域**）。

所有请求需带 `Agent-Type: PromptCenter` 与 `X-Language: zh-cn`，但
**这两个头必须在签名之后追加，绝不能参与签名计算**：

> ⚠️ **实测（2026-09-18）**：把它们作为 `signRequestHuawei` 的 `extraHeaders`
> 传入（即进入 canonical request 与 SignedHeaders），服务端会回
> `401 {"error_code":"APIG.0301","error_msg":"...verify ak sk signature fail"}`；
> 改为**签名后追加**则同一端点返回 200 与真实数据。
>
> 这与 `src/models.ts` 的 `fetchSignedGet` 一致 —— 其参数注释明确写着
> 「签名后追加的头（不参与 SDK-HMAC-SHA256 签名计算）」。
> 本模块早期版本误当作签名头，界面因此显示「积分：账户信息查询失败」。
> 回归测试见 `tests/unit/codearts-credits.spec.ts` 的
> 「Agent-Type / X-Language 不得出现在 SignedHeaders 中」。
>
> 注意 `src/llm-adapter.ts` 的 `maas_type: benefit` 是**反例** —— 那个头确实
> 需要参与签名（见其注释），不要据此推断其他头也该签名。

非 2xx 响应会把服务端的 `error_code` / `error_msg` 带进提示文案
（`describeHttpFailure`）。这一点很关键：只报 `HTTP 401` 会让「签名头位置错」
「AK 调用超限（`AK access failed to reach the limit`）」「凭据过期」这些
**处置方式完全不同**的问题看起来一模一样。

#### 账户类型检测

```
GET /snap-manager/v1/statistics/plugin
  → package.is_credit_package === true   ⇒ 积分账户（可领取）
  → package.is_token_package   === true  ⇒ 旧的 Token 计费账户（活动范围外）
```

领取流程**第一步**就判它：非积分账户返回 `inactive`（正常业务状态），
而不是 `failed`——后者会让用户去排查并不存在的故障。

#### 领取流程与幂等

1. 查账户类型 —— 查询失败 → `failed`；非积分账户 → `inactive`；
2. 查活动列表，取 `type === 'USER_LOGIN'` 的那项（**不是** `INVITE_USER` /
   `NEW_USER_REGISTER` / `STUDENT_CERTIFIED`，那些不是每日签到）；
3. 不可领取且 `status` ∈ {`CLAIMED`,`CONFIRMED`,`CONSUMED`} → `already-claimed`；
   其余不可领取 → `inactive`；
4. `POST /v1/ops/claim`；响应 `id !== null` 时补 `POST /v1/ops/confirm`
   （漏掉会让积分停在「待确认」而不入账）；
5. 成功 → `claimed`。

第 3 步是**唯一的幂等保护**：本协议没有幂等键，也没有服务端「今天已签到」
业务码可依赖，故预检不能省。

#### ⚠️ 活动列表的字段类型/名字与直觉不符

实测（2026-09-18）`GET /v1/ops/delivery` 的一个 item：

```json
{ "campaignId": 1, "type": "USER_LOGIN", "title": "每日签到领1000 积分",
  "benefitAmount": 1000, "benefitUnit": "CREDIT", "claimable": true,
  "status": "ELIGIBLE", "pendingCount": 1, "pendingTotalAmount": 1000 }
```

三个与直觉不符之处，任一处理错都会导致**领取失败或金额为 0**：

| 字段 | 真实形态 | 踩坑后果 |
|---|---|---|
| `campaignId` | **数字** `1`，不是字符串 | 用只收字符串的解析会得空串 → 判 `failed`「缺少 campaignId」 |
| 可领积分 | 字段名是 **`benefitAmount`** | 读 `amount`（不存在）→ 恒为 0 |
| `status` | 不可领取时是 **`null`** | 解析必须容忍 null |

> **真实缺陷**：上述前两条叠加，导致点「一键领取积分」后显示
> 「1 个活动未开启，1 个失败」——**积分实际没有领到**。
> 第一个账号（Token 计费）判 `inactive` 是正确的；第二个（积分账户）
> 因 `campaignId` 解析为空而失败。
>
> 早期单测没抓到，是因为用例喂的是**编造的** `campaignId: 'c-1'` 与
> `amount: 1000`。现在的用例直接使用上面这份实测字段集合。

#### 领取结果会逐账号显示原因

面板的领取摘要除计数外，还会列出每个账号的**具体原因**
（如「xxx：失败 — 活动缺少 campaignId，无法领取」）。这不是装饰：
上述缺陷最初只能靠翻代码 + 抓包定位，就是因为 UI 只显示「1 个失败」。
后端一直返回 `results[].outcome.message`，前端不该丢掉它。

#### ⚠️ refresh_token 是一次性轮换的

华为的 `refresh_token` **用一次即作废**（服务端回
`STS5.1806 the refresh token has been used`）。因此：

- 任何刷新都必须**立刻回写**新凭据，否则该账号只能重新登录；
- `tests/e2e/codearts-credential.ts` 只读凭据、**绝不刷新**——探针消耗掉
  refresh_token 会让用户的账号失效。这个坑在开发本功能时已真实踩过一次。

## LobsterAI provider（有道龙虾）

独立路由 `lobsterai`（有道 **LobsterAI**），OpenAI 兼容端点
`https://lobsterai-server.youdao.com/api/proxy/v1/chat/completions`，
Bearer `access_token` 鉴权。

该 provider 与腾讯系**协议完全不同**，因此实现是独立一套
（`src/lobsterai*.ts`），只共用架构模式（产品配置驱动、账号池、限流切换、
模型黑名单）。关键差异：

| 项 | 腾讯系（CodeBuddy / WorkBuddy） | LobsterAI |
|---|---|---|
| 登录方式 | 轮询后端 API（无本地服务器） | **本地回调服务器**收 `authCode` 后换 token |
| 登录/API 域名 | 同一个 `endpoint` | **两个域名**（portal 与 apiBase） |
| 请求头 | `X-Domain` / `X-Product` / `X-Product-Code` / `X-IDE-*` | 仅 `X-LobsterAI-Client-Capabilities` / `X-LobsterAI-Client-Version` |
| 续期请求体 | 只带 `refreshToken`（走 `X-Refresh-Token` 头） | 还要带 `firstKeyfrom` / `latestKeyfrom` / `uuid` |
| `clientVersion` | 编译期常量 | **运行时从第三方接口动态拉取** |
| 每日签到 | 两步（状态 + 领取） | **三步**（slot + context + check_in） |
| 图片输入 | 支持 | **不支持**（`inputModalities` 仅 `text`） |
| 思考等级 | 支持（按模型声明档位） | **不声明**（是否支持未实测） |

> 上表是 **LobsterAI 与腾讯系**的对照。第三个协议族 **CodeArts（华为云）** 的
> 差异见 [CodeArts 积分](#codearts-积分华为云每日签到得积分)：它用
> `SDK-HMAC-SHA256` **签名**（无 Bearer）、领取为**四步**
> （账户类型 + 活动列表 + claim + confirm），且 `refresh_token` **一次性轮换**。

- **登录入口：Jet Hub 设置页的 LobsterAI 面板**（支持多账号与账号池自动切换）。
  不注册斜杠命令。
- 编程式调用：`ctx.lobsteraiAuth.login()` / `status()` / `refresh()` / `logout()` /
  `fetchModels()` / `resolveClientVersion()`。
- 凭据 ref：
  - 单账号：`LOBSTERAI_ACCESS_TOKEN`；
  - 多账号：`LOBSTERAI_ACCOUNT_<UUID_SHORT>`，由 Jet Hub「+ 新建账号」生成。
- 凭据结构（JSON 字符串）：除 `access_token` / `refresh_token` / `expires_at` 外，
  还持久化 `uuid` / `first_keyfrom` / `latest_keyfrom` 三个**身份字段** ——
  它们是续期请求体的必填项，丢失会导致静默续期失败、只能重新登录。
- ⚠️ **账号展示名是手机号（只露末 2 位）**：服务端把**手机号本身**当
  `user.nickname` 下发，且只脱敏到「露末 4 位」（实测 `130****1100`）。
  按用户要求由 `maskLobsteraiPhoneTail` 归一化为只露末 2 位
  （`130******00`）—— 归一化对「完整号码」与「露 4 位」两种输入**幂等**，
  故老账号在启动时由 `repairAccountNicknames` 自动补正，无需重新登录。
  非手机号形态的昵称**原样保留**（不误伤真实昵称）。
- 模型列表：远端 `GET /api/models/available` 优先（它是权威来源），
  失败时回退 `src/lobsterai-product.ts` 的 19 个内置模型。
- 续期：启动后每 30 分钟对可续期账号静默刷新（与其他 provider 同一调度器）。
  **终态判定比参考实现更精确**：只有 HTTP 401/403 或业务码 40100/40101
  才判为 `refresh_token` 失效；网络抖动走可重试路径，不会误让用户重新登录。

> **已知待实测项**（见 `docs/lobsterai-integration-plan.md` §7.2）：
> 是否支持 `reasoning_effort`、各模型真实上下文窗口（内置表统一填 131072，
> 是桥接层的估计值）、图片输入、`prompt_cache_key`。这些在实现里都取了
> **保守默认**（不声明 / 不发送），不会因未知而失败。

## Qoder provider

独立路由 `qoder`（阿里系 AI 编程 IDE **Qoder**）。**推理走加密端点**
（请求体与签名头由客户端自带的 WASM 生成），因此能拿到与客户端
**完全一致**的模型池（含 Qwen3.8 系列）。详见下方「两条推理路径」。

该 provider 与其余四者**协议都不同源**，实现是独立一套
（`src/qoder*.ts` + `src/qoder-wasm.ts` + `src/qoder-envelope.ts`
+ 复用的 `src/openai-compat.ts`）：

| 项 | 其余四个 provider | Qoder |
|---|---|---|
| 登录方式 | OAuth 回调 / external-link 轮询 / 本地回调 | **PKCE 设备码轮询**（不开监听端口） |
| 续期请求体 | 只带 `refresh_token`（+ 各自身份字段） | 还要带 **`machine_id`** |
| 推理鉴权 | 华为 HMAC / 纯 Bearer | **请求体加密 + 签名头**（不能自行构造） |
| 模型列表 | 远端接口（权威） | **本地静态表**（远端需签名）+ 加密端点使用目录 key |
| 积分能力 | 余额 ✓（`sash/api/v2/me/usage`）/ 签到 ✗ |

### 登录（设备码轮询）

浏览器打开 `https://qoder.com/device/selectAccounts?...`（PKCE `S256` +
`client_id`），用户在网页完成授权后，插件轮询
`https://openapi.qoder.sh/api/v1/deviceToken/poll` 取回
`{ token, refresh_token }`。

- **`404` 表示「用户尚未完成授权」，不是错误**，必须继续轮询
  （官方客户端同样如此）。实测依据：该端点返回 404 而任意不存在的路径
  返回 401，说明它被网关豁免认证、由业务层报「会话未就绪」。
- **必须走两步式**：`account.create` 在用户授权**之前**返回 `loginUrl`，
  由前端立即 `window.open`（浏览器 transient activation 约束，
  见 [+ 新建账号](#-新建账号必须走两步式登录四个-provider-一致)）。

### 两条推理路径（**认两套不同的模型名**）

这是本项目**最容易踩的坑**。Qoder 有两个推理端点：

| 路径 | 端点 | 模型名 | 能力 |
|---|---|---|---|
| **加密（本插件使用）** | `api2.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation` | **目录 key**（`qfmodel` / `dmodel`） | 客户端真实链路；**能拿到 Qwen3.8 系列** |
| 公开 | `api2-v2.qoder.sh/model/v1/chat/completions` | 通用名（`qwen-flash` / `qwen-plus`） | 标准 OpenAI 格式；**目录 key 一律被拒** |

⚠️ **两个 host 不同**（`api2` vs `api2-v2`），混用会 404。

**真实缺陷**（用户报障）：「向 qwen3.8-flash 发消息后**没收到回复就终止**」。
根因是早期把**目录 key 发给了公开端点**（得到 `Unsupported model`，
且该错误帧又被解析器静默吞掉）。

随后又误判为「目录 key 不可用」，把模型表换成了通用名 —— 于是拿到的是
**Qwen3.5 / Qwen-2.5**，而不是目录里的 Qwen3.8 系列（用户再次报障）。

### 加密推理（`src/qoder-wasm.ts`）

Qoder 的**真实**推理链路要求请求体加密、并带一套服务端认可的身份签名头，
否则请求被拒。客户端把实现该协议的 WASM 内嵌在自身产物里，本插件按
wasm-bindgen 约定把它接起来**复用**（`src/qoder-wasm.ts`）。

- **不是「破解密码学」** —— WASM 自己就导出了成对的编解码函数，我们只是
  调用它，等同「用客户端自己的钥匙开自己的锁」。
- **响应不需要解密** —— 只在每帧外套一层信封，内层是标准 OpenAI chunk；
  `src/qoder-envelope.ts` 负责剥信封，剥完交给 `src/openai-compat.ts`。
- ⚠️ **签名头必须原样透传**，不能用 `Bearer <token>` 覆盖（会被判签名无效）。

> 实现细节（glue 约定、请求体字段、签名载荷、三个已踩过的坑）记录在
> **不入库**的内部文档 `docs/qoder-encryption-notes.md` 中 ——
> 该文档含逆向分析，刻意不随仓库分发。

### 工具调用（tools）

加密端点认 **OpenAI 风格**的工具描述，落在请求体**顶层** `tools`：

```jsonc
"tools": [{ "type": "function",
            "function": { "name": "read", "description": "…", "parameters": { … } } }]
```

assistant 的工具调用挂 `tool_calls`，工具结果用 `role:"tool"` + `tool_call_id`。

⚠️ **真实缺陷**（用户报障）：「使用本插件的 qoder 的 qwen3.8-flash，
执行任务出现任务调用 xml 泄露任务终止」。两处根因：

1. 适配器**从不消费 `options.tools`**（其余四个 provider 都消费），且
   `qoder-wasm.ts` 把请求体的 `tools` **硬编码为 `[]`** → 模型在 wire 上
   拿不到任何函数 schema，只能用**正文里的 XML 文本**臆造工具调用，
   harness 认不出 → 任务终止；
2. history 过滤器写成「只留 `content` 为字符串的消息」，而 assistant 带工具
   调用时 `content` 是 **`null`**（OpenAI 规范）→ 整条被丢，`role:"tool"` 的
   `tool_call_id` 也被丢 → 模型看不到自己调用过什么，反复重调同一工具或
   凭空编造结果（与 TRAE 那条同型缺陷一致）。

⚠️ **别照抄 Anthropic 风格**：客户端另有 `tool_use` / `input_schema` /
`tool_use_id` 一套，那是给 **Anthropic BYOK** 用的分支，本端点不吃。

⚠️ **加密端点的请求体本地不可解**，无法靠抓包验证 —— 故 payload 构造抽成
纯函数 `buildQoderInferPayload()`，由 `buildQoderTools()` /
`buildQoderHistory()` 与端到端替身共同锁死（`tests/unit/qoder-tools.spec.ts`）。

### 「没有任何报错就中断」已修

症状：UI 上**看不到任何错误**，任务却停在了半路（`turn/end` 是 `completed`）。

**根因**：`consumeOpenAiSse` 把「**没收到 `finish_reason`** 且**没有工具调用**」
直接判成 `{kind:'stop'}` —— 而 `stop` 是「模型正常答完」的信号。于是**被掐断的
连接伪装成正常结束**，harness 认为本轮已完成，任务就此中断。

真实案例（2026-09-23，`qoder`/`qfmodel`）：某步的 chunk 流只有
`block-start(text) → text → usage → block-end → finish{stop}`，**没有任何
tool-call 分片**，而正文以冒号「：」结尾（模型正要调工具），`outputTokens=118`
远未触上限；相邻的**正常步**则多出 `block-start(tool-call) → tool-call-chunks`。

**修复**：判据改为「**连接结束的方式**」—— 既没有显式 `finish_reason`、
也没有 `[DONE]`，就报 `max-tokens`（不完整、可重试），不再报 `stop`。

同时修掉两个同族缺陷（都表现为「无报错中断」）：

- **网关形态错误帧被整帧丢弃**：`{"stackTrace":[…],"message":"…","statusCodeValue":400}`
  既没有 `code` 也没有 `error`、也没有 `choices`，早期解析器所有条件都不命中；
- **响应根本不是 SSE**（网关直接回了一段 JSON，没有任何 `data:` 帧）：
  早期静默空结束，现抛错并**带上原文片段**。

> 排查这类问题用 `node scripts/inspect-session.mjs`（只读）——它能把会话日志
> （zstd 压缩的 JSONL）里的**原始 chunk 流**还原出来。用法见 `AGENTS.md`。
> 回归用例 `tests/unit/qoder-silent-stop.spec.ts`。

### 模型列表：17 个目录 key（**实测数据**）

`listModels` 是**静态表**（不发网络请求）—— 远端目录需签名，运行时不做。

表里是客户端目录下发的 **17 个 key**，全部实测可用：

| 分组 | 模型 |
|---|---|
| Qoder 档位 | `auto` / `ultimate` / `performance` / `efficient` |
| 内部代号 | `smodel`(Sonus) / `cmodel`(Cantus) |
| **Qwen** | `qmodel_38max`(3.8-Max) / **`qfmodel`(3.8-Flash)** / `qmodel_latest`(3.7-Max) / `qmodel`(3.7-Plus) |
| Kimi | `kmodel_latest`(K3) / `kmodel`(K2.8-Preview) |
| GLM | `gmodel`(5.3) / `gfmodel`(5.3-Flash) |
| DeepSeek | `dmodel`(V4-Pro) / `dfmodel`(Flash) |
| MiniMax | `mmodel`(M3) |

⚠️ **请求体必须带 `business` 字段** —— 缺了服务端会把请求路由到故障节点，
而**其余模型恰好不受影响**，所以现象像「只有 `qfmodel` 一个模型坏掉」，
极易误判成「服务端故障」。**判据是「Qoder IDE 能否用同一模型」**：
IDE 能用即说明是我们的请求缺东西。

**免费额度模型**（`is_free=true`）：`qmodel_38max` 与 `qfmodel`。
e2e 探针默认用 `qmodel_38max` 以免消耗积分。

- 该表**会逐渐过时**（新模型上线后不会自动出现）；
- 按 DSH 约定「`listModels` 结果仅供参考」，**表外的 key 仍可手动指定**；
- 需要刷新时按下方「升级 WASM」流程重新采集，并**逐个验证可推理**再入库。

### 升级 WASM（Qoder 版本更新时）

Qoder 升级后签名协议可能变化，表现为**难以解释的 `Signature invalid`**
或 `[FAIL]node:...`。此时刷新：

```bash
pnpm qoder:wasm            # 自动取本机 Qoder 最新版本的内嵌 WASM
pnpm qoder:wasm 0.3.5      # 或指定版本
pnpm build:assets          # 同步到 lib/
```

脚本取 `.qoder-versions/<v>` 而非 `resources/` —— 后者可能是与 IDE
**实际运行**不同的版本。刷新后**务必实测一次对话**（`qfmodel` 或
`qmodel_38max`）确认签名仍被接受。

### 积分余额（Credits Balance）

`qoder` 面板**支持积分余额**：

```
GET https://openapi.qoder.sh/sash/api/v2/me/usage
Authorization: Bearer <token>
Cosy-ClientType: 5
```

⚠️ 两个易错点：

1. **路径前缀是 `/sash/`**，不是 `/api/`。早期因为只按 `/api/` 前缀搜索
   而误判「Qoder 无积分端点」。
2. **余额不只在 `userQuota` 里**。实测某账号 `userQuota.remaining = 0`
   而 `addOnQuota.remaining = 100`（资源包）；只读 `userQuota` 会显示 0。

该端点**只需 Bearer**，不需要模型列表那样的 WASM 签名。企业版账号
（`displayMode: "enterprise"`）不下发额度数字、只给外部链接，此时返回
「查询失败」而非 0。

### 每日领取（每日 100 Credits）

```
GET  https://openapi.qoder.sh/sash/api/v1/me/campaigns
POST https://openapi.qoder.sh/sash/api/v1/me/campaigns/{campaignId}/claim   ← body 空
```

活动**每日 10:00（UTC+8）刷新**，领取后 30 天有效。

⚠️ **幂等判据是响应体的 `replayed`，不是 HTTP 状态码**：重复领取同样返回
**200**，但 `replayed:true`、**不含 `benefit`**，且 `claimedAt` 是上一次领取的
旧时间。只看状态码会把「今天已领」误报成「领取成功 +100」。

⚠️ 只领 `actionType === 'CLAIM_BENEFIT' && claimStatus === 'CLAIMABLE'` ——
实测还有 `VIEW_DETAILS` 型活动（如「Pro 首月翻倍」），对它发 claim 是错的。

> **这段协议是抓包解出来的**：早期依据 `/sash/api/v1/me/campaigns` 返回
> `claimable:false` 判定「Qoder 无签到」，真相是**那天已领**。

### 凭据与续期

- **登录入口：Jet Hub 设置页的 Qoder 面板**（支持多账号与账号池自动切换）。
  不注册斜杠命令。
- 凭据 ref：单账号 `QODER_ACCESS_TOKEN`；多账号
  `QODER_ACCOUNT_<UUID_SHORT>`（由 Jet Hub「+ 新建账号」生成）。
- 凭据结构：`security_oauth_token` 与 `access_token` **双写同值**
  （服务端取用顺序是前者优先），外加 `refresh_token` / `expire_time` /
  `refresh_token_expire_time` / **`machine_id`**。
- ⚠️ **`machine_id` 必须持久化**：续期请求体需要它。本插件生成**随机 UUID**
  并随凭据保存（不复制官方客户端的硬件指纹逻辑 —— 那依赖 `@napi-rs` 原生
  模块取 SMBIOS UUID，属设备指纹且不可移植）。**这是本实现最大的未验证
  假设**：若服务端校验设备一致性，续期会被拒。`pnpm test:e2e:qoder-chat`
  的续期用例专门验证这一点。
- 续期：与其他 provider 同一调度器（启动后每 30 分钟对**可续期**账号静默
  刷新）。终态判定：HTTP 401/403 或响应缺 token → `RefreshTokenExpiredError`
  （停止重试）；网络抖动与 5xx 走可重试路径。

### 适用范围

本章节描述的是**国际版**（`qoder.com` / `qoder.sh`）。
中国版（`qoder.cn` / `qoder.com.cn`）的端点与 `client_id` 都不同，
已作为独立 provider 实现，见下一节
[Qoder CN provider](#qoder-cn-providerqoder-中国版)。

## Qoder CN provider（Qoder 中国版）

第九个 provider，id `qodercn`，面板显示为 **Qoder (中国版)**。
与国际版 `qoder` **共用同一套协议实现**（PKCE 设备码轮询 + 加密推理 + `/sash/` 积分，
含**同一份 WASM**），差异全部收敛在 `src/qoder-product.ts` 的 `QODER_CN`。
新增同族产品时**不要**复制 `src/qoder*.ts` —— 那会让 tools 不下发、工具历史丢
`tool_calls`、错误帧不抛错这类缺陷修两遍。

### 前提

装过 Qoder 中国版桌面端（`%LOCALAPPDATA%\Programs\Qoder CN`）**不是必需的** ——
登录与推理都由插件自给自足。
但**积分每日领取**依赖本机 `runtime-info.exe` 生成设备身份
（`~/.qoder/.bin/umid-*/` 或 `~/.qoder-cn/.bin/umid-*/`，**任一存在即可**，
两站同 `environment` 返回同一身份）。两者都没有时不带 machine 头，
服务端就不会下发可领取的活动 —— 症状是「报今日已领，但官方能领」。

### 与国际版的差异

| 项 | 国际版 | 中国版 |
|---|---|---|
| 授权 / 网站 | `qoder.com` | `qoder.cn` |
| OpenAPI | `openapi.qoder.sh` | `openapi.qoder.com.cn` |
| 加密推理 | `api2.qoder.sh` | `gateway.qoder.com.cn` |
| 公开推理 | `api2-v2.qoder.sh` | **无**（实测 503） |
| `client_id` | `e883ade2-…` | `732aef47-9cf2-46a2-95fe-4cebb5d0d1fa`（**不同**） |
| 模型数 | 17 | 14 |
| 凭据 ref | `QODER_ACCESS_TOKEN` / `QODER_ACCOUNT_*` | `QODERCN_ACCESS_TOKEN` / `QODERCN_ACCOUNT_*` |
| 服务名 / 路由 | `qoderAuth` / `llm-qoder` | `qoderCnAuth` / `llm-qodercn` |
| WASM | `src/qoder-auth-wasm.wasm` | **同一份**（实测可解 CN 目录、可签 CN 请求） |

### 中国版独有的模型

`q37fmodel`（Qwen3.7-Flash · x0.1）、`gm51model`（GLM-5.2 · x0.6）。

### 中国版没有的模型

`ultimate` / `performance` / `efficient` / `smodel`(Sonus) / `cmodel`(Cantus) ——
CN 目录不下发，故中国版面板里看不到也选不了。

另外几条同名模型在 CN 的参数**不同**，不是简单取子集：
`dmodel` 上下文 96K（国际版 1M）、`qmodel_latest` / `qmodel` / `dfmodel` / `kmodel`
都是 180K、`mmodel` 是 **MiniMax-M2.7**（国际版 M3）且不支持图片。

### 积分

与国际版同：`GET /sash/api/v2/me/usage` 查余额，
`GET /sash/api/v1/me/campaigns` → `POST …/{campaignId}/claim` 每日领取。
活动每日 10:00（UTC+8）刷新，幂等判据是响应体的 `replayed`。
实测（2026-09-27）CN 账号余额由**套餐额度 + 资源包**两部分累加，
领取一次得 100 分且余额确实增加 —— 与国际版的多包累加口径一致。

### 验证命令

```bash
pnpm test:e2e:qodercn          # 只读：授权 URL 构造 + 四个端点存在性（零额度）
pnpm test:e2e:qodercn-chat     # 真实加密对话（默认免费模型 qfmodel）
pnpm test:e2e:qodercn-credits  # 余额 + 活动 + 真实领取一次
node scripts/verify-qodercn-live.mjs   # 一次性：登录→推理→积分，token 不落盘
```

设计依据与全部取证：`docs/superpowers/specs/2026-09-27-qodercn-provider-design.md`
（该目录按仓库约定不入库）。

## TRAE provider（字节跳动 TRAE）

独立路由 `trae`（字节跳动 **TRAE**），走 SOLO 免费对话通道，
端点 `https://trae-api-cn.mchost.guru/api/agent/v3/llm_utils_chat`，
以 `Cloud-IDE-JWT <token>` 头鉴权。

该 provider 是**第三个独立协议族**（实现见 `src/trae*.ts`），与腾讯系、
LobsterAI 都不同源。它也是唯一一个**请求与响应都要转换**的 provider：

| 项 | 其它 provider | TRAE |
|---|---|---|
| 消息序列化 | 有（`tool-call` → `tool_calls`） | **必须有**（DSH 原生块 → OpenAI wire）；漏掉会让**模型看不到工具调用与结果**（真实缺陷，已修复） |
| 请求体 | 基本透传 OpenAI 格式 | **必须转换**为 SOLO 格式（`function: "solo_work_lite"`、`config_name`、`tools.parameters` 序列化为字符串、`tool_calls.function` → `function_call`） |
| 响应流 | OpenAI 标准 SSE | **SOLO 自定义事件**（`output` / `token_usage` / `done` / `error`），需转成 OpenAI chunk |
| 鉴权头 | `Bearer` / 签名 | `Cloud-IDE-JWT` + 十余个 `X-*` 身份头 |
| 换 token | 轮询 / authCode | **ExchangeToken**（`refresh_token` 会**轮换**） |
| 设备指纹 | 无 | **必须持久化** `machine_id` 与 `device_id`（均为 32 位 hex） |
| **登录回调** | 各不相同 | **老流程直接回传 token**（`refreshToken` / `userInfo` / `userJwt`）；**并存 PKCE 新流程**（带 `code` / `authCodeInfo`），两套都要认；参数名是 **`auth_callback_url`** |
| 回调端口 | 各不同 | 默认 `127.0.0.1:18080`，**被占用时自动回退随机端口** |
| 图片输入 | Buddy / LobsterAI 支持 | **支持**，但**逐模型**判定（远端 `display_config.multimodal`；本插件可见集里约 15/19 为 `true`） |
| 历史长度 | 无硬约束 | 超约 **500K 字符上游会静默断流** → 自动裁剪（保最新、不切断工具配对） |
| 单次输出上限 | 采信远端声明 | 收敛到 **64000**（上游安全线，可配） |
| 模型列表 | `GET` | `POST /api/ide/v1/get_detail_param`（响应 `config_info_list[]`） |

> **图片输入（逐模型）**：判据是远端 `display_config.multimodal`。
> `true` → 声明 `['text','image']` 并把图片转成 `{type:'image_url',image_url:{url}}`
> 的 data URL 发出；`false` / 未声明 → 收到图片时明确报错且**不发请求**。
>
> 实测（2026-09-21）：直发纯红图答「红色」、纯蓝图答「蓝色」、不带图答「无法确定」
> —— 三次答案不同，证明模型真读到了像素。而 `multimodal: false` 的模型
> （如 `DeepSeek-V4-Pro-Official`）收到图后答「无法确定」、思考链明说「但没有图片」，
> 与不带图的回答一致 → 该标志是**权威准入判据**。
>
> ⚠️ **用户贴图**与**工具结果内嵌图**是两个独立字段
> （`multimodal` / `tool_response_multimodal`）：实测 `deepseek-v4.1-flash`
> 前者 `true`、后者 `false`，不可合并判断。

- **登录入口：Jet Hub 设置页的 TRAE 面板**（支持多账号与账号池自动切换）。
  不注册斜杠命令。
- 编程式调用：`ctx.traeAuth.login()` / `startLogin()` / `status()` / `refresh()` /
  `logout()` / `fetchModels()`。
- 凭据 ref：
  - 单账号：`TRAE_ACCESS_TOKEN`；
  - 多账号：`TRAE_ACCOUNT_<UUID_SHORT>`，由 Jet Hub「+ 新建账号」生成。
- 凭据结构（JSON 字符串）：除 `access_token` / `refresh_token` / `expires_at` /
  `uid` 外，还持久化 **`machine_id`** 与 **`device_id`**（两者均为 32 位 hex）：
  - `machine_id` 是设备指纹，续期时**绝不可重新生成**（服务端按它标识设备）；
  - `device_id` 是签到设备号，**账号间必须互异** —— 同一天两账号共用会被
    「该设备已签到」拦截，为空则签到报 9004。
  另有可选的 **`phone` / `email`**（`GetUserInfo` 的脱敏形态，仅用于账号展示名，
  见下「账号展示名」）。
- 登录 URL 含 **18 个参数**（对齐唯一权威实现 `login.sh`），包括
  `auth_from=solo`、`login_channel=native_ide`、`plugin_version`、
  `login_trace_id` 与 `x_*` 客户端形态系列。少发参数会让登录页停在授权中。
- **两套回调流程都要认**：
  - **老流程**（当前 `auth_type=local` 实际走的）：直接回传 token，形如
    `?refreshToken=...&userInfo={...}&userJwt={...}`，不做授权码交换；
  - **新流程**（PKCE）：回带 `code` / `authCodeInfo`。本实现会**识别**它并给出
    「上游走了 PKCE 流程，暂不支持」的**精确报错**，而不是笼统地说
    「缺少 refreshToken」（把合法回调误判为无效会把排查方向带偏）。
  另外 `userInfo` 的中文昵称存在双重编码乱码，插件会自动回转修复。
- ⚠️ **账号展示名用脱敏手机号，不用 `ScreenName`**：`ScreenName` 是字节 passport
  **按 uid 自动生成的默认名**（实测四个账号全是 `用户26815487395` 这种形态），
  多账号在面板里**彼此无法区分**。`GetUserInfo` 会下发 `NonPlainTextMobile`
  （形如 `130******00`，中间打码），实测末两位互异、足以区分。
  取值顺序：**手机号 → 脱敏邮箱 → `ScreenName` → 账号 id**。
  老账号在插件启动时由 `TraeAuth.repairAccountNicknames` 自动回填一次
  （幂等；**拿不到真实标识时不动昵称**，以免覆盖用户手动改过的名字）。
- ⚠️ **任何回调路径都必须落定登录结果 Promise**：早期实现里解析失败分支只
  `res.end()` 就 return，导致 `login.poll` 永远拿不到 `done:true`，
  前端**永久停在「认证中」**。这与「参数名写错」是两个独立根因、同一个症状。
- 模型列表：走**批量**端点 `POST /api/ide/v1/batch_get_detail_param`（真实 CN IDE
  的用法），**一次拉取多个「通道」（`function`）各自一套模型目录**；失败时回退
  `src/trae-product.ts` 的 32 个内置模型。
- ⚠️ **模型只在列出它的通道里可调用**。实测：`glm-5.1` 在 `solo_agent_remote`
  正常、在 `solo_work_lite` 回流内 `4001`；`glm-5-turbo` / `sagitta` 恰好相反。
  因此插件会**按每个模型所属通道分别下发 `function`** —— 旧实现把 `function`
  写死 `solo_work_lite`，agent 专有模型一用就报
  `trae: We're sorry, the param is invalid. (code=4001)`。
- ⚠️ **两种「不可用」要分开看**：
  - `display_config.is_custom_model === true`（需在 IDE 内自行绑定供应商）
    → **必然 4001，插件剔除**。实测 2026-09-19 该账号有 5 个，但**该名单已过期**
    （复测 2026-09-20：3 个下架、2 个转为 `false` 可调用，全目录 custom 条目数为 0）
    —— 判据是**标志的值**而非模型名，别把某一刻的快照写成规则。
  - `is_invisible_to_user === true`（**官方 picker 不展示**）→ **硬性剔除**，
    使目录与官方 Auto Mode 选择器一致（代价是看不到 `glm-5.1` 等可调用模型）。
  - 若仍选中了不可调用的模型（如会话里持久化的旧 id），报错文案会直接点明
    「模型不被上游接受」，而不是让人去查参数格式。
- **远端参数会被消费**：`context_window_tokens.dev` → 上下文窗口
  （实测主流 **200000**；`max` 的 1M 需官方 max_mode，本插件不实现）；
  `model_detail_list[].max_tokens` → 输出上限（实测主流 **32000**）。
- **`4001` 还有一个自伤成因**：请求头里 `Content-Type` 与 `content-type`
  各写一次会被 `Headers` 合并成 `"application/json, application/json"`，
  上游回 HTTP 400 + `code=4001`。写探针时请用 `new Headers(base).set(...)`。
- 续期：启动后每 30 分钟对可续期账号静默刷新（与其他 provider 同一调度器）。
  终态判定有三条依据（HTTP 401/403、`session-dead` 分类、2xx 但无 `accessToken`）；
  网络抖动与 5xx 走可重试路径。
- 失败模式：`4008`（`ide_credits` 耗尽）与 `1005`（plan 权益不足）是最主要的
  两个，会被分类为需要冷却的类别并触发多账号轮换。
- **签到所得积分如实上报**：`checkin_credits/claim` 的响应**只有**
  `{"code":0,"message":"success"}`，**不含积分数** —— 故领取成功后会补查一次
  `checkin_credits/status`（其 `credits` 字段即所得，实测 `150`，与积分余额里
  「签到奖励」包的 `credits_limit` 吻合）。早期从 claim 响应读 `credits`，
  于是恒为 0，界面显示「领取成功 **+0 积分**」。
- **已签到必须靠状态判定**：claim 对「今天已签到」是**幂等**的，重复领取同样返回
  `code:0`，与真正成功**无法区分** —— 故 `claimAll` 的 TRAE 分支**必须开启状态
  预检**（`checked_in`），不能用 `precheckStatus: false`，否则已签到的账号会被
  报成「领取成功」。
- **签到 `9074`（人数过多）不再换设备号重试**：设备身份已由 `uid` 确定性派生、
  每账号独立，「换个 id 就能成功」的前提不成立。命中即归为业务错误（300s 冷却）
  并如实上报。
- **空响应（HTTP 200 但零事件）重试一次**，且**仅在首个模型事件之前** ——
  已有输出后绝不放，避免重复计费与重复执行工具。
- 可调环境变量：
  - `DSH_TRAE_CHANNELS`（默认 `solo_work_lite,solo_agent_remote`）要拉取的通道，
    **顺序即优先级**（前面的通道优先决定同名模型走哪个通道）；
  - `DSH_TRAE_HIDE_INTERNAL=1` 连官方隐藏的条目一并从目录剔除（与真实 CN IDE
    的选择器一致，代价是看不到 `glm-5.1` 等可调用模型）；
  - `DSH_TRAE_MAX_COMPLETION_TOKENS`（默认 `64000`，设 `0` 关闭收敛）；
  - `DSH_TRAE_MAX_HISTORY_CHARS`（默认 `480000`）；
  - `DSH_TRAE_ROTATE_MACHINE_ID=1`（**默认关闭**）启用机器指纹轮换以应对集中风控。

> 尚未实现：真实 CN IDE 的 `llm_utils_chat` / `create_agent_task` **请求体是加密的**
> （配 `x-helios` / `x-medusa` / `x-neptune`）；实测仅换版本头解不开依赖它的模型
> （`deepseek-v4-flash` 等）。属独立工作量。

> 实现依据见 `docs/trae-integration-plan.md`（协议逆向自
> [`trae2api`](https://github.com/Sliverkiss/traework2api) 及其衍生项目）。

## Cline provider

Cline（[cline.bot](https://cline.bot)）桌面端的账号与模型路由。协议全部由本机
Cline 产物逆向 + 实测得出（2026-09-25），与其余六个 provider **都不同源**：

| 维度 | 本 provider 的取值 |
|------|-------------------|
| 登录 | **WorkOS 设备码轮询**（`api.workos.com`，不起本地监听端口） |
| 鉴权头 | `Authorization: Bearer workos:<jwt>` —— **前缀不可剥** |
| 推理 | **标准 OpenAI 兼容**（`POST {apiBase}/api/v1/chat/completions`） |
| 续期 | `POST {apiBase}/api/v1/auth/refresh`，body `{refreshToken, grantType}` |
| 积分 | 余额有；**签到无**（后端没有签到接口） |

### 登录（设备码轮询）

Jet Hub 的 Cline 面板点「+ 新建账号」→ 浏览器打开授权页并显示用户码 →
在浏览器完成授权 → 插件自动换取凭据。全程**不需要**本地回调端口。

⚠️ **`authorization_pending` 不是错误**：它是「用户还没在浏览器里点授权」，
插件会继续轮询（与 Qoder 的「404 表示尚未授权」同类语义）。`slow_down` 会
**累积退避**后再轮询。

### 免费模型

Cline 的免费模型由远端 `GET /api/v1/ai/cline/recommended-models` 的 **`free`
数组**动态下发，插件在模型列表里把它们的名字标成 `· 免费`，例如：

```
Space Bunny Alpha · 免费
MiMo-V2.6-Flash · 免费
DeepSeek V4.1 Flash · 免费
Gemini 3.8 Flash · 免费
Muse Spark 1.3 Contributor · 免费
```

⚠️ **免费与付费是两组不同的模型 id**，不是同一模型的两种档位：

| 免费（`free` 数组下发） | 按量计费（同名前缀不同） |
|---|---|
| `cline-free/deepseek-v4.1-flash` | `deepseek/deepseek-v4.1-flash` |

插件的判定基于**完整 id**（远端 `free` 集合 ∪ `:free` 后缀 ∪ `cline-free/`
前缀 ∪ 静态兜底），**不做名字模糊匹配** —— 否则会把付费条目误标为免费，
用户按免费预期使用却被计费。

⚠️ 免费资格是**服务端随时可撤销**的营销状态，故插件每次都从远端重新取，
不在代码里硬编码任何免费模型名。

### 思考强度

模型选择器旁提供 `None / Low / Medium / High / Extra` 五档，与 Cline IDE 一致，
默认 **High**。

- `None` = 不思考（实测不传 `reasoning_effort` 时模型本就不思考）
- `Extra` 对应上游的 `max` 档 —— 内嵌目录里的 `xhigh` 实测与 `high` 无可辨差异，
  故跳过它，把真正的最高档留给 `Extra`

⚠️ 档位数据来自 Cline 客户端内嵌的模型目录，**远端接口不下发**（`/api/v1/models`
只有 `{id, object, created, owned_by}`，`recommended-models` 只有
`{id, name, description, tags}`）。对不在该目录里的模型，五档是统一给的 ——
上游不认识的档位会被**静默忽略**（不会导致请求失败，最坏是「开关无效」）。

⚠️ 声明默认档位 High 意味着**默认会思考**：未手动选择时插件会带上
`reasoning_effort: 'high'`，思考 token 计入 `completion_tokens`。想要完全不思考，
在选择器里选 `None` 即可。

### Gemini 系模型的两个 400（已修）

`cline-free/gemini-3.8-flash` 曾「发消息即失败」。错误体里一次请求有**两个
provider 尝试、两个不同的错误**，是两个独立根因：

| provider | 错误 | 根因 |
|---|---|---|
| `vertex` | `maxOutputTokens 131072 超出 1..65537` | 兜底表数值填错，应为 **65536** |
| `google` | `tools[..].properties[permission].enum[3]: cannot be empty` | 工具 schema 的 `enum` 含空串 |

- **上限**：该模型不在客户端内嵌目录里，曾经照抄其它免费模型填了 `131072`；
  实测上限是 **65536**。适配器的 `clampClineMaxTokens` 也会把越界值收敛。
- **工具 schema**：harness 下发的工具集里某些 `enum` 带空字符串成员，Gemini 系
  严格校验直接 400。插件从不自己造 enum（原样透传 `tool.parameters`），
  但请求是我们发的，故由 `sanitizeClineToolParameters()` 递归清洗：
  只删空串、保留数值枚举、全空则丢弃 `enum` 键、递归下钻嵌套层。

⚠️ 故障**不是必现的** —— 上游会依次 fallback 多个 provider，命中哪个就暴露哪个
错误。别因为「重发一次就通了」而误判为偶发故障。

### 「API 密钥无效」不一定是真的凭据问题

部分模型（实测 `cline-free/muse-spark-1.3-contributor`）在该地区不可用，Cline 返回：

```
403 {"error":"access forbidden: … is not available in your region","success":false}
```

⚠️ 这条 403 与凭据无关，但 DSH 客户端对 `AUTH` 错误码一律显示「API 密钥无效」，
真实原因会被完全掩盖。

插件已按响应体文案识别地域限制（不能只看状态码 —— 同一批 403 里也有真凭据问题），
命中时**跳过无意义的续期**，并以 `PERMISSION_DENIED` 抛出真实原因，例如：

```
cline: access forbidden: cline-free/muse-spark-1.3-contributor is not available in your region
```

这类模型无法在本地区使用，可在 Jet Hub 的「显示列表」里关掉，换用其它免费模型。

### 积分余额

Jet Hub 的 Cline 账号卡片会显示账户余额（`GET /api/v1/users/{accountId}/balance`）。
**没有「一键领取积分」按钮** —— Cline 后端没有签到接口（对 sidecar 做全量字符串
扫描，`checkin` / `campaign` 等均无业务端点命中）。

### 适用范围

- 需要**已登录 Cline 账号**（Jet Hub 面板登录，或用免费账号）；
- 模型列表**全部列出**（含付费模型），免费的带 `· 免费` 标记；
  可在 Jet Hub 的「显示列表」里逐个关闭不需要的；
- 图片输入按模型判定（内嵌目录 `capabilities` 含 `images`）。

### 图标

面板图标是**从本机 Cline 安装目录提取的官方图标**（`icons\app\macos\classic.png`，
品牌紫底），不是手绘的 —— 早期版本曾按印象画了个「C 形弧线」，与真实标志不符。

需要重新提取（例如 Cline 换了图标，或想换主题）时：

```bash
node scripts/extract-cline-icon.mjs                    # classic（默认），48×48
node scripts/extract-cline-icon.mjs --theme=midnight   # 换主题
node scripts/extract-cline-icon.mjs --dry-run          # 只报告不改文件
pnpm build:client                                      # 改完必须重建
```

官方提供 `classic` / `chip` / `hologram` / `midnight` 四套主题，脚本默认取
`classic`：`midnight`（exe 内嵌的默认主题）是近黑底，与 Qoder 图标在 20×20 下
难以区分；`chip` 的电路板纹理缩小后退化成噪点；`hologram` 在白底容器里对比度不足。

### e2e 探针

```
pnpm test:e2e:cline        # 只读：凭据/前缀证据/余额/免费集合，零 token 消耗
pnpm test:e2e:cline-chat   # ⚠️ 发一次推理：默认只发 cline-free/deepseek-v4.1-flash
```

⚠️ 推理探针**默认只请求一个免费模型**。其余免费模型需显式设置
`DSH_CLINE_CHAT_E2E_ALL_FREE=1` 才遍历；**付费模型一律被拒绝**（避免免费资格
被撤销后按付费价刷 token）。详见 `tests/e2e/README.md`。

### 排查脚本（只读）

`scripts/probe-cline-endpoints.mjs`（按关键词提取 sidecar 二进制字符串窗口）、
`probe-cline-models.mjs`、`probe-cline-recommended.mjs`、
`probe-cline-balance.mjs`、`probe-cline-chat.mjs`。
## Loomy provider（讯飞办公助手）

`loomy` 是本插件第 8 个、也是**与其余七者都不同源**的 provider。生产环境：

| 用途 | base URL |
|---|---|
| 推理 / 模型列表 / 积分 / 新手任务 | `https://loomyad.xunfei.cn/api/v1` |
| 讯飞账号（CAccount） | `https://account.xfinfr.com` |

⚠️ 这两个域名是**生产**地址，不要改用测试环境。

### ⚠️ 五个与其余 provider 不同的地方

1. **登录是短信验证码**（唯一一个）。其余 7 个都是「返回 `loginUrl` →
   前端 `window.open` → 轮询 `login.poll`」；短信登录没有 URL 可打开，
   故 `account.create` 返回 `loginMode: 'sms'`（缺省视为 `'url'`，
   既有 provider 行为不变），前端渲染验证码表单，
   走 `login.sendSms` / `login.submitSms` 两个端点。

2. **不能续期**（唯一一个）。Loomy **没有任何 refresh 端点** ——
   `session` 是登录时向服务端声明 `expire: 1209600`（14 天）得来的。
   故 `isLoomyRefreshable()` 恒 `false`，`refresh()` /
   `refreshAccountCredential()` 只做**有效性探测**（失效即提示重新登录），
   `refreshAll()` 只探测**已过期**的账号。这是**诚实标记**，
   不是遗漏 —— 账号卡片会如实显示「凭证过期，请重新登录」。
   `scheduleRefresh()` / `stop()` 因此是**有意为之的空实现**。

3. **两套认证头**。`/chat/completions` **只认** `Authorization: Bearer <session>`，
   而 `/models`、`/points/*`、`/onboarding/*` **只认** `token: <session>`。
   带错的那个会得到 HTTP 200 + `{"code":"100002","desc":"缺少 token"}`。
   `loomyChatHeaders()` 两个都发（官方客户端也如此）。
   实测交叉矩阵（`pnpm test:e2e:loomy` 会现场验证）：

   ```
   GET /points/records  + token  → code=000000
   GET /points/records  + Bearer → code=100002 (缺少 token)
   ```

4. **新手任务是纯 API 直领**，不需要模拟真实用户行为。
   实测服务端**不校验任何前置行为**：直接对 8 个任务发
   `POST /api/v1/onboarding/tasks/complete`（body 只有 `{"key":...}`）即可拿满
   **10000 积分**，一个模型 token 都不花。
   ⚠️ 这与 WorkBuddy 相反（后者需要发对话、建定时任务、上报埋点事件链）。
   若将来服务端加了校验，降级路径是「用 `qwen3.8-flash`（x0.8，全表最便宜）
   模拟真实动作」。

5. **积分是两个池、分开计算**：
   - **永久积分**（`balance`）：注册奖励 5000 + 新手任务 10000
   - **每日赠送池**（`dailyBalance`）：每天 5000，**消耗后不回补**

   「一键签到」= `POST /api/v1/points/first-login`（官方在登录后立即调用它），
   语义是**触发每日额度重置**，**不是**「+5000 积分」。
   幂等判据是响应体的 `alreadyProcessed`，故已初始化时映射成
   `already-claimed` 而非虚报 `claimed`。
   余额查询走 `GET /api/v1/points/records`（**只读**，无副作用）——
   刻意不用 `first-login`，否则「打开面板」会悄悄触发签到。

### 模型与倍率

远端 `GET /api/v1/models` 返回 11 条，按 `type === 'chat'` 过滤得 **8 条**。
⚠️ 过滤判据必须是 `type`，**不能**看 `input_modalities` —— 实测 5 个 chat
模型的输入模态含 `image`（能看图），那不是生图模型。

⚠️ **倍率在 `name` 字符串里**，没有独立字段（实测搜 `credit`/`multiplier`/
`price`/`factor`/`rate` 全部 0 命中），且三种括号风格混用，故由
`loomyDisplayName()` 规范化为 `MiniMax M3 · x4.0` 形态。

| 模型 | 倍率 | 上下文 |
|---|---|---|
| `deepseek-v4-flash-0731` | x3.0 | 1048576 |
| `MiniMax-M3` | x4.0 | 1048576 |
| `Kimi-k2.6` | x6.5 | 262144 |
| `qwen-3.8-max` | x12.0 | 1000000 |
| `GLM-5.3-Flash` | x0.8 | 1048576 |
| `qwen3.8-flash` | x0.8 | 1000000 |
| `spark-x` | x0.1 | 1048576 |
| `mimo-v2.5` | x3.3 | 1048576 |

⚠️ **`spark-x` 的上下文有已知分歧**：远端声明 `1048576`，而 Loomy 客户端用
本地表 `MODEL_CONTEXT_OVERRIDES = { 'spark-x': 262144 }` 强制降到 262144。
本插件**先采信远端**；若实测长上下文被拒，改兜底表的该值为 262144。

### 能力矩阵

```js
loomy: { balance: true, dailyCheckin: true, onboardingTasks: true }
```

`onboardingTasks` 是**第三项能力位**，与 `dailyCheckin` **语义独立**：
前者**一次性**（每号只能领一次 10000 分），后者**每天**有收益。
故新手任务有独立按钮与独立端点（`onboarding.status` / `onboarding.claim`），
**不参与**页头「一键签到」遍历 —— 否则每天会对已领完的账号
发 8 个必然 `alreadyCompleted` 的请求。

### 多账号负载均衡（按余额优先选号）

⚠️ Loomy **不会因积分耗尽而报错** —— 实测今日赠送额度（每天 5000）用完后，
服务端**继续扣永久积分且照常返回**（静默降级）。因此本插件既有的
「限流 → 自动换号」机制对它**无效**：会一直消耗同一个号。

故 Loomy 有一层**独立的选号策略**（在「未停用 + 该模型未受限」的候选内）：

| 优先级 | 判据 | 理由 |
|---|---|---|
| 1 | `dailyBalance > 0` | 今日额度**每天刷新、不用会浪费**，优先消耗它 |
| 2 | `permanentBalance > 0` | 只剩永久积分（不会过期，可继续用） |
| 3 | 其余（含**查询失败**） | 无可用余额 |

- **同档内保持你在 Jet Hub 拖拽的手动顺序**（不按余额大小重排）
- 余额查询**带 60 秒缓存**，避免每轮对话重复查所有账号
- 查询失败的账号归入**最后一档**（宁可先用能确认余额的号）

### 锁定永久积分

面板上的「锁定永久积分」按钮可**保住永久积分**（设置持久化，重启后仍生效）：

| 状态 | 行为 |
|---|---|
| 解锁（默认） | 今日额度用尽后**继续用永久积分** |
| **锁定** | **只消耗今日额度**；今日额度用尽的账号视为不可用 |

锁定后若所有账号的今日额度都用尽，请求会报**明确错误**提示你解锁或等明日
刷新 —— 而不是偷偷用掉永久积分。

⚠️ 同一功能在 **CodeBuddy / WorkBuddy** 上也有（见
[锁定永久积分（CodeBuddy / WorkBuddy）](#锁定永久积分codebuddy--workbuddy)），
但「临时积分」的判据**完全不同**：Loomy 直接读服务端给的 `dailyBalance`
（**当日**到期、次日重发），两个 buddy 没有现成字段，要按资源包的 `DeductionEndTime`
距今是否满 15 天现算。因此面板文案**按 provider 取**（`permanentLockCopy`），
不能把「只消耗每日赠送额度」这句话套到 buddy 上——它们根本没有每天刷新的额度池。

### ⚠️ 为什么 Loomy 没有「重测 / 重置」按钮

那组按钮用于清除**模型限流标记**，而 Loomy **不返回限流错误**（积分耗尽时
静默降级为扣永久积分），重测永远测不出限流、还会白烧积分，故对它隐藏。

### 思考档位

模型选择器里可选**思考强度**，共 5 档：

| 档位 | 显示名 |
|---|---|
| `none` | 关闭思考 |
| `low` | 低 |
| `medium` | 中 |
| **`high`** | **高（本插件默认）** |
| `xhigh` | 极高 |

**档位列表直接取自远端** `GET /models` 的 `reasoning_efforts`
（8 个 chat 模型实测完全一致），故服务端调整档位**无需改代码**。
远端整体不可用时回退兜底表的实测值。

⚠️ **默认档是本插件自己的「高」，不是远端声明的 `low`**（用户要求）：
远端 `default_reasoning_effort` 声明的是 `low`，而 DSH 的「用户没选时发哪个档」
完全取适配器声明的 `defaultEffort`，沿用 `low` 会让默认思考偏浅。
若某模型不提供 `high`（远端目录变化时可能发生），则不下发默认档、
退回「服务商默认」，而不是发一个非法值。

⚠️ 实测「关闭思考」**并不会真的消除思考内容**（服务端仍返回
`reasoning_content`）—— 这是服务端行为，不是配置问题。

### 账号卡片

两个积分池**分开显示**（用户要求）：`永久 15000 · 每日 4992`。
其余 provider 的多个同类资源包仍显示「N/M 个资源包有效」，两种形态互斥。

### e2e 探针

```
pnpm test:e2e:loomy        # 只读：凭据/两套头交叉验证/模型目录/任务/两池余额，零消耗
pnpm test:e2e:loomy-chat   # ⚠️ 发一次推理：默认 qwen3.8-flash（x0.8，最便宜）
```

⚠️ 对话探针的闸门是 `DSH_LOOMY_CHAT_E2E=1` **且**
`DSH_LOOMY_CHAT_E2E_CONFIRM=yes`，`max_tokens` 压到 16（单次约 1 积分）。

---

## Raccoon Work provider（商汤小浣熊）

`raccoon` 是本插件第 9 个 provider。生产环境：

### ⚠️ 与其余 provider 不同的地方

1. **登录：微信扫码 + 短信双路径，由本地页承载**（与 Loomy 同型）。

2. **短信登录需要阿里云滑块验证码**。手机号必须 **AES-128-CFB** 加密

3. **每日 300 积分没有端点**。实测「每日积分发放」是**服务端按日自动发放**的
   （账单 `biz_type: 'daily_grant'`，该账号 13:30 注册、13:31 即到账），
   **不存在可调用的签到接口**。故能力矩阵**不登记 `dailyCheckin`** ——
   登记了会让按钮每次点击都必然失败（与 CodeArts 早期「对不支持的 provider
   无条件发请求」是同一类缺陷）。

4. **一次性登录奖励是独立来源**：`POST /api/web/desktop/v1/login/points/grant`
   给 3000 分，**幂等一次性**（已领过返回 `granted:false`，
   且账单里能看到上一次记录）。语义与 Loomy 的新手任务同构，
   故登记为 `onboardingTasks`，复用同一套 `onboarding.status` / `onboarding.claim`
   端点与 UI。⚠️ 该端点**需要** `X-Client-Platform` 头
   （`desktop-windows` / `desktop-macos` / `desktop-linux`），猜错会被拒。

5. **`Raccoon-Auto` 不暴露**。它是客户端 i18n 条目（`modelPicker.auto`）渲染的
   **「自动选模」入口**，倍率写死为 `1 倍`，**不在远端 `model_catalog` 里** ——
   直接发给 `chat/completions` 会 404。其语义（按消息内容正则打标后从候选池
   选模型）与 DSH「模型选择是会话级固定」的模型相冲，且选出的模型不可预测、
   难排查。用户可直接选 `sn-deepseek-v4-1-flash`（`ability_level: 3`、
   带 `auto` 标签，即自动选模在复杂任务下最可能选中的那个）。

### 模型目录（6 个 `visible:true`）

倍率取 `billing_effective_multiplier`（**当前生效价**，已含促销），
展示为 ` · x倍率` / ` · 免费` / ` · x原价→x折后价`：

| 模型 | 原价 | 生效价 | 展示 |
|---|---|---|---|
| `sn-sensenova-6-8-flash` | 0.5 | **0** | `SenseNova-6.8-Flash · 免费` |
| `sn-sensenova-6-8-flash-lite` | 0.5 | **0** | `SenseNova-6.8-Flash-Lite · 免费` |
| `sn-glm-5-3` | 0.75 | 0.75 | `GLM-5-3 · x0.75` |
| `sn-kimi-k3` | 1 | 1 | `Kimi-K3 · x1` |
| `sn-glm-5-3-flash` | 0.2 | **0.1** | `GLM-5-3-Flash · x0.2→x0.1` |
| `sn-deepseek-v4-1-flash` | 0.25 | 0.25 | `DeepSeek-V4.1-Flash · x0.25` |

另有 3 个 `visible:false` 的 `raccoon-*` 内部模型（自动选模的候选池），
**不在模型选择器中暴露**。

### ⚠️ 零客户端依赖（硬约束）

本 provider **运行时完全不读客户端数据** —— 不读
`%APPDATA%\office-raccoon\Local Storage\leveldb`、不读
`~/.box-agent/config/auth.json`、不解客户端 sqlite/leveldb。

### 能力矩阵

```js
raccoon: { balance: true, onboardingTasks: true }
```

⚠️ **没有 `dailyCheckin`**，理由见上文第 3 条。

### e2e 探针

```
pnpm test:e2e:raccoon        # 只读：凭据/模型目录/倍率/积分余额/账单，零消耗
pnpm test:e2e:raccoon-chat   # ⚠️ 发推理：验证标准 OpenAI SSE 与 reasoning_content
pnpm test:e2e:raccoon-tools  # ⚠️ 发推理：验证 **tools 被端点接受**（返回结构化 tool_calls）
```

⚠️ 后两个的闸门是 `DSH_RACCOON_{CHAT,TOOLS}_E2E=1` **且**
`..._CONFIRM=yes`，`max_tokens` 压到 64–256（单次消耗很小）。

⚠️ **`raccoon-tools` 的判据是「响应里有结构化 `tool_calls`」**，
不是「模型在正文里说它想调用工具」—— 后者正是 Qoder / TRAE 踩过的缺陷形态
（插件没把 `tools` 发出去，模型只能用正文 XML 臆造，harness 认不出 → 任务终止）。

---

## ZCode provider（智谱 z.ai 免费额度）

第十个 provider，id `zcode`，面板显示为 **ZCode (智谱)**。

它把 **ZCode 官方客户端的免费额度通道**（智谱 z.ai Start Plan，
`GLM-5.3-Flash`）接进 DSH。实测本机账号额度 **1 亿 token / 日**。

### ⚠️ 与其余 provider 完全不同的四点

| 维度 | ZCode | 对照 |
|---|---|---|
| **凭据来源** | **解密磁盘** `~/.zcode/v2/credentials.json` | 浏览器登录拿 token |
| **协议** | **Anthropic Messages**（非 OpenAI 兼容） | 其余多为 OpenAI 格式 |
| **每请求前置** | 产出一个**一次性**阿里云 captcha（约 1.2 秒） | 无 |
| **请求体准入** | 必须带**官方身份块**（否则 `3012`） | 无 |

### 凭据：**可以完全脱离官方客户端**

两条路**并存**，插件自存优先：

1. **插件内登录**（推荐，无需装任何东西）—— 走官方 CLI 设备授权流：

   ```
   ① POST /api/v1/oauth/cli/init        Bearer <自己生成的 32 字节 hex>
        body: { provider: "bigmodel" }
      → { flow_id, poll_token, authorize_url, expires_at, poll_interval_sec }
   ② 用户在浏览器打开 authorize_url 完成授权
   ③ GET /api/v1/oauth/cli/poll/{flow_id}
      → { status: "pending" } 继续等
      → { status: "ready", token, user, bigmodel: { access_token } }
   ```

   ⚠️ 这是**纯 HTTP**，不经 `zcode://` 自定义协议回调 —— 普通 Node 进程就能
   走完（实测 ① 返回 200、③ 正常 `pending` 轮询）。它还**绕开了故障的**
   `POST /api/v1/oauth/token`（该端点自 2026-09-28 起稳定 500 / code 2007）。

2. **回退：读官方客户端凭据** —— 解密 `~/.zcode/v2/credentials.json`
   （`enc:v1:` + AES-256-GCM，密钥由官方公开算法派生：
   `sha256(ZCODE_CREDENTIAL_SECRET ?? \`zcode-credential-fallback:${platform}:${homedir}:${username}\`)`）。
   「已经装了官方客户端并登录过」的用户**零操作**即可用。

⚠️ **`device_mid` 由插件自己生成**（UUID v4），不再读官方
`telemetry-state.json` —— 这是「脱离 IDE」的关键。实测依据：同一 JWT 换
任意随机 UUID，`billing/balance` 都返回 200；而缺它才回
`400 {"code":3001,"msg":"parameter error"}`。故它的**值**不被绑定校验，
只需**稳定**（生成后持久化在凭据里，登录一次即固定）。

⚠️ 凭据形状校验必须做：凭据存储里可能有任何字符串（用户手填、旧版本残留），
`isUsableZcodeCredential()` 保证后续代码拿到的是完整对象。

### captcha：唯一还需要浏览器的地方

免费通道强制阿里云 captcha（缺失时上游回
`400 {"code":3007,"msg":"captcha verify failed"}`）。它是**网页 SDK**，
不是 Electron 专有 API：

```
script:  https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js
配置:    GET /api/v1/client/configs?platform=unknown  →  {region, prefix, sceneId}
调用:    window.AliyunCaptchaConfig = { region, prefix }
         initAliyunCaptcha({ SceneId, element, button, getInstance, success, … })
取参:    getInstance 里调 instance.startTracelessVerification()（无感验证）
```

**三条实测得到的硬约束**：

1. **`--headless=new` 过不了**，必须 **headful**（窗口移到屏幕外
   `--window-position=-32000,-32000`，不进任务栏、不抢焦点，用户无感）。
   实测矩阵（同一份代码，只换一个变量）：

   | | `about:blank` | 真实 origin |
   |---|---|---|
   | **headless** | **0/3** | **0/3** |
   | **headful** | 3/3 | **3/3（811ms）** |

2. **页面必须是真实 https origin**（`https://zcode.z.ai/`），不能用 `about:blank`
   —— 后者的 origin 是字符串 `"null"`，阿里云风控据此拒绝：

   | origin | 同一页面连续 mint |
   |---|---|
   | `about:blank` | **1/3**（#2 起 `F001`） |
   | **`https://zcode.z.ai/`** | **5/5，中位 426ms** |

3. **可以复用同一个页面**（因为 origin 对了）+ 每次重置 DOM。
   比「每次新建 page」快 **2.9 倍**（1246ms → 426ms）。

⚠️ SDK 在**降级路径**下会产出**约 76 字符的垃圾 param**，发上游**必然 3007**。
故 `validateCaptchaParam()` 会校验（长度 ≥200 且 `securityToken` ≥50），
不合格**不发请求**（省一次注定失败的往返）。

浏览器自动探测（`ZCODE_CHROME_PATH` 可显式指定）：
scoop `chromium` → Chrome → Chromium → Edge。**常驻一台 + 复用页面**；
并发 mint 会串行化（captcha param 一次性，共用页面会互相踩状态）；
插件卸载时 `dispose()`（否则留孤儿进程约 200-400MB）。

### ⚠️ 关于「更轻量的浏览器」：实测结论是**都不行**

试过三个 obscura 构建（obscura-node 自带 0.1.8 / scoop 0.2.3 /
官方 release `-stealth` 0.2.3）与 Lightpanda，**均无法跑通阿里云 captcha**：

| 方案 | 结果 |
|---|---|
| obscura 0.2.3（官方 stealth，最完整构建） | ✗ `getInstance` 从不触发，**零阿里云网络请求** |
| obscura 0.1.8（obscura-node 自带） | ✗ 与 0.2.3 **同样的**错误 |
| Lightpanda | ✗ 特性清单**明确无 canvas/WebGL** |

obscura 的根因是**引擎级缺口**（不是补几个 API 能解决）：

```
[error] Dynamic script fetch error: HTTP 0        ← 动态模块加载器失败
[error] Couldn't find a style target              ← CSSOM 注入不工作
[error] Dynamic script error: moveTo is not defined
[error] Timer error: TypeError: Cannot read properties of undefined (reading 'prototype')
```

我试过**拦截 `HTMLCanvasElement.prototype.getContext`**（给 SDK 自建的 canvas
注入带真实 VENDOR/RENDERER 的假 WebGL）+ 补 `Permissions` / `TouchEvent`：
补丁确实生效、错误也变了，但暴露出 `Dynamic script fetch error: HTTP 0`
这个**死结** —— FeiLin 无感引擎靠动态加载若干 JS 模块工作。

⇒ **继续用 chromium**（scoop 已装，零新增安装；或用系统 Chrome / Edge）。

`Playwright` 也能跑通（复用页面同样约 546ms），但它会引入依赖；
当前手写 CDP 版本**零第三方依赖**且已优化到同等水平，故不引入。

### 3012：判据是**请求体内容**，不是 HTTP 头

上游对 `zcode-plan` 通道做内容检查。实测矩阵：

| `system` 内容 | 字符数 | 结果 |
|---|---|---|
| 无 | 0 | ✗ 3012 |
| 仅 `cliPrefix` | 42 | ✗ 3012 |
| **`cliPrefix` + `stable`** | **2900** | **✓ 200** |

⇒ 身份块必须**逐字**为官方文本且**处在开头**，调用方的 prompt 追加在最后。
另外首轮 user 消息要带 `<system-reminder>` 日期块（官方称之为
「3012 的最后一个开关」）。

⚠️⚠️ **3012 有账号冷却惩罚**（30 分钟；24h 内第 3 次起 24h；**5 次停用**）。
故 `httpErrorCodeForZcode()` 把它映射为 `PERMISSION`（**不可重试**），
而 `3007` 映射为 `RATE_LIMIT`（可重试，换个新 param 就能过）。

### 积分与签到

- **余额**：`GET /api/v1/zcode-plan/billing/balance`
  （⚠️ **需要** `Authorization: Bearer <zcodejwt>`，与 `preview` 不同）。
- **每日领取**：`event/report`（补 `app_launch` + `app_daily_active`）
  → `billing/preview` → `billing/claim`。

⚠️ **补激活上报不能省**：不补这两条事件，`preview` 恒为空 `plans: []`
（实测：补前空、补后立刻出现 plan）。「每日随机派发」不是随机推送，
而是**服务端按活跃信号决定要不要给**。

⚠️ **captcha 一次性** ⇒ 每个 plan 都要**重新 mint**（复用会得 `3007`）。

⚠️ **`1003`（已领取）是幂等成功，不是错误** —— 当失败会让定时任务反复误报。

⚠️ 能力矩阵登记为 `{ balance: true, dailyCheckin: true }`，
但**额度单位是 token 而不是积分** —— 面板与 RPC 层如实标注量纲，不伪装。

### 模型表是**静态白名单**

上游模型池有 4 个，但 `GLM-5-Turbo` / `GLM-5.2` 实测**返回空响应**
（0/3 正确，而 `GLM-5.3` 是 3/3），故只暴露实测可用的两个：

| 模型 | 中位延迟 | 正确率 | 并发限流 |
|---|---|---|---|
| `GLM-5.3` | 4452ms | 8/14 | 撞过 21 次 3009 |
| `GLM-5.3-Flash` | 4915ms | 10/15 | **0 次** |

⚠️ `listModels` **不发网络请求**（枚举远端会列出用不了的模型）。

### 显式不支持图片

该通道的图片链路**未验证**，故适配器**显式拒绝**图片输入
（`UNSUPPORTED_CONTENT`）—— 比静默丢图好（丢图会让模型看到空内容）。

### 实测（本机，2026-09-29）

```
readZcodeCredential()   ✓  device_mid=72c145cd…  app_version=3.14.3
fetchZcodeBalance()     ✓  GLM-5.3-Flash  remaining=99,999,344 / 100,000,000
fetchZcodeCaptchaConfig ✓  {"region":"cn","prefix":"no8xfe","sceneId":"11xygtvd"}
captcha mint            ✓  2339ms  len=280  securityToken=128
真实推理（GLM-5.3-Flash）✓  3685ms  可见文本="正常"
                            chunk 类型 = block-start, reasoning-delta, text-delta, block-end
额度扣减                 ✓  used: 656 → 1475
```

### ⚠️ 与「本机 HTTP 桥」方案的关系

PR 初版的实现是「读 `<dataBaseDir>/.zcode/v2/bridge-port.json` → 打本机桥
→ 由 ZCode 实例代发上游」。那条路依赖一个**被补丁注入过的开源版实例**，
而**官方闭源版不写那个发现文件** —— 故「装了 ZCode」并不等于「桥可用」。
本实现改为**直连上游**（凭据解密 + captcha 由普通浏览器产出 +
身份块满足准入），**不再需要任何实例常驻**。

### 协议层：`zcode-anthropic.ts`

ZCode 免费通道**只认 Anthropic Messages**（实测 `zcode-plan` 下的
`openai` / 裸 `v1/chat/completions` 路径一律 `404 page not found`）。
而 `openai-compat.ts` 的 `serializeMessages()` 产出 OpenAI 形态，
故需要一层转换：

| 维度 | OpenAI | Anthropic |
|---|---|---|
| system | `messages[0].role='system'` | **顶层 `system` 字段**（块数组） |
| 工具声明 | `tools[].function.{name,parameters}` | **`tools[].{name,input_schema}`**（扁平） |
| 工具调用 | `tool_calls[].function.arguments`（**字符串**） | `content[].{type:'tool_use',input}`（**对象**） |
| 工具结果 | `{role:'tool', tool_call_id}` | `{role:'user', content:[{type:'tool_result'}]}` |
| SSE 结束 | `data: [DONE]` | `message_stop` 事件（**无** `[DONE]`） |
| 思考 | `delta.reasoning_content` | `thinking_delta` |

⚠️ 两个最容易踩的：`tool_use.input` 是**对象**（不是 JSON 字符串）；
工具结果必须包成 `role:'user'` 里的 `tool_result` 块。

⚠️ **空响应必须显式抛 `EMPTY_RESPONSE`** —— Anthropic SSE 没有 `[DONE]`
可做锚点，若不检查就会「干净地停止、无任何报错」
（与 Qoder 那次静默失败的形态完全一致）。
