const STORAGE_PREFIX = 'indoor-patrol-monitor:'
const LATEST_KEY = `${STORAGE_PREFIX}latest`

function canUseSessionStorage() {
  return typeof window !== 'undefined' && window.sessionStorage
}

export function getNavigationExecutionId(response) {
  return response?.navigation?.execution_id
    || response?.execution_id
    || response?.data?.navigation?.execution_id
    || null
}

export function savePatrolMonitorContext(context) {
  if (!canUseSessionStorage() || !context) return

  const normalized = {
    ...context,
    savedAt: Date.now(),
  }
  const serialized = JSON.stringify(normalized)
  window.sessionStorage.setItem(LATEST_KEY, serialized)
  if (normalized.executionId) {
    window.sessionStorage.setItem(`${STORAGE_PREFIX}execution:${normalized.executionId}`, serialized)
  }
  if (normalized.taskId) {
    window.sessionStorage.setItem(`${STORAGE_PREFIX}task:${normalized.taskId}`, serialized)
  }
}

export function loadPatrolMonitorContext({ executionId, taskId } = {}) {
  if (!canUseSessionStorage()) return null

  const keys = [
    executionId ? `${STORAGE_PREFIX}execution:${executionId}` : null,
    taskId ? `${STORAGE_PREFIX}task:${taskId}` : null,
    LATEST_KEY,
  ].filter(Boolean)

  for (const key of keys) {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) continue
    try {
      const context = JSON.parse(raw)
      if (executionId && context.executionId && context.executionId !== executionId) continue
      if (taskId && context.taskId && context.taskId !== taskId) continue
      return context
    } catch {
      window.sessionStorage.removeItem(key)
    }
  }
  return null
}

export function buildPatrolMonitorUrl({ executionId, vehicleId, taskId, replayMode = false } = {}) {
  const search = new URLSearchParams()
  if (executionId) search.set('execution_id', executionId)
  if (vehicleId) search.set('vehicle_id', vehicleId)
  if (taskId) search.set('task_id', taskId)
  if (replayMode) search.set('replay', '1')
  const suffix = search.toString()
  return suffix ? `/patrol-3d?${suffix}` : '/patrol-3d'
}
