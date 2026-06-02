#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

const providerPresets = {
  deepseek: {
    adapter: "openai",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    tokenParam: "max_tokens",
    structured: "json_object",
    apiKeyEnv: "DEEPSEEK_API_KEY"
  },
  openai: {
    adapter: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5-mini",
    tokenParam: "max_completion_tokens",
    structured: "json_schema",
    apiKeyEnv: "OPENAI_API_KEY"
  },
  anthropic: {
    adapter: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-5",
    tokenParam: "max_tokens",
    structured: "prompt_only",
    apiKeyEnv: "ANTHROPIC_API_KEY"
  },
  aliyun: {
    adapter: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    tokenParam: "max_tokens",
    structured: "json_object",
    apiKeyEnv: "DASHSCOPE_API_KEY"
  },
  volcengine: {
    adapter: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-1-6",
    tokenParam: "max_tokens",
    structured: "json_object",
    apiKeyEnv: "ARK_API_KEY"
  },
  zhipu: {
    adapter: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.5",
    tokenParam: "max_tokens",
    structured: "json_object",
    apiKeyEnv: "ZHIPU_API_KEY"
  },
  custom: {
    adapter: "openai",
    baseUrl: "",
    model: "",
    tokenParam: "max_tokens",
    structured: "json_object",
    apiKeyEnv: "LLM_API_KEY"
  }
};

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.input) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

const config = await loadConfig(args);
const project = JSON.parse(await readFile(args.input, "utf8"));
const rows = rowsFromProject(project);

if (!rows.length) {
  throw new Error("No rows or sourceText found in input project.");
}

const apiKey = args.apiKey || config.apiKey || process.env[config.apiKeyEnv] || process.env.LLM_API_KEY;
if (!apiKey) {
  throw new Error(`Missing API key. Set ${config.apiKeyEnv}=... or LLM_API_KEY=..., or pass --api-key.`);
}
config.apiKey = apiKey;

const chunks = chunk(rows, config.batchSize);
const parsedRows = [];
const raw = [];
const minInterval = config.rpm > 0 ? Math.ceil(60000 / config.rpm) : 0;
const pause = Math.max(config.delayMs, minInterval);

for (let index = 0; index < chunks.length; index += 1) {
  log(`Batch ${index + 1}/${chunks.length}: ${chunks[index].length} units`);
  const prompt = buildBatchPrompt(project, chunks[index], config);
  const text = await callProvider(config, prompt);
  raw.push({ batch: index + 1, text });
  const parsed = parseLlmJson(text);
  parsedRows.push(...parsed);
  log(`Parsed ${parsed.length} coded rows`);
  if (index < chunks.length - 1 && pause > 0) {
    log(`Waiting ${pause}ms for rate limits`);
    await sleep(pause);
  }
}

const outputProject = applyRows(project, parsedRows, raw, config);
const outputPath = args.output || defaultOutputPath(args.input);
await writeFile(outputPath, `${JSON.stringify(outputProject, null, 2)}\n`, "utf8");
log(`Wrote ${outputPath}`);

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      index += 1;
    }
  }
  return out;
}

async function loadConfig(cli) {
  const fileConfig = cli.config ? JSON.parse(await readFile(cli.config, "utf8")) : {};
  const provider = cli.provider || fileConfig.provider || "deepseek";
  const preset = providerPresets[provider] || providerPresets.custom;
  return {
    ...preset,
    ...fileConfig,
    provider,
    adapter: cli.adapter || fileConfig.adapter || preset.adapter,
    baseUrl: cli.baseUrl || fileConfig.baseUrl || preset.baseUrl,
    model: cli.model || fileConfig.model || preset.model,
    batchSize: Number(cli.batchSize || fileConfig.batchSize || 8),
    delayMs: Number(cli.delayMs || fileConfig.delayMs || 1200),
    rpm: Number(cli.rpm || fileConfig.rpm || 30),
    maxTokens: Number(cli.maxTokens || fileConfig.maxTokens || 1200),
    temperature: Number(cli.temperature || fileConfig.temperature || 0.2),
    tokenParam: cli.tokenParam || fileConfig.tokenParam || preset.tokenParam,
    structured: cli.structured || fileConfig.structured || preset.structured,
    contextMode: cli.contextMode || fileConfig.contextMode || "lean",
    language: cli.language || fileConfig.language || "zh-CN",
    systemPrompt: cli.systemPrompt || fileConfig.systemPrompt || ""
  };
}

