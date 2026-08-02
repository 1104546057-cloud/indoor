/* eslint-disable react/prop-types */
import { getStoredUser } from '../utils/auth'
import { hasPermission } from '../utils/permissions'

function PermissionGuard({ module, action = 'view', children }) {
  const user = getStoredUser()
  if (hasPermission(user, module, action)) return children

  return (
    <section className="route-access-denied" role="alert">
      <span>ACCESS DENIED</span>
      <h1>当前账号无权访问此功能</h1>
      <p>需要权限：{module}.{action}。请联系系统管理员在“角色权限”中授权。</p>
    </section>
  )
}

export default PermissionGuard
