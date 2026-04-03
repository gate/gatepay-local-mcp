# gatepay-local-mcp

`gatepay-local-mcp` is a local `stdio` MCP server for calling **X402 payment-protected** HTTP endpoints. It provides a suite of MCP tools to handle the complete X402 payment workflow, from placing orders to signing payments and submitting them to merchants.

## Features

- **7 MCP Tools** covering order placement, signature flows, quick wallet / Gate Pay auth, and centralized payment retries
- Built-in X402 payment flow under `src/x402/`
- **Multiple signing modes**: `local_private_key`, `quick_wallet`, `plugin_wallet`
- **Multi-chain support**: EVM (Ethereum, Base, Polygon, etc.) and Solana
- Works with Cursor, Claude Desktop, and other MCP clients
- Auto-selects the first ready signing mode if not specified
- Gate Pay centralized payment (`sign_mode: centralized_payment`) and `x402_centralized_payment` helper for merchant-side settlement

## Available Tools

### 1. `x402_place_order`

Send an HTTP request and return complete response information including headers, body, and the original request details.

**Use case**: Initial request to a payment-protected endpoint that returns `402 Payment Required`.

**Parameters**:
```typescript
{
  url: string;              // Target URL (required)
  method?: string;          // HTTP method: GET, POST, PUT, PATCH (default: POST)
  body?: string;            // JSON string request body (optional)
  sign_mode?: string;       // Signing mode: local_private_key, quick_wallet, plugin_wallet (auto-select if omitted)
  wallet_login_provider?: string; // OAuth provider: google, gate (default: gate)
}
```

**Returns**: Complete response with status code, headers (including `PAYMENT-REQUIRED`), body, and original request details.

---

### 2. `x402_sign_payment`

Parse X402 payment requirements, create a signed payment authorization, and submit the payment to complete a 402-protected request (all-in-one workflow).

**Use case**: Single-step payment flow - parse, sign, and submit in one call.

**Parameters**:
```typescript
{
  url: string;                    // Target URL (required)
  method?: string;                // HTTP method (default: POST)
  body?: string;                  // JSON request body (optional)
  payment_required_header?: string; // Base64-encoded PAYMENT-REQUIRED header
  response_body?: string;         // Response body from 402 response (alternative to header)
  sign_mode?: string;             // Signing mode (auto-select if omitted)
  wallet_login_provider?: string; // OAuth provider (default: gate)
}
```

**Returns**: Final response from the merchant after successful payment.

---

### 3. `x402_create_signature`

Parse X402 payment requirements and create a signed payment authorization.

**Use case**: Two-step workflow - create signature first, then submit separately.

**Parameters**:
```typescript
{
  payment_required_header?: string; // Base64-encoded PAYMENT-REQUIRED header
  response_body?: string;         // Response body from 402 response (alternative to header)
  sign_mode?: string;             // Signing mode (auto-select if omitted)
  wallet_login_provider?: string; // OAuth provider (default: gate)
}
```

**Returns**: Payment payload and base64-encoded `PAYMENT-SIGNATURE` header value.

---

### 4. `x402_submit_payment`

Submit a signed payment to complete a 402-protected request.

**Use case**: Second step of two-step workflow - submit the signature created by `x402_create_signature`.

**Parameters**:
```typescript
{
  url: string;              // Target URL (required)
  method?: string;          // HTTP method (default: POST)
  body?: string;            // JSON request body (optional)
  payment_signature: string; // Base64-encoded PAYMENT-SIGNATURE from x402_create_signature (required)
}
```

**Returns**: Final response from the merchant.

---

### 5. `x402_quick_wallet_auth`

Pre-authorize with Quick Wallet using device-flow OAuth (Google or Gate account).

**Use case**: When using `sign_mode: quick_wallet`, run this first to complete the device-flow login before making payment requests.

**Parameters**:
```typescript
{
  wallet_login_provider?: string; // OAuth provider: google, gate (default: gate)
}
```

**Returns**: Authorization status and wallet addresses (EVM and Solana).

---

### 6. `x402_gate_pay_auth`

Complete the Gate Pay OAuth device flow (browser authorize URL + localhost callback + remote token exchange) and cache the resulting access token/UID for centralized payments.

**Use case**: Required before calling `x402_submit_payment` with `sign_mode: centralized_payment` or when preparing to use `x402_centralized_payment`.

**Parameters**: _None_

**Returns**: Current authorization status with masked Gate Pay UID and access token indicators.

---

### 7. `x402_centralized_payment`

Parse the Base64-encoded `PAYMENT-REQUIRED` header and complete the Gate Pay centralized payment flow without submitting a `PAYMENT-SIGNATURE`.

**Use case**: When a merchant expects Gate Pay centralized settlement (e.g., OTA or off-chain marketplace) and you prefer an all-in-one helper instead of crafting `PAYMENT-SIGNATURE`.

