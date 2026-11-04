/** dsh 权限预设的客户端投影:菜单、composer chip 与设置页共用一份。 */

export interface PermissionOption {
  id: string
  label: string
  description: string
  badge?: string
}

export const PERMISSIONS: PermissionOption[] = [
  { id: 'read-only', label: '仅可查看', description: '只读访问工作区' },
  { id: 'workspace-write', label: '工作区内修改', description: '允许在工作区内写入' },
  { id: 'danger-full-access', label: '完全权限', description: '完整文件访问，不弹审批' },
  { id: 'auto', label: '自动审查', description: '由自动审查策略决定', badge: 'EXP' },
]

export const DEFAULT_PERMISSION = PERMISSIONS[1] as PermissionOption

export function permissionOf(id: string | undefined): PermissionOption {
  return PERMISSIONS.find((item) => item.id === id) ?? DEFAULT_PERMISSION
}
