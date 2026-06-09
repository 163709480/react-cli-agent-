# 从 claude-code-book 借鉴的架构建议

> 调研时间:2026-06-06
> 参照:《御舆:解码 Agent Harness — Claude Code 架构深度剖析》(15 章 + 4 附录,42 万字,139 张图)
> 调研范围:全书 15 章 + 4 附录,重点 Part 1(基础)、Part 2(核心系统)、Part 3(高级模式)、Part 4(工程实践)
> 评估对象:react-cli-agent v0.2.0(我们当前状态)
>
> 目的:把 Claude Code 体系化的设计经验,转化为**我们能落地的具体改造项**。不是要照抄 Claude Code,而是看哪些"原则"和"模式"能在不引入 LangChain / Vercel AI SDK 的前提下,自然地嵌入我们 ~3000 行的代码库。

---

## 0. 一句话总结

Claude Code 与我们最大的区别不在"功能多少",而在"**架构的边界完整性**"——Claude Code 把"可扩展点 + 可观测性 + 可安全运营"都做成了一等公民(钩子/记忆/缓存/SHA-256 审计/4 层权限管线);我们的优势是**单进程、可读、合规审计自成一档**(SHA-256 JSONL 在 v0.2 是亮点),但在**工具编排、子 agent、配置治理、可扩展性、缓存友好**几个方向上还有明显的成长空间。

> **借鉴策略**:**先补"安全与可观测性"短板**(权限管线、并发调度、缓存感知),**再做"渐进式扩展"**(钩子→配置→记忆),**最后再考虑子 agent / MCP**(那是 1.0 之后的事)。

---

## 1. 现状对比速查表

| 维度 | Claude Code (v0) | 我们 (v0.2.0) | 差距 |
|------|------------------|----------------|------|
| **核心循环** | AsyncGenerator + `while(true)` + 7+ 种 continue 路径 | 同步 `for/while` + 5 个 `finishReason` | 模式可借鉴,但功能层我们已够用 |
| **依赖注入** | `QueryDeps` 4 依赖注入 | 直接 import,无 DI | 阻碍测试覆盖循环分支 |
| **状态管理** | 34 行 Store + `useSyncExternalStore` | 类组件 + setState | React 那一层可以重写 |
| **工具协议** | `Tool<I,O,P>` 五要素 + `buildTool` 工厂 | `ToolDef<I,In>` 三要素 + 手写 | 缺并发声明、UI 渲染钩、上下文修改器 |
| **工具数量** | 45+ 内置 + MCP 动态 | 7 个手写 | 量级差距,但符合"不臃肿"目标 |
| **并发调度** | `partitionToolCalls` 分区贪心 | **完全没有**,单 tool 串行 | ⚠️ 真·性能瓶颈 |
| **流式执行** | `StreamingToolExecutor` 4 阶段状态机 | 模型流式,工具流式**未做** | ⚠️ 长 tool 调用会卡 UI |
| **权限管线** | 4 阶段管线(validate→rules→check→ask)+ 5 模式谱系 | 3 级 `safety: safe/confirm/dangerous` + `yolo` | 缺规则匹配、ask/allow/deny 模式 |
| **配置系统** | 6 层(5 配置源 + plugin),深合并 + 数组拼接去重 | 3 层(env + `~/.agent/config.json` + CLI flag) | 缺 project 共享、enterprise policy |
| **功能开关** | 编译时 `feature()` + 运行时 GrowthBook | 无 | 短期不需要 |
| **状态存储** | 极简 34 行 Store + DeepImmutable | React `useState` / `useReducer` | 等规模到 4.0 再说 |
| **钩子系统** | 26 个事件 × 5 种钩子类型(CLI/Prompt/Agent/HTTP/Function) | **无** | 高级功能,中期再做 |
| **记忆系统** | 4 闭合类型(feedback/project/user/reference)+ Fork 后台提取 | **无** | 用户刚需,中期可做 |
| **上下文压缩** | 4 级(Snip/MicroCompact/Collapse/AutoCompact)+ 断路器 + 双阶段 prompt | L1 mid-turn + L4 hot cut + 摘要,断路器/双阶段 prompt **未做** | 已有 4 层中的 2 层,差微压缩 + 断路器 |
| **流式架构** | QueryEngine + 流式 token + 增量 JSON 解析 | 模型侧流式 OK,工具侧**未做** | 中期 |
| **Plan 模式** | EnterPlanMode/ExitPlanMode + 工作流 | **无** | 中期 |
| **子 agent** | 4 内置(Explore/Plan/General/Verification)+ Fork + Coordinator | **无**(v0.1 文档明确不做) | 1.0 之后再说 |
| **MCP** | 8 传输协议 + Bridge | **无** | 1.0 之后再说 |
| **可观测性** | metrics 计数器 + 4 层 + 增长遥测 | metrics 有基础(llmTurns/toolCalls/compressions/hotCuts) | 已够用,不必追平 |
| **审计日志** | (无类似系统,Claude Code 没有 SHA-256 链) | **SHA-256 哈希链 JSONL,可离线验证** | ✅ **我们是领先的** |
| **沙箱** | (更多在权限管线和 Bash 工具内) | `resolveWithinCwd` + ext 白名单 + realpath 跟随 | ✅ 干净 |
| **危险操作确认** | PreToolUse hook + ask/deny/approve | 红双线框 + 必须 `y` 确认 | ✅ UX 优秀 |
| **依赖数** | 100+ (Node.js + 50+ 内置工具) | 10 runtime | ✅ **我们有显著优势** |