**Parameters**:
```typescript
{
  payment_required_header: string; // Base64-encoded PAYMENT-REQUIRED header (required)
}
```

**Returns**: Payment confirmation including `prepayId`, `merchantTradeNo`, currency, amount, and the raw API response.

---

## Workflow Examples

### Single-Step Workflow (Recommended)

```
1. x402_place_order         → Get payment requirements
2. x402_sign_payment        → Sign and submit payment (all-in-one)
```

### Two-Step Workflow (Advanced)

```
1. x402_place_order         → Get payment requirements
2. x402_create_signature    → Create signed payment
3. x402_submit_payment      → Submit signed payment
```

### Quick Wallet Pre-Auth

```
1. x402_quick_wallet_auth   → Authorize with Google/Gate
2. x402_place_order         → Get payment requirements
3. x402_sign_payment        → Sign and submit (using quick_wallet)
```

### Centralized Payment (Gate Pay)

```
1. x402_gate_pay_auth       → Browser OAuth + token exchange (repeat when token expires)
2. x402_place_order         → Receive PAYMENT-REQUIRED header that encodes Gate Pay order info
3. x402_submit_payment      → Use payment_signature + sign_mode: "centralized_payment" to call the merchant with Authorization: Bearer
   或
3. x402_centralized_payment → Pass payment_required_header directly for all-in-one centralized settlement
```

## Signing Modes

The server supports three automatic signing modes plus a dedicated Gate Pay centralized mode:

| `sign_mode`             | Status                                        | Networks / Scope | Description                                                                                     |
| ----------------------- | --------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| `local_private_key`     | Ready when `EVM_PRIVATE_KEY` / `SVM_PRIVATE_KEY` set | EVM, Solana      | Signs locally with your private keys (no external dependencies)                                 |
| `quick_wallet`          | Ready after OAuth login                       | EVM, Solana      | Custodial MCP wallet with device-flow login (Google/Gate account)                               |
| `plugin_wallet`         | Ready when `PLUGIN_WALLET_TOKEN` set          | EVM, Solana      | Browser extension wallet (e.g., Gate Wallet) via MCP bridge                                     |
| `centralized_payment`   | Ready after `x402_gate_pay_auth` completes    | Gate Pay         | Adds `Authorization: Bearer <Gate Pay access_token>` when calling `x402_submit_payment` or use `x402_centralized_payment` |

**Priority Order** (auto-selection applies to the first three rows when `sign_mode` is omitted):
1. `plugin_wallet` (priority: 30) - if token configured
2. `quick_wallet` (priority: 20) - if MCP endpoint configured  
3. `local_private_key` (priority: 10) - if private keys configured

The server automatically selects the highest-priority ready mode.

### Network Support

- **EVM Networks**: Ethereum, Base, Polygon, Arbitrum One, GateChain, GateLayer
- **Solana Networks**: Solana Mainnet, Solana Devnet

## Quick Start

### 1. Local Private Key Mode (EVM + Solana)

This is the simplest setup for local signing with your own private keys:

```json
{
  "mcpServers": {
    "gatepay-mcp": {
      "command": "npx",
      "args": ["-y", "gatepay-local-mcp"],
      "env": {
        "EVM_PRIVATE_KEY": "your-evm-private-key-hex-with-or-without-0x-prefix",
        "SVM_PRIVATE_KEY": "your-solana-private-key-base58-optional"
      }
    }
  }
}
```

- Set `EVM_PRIVATE_KEY` for EVM network payments (Ethereum, Base, Polygon, etc.)
- Set `SVM_PRIVATE_KEY` for Solana network payments (optional)
- Put this into your MCP config such as `~/.cursor/mcp.json`, then restart or reload MCP

### 2. Quick Wallet Mode (Custodial)

Remote wallet signing with device-flow OAuth (Google or Gate account):

```json
{
  "mcpServers": {
    "gatepay-mcp": {
      "command": "npx",
      "args": ["-y", "gatepay-local-mcp"],
      "env": {
        "QUICK_WALLET_MCP_URL": "https://walletmcp.gate.com/mcp",
        "QUICK_WALLET_API_KEY": "your-api-key-optional"
      }
    }
  }
}
```

- First payment will trigger device-flow login (opens browser)
- Token is persisted at `~/.gate-pay/auth.json`
- Use `x402_quick_wallet_auth` tool to pre-authorize

### 3. Plugin Wallet Mode (Browser Extension)

Sign with browser extension wallet (e.g., Gate Wallet):

```json
{
  "mcpServers": {
    "gatepay-mcp": {
      "command": "npx",
      "args": ["-y", "gatepay-local-mcp"],
      "env": {
        "PLUGIN_WALLET_TOKEN": "your-plugin-wallet-mcp-token"
      }
    }
  }
}
```

