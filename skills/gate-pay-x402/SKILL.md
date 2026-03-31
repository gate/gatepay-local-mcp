---
name: gate-pay-x402
version: "2026.3.30-1"
updated: "2026-03-30"
description: >-
  Use this skill whenever the user configures Gate Pay x402 (gatepay-local-mcp), discovers merchants, or pays via 402. Trigger phrases include "x402", "402 payment", "configure wallet", "quick wallet", "Gate wallet", "plugin wallet", "merchant list", "PAYMENT_METHOD_PRIORITY". Build arguments from each tool's MCP inputSchema; inputSchema overrides this file. Never put MCP Wallet private keys in chat. Vague wallet setup: Section 0.A menu first; second rail: explicit default confirmation.
---

# Gate Pay x402 (gate-pay-x402)

## General Rules

⚠️ STOP — You MUST read and strictly follow the shared runtime rules before proceeding.
Do NOT select or call any tool until all rules are read. These rules have the highest priority.
→ Read [gate-runtime-rules.md](https://github.com/gate/gate-skills/blob/master/skills/gate-runtime-rules.md)
- **Only call MCP tools explicitly listed in this skill.** Tools not documented here must NOT be called, even if they exist in the MCP server.

**Allowlisted Gate Pay MCP tool names (exact names as exposed by the live server; skip tools the server does not list):**

- **Read / orchestration (no on-chain debit by themselves; may perform HTTP or session setup per schema):** `MERCHANT_DISCOVERY_TOOL` (placeholder label—replace with the real discovery tool name when the MCP ships), `x402_place_order`, `x402_request` (when used for merchant HTTP, 402 handling, or MCP Wallet login per `inputSchema` only).
- **Write / sign / pay / session (irreversible or security-sensitive effects possible—require explicit user confirmation after a clear price for payment steps):** `x402_quick_wallet_auth`, `x402_sign_payment`, `x402_create_signature`, `x402_submit_payment`, `x402_centralized_payment` (if listed by the server).

**Do not** use Gate Exchange MCP to substitute Gate Pay wallet binding or to finish a Gate Pay `x402_place_order` / same-server 402 flow on a third-party x402 MCP. When the user chose the **`gate_exchange` rail**, use **only** Gate Exchange MCP tools per **Gate Exchange path**.

**No write without consent:** Do not invoke any tool whose `inputSchema` performs signing, fund movement, or centralized settlement—including `x402_sign_payment`, `x402_create_signature` + `x402_submit_payment`, `x402_centralized_payment`, and pay steps inside `x402_request`—until the user has seen a **clear price** (quote or 402 summary) and given **explicit** confirmation. One confirmation must cover **all** write steps in the current pay flow.

---

> **Gate Pay x402 layer** — Merchant discovery (resource list only), wallet/env setup, payment routing, and MCP orchestration for `gatepay-local-mcp`. Tool **argument names, types, required fields, and enums** come from the **MCP tool descriptor `inputSchema`** for the tool being invoked, not from duplicated tables in this file. **If anything in this skill disagrees with that tool’s `inputSchema` (required args, enums, or documented fields), follow `inputSchema` for that invocation.**

**User-facing language:** Write all **user-visible** replies in the **same language the user is using** in the current conversation (e.g. Chinese if they write Chinese, English if they write English). This file is English for maintainability; that does not change reply language.

**Trigger Scenarios**: Use when the user wants to **pay via x402, discover or pick a paid service, configure or add Gate Pay wallets, or choose a payment rail**:

- **Wallet setup / add / switch:** configure / set up / add / bind / change default payment method, `PAYMENT_METHOD_PRIORITY`, and semantically equivalent phrasing in any language
- **By rail (MCP Wallet / `quick_wallet`):** MCP Wallet, Quick Wallet, and **the same product under localized or colloquial names in the user’s language**, **plugin wallet** (including extension plus Open-API-token style setup), bind private key, local private key, private-key payment, `EVM_PRIVATE_KEY`, `PLUGIN_WALLET_TOKEN`
- **Pay / buy:** 402, payment required, help me pay / purchase, place order, sign payment, `x402_sign_payment` — and equivalent phrasing in any language
- **Paid service intent (examples, not literal only):** book flights, order food, buy an API, “help me buy X”, **which merchants exist**, **list of billable or paid services** — and equivalent phrasing in any language the user writes
- **Exchange:** Gate Exchange payment, pay via exchange

Recognize intents from **meaning**, not only exact English strings; users often mix languages or use vendor-specific terms.

**NOT this skill** (common misroutes):

- Generic market/trade-only requests with **no** Gate Pay MCP, **no** x402, **no** merchant discovery for this product, **no** wallet/env setup for this product
- Pure consultation or trade decisions with **no** Gate Pay / x402 / this MCP path
- Payments that must be completed **only** on a **non-Gate** third-party x402 MCP for the **same** order as `x402_place_order` from Gate Pay MCP (violates same-server rule below)

---

## Auto-Update (Session Start Only)

**Outbound trust:** On update, this skill fetches canonical `SKILL.md` over HTTPS from the official registry path below (same trust model as the [gate-runtime-rules.md](https://github.com/gate/gate-skills/blob/master/skills/gate-runtime-rules.md) link in **General Rules**). If the published org/repo differs, replace the URL when releasing the package and mirror the change in **README.md**.

On session start (not during interactions), check for updates once:

1. Read this file's frontmatter `version` and `updated` fields.
2. Fetch remote `SKILL.md` from `https://raw.githubusercontent.com/gate/gate-github-skills/main/skills/gate-pay-x402/SKILL.md` (set to your published org/repo/branch if different).
3. Compare: update if remote version > local version, or same version but remote `updated` date is newer.
4. On update: fetch and overwrite this `SKILL.md` (and any bundled artifacts shipped with the same package, if applicable).
5. On failure: silently continue — never block user interactions.
6. Skip if: already checked this session, or skill was installed < 24h ago.

---

## Routing Rules

Route by user intent (all targets are **this file** — no `references/` split):

| User Intent | Keywords / signals | Target |
|-------------|----------------------|--------|
| **Wallet / env configuration** | Wallet setup, add rail, MCP Wallet, Quick Wallet, localized names for the same rails, plugin wallet, private key, `PAYMENT_METHOD_PRIORITY`, MCP host env — match intent in any language | This file — **Wallet configuration procedure** then **Authentication State** |
| **Merchant discovery / selection / quote** | Which merchants, paid service list, pick a service, quote / dynamic price, discovery before pay — and non-English equivalents | This file — **GatePay merchant discovery & agent orchestration** then **Workflow** |
| **x402 payment (Gate Pay MCP)** | pay, 402, place order, `x402_request`, `x402_place_order`, `x402_sign_payment` — and non-English equivalents | This file — **Workflow** |
| **Gate Exchange payment** | exchange, Gate Exchange — and non-English equivalents | This file — **Gate Exchange path** |
| **MCP connectivity** | MCP missing, tools not found | This file — **MCP Server Connection Detection** |

---

## GatePay merchant discovery & agent orchestration

**One-line intent:** When the user states what paid service they want in natural language, the agent **discovers merchants** → **selects** a resource by rules → **quotes** when the merchant supports it → **fills required call parameters** → **invokes** the service → after a **clear price** is visible, **asks for explicit pay consent** → only then runs signing / payment tools. Wallet rails (`quick_wallet`, `plugin_wallet`, `local_private_key`, `gate_exchange`) follow **Wallet configuration procedure** and **Authentication State**.

### Scope and boundaries

- **Merchant discovery layer** returns an invokable **resource list** only. It **does not** take payment, **does not** place orders, and **does not** settle on-chain.
- **Order / HTTP / 402** use whichever Gate Pay MCP tools the host exposes (e.g. `x402_place_order` and/or `x402_request`). **Every** argument comes from that tool’s **`inputSchema`**.
- **Registry / Discovery HTTP API** (if present behind MCP) is implementation detail: the agent uses **MCP tools and responses**; do **not** duplicate discovery payload field tables here — treat list item shape as **whatever the MCP returns**, validated against **`inputSchema`** when the discovery tool ships.

### Merchant discovery MCP tool (placeholder)

- **Tool name:** Use the **exact** tool name from the **live Gate Pay MCP tool list** when the package ships (placeholder label: **`MERCHANT_DISCOVERY_TOOL`** — replace with the real name, e.g. a `discover_*` tool).
- **Arguments and response shape:** **Only** from that tool’s **`inputSchema`** and actual responses. Until the tool exists, skip discovery calls and rely on user-provided URLs or other allowed context.

### Selection rules (filter → rank → tie-break)

Apply in order; **filter** first, then **sort** what remains; if several options remain close, **ask the user** — do **not** silently choose.

1. **Intent match:** `description`, type, and capabilities align with the user goal (e.g. flights vs food vs API).
2. **Constraints:** Network, currency, `maxPrice`, user-stated budget — drop resources that violate them.
3. **Callability:** Current environment can satisfy required **MCP transport** and/or **HTTP**; if not, drop or explain limitation.
4. **Parameter feasibility:** Given what the user already said, can required inputs (per merchant **`inputSchema`**) be filled? If a resource needs unknown critical fields and there is no safe default, **do not** select it **or** pick the easiest-to-complete option and **ask** for missing fields.
5. **Price path:** If the user insists on knowing price **before** deciding, prefer resources that expose **quote / dynamic** metadata; otherwise, among equally good options, prefer fixed-price or simpler paths.
6. **Tie-break:** If multiple resources remain similarly suitable, **present differences** (price band, latency, limits) and ask the user to pick (e.g. by number). **Never** auto-pick without user choice.

### Quote vs main call order

- **If** the discovery item or schema/metadata indicates **quote / dynamic pricing** (e.g. `dynamic`, `quote_endpoint`, or equivalent per MCP docs): **quote first** → show the user **currency, amount, and conditions** → ask whether to **continue with that merchant** → **after yes**, call the main service with parameters.
- **If** there is **no** quote path: **do not** invent a separate quote step; call the main service per contract. If cost appears **only** in **402**, parse **402** then run **mandatory pay confirmation** below.
- **No quote path does not mean skipping pay confirmation.**

### Parameters, price visibility, and mandatory pay confirmation

- **Parameters:** Before any merchant / `x402_place_order` / `x402_request` call, list **required** fields from the relevant **`inputSchema`**. If the user has not provided them, **complete via dialogue**. **Do not** call with empty or guessed values to “probe” the API.
- **Price visibility:** On a quote path, show **currency, amount, and applicability**. Without quote, after **402** or an explicit price from the merchant, summarize the **payment requirement** in the **user’s language**.
- **Pay confirmation (mandatory):** The user must see a **clear price** (quote result or **402** summary) first. Then the agent must ask again; the message should cover **how much**, **which asset/chain** (if known), and **which payment method** (if known). **Only after explicit consent** (e.g. “confirm pay”, “go ahead and pay”) invoke `x402_sign_payment`, split signature tools, or further `x402_request` steps per **live MCP**. If the user **refuses** or is **unsure**, **stop** payment; offer another merchant or end.
- **Step 1 (Workflow)** “balance / intent” checks may be **merged** with this **see-price-then-confirm** step to **avoid double-asking**; prefer **one** clear confirmation after price is visible.

### Mapping discovery to Step 4

- **`url` / `method` / `body`** for `x402_place_order` or `x402_request` come from the **user message**, **conversation context**, or **upstream discovery** (resource identity, `outputSchema`, or equivalent in the MCP response). **Map field names** to whatever the **tool `inputSchema`** requires.

### Alignment with Workflow

- **Step 4** remains merchant HTTP + **402** handling via `x402_place_order` or `x402_request` (per server).
- **Steps 5–6** (MCP Wallet login if needed, sign / pay tools): run **only after** **mandatory pay confirmation** above (or immediately before first charge/sign, if merged with confirmation — **not** before the user has a clear price and agrees).
- **Same-server rule:** One merchant order / one **402** challenge → **one** Gate Pay MCP server id for all related `x402_*` steps (unchanged).

### Wallet and rails (product rules)

These **override** older wording elsewhere in this file where they conflict, **except** where a tool’s **`inputSchema`** requires a field (e.g. a URL argument): then **`inputSchema` wins** — supply values per schema and vendor docs.

1. **`plugin_wallet`:** User configures **`PLUGIN_WALLET_TOKEN`** in MCP **`env`** only (full token **never** in chat). **Do not** require **`PLUGIN_WALLET_SERVER_URL`** in user env as a default rule; implementation may use a built-in endpoint. If **`inputSchema`** still requires a URL (or similar) for a call, fill it per schema/docs — not by contradicting required fields.
2. **`quick_wallet` (MCP Wallet):** **Do not** require `MCP_WALLET_API_KEY`, `MCP_WALLET_URL`, or similar “quick wallet API URL” env vars. Session comes from **tool-driven login** (`x402_quick_wallet_auth` or `x402_request` per schema); **after success**, update **`PAYMENT_METHOD_PRIORITY`** as in **Section 1** (MCP Wallet).
3. **Payment failure and rail switching:** Use only rails that are **actually configured** and available (`PAYMENT_METHOD_PRIORITY` + env + login state). If **only** `plugin_wallet` is configured and it **fails**: **do not** start **`quick_wallet`** login/auth **unless** `quick_wallet` is **already** configured **and** the user **explicitly** agrees to switch. If there is **no** next rail, explain the failure, suggest checking token/plugin setup, and **do not** invent other payment methods. With **multiple** rails, you may try the next configured rail on failure; **prefer** a brief user check before switching rails (unless product defines a pure technical retry exception).

### Hard stops (non-exhaustive)

- Discovery returns **nothing** usable and constraints cannot be relaxed → stop or relax and retry; do not fake merchants.
- **Required parameters missing** → **do not** call the merchant or pay tools.
- User **has not** explicitly agreed to pay after seeing price → **do not** call signature or payment tools.
- Plugin-only config and plugin call **failed** → **do not** auto-launch **unconfigured** `quick_wallet`.

---

## MCP Server Connection Detection

Before the first Gate Pay MCP tool call **for payment or MCP Wallet auth**, perform one connection probe (skip this block when the user has only received the **Section 0.A** plain-language menu and has **not** yet chosen a rail):

1. **Server discovery**: Scan configured MCP servers for a Gate Pay–style tool: **`x402_place_order`** **or** (npm single-tool build) **`x402_request`**, plus any related `x402_*` tools on that server. If a **merchant discovery** tool exists, note its **exact** name from the live tool list (placeholder label **`MERCHANT_DISCOVERY_TOOL`** — see **GatePay merchant discovery & agent orchestration**).
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
  - PLUGIN_WALLET_TOKEN — user obtains from Gate plugin Open API token, stored in env locally (full token never in chat); do not require PLUGIN_WALLET_SERVER_URL in user env
  No wallet-related key is mandatory in the template; unconfigured rails simply have no values.
```

---

## Wallet configuration procedure

When the user wants to **configure, add, or change** a payment wallet for Gate Pay MCP, follow this flow. **Arguments for any MCP tool** come from that tool’s **`inputSchema`**.

### 0. Entry

#### 0.A Vague intent — **first reply only** (user-facing)

If the user **only** asks to configure or add a wallet (e.g. “help me set up my wallet”, “configure wallet”) **without** naming a specific rail, **this turn** must be **short and plain-language**. Use the **same language as the user** (see **User-facing language** above).

1. **Give three options** — for each, in plain language: **what it is**, **who it suits**, **roughly what they will do** — **one or two sentences** total per option. Contrast the three clearly (browser/device login vs extension/Open API style vs holding a key on the machine):
   - **MCP Wallet** (product labeling varies by locale; often called Quick Wallet in English materials): **Sign in with Gate in a browser or device flow** (like logging into an app); best for users who want **no extension install** and are fine with **hosted login**. After they pick, you’ll drive **MCP tools** to complete login and then payment order.
   - **Plugin wallet:** Uses the Gate **browser extension** and an **Open API–style token** you keep in **local app settings** — good for users who **already use the Gate extension** and want payments **authorized from the plugin**. After they pick, you’ll point them to **get a token from the plugin side** and **paste it only into local config**, not into random sites.
   - **Private key (local signing):** They put **their own EVM private key** in **local config** and the MCP signs **on this machine** — for **advanced users** who **fully control a key** and accept **handling raw key material**. After they pick, you’ll tell them to fill **only local config**, **never** type the key into chat.

2. **In this first message, do not include:** **`env` key names** (e.g. `EVM_PRIVATE_KEY`, `PLUGIN_WALLET_*`, `PAYMENT_METHOD_PRIORITY`), **MCP tool names** (e.g. `x402_quick_wallet_auth`, `x402_request`), **enum tokens** (`quick_wallet`, `plugin_wallet`), how to edit **`mcp.json`** (or other paths), or step-by-step technical procedures. **Defer all of that** until after they choose (**Section 0.B → Sections 1–3**).

3. **Tone:** **No** long checklist, **no** env audit, **no** long security lecture. At most one short line, e.g. “After you choose, I’ll walk you through the next steps step by step.”

4. Optionally **one line** for **Gate Exchange** pay if that MCP applies.

5. **Close** by asking them to **pick one** (name or number). **Wait** for their choice (unless they already named a rail in the **same** first message).

#### 0.B After the user **chooses** (or already named a rail)

Continue with **Sections 1–3** / **Section 5** — here you **may** use env keys, tool names, `PAYMENT_METHOD_PRIORITY`, and file edits per those sections. For **MCP Wallet**, run **MCP Server Connection Detection** and record the server identifier.

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
   - If **no other rail** was in **`PAYMENT_METHOD_PRIORITY`** before, you may set **`quick_wallet`** as the only or first entry per user’s stated intent at **Section 0.B**.
   - If **one or more other rails** were already in **`PAYMENT_METHOD_PRIORITY`**, **ask the user explicitly**: whether to make **`quick_wallet`** the **new default** (move to front). **Only if the user says yes** move it to the **first** position; **if no**, append **`quick_wallet`** without changing the current first token (**do not** reorder without confirmation — see **Section 4**).
3. **If auth / login fails** (error, timeout, user cancelled, non-ready): **do not** change **`PAYMENT_METHOD_PRIORITY`** or add **`quick_wallet`**. Explain next steps; user may retry.
4. After **successful** config writes, remind **reload MCP / restart the host** if needed.
5. **Disclose tool output after MCP Wallet login:**
   - **Private key / seed / exported signing secret:** **Never** paste the full value in **chat**. Print it to the **integrated terminal** (stdout) so it works on **macOS, Windows, and Linux**: prefer **`node -e`** / **`node -p`** or **`python -c`** to print a JSON-safe or plain-text line; if neither runtime is on `PATH`, write a **temporary file** under the project (**gitignored** path) and run a command that prints its path or contents to the terminal, then tell the user in **chat** (in their language) to **open the Terminal panel** and copy from there — still **do not** put the secret in chat.
   - **Public deposit / wallet addresses** (non-secret identifiers): **may** show in **chat** in full or summarized, in the **user’s language**, plus any short context the user needs.
   - **Other bulky or mixed responses:** Strip or redact secrets for chat; put **full private material** only in terminal/temp file as above; **addresses** stay chat-eligible.
6. Apply **Security Rules**.

### 2. Plugin wallet (`plugin_wallet`)

1. **`PLUGIN_WALLET_TOKEN`:** Same **`plugin_wallet`** rules as **Wallet and rails** in **GatePay merchant discovery & agent orchestration** (token in **`env` only**, never full token in chat). **`PLUGIN_WALLET_SERVER_URL`:** optional per product defaults; if **`inputSchema`** requires a URL for a tool call, set it per schema/vendor docs.
2. **`PAYMENT_METHOD_PRIORITY`:** Add **`plugin_wallet`**. If this is the **second or later** rail, **ask** whether **`plugin_wallet`** should become the **default** (first in list). **Only** reorder to put it first if the user **confirms yes**; otherwise append without changing the current default.
3. **No** **`x402_quick_wallet_auth`** for this rail.
4. Remind **reload MCP** after `env` changes.

### 3. Private key / local signing (`local_private_key`)

1. In **`env`**, ensure **`EVM_PRIVATE_KEY`** exists for local signing. Use a **placeholder** in shared repos; the user fills the real value **only** in their local MCP config. **Never** collect or repeat a private key in chat.
2. Add any **`RPC_URL`** (or equivalent) variables **required** by the MCP package docs.
3. **`PAYMENT_METHOD_PRIORITY`:** Add **`local_private_key`**. If this is the **second or later** rail, **ask** whether **`local_private_key`** should become the **default**. **Only** move it first if the user **confirms yes**.
4. **No** **`x402_quick_wallet_auth`** for this rail unless the user also uses **MCP Wallet** (`quick_wallet`).
5. Remind **reload MCP** after `env` changes.

### 4. Adding a second rail or changing default

1. When the user **binds a second or additional** payment rail, **never** change the **first** token of **`PAYMENT_METHOD_PRIORITY`** (the current default) **without an explicit user choice**.
2. **Always ask** a clear yes/no (or pick-one) question in the **user’s language**, e.g. “Should **\<rail\>** become the default payment method?” Only if the user answers **yes**, move that rail’s token to the **front**. If **no**, append the new rail or keep existing order as appropriate **without** promoting it to default.
3. **MCP Wallet (`quick_wallet`):** Auth (**Section 1**) still comes **before** any **`PAYMENT_METHOD_PRIORITY`** change that **adds** **`quick_wallet`**; after successful login, apply the same **user-confirmed** rule for whether **`quick_wallet`** becomes default when other rails already exist.
4. Reordering among rails **already** listed (user wants to switch default only): **still** require **explicit confirmation** before editing which token is first.

### 5. Gate Exchange (`gate_exchange`)

If the user configures **exchange-only** pay: ensure **Gate Exchange MCP** is registered separately; set **`PAYMENT_METHOD_PRIORITY`** to include **`gate_exchange`** when that is the intended rail. Payment tools are **only** on the Exchange MCP — read each tool’s **`inputSchema`** there.

---

## Authentication State

Payment and signing use whichever **wallet rail** the user has actually configured. Gate Pay MCP **`env`** is read from the **host’s MCP config** (path and format depend on Cursor, VS Code, Claude Code, etc. — not hardcoded here).

- **`PAYMENT_METHOD_PRIORITY`**: If set in **`env`**, comma-separated; first token = default. Tokens: `quick_wallet`, `plugin_wallet`, `local_private_key`, `gate_exchange`. If **unset**, infer rails only from **non-empty** env keys / MCP session, or ask the user.
- **`local_private_key`**: Only when the user chose this rail: `EVM_PRIVATE_KEY` (and any RPC vars your MCP documents) must be set in **`env`** — never collect private keys in chat. If empty, this rail is unavailable.
- **`quick_wallet` (MCP Wallet):** **Setup** = **login success** via tool auth (**Section 1**: **`x402_quick_wallet_auth`** if present, else **`x402_request`** per schema). **No** **`MCP_WALLET_API_KEY`** for users. Auth **before** writing **`PAYMENT_METHOD_PRIORITY`**; on failure, do **not** change that **`env`**. **Pay:** **Workflow** Step 5; on expiry, auth once then retry sign once.
- **`plugin_wallet`**: **`PLUGIN_WALLET_TOKEN`** in **`env`**; **`PLUGIN_WALLET_SERVER_URL`** not user-mandatory by default (see **Wallet and rails**). If **`inputSchema`** requires a URL argument, comply with schema. If the token is missing, this rail is unavailable.
- **`gate_exchange`**: Gate Exchange MCP configured separately; route there only when that MCP exists and user selects this rail.

When a **second or additional** payment rail is added, **ask** whether the **default** should switch to the **newly bound** rail. **Do not** reorder **`PAYMENT_METHOD_PRIORITY`** until the user **explicitly agrees** to change the default.

---

## Gate Pay x402 Module (MCP Tools)

### How to build `arguments` (mandatory)

Before **every** `CallMcpTool` to Gate Pay MCP:

1. Locate the tool by **exact name** in the MCP tool list (e.g. `x402_request`, `x402_place_order`, `x402_sign_payment`, …).
2. Read that tool's **`inputSchema`**: `properties`, `required`, `enum`, `description`.
3. Assemble `arguments` **only** from that schema and from **allowed** runtime values (user message, context, prior tool outputs).

Do **not** copy parameter tables from this Skill; the **MCP `inputSchema` is the source of truth**. **Any conflict between this file and `inputSchema` → follow `inputSchema`.** If the MCP is not connected and schema is unavailable, complete MCP setup first or use vendor docs.

### Tools (names to look up in MCP)

**Merchant discovery:** The discovery tool’s **exact name** appears in the live MCP tool list when shipped (**placeholder:** `MERCHANT_DISCOVERY_TOOL`). Until then, skip discovery calls.

| Tool | Classification | Side-effect level | Purpose | Parameters |
|------|----------------|-------------------|---------|------------|
| `MERCHANT_DISCOVERY_TOOL` | Read (list) | None (no pay) | **Placeholder name** — merchant discovery: invokable resource list only | **TBD:** real name + **`inputSchema`** when MCP ships |
| `x402_place_order` | Read / HTTP | Merchant I/O only; no sign until later tools | Send merchant HTTP request; read status, headers, body | **See MCP `inputSchema` for `x402_place_order`** |
| `x402_request` | Mixed | **Low** when used for HTTP/login; **High** when schema drives combined sign/pay—still requires consent before any pay | Single-tool npm build: HTTP + optional 402 + signing; also **MCP Wallet** login when schema exposes `quick_wallet` / `sign_mode` | **See MCP `inputSchema` for `x402_request`** |
| `x402_quick_wallet_auth` | Write (session) | Establishes wallet session | **MCP Wallet** device/OAuth auth (`quick_wallet` rail) | **See MCP `inputSchema` for `x402_quick_wallet_auth`** |
| `x402_sign_payment` | Write (pay) | **High** — signs and submits payment | Parse 402, sign, submit payment (all-in-one) | **See MCP `inputSchema` for `x402_sign_payment`** |
| `x402_create_signature` | Write (sign) | **High** — produces signing material | Create signed payload / encoded signature only | **See MCP `inputSchema` for `x402_create_signature`** |
| `x402_submit_payment` | Write (pay) | **High** — submits payment | Submit payment with signature (split path) | **See MCP `inputSchema` for `x402_submit_payment`** |
| `x402_centralized_payment` | Write (pay) | **High** — centralized settlement when server exposes it | Account-center / centralized pay path per MCP (if listed) | **See MCP `inputSchema` for `x402_centralized_payment`** |

Merchant **`url` / `method` / `body`** come from the **user message**, **conversation context**, or **upstream discovery** (resource / `outputSchema` / MCP discovery response — **map** per **`inputSchema`**); map field names to whatever the schema requires (`x402_place_order` or `x402_request`, depending on the connected server).

## Execution workflow

Map user intent to **parameter extraction → MCP connection probe (Step 0) → preflight (`inputSchema` required fields, env rails) → tool calls → user-visible summary**:

1. **Extract** merchant URL/method/body or discovery constraints from the user and context.
2. **Preflight** per **MCP Server Connection Detection** and **Authentication State**; complete **Wallet configuration procedure** if the user is setting up a rail.
3. **Invoke** tools in **Workflow** order; **before each call**, rebuild `arguments` from that tool’s **`inputSchema`**.
4. **Output** per **Report Template**; on failures use **Error handling**.

## Workflow

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
Step 7: Summarize success to the user in their language; **addresses** may be in chat; **private keys** only via terminal/temp-file flow per **Security Rules** and **Wallet configuration procedure** Section 1 step 5
```

**Discovery and pay confirmation (mandatory):** Optional path: **`MERCHANT_DISCOVERY_TOOL`** (real name from MCP when available) → select resource → continue from Step 3–4. **After** the user sees a **clear price** (quote or **402** summary), obtain **explicit pay consent** **before** Step 5–6 (merge with Step 1 if needed to avoid asking twice). Full rules: **GatePay merchant discovery & agent orchestration**.

**Same-server rule:** All steps for **one** merchant order / 402 challenge must use the **same** Gate Pay MCP server identifier (whether that server exposes split tools or only **`x402_request`**).

## Judgment Logic Summary

- Use **Routing Rules** to pick the subsection in this file (wallet setup, discovery, x402 pay, Exchange, MCP connectivity).
- **Schema-first:** Every MCP `arguments` object must match the target tool’s **`inputSchema`**; on conflict, **`inputSchema` wins**.
- **Consent before writes:** No signing, submission, or centralized payment tools until **clear price** + **explicit user confirmation**; confirmation covers **all** write steps in the flow (**General Rules**).
- **Same-server:** One 402 challenge → one Gate Pay MCP server id for all related **`x402_*`** calls.
- **Rails:** Only switch or add default **`PAYMENT_METHOD_PRIORITY`** per **Section 4** (explicit user choice).

## Report Template

After wallet setup or payment, respond in the **user’s language** with:

- **Outcome:** success, failed, cancelled, or blocked (with reason).
- **Amounts / assets / chain** when the MCP or merchant returned them; **never** invent values.
- **References** from tool output (ids, hashes) only when present.
- **Next steps:** retry, change rail, reload MCP, or end—without fabricating order or payment status.

## Error handling

| Situation | Suggested action |
|-----------|------------------|
| MCP timeout / transport error | Retry once; if it persists, suggest restarting the MCP host or checking network; re-run **MCP Server Connection Detection**. |
| Auth expired / `quick_wallet` not ready | Run **`x402_quick_wallet_auth`** or **`x402_request`** per schema; then retry sign **once** before escalating. |
| User declines pay after seeing price | **Stop**; do not call sign/pay tools; offer another merchant or end. |
| 402 / insufficient balance | Surface MCP error text; suggest another configured rail **only** if available **and** the user agrees (**Wallet and rails**). |
| 402 challenge missing or unparsable | Do not invent payment params; re-run **`x402_place_order`** / **`x402_request`** per schema or ask the user for merchant context; never fake a successful pay. |
| Missing tool / no `inputSchema` | Finish install from the setup guide; do not guess parameters. |

## Data handling & eligibility

- **Data flow:** Instructions and non-secret parameters go through the user’s MCP client to the **Gate Pay MCP** (`gatepay-local-mcp`) and its backends as implemented by that package. **Secrets** (`EVM_PRIVATE_KEY`, full `PLUGIN_WALLET_TOKEN`, private keys from tool output) stay in **local MCP env** or **integrated terminal** flows—**not** in chat (**Security Rules**).
- **Age:** Payment and account-linked flows assume the user is **18+** and complies with applicable Gate user agreements; do not proceed with payment setup if the user cannot meet those requirements.

---

## Sub-Modules

This skill uses **single-file routing** for all procedural logic: wallet setup, discovery, workflow, and Exchange path all live in this `SKILL.md`. Use **Routing Rules** to jump to those sections. The only separate file in the package is **`references/scenarios.md`** (test prompts and expected behavior for QA—**not** a routing submodule).

---

## Gate Exchange path

When `gate_exchange` is selected and Gate Exchange MCP is available: use **only** Exchange MCP tools for order/pay. Before each call, read **that** tool's **`inputSchema`** on the Exchange server. Do not complete the same Gate Pay `x402_place_order` order using a third-party x402 MCP.

---

## Follow-up Routing

| User Intent After Flow | Target |
|------------------------|--------|
| Change default payment / add second wallet | This file — **Wallet configuration procedure** Section 4 |
| Retry after MCP Wallet (`quick_wallet`) expiry | This file — **Workflow** Step 5–6 |
| Merchant params missing | Ask user or upstream; then **Step 4** with schema-compliant `x402_place_order` or `x402_request` |
| Discovery empty / cannot select | **GatePay merchant discovery & agent orchestration** — relax constraints or stop |
| User declines pay after seeing price | Stop pay tools; offer another merchant or end |
| Plugin rail failed, no other configured rail | **GatePay merchant discovery & agent orchestration** — do not auto-start unconfigured `quick_wallet` |

---

## Cross-Skill Collaboration

Other skills or upstream layers may supply merchant **`url` / `method` / `body`** or discovery context. This skill **orchestrates** discovery → selection → optional quote → pay confirmation → Gate Pay MCP **`x402_*`** (and optionally Gate Exchange MCP) using **`inputSchema`** for each tool call. It does not replace full merchant catalogs outside the MCP surface.

---

## Supported networks & assets

Networks, tokens, and amounts are defined by the **merchant 402 / payment-required payload** and MCP behavior — not enumerated here. Follow tool responses and merchant rules.

---

## Security Rules

1. **Schema-first calls:** Always align `arguments` with the target tool's **`inputSchema`** before invoking MCP. **Skill vs `inputSchema` → `inputSchema` wins** (same as top **Gate Pay x402 layer** note and **How to build `arguments`**).
2. **Sensitive payloads — MCP Wallet (`quick_wallet`):** **Private keys, seeds, and exported signing secrets** from the tool go **only** to the **integrated terminal** (or gitignored temp file + terminal pointer), **never** the agent chat — see **Wallet configuration procedure** Section 1 step 5; works on **Windows, macOS, Linux** via `node`/`python` or file fallback. **Public deposit / wallet addresses** may appear in chat. Do **not** dump huge raw JSON into chat; redact secrets in chat.
3. **Private keys — rails and user paste:** **`local_private_key`:** User sets **`EVM_PRIVATE_KEY`** only in local MCP **`env`** — **never** collect or repeat that key in chat (**Section 3**). **MCP Wallet:** Tool-returned secrets → terminal only (**Section 1** step 5). **If the user pastes any private key in chat:** **do not** echo it, store it from chat, or sign from chat; tell them to put it **only** in **`env`** and to stop sending keys in chat. Signing uses **env** as MCP reads it.
4. **Open API tokens**: Store in **`env`**; mask or confirm in chat without exposing full values.
5. **Same-server / no cross-vendor mix** for one Gate `x402_place_order` order: see **Workflow**.
6. **Session vs chat**: Do not rely on chat memory for MCP Wallet login state; use **`x402_quick_wallet_auth`** and/or **`x402_request`** (per live tool list) and MCP responses as documented.
