/**
 * Gate 本地回调 OAuth — 公共 API 由 `./device-flow.js` 聚合导出（实现拆至 oauth-*.ts / gate-oauth-*.ts）。
 * 本文件重新导出，供单独使用或兼容旧 import。
 */

export {
  type OAuthToken,
  type GateOAuthConfig,
  GATE_DEFAULT_CONFIG,
  GateOAuth,
  openBrowser,
} from "./device-flow.js";
