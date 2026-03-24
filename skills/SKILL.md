---
name: gatepay-x402
version: "2026.3.24-9"
updated: "2026-03-24"
description: >-
  Configures Gate Pay x402 payment rails and MCP env for gatepay-local-mcp: MCP Wallet / Quick Wallet
  (browser or device login, quick_wallet, no user wallet API key), plugin wallet (Gate extension + Open API
  token in env), local EVM private key, Gate Exchange; x402 pay/sign flows; arguments from each tool's
  MCP inputSchema. Use when the user sets up wallets, PAYMENT_METHOD_PRIORITY, PLUGIN_WALLET_*, EVM_PRIVATE_KEY,
  or pays via x402. Match in any language; MCP Wallet Chinese triggers include 快捷钱包, gate钱包, Gate钱包,
  MCP钱包, 快速钱包, plus 配置钱包, 帮我配置钱包, 插件钱包, 配置插件钱包, 私钥, 本地私钥, 绑定钱包, 支付方式, 默认支付,
  x402, 402, 下单, 支付, 签名支付, 交易所支付, Gate Exchange. MCP Wallet post-login: private keys only in integrated
  terminal (cross-platform); deposit/public addresses may appear in chat. If the user only asks to configure a
  wallet vaguely, use §0.A three-option menu first; when adding a second rail, user must confirm default.
  MCP tools: x402_quick_wallet_auth and/or x402_request per server tool list.
---

# Gate Pay x402 & Wallet Configuration

> **Gate Pay x402 layer** — Wallet/env setup, payment routing, and MCP orchestration for `gatepay-local-mcp`. Tool **argument names, types, required fields, and enums** come from the **MCP tool descriptor `inputSchema`** for the tool being invoked, not from duplicated tables in this file.

**User-facing language:** Write all **user-visible** replies in the **same language the user is using** in the current conversation (e.g. Chinese if they write Chinese, English if they write English). This file is English for maintainability; that does not change reply language.

**Trigger Scenarios**: Use when the user wants to **pay via x402, configure or add Gate Pay wallets, or choose a payment rail**:

- **Wallet setup / add / switch:** configure / set up / add / bind / change default payment method, `PAYMENT_METHOD_PRIORITY`, and semantically equivalent phrasing in any language
- **By rail (MCP Wallet / `quick_wallet`):** MCP Wallet, Quick Wallet, **快捷钱包**, **gate钱包** / **Gate钱包**, **plugin wallet** / **插件钱包** / **配置插件钱包**, bind private key, local private key, private-key payment, `EVM_PRIVATE_KEY`, `PLUGIN_WALLET_TOKEN`
- **Pay / buy:** 402, payment required, help me pay / purchase, place order, sign payment, `x402_sign_payment` — and equivalent phrasing in any language
- **Exchange:** Gate Exchange payment, pay via exchange

Recognize intents from **meaning**, not only exact English strings; users often mix languages or use vendor-specific terms.

**NOT this skill** (common misroutes):

- Generic market/trade-only requests with **no** Gate Pay MCP, **no** x402, **no** wallet/env setup for this product
- Payments that must be completed **only** on a **non-Gate** third-party x402 MCP for the **same** order as `x402_place_order` from Gate Pay MCP (violates same-server rule below)

---

## Auto-Update (Session Start Only)

On session start (not during interactions), check for updates once:

1. Read this file's frontmatter `version` and `updated` fields.
2. Fetch remote `SKILL.md` from `https://raw.githubusercontent.com/<org>/<repo>/main/skills/gatepay-x402/SKILL.md` (replace with the published URL).
3. Compare: update if remote version > local version, or same version but remote `updated` date is newer.
4. On update: fetch and overwrite this `SKILL.md` (and any bundled artifacts shipped with the same package, if applicable).
5. On failure: silently continue — never block user interactions.
6. Skip if: already checked this session, or skill was installed < 24h ago.

---

## Module Routing

Route by user intent (all targets are **this file** — no `references/` split):

