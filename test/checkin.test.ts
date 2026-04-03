import { txCheckin } from "../src/modes/tx-checkin/checkin.js";

const mcpToken = "mcp_pat_eyJzdWIiOiJjNTk1MDQyNy1iYzlkLTQyNDgtYjA5ZS0yYzI0MWYyYTY0Y2EiLCJ1c2VyX2lkIjoiYzU5NTA0MjctYmM5ZC00MjQ4LWIwOWUtMmMyNDFmMmE2NGNhIiwiYWNjb3VudF9pZCI6IjYwMmEzOGMyLTUyNGItNDhjNi1hY2Q0LWI5Mjg4NDYyODkyZCIsImlhdCI6MTc3NTE0MTU5MCwiZXhwIjoxNzc3NzMzNTkwLCJqdGkiOiIxOTVhM2I5OS02MGU0LTQyYzctOGVkZi04MTFjZTBmMDY1OWYifQ.EDs9fn6wqVJTvEyPunf5Xo5HTF0UqWpjW2qzN0s4kgk";

const result = await txCheckin({
  mcpToken,
  walletAddress: "0x99fcb753d1d539dfa4514c0e1a80ba17862b5fa1",
  chain: "eth",
  chainCategory: "evm",
  message: "Welcome to Uniswap! Nonce: abc123",
  verbose: true,
});

console.log(JSON.stringify(result, null, 2));
