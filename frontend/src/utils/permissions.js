export const permissionModules = [
  { key: 'patrol_monitor', label: '室内巡检监控' },
  { key: 'device_resources', label: '设备与资源管理' },
  { key: 'patrol_tasks', label: '巡检任务管理' },
  { key: 'ai_review', label: 'AI识别复核' },
  { key: 'alarm_loop', label: '告警闭环' },
  { key: 'user_management', label: '系统用户管理' },
]

export const permissionActions = [
  { key: 'view', label: '查看' },
  { key: 'create', label: '新增' },
  { key: 'update', label: '编辑' },
  { key: 'delete', label: '删除' },
]

function emptyMatrix(value = false) {
  return Object.fromEntries(permissionModules.map(({ key }) => [
    key,
    Object.fromEntries(permissionActions.map(({ key: action }) => [action, value])),
  ]))
}

export function defaultPermissions(role = 'viewer') {
  if (role === 'admin') return emptyMatrix(true)
  const permissions = emptyMatrix(false)
  const visibleModules = permissionModules.filter(({ key }) => key !== 'user_management')
  visibleModules.forEach(({ key }) => {
    permissions[key].view = true
    if (role === 'operator') {
      permissions[key].create = true
      permissions[key].update = true
    }
  })
  return permissions
}

export function effectivePermissions(user) {
  const permissions = defaultPermissions(user?.role)
  permissionModules.forEach(({ key }) => {
    permissionActions.forEach(({ key: action }) => {
      const value = user?.permissions?.[key]?.[action]
      if (typeof value === 'boolean') permissions[key][action] = value
    })
  })
  return permissions
}

export function hasPermission(user, module, action = 'view') {
  return Boolean(effectivePermissions(user)[module]?.[action])
}