| User Intent | Keywords / signals | Target |
|-------------|----------------------|--------|
| **Wallet / env configuration** | Wallet setup, add rail, MCP Wallet, Quick Wallet, 快捷钱包, gate钱包, Gate钱包, plugin wallet, private key, `PAYMENT_METHOD_PRIORITY`, MCP host env — and non-English equivalents with the same meaning | This file — **Wallet configuration procedure** then **Authentication State** |
| **x402 payment (Gate Pay MCP)** | pay, 402, place order, `x402_request`, `x402_place_order`, `x402_sign_payment` — and non-English equivalents | This file — **x402 Payment Flow** |
| **Gate Exchange payment** | exchange, Gate Exchange — and non-English equivalents | This file — **Gate Exchange path** |
| **MCP connectivity** | MCP missing, tools not found | This file — **MCP Server Connection Detection** |

---

## MCP Server Connection Detection

Before the first Gate Pay MCP tool call **for payment or MCP Wallet auth**, perform one connection probe (skip this block when the user has only received the **§0.A** plain-language menu and has **not** yet chosen a rail):

1. **Server discovery**: Scan configured MCP servers for a Gate Pay–style tool: **`x402_place_order`** **or** (npm single-tool build) **`x402_request`**, plus any related `x402_*` tools on that server.
2. **Record identifier**: Remember the server key / label your **MCP host** assigns (e.g. `gatepay-local-mcp` or a custom name).
3. **Verify connection**: Confirm that server’s tool list includes **`x402_place_order`** **or** **`x402_request`** (whichever that build exposes).

| Result | Action | Next |
|--------|--------|------|
| Success | Record server identifier | Use for **all** subsequent Gate Pay `x402_*` calls this session |
| Failure | Show setup guide below | Re-detect next session |

**Setup guide** (show at most once per session when detection fails):

```
Gate Pay MCP (gatepay-local-mcp)
  - Runtime: npx -y gatepay-local-mcp (or the published package name from vendor docs)
  - Register this server in the user’s MCP client (examples below; follow the host’s current UI/docs)

  Where to register (pick what matches the user’s environment):
  - Cursor / compatible forks: project or user MCP config (e.g. .cursor/mcp.json) per product docs
  - VS Code + MCP extension: MCP settings / servers panel per extension docs
  - Claude Code / other CLI agents: e.g. `claude mcp add …` or the host’s equivalent command
  - Custom / enterprise agents: same idea — stdio or HTTP transport pointing at the command above, env block supported by that host

  Optional env (only if the user configured that rail; otherwise omit or leave empty):
  - PAYMENT_METHOD_PRIORITY — payment order / default rail (see Skill: user must confirm default when adding a 2nd+ rail)
  - EVM_PRIVATE_KEY — only for local_private_key rail
  - PLUGIN_WALLET_SERVER_URL — set by the agent from **official MCP / vendor docs** (not user-guessed); PLUGIN_WALLET_TOKEN — user obtains from Gate plugin Open API token, stored in env locally
  No wallet-related key is mandatory in the template; unconfigured rails simply have no values.
```

---

## Wallet configuration procedure

When the user wants to **configure, add, or change** a payment wallet for Gate Pay MCP, follow this flow. **Arguments for any MCP tool** come from that tool’s **`inputSchema`**.

### 0. Entry

#### 0.A Vague intent — **first reply only** (user-facing)

If the user **only** asks to configure or add a wallet (e.g. “help me set up my wallet”, “configure wallet”) **without** naming a specific rail, **this turn** must be **short and plain-language**. Use the **same language as the user** (see **User-facing language** above).

1. **Give three options** — for each, in plain language: **what it is**, **who it suits**, **roughly what they will do** — **one or two sentences** total per option. Contrast the three clearly (browser/device login vs extension/Open API style vs holding a key on the machine):
   - **MCP Wallet** (localized names like “Quick Wallet”; users may say **快捷钱包**, **gate钱包**, **Gate钱包**): **Sign in with Gate in a browser or device flow** (like logging into an app); best for users who want **no extension install** and are fine with **hosted login**. After they pick, you’ll drive **MCP tools** to complete login and then payment order.
   - **Plugin wallet:** Uses the Gate **browser extension** and an **Open API–style token** you keep in **local app settings** — good for users who **already use the Gate extension** and want payments **authorized from the plugin**. After they pick, you’ll point them to **get a token from the plugin side** and **paste it only into local config**, not into random sites.
   - **Private key (local signing):** They put **their own EVM private key** in **local config** and the MCP signs **on this machine** — for **advanced users** who **fully control a key** and accept **handling raw key material**. After they pick, you’ll tell them to fill **only local config**, **never** type the key into chat.

