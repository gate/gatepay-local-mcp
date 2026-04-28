/**
 * Centralized tool schemas for all MCP tools
 */

// ============================================================================
// x402_request (INTERNAL - Not exposed in ListTools)
// ============================================================================

/**
 * @internal
 * Legacy tool schema - kept for backward compatibility but not exposed publicly
 */
export const X402_REQUEST_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    url: {
      type: "string",
      description:
        "Full URL of the x402-protected endpoint. Must be included in Skill; do not guess.",
    },
    method: {
      type: "string",
      description: "HTTP method: GET, POST, PUT, or PATCH. Default POST.",
    },
    body: {
      type: "string",
      description: "JSON string request body for POST/PUT/PATCH. Omit for GET.",
    },
    sign_mode: {
      type: "string",
      description:
        "Optional preferred signing mode. Omit to auto-select the highest-priority ready mode. " +
        "If the initial payment fails, ask the user which payment method to use instead of automatically retrying.",
      enum: ["local_private_key", "quick_wallet", "plugin_wallet"],
    },
    wallet_login_provider: {
      type: "string",
      description:
        "When quick_wallet needs login: OAuth provider. google = Google account, gate = Gate account. Defaults to gate.",
      enum: ["google", "gate"],
    },
  },
  required: ["url"],
};

/**
 * @internal
 */
export const X402_REQUEST_DESCRIPTION =
  "[Write] Legacy: one HTTP call with automatic 402 handling; prefer public tools for new flows. " +
  "If payment fails, ask the user before retrying with another sign_mode.";

// ============================================================================
// x402_place_order
// ============================================================================

export const PLACE_ORDER_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    url: {
      type: "string",
      description: "Full URL of the endpoint. Must be a complete http/https URL.",
    },
    method: {
      type: "string",
      description: "HTTP method: GET, POST, PUT, or PATCH. Default POST.",
      enum: ["GET", "POST", "PUT", "PATCH"],
    },
    body: {
      type: "string",
      description: "JSON string request body for POST/PUT/PATCH. Omit for GET.",
    },
  },
  required: ["url"],
};

export const PLACE_ORDER_DESCRIPTION =
  "[HTTP] Fetches or posts to a URL and returns status, headers, body, and paymentType without automatic signing. " +
  "If paymentType is x402 (PAYMENT-REQUIRED header), use x402_sign_payment or create_signature + submit_payment. " +
  "If paymentType is mpp (WWW-Authenticate), use mpp_init_session then mpp_fetch—not this tool for signing.";

// ============================================================================
// x402_sign_payment
// ============================================================================

export const SIGN_PAYMENT_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    url: {
      type: "string",
      description: "Target URL for the payment request",
    },
    method: {
      type: "string",
      description: "HTTP method for the request",
      enum: ["GET", "POST", "PUT", "PATCH"],
    },
    body: {
      type: "string",
      description: "JSON string request body (optional)",
    },
    payment_required_header: {
      type: "string",
      description: "Base64-encoded PAYMENT-REQUIRED header value from a 402 response",
    },
    response_body: {
      type: "string",
      description: "Optional: Response body from 402 response, used for parsing payment requirements if PAYMENT-REQUIRED header is not available",
    },
    sign_mode: {
      type: "string",
      description:
        "Optional preferred signing mode. Omit to auto-select the highest-priority ready mode.",
      enum: ["local_private_key", "quick_wallet", "plugin_wallet"],
    },
    wallet_login_provider: {
      type: "string",
      description:
        "When quick_wallet needs login: google = Google account, gate = Gate account. Defaults to gate.",
      enum: ["google", "gate"],
    },
  },
  required: ["url"],
};

export const SIGN_PAYMENT_DESCRIPTION =
  "[Write] x402 only: parses PAYMENT-REQUIRED (paymentType=x402 from x402_place_order), signs via sign_mode, resubmits the merchant request. " +
  "For paymentType=mpp use mpp_init_session + mpp_fetch. Split flow: create_signature then submit_payment. " +
  "Gate Pay Bearer: gate_pay_auth then submit_payment with sign_mode centralized_payment. " +
  "Needs payment_required_header or response_body. Side effect: may open browser; on failure ask before changing sign_mode.";

