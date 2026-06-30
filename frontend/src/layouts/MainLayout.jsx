import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { clearUser, getStoredUser } from '../utils/auth'
import '../styles/MainLayout.css'

const primaryNav = [
  { label: '室内巡检监控', path: '/dashboard', match: ['/dashboard', '/device-control'] },
  { label: '设备管理', path: '/devices', match: ['/devices', '/cluster'] },
  { label: '巡检任务管理', path: '/cluster-control', match: ['/cluster-control', '/patrol-3d'] },
  { label: '系统用户管理', path: '/users', match: ['/users'] },
]

const settingsGroups = [
  {
    title: '系统管理',
    items: [
      { label: '设备管理', path: '/devices', icon: 'device' },
      { label: '巡检任务管理', path: '/cluster', icon: 'cluster' },
      { label: '系统用户管理', path: '/users', icon: 'users' },
    ],
  },
  {
    title: '巡检监控',
    items: [
      { label: '室内巡检监控', path: '/dashboard', icon: 'home' },
      { label: '设备控制', path: '/device-control', icon: 'control' },
      { label: '巡检任务管理', path: '/cluster-control', icon: 'layers' },
    ],
  },
]

function AppIcon({ name, size = 18 }) {
  const paths = {
    home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v10h13V10" /><path d="M9.5 20v-6h5v6" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    fullscreen: <><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" /></>,
    collapse: <><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" /><path d="m8 8-5-5m13 5 5-5m-5 13 5 5M8 16l-5 5" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M16 5.5a3 3 0 0 1 0 5.5M17 15a5 5 0 0 1 4 5" /></>,
    device: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 9h6v6H9zM9 1v3m6-3v3M9 20v3m6-3v3M20 9h3m-3 6h3M1 9h3m-3 6h3" /></>,
    control: <><circle cx="12" cy="12" r="3" /><path d="M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3m0-14-3 3M8 16l-3 3" /></>,
    cluster: <><circle cx="12" cy="5" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="18" r="2" /><path d="m11 7-5 9m7-9 5 9M7 18h10" /></>,
    layers: <><path d="m12 3-9 5 9 5 9-5-9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    logout: <><path d="M10 4H5v16h5M14 8l4 4-4 4m4-4H9" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || paths.home}
    </svg>
  )
}

function matchesNavPath(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function MainLayout() {
  const [currentTime, setCurrentTime] = useState(new Date())
  const [showSettings, setShowSettings] = useState(false)
  const [showAccount, setShowAccount] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement))
  const [isCockpitImmersive, setIsCockpitImmersive] = useState(true)
  const navigate = useNavigate()
  const location = useLocation()
  const user = useMemo(() => getStoredUser() || {}, [])

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000)
    const handleFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handleFullscreen)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('fullscreenchange', handleFullscreen)
    }
  }, [])

  useEffect(() => {
    setShowSettings(false)
    setShowAccount(false)
  }, [location.pathname])

  useEffect(() => {
    if (location.pathname.startsWith('/device-control')) {
      setIsCockpitImmersive(true)
      return
    }
    setIsCockpitImmersive(false)
  }, [location.pathname])

  useEffect(() => {
    if (!location.pathname.startsWith('/device-control') || !isCockpitImmersive) {
      return undefined
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsCockpitImmersive(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isCockpitImmersive, location.pathname])

  const handleLogout = () => {
    clearUser()
    navigate('/login')
  }

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch (error) {
      console.error('切换全屏失败:', error)
    }
  }

  const dateText = currentTime.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
  const weekText = currentTime.toLocaleDateString('zh-CN', { weekday: 'long' })
  const timeText = currentTime.toLocaleTimeString('zh-CN', { hour12: false })
  const isCockpitRoute = location.pathname.startsWith('/device-control')
  const isPatrol3DRoute = location.pathname.startsWith('/patrol-3d')
  const useCockpitLayout = isPatrol3DRoute || (isCockpitRoute && isCockpitImmersive)

  return (
    <div className={`main-layout${useCockpitLayout ? ' cockpit-layout' : ''}`} id="main-layout">
      {!useCockpitLayout && (
        <header className="tech-header">
        <div className="tech-header-grid" />
        <div className="system-clock">
          <span className="clock-time">{timeText}</span>
          <span className="clock-date">{dateText} · {weekText}</span>
        </div>

        <div className="system-brand">
          <span className="brand-wing left" />
          <div className="brand-title-wrap">
            <span className="brand-kicker">INDOOR PATROL CONTROL</span>
            <strong>室内巡检无人车管理平台</strong>
          </div>
          <span className="brand-wing right" />
        </div>

        <div className="header-navigation">
          <div className="header-tools">
            {isCockpitRoute && !useCockpitLayout && (
              <button
                className="header-tool cockpit-entry-tool"
                onClick={() => setIsCockpitImmersive(true)}
                title="进入驾驶舱"
              >
                <AppIcon name="control" />
              </button>
            )}
            <button className="header-tool" onClick={() => navigate('/dashboard')} title="首页"><AppIcon name="home" /></button>
            <button className={`header-tool ${showSettings ? 'active' : ''}`} onClick={() => { setShowSettings((value) => !value); setShowAccount(false) }} title="设置"><AppIcon name="settings" /></button>
            <button className="header-tool" onClick={toggleFullscreen} title={isFullscreen ? '退出全屏' : '进入全屏'}><AppIcon name={isFullscreen ? 'collapse' : 'fullscreen'} /></button>
            <button className={`header-tool avatar-tool ${showAccount ? 'active' : ''}`} onClick={() => { setShowAccount((value) => !value); setShowSettings(false) }} title="账户">
              <AppIcon name="user" />
              <span className="avatar-online" />
            </button>
          </div>

          <nav className="primary-nav" aria-label="一级导航">
            {primaryNav.map((item) => {
              const active = item.match.some((prefix) => matchesNavPath(location.pathname, prefix))
              return <NavLink key={item.path} to={item.path} className={`primary-nav-item ${active ? 'active' : ''}`}>{item.label}</NavLink>
            })}
          </nav>
        </div>

        {showSettings && (
          <div className="settings-popover">
            <div className="popover-heading">
              <div><span>系统设置</span><small>室内巡检功能入口</small></div>
              <button onClick={() => setShowSettings(false)}>×</button>
            </div>
            <div className="settings-groups">
              {settingsGroups.map((group) => (
                <section key={group.title}>
                  <h3>{group.title}</h3>
                  <div className="settings-grid">
                    {group.items.map((item) => (
                      <NavLink key={item.path} to={item.path} className="settings-link">
                        <span className="settings-link-icon"><AppIcon name={item.icon} /></span>
                        <span>{item.label}</span>
                        <AppIcon name="chevron" size={14} />
                      </NavLink>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}

        {showAccount && (
          <div className="account-popover">
            <div className="account-summary">
              <span className="account-avatar"><AppIcon name="user" size={22} /></span>
              <div><strong>{user.nickname || user.username || '管理员'}</strong><small>系统管理员 · 在线</small></div>
            </div>
            <button onClick={() => { navigate('/users'); setShowAccount(false) }}><AppIcon name="users" /><span>用户管理</span></button>
            <button className="danger" onClick={handleLogout}><AppIcon name="logout" /><span>退出登录</span></button>
          </div>
        )}
        </header>
      )}

      <main className={`main-content${useCockpitLayout ? ' cockpit-content' : ''}`} id="main-content"><Outlet /></main>
    </div>
  )
}

export default MainLayout
