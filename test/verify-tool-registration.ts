/**
 * 验证新增的 x402_centralized_payment tool 是否正确注册
 */

import { getPublicTools } from "../src/tools/schemas.js";

console.log("=== MCP Tools 列表 ===\n");

const tools = getPublicTools();

console.log(`总计 ${tools.length} 个工具:\n`);

tools.forEach((tool, index) => {
  console.log(`${index + 1}. ${tool.name}`);
  console.log(`   描述: ${tool.description.substring(0, 100)}...`);
  console.log(`   必需参数: ${tool.inputSchema.required?.join(", ") || "无"}`);
  console.log();
});

// 查找新增的 tool
const centralizedPaymentTool = tools.find(t => t.name === "x402_centralized_payment");

if (centralizedPaymentTool) {
  console.log("✓ x402_centralized_payment 工具已成功注册!\n");
  console.log("完整信息:");
  console.log(JSON.stringify(centralizedPaymentTool, null, 2));
} else {
  console.error("✗ 未找到 x402_centralized_payment 工具");
  process.exit(1);
}
