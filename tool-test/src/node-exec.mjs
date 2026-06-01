//执行 shell 命令的工具代码模板
import { spawn } from 'node:child_process';

const command = 'ls -la';
//获取当前工作目录
const cwd = process.cwd();

// 解析命令和参数
const [cmd, ...args] = command.split(' ');
//创建子进程执行命令
const child = spawn(cmd, args, {
  cwd,
  stdio: 'inherit', // 实时输出到控制台
  shell: true,
});

let errorMsg = '';

child.on('error', (error) => {
  errorMsg = error.message;
});

child.on('close', (code) => {
  if (code === 0) {
    process.exit(0);
  } else {
    if (errorMsg) {
      console.error(`错误: ${errorMsg}`);
    }
    process.exit(code || 1);
  }
});
