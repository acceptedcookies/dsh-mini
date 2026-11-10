/**
 * 分区槽。名字只来自调用方传入的 kernel 清单，这里不另定义 11 元数组。
 * 四个空分区的原因是 T-O-24 ① 的散文，不是新错误码。
 */

export interface PartitionSlot {
  bytes: string
  degradedReason?: string
}

const TENANT_ABSENT = '无 tenant 配置源'
const NO_TURN_INGRESS = '宿主无 runtime_notice 的 turn_ingress'

export function partitionSlots(names: readonly string[]): Record<string, PartitionSlot> {
  const slots: Record<string, PartitionSlot> = {}
  for (const name of names) {
    if (name === 'instruction_profile' || name === 'skill_catalog' || name === 'initial_context') {
      slots[name] = { bytes: '', degradedReason: TENANT_ABSENT }
    } else if (name === 'runtime_notice') {
      slots[name] = { bytes: '', degradedReason: NO_TURN_INGRESS }
    } else {
      slots[name] = { bytes: '' }
    }
  }
  return slots
}
