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
      description:
        'Maximum deposit as a human-readable amount (e.g. "10"). Default "1"; first 402 with the merchant establishes/confirms the on-chain escrow channel.',
    },
    sign_mode: {
      type: "string",
      description:
        "Optional. If set, only this mode is used: local_private_key, quick_wallet, or plugin_wallet. " +
        "If omitted, auto order: use local_private_key when EVM_PRIVATE_KEY/PRIVATE_KEY is set; " +
        "else try quick_wallet, then plugin_wallet. Response includes loadStrategy and loadAttempts.",
      enum: ["local_private_key", "quick_wallet", "plugin_wallet"],
    },
    wallet_login_provider: {
      type: "string",
      description:
        "When quick_wallet is used (explicit or auto): device-flow OAuth provider (google / gate). Default gate.",
      enum: ["google", "gate"],
    },
    decimals: {
      type: "number",
      description: "Token decimals. Default 6.",
    },
  },
  required: [],
};

export const MPP_INIT_SESSION_DESCRIPTION =
  "[Write] Initialize an MPP session (on-chain deposit / escrow channel). " +
  "If sign_mode is omitted, auto-select: local_private_key when EVM_PRIVATE_KEY is set, else quick_wallet, else plugin_wallet; response loadAttempts explains the outcome. " +
  "If sign_mode is set, only that mode is loaded. " +
  "Returns sessionId, signMode, loadStrategy, loadAttempts; call before mpp_fetch. " +
  "quick_wallet: Quick Wallet MCP + QUICK_WALLET_MPP_EVM_CHAIN (default BASE). plugin_wallet: browser extension MCP.";

// ============================================================================
// mpp_fetch
// ============================================================================

export const MPP_FETCH_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    url: {
      type: "string",
      description: "Target resource URL (full http/https).",
    },
    method: {
      type: "string",
      description: "HTTP method. Default POST.",
      enum: ["GET", "POST", "PUT", "PATCH"],
    },
    body: {
      type: "string",
      description: "Request body as a JSON string.",
    },
    headers: {
      type: "string",
      description: "Extra headers as a JSON object string (optional).",
    },
  },
  required: ["url"],
};

export const MPP_FETCH_DESCRIPTION =
  "[Write] HTTP request to a merchant URL using the cached MPP client: handles 402 (WWW-Authenticate), builds credential, retries. " +
  "First 402 establishes/confirms the on-chain escrow channel. Requires mpp_init_session first; use mpp_close_session for HTTP settlement.";

// ============================================================================
// mpp_close_session
// ============================================================================

export const MPP_CLOSE_SESSION_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    account_address: {
      type: "string",
      description:
        "Optional EVM address for the session to settle and close. If omitted, settles and clears one active cached session.",
    },
  },
  required: [],
};

export const MPP_CLOSE_SESSION_DESCRIPTION =
  "[Write] HTTP-side settlement and session teardown: sign close credential, POST to the resource URL last used by mpp_fetch, parse Payment-Receipt (merchant billing complete); then clear local session. " +
  "Use for normal cleanup; mpp_request_close is only on-chain close intent—the responsibilities differ.";

// ============================================================================
// mpp_request_close
// ============================================================================

export const MPP_REQUEST_CLOSE_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    account_address: {
      type: "string",
      description:
        "Optional EVM address for the session. If omitted, sends on-chain requestClose for one cached session that has an open channel.",
    },
    rpc_url: {
      type: "string",
      description:
        "Optional JSON-RPC URL override. If omitted, uses MPP_BASE_RPC_URL / BASE_RPC_URL or built-in public defaults for Base mainnet/Sepolia.",
    },
  },
  required: [],
};

export const MPP_REQUEST_CLOSE_DESCRIPTION =
  "[Write] On-chain only: call escrow contract requestClose(channelId) to start on-chain channel closure (after the wait period, use mpp_withdraw to recover funds). " +
  "Does not call merchant HTTP, does not return Payment-Receipt, does not clear local session; run mpp_close_session separately for merchant billing and receipt.";

// ============================================================================
// mpp_withdraw
// ============================================================================

export const MPP_WITHDRAW_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    account_address: {
      type: "string",
      description:
        "Optional EVM address. If omitted, uses a cached session (must resolve channel).",
    },
    channel_id: {
      type: "string",
      description:
        "Optional bytes32 channel id (0x + 64 hex). Omit when channel is still in local cache; pass explicitly if mpp_close_session cleared local state.",
    },
    rpc_url: {
      type: "string",
      description:
        "Optional JSON-RPC URL override. If omitted, uses MPP_BASE_RPC_URL / BASE_RPC_URL or built-in public defaults for Base mainnet/Sepolia.",
    },
  },
  required: [],
};

export const MPP_WITHDRAW_DESCRIPTION =
  "[Write] On-chain escrow withdraw(channelId): after mpp_request_close succeeds and the contract wait period passes, withdraw remaining deposit on-chain. " +
  "Timing is enforced by the contract; too early reverts. Signing account must match mpp_init_session.";

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