function rowsFromProject(project) {
  if (Array.isArray(project.rows) && project.rows.length) {
    return project.rows.map((row, index) => normalizeRow(row, index));
  }
  return splitUnits(project.sourceText || "").map((quote, index) => normalizeRow({ id: index + 1, quote }, index));
}

function normalizeRow(row, index) {
  const quote = String(row.quote ?? row.text ?? "").trim();
  return {
    id: Number(row.id) || index + 1,
    quote,
    code: String(row.code ?? "").trim(),
    theme: String(row.theme ?? "").trim(),
    note: String(row.note ?? row.memo ?? "").trim(),
    review: Boolean(row.review ?? row.needs_review ?? row.needsReview)
  };
}

function splitUnits(text) {
  return String(text)
    .split(/\n+/)
    .map(item => item.trim())
    .filter(item => item.length > 8)
    .map(item => item.replace(/^受访者\s*[A-Z甲乙丙丁]?[：:]\s*/, "").replace(/^访谈者[：:]\s*/, ""));
}

function defaultSystemPrompt(config) {
  if (config.language === "en-US") {
    return "You are a social-science qualitative research methods assistant. Help code interview or open-ended response materials. Preserve evidence, avoid inventing sources or background, and return only valid JSON.";
  }
  return "你是一名社会科学质性研究方法助手。请帮助研究者编码访谈或开放题材料，保留证据链，不编造文献、背景或受访者信息；要求 JSON 时只返回合法 JSON。";
}

function buildBatchPrompt(project, rows, config) {
  const lean = config.contextMode === "lean";
  const payload = {
    project: project.project || project.name || basename(args.input),
    discipline: project.discipline || "",
    question: project.question || "",
    theory_mode: project.theoryMode || "",
    method_mode: project.method?.name || project.methodMode || "",
    output_language: config.language === "en-US" ? "English" : "中文",
    rows: rows.map(row => ({
      id: row.id,
      quote: row.quote,
      current_code: lean ? undefined : row.code,
      current_theme: lean ? undefined : row.theme,
      current_note: lean ? undefined : row.note
    }))
  };
  const task = config.language === "en-US"
    ? "Code these qualitative meaning units. Return JSON only with {\"rows\":[{\"id\":number,\"quote\":string,\"code\":string,\"theme\":string,\"note\":string,\"needs_review\":boolean}]}. Keep codes concise, themes methodologically defensible, and mark uncertain or context-thin units as needs_review."
    : "请为这些质性材料意义单元编码。只返回 JSON，格式为 {\"rows\":[{\"id\":数字,\"quote\":\"原文\",\"code\":\"初始编码\",\"theme\":\"主题/范畴\",\"note\":\"方法备注\",\"needs_review\":布尔值}]}。编码要简洁，主题要有方法依据；语境不足或不确定的片段标记 needs_review=true。";
  return `${task}\n\n${JSON.stringify(payload, null, 2)}`;
}

function jsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["rows"],
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "quote", "code", "theme", "note", "needs_review"],
          properties: {
            id: { type: "integer" },
            quote: { type: "string" },
            code: { type: "string" },
            theme: { type: "string" },
            note: { type: "string" },
            needs_review: { type: "boolean" }
          }
        }
      }
    }
  };
}

function requestUrl(baseUrl, adapter) {
  const clean = String(baseUrl || "").replace(/\/+$/, "");
  if (!clean) throw new Error("Missing baseUrl.");
  if (/\/(chat\/completions|messages)$/.test(clean)) return clean;
  return adapter === "anthropic" ? `${clean}/v1/messages` : `${clean}/chat/completions`;
}

