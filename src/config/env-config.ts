/**
 * 环境配置管理模块
 * 支持通过 GATE_PAY_ENV 环境变量在 test 和 prd 环境间切换
 */

import trackingProductDefaults from "./tracking-product-defaults.json";

export type Environment = "test" | "prd";

/**
 * 环境配置接口
 */
export interface EnvironmentConfig {
  // OAuth 配置
  oauthClientId: string;
  oauthClientSecret: string;
  oauthBackendOrigin: string;
  accountAuthorizeOrigin: string;
  oauthCallbackPort: number;

  // 中心化支付
  centralizedPaymentUrl: string;
  paymentClientId: string;

  // 钱包服务
  quickWalletServerUrl: string;
  pluginWalletServerUrl: string;
  gvBaseUrl: string;
  // 其他配置
  oauthScope: string;
  oauthAuthorizeUserAgent: string;
}

/**
 * 测试环境配置
 */
const TEST_CONFIG: EnvironmentConfig = {
  // OAuth 配置
  oauthClientId: "mZ96D37oKk-HrWJc",
  oauthClientSecret: "QcICEvHYl4zlqd27AD8Grw1s78ni989RK1t3igeRdN0=",
  oauthBackendOrigin: "http://dev.halftrust.xyz/oauth2",
  accountAuthorizeOrigin: "https://14099.gateio.tech",
  oauthCallbackPort: 18473,

  // 中心化支付
  centralizedPaymentUrl: "http://dev.halftrust.xyz/payment-service/payment/gatepay/v2/pay/ai/order/pay",
  paymentClientId: "mZ96D37oKk-HrWJc",

  // 钱包服务
  quickWalletServerUrl: "https://wallet-service-mcp-test.gateweb3.cc/mcp",
  gvBaseUrl: "https://test-api.web3gate.io/api/app/v1/web3-gv-api",
  pluginWalletServerUrl: "https://walletmcp-test.gateweb3.cc/mcp",

  // 其他配置
  oauthScope: "read_profile",
  oauthAuthorizeUserAgent: "gateio/web",
};

/**
 * 生产环境配置
 */
const PRD_CONFIG: EnvironmentConfig = {
  // OAuth 配置
  oauthClientId: "kIWkpCQBJUPWNuDo",
  oauthClientSecret: "u4tyiLBhryczzT_5XcmHLVYQkWYhCIbPH1ejtXqiuLs=",
  oauthBackendOrigin: "https://www.gate.com/apiw/v2/mcp/oauth",
  accountAuthorizeOrigin: "https://gate.com",
  oauthCallbackPort: 18473,

  // 中心化支付
  centralizedPaymentUrl: "https://api.gateio.ws/api/v4/pay/ai/order/pay", 
  paymentClientId: "kIWkpCQBJUPWNuDo",

  // 钱包服务
  quickWalletServerUrl: "https://api.gatemcp.ai/mcp/dex",
  pluginWalletServerUrl: "https://walletmcp.gate.com/mcp",
  gvBaseUrl: "https://webapi.w3-api.com/api/web/v1/web3-gv-api/",

  // 其他配置
  oauthScope: "read_profile",
  oauthAuthorizeUserAgent: "gateio/web",
};

/**
 * 获取当前环境（test 或 prd）
 * 默认为 prd
 */
export function getEnvironment(): Environment {
  const env = process.env.GATE_PAY_ENV?.toLowerCase().trim();
  return env === "test" ? "test" : "prd";
}

/**
 * 获取基础环境配置（根据 GATE_PAY_ENV）
 */
function getBaseConfig(): EnvironmentConfig {
  const env = getEnvironment();
  return env === "test" ? TEST_CONFIG : PRD_CONFIG;
}

/**
 * 获取最终环境配置
 * 优先级：直接设置的环境变量 > GATE_PAY_ENV 预设配置 > 默认值
 */
