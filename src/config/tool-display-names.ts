import toolDisplayNames from "./tool-display-names.json";

const TABLE = toolDisplayNames as Record<string, string>;

/**
 * MCP 工具英文名 → 中文展示名（埋点 `tool_name_cn`）。
 * 未配置时回退为原始 `toolName`，避免上报空串。
 */
export function getToolDisplayName(toolName: string): string {
  const v = TABLE[toolName];
  return typeof v === "string" && v.trim() !== "" ? v : toolName;
}

/** 供文档 / 测试枚举全部已登记工具名 */
export function listTrackedToolNames(): string[] {
  return Object.keys(TABLE);
}