// ============================================================================
// mpp_init_session
// ============================================================================

export const MPP_INIT_SESSION_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    max_deposit: {
      type: "string",
      description: "最大押金，人类可读单位（如 \"10\"）。默认 \"1\"；与商户首次 402 交互时会在链上建立/确认托管通道。",
    },
    sign_mode: {
      type: "string",
      description:
        "签名模式：local_private_key（EVM_PRIVATE_KEY）；quick_wallet（托管 MCP，EIP-712 + Base 链上写合约 via dex_wallet_sign_transaction）。",
      enum: ["local_private_key", "quick_wallet", "plugin_wallet"],
      default: "local_private_key",
    },
    wallet_login_provider: {
      type: "string",
      description: "sign_mode 为 quick_wallet 时：设备流登录提供商（google / gate），默认 gate。",
      enum: ["google", "gate"],
    },
    decimals: {
      type: "number",
      description: "代币精度，默认 6。",
    },
  },
  required: [],
};

export const MPP_INIT_SESSION_DESCRIPTION =
  "[Write] 初始化 MPP 会话（链上押金/托管通道）：sign_mode 为 local_private_key 或 quick_wallet（EIP-712 + Base 链上合约）。" +
  "返回 sessionId 与初始化状态；须先于 mpp_fetch。quick_wallet 需快捷钱包 MCP 登录；链上网络由 QUICK_WALLET_MPP_EVM_CHAIN（默认 BASE）与当前 MPP chainId 决定。";

// ============================================================================
// mpp_fetch
// ============================================================================

export const MPP_FETCH_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    url: {
      type: "string",
      description: "目标资源 URL（完整 http/https）。",
    },
    method: {
      type: "string",
      description: "HTTP 方法，默认 POST。",
      enum: ["GET", "POST", "PUT", "PATCH"],
    },
    body: {
      type: "string",
      description: "请求体（JSON 字符串）。",
    },
    headers: {
      type: "string",
      description: "额外请求头，JSON 对象字符串（可选）。",
    },
  },
  required: ["url"],
};

export const MPP_FETCH_DESCRIPTION =
  "[Write] 使用已缓存的 MPP 客户端对商户 URL 发起 HTTP 请求：自动处理 402 (WWW-Authenticate)、生成 credential 并重试。" +
  "首次命中 402 时会在链上建立/确认托管通道。须先 mpp_init_session；HTTP 侧收尾结算用 mpp_close_session。";

// ============================================================================
// mpp_close_session
// ============================================================================

export const MPP_CLOSE_SESSION_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    account_address: {
      type: "string",
      description:
        "可选：要结算并关闭的会话对应 EVM 地址。省略则对当前缓存中的任一活跃会话执行 HTTP 结算与清理。",
    },
  },
  required: [],
};

export const MPP_CLOSE_SESSION_DESCRIPTION =
  "[Write] HTTP 侧直接结算并结束会话：签名 close 凭证，向此前 mpp_fetch 使用过的资源 URL POST，解析 Payment-Receipt（商户计费完成）；随后清理本地 session。" +
  "常规收尾用本工具；链上仅发起关闭意图请用 mpp_request_close，二者职责不同。";

// ============================================================================
// mpp_request_close
// ============================================================================

export const MPP_REQUEST_CLOSE_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    account_address: {
      type: "string",
      description:
        "可选：目标会话的 EVM 地址。省略则对当前缓存中的任一已打开通道的会话发起链上 requestClose。",
    },
    rpc_url: {
      type: "string",
      description:
        "可选：覆盖 JSON-RPC。未填时使用 MPP_BASE_RPC_URL / BASE_RPC_URL，或对 Base 主网/Sepolia 使用内置默认公共节点。",
    },
  },
  required: [],
};

export const MPP_REQUEST_CLOSE_DESCRIPTION =
  "[Write] 仅链上：调用托管合约 requestClose(channelId)，发起关闭通道的链上流程（等待期后配合 mpp_withdraw 取回资金）。" +
  "不调用商户 HTTP、不返回 Payment-Receipt、不清理本地 session；商户侧计费与收据须单独执行 mpp_close_session。";

