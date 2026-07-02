// 前端统一使用同一个 key 保存登录用户信息，避免页面之间读写不一致。
const USER_KEY = 'user'
let runtimeLoginConfirmed = false

export function getStoredUser() {
  const savedUser = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY)
  return savedUser ? JSON.parse(savedUser) : null
}

export function hasRuntimeLogin() {
  return runtimeLoginConfirmed
}

export function saveUser(user) {
  const storage = sessionStorage

  // 保存前先清理两种存储，防止旧登录状态和新登录状态同时存在。
  clearUser()
  runtimeLoginConfirmed = true
  storage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearUser() {
  // 退出登录时两边都清掉，保证用户无法继续访问需要登录的页面。
  runtimeLoginConfirmed = false
  localStorage.removeItem(USER_KEY)
  sessionStorage.removeItem(USER_KEY)
}
