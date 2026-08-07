import { MultiServerMCPClient } from '@langchain/mcp-adapters';

/**
 * 读取允许访问的本地目录列表，供 filesystem MCP server 限定读写范围。
 */
export function getAllowedPaths() {
  return (process.env.ALLOWED_PATHS || process.cwd())
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 创建 filesystem MCP 客户端，为 Agent 提供允许目录内的本地文件读写能力。
 */
export function createMcpClient() {
  return new MultiServerMCPClient({
    throwOnLoadError: true,
    mcpServers: {
      filesystem: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', ...getAllowedPaths()],
      },
    },
  });
}
