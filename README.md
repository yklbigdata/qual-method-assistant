# 社科质性研究 AI 方法助手 / Qual Method Assistant

一个面向社会科学质性研究的轻量 MVP，帮助研究者把访谈、开放题或田野材料整理为可复核的编码表、主题结构、方法段草稿和 LLM 复核提示词。

在线试用：<https://yklbigdata.github.io/qual-method-assistant/>

English: A lightweight MVP for qualitative social-science coding, thematic analysis support, audit trails, memos, and LLM-assisted coding.

## 功能

- 导入 TXT、CSV 或项目 JSON
- 自动切分意义单元并生成初始编码
- 支持主题分析、框架分析和扎根理论路径建议
- 人工修改编码、主题、备注和复核状态
- 记录人工修订审计轨迹
- 保存研究者备忘录和方法备忘录
- 导出 CSV、项目 JSON 和 Word 兼容 DOC
- 中英文界面切换
- 在线 LLM 编码配置与提示词预览
- 本地 Node.js LLM 编码脚本
- 支持火山引擎、阿里百炼、智谱、DeepSeek、OpenAI、Anthropic 和自定义服务商
- 支持批次大小、批次间隔、RPM、最大输出 tokens、结构化输出等参数
- 本地浏览器自动保存，不主动上传材料

## 使用

直接打开 `index.html` 即可使用。

也可以启动本地静态服务：

```bash
python3 -m http.server 8123
```

然后访问：

```text
http://127.0.0.1:8123/
```

## CSV 导入字段

推荐字段名：

```text
quote,code,theme,note,needs_review
```

其中只有 `quote` 是必需字段。中文字段如 `原文`、`编码`、`主题`、`备注`、`需复核` 也可被识别。

## 在线 LLM 编码

打开 `LLM` 标签页后，可以选择服务商并设置：

- `Provider`：DeepSeek、OpenAI、Anthropic、阿里百炼、火山引擎、智谱或自定义
- `Base URL` 和 `Model`
- `Batch size`：每次请求编码多少个意义单元
- `Delay ms`：批次之间的固定等待时间
- `RPM limit`：每分钟请求上限；工具会按 `delayMs` 与 `60000/rpm` 中较大的值等待
- `Max output tokens`
- `Structured output`：`json_object`、`json_schema` 或仅在 prompt 中要求 JSON
- `Token parameter`：`max_tokens` 或 `max_completion_tokens`

浏览器端 API Key 只保存在当前输入框，不会写入项目 JSON 或 localStorage。部分服务商会限制浏览器跨域请求；如果在线调用失败，请使用本地脚本。

## 本地 LLM 编码脚本

先在网页中导出项目 JSON，或准备一个包含 `sourceText` / `rows` 的项目文件。

```bash
node scripts/llm-code.mjs --input project.json --provider deepseek --output coded-project.json
```

使用环境变量传入 API Key：

```bash
export DEEPSEEK_API_KEY="sk-..."
node scripts/llm-code.mjs --input project.json --provider deepseek
```

也可以使用配置文件：

```bash
cp examples/llm-config.example.json llm-config.json
node scripts/llm-code.mjs --input project.json --config llm-config.json
```

常用参数：

```bash
node scripts/llm-code.mjs \
  --input project.json \
  --provider aliyun \
  --model qwen-plus \
  --batch-size 6 \
  --delay-ms 1500 \
  --rpm 20 \
  --max-tokens 1000 \
  --structured json_object
```

支持的 API Key 环境变量：

```text
DEEPSEEK_API_KEY
OPENAI_API_KEY
ANTHROPIC_API_KEY
DASHSCOPE_API_KEY
ARK_API_KEY
ZHIPU_API_KEY
LLM_API_KEY
```

## Provider Presets

| Provider | Adapter | Default Base URL | Example model |
| --- | --- | --- | --- |
| DeepSeek | OpenAI-compatible | `https://api.deepseek.com` | `deepseek-v4-flash` |
| OpenAI | OpenAI-compatible | `https://api.openai.com/v1` | `gpt-5-mini` |
| Anthropic | Anthropic Messages | `https://api.anthropic.com` | `claude-sonnet-4-5` |
| 阿里百炼 / DashScope | OpenAI-compatible | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| 火山引擎 / Ark | OpenAI-compatible | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-1-6` |
| 智谱 / BigModel | OpenAI-compatible | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.5` |
| Custom | OpenAI-compatible or Anthropic | user-defined | user-defined |

## 数据安全

当前版本是纯前端静态应用，项目数据保存在浏览器 `localStorage` 中。除非用户主动导出或复制提示词，否则材料不会离开本机浏览器。

在线 LLM 编码会把所选批次材料发送给你配置的模型服务商。本地脚本同理。处理真实访谈、敏感数据或未脱敏材料前，请确认伦理审批、数据授权和服务商合规要求。
