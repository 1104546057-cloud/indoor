export const emptyBusinessOverview = Object.freeze({
  rooms: [],
  cabinetTypes: [],
  cabinets: [],
  deviceItems: [],
  robots: [],
  points: [],
  routes: [],
  alarms: [],
  records: [],
  images: [],
  results: [],
})

export async function fetchJson(path, options = {}) {
  const response = await fetch(path, { credentials: 'include', ...options })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || `请求失败（${response.status}）`)
  return data
}

export function jsonRequest(method, payload) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}