> **结论**:**审计 + 沙箱 + 依赖数 + UX** 是我们当前的 4 大优势,值得保留和宣传;**并发调度 / 工具协议 / 上下文压缩完整度 / 配置治理** 是最值得补的 4 个短板。

---

## 2. 可借鉴的 5 大设计原则(摘自第 1、15 章)

这 5 个原则贯穿全书,也是构建任何 Agent Harness 的"母原则"。我们不一定要 100% 实现,但**内核应该认**:

### 原则一:异步流式优先(Async Generator First)
> **Claude Code**:整个对话循环是 `async function*`,通过 `yield` 推流,`for await...of` 消费,`.return()` 取消,`yield*` 委托。
>
> **我们**:loop.ts 用 `while(continueLoop)` + 内部 `for await (const ev of gen)` 处理模型流;**但 loop 整体不是 async generator**,而是 `async function runTurn() → RunTurnResult`。
>
> **可借鉴点(优先级低)**:
> - 现状下,UI 通过 `onEvent` 回调消费,和 `for await` 等价,无阻塞。
> - **唯一缺的是"中断后的流式事件恢复"**——用户 Ctrl+C 后,如果还能继续,理想是接着 yield 剩余事件而不是重头跑。
> - **建议**:不改 loop 形态,但在 `runTurn` 返回时,如果有部分已收集的 `textBuf` / `toolCalls`,应该被保留在 `messages` 里。这点我们**已经做到了**——`messages.push(assistantMsg)` 在 break 之前就执行。
> - **结论**:✅ 此项无需改造。

### 原则二:安全边界内嵌(Security at the Perimeter)
> **Claude Code**:四阶段权限管线(validateInput → hasPermissionsToUseTool → checkPermissions → 交互式提示),deny 规则永远优先。
>
> **我们**:三档 `safety`(`safe`/`confirm`/`dangerous`)+ `yolo` 开关 + `onConfirm` 回调。**已经内嵌到工具定义中,沙箱独立运行**。
>
> **可借鉴点(优先级中)**:
> - 我们的 `safety: 'confirm' | 'dangerous'` 实际上是 **"is this tool asking the user?"** 的布尔——但 `dangerous` 和 `confirm` 在我们的代码里是同等处理(都弹框,见 loop.ts:218)。这是可以更精细化的。
> - **建议**(v0.3 小改动):
>   - 把 `safety` 重命名为 `permissionHint`,字段含义:"默认安全 / 默认询问 / 总是拒绝"。
>   - 加一个 `permissionRuleMatch(args, rules)` 函数,支持 `Bash(rm -rf *)` 这样的模式(我们没有 bash 工具,但 `edit_file` / `delete_file` 可以加 `path: *` 规则)。
>   - 引入 `.agent/permissions.json`(项目级),支持 `allow` / `deny` / `ask` 三档。
>   - **优先级铁律**:`deny` 永远优先于 `allow`(写测试覆盖)。
> - **影响**:增加 ~150 行代码,新增 ~30 行测试,**价值**:把"权限决策"从"写死在工具里"提升为"可配置 + 可审计"。

