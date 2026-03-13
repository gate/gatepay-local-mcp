# gatepay-local-mcp 

A local (stdio) MCP server that sends HTTP requests to **x402 payment-protected** endpoints. On `402 Payment Required`, it creates the payment payload, signs with your EVM key, and retries the request with the payment header. Exposes a single tool: `x402_request`.

## Features

- **One tool** — `x402_request`: request any URL with optional method and JSON body; 402 is handled automatically (parse → sign → retry).
- **No @x402/* deps** — x402 logic is implemented in-repo under `x402-standalone/` (EVM exact scheme; supports `eth`, `base`, etc.).
- **Cursor / Claude Desktop** — add the server via `mcp.json` and set `EVM_PRIVATE_KEY` in `env`; no code changes needed.

## Quick Start (Cursor / Claude Desktop)

### With authentication (required for x402 payment)

`EVM_PRIVATE_KEY` is required; the server will not start without it.

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

Put this in your MCP config (e.g. `~/.cursor/mcp.json`), then restart Cursor or reload MCP. The AI can then call `x402_request` for x402-protected URLs.

### Optional: debug logging

```json
{
  "mcpServers": {
    "gatepay-mcp": {
      "command": "npx",
      "args": ["-y", "gatepay-local-mcp"],
      "env": {
        "EVM_PRIVATE_KEY": "your-evm-private-key"
      }
    }
  }
}
```

Use `tail -f /tmp/x402-debug.log` to watch requests and errors.

## Environment Variables

| Variable | Required | Default | Description |
| -------- | -------- | ------- | ----------- |
| `EVM_PRIVATE_KEY` | **Yes** | — | EVM wallet private key (hex, with or without `0x`) for x402 payment signing |
| `X402_DEBUG_LOG` or `MCP_X402_DEBUG_LOG` | No | — | File path for debug log (append-only; use `tail -f` to inspect) |

## Available Tools

### x402_request

Execute one HTTP request to an x402-protected endpoint. If the server responds with `402 Payment Required`, the tool parses the payment requirements, builds and signs the payment payload, and retries the request with the `PAYMENT-SIGNATURE` header.

**Use only for endpoints that require payment (402).** Do not use for public or non-402 endpoints.

| Argument | Type | Required | Description |
| -------- | ---- | -------- | ----------- |
| `url` | string | **Yes** | Full URL of the endpoint (e.g. `http://localhost:8080/flight/order`) |
| `method` | string | No | `GET`, `POST`, `PUT`, or `PATCH`. Default: `POST`. |
| `body` | string | No | JSON string for request body (POST/PUT/PATCH). Omit for GET. |

**Examples (as passed by the client):**

- GET: `{ "url": "https://api.example.com/resource" }`
- POST: `{ "url": "https://api.example.com/order", "method": "POST", "body": "{\"flightId\":\"FL001\",\"uid\":\"100\"}" }`

## Development

```bash
# Install dependencies
pnpm install

# Build (output in dist/)
pnpm run build

# Run MCP locally (loads .env from package/repo root for EVM_PRIVATE_KEY)
pnpm start
# or without build step
pnpm run dev

# Run the fetch demo (POST to a configurable x402 endpoint)
pnpm run fetch
```

The fetch demo uses `RESOURCE_SERVER_URL` (default `http://localhost:4021`) and `ENDPOINT_PATH` (default `/weather`); set them in `.env` or the shell. See `test/fetch.ts` to change URL, method, or body.

## How it works

- On first request, the server may respond with `402` and `PAYMENT-REQUIRED` (or a JSON body with payment requirements).
- The client parses requirements, selects a supported scheme/network (e.g. `exact` + `eth`/`base`), builds the EIP-3009–style payload, and signs with `EVM_PRIVATE_KEY`.
- It retries the same request with `PAYMENT-SIGNATURE` (and `Access-Control-Expose-Headers` for `PAYMENT-RESPONSE`).
- The final response (200 or error) and optional `PAYMENT-RESPONSE` header are returned to the caller.

## License

MIT
