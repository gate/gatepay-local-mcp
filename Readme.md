# gatepay-local-mcp

`gatepay-local-mcp` is a local `stdio` MCP server for calling **x402 payment-protected** HTTP endpoints. It exposes a single MCP tool, `x402_request`. When the upstream service returns `402 Payment Required`, the server parses the payment requirements, prepares the payment payload, signs it with the selected signer, and retries the request automatically.

## Features

- One MCP tool: `x402_request`
- Built-in x402 payment flow under `src/x402-standalone/`
- Multiple signing modes via `sign_mode`
- Works with Cursor, Claude Desktop, and other MCP clients
- Supports auto-selecting the first ready signing mode

## Signing Modes

The server currently registers these signing modes:

| `sign_mode`         | Status                              | Description                                                              |
| ------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| `local_private_key` | Ready when `EVM_PRIVATE_KEY` is set | Signs locally with your EVM private key                                  |
| `quick_wallet`      | Ready after login                   | Uses the remote MCP wallet and can trigger device-flow login when needed |
| `plugin_wallet`     | Placeholder                         | Reserved for future extension, not implemented yet                       |

If `sign_mode` is omitted, the server auto-selects the highest-priority ready mode.

## Quick Start

### Cursor / Claude Desktop with local private key

This is the simplest setup if you want local signing:

```json
{
  "mcpServers": {
    "gatepay-mcp": {
      "command": "npx",
      "args": ["-y", "gatepay-local-mcp"],
      "env": {
        "EVM_PRIVATE_KEY": "your-evm-private-key-hex-with-or-without-0x-prefix"
      }
    }
  }
}
```

Put this into your MCP config such as `~/.cursor/mcp.json`, then restart the client or reload MCP.

### Cursor / Claude Desktop with quick wallet

If you prefer remote wallet signing, you can omit `EVM_PRIVATE_KEY` and let the tool use `quick_wallet`. Note that you need to obtain API credentials from the wallet service provider.

```json
{
  "mcpServers": {
    "gatepay-mcp": {
      "command": "npx",
      "args": ["-y", "gatepay-local-mcp"]
    }
  }
}
```

When `quick_wallet` has no saved token, the server can start a device-flow login and persist the token at `~/.gate-pay/auth.json`.

## Environment Variables

The server loads `.env` from the repository or package root at startup.

### Runtime variables

| Variable          | Required | Default | Description                                                                 |
| ----------------- | -------- | ------- | --------------------------------------------------------------------------- |
| `EVM_PRIVATE_KEY` | No       | —       | Local EVM private key used by `local_private_key`; hex with or without `0x` |

### Test and script variables

| Variable                      | Used By                         | Default                 | Description                                     |
| ----------------------------- | ------------------------------- | ----------------------- | ----------------------------------------------- |
| `RESOURCE_SERVER_URL`         | `test/privateKey.ts`            | `http://localhost:8080` | Base URL for the local private-key flow test    |
| `ENDPOINT_PATH`               | `test/privateKey.ts`            | `/flight/order`         | Endpoint path appended to `RESOURCE_SERVER_URL` |
| `GATEPAY_MCP_TEST_TIMEOUT_MS` | `test/mcp-x402-request-tool.ts` | `180000`                | Timeout for the MCP tool integration test       |

## Available Tool

### `x402_request`

Executes a single HTTP request to an x402-protected endpoint. If the response is `402 Payment Required`, the server completes the payment flow and retries automatically.

Use this tool only for endpoints that are expected to require x402 payment.

| Argument                | Type   | Required | Description                                                                     |
| ----------------------- | ------ | -------- | ------------------------------------------------------------------------------- |
| `url`                   | string | Yes      | Full `http` or `https` URL                                                      |
| `method`                | string | No       | `GET`, `POST`, `PUT`, or `PATCH`; default is `POST`                             |
| `body`                  | string | No       | JSON string request body; omit for `GET`                                        |
| `sign_mode`             | string | No       | Preferred signing mode: `local_private_key`, `quick_wallet`, or `plugin_wallet` |
| `wallet_login_provider` | string | No       | Login provider for `quick_wallet`: `google` or `gate`; default is `gate`        |

### Tool examples

GET request with automatic mode selection:

```json
{
  "url": "https://api.example.com/resource"
}
```

POST request with explicit local signing:

```json
{
  "url": "https://api.example.com/order",
  "method": "POST",
  "body": "{\"flightId\":\"FL001\",\"uid\":\"100\"}",
  "sign_mode": "local_private_key"
}
```

POST request with quick wallet login through Gate:

```json
{
  "url": "https://api.example.com/order",
  "method": "POST",
  "body": "{\"flightId\":\"FL001\",\"uid\":\"100\"}",
  "sign_mode": "quick_wallet",
  "wallet_login_provider": "gate"
}
```

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

## How It Works

1. The MCP client calls `x402_request`.
2. The server normalizes the input and selects a ready `sign_mode`.
3. The first request is sent to the target URL.
4. If the upstream returns `402 Payment Required`, the server parses the payment requirements.
5. The selected signer signs the payment payload.
6. The server retries the request with the payment header and returns the final response.

## License

MIT