### 原则三:缓存感知设计(Cache-Aware Architecture)
> **Claude Code**:系统 Prompt 字节稳定、子 agent 共享 cache key、消息历史只 append。
>
> **我们**:
> - 系统 Prompt 是 `app.tsx` 动态拼的——每次冷启动都重拼。
> - 工具描述通过 `getToolDescriptors` 生成,顺序稳定(取决于 `tools` 数组的输入顺序)。
> - 消息历史是 `messages: Message[]` push,只追加不修改。✅
>
> **可借鉴点(优先级低-中)**:
> - **只读工具描述应被冻结**:把所有内置工具的 `description` / `schema` 提取成 const,在 build 时生成 JSON 文件,运行时直接 import。这样 prompt 中"工具说明"这一段字节稳定。
> - **当前实际**:`toolDescriptor()` 是运行时 zod-to-json-schema 转换,虽然输入相同但**理论上有顺序漂移风险**。**建议**:在 `src/agent/schema.ts` 加一个 `__test__` 验证:同一组 tool 两次转换结果 `JSON.stringify` 必须严格相等。
> - **结论**:**测试级改造,代码层小,价值中**(API 计费相关)。

### 原则四:渐进式能力扩展(Progressive Capability)
> **Claude Code**:Tool → Skill → Plugin → MCP,四级渐进,每一级解决一类问题。
>
> **我们**:**只有 Tool 一级**。加新工具 = 加一个 `src/tools/*.ts` + 在 `tools.ts` 注册。
>
> **可借鉴点(优先级中-高)**:
> - **短期(v0.3-0.4)**:把"配置"做成可声明式。`Config` 目前是手写 TypeScript interface,加字段要改 5 个地方(env parsing、cli flag、json loader、defaults、tests)。**借鉴点**:把 config 改成 zod schema 驱动,`loadConfig` 一次解析所有源(env / json / cli)。
> - **中期(v0.5-0.6)**:加 **`Skills` 系统**(对应 Claude Code 的 Level 2)。实现成 `~/.agent/skills/<name>/SKILL.md` + frontmatter(`name` / `description` / `allowed-tools` / `system-prompt-template`)。`/simplify` / `/verify` 这种 skill 命令就有了归属。
> - **远期(v1.0+)**:MCP 集成。
> - **结论**:**Level 1 (Tool) 已成熟 → Level 2 (Skill) 是下一站。**

### 原则五:不可变状态流转(Immutable State Flow)
> **Claude Code**:Store 用 `Object.is` 检查引用变化;每次 `setState` 返回新对象;React 侧用 `useSyncExternalStore` 细粒度订阅。
>
> **我们**:
> - `AppState` 在 `app.tsx` 用 `useState` + `setState` 局部更新(可变的)。
> - 审计 hash 链是真正不可变的(创世 + 链式 hash)。✅
> - `messages` 数组整体替换(`messages.length = 0; messages.push(...compressed)`)——**关键路径正确**。
>
> **可借鉴点(优先级低)**:
> - **不建议在 v0.3 引入 Zustand / Redux**——我们规模用不上。
> - **但有一个具体可借鉴点**:`HeadStatus` 组件订阅了 phase、token、tool name,目前是 `setState` 全量重渲染。可以用 `useSyncExternalStore` + 字段 selector 优化,但**这要等性能真的出问题再做**。
> - **结论**:**别动**。

---

## 3. 具体可落地建议(分优先级)

### 🟢 P0 - 立即可做(1-2 天,代码量 < 300 行)

