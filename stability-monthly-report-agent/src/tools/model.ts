import { ChatOpenAI } from '@langchain/openai';

/**
 * 从环境变量创建 OpenAI 兼容的 LangChain 聊天模型实例。
 */
export function createModel() {
  const { MODEL_NAME, MODEL_BASE_URL, MODEL_API_KEY } = process.env;

  if (!MODEL_NAME || !MODEL_BASE_URL || !MODEL_API_KEY) {
    throw new Error('请在 .env 中配置 MODEL_NAME、MODEL_BASE_URL 和 MODEL_API_KEY');
  }

  return new ChatOpenAI({
    model: MODEL_NAME,
    apiKey: MODEL_API_KEY,
    configuration: {
      baseURL: MODEL_BASE_URL,
    },
  });
}
