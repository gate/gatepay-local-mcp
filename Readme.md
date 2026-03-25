# gatepay-local-mcp

`gatepay-local-mcp` is a local `stdio` MCP server for calling **X402 payment-protected** HTTP endpoints. It provides a suite of MCP tools to handle the complete X402 payment workflow, from placing orders to signing payments and submitting them to merchants.

## Features

- **5 MCP Tools** for flexible X402 payment workflows
- Built-in X402 payment flow under `src/x402/`
- **Multiple signing modes**: `local_private_key`, `quick_wallet`, `plugin_wallet`
- **Multi-chain support**: EVM (Ethereum, Base, Polygon, etc.) and Solana
- Works with Cursor, Claude Desktop, and other MCP clients
- Auto-selects the first ready signing mode if not specified

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

## Signing Modes

The server supports three signing modes with automatic selection:

| `sign_mode`         | Status                                        | Networks    | Description                                                              |
| ------------------- | --------------------------------------------- | ----------- | ------------------------------------------------------------------------ |
| `local_private_key` | Ready when `EVM_PRIVATE_KEY` / `SVM_PRIVATE_KEY` set | EVM, Solana | Signs locally with your private keys (no external dependencies)          |
| `quick_wallet`      | Ready after OAuth login                       | EVM, Solana | Custodial MCP wallet with device-flow login (Google/Gate account)        |
| `plugin_wallet`     | Ready when `PLUGIN_WALLET_TOKEN` set          | EVM, Solana | Browser extension wallet (e.g., Gate Wallet) via MCP bridge              |

**Priority Order** (when `sign_mode` is omitted):
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

### Test and Script Variables

| Variable                      | Used By                         | Default                 | Description                                     |
| ----------------------------- | ------------------------------- | ----------------------- | ----------------------------------------------- |
| `RESOURCE_SERVER_URL`         | `test/privateKey.ts`            | `http://localhost:8080` | Base URL for the local private-key flow test    |
| `ENDPOINT_PATH`               | `test/privateKey.ts`            | `/flight/order`         | Endpoint path appended to `RESOURCE_SERVER_URL` |
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

## Agent Skill


For AI agents that orchestrate x402 payments, wallet setup, and merchant discovery, this repository ships an **[Agent Skill](gatepay-local-mcp/skills/SKILL.md at master · gate/gatepay-local-mcp)** at [`skills/SKILL.md`]. Install it in your host’s skills directory or point auto-update at the raw file on your default branch. **Tool names and arguments always follow each tool’s MCP `inputSchema`** on the server you connected; the skill may describe flows that apply across builds, while this package’s exposed tools depend on the version you run (e.g. the minimal npm build exposes `x402_request` only—see the tool list in your client).

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

# run the MCP tool integration test
npm run test:mcp-tool
```

### Integration test notes

`npm run test:mcp-tool` starts `dist/src/index.js` and calls `x402_request` against the configured remote wallet flow. The test requires proper wallet credentials to be configured.

```bash
npm run build
npm run test:mcp-tool
```

If you already logged in before, the saved token in `~/.gate-pay/auth.json` will be reused. Otherwise the quick wallet flow may require interactive device login. You can increase the timeout with `GATEPAY_MCP_TEST_TIMEOUT_MS`.

## License

MIT