#### 3.1 工具协议补 `concurrencySafe` + 简单并发分区
**来自**:第 3 章 3.4 节"工具编排引擎 + 并发分区"

**背景**:我们的 loop.ts:198 现在是 `for (const tc of toolCalls)`,**严格串行**。如果 LLM 一次性返回 3 个 `read_file` 调用,会等 3 倍时间。

**改造**:
1. `ToolDef` 加一个可选字段 `concurrencySafe?: boolean`(默认 false,保持 fail-closed)。
2. 加 `src/agent/partition.ts`,实现 `partitionToolCalls(toolCalls, tools)` —— 把"连续 safe 工具"合成一批,unsafe 各自成批。
3. loop.ts:198 改写为 for 批;每批内 `Promise.all` 并行。
4. 工具自身标记:
   - `read_file`, `glob`, `grep` → safe(只读)
   - `http_fetch`(GET)→ safe
   - `write_file`, `edit_file`, `delete_file`, `http_fetch`(POST)→ unsafe

**测试**:
- `src/__tests__/partition.test.ts`:输入混合序列,断言批次划分正确
- 现有 `loop.test.ts` 加一个 case:3 个 read_file 并发,断言"3 个 tool_call_end 在 3 个 start 之后全部到达,但消息顺序保持"

**影响**:3000 行级别,~80 行代码 + ~120 行测试。**性能**:多读场景提速 30-50%。

#### 3.2 引入 `.agent/permissions.json` (deny/allow 规则)
**来自**:第 4 章 4.1.2 / 4.5 节

**背景**:目前 `write_file` / `edit_file` / `delete_file` 总是弹确认框。在 CI 或批处理场景下,用户希望"允许改 `src/**`,但永远拒绝改 `.env`"。

**改造**:
1. `Config` 加 `permissions: { allow: string[]; deny: string[] }`。
2. 新增 `src/safety/rules.ts`,实现 `matchRule(toolName, args, rules) → 'allow' | 'deny' | 'ask' | 'default'`。
3. 规则语法对齐 Claude Code:`"write_file:src/**"` 精确路径通配;`"delete_file:*"` 全匹配;`"http_fetch:https://api.example.com/*"` URL 前缀。
4. loop.ts 工具执行前:`ruleMatch = matchRule(...); if (ruleMatch === 'deny') resultStr = 'Error: blocked by permission rule'; else if (ruleMatch === 'allow') skip onConfirm`.
5. **deny 铁律**:`deny` 优先于 `allow`(写测试)。

**测试**:
- `src/__tests__/rules.test.ts`:10+ 规则匹配用例
- 现有 `loop.test.ts` 加:`write_file(.env)` 即使 allow `src/**` 也被 deny
- 审计 sink 增加 `permission_decision` 事件,记录"allow/deny/ask + rule 来源"

**影响**:~200 行代码,150 行测试,价值:从"工具硬编码权限"到"可配置权限",**企业部署友好**。

#### 3.3 上下文压缩补"断路器"
**来自**:第 7 章 7.1 节"断路器设计"

**背景**:v0.2 的 L1 mid-turn + L4 hot cut 都调用 `summarizeConversation`,如果 LLM 摘要服务连续挂 3 次,我们会在每轮 turn 都浪费一次 API 调用。

**改造**:
1. `src/agent/loop.ts` 维护一个 `consecutiveCompressFails: number`。
2. 每次 compress 失败 +1,成功重置 0;达到 3 时改走"只 hotCut,跳过 compress"。
3. 写入 metrics:`{ compressions, compressFails, hotCuts, compressCircuitOpen: boolean }`。

**测试**:mock summarizeConversation 连续抛错,断言第 4 次不再调用。

**影响**:~30 行代码,40 行测试。**价值**:生产稳定性。

#### 3.4 工具描述冻结 + 缓存友好测试
**来自**:第 1 章原则三 + 第 7 章 7.2 节"时间触发微压缩"

**背景**:Claude Code 把系统 prompt 中"工具说明"那段字节冻结,确保 API 侧 prompt cache 命中。

