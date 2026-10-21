# Netlify 部署：账号登录 + 多人联机

本文件是 `main` 分支的部署清单，目标是**账号登录模式 + 多人联机**同时可用。
适用 Netlify（也适用于任何 Node.js 20+ 的自建环境）。

> 重要前提：本项目**不需要改代码**来实现这个目标。账号门禁、Session、联机房间逻辑
> 都已经在仓库里，全部由环境变量与 Supabase 建表决定。下面的步骤不需要动任何 `.ts` 文件。

---

## 0. 为什么这两件事必须一起开

`app/api/online/rooms/route.ts` 第 69 行有明确拦截：

```ts
if (isSelfHostedModeEnabled()) {
  return NextResponse.json({ ok: false, error: "联机房间需要账号系统（联机模式），单机模式暂不支持。" }, { status: 400 });
}
```

单机模式下所有人都被当作同一个 `local_user`，房间归属和踢人无法成立，所以联机被硬性禁用。
结论：**要联机，必须先切账号模式**，没有单独开联机的办法。

---

## 1. 在 Supabase 里建表

新建一个 Supabase 项目（不要用作者的官方项目），进入 **SQL Editor**，整段执行仓库里的：

```
docs/supabase-all-in-one.sql
```

这一个脚本就建齐了全部云端表，其中包含联机需要的 `online_rooms`（实时房间）和
`online_cloud_docs`（漂流瓶/共享数据）。全部语句幂等，重复执行不报错。

执行前请确认你复制到的最后一行是 `-- ===== 全部结束 =====`，缺了就是复制被截断。

然后插一条激活码（注册账号要用，模板见 `docs/account-supabase.sql` 末尾）：

```sql
insert into public.activation_codes (code, label, max_uses)
values ('YOUR_CODE', 'self host', 20)
on conflict (code) do update
set label = excluded.label,
    max_uses = excluded.max_uses,
    status = 'active',
    updated_at = now();
```

最后到 Supabase Dashboard → **Realtime** 确认已启用（默认开启）。联机的消息不落库，
全靠 Realtime broadcast 传输，这里关掉就收不到消息。

---

## 2. 在 Netlify 配环境变量

路径：**Site configuration → Environment variables → Add a variable**。

### 2.1 必填（四条）

| 变量 | 值 | 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_SELF_HOSTED_MODE` | `false` | ★ **必须构建时存在**。写成 `false` 或直接删掉该变量都是账号模式；只有 `1/true/yes/on` 才关闭门禁 |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` 或 `sb_secret_...` | 服务端专用。新版面板的 secret key 也认这个位置，或写 `SUPABASE_SECRET_KEY` |
| `SUPABASE_ANON_KEY` | `eyJ...` 或 `sb_publishable_...` | ★ **联机必需**。由 `/api/online/config` 下发给浏览器直连 Realtime |

⚠️ 前三条是服务端密钥，**绝对不能**加 `NEXT_PUBLIC_` 前缀——那样会被打包进浏览器代码，
等于把整库的管理权限公开出去。`SUPABASE_ANON_KEY` 设计上可公开，但仍建议按服务端变量存。

### 2.2 强烈建议（一条）

| 变量 | 值 | 说明 |
| --- | --- | --- |
| `ACCOUNT_GATE_SECRET` | 随机长字符串 | 门禁 Cookie 的签名密钥，用 `openssl rand -base64 32` 生成 |

不填也能跑（`lib/account-gate-cookie.ts` 会回退用 `SUPABASE_SERVICE_ROLE_KEY` 签名），
但只要你哪天轮换了 service key，全站用户的登录态会一起失效。建议显式设置。

### 2.3 可选

```bash
VERIFY_ADMIN_KEY               # 成年审核后台
APP_MARKET_ADMIN_KEY           # 应用市场审核（不填回退用 VERIFY_ADMIN_KEY）
TRIPO_API_KEY                  # 筑境 3D（也可用户在应用内自填）
IMGBB_API_KEY                  # 图床（也可用户自填）
NEXT_PUBLIC_SUPABASE_URL       # 便签墙实时刷新 + 多人联机联机配置兜底
NEXT_PUBLIC_SUPABASE_ANON_KEY  # 同上（与 SUPABASE_ANON_KEY 二选一即可）
NEXT_PUBLIC_IMAGE_GEN_PROXY_URL
NEXT_PUBLIC_DEFAULT_NETEASE_API_BASE
RESEND_API_KEY                 # 现实桥「邮件自动」
```

