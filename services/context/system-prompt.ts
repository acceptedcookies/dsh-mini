/**
 * canonical prompt 字节只来自 kernel 导出的同一份函数。
 * 本文件不复制提示词正文，也不另存 21/11/5 常量。
 */

export interface PromptKernel {
  NANO_AGENT_SYSTEM_PROMPT: string
  withNanoAgentSystemPrompt(
    messages: readonly unknown[],
    allowedToolIds?: ReadonlySet<string>,
    canonicalTextOverride?: string,
  ): readonly unknown[]
  withModelSteering(messages: readonly unknown[], steering: { unit_id: string; unit_digest: string; content: string } | null): readonly unknown[]
  isCanonicalPromptMessage(message: unknown): boolean
  isInstructionZoneComponent(message: unknown): boolean
}

export function canonicalPromptText(kernel: PromptKernel): string {
  return kernel.NANO_AGENT_SYSTEM_PROMPT
}

export function applyCanonicalPrompt(
  kernel: PromptKernel,
  messages: readonly unknown[],
  allowedToolIds: ReadonlySet<string>,
  canonicalTextOverride?: string,
): readonly unknown[] {
  return kernel.withNanoAgentSystemPrompt(messages, allowedToolIds, canonicalTextOverride)
}