2. **In this first message, do not include:** **`env` key names** (e.g. `EVM_PRIVATE_KEY`, `PLUGIN_WALLET_*`, `PAYMENT_METHOD_PRIORITY`), **MCP tool names** (e.g. `x402_quick_wallet_auth`, `x402_request`), **enum tokens** (`quick_wallet`, `plugin_wallet`), how to edit **`mcp.json`** (or other paths), or step-by-step technical procedures. **Defer all of that** until after they choose (**§0.B → §1–§3**).

3. **Tone:** **No** long checklist, **no** env audit, **no** long security lecture. At most one short line, e.g. “After you choose, I’ll walk you through the next steps step by step.”

4. Optionally **one line** for **Gate Exchange** pay if that MCP applies.

5. **Close** by asking them to **pick one** (name or number). **Wait** for their choice (unless they already named a rail in the **same** first message).

#### 0.B After the user **chooses** (or already named a rail)

Continue with **§1–§3** / **§5** — here you **may** use env keys, tool names, `PAYMENT_METHOD_PRIORITY`, and file edits per those sections. For **MCP Wallet**, run **MCP Server Connection Detection** and record the server identifier.

### 1. MCP Wallet (`quick_wallet`)

**MCP Wallet** is one product channel; localized names (e.g. “Quick Wallet”) refer to the same rail. The MCP enum / env token remains **`quick_wallet`** — use that value in **`PAYMENT_METHOD_PRIORITY`** and in **`sign_mode`** (or equivalent fields) per **`inputSchema`**.

**No user API key for this rail:** MCP Wallet **does not** use **`MCP_WALLET_API_KEY`**, does **not** ask users to apply for or paste a “quick wallet API key”, and is **not** the same as the plugin wallet’s Open API token. Credentials come from the **tool-driven login** (device / OAuth flow); the implementation may persist session data locally (e.g. under **`~/.gate-pay/`**) — follow the tool response, not chat guesses.

**Order: tool auth first, then `PAYMENT_METHOD_PRIORITY` only on success.** Do **not** write or merge **`PAYMENT_METHOD_PRIORITY`** until MCP Wallet login has **succeeded** per the tool you actually have (see below).

**Wrong flows (MCP Wallet):** Do **not** instruct users to set **`MCP_WALLET_API_KEY`**, **`MCP_WALLET_URL`** as a prerequisite, generic API keys, or **`EVM_PRIVATE_KEY`** for **this** rail. Do **not** conflate MCP Wallet with **plugin_wallet** token setup.

**Which tool to call (read the live MCP tool list):**

- If **`x402_quick_wallet_auth`** exists → use it first; **`arguments`** from **`inputSchema`** (e.g. optional `wallet_login_provider`: `gate` | `google`).
- If **only** **`x402_request`** exists (common **npm** `gatepay-local-mcp` build) → trigger MCP Wallet login via **`x402_request`** using **`inputSchema`** fields for **`quick_wallet`** (e.g. `sign_mode`: **`quick_wallet`**, and any required `wallet_login_provider` / URL params). **Still** no user API key — same auth-first rule; then update **`PAYMENT_METHOD_PRIORITY`** only after success.

**Definition — configured:** MCP Wallet is **fully configured** only after **login / device flow completes successfully** (tool response **success / ready**). Failed or abandoned login → **do not** update **`PAYMENT_METHOD_PRIORITY`**.

1. **First — MCP tool:** Per **Which tool to call** above, invoke **`x402_quick_wallet_auth`** **or** **`x402_request`** on the Gate Pay MCP server (see **MCP Server Connection Detection**). Guide the user through **MCP Wallet login** until the tool indicates **success / ready**.
2. **If login succeeds** (session established per tool response): **then** edit MCP **`env`**:
   - Add **`quick_wallet`** to **`PAYMENT_METHOD_PRIORITY`** (merge with existing list if any).
   - If **no other rail** was in **`PAYMENT_METHOD_PRIORITY`** before, you may set **`quick_wallet`** as the only or first entry per user’s stated intent at **§0.B**.
   - If **one or more other rails** were already in **`PAYMENT_METHOD_PRIORITY`**, **ask the user explicitly**: whether to make **`quick_wallet`** the **new default** (move to front). **Only if the user says yes** move it to the **first** position; **if no**, append **`quick_wallet`** without changing the current first token (**do not** reorder without confirmation — see **§4**).
