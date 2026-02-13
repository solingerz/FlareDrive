/**
 * 认证配置接口
 */
export interface AuthConfig {
  username: string;
  password: string;
  publicRead?: boolean;
}

/**
 * 可以在公开读取模式下访问的 HTTP 方法
 */
export const PUBLIC_READ_METHODS = ["GET", "HEAD", "PROPFIND"] as const;

/**
 * 统一的认证中间件
 * @param request HTTP 请求对象
 * @param config 认证配置
 * @returns 如果认证失败返回错误响应,成功返回 null
 */
export function requireAuth(
  request: Request,
  config: AuthConfig
): Response | null {
  // 检查是否启用了 WebDAV 认证
  if (!config.username || !config.password) {
    return new Response("WebDAV protocol is not enabled", { status: 403 });
  }

  // 检查是否可以跳过认证 (公开读取模式)
  const isPublicReadMethod = PUBLIC_READ_METHODS.includes(
    request.method as any
  );
  if (config.publicRead && isPublicReadMethod) {
    return null; // 允许访问
  }

  // 验证 Authorization 头
  const auth = request.headers.get("Authorization");
  if (!auth) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": `Basic realm="WebDAV"` },
    });
  }

  // 验证用户名和密码
  const expectedAuth = `Basic ${btoa(`${config.username}:${config.password}`)}`;
  if (auth !== expectedAuth) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": `Basic realm="WebDAV"` },
    });
  }

  return null; // 认证成功
}

/**
 * 简化版认证函数 - 用于不支持公开读取的 API
 * @param request HTTP 请求对象
 * @param username WebDAV 用户名
 * @param password WebDAV 密码
 * @returns 如果认证失败返回错误响应,成功返回 null
 */
export function requireAuthSimple(
  request: Request,
  username: string,
  password: string
): Response | null {
  return requireAuth(request, {
    username,
    password,
    publicRead: false,
  });
}