- Get the token from your browser extension wallet
- Requires the wallet extension to be installed and running
- User confirms transactions in the browser extension

### 4. Gate Pay Centralized Payment (Browser OAuth)

Use this when merchants expect Gate Pay centralized settlement instead of user-owned signatures.

```json
{
  "mcpServers": {
    "gatepay-mcp": {
      "command": "npx",
      "args": ["-y", "gatepay-local-mcp"],
      "env": {
        "GATE_PAY_OAUTH_CLIENT_ID": "your-gate-pay-client-id",
        "GATE_PAY_OAUTH_CLIENT_SECRET": "your-gate-pay-client-secret",
        "GATE_PAY_OAUTH_BACKEND_ORIGIN": "https://www.gate.com/apiw/v2/mcp/oauth",
        "GATE_PAY_ACCOUNT_AUTHORIZE_ORIGIN": "https://gate.com",
        "GATE_PAY_OAUTH_CALLBACK_PORT": "18473",
        "GATE_PAY_CENTRALIZED_PAYMENT_URL": "https://api.gateio.ws/api/v4/pay/ai/order/pay",
        "GATE_PAY_CLIENT_ID": "your-gate-pay-client-id"
      }
    }
  }
}
```

- Run `x402_gate_pay_auth` once per token lifecycle; it opens the Gate consent page and exchanges the code automatically.
- Use `x402_submit_payment` with `sign_mode: "centralized_payment"` after you create a `PAYMENT-SIGNATURE`, or
- Call `x402_centralized_payment` directly with the Base64 `PAYMENT-REQUIRED` header when you prefer a single-step helper.

### Cursor / Claude Desktop with plugin wallet

If you want to use a browser extension wallet (like Gate Wallet) for signing, configure the plugin wallet mode:

```json
{
  "mcpServers": {
    "gatepay-mcp": {
      "command": "npx",
      "args": ["-y", "gatepay-local-mcp"],
      "env": {
        "PLUGIN_WALLET_SERVER_URL": "https://your-plugin-wallet-server.com",
        "PLUGIN_WALLET_TOKEN": "your-token-from-browser-wallet"
      }
    }
  }
}
```