3. **If auth / login fails** (error, timeout, user cancelled, non-ready): **do not** change **`PAYMENT_METHOD_PRIORITY`** or add **`quick_wallet`**. Explain next steps; user may retry.
4. After **successful** config writes, remind **reload MCP / restart the host** if needed.
5. **Disclose tool output after MCP Wallet login:**
   - **Private key / seed / exported signing secret:** **Never** paste the full value in **chat**. Print it to the **integrated terminal** (stdout) so it works on **macOS, Windows, and Linux**: prefer **`node -e`** / **`node -p`** or **`python -c`** to print a JSON-safe or plain-text line; if neither runtime is on `PATH`, write a **temporary file** under the project (**gitignored** path) and run a command that prints its path or contents to the terminal, then tell the user in **chat** (in their language) to **open the Terminal panel** and copy from there — still **do not** put the secret in chat.
   - **Public deposit / wallet addresses** (non-secret identifiers): **may** show in **chat** in full or summarized, in the **user’s language**, plus any short context the user needs.
   - **Other bulky or mixed responses:** Strip or redact secrets for chat; put **full private material** only in terminal/temp file as above; **addresses** stay chat-eligible.
6. Apply **Security Rules**.

### 2. Plugin wallet (`plugin_wallet`)

1. **`PLUGIN_WALLET_SERVER_URL`:** Set from the **official MCP / Gate Pay / plugin wallet documentation** (README, install guide, or vendor default). The **agent** fills this value to match the product-recommended endpoint — **do not** ask the user to invent or type the server URL.
2. **`PLUGIN_WALLET_TOKEN`:** Instruct the user to obtain the **Open API token** from the Gate plugin wallet and add it **only** in local MCP **`env`** — **do not** ask them to paste the full token into chat.
3. **`PAYMENT_METHOD_PRIORITY`:** Add **`plugin_wallet`**. If this is the **second or later** rail, **ask** whether **`plugin_wallet`** should become the **default** (first in list). **Only** reorder to put it first if the user **confirms yes**; otherwise append without changing the current default.
4. **No** **`x402_quick_wallet_auth`** for this rail.
5. Remind **reload MCP** after `env` changes.

### 3. Private key / local signing (`local_private_key`)

1. In **`env`**, ensure **`EVM_PRIVATE_KEY`** exists for local signing. Use a **placeholder** in shared repos; the user fills the real value **only** in their local MCP config. **Never** collect or repeat a private key in chat.
2. Add any **`RPC_URL`** (or equivalent) variables **required** by the MCP package docs.
3. **`PAYMENT_METHOD_PRIORITY`:** Add **`local_private_key`**. If this is the **second or later** rail, **ask** whether **`local_private_key`** should become the **default**. **Only** move it first if the user **confirms yes**.
4. **No** **`x402_quick_wallet_auth`** for this rail unless the user also uses **MCP Wallet** (`quick_wallet`).
5. Remind **reload MCP** after `env` changes.

### 4. Adding a second rail or changing default

1. When the user **binds a second or additional** payment rail, **never** change the **first** token of **`PAYMENT_METHOD_PRIORITY`** (the current default) **without an explicit user choice**.
2. **Always ask** a clear yes/no (or pick-one) question in the **user’s language**, e.g. “Should **\<rail\>** become the default payment method?” Only if the user answers **yes**, move that rail’s token to the **front**. If **no**, append the new rail or keep existing order as appropriate **without** promoting it to default.
3. **MCP Wallet (`quick_wallet`):** Auth (**§1**) still comes **before** any **`PAYMENT_METHOD_PRIORITY`** change that **adds** **`quick_wallet`**; after successful login, apply the same **user-confirmed** rule for whether **`quick_wallet`** becomes default when other rails already exist.
4. Reordering among rails **already** listed (user wants to switch default only): **still** require **explicit confirmation** before editing which token is first.

