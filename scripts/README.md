# scripts/

本地工具脚本。**不进 CI,不入 npm package,只在你本机跑**。

## push-to-github.sh

把当前仓库推到 `https://github.com/163709480/react-cli-agent-`。

**安全设计**:GitHub PAT 存 **macOS Keychain**,不入 shell history、不入文件、不入对话。脚本里 token 是一次性内嵌到 URL,push 完立即 unset。

---

### 一次性配置(只需一次,以后不再问)

1. 生成 token:打开 https://github.com/settings/tokens
   - 选 **Fine-grained token**
   - **Resource owner**: `163709480`
   - **Repository access**: **Only select repositories** → 选 `163709480/react-cli-agent-`
   - **Permissions** → **Repository permissions** → **Contents**: `Read and write`
   - 生成 → 复制(只显示一次!)

2. 把 token 存进 Keychain(**在 terminal 跑,不要贴到对话**):

```bash
security add-generic-password \
  -s 'react-cli-agent-github-push' \
  -a 'agent' \
  -w '<这里贴你的 PAT>'
```

无输出 = 成功。`security find-generic-password -s 'react-cli-agent-github-push'` 找不到时确认名字拼写。

### 日常用法

```bash
# 推 master(默认)
npm run push:github

# 推其他分支
bash scripts/push-to-github.sh main
```

脚本会:
1. 从 Keychain 读 token
2. 校验 token 格式(以 `ghp_` 或 `github_pat_` 开头)
3. 校验 origin 是预期的 react-cli-agent 仓库(防误推)
4. 内嵌 token 到 URL,push,然后 unset
5. 成功/失败都给清晰提示

### 撤销 / 更新 token

```bash
# 删掉旧 token
security delete-generic-password -s 'react-cli-agent-github-push'

# 重新跑上面的"一次性配置"
```

或者直接到 https://github.com/settings/tokens 撤销,然后重新 add-generic-password 即可。

### 常见失败

| 报错 | 原因 | 解决 |
|---|---|---|
| `Keychain 里找不到 ...` | 还没配 / 配错名 | 跑上面 setup |
| `token 格式不像 GitHub PAT` | 复制时多了空格 / 复制错了 | 重新 add-generic-password |
| `origin 不是预期的 react-cli-agent 仓库` | remote URL 写错 | `git remote set-url origin https://github.com/163709480/react-cli-agent-.git` |
| `403 Permission denied` | token 权限不够 / 没限定到本 repo | 重新生成 fine-grained token,选对 repo + Contents: Read and write |
| `Repository not found` | 仓库名拼错 / 仓库没创建 | 到 https://github.com/163709480 核对 |

### 我能用 AI 帮我跑这个脚本吗?

**能**。这就是脚本存在的目的。`npm run push:github` 在对话里发给我让我跑,**token 全程只在 Keychain 和 git push URL 里,不会出现在对话里**。

> ⚠️ **不要**直接把 token 贴到对话。任何 token 只要贴到对话就算泄漏,必须立刻撤销。
