// 前端统一使用同一个 key 保存登录用户信息，避免页面之间读写不一致。
const USER_KEY = 'user'

export function getStoredUser() {
  // “记住登录状态”使用 localStorage；临时登录使用 sessionStorage。
  const savedUser = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY)
  return savedUser ? JSON.parse(savedUser) : null
}

export function saveUser(user, rememberMe) {
  const storage = rememberMe ? localStorage : sessionStorage

  // 保存前先清理两种存储，防止旧登录状态和新登录状态同时存在。
  clearUser()
  storage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearUser() {
  // 退出登录时两边都清掉，保证用户无法继续访问需要登录的页面。
  localStorage.removeItem(USER_KEY)
  sessionStorage.removeItem(USER_KEY)
}