Before using plugin wallet mode:
1. Install a compatible browser extension wallet (e.g., [Gate Wallet](https://www.gate.io/web3))
2. Open the wallet extension in your browser and obtain the connection token
3. Configure `PLUGIN_WALLET_SERVER_URL` and `PLUGIN_WALLET_TOKEN` in your MCP config
4. The wallet extension must be active in your browser when making x402 requests

## Environment Variables

The server loads `.env` from the repository or package root at startup.

### Signing Mode Configuration

| Variable                  | Mode                | Description                                                                 |
| ------------------------- | ------------------- | --------------------------------------------------------------------------- |
| `EVM_PRIVATE_KEY`         | `local_private_key` | Local EVM private key; hex with or without `0x` prefix                      |
| `SVM_PRIVATE_KEY`      | `local_private_key` | Local Solana private key; base58 encoded (optional)                         |
| `QUICK_WALLET_MCP_URL`    | `quick_wallet`      | MCP wallet endpoint URL (default: `https://walletmcp.gate.com/mcp`)         |
| `QUICK_WALLET_API_KEY`    | `quick_wallet`      | API key for MCP wallet service (optional)                                   |
| `PLUGIN_WALLET_TOKEN`     | `plugin_wallet`     | MCP token from browser extension wallet                                     |

### Gate Pay Centralized Payment

| Variable                          | Description                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `GATE_PAY_OAUTH_CLIENT_ID`        | Gate Pay OAuth client id used for device authorization and token exchange                     |
| `GATE_PAY_OAUTH_CLIENT_SECRET`    | Client secret required when exchanging the authorization code for an access token             |
| `GATE_PAY_OAUTH_BACKEND_ORIGIN`   | Base URL for the OAuth backend that hosts the token/refresh endpoints                         |
| `GATE_PAY_ACCOUNT_AUTHORIZE_ORIGIN` | Domain that serves the Gate Pay authorization page (opens in the browser)                     |
| `GATE_PAY_OAUTH_CALLBACK_PORT`    | Local port used to receive the OAuth redirect (set to `0` for a random port if needed)        |
| `GATE_PAY_OAUTH_SCOPE`            | OAuth scope requested during device/login flow                                                |
| `GATE_PAY_OAUTH_AUTHORIZE_USER_AGENT` | Custom User-Agent for the authorization preflight (defaults to `gateio/web`)                 |
| `GATE_PAY_CENTRALIZED_PAYMENT_URL`| HTTPS endpoint for submitting centralized payments via Gate Pay                               |
| `GATE_PAY_CLIENT_ID`              | Merchant client id embedded in centralized payment payloads                                   |
| `GATE_PAY_OAUTH_TOKEN_BASE_URL`   | Optional: origin used to derive default token and refresh endpoints                           |
| `GATE_PAY_OAUTH_TOKEN_URL`        | Optional: explicit token endpoint path override                                               |
| `GATE_PAY_OAUTH_REFRESH_URL`      | Optional: explicit refresh endpoint path override                                             |

### Test and Script Variables

| Variable                      | Used By                         | Default                 | Description                                     |
| ----------------------------- | ------------------------------- | ----------------------- | ----------------------------------------------- |
| `RESOURCE_SERVER_URL`         | `test/privateKey.test.ts`       | `http://localhost:8080` | Base URL for the local private-key flow test    |
| `ENDPOINT_PATH`               | `test/privateKey.test.ts`       | `/flight/order`         | Endpoint path appended to `RESOURCE_SERVER_URL` |
| `GATEPAY_MCP_TEST_TIMEOUT_MS` | `test/mcp-x402-request-tool.ts` | `180000`                | Timeout for the MCP tool integration test       |

## Usage Examples

### Example 1: Single-Step Payment (Recommended)

```json
// Step 1: Place order to get payment requirements
{
  "tool": "x402_place_order",
  "arguments": {
    "url": "https://api.example.com/order",
    "method": "POST",
    "body": "{\"flightId\":\"FL001\",\"uid\":\"100\"}"
  }
}

// Step 2: If 402 response, sign and submit payment
{
  "tool": "x402_sign_payment",
  "arguments": {
    "url": "https://api.example.com/order",
    "method": "POST",
    "body": "{\"flightId\":\"FL001\",\"uid\":\"100\"}",
    "payment_required_header": "<base64-from-place_order>",
    "sign_mode": "quick_wallet"
  }
}
```

### Example 2: Two-Step Payment (Advanced)

```json
// Create signature first
{
  "tool": "x402_create_signature",
  "arguments": {
    "payment_required_header": "<base64>",
    "sign_mode": "local_private_key"
  }
}

// Then submit separately
{
  "tool": "x402_submit_payment",
  "arguments": {
    "url": "https://api.example.com/order",
    "payment_signature": "<base64-from-create_signature>"
  }
}
```

### Example 3: Quick Wallet with Pre-Auth

```json
// Pre-authorize (opens browser for OAuth)
{
  "tool": "x402_quick_wallet_auth",
  "arguments": {
    "wallet_login_provider": "gate"
  }
}
```

### Example 4: Gate Pay Centralized Payment

```json
// Step 1: Run OAuth (opens Gate authorize page)
{ "tool": "x402_gate_pay_auth", "arguments": {} }

// Step 2a: Use centralized helper
{
  "tool": "x402_centralized_payment",
  "arguments": {
    "payment_required_header": "<base64-from-place_order>"
  }
}

// Step 2b: Or submit with sign_mode: centralized_payment
{
  "tool": "x402_submit_payment",
  "arguments": {
    "url": "https://api.example.com/order",
    "method": "POST",
    "payment_signature": "<base64-from-create_signature>",
    "sign_mode": "centralized_payment"
  }
}
```

## Agent Skill

- `skills/SKILL.md` contains the `gatepay-x402` skill manifest and prompts so MCP-aware IDEs (Cursor, Claude Desktop, Codex CLI, etc.) know how to call every tool exposed by this server.
- `skills/gatepay-x402.md` (mirrored at `docs/gatepay-x402.md`) is a natural-language installation guide. Share that link with your AI host for a “one-click” experience: the host can follow the steps to download `gatepay-local-mcp`, register it in `mcpServers`, and copy the `gatepay-x402` skill into its skills directory automatically.

Tool names and arguments always match each tool’s MCP `inputSchema` on the server you connect to; check your client’s tool list if you ship a trimmed build.

## Development

```bash
# install dependencies
npm install

# build TypeScript output into dist/
npm run build

# start the MCP server from source
npm run dev

# run the built entrypoint through the package start script
npm start

# run unit tests
npm run test:unit

# run the local private key flow test
npm run test:privateKey

# MCP / x402 集成探针（需 build 后 dist）
npm run test:split-tools
```

### Integration test notes

`npm run test:split-tools` 会启动 `dist/src/index.js` 并走拆分后的 x402 工具链；需要已构建产物、网络与钱包配置。`npm run test:quickWallet` 等脚本用于各签名模式的本地联调。

```bash
npm run build
npm run test:split-tools
```

Quick Wallet 等设备流登录脚本若需交互，请直接在终端运行对应 `npm run test:*`。可将 `GATEPAY_MCP_TEST_TIMEOUT_MS` 调大以应对慢网络。

## License

MIT
