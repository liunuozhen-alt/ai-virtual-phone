import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Cloudflare 适配配置。
// 不启用 ISR / 增量缓存：本项目页面基本是客户端渲染，数据都在浏览器 IndexedDB
// 和后端 API 路由里，没有需要跨请求缓存的静态生成页。
// 将来若用到 ISR，按 @opennextjs/cloudflare 文档接入 R2 或 KV 缓存即可。
export default defineCloudflareConfig({});