### 5. Gate Exchange (`gate_exchange`)

If the user configures **exchange-only** pay: ensure **Gate Exchange MCP** is registered separately; set **`PAYMENT_METHOD_PRIORITY`** to include **`gate_exchange`** when that is the intended rail. Payment tools are **only** on the Exchange MCP — read each tool’s **`inputSchema`** there.

---

## Authentication State

Payment and signing use whichever **wallet rail** the user has actually configured. Gate Pay MCP **`env`** is read from the **host’s MCP config** (path and format depend on Cursor, VS Code, Claude Code, etc. — not hardcoded here).

- **`PAYMENT_METHOD_PRIORITY`**: If set in **`env`**, comma-separated; first token = default. Tokens: `quick_wallet`, `plugin_wallet`, `local_private_key`, `gate_exchange`. If **unset**, infer rails only from **non-empty** env keys / MCP session, or ask the user.
- **`local_private_key`**: Only when the user chose this rail: `EVM_PRIVATE_KEY` (and any RPC vars your MCP documents) must be set in **`env`** — never collect private keys in chat. If empty, this rail is unavailable.
- **`quick_wallet` (MCP Wallet):** **Setup** = **login success** via tool auth (**§1**: **`x402_quick_wallet_auth`** if present, else **`x402_request`** per schema). **No** **`MCP_WALLET_API_KEY`** for users. Auth **before** writing **`PAYMENT_METHOD_PRIORITY`**; on failure, do **not** change that **`env`**. **Pay:** **x402 Payment Flow** Step 5; on expiry, auth once then retry sign once.
- **`plugin_wallet`**: Only when configured: `PLUGIN_WALLET_SERVER_URL`, `PLUGIN_WALLET_TOKEN` in **`env`**. If missing, this rail is unavailable.
- **`gate_exchange`**: Gate Exchange MCP configured separately; route there only when that MCP exists and user selects this rail.

When a **second or additional** payment rail is added, **ask** whether the **default** should switch to the **newly bound** rail. **Do not** reorder **`PAYMENT_METHOD_PRIORITY`** until the user **explicitly agrees** to change the default.

---

## Gate Pay x402 Module (MCP Tools)

### How to build `arguments` (mandatory)

Before **every** `CallMcpTool` to Gate Pay MCP:

1. Locate the tool by **exact name** in the MCP tool list (e.g. `x402_request`, `x402_place_order`, `x402_sign_payment`, …).
2. Read that tool's **`inputSchema`**: `properties`, `required`, `enum`, `description`.
3. Assemble `arguments` **only** from that schema and from **allowed** runtime values (user message, context, prior tool outputs).

Do **not** copy parameter tables from this Skill; the **MCP schema is the source of truth**. If the MCP is not connected and schema is unavailable, complete MCP setup first or use vendor docs.

### Tools (names to look up in MCP)

| Tool | Purpose | Parameters |
|------|---------|------------|
| `x402_request` | **Single-tool npm build:** HTTP + optional 402 handling + signing in one tool; also used to drive **MCP Wallet** login when schema exposes `quick_wallet` / `sign_mode` | **See MCP `inputSchema` for `x402_request`** |
| `x402_place_order` | Send merchant HTTP request; read status, headers, body | **See MCP `inputSchema` for `x402_place_order`** |
| `x402_quick_wallet_auth` | **MCP Wallet** device/OAuth auth (`quick_wallet` rail) | **See MCP `inputSchema` for `x402_quick_wallet_auth`** |
| `x402_sign_payment` | Parse 402, sign, submit payment (all-in-one) | **See MCP `inputSchema` for `x402_sign_payment`** |
| `x402_create_signature` | Create signed payload / encoded signature only | **See MCP `inputSchema` for `x402_create_signature`** |
| `x402_submit_payment` | Submit payment with signature (split path) | **See MCP `inputSchema` for `x402_submit_payment`** |

Merchant **`url` / `method` / `body`** come from the **user message**, **conversation context**, or **upstream discovery**; map field names to whatever the schema requires (`x402_place_order` or `x402_request`, depending on the connected server).

### x402 Payment Flow

