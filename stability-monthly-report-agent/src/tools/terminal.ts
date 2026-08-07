import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const execAsync = promisify(exec);

/**
 * 创建终端执行工具，用于运行 npm、git、测试和构建等本地命令。
 */
export function createTerminalTool(defaultWorkingDirectory?: string) {
  return new DynamicStructuredTool({
    name: 'run_terminal_command',
    description: '在本地终端执行命令。适合运行 npm、git、测试脚本、构建脚本等。修复链路默认在当前服务对应的本地项目目录执行。',
    schema: z.object({
      command: z.string().describe('需要执行的终端命令'),
      cwd: z.string().optional().describe('命令执行目录；修复链路默认使用当前服务在 .env 中配置的本地项目路径'),
    }),
    func: async ({ command, cwd }) => {
      const workingDirectory =
        cwd || defaultWorkingDirectory || process.env.COMMAND_WORKDIR || process.cwd();
      const { stdout, stderr } = await execAsync(command, {
        cwd: workingDirectory,
        timeout: 120_000,
        maxBuffer: 1024 * 1024 * 5,
      });

      return [
        `cwd: ${workingDirectory}`,
        stdout ? `stdout:\n${stdout}` : '',
        stderr ? `stderr:\n${stderr}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    },
  });
}
