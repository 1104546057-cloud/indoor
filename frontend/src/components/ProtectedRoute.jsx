import { Navigate } from 'react-router-dom'
import { getStoredUser } from '../utils/auth'

function ProtectedRoute({ children }) {
  // 路由守卫只做前端层面的登录状态检查；真正的接口安全仍由后端 JWT 校验负责。
  const user = getStoredUser()

  if (!user?.token) {
    // replace 可以避免用户点浏览器后退又回到受保护页面。
    return <Navigate to="/login" replace />
  }

  return children
}

export default ProtectedRoute
