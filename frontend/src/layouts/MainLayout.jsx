import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { clearUser, getStoredUser } from '../utils/auth'
import '../styles/MainLayout.css'

const menuItems = [
  { path: '/dashboard', label: '数据看板', mark: 'D' },
  { path: '/users', label: '用户管理', mark: 'U' },
  { path: '/devices', label: '设备管理', mark: 'M' },
  { path: '/device-control', label: '设备控制', mark: 'C' },
  { path: '/cluster', label: '集群管理', mark: 'G' },
  { path: '/cluster-control', label: '集群控制', mark: 'K' },
]

function MainLayout() {
  const navigate = useNavigate()
  const user = getStoredUser()

  const handleLogout = () => {
    // 退出登录时清理本地用户信息，再回到登录页。
    clearUser()
    navigate('/login')
  }

  return (
    <div className="main-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-logo">DWC</span>
          <div>
            <strong>集群管理平台</strong>
            <p>Indoor Patrol</p>
          </div>
        </div>

        <div className="sidebar-user">
          <span className="user-avatar">{(user?.nickname || user?.username || 'A')[0]}</span>
          <div>
            <strong>{user?.nickname || user?.username}</strong>
            <p>已登录</p>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="主导航">
          {menuItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
            >
              <span>{item.mark}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button type="button" onClick={handleLogout}>
            退出登录
          </button>
        </div>
      </aside>

      <main className="main-content">
        {/* Outlet 是子页面渲染位置，例如 Dashboard、UserManagement 等页面会显示在这里。 */}
        <Outlet />
      </main>
    </div>
  )
}

export default MainLayout
