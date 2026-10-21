# 部署到 Cloudflare（Workers + Assets）

本文件是分支 `cloudflare-deploy` 的部署说明。目标：把原本部署在 Netlify 的实例搬到
Cloudflare，并开启**账号模式 + 多人联机**。

- 适配方式：[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare)（部署到 Workers，静态资源走 Assets 绑定）
- 配置文件：`wrangler.jsonc`、`open-next.config.ts`（本分支新增）
- Netlify 原有配置（`netlify.toml`）**保持不动**，两条部署线互不影响，可随时回退

---

## 0. 前置条件

| 项 | 要求 |
| --- | --- |
| Node.js | 20 或以上 |
| Cloudflare 账号 | **建议 Workers Paid（$5/月）**，原因见「5. 已知限制」第 1 条 |
| Supabase 项目 | 已建好，且能拿到 Project URL + service_role（或 secret key）+ anon key |
| 域名 | 建议绑定自己的域名；换域名 = 换 IndexedDB 库，见文末注意事项 |

---

## 1. 安装依赖

```bash
npm install
npm install --save-dev @opennextjs/cloudflare@latest wrangler@latest
npx wrangler login
```

`package.json` 里已预置脚本（若版本号与实际安装的不一致，以 npm 装的为准）：

```bash
npm run cf:build     # 只构建，产物在 .open-next/
npm run cf:preview   # 本地用 Workers 运行时预览
npm run cf:deploy    # 构建并部署
```

---

## 2. 初始化 Supabase

在 Supabase **SQL Editor** 里整段执行仓库的 `docs/supabase-all-in-one.sql`（幂等，可重复执行）。
它包含：账号/激活码/会话、成年审核、便签墙、游戏大厅、应用市场、黑市、**多人联机**所需的全部表。

执行前确认复制到的最后一行是：

```
-- ===== 全部结束 =====
```

缺了说明复制被截断，必须重新复制完整脚本。

然后插一条激活码（注册要用，模板见 `docs/account-supabase.sql` 末尾）：

```sql
insert into public.activation_codes (code, label, max_uses)
values ('YOUR_CODE', 'self host', 20)
on conflict (code) do update
set label = excluded.label,
    max_uses = excluded.max_uses,
    status = 'active',
    updated_at = now();
```

最后到 Supabase Dashboard → **Realtime** 确认已启用（默认开启，联机靠它传消息）。

---

## 3. 环境变量

### 3.1 运行时要用的密钥（部署后读取，用 secret 存，**不要进 git**）

逐条执行，命令会提示粘贴值：

```bash
npx wrangler secret put SUPABASE_URL                    # https://xxxx.supabase.co
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY       # service_role 或新版的 secret key
npx wrangler secret put SUPABASE_ANON_KEY               # ★ 联机必需
npx wrangler secret put ACCOUNT_GATE_SECRET             # 随机长字符串（openssl rand -base64 32）
```

说明：

- **`SUPABASE_ANON_KEY` 是联机的关键一条**。浏览器直连 Supabase Realtime 需要 URL + anon key，
  它们由 `app/api/online/config/route.ts` 从服务端下发（同时接受 `SUPABASE_ANON_KEY` 和
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`）。放在服务端变量里就不必再配一个 `NEXT_PUBLIC_*`，
  也不用担心构建期没注入。anon key 设计上可公开，但仍建议用 secret 存，别写进仓库。
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 缺失时，所有云端接口返回 503 `missing_supabase_env`，
  表现为登录一直失败。
- `ACCOUNT_GATE_SECRET` 不填也能跑（会回退用 service_role 签名），但换了 service key 后
  全站用户会被踢下线，建议显式设置。

### 3.2 构建期变量（`NEXT_PUBLIC_*` 会内联进前端包，必须在 build 时存在）

在项目根目录建 `.env.local`（已被 `.gitignore` 忽略），本地构建时会自动读取：

```bash
NEXT_PUBLIC_SELF_HOSTED_MODE=false
# 以下可选：服务端已通过 3.1 的变量兜底，仅在你想让前端直接拿到时才需要
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
# 可选增强
NEXT_PUBLIC_IMAGE_GEN_PROXY_URL=
NEXT_PUBLIC_DEFAULT_NETEASE_API_BASE=
```

> `NEXT_PUBLIC_SELF_HOSTED_MODE` 同时写在 `wrangler.jsonc` 的 `vars` 里，保证运行时
> `isSelfHostedModeEnabled()` 也读到 `false`（该模块服务端代码也在用）。

### 3.3 可选功能变量

按需追加为 secret：

```bash
npx wrangler secret put VERIFY_ADMIN_KEY                # 成年审核后台
npx wrangler secret put APP_MARKET_ADMIN_KEY            # 应用市场审核（不填回退用上面那个）
npx wrangler secret put TRIPO_API_KEY                   # 筑境 3D（也可用户在应用内自填）
npx wrangler secret put IMGBB_API_KEY                   # 图床（也可用户自填）
npx wrangler secret put MIXOLOGY_SUPABASE_URL           # 独家特调（独立项目）
npx wrangler secret put MIXOLOGY_SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put RESEND_API_KEY                  # 现实桥邮件
```

改完任何变量都要重新部署才生效（`NEXT_PUBLIC_*` 更是必须重新构建）。

---

## 4. 部署

```bash
npm run cf:deploy
```

首次部署后控制台会给出 `https://ai-virtual-phone.<你的子域>.workers.dev`。
想用自有域名：Cloudflare Dashboard → Workers & Pages → 该 Worker → Settings → Domains & Routes → 添加自定义域名。

