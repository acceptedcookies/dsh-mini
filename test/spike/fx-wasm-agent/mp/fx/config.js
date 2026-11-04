// 由 .local.development.json 手工同步（spike 工程不可读仓库根文件）。
// 变更模型/端点时先改根 JSON，再同步这里。
export const MAGPIE_BASE_URL = "http://127.0.0.1:3425";
export const MODEL = "cursor/grok-4.7@500k";

export const FX_ENV = {
  FX_PROVIDER: "magpie",
  FX_CONFIGURED_PROVIDERS: JSON.stringify({
    magpie: {
      protocol: "openai-chat-completions",
      base_url: `${MAGPIE_BASE_URL}/v1`,
      auth: { type: "none" },
      model_metadata: {
        [MODEL]: { context_window: 500000, supports_tool_use: true, supports_vision: true },
        unknown: { context_window: 256000, supports_tool_use: true, supports_vision: true },
      },
    },
  }),
  FX_MODEL: MODEL,
};

// wasm 分包路径（相对包根）
export const WASM_PATH = "subpkg/fx-core-async.wasm";
