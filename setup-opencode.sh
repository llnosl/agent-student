#!/bin/bash
set -e

PROJECT_ROOT=$(cd "$(dirname "$0")" && pwd)

echo "=== 链接 OpenCode 配置 ==="
if [ -L ~/.config/opencode ]; then
  echo "已存在软链接，跳过"
else
  rm -rf ~/.config/opencode 2>/dev/null
  ln -sfn "$PROJECT_ROOT/opencode-config" ~/.config/opencode
  echo "已链接 ~/.config/opencode -> $PROJECT_ROOT/opencode-config"
fi

echo ""
echo "=== 安装 OpenCode 插件依赖 ==="
cd "$PROJECT_ROOT/opencode-config" && npm install

echo ""
echo "=== 完成 ==="
echo "请确保 ~/.zshrc 中已设置以下环境变量："
echo "  export OPENAI_API_KEY=\"sk-xxx\""
echo "  export DEEPSEEK_API_KEY=\"sk-xxx\""
echo "  export FIGMA_API_KEY=\"figd-xxx\""
