import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { saveUser } from '../utils/auth'
import '../styles/Login.css'

const statusText = {
  checking: '正在检测后端 API',
  connected: '后端 API 已连接',
  disconnected: '后端 API 未连接',
}

function Login() {
  const navigate = useNavigate()
  const [apiStatus, setApiStatus] = useState('checking')
  const [apiMessage, setApiMessage] = useState('等待响应...')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
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
      } catch (requestError) {
        if (!ignore) {
          setApiStatus('disconnected')
          setApiMessage(requestError instanceof Error ? requestError.message : '无法连接后端服务')
        }
      }
    }

    checkApi()
    return () => {
      ignore = true
    }
  }, [])

  const handleLogin = async (event) => {
    event.preventDefault()

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
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      })

      const data = await response.json()

      if (response.ok) {
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
      <div className="login-scene" aria-hidden="true">
        <span className="login-grid" />
        <span className="login-orbit orbit-one" />
        <span className="login-orbit orbit-two" />
        <span className="login-beam beam-left" />
        <span className="login-beam beam-right" />
        <span className="campus-silhouette" />
      </div>

      <header className="login-system-title">
        <span className="title-line left" />
        <div>
          <small>INDOOR PATROL ROBOT CONTROL</small>
          <h1>室内巡检无人车管理平台</h1>
        </div>
        <span className="title-line right" />
      </header>

      <section className="login-stage">
        <div className="login-console">
          <span className="console-corner corner-tl" />
          <span className="console-corner corner-tr" />
          <span className="console-corner corner-bl" />
          <span className="console-corner corner-br" />
          <div className="console-glow" />

          <div className="login-console-head">
            <span className="head-wing left" />
            <div className="console-title">
              <span className="console-badge">ID</span>
              <div>
                <h2>用户登录</h2>
                <small>USER AUTHENTICATION</small>
              </div>
            </div>
            <span className="head-wing right" />
          </div>

          <div className="api-status-panel" aria-live="polite">
            <span className={`api-status-dot ${apiStatus}`} />
            <div>
              <strong>{statusText[apiStatus]}</strong>
              <p>{apiMessage}</p>
            </div>
          </div>

          <form className="tech-login-form" onSubmit={handleLogin}>
            {error && <div className="login-error">{error}</div>}

            <label className="tech-field">
              <span className="field-icon">U</span>
              <span className="field-divider" />
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="请输入用户名"
                autoComplete="username"
                disabled={isLoading}
              />
              <i className="field-focus-line" />
            </label>

            <label className="tech-field">
              <span className="field-icon">P</span>
              <span className="field-divider" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                autoComplete="current-password"
                disabled={isLoading}
              />
              <button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? '隐' : '显'}
              </button>
              <i className="field-focus-line" />
            </label>

            <div className="login-options">
              <label className="tech-checkbox">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                />
                <span className="checkbox-ui"><i /></span>
                <span>记住登录状态</span>
              </label>
              <span>默认：admin / 123456</span>
            </div>

            <button className="tech-login-button" type="submit" disabled={isLoading}>
              <span className="button-scan" />
              {isLoading ? <><i className="login-spinner" />登录中...</> : '登 录'}
            </button>

            <div className="secure-tip"><span className="secure-dot" />VEHICLE CONTROL CHANNEL <b>ONLINE</b></div>
          </form>
        </div>
      </section>

      <footer className="login-footer">
        <span>室内巡检无人车综合管控平台</span>
        <i />
        <span>SMART INDOOR PATROL</span>
      </footer>
    </main>
  )
}

export default Login
