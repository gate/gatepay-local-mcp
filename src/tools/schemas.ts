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
  "[HTTP] Fetches or posts to a URL and returns status, headers, and body without automatic 402 handling. " +
  "For 402 paywalls use sign_payment, or create_signature then submit_payment—not this tool.";

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
  "[Write] Parses 402 requirements, signs via sign_mode, and resubmits the merchant request. " +
  "Split flow: create_signature then submit_payment. Gate Pay Bearer: gate_pay_auth then submit_payment with sign_mode centralized_payment. " +
  "Needs payment_required_header or response_body. Side effect: may open browser; on failure ask before changing sign_mode.";

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
  "Then submit_payment with the same url, method, and body. One-shot alternative: sign_payment.";

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
      description: "Base64-encoded PAYMENT-REQUIRED header value containing payment information",
    },
  },
  required: ["payment_required_header"],
};

export const CENTRALIZED_PAYMENT_DESCRIPTION =
  "[Write] Gate Pay centralized checkout from PAYMENT-REQUIRED; OAuth auto if needed. " +
  "For wallet-signed x402 on merchant HTTP use sign_payment or create_signature + submit_payment.";

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
