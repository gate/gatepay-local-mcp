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
  "Execute a single HTTP request with automatic x402 payment on 402. Use ONLY for endpoints that require payment (402). " +
  "Set sign_mode to choose a signing mode, or omit it to auto-select the highest-priority ready mode. " +
  "IMPORTANT: If a payment fails, do NOT automatically retry with a different sign_mode. Instead, ask the user which payment method they would like to try.";

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
  "Send an HTTP request and return complete response information including headers, body, and the original request details. " +
  "Returns status code, all response headers (including PAYMENT-REQUIRED if present), response body, and the original request parameters. " +
  "Use this for any HTTP request where you need full response details.";

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
  "Parse X402 payment requirements from PAYMENT-REQUIRED header or response body, create a signed payment authorization, " +
  "and submit the payment to complete a 402-protected request. " +
  "Supports signing modes: local_private_key (local EVM wallet), quick_wallet (custodial MCP wallet), and plugin_wallet (browser extension wallet). " +
  "For centralized payment (中心化支付), obtain Gate Pay access_token via x402_gate_pay_auth and use x402_submit_payment with sign_mode centralized_payment — no MCP calls for Gate Pay auth. " +
  "Provide either payment_required_header or response_body containing X402 payment requirements.";

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
  "Parse X402 payment requirements and create a signed payment authorization. " +
  "Returns the complete payment payload including signature and the base64-encoded " +
  "PAYMENT-SIGNATURE header value. Supports signing modes: local_private_key, " +
  "quick_wallet, and plugin_wallet. The output can be used with x402_submit_payment " +
  "to complete the payment request.";

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
        "When set to centralized_payment (中心化支付), completes Gate Pay OAuth (browser + localhost callback + remote token) if needed and sends Authorization: Bearer <Gate Pay access_token> with the request. Other modes omit this header.",
      enum: ["centralized_payment"],
    },
  },
  required: ["url", "payment_signature"],
};

export const SUBMIT_PAYMENT_DESCRIPTION =
  "Submit a signed payment to complete a 402-protected request. Takes the " +
  "payment_signature from x402_create_signature and sends it to the merchant " +
  "along with the original request. " +
  "When sign_mode is centralized_payment, runs Gate Pay OAuth (local callback + remote token exchange) if needed, same as x402_gate_pay_auth, no MCP, and attaches Authorization: Bearer <Gate Pay access_token>. " +
  "Returns the final response from the merchant.";

// ============================================================================
// x402_gate_pay_auth
// ============================================================================

export const GATE_PAY_AUTH_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  required: [] as const,
};

export const GATE_PAY_AUTH_DESCRIPTION =
  "When the user chooses centralized_payment (中心化支付), run this tool to complete Gate Pay OAuth: browser opens Gate authorize URL, redirect hits localhost callback, then the client exchanges the code for access_token via the remote OAuth backend (GATE_PAY_OAUTH_TOKEN_BASE_URL, etc.). " +
  "Stores access_token in-process for Authorization: Bearer on x402_submit_payment when sign_mode is centralized_payment. " +
  "Wallet MCP login (x402_quick_wallet_auth) is separate and not used for Gate Pay.";

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
  "When the user selects sign_mode quick_wallet, run this tool first to perform the same device-flow login/authorization as the quick_wallet signing path. " +
  "If the in-process MCP token is already valid, returns ready status and wallet addresses; otherwise opens the browser flow (Gate by default, or Google if wallet_login_provider is google). " +
  "After a fresh login succeeds, the user may need to confirm before continuing to payment. " +
  "To switch authorization provider (e.g. Gate vs Google), restart the MCP server; the in-process wallet client keeps the current session until restart.";

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
  ];
}