async function callProvider(config, prompt) {
  if (config.adapter === "anthropic") {
    const response = await fetch(requestUrl(config.baseUrl, config.adapter), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        system: config.systemPrompt || defaultSystemPrompt(config),
        messages: [{ role: "user", content: prompt }]
      })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error?.message || response.statusText);
    return (json.content || []).map(part => part.text || "").join("\n");
  }

  const body = {
    model: config.model,
    messages: [
      { role: "system", content: config.systemPrompt || defaultSystemPrompt(config) },
      { role: "user", content: prompt }
    ],
    temperature: config.temperature
  };
  body[config.tokenParam || "max_tokens"] = config.maxTokens;
  if (config.structured === "json_object") body.response_format = { type: "json_object" };
  if (config.structured === "json_schema") {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "qualitative_coding_batch",
        strict: true,
        schema: jsonSchema()
      }
    };
  }

  const response = await fetch(requestUrl(config.baseUrl, config.adapter), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(body)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error?.message || response.statusText);
  return json.choices?.[0]?.message?.content || "";
}

function parseLlmJson(text) {
  const cleaned = String(text || "").replace(/```json|```/g, "").trim();
  const direct = tryJson(cleaned);
  if (direct) return Array.isArray(direct) ? direct : direct.rows || direct.data || [];
  const startObj = cleaned.indexOf("{");
  const endObj = cleaned.lastIndexOf("}");
  if (startObj >= 0 && endObj > startObj) {
    const obj = tryJson(cleaned.slice(startObj, endObj + 1));
    if (obj) return Array.isArray(obj) ? obj : obj.rows || obj.data || [];
  }
  const startArr = cleaned.indexOf("[");
  const endArr = cleaned.lastIndexOf("]");
  if (startArr >= 0 && endArr > startArr) {
    const arr = tryJson(cleaned.slice(startArr, endArr + 1));
    if (arr) return Array.isArray(arr) ? arr : arr.rows || arr.data || [];
  }
  return [];
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function applyRows(project, codedRows, raw, config) {
  const output = structuredClone(project);
  const sourceRows = rowsFromProject(project);
  const byId = new Map(codedRows.map(row => [Number(row.id), row]));
  output.rows = sourceRows.map(row => {
    const coded = byId.get(Number(row.id));
    if (!coded) return row;
    return {
      ...row,
      code: String(coded.code || row.code || ""),
      theme: String(coded.theme || row.theme || ""),
      note: String(coded.note || row.note || ""),
      review: Boolean(coded.needs_review ?? coded.review ?? row.review)
    };
  });
  output.llmRun = {
    at: new Date().toISOString(),
    provider: config.provider,
    adapter: config.adapter,
    model: config.model,
    batchSize: config.batchSize,
    delayMs: config.delayMs,
    rpm: config.rpm,
    maxTokens: config.maxTokens,
    structured: config.structured,
    codedRows: codedRows.length,
    raw
  };
  return output;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function defaultOutputPath(input) {
  return input.replace(/\.json$/i, "") + ".llm-coded.json";
}

function log(message) {
  if (!args.quiet) process.stderr.write(`${message}\n`);
}

function printHelp() {
  process.stderr.write(`Usage:
  node scripts/llm-code.mjs --input project.json [options]

Options:
  --config config.json              Read provider and rate-limit settings
  --output output.json              Output path
  --provider deepseek|openai|anthropic|aliyun|volcengine|zhipu|custom
  --adapter openai|anthropic
  --base-url URL
  --model MODEL
  --api-key KEY
  --batch-size N                    Meaning units per request
  --delay-ms N                      Minimum delay between batches
  --rpm N                           Requests per minute limit
  --max-tokens N                    Max output tokens
  --temperature N
  --structured json_object|json_schema|prompt_only
  --token-param max_tokens|max_completion_tokens
  --context-mode lean|rich
  --language zh-CN|en-US

API key env vars:
  DEEPSEEK_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, DASHSCOPE_API_KEY,
  ARK_API_KEY, ZHIPU_API_KEY, or fallback LLM_API_KEY.
`);
}
