const RESULT_STORAGE_KEY = 'inspection-results'
const RESULT_EVENT_NAME = 'inspection-results-updated'

export function getInspectionResults() {
  try {
    const raw = window.localStorage.getItem(RESULT_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch (error) {
    console.error('读取巡检识别结果失败:', error)
    return []
  }
}

export function saveInspectionResult(result) {
  const currentResults = getInspectionResults()
  const nextResults = [
    result,
    ...currentResults.filter((item) => item.id !== result.id),
  ].slice(0, 120)

  window.localStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(nextResults))
  window.dispatchEvent(new CustomEvent(RESULT_EVENT_NAME, { detail: result }))
  return nextResults
}

export function updateInspectionResultReview(resultId, reviewStatus) {
  const reviewedAt = new Date().toLocaleString('zh-CN', { hour12: false })
  const nextResults = getInspectionResults().map((item) => (
    item.id === resultId ? { ...item, reviewStatus, reviewedAt } : item
  ))

  window.localStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(nextResults))
  window.dispatchEvent(new CustomEvent(RESULT_EVENT_NAME, { detail: { id: resultId, reviewStatus } }))
  return nextResults
}

export function subscribeInspectionResults(listener) {
  const handleUpdate = () => listener(getInspectionResults())
  window.addEventListener(RESULT_EVENT_NAME, handleUpdate)
  window.addEventListener('storage', handleUpdate)

  return () => {
    window.removeEventListener(RESULT_EVENT_NAME, handleUpdate)
    window.removeEventListener('storage', handleUpdate)
  }
}