**改造**:
1. `src/agent/schema.ts` 加一个 `__test__` 单元:`expect(JSON.stringify(getToolDescriptors(tools))).toBe(<snapshot>)`。
2. snapshot 放进 `src/agent/__snapshots__/tools.json`。
3. CI 跑测试时,任何工具定义改动必须主动更新 snapshot。

**影响**:~30 行代码。**价值**:API 成本,缓存命中。

---

### 🟡 P1 - 下一阶段做(3-7 天,代码量 500-1500 行)

#### 3.5 流式工具执行(StreamingToolExecutor 简化版)
**来自**:第 3 章 3.4 节 "StreamingToolExecutor 4 阶段状态机" + 第 13 章 13.1.3 节 "工具调用块的即时检测"

**背景**:我们目前是"模型生成完整响应 → 全部 tool_call 收集到 → 串行执行"。Claude Code 的做法是"模型边生成 tool_call → 立即开始执行",延迟从 7s 降到 3s。

**改造**:
- **轻量版**:`chatCompletionStream` 已经在解析 `tool_call_start` 事件,loop.ts:153 也 `toolCalls.push(...)` 了。**关键缺口**:现在要等 `for await` 跑完才进 `for (const tc of toolCalls)` 串行执行。
- **改造**:把 `for await` 改成"边收边执行"——收一个 tool_call,检查 safety,通过则立即 `execute()`,把结果暂存到 `pendingResults: Map<id, Promise<string>>`;最后在 `done` 事件触发时,按原始 tool_call 顺序 `await` 收集结果,再 push 到 messages。
- **保留**:串行/并行的安全约束(没有 concurrencySafe 标记的不能并行)。

**测试**:`loop.test.ts` 加:mock 一个会触发 2 个 tool_call 的请求,断言两个 tool_call_start 事件间隔 < 100ms(并行触发)。

**影响**:~150 行代码,80 行测试。**价值**:明显感知提速。

#### 3.6 Skills 系统(扩展 Level 2)
**来自**:第 11 章"技能系统与插件架构"

**背景**:目前没有 `/simplify` `/verify` 这种命令——我们通过 `README.md` 写"用 `claude -p "请审查..."`" 这种 hint。

**改造**:
1. 新增 `src/skills/` 模块。
2. 加载顺序(对齐 Claude Code):`--add-dir` → `~/.agent/skills/` → `<cwd>/.agent/skills/`。
3. 技能格式:`SKILL.md` + YAML frontmatter(`name` / `description` / `allowed-tools` / `prompt-template`)。
4. `/<name>` 命令触发:把 `prompt-template` 注入到 user message 后面,作为"额外指令"。
5. **不引入**"工具执行限制"和"模型替换"——保持简单。

**测试**:`src/__tests__/skills.test.ts`:load 3 个 skill 目录,断言 description、name 正确;`/simplify` 触发后,断言 messages 末尾多了 skill prompt。

**影响**:~250 行代码,100 行测试。**价值**:用户自定义命令——这个是"agent 是否能承担真实工作"的标志。

#### 3.7 5 模式权限谱系(default/plan/auto/bypass/bubble)
**来自**:第 4 章 4.3 节

**背景**:目前只有 `yolo` 一个开关。Claude Code 给了 5 种模式。

**改造**:
- v0.3 做 **default + bypass**(两个就够)
- v0.4 再加 **plan**(只读,跟 v0.1 的 `allowMutations: false` 关联)
- v0.5+ 才考虑 **auto**(要 YOLO 分类器,投入大)

**优先级铁律**:bypass 模式也跑 deny 规则(写测试)。

**影响**:**短期只做 default/bypass**,~100 行代码,80 行测试。

#### 3.8 项目级 `.agent/settings.json`
**来自**:第 5 章 5.1 节"六层配置源"

**背景**:我们的 `Config` 是 3 层(env + `~/.agent/config.json` + CLI flag)。**缺项目级**——团队共享权限基线、model 默认值没法在仓库里固化。

