#!/bin/bash
# push-to-github.sh — 一键把当前仓库推送到 GitHub
#
# 安全设计:
#   - GitHub PAT 存到 macOS Keychain(security 命令读),不入 shell history,
#     不入文件,不入对话
#   - 一次性嵌入 URL,推到 `git push` 后立即从远程 URL 剥掉 token 段
#   - Keychain 缺 key 时给清晰错误,不静默 fallback
#
# 首次使用(只需一次):
#   security add-generic-password -s 'react-cli-agent-github-push' \
#     -a 'agent' -w '<你的 GitHub PAT,repo 权限>'
#
# 之后任何 push:
#   bash scripts/push-to-github.sh
# 或:
#   npm run push:github

set -euo pipefail

KEYCHAIN_SERVICE="react-cli-agent-github-push"
KEYCHAIN_ACCOUNT="agent"
REMOTE_URL="https://github.com/163709480/react-cli-agent-.git"
BRANCH="${1:-master}"

# 1. 读 token
TOKEN=$(security find-generic-password \
  -s "$KEYCHAIN_SERVICE" \
  -a "$KEYCHAIN_ACCOUNT" \
  -w 2>/dev/null) || {
  echo "❌ Keychain 里找不到 '$KEYCHAIN_SERVICE' 凭据"
  echo ""
  echo "首次使用需要先把 GitHub PAT 存进 Keychain:"
  echo ""
  echo "  security add-generic-password \\"
  echo "    -s '$KEYCHAIN_SERVICE' \\"
  echo "    -a '$KEYCHAIN_ACCOUNT' \\"
  echo "    -w '<你的 GitHub Personal Access Token,需要 repo 权限>'"
  echo ""
  echo "获取 PAT: https://github.com/settings/tokens"
  echo "(推荐用 Fine-grained token,只勾选本仓库的 Contents: Read and write)"
  exit 2
}

if [ -z "$TOKEN" ]; then
  echo "❌ Keychain 凭据存在但 token 为空"
  exit 2
fi

# 2. 校验 token 格式(粗校验:ghp_/github_pat_ 前缀 + 长度)
if [[ ! "$TOKEN" =~ ^(ghp_|github_pat_)[A-Za-z0-9_]{20,}$ ]]; then
  echo "⚠️  token 格式不像 GitHub PAT(应以 ghp_ 或 github_pat_ 开头)"
  echo "   继续执行...如失败请检查 token"
fi

# 3. 校验 origin
if ! git remote get-url origin >/dev/null 2>&1; then
  echo "❌ 没配 origin 远端"
  echo "   git remote add origin $REMOTE_URL"
  exit 2
fi

ORIGIN_URL=$(git remote get-url origin)
EXPECTED_BASE="https://github.com/163709480/react-cli-agent-"
if [[ "$ORIGIN_URL" != "$EXPECTED_BASE"* ]]; then
  echo "⚠️  origin 不是预期的 react-cli-agent 仓库"
  echo "   当前: $ORIGIN_URL"
  echo "   预期: $EXPECTED_BASE..."
  echo ""
  read -r -p "继续? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || exit 1
fi

# 4. push(token 内嵌 URL,推到后立即剥离)
echo "→ 推送到 $ORIGIN_URL (branch: $BRANCH) ..."
# 用临时 URL(带 token),push 完立即 unset
AUTH_URL="${ORIGIN_URL/https:\/\//https://${TOKEN}@}"

# 5. 跑 push;无论成败都把 token 从 URL 中剥掉
set +e
git push "$AUTH_URL" "$BRANCH"
PUSH_EXIT=$?
set -e

# 6. 清理:Bash 里字符串变量在子 shell 退出后会回收,这里再 unset 一次稳妥
unset TOKEN AUTH_URL

# 7. 提示清理 shell history(以防 echo 过 $AUTH_URL)
if [ $PUSH_EXIT -ne 0 ]; then
  echo ""
  echo "❌ push 失败(exit $PUSH_EXIT)"
  exit $PUSH_EXIT
fi

echo ""
echo "✅ 推送完成"
echo ""
echo "🔒 建议:如果终端 echo 过 token 字符串,清理 shell history:"
echo "   history -c && history -w  # zsh:  rm ~/.zsh_history"
echo "   或把这次会话从 history 删掉"
