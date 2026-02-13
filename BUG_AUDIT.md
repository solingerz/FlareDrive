# FlareDrive 全面审查报告（2026-02-13）

## 审查范围
- 前端：`src/`
- WebDAV Functions：`functions/webdav/`
- 分享能力：`functions/api/share.ts`、`functions/s/[token].ts`
- 工具层：`utils/`

## 高优先级问题（建议优先修复）

1. **传输队列失败后可能永久卡死**
   - 位置：`src/app/transferQueue.tsx`
   - 问题：任务失败后只把状态改成 `failed`，但没有把 `taskProcessing.current` 置回 `null`。
   - 影响：后续 `pending` 任务将无法继续被调度，上传队列“假死”。

2. **上传请求失败不会被识别为失败**
   - 位置：`src/app/transfer.ts` 的 `xhrFetch` 与 `processTransferTask`
   - 问题：`xhrFetch` 在 `onload` 中无论 HTTP 状态码如何都 `resolve`，且调用方未检查 `response.ok`。
   - 影响：服务端返回 4xx/5xx 时，前端仍可能将任务标记为 `completed`，造成“假成功”。

3. **目录拷贝在目标存在目录时存在高风险覆盖行为**
   - 位置：`functions/webdav/copy.ts`
   - 问题：COPY 对目录递归时会直接向目标路径写入对象；对 WebDAV 语义下“目标已存在目录”的兼容策略不完整，容易与客户端预期不一致。
   - 影响：可能导致用户误覆盖已有内容或产生混乱目录结构。

## 中优先级问题

4. **GET HTML 时将整个文件读入内存并重写**
   - 位置：`functions/webdav/get.ts` 的 `addHtmlCharset`
   - 问题：通过循环读取把整个 HTML 拼接成字符串后再返回。
   - 影响：大文件请求内存峰值高，边缘环境中可能触发性能问题或 OOM 风险。

5. **`copyPaste` 未检查 COPY/MOVE 的响应结果**
   - 位置：`src/app/transfer.ts`
   - 问题：`fetch` 后未检查 `res.ok` 直接返回。
   - 影响：前端无法向用户反馈重命名/移动失败（如 409/412）。

6. **`createFolder` 吞掉真实错误**
   - 位置：`src/app/transfer.ts`
   - 问题：`catch` 仅 `console.log("Create folder failed")`，丢失错误细节。
   - 影响：排障困难，用户层面表现为“无提示失败”。

7. **分享下载头部 `Content-Disposition` 编码兼容性不足**
   - 位置：`functions/s/[token].ts`
   - 问题：只使用 `filename="${encodeURIComponent(filename)}"`。
   - 影响：部分客户端/浏览器对非 ASCII 文件名显示不佳；建议补充 RFC 5987 的 `filename*`。

## 低优先级问题/工程质量问题

8. **仓库根目录存在重复前端源码，导致独立 TS 检查失败**
   - 位置：根目录 `Main.tsx`、`TextPadDrawer.tsx` 与 `src/` 下同名实现并存
   - 影响：`npx tsc --noEmit` 会在仓库级别报模块解析错误，增加 CI/IDE 误报概率。

9. **Cloudflare Functions 类型声明不完整**
   - 位置：`functions/s/[token].ts`
   - 影响：严格 TS 检查时 `env.SHARE_KV`/`env.BUCKET` 报错，影响类型安全与重构体验。

10. **S3 签名工具的 TS 兼容性问题**
    - 位置：`utils/s3.ts`
    - 影响：在当前 `tsconfig` 下出现 `URLSearchParams` 可迭代类型与 `Headers.keys` 类型错误，不利于后续维护。

## 已执行检查
- `npm run build`：通过
- `npx tsc --noEmit`：失败（见上文第 8/9/10 项）

## 建议修复顺序
1. 先修复队列卡死 + 失败误判（用户数据一致性风险最高）
2. 再处理 GET 内存路径与 COPY 语义
3. 最后清理类型问题与工程重复文件