export function getEnvConfig(): EnvironmentConfig {
  const baseConfig = getBaseConfig();

  return {
    // OAuth 配置
    oauthClientId:
      process.env.GATE_PAY_OAUTH_CLIENT_ID?.trim() || baseConfig.oauthClientId,
    oauthClientSecret:
      process.env.GATE_PAY_OAUTH_CLIENT_SECRET?.trim() || baseConfig.oauthClientSecret,
    oauthBackendOrigin:
      process.env.GATE_PAY_OAUTH_BACKEND_ORIGIN?.trim()?.replace(/\/$/, "") ||
      baseConfig.oauthBackendOrigin,
    accountAuthorizeOrigin:
      process.env.GATE_PAY_ACCOUNT_AUTHORIZE_ORIGIN?.trim()?.replace(/\/$/, "") ||
      baseConfig.accountAuthorizeOrigin,
    oauthCallbackPort: parseCallbackPort() ?? baseConfig.oauthCallbackPort,

    // 中心化支付
    centralizedPaymentUrl:
      process.env.GATE_PAY_CENTRALIZED_PAYMENT_URL?.trim() ||
      baseConfig.centralizedPaymentUrl,
    paymentClientId:
      process.env.GATE_PAY_CLIENT_ID?.trim() || baseConfig.paymentClientId,

    // 钱包服务
    quickWalletServerUrl:
      process.env.QUICK_WALLET_SERVER_URL?.trim() || baseConfig.quickWalletServerUrl,
    pluginWalletServerUrl:
      process.env.PLUGIN_WALLET_SERVER_URL?.trim() || baseConfig.pluginWalletServerUrl,
    gvBaseUrl:
      process.env.GATE_PAY_GV_BASE_URL?.trim() || baseConfig.gvBaseUrl,

    // 其他配置
    oauthScope: process.env.GATE_PAY_OAUTH_SCOPE?.trim() || baseConfig.oauthScope,
    oauthAuthorizeUserAgent:
      process.env.GATE_PAY_OAUTH_AUTHORIZE_USER_AGENT?.trim() ||
      baseConfig.oauthAuthorizeUserAgent,
  };
}

/**
 * 解析回调端口
 */
function parseCallbackPort(): number | undefined {
  const portStr = process.env.GATE_PAY_OAUTH_CALLBACK_PORT?.trim();
  if (!portStr) return undefined;
  const n = parseInt(portStr, 10);
  return Number.isNaN(n) ? undefined : n;
}

function parsePositiveIntEnv(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const n = Number(value.trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function getMppBaseChainIdPresetByEnv(): number {
  return getEnvironment() === "test" ? 84532 : 8453;
}

/**
 * MPP Base session 的 chainId。
 * 优先级：MPP_BASE_CHAIN_ID、BASE_CHAIN_ID > GATE_PAY_ENV 预设（test→84532，prd→8453）
 */
export function getMppBaseSessionChainId(): number {
  return (
    parsePositiveIntEnv(process.env.MPP_BASE_CHAIN_ID) ??
    parsePositiveIntEnv(process.env.BASE_CHAIN_ID) ??
    getMppBaseChainIdPresetByEnv()
  );
}

// ---------------------------------------------------------------------------
// 火山 / Gate 埋点（DataFinder HTTP）：固定产品维度 + 环境可覆盖项
// 默认值见 tracking-product-defaults.json（脚本 volc-tracking-ping.mjs 同步读取该 JSON）
// ---------------------------------------------------------------------------

/** 埋点侧「与本 MCP 进程绑定」的固定维度；含默认上报 App Key（见 JSON `defaultAppKey`） */
export const TRACKING_PRODUCT_DEFAULTS = trackingProductDefaults;

/**
 * 埋点上报所需配置（host / appId / appKey）及与产品文档对齐的固定维度。
 * - 默认 `appKey` 见 `tracking-product-defaults.json` 的 `defaultAppKey`（gateio 主站），用户无需配置；分站等可用 `VOLC_TRACKING_APP_KEY` 覆盖。
 * - `VOLC_TRACKING_ENABLED` 为 `false` 时关闭上报。
 */
export interface TrackingConfig {
  enabled: boolean;
  reportHost: string;
  appId: number;
  appKey: string;
  gatePayEnv: Environment;
  appName: string;
  appPlatform: string;
  accessMethod: string;
  clientType: string;
  businessModule: string;
  productLine: string;
  eventName: string;
}

export function getTrackingConfig(): TrackingConfig {
  const appKey =
    process.env.VOLC_TRACKING_APP_KEY?.trim() || trackingProductDefaults.defaultAppKey;

  const enabled = process.env.VOLC_TRACKING_ENABLED?.trim().toLowerCase() !== "false";

  const appId =
    parsePositiveIntEnv(process.env.VOLC_TRACKING_APP_ID) ??
    trackingProductDefaults.defaultAppId;

  const reportHost =
    process.env.VOLC_TRACKING_HOST?.trim() || trackingProductDefaults.defaultReportHost;

  return {
    enabled,
    reportHost,
    appId,
    appKey,
    gatePayEnv: getEnvironment(),
    appName: trackingProductDefaults.appName,
    appPlatform: trackingProductDefaults.appPlatform,
    accessMethod: trackingProductDefaults.accessMethod,
    clientType: trackingProductDefaults.clientType,
    businessModule: trackingProductDefaults.businessModule,
    productLine: trackingProductDefaults.productLine,
    eventName: trackingProductDefaults.eventName,
  };
}