**改造**:
1. 新增 `<cwd>/.agent/settings.json`(gitignore,个人) 和 `<cwd>/.agent/settings.team.json`(入 git,团队共享)。
2. 优先级:CLI > env > settings.json(user) > settings.team.json > settings.json(cwd)
3. 数组拼接去重(perms.allow),标量后者覆盖(model)。

**测试**:`config.test.ts` 加 6+ 合并场景。

**影响**:~120 行代码,80 行测试。**价值**:企业可部署性。

---

### 🟠 P2 - 远期(1.0 之后,代码量 1500-5000 行)

#### 3.9 钩子系统(简化版 5-8 事件)
**来自**:第 8 章全章

**背景**:26 个事件太多。**我们用 5-8 个就够**:
- `PreToolUse`(只读提示,可拒绝)
- `PostToolUse`(后处理)
- `SessionStart`
- `SessionEnd`
- `UserPromptSubmit`
- `PreCompact`

**形式**:只支持 Command 钩子(shell 命令),不引入 Prompt/Agent/HTTP 钩子。

**配置位置**:`.agent/hooks.json`。

**影响**:~400 行代码,200 行测试。**价值**:可扩展性,但 ROI 比 Skills 低。

#### 3.10 记忆系统(4 闭合类型)
**来自**:第 6 章全章

**背景**:我们没有跨会话记忆。每次启动 agent 都从零开始。

**改造(简化版)**:
- 只做 2 种类型:`feedback`(用户纠正) + `project`(项目 ADR)
- 存储:`~/.agent/memory/<sanitized-git-root>/<name>.md`
- 索引:`MEMORY.md`(200 行 / 25KB 双截断)
- **不引入**后台 Fork 提取(让用户显式 `/remember` 保存,简单可控)

**影响**:~500 行代码,200 行测试。**价值**:高,但需要先验证 v0.3-0.4 的用户反馈。

#### 3.11 子 agent(Explore / Plan / General)
**来自**:第 9 章

**背景**:v0.1 文档明确"不做复杂 sub-agent 调度"。但 Explore Agent(只读搜索)在"代码考古"场景下价值极大。

**改造(最小版)**:
- 加一个 `agent_tool`(对应 Claude Code 的 AgentTool)
- 支持 3 个内置 agent:Explore(只读,haiku)、General(全权)、Plan(只读,session 短)
- 不做 Fork 缓存、不做 Coordinator——只做同步调用
- 缓存共享:子 agent 的 system prompt 用主 agent 的字符串(不重拼)

**影响**:~600 行代码,300 行测试。**价值**:从"agent"变"multi-agent"。

#### 3.12 MCP 集成
**来自**:第 12 章

**背景**:MCP 是生态接入标准。**1.0 再做**。

**改造**:只支持 stdio 协议;8 种传输我们用 1 种就够。

**影响**:~800 行代码,400 行测试。

---

## 4. 不要借鉴的事(明确反模式警告)

### 4.1 ❌ 不要引入 Zustand / Redux
- 我们规模用不上;`useState` 足够。
- 等 app.tsx > 1500 行 / HeadStatus 重渲染明显再做。

### 4.2 ❌ 不要做"编译时 feature flag"
- 我们是 npm 包分发,不是 SaaS。编译时消除没意义——用户装的就是装的全套。
- **运行时 env flag**(我们已有)就够。

### 4.3 ❌ 不要做 GrowthBook / 实验框架
- 我们不是 SaaS,没有 A/B 测试需求。
- 行为变化用 SemVer + CHANGELOG 管理。

### 4.4 ❌ 不要做 IDE 桥接(Bridge 双向通信)
- 我们定位是"终端",不是 IDE 插件。
- VSCode / JetBrains 集成是 v2+ 的事。

### 4.5 ❌ 不要做 Coordinator(多智能体编排)
- v0.1 文档明确"单 agent 串行"。Coordinator 是企业级功能。
- **做子 agent 之前先验证单 agent 价值,不要直接跳到 multi-agent 编排**。

### 4.6 ❌ 不要做"管理策略 + MDM / HKCU 注册表"
- 我们是开源 CLI 工具,不是企业 SaaS。
- `.agent/permissions.json` 已经覆盖 80% 需求。

