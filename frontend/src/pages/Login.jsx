import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { saveUser } from '../utils/auth'
import '../styles/Login.css'

// 后端健康检查状态到页面展示文案的映射。
const statusText = {
  checking: '正在检测后端 API',
  connected: '后端 API 已连接',
  disconnected: '后端 API 未连接',
}

function Login() {
  const navigate = useNavigate()

  // 后端连接状态，用于左侧状态卡片显示。
  const [apiStatus, setApiStatus] = useState('checking')
  const [apiMessage, setApiMessage] = useState('等待响应...')

  // 登录表单状态，输入框值和交互开关都由 React 统一管理。
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // 防止网络请求较慢时，组件已经离开页面后仍继续更新状态。
    let ignore = false

    async function checkApi() {
      try {
        const response = await fetch('/api/health')
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const data = await response.json()
        if (!ignore) {
          setApiStatus('connected')
          setApiMessage(data.message || '服务运行正常')
        }
      } catch (error) {
        if (!ignore) {
          setApiStatus('disconnected')
          setApiMessage(error instanceof Error ? error.message : '无法连接后端服务')
        }
      }
    }

    checkApi()

    return () => {
      ignore = true
    }
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()

    // 先做前端空值校验，避免没必要地请求后端。
    if (!username.trim()) {
      setError('请输入用户名')
      return
    }

    if (!password.trim()) {
      setError('请输入密码')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      // 调用 FastAPI 登录接口，后端会查询数据库并校验密码哈希。
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      })

      const data = await response.json()

      if (response.ok) {
        // 登录成功后保存用户信息，后续页面通过 auth.js 读取登录状态。
        saveUser(
          {
            username: data.username,
            nickname: data.nickname || '管理员',
            token: data.token,
          },
          rememberMe,
        )
        navigate('/dashboard')
      } else {
        setError(data.detail || '用户名或密码错误')
      }
    } catch {
      setError('无法连接到服务器')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="brand-panel" aria-label="平台介绍">
        <p className="eyebrow">Devices Web Control</p>
        <h1>室内巡检无人车管理平台</h1>
        <p className="summary">
          面向室内无人车巡检任务，集中管理设备状态、任务调度、告警信息与运行数据。
        </p>

        <div className="status-panel" aria-live="polite">
          <span className={`status-dot ${apiStatus}`} />
          <div>
            <strong>{statusText[apiStatus]}</strong>
            <p>{apiMessage}</p>
          </div>
        </div>
      </section>

      <section className="login-card" aria-label="登录">
        <div className="login-header">
          <p className="login-kicker">Account Login</p>
          <h2>登录系统</h2>
          <p>使用管理员账号进入可视化管理平台。</p>
        </div>

        <form className="login-form" onSubmit={handleLogin}>
          <label className="field">
            <span>用户名</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              autoComplete="username"
            />
          </label>

          <label className="field">
            <span>密码</span>
            <div className="password-field">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                autoComplete="current-password"
              />
              <button
                type="button"
                className="ghost-button"
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? '隐藏' : '显示'}
              </button>
            </div>
          </label>

          <div className="form-row">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <span>记住登录状态</span>
            </label>
            <span className="hint">测试账号：admin / 123456</span>
          </div>

          {error && <p className="message error-message">{error}</p>}

          <button className="submit-button" type="submit" disabled={isLoading}>
            {isLoading ? '登录中...' : '登录'}
          </button>
        </form>
      </section>
    </main>
  )
}

export default Login