---

## 3. 重新部署

`NEXT_PUBLIC_*` 变量是在**构建期**内联进前端包的，只改后台不重新构建不生效。

Netlify Dashboard → **Deploys** → **Trigger deploy** → **Clear cache and deploy site**。

建议选「Clear cache」：Next.js 的构建缓存有可能复用上一轮的产物，环境变量刚改动时清一遍最稳。

> 本地开发同理：改完 `.env.local` 要重启 `npm run dev`。
> 另注意 `.env.example` 第 3 行默认是 `NEXT_PUBLIC_SELF_HOSTED_MODE=true`，
> 如果你曾照抄成 `.env.local`，本地会一直是单机模式。

---

## 4. 验证清单

按顺序过，哪一步断了就停在那一格排查：

1. **打开站点出现登录/注册页**，而不是直接进手机桌面 → 账号模式已生效
2. **用激活码注册、再用该账号登录成功** → Supabase 账号链路通了
3. **浏览器直接访问 `https://你的域名/api/online/config`**
   应返回 `{"ok":true,"configured":true,"supabaseUrl":"https://...","anonKey":"..."}`
   返回 `configured:false` 说明 `SUPABASE_ANON_KEY` 没配上
4. **应用市场能打开**，安装「联机广场」
5. **联机实测**：A 设备建房拿到 4 位房号 → B 设备输房号加入 → 双方互发消息应即时到达
6. **PWA**：手机浏览器「添加到主屏幕」后能正常启动

---

## 5. 排错对照表

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 没有登录页，直接进手机 | `NEXT_PUBLIC_SELF_HOSTED_MODE` 仍是 `true`，或改了没重新构建 | 改成 `false` → Clear cache and deploy |
| 登录报「Supabase 环境变量未配置」503 | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 缺失 | 补上后重新部署 |
| 登录报「账号表尚未创建」 | SQL 没执行或执行被截断 | 重跑 `docs/supabase-all-in-one.sql`，核对末行标记 |
| 注册报「激活码不存在/已被使用完」 | 没插激活码，或 `max_uses` 用尽 | 按第 1 节 SQL 插一条新的 |
| 联机提示「需要账号系统（联机模式）」 | 仍处于单机模式 | 同上，切 `NEXT_PUBLIC_SELF_HOSTED_MODE=false` |
| `/api/online/config` 返回 `configured:false` | `SUPABASE_ANON_KEY` 没配 | 补上后重新部署 |
| 该接口配好后仍返回 `false` | 该路由带 CDN 缓存头，最长 1 小时 | 等缓存过期，或在 Netlify 里清缓存 |
| 能建房加入但收不到消息 | Supabase Realtime 被关，或浏览器/网络拦了 WebSocket | 检查 Dashboard → Realtime；换网络试 |
| 登录偶尔极慢后失败 | PBKDF2 210000 次迭代较吃 CPU | Netlify 按墙钟时间计费、不限制单次 CPU，一般无碍；持续失败看 Functions 日志 |

日志入口：Netlify Dashboard → **Functions** → 选函数 → 查看实时日志。

---

## 6. 与单机模式的关系

- 两种模式是**同一套代码**，靠环境变量区分，随时可切回单机（改成 `true` 再重新部署）
- 单机模式用固定账号 `local_user`（`lib/server/account-auth.ts:47`），云端表的
  `app_users` 里预置了这个占位行，所以单机模式开钱包不会触发外键错误
- 切到账号模式后，聊天记录、角色卡等数据**仍然在浏览器 IndexedDB 里**，不按账号隔离，
  一般不会丢；但**仍然建议切换前先备份导出**——一旦部署域名变化（比如换了自定义域名），
  IndexedDB 是按域名隔离的，等于一份全新的空库

---

## 7. 回退

把 `NEXT_PUBLIC_SELF_HOSTED_MODE` 改回 `true`，Clear cache and deploy。
无需删表、无需回滚代码。