验证清单（逐条过一遍）：

1. 打开站点：出现**登录/注册页**而不是直接进手机 → 说明已是账号模式
2. 用激活码注册、登录成功 → 说明 Supabase 账号链路通了
3. 浏览器直接访问 `/api/online/config`，应返回 `{"ok":true,"configured":true,...}`。
   若返回 `configured:false`，就是 `SUPABASE_ANON_KEY` 没配上
4. 应用市场能打开、能安装「联机广场」
5. 联机实测：A 设备建房拿 4 位房号 → B 设备输入房号加入 → 双方互发消息即时到
6. 手机浏览器「添加到主屏幕」后能正常启动（PWA）

排错：Cloudflare Dashboard → Workers → 该 Worker → Logs（实时日志）；本地可先
`npm run cf:preview` 对着 Worker 运行时复现。

---

## 5. 已知限制（部署前务必看）

1. **Workers Free 的 10ms CPU 限制会打断登录。** `lib/server/account-auth.ts` 用 PBKDF2-SHA256
   做密码哈希，迭代 **210000 次**，单次验证约几十到上百毫秒 CPU。Free 计划单请求 CPU 上限
   10ms，登录/注册会直接超时；需要 Workers **Paid**（CPU 上限 30s）。这是本方案唯一的硬性付费点。
2. **`web-push` 与 `undici` 在 Workers 上未经验证。** 两者都是 Node 生态包，`nodejs_compat`
   能覆盖大部分 API，但推送相关接口（`/api/push/*`）可能报错。若不用离线推送，可忽略；
   要用就需实测。
3. **Worker 包体积上限**：Free 3 MiB / Paid 10 MiB（压缩后）。本仓库依赖较重（three.js、
   gltf-transform 等，多为客户端包），服务端产物大小需实测，超了就要拆包或改架构。
4. **静态资源单文件 25 MiB 上限**：`public/fonts` 里有 7~24MB 的中文字体，属于贴着上限；
   若哪天新字体超了，Assets 会拒绝上传，需要改成分片或子集化。
5. **登录限速是实例内内存计数**（见 `lib/server/login-rate-limit.ts` 注释），Workers 多 isolate
   下各自计数，实际配额比 Netlify 更松。这是原有设计，不是 Cloudflare 引入的问题。
6. 本配置按 `@opennextjs/cloudflare` 官方结构编写，但**没有在本仓库跑过真实构建验证**，
   首次 `cf:deploy` 可能需要按报错微调（常见：某路由需要显式 `runtime = "nodejs"`）。

---

## 6. 回退

回退到 Netlify 只需用 `main` 分支部署，或把 Cloudflare 的域名指回 Netlify。
`netlify.toml`、`.env.example` 均未被 Cloudflare 方案改动，两条线可并存。

## 7. 注意：换域名会换掉本地数据

聊天记录、角色卡都存在浏览器的 IndexedDB，**按域名隔离**。从 Netlify 域名换到
`*.workers.dev` 或新自有域名，就是一份新的空库。切换前务必：

1. 旧站打开「设置」→ 备份导出
2. 新站登录后导入备份
3. 再让朋友开始联机