// ============================================================================
// mpp_withdraw
// ============================================================================

export const MPP_WITHDRAW_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    account_address: {
      type: "string",
      description: "可选：目标会话的 EVM 地址。省略则使用当前缓存中的会话（须能解析 channel）。",
    },
    channel_id: {
      type: "string",
      description:
        "可选：bytes32 通道 id（0x+64hex）。本地仍有 channel 时可省略；若已 mpp_close_session 清空本地状态须显式传入。",
    },
    rpc_url: {
      type: "string",
      description:
        "可选：覆盖 JSON-RPC。未填时使用 MPP_BASE_RPC_URL / BASE_RPC_URL，或对 Base 主网/Sepolia 使用内置默认公共节点。",
    },
  },
  required: [],
};

export const MPP_WITHDRAW_DESCRIPTION =
  "[Write] 链上托管合约 withdraw(channelId)：在 mpp_request_close 成功且经过合约等待期后，从链上取回剩余押金。" +
  "时机由合约校验；过早调用会 revert。签名账户须与 mpp_init_session 一致。";

// ============================================================================
// x402_create_signature
// ============================================================================

export const CREATE_SIGNATURE_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    payment_required_header: {
      type: "string",
      description: "Base64-encoded PAYMENT-REQUIRED header value from a 402 response",
    },
    response_body: {
      type: "string",
      description: "Optional: Response body from 402 response, used if PAYMENT-REQUIRED header is not available",
    },
    sign_mode: {
      type: "string",
      description: "Optional preferred signing mode. Omit to auto-select the highest-priority ready mode.",
      enum: ["local_private_key", "quick_wallet", "plugin_wallet"],
    },
    wallet_login_provider: {
      type: "string",
      description: "When quick_wallet needs login: OAuth provider (google or gate). Defaults to gate.",
      enum: ["google", "gate"],
    },
  },
  required: [],
};

export const CREATE_SIGNATURE_DESCRIPTION =
  "[Write] Builds PAYMENT-SIGNATURE from 402 requirements without resubmitting the merchant HTTP call. " +
  "Then submit_payment with the same url, method, and body. One-shot alternative: x402_sign_payment.";

// ============================================================================
// x402_submit_payment
// ============================================================================

export const SUBMIT_PAYMENT_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    url: {
      type: "string",
      description: "Target URL for the payment request",
    },
    method: {
      type: "string",
      description: "HTTP method for the request. Default POST.",
      enum: ["GET", "POST", "PUT", "PATCH"],
    },
    body: {
      type: "string",
      description: "JSON string request body (optional)",
    },
    payment_signature: {
      type: "string",
      description: "Base64-encoded PAYMENT-SIGNATURE header value from x402_create_signature",
    },
    sign_mode: {
      type: "string",
      description:
        "If centralized_payment: attach Gate Pay Bearer access_token (OAuth via gate_pay_auth if needed). Otherwise omit.",
      enum: ["centralized_payment"],
    },
  },
  required: ["url", "payment_signature"],
};

export const SUBMIT_PAYMENT_DESCRIPTION =
  "[Write] Retries the original HTTP call with payment_signature from create_signature. " +
  "sign_mode centralized_payment adds Gate Pay Bearer; run gate_pay_auth first if token missing. Returns merchant response.";

// ============================================================================
// x402_gate_pay_auth
// ============================================================================

export const GATE_PAY_AUTH_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  required: [] as const,
};

export const GATE_PAY_AUTH_DESCRIPTION =
  "[Write] Gate Pay OAuth (browser + localhost callback + token exchange); caches access_token for submit_payment with sign_mode centralized_payment. " +
  "Not quick_wallet MCP login—use quick_wallet_auth. Side effect: opens browser; response has masked token and uid.";

// ============================================================================
// x402_quick_wallet_auth
// ============================================================================

export const QUICK_WALLET_AUTH_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet_login_provider: {
      type: "string",
      description:
        "Device-flow OAuth provider when MCP token is missing or expired. google = Google account, gate = Gate account. Defaults to gate.",
      enum: ["google", "gate"],
    },
  },
  required: [] as const,
};