### 4.7 ❌ 不要做"懒提取的 fork agent 记忆"
- 投资回报率低,且涉及后台进程,审计复杂。
- 用户主动 `/remember` 是更可控的方案。

---

## 5. 我们 4 大领先优势的保留策略

> 这 4 项不要被 Claude Code 的"丰富度"诱惑而替换或弱化。

### 5.1 ✅ SHA-256 哈希链审计日志(领先)
- Claude Code 没有类似系统——他们依赖 Anthropic 的 SaaS 合规。
- 我们的 `JsonlFileSink` + `verifyChain.ts` 是**企业自托管友好**的核心卖点。
- **保留 + 强化**:增加 `permission_decision` 事件 + `compress_decision` 事件,让审计覆盖更全。

### 5.2 ✅ 极简依赖(10 个 runtime 依赖)
- Claude Code 100+ 依赖(各种工具、MCP、IDE 桥接)。
- 我们的"3000 行能读完 + 10 依赖"是**清晰的差异化**。
- **保留 + 强调**:README 继续把 "Dependencies: 10" 放在 badge 第一行。

### 5.3 ✅ 沙箱 + 危险确认 UX(领先 UX)
- `resolveWithinCwd` + ext 白名单 + 红双线框 + 必须输入 `y`——这套设计在 Claude Code 也要靠 hook 实现。
- **保留 + 测试覆盖**:`sandbox.test.ts` 应该覆盖符号链接逃逸、相对路径、null 字节等攻击向量(部分已有)。

### 5.4 ✅ 透明压缩行为
- v0.2 的 L1 mid-turn + L4 hot cut + 摘要,所有动作都通过 `phase: 'compressing'` 暴露在 UI。
- HeadStatus 显示 token 进度,用户能看到 agent 在想什么。
- **保留**。

---

## 6. 推荐的演进路线图

| 版本 | 主题 | 改造项 | 代码量(估) | 测试(估) |
|------|------|--------|-------------|----------|
| **v0.3** | **性能 + 权限硬底子** | 3.1 并发分区 + 3.2 permissions.json + 3.3 压缩断路器 + 3.4 工具描述冻结 | ~500 | ~400 |
| **v0.4** | **可扩展性起步** | 3.5 流式工具 + 3.6 Skills + 3.7 default/bypass 模式 + 3.8 项目级配置 | ~900 | ~500 |
| **v0.5** | **运维友好** | 扩展 P0/P1 审计事件,Plan 模式,audit 性能 | ~400 | ~200 |
| **v0.6** | **记忆** | 3.10 记忆系统(2 类型) | ~500 | ~200 |
| **v0.7** | **多 agent 准备** | 不做 sub-agent,只准备 Loop hook 接口 | ~200 | ~100 |
| **v0.8** | **sub-agent 试点** | 3.11 子 agent(3 内置) | ~600 | ~300 |
| **v0.9** | **钩子 + MCP** | 3.9 钩子(6 事件) + MCP stdio | ~1200 | ~600 |
| **v1.0** | **可发布里程碑** | 文档、CHANGELOG、release notes、迁移指南 | — | — |

> **关键 milestone**:v0.4 完成后,我们应该能服务"中型团队的日常开发 agent 场景",具备"项目级配置 + 团队权限基线 + Skills 自定义"。

---

## 7. 一句话总结(再强调)

> **Claude Code 是一本完整的"设计哲学参考书",不是"模仿模板"。**
>
> 我们要学的是它如何**把"可扩展性 + 安全性 + 可观测性"做成贯穿系统的母题**,而不是它有多少个内置工具。
>
> v0.3-v0.4 的 8 项改造(共 ~1400 行代码、~900 行测试),就能让我们在保留"3000 行可读 + 10 依赖"的核心优势下,补齐"权限治理 + 工具调度 + Skills 扩展"三个关键短板。
>
> **不要被"Claude Code 50+ 工具"诱惑**——那是规模,不是目标。我们的目标是:**在用户的工作目录里,做一个**透明、克制、可审计**的小型 ReAct 引擎**。
