/**
 * 环境配置管理模块
 * 支持通过 GATE_PAY_ENV 环境变量在 test 和 prd 环境间切换
 */

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