export const QUICK_WALLET_AUTH_DESCRIPTION =
  "[Write] Device-flow login for quick_wallet when MCP token is missing or expired; returns readiness and addresses. " +
  "Not for Gate Pay centralized_payment—use gate_pay_auth. May open browser; provider switch may need MCP restart.";

// ============================================================================
// x402_centralized_payment
// ============================================================================

export const CENTRALIZED_PAYMENT_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    payment_required_header: {
      type: "string",
      description: "Base64 PAYMENT-REQUIRED from the 402 response.",
    },
    resource_url: {
      type: "string",
      description:
        "Full merchant URL after Gate Pay succeeds (same rules as x402_place_order url). Sends X-GatePay-Centralized-Merchant-No = merchantTradeNo.",
    },
    method: {
      type: "string",
      description: "HTTP method: GET, POST, PUT, or PATCH. Default POST.",
      enum: ["GET", "POST", "PUT", "PATCH"],
    },
    body: {
      type: "string",
      description: "JSON string request body for POST/PUT/PATCH. Omit for GET.",
    },
  },
  required: ["payment_required_header", "resource_url"],
};

export const CENTRALIZED_PAYMENT_DESCRIPTION =
  "[Write] Parses PAYMENT-REQUIRED, charges Gate Pay centralized API; OAuth via gate_pay_auth if needed. " +
  "Then calls resource_url (required, full http/https like x402_place_order) with X-GatePay-Centralized-Merchant-No after pay. " +
  "Wallet-signed x402 on arbitrary HTTP → x402_sign_payment or create_signature + submit_payment.";

// ============================================================================
// Public Tools Registry
// ============================================================================

export function getPublicTools() {
  return [
    {
      name: "x402_place_order",
      description: PLACE_ORDER_DESCRIPTION,
      inputSchema: PLACE_ORDER_INPUT_SCHEMA,
    },
    {
      name: "x402_sign_payment",
      description: SIGN_PAYMENT_DESCRIPTION,
      inputSchema: SIGN_PAYMENT_INPUT_SCHEMA,
    },
    {
      name: "mpp_init_session",
      description: MPP_INIT_SESSION_DESCRIPTION,
      inputSchema: MPP_INIT_SESSION_INPUT_SCHEMA,
    },
    {
      name: "mpp_fetch",
      description: MPP_FETCH_DESCRIPTION,
      inputSchema: MPP_FETCH_INPUT_SCHEMA,
    },
    {
      name: "mpp_close_session",
      description: MPP_CLOSE_SESSION_DESCRIPTION,
      inputSchema: MPP_CLOSE_SESSION_INPUT_SCHEMA,
    },
    {
      name: "mpp_request_close",
      description: MPP_REQUEST_CLOSE_DESCRIPTION,
      inputSchema: MPP_REQUEST_CLOSE_INPUT_SCHEMA,
    },
    {
      name: "mpp_withdraw",
      description: MPP_WITHDRAW_DESCRIPTION,
      inputSchema: MPP_WITHDRAW_INPUT_SCHEMA,
    },
    {
      name: "x402_create_signature",
      description: CREATE_SIGNATURE_DESCRIPTION,
      inputSchema: CREATE_SIGNATURE_INPUT_SCHEMA,
    },
    {
      name: "x402_submit_payment",
      description: SUBMIT_PAYMENT_DESCRIPTION,
      inputSchema: SUBMIT_PAYMENT_INPUT_SCHEMA,
    },
    {
      name: "x402_gate_pay_auth",
      description: GATE_PAY_AUTH_DESCRIPTION,
      inputSchema: GATE_PAY_AUTH_INPUT_SCHEMA,
    },
    {
      name: "x402_quick_wallet_auth",
      description: QUICK_WALLET_AUTH_DESCRIPTION,
      inputSchema: QUICK_WALLET_AUTH_INPUT_SCHEMA,
    },
    {
      name: "x402_centralized_payment",
      description: CENTRALIZED_PAYMENT_DESCRIPTION,
      inputSchema: CENTRALIZED_PAYMENT_INPUT_SCHEMA,
    },
  ];
}
