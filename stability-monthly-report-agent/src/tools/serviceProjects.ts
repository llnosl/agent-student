import { readFile } from 'node:fs/promises';
import path from 'node:path';

type ServiceProjects = Record<string, string>;

/**
 * 读取线上服务项目映射；不要在该文件保存负责人本机绝对路径。
 */
export async function readServiceProjects() {
  const configPath = path.join(process.cwd(), 'config', 'service-projects.json');
  const content = await readFile(configPath, 'utf8');
  return JSON.parse(content) as ServiceProjects;
}

/**
 * 将服务名转换成负责人本地环境变量名。
 *
 * 例如:
 * - ewms -> SERVICE_PROJECT_PATH_EWMS
 * - fppc-pda-wap -> SERVICE_PROJECT_PATH_FPPC_PDA_WAP
 */
export function getServiceProjectEnvKey(serviceName: string) {
  const suffix = serviceName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return `SERVICE_PROJECT_PATH_${suffix}`;
}

/**
 * 从负责人本机 .env 获取服务对应的本地项目路径。
 *
 * config/service-projects.json 保留给线上项目映射，不存放个人电脑绝对路径。
 */
export async function getServiceProjectPath(serviceName: string) {
  const envKey = getServiceProjectEnvKey(serviceName);
  const projectPath = process.env[envKey]?.trim();

  if (!projectPath) {
    throw new Error(`缺少本地项目路径环境变量 ${envKey}（服务: ${serviceName}）`);
  }

  return path.resolve(projectPath);
}
