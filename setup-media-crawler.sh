#!/bin/bash
set -e

echo "=== 初始化 MediaCrawler 子模块 ==="
git submodule update --init

cd MediaCrawler

echo ""
echo "=== 应用 xhshow 兼容性补丁 ==="
git apply ../xhshow-fix.patch
echo "补丁已应用"

echo ""
echo "=== 创建 Python 虚拟环境 ==="
python3 -m venv venv

echo ""
echo "=== 安装 Python 依赖 ==="
venv/bin/pip install -r requirements.txt

echo ""
echo "=== 完成 ==="
echo "MediaCrawler 已就绪，可使用 MCP 爬虫功能。"
echo "注意：首次使用某平台前，需先用 --lt qrcode 模式扫码登录保存 cookie。"