```text
Step 0: MCP Server connection detection (once per session) — see section above
  |
Step 1: Payment intent checks — PAYMENT_METHOD_PRIORITY + env + user balance acknowledgment (user-confirmed)
  |
Step 2: Choose rail
  |- gate_exchange -> Gate Exchange MCP tools only (read each tool's inputSchema there)
  +- Gate Pay x402 -> Continue
  |
Step 3: Before each Gate Pay tool call -> read that tool's MCP inputSchema and build arguments
  |
Step 4: Merchant HTTP + 402 handling: `x402_place_order` **or** `x402_request` (whichever the server exposes; per schema)
  |- Non-402 -> handle per merchant rules
  +- 402 -> extract payment challenge from response per MCP/tool docs (e.g. headers); keep url/method/body for retry
  |
Step 5: If MCP Wallet (`quick_wallet`) -> before sign: `x402_quick_wallet_auth` **if listed**, else satisfy login via `x402_request` per schema (e.g. `sign_mode`); on expiry -> same auth once then retry sign once (per product limits)
  |
Step 6: x402_sign_payment (default) OR x402_create_signature -> x402_submit_payment (split); **or** single-tool path: further `x402_request` calls per schema
         For each step: arguments strictly from that tool's inputSchema; wire outputs only as schema/response shapes allow
  |
Step 7: Summarize success to the user in their language; **addresses** may be in chat; **private keys** only via terminal/temp-file flow per **Security Rules** and **Wallet configuration procedure** §1.5
```

**Same-server rule:** All steps for **one** merchant order / 402 challenge must use the **same** Gate Pay MCP server identifier (whether that server exposes split tools or only **`x402_request`**).

---

## Gate Exchange path

When `gate_exchange` is selected and Gate Exchange MCP is available: use **only** Exchange MCP tools for order/pay. Before each call, read **that** tool's **`inputSchema`** on the Exchange server. Do not complete the same Gate Pay `x402_place_order` order using a third-party x402 MCP.

---

## Follow-up Routing

| User Intent After Flow | Target |
|------------------------|--------|
| Change default payment / add second wallet | This file — **Wallet configuration procedure** §4 |
| Retry after MCP Wallet (`quick_wallet`) expiry | This file — **x402 Payment Flow** Step 5–6 |
| Merchant params missing | Ask user or upstream; then **Step 4** with schema-compliant `x402_place_order` or `x402_request` |

---

## Cross-Skill Collaboration

Other skills or discovery layers may supply merchant **`url` / `method` / `body`**. This skill **executes** Gate Pay MCP (and optionally Gate Exchange MCP) using **MCP `inputSchema`** for each tool call. It does not replace merchant catalogs.

---

## Supported networks & assets

Networks, tokens, and amounts are defined by the **merchant 402 / payment-required payload** and MCP behavior — not enumerated here. Follow tool responses and merchant rules.

---

## Security Rules

1. **Schema-first calls**: Always align `arguments` with the target tool's **`inputSchema`** before invoking MCP.
2. **Sensitive payloads — MCP Wallet (`quick_wallet`):** **Private keys, seeds, and exported signing secrets** from the tool go **only** to the **integrated terminal** (or gitignored temp file + terminal pointer), **never** the agent chat — see **Wallet configuration procedure** §1.5; works on **Windows, macOS, Linux** via `node`/`python` or file fallback. **Public deposit / wallet addresses** are **not** treated as private keys: **show in chat** when helpful. Do **not** dump huge raw JSON into chat; redact secrets in chat, full secret material via terminal only.
3. **Private keys (by rail):** **`local_private_key` rail:** User supplies **`EVM_PRIVATE_KEY`** only in local MCP **`env`** — **never** ask them to type or paste that key into chat. **MCP Wallet rail:** If the **tool response** includes a private key or equivalent secret, **print to terminal** per §1.5; **do not** paste it into chat.
4. **Open API tokens**: Store in **`env`**; mask or confirm in chat without exposing full values.
5. **Same-server / no cross-vendor mix** for one Gate `x402_place_order` order: see **x402 Payment Flow**.
6. **Session vs chat**: Do not rely on chat memory for MCP Wallet login state; use **`x402_quick_wallet_auth`** and/or **`x402_request`** (per live tool list) and MCP responses as documented.
