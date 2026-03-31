# Gate Pay x402 — MCP & Skill setup

**Gate Pay x402** brings **Gate Pay**’s x402 payment stack to AI agents: wallet rails, signing, and paid HTTP flows through **MCP** and one skill—drivable in **natural language**.

Built by **Gate**. Built for the **crypto community**.

This guide installs the **[gatepay-local-mcp](https://github.com/gate/gatepay-local-mcp)** MCP server and the **gatepay-x402** skill. It applies to common agent hosts including **Cursor**, **OpenClaw**, and **Claude Code**. Use the quick prompt below with your **AI agent**, or follow the manual steps.

**This document in the repo:** `docs/gatepay-x402.md`

---

## What you will install

| Component | Purpose |
|-----------|---------|
| **MCP server** `gatepay-local-mcp` | Runs as `npx -y gatepay-local-mcp` and handles x402 payment flows. See the [package README](https://github.com/gate/gatepay-local-mcp/blob/master/Readme.md). |
| **Skill `gatepay-x402`** | Guides your AI agent on wallet setup, payment routing, and calling Gate Pay MCP tools using each tool’s `inputSchema`. |

**Skill source in the repository:** [skills/SKILL.md](https://github.com/gate/gatepay-local-mcp/blob/master/skills/SKILL.md)  
**Raw file (for download / copy):** `https://raw.githubusercontent.com/gate/gatepay-local-mcp/master/skills/SKILL.md`

If your fork uses `skills/gatepay-x402/SKILL.md`, use:

`https://raw.githubusercontent.com/gate/gatepay-local-mcp/master/skills/gatepay-x402/SKILL.md`

### Why `gatepay-x402/SKILL.md`?

Agent hosts (Cursor, Claude Code, OpenClaw, Codex, and similar) load skills from a **folder per skill** with a fixed entry file named **`SKILL.md`**. The folder name is the skill id on disk; **`gatepay-x402`** matches the skill’s declared **`name`** in the YAML frontmatter, avoids clashes with other skills, and matches paths used in docs and tooling. Putting the file anywhere else or renaming it usually means the host **won’t pick it up** or may load the wrong skill.

---

## Prerequisites

- A host that supports **MCP** and **skills** (e.g. Cursor, OpenClaw, Claude Code, Codex).
- **Node.js** with **npm** so `npx` works (`gatepay-local-mcp` is started through `npx`).
- Permission to edit MCP and skills config on your machine.

---

## Quick start (natural language)

Use the **same** one-line style for any host. Replace the URL if your **branch** or fork differs (`master` shown).

> **Help me install Gate Pay MCP and the gatepay-x402 skill:**  
> `https://github.com/gate/gatepay-local-mcp/blob/master/docs/gatepay-x402.md`

Your **AI agent** should open that guide and apply the steps for your host. Then **reload MCP** or **restart the app** as required.

---

## MCP server registration

Start the server with:

```bash
npx -y gatepay-local-mcp
```

Register it as a **stdio** MCP process with that command. **Merge** the Gate Pay entry with existing servers—**do not remove** other MCPs.

### Optional environment variables

Put these in the MCP server **env** for your host only when you use that mode. **Never** paste private keys or full tokens into chat.

| Variable | When needed |
|----------|-------------|
| `EVM_PRIVATE_KEY` | Local EVM signing (`local_private_key`). |
| `PLUGIN_WALLET_SERVER_URL` | Plugin wallet mode, if your build or docs require it. |
| `PLUGIN_WALLET_TOKEN` | Plugin wallet Open API token. |
| `PAYMENT_METHOD_PRIORITY` | Comma-separated order, e.g. `quick_wallet,plugin_wallet,local_private_key` (first = default). |

More detail: [gatepay-local-mcp Readme — Environment variables](https://github.com/gate/gatepay-local-mcp/blob/master/Readme.md).

### Example: `mcp.json` fragment (Cursor-style hosts)

Project file: `<project>/.cursor/mcp.json`. User-wide: `~/.cursor/mcp.json`. Merge under `mcpServers`:

```json
"gatepay-local-mcp": {
  "command": "npx",
  "args": ["-y", "gatepay-local-mcp"],
  "env": {}
}
```

### Claude Code

Add a stdio MCP server with command `npx` and args `-y`, `gatepay-local-mcp` (see current [Claude Code MCP documentation](https://docs.anthropic.com)).

### OpenClaw

Register the same stdio command in OpenClaw’s MCP settings ([OpenClaw MCP guide](https://www.getopenclaw.ai/help/tools-skills-mcp-guide)); restart the gateway if needed.

### Other hosts

Any MCP client over stdio can use the same command and `env` block.

---

## Skills installation guide

### 1. Check `npx`

```bash
npx -v
```

If a version appears (e.g. `11.8.0`), you are set. Otherwise see [Appendix: Install npx on macOS](#appendix-install-npx-on-macos) or [nodejs.org](https://nodejs.org/en/download).

### 2. Recommended: natural language

Ask your **AI agent** to follow:

`https://github.com/gate/gatepay-local-mcp/blob/master/docs/gatepay-x402.md`

It should fetch the **raw** skill file and write **`gatepay-x402/SKILL.md`** in the correct skills root for your host.

### 3. Manual installation — where to put `SKILL.md`

Create **`gatepay-x402/SKILL.md`** (folder + filename as above).

| Host | Typical path |
|------|----------------|
| **Cursor** | `<project>/.cursor/skills/gatepay-x402/SKILL.md` |
| **Claude Code** | `~/.claude/skills/gatepay-x402/SKILL.md` |
| **Codex CLI** | `~/.codex/skills/gatepay-x402/SKILL.md` |
| **OpenClaw** | `~/.openclaw/skills/gatepay-x402/SKILL.md` |

**Download:**

```bash
mkdir -p gatepay-x402
curl -fsSL "https://raw.githubusercontent.com/gate/gatepay-local-mcp/master/skills/SKILL.md" -o gatepay-x402/SKILL.md
```

Move the `gatepay-x402` folder into that host’s skills directory.

### 4. Cursor — short checklist

1. Merge MCP entry into `.cursor/mcp.json` (see [fragment above](#example-mcpjson-fragment-cursor-style-hosts)).  
2. Place `.cursor/skills/gatepay-x402/SKILL.md`.  
3. Reload MCP or restart Cursor.

### 5. Claude Code — short checklist

1. Same [quick start](#quick-start-natural-language) prompt, **or** copy skill to `~/.claude/skills/gatepay-x402/SKILL.md`.  
2. Register MCP (`npx -y gatepay-local-mcp`) per Claude Code docs.  
3. Restart or reload if your build requires it.

### 6. OpenClaw — short checklist

1. Same [quick start](#quick-start-natural-language) prompt, **or** copy skill to `~/.openclaw/skills/gatepay-x402/SKILL.md`.  
2. Register MCP in OpenClaw config.  
3. Restart the gateway or service.

### 7. Codex CLI — short checklist

1. Same [quick start](#quick-start-natural-language) prompt, **or** copy skill to `~/.codex/skills/gatepay-x402/SKILL.md`.  
2. Add the MCP server per Codex docs.  
3. Restart Codex or run `/skills` to verify.

---

## Verify installation

- [ ] MCP lists a server running `gatepay-local-mcp` via `npx -y gatepay-local-mcp`.
- [ ] `gatepay-x402/SKILL.md` exists under your host’s skills path and includes YAML frontmatter (`name`, `version`, etc.).
- [ ] You reloaded MCP or restarted the host after changes.
- [ ] Secrets live only in local MCP **env**, not in chat.

---

## Security

- Do **not** paste **private keys** or **full API tokens** into agent chat; use MCP **env** only.
- Follow the skill and your host’s security guidance for wallet flows.

---

## Appendix: Install npx on macOS

1. Check:

   ```bash
   npx -v
   ```

   If a version prints, stop here.

2. If missing, either:

   **Homebrew**

   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   brew install node
   npx -v
   ```

   **Or** install Node from [nodejs.org/en/download](https://nodejs.org/en/download).

3. Confirm with `npx -v` again.

---

## Reference links

- [gatepay-local-mcp repository](https://github.com/gate/gatepay-local-mcp)
- [gatepay-local-mcp Readme](https://github.com/gate/gatepay-local-mcp/blob/master/Readme.md)
- [Gate Skills marketplace](https://github.com/gate/gate-skills)
