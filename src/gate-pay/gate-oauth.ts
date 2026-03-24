/**
 * Gate 本地回调 OAuth — 实现位于 `./device-flow.js`（浏览器授权 → localhost 回调 → 远程换 token）。
 * 本文件仅重新导出类型与 `GateOAuth`，供单独使用或兼容旧 import。
 */

export {
  type OAuthToken,
  type GateOAuthConfig,
  GATE_DEFAULT_CONFIG,
  GateOAuth,
  openBrowser,
} from "./device-flow.js";
