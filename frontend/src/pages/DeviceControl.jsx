import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '../styles/DeviceControl.css'

const controlSections = [
  { id: 'manual', label: '手动控制' },
  { id: 'camera', label: '视频回传' },
  { id: 'status', label: '状态反馈' },
  { id: 'tasks', label: '任务控制' },
  { id: 'settings', label: '参数设置' },
]

const directionButtons = [
  { id: 'forward', label: '前进', symbol: '↑', linear: 1, angular: 0 },
  { id: 'left', label: '左转', symbol: '←', linear: 0, angular: 1 },
  { id: 'stop', label: '停止', symbol: '■', linear: 0, angular: 0, stop: true },
  { id: 'right', label: '右转', symbol: '→', linear: 0, angular: -1 },
  { id: 'backward', label: '后退', symbol: '↓', linear: -1, angular: 0 },
]

const keyToDirection = {
  ArrowUp: 'forward',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowDown: 'backward',
}

const commandRepeatMs = 160

function DeviceControl() {
  const [activeSection, setActiveSection] = useState('manual')
  const [linearSpeed, setLinearSpeed] = useState(0.2)
  const [angularSpeed, setAngularSpeed] = useState(0.3)
  const [acceleration, setAcceleration] = useState(0.4)
  const [lastCommand, setLastCommand] = useState('等待下发控制命令')
  const [vehicleStatus, setVehicleStatus] = useState('未连接')
  const [cameraStreamUrl, setCameraStreamUrl] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [activeDirections, setActiveDirections] = useState([])
  const commandLoopRef = useRef(null)
  const heldKeysRef = useRef(new Set())
  const activePointerDirectionRef = useRef(null)
  const latestControlRef = useRef({
    linearSpeed,
    angularSpeed,
    acceleration,
  })

  useEffect(() => {
    latestControlRef.current = {
      linearSpeed,
      angularSpeed,
      acceleration,
    }
  }, [linearSpeed, angularSpeed, acceleration])

  const cameraUrl = useMemo(() => {
    if (!cameraStreamUrl) {
      return ''
    }
    const separator = cameraStreamUrl.includes('?') ? '&' : '?'
    return `${cameraStreamUrl}${separator}t=${Date.now()}`
  }, [cameraStreamUrl])

  const loadVehicleInfo = async (ignore = false) => {
      const [cameraResult, statusResult] = await Promise.allSettled([
          fetch('/api/vehicle/camera', { credentials: 'include' }),
          fetch('/api/vehicle/status', { credentials: 'include' }),
        ])

      if (ignore) {
        return
      }

      if (cameraResult.status === 'fulfilled') {
        const cameraResponse = cameraResult.value
        if (!ignore && cameraResponse.ok) {
          const cameraData = await cameraResponse.json()
          setCameraStreamUrl(cameraData.stream_url || '')
        }
      }

      if (statusResult.status === 'fulfilled') {
        const statusResponse = statusResult.value
        if (!ignore && statusResponse.ok) {
          setVehicleStatus('Nano 在线')
          return
        }
      }

      if (!ignore) {
        setVehicleStatus('Nano 未连接')
      }
  }

  useEffect(() => {
    let ignore = false

    loadVehicleInfo(ignore)

    return () => {
      ignore = true
    }
  }, [])

  const connectVehicle = async () => {
    setIsConnecting(true)
    setVehicleStatus('正在连接')
    setLastCommand('正在启动 Nano 控制和摄像头服务')

    try {
      const response = await fetch('/api/vehicle/connect', {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.detail || '连接车失败')
      }

      setCameraStreamUrl(data.camera_stream_url || '')
      setVehicleStatus(data.agent?.online ? 'Nano 在线' : 'Nano 启动中')
      setLastCommand(
        data.camera?.has_frame
          ? '连接成功：控制服务和摄像头服务已启动'
          : '连接命令已下发：摄像头正在出图',
      )
      await loadVehicleInfo()
    } catch (error) {
      setVehicleStatus('Nano 未连接')
      setLastCommand(error instanceof Error ? error.message : '连接车失败')
    } finally {
      setIsConnecting(false)
    }
  }

  const sendVehicleCommand = useCallback(async (linearX, angularZ, label, commandAcceleration) => {
    try {
      const response = await fetch('/api/vehicle/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          linear_x: linearX,
          angular_z: angularZ,
          acceleration: commandAcceleration ?? latestControlRef.current.acceleration,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || '控制命令下发失败')
      }

      setVehicleStatus('Nano 在线')
      setLastCommand(
        `${label}：linear.x=${linearX.toFixed(2)} m/s，angular.z=${angularZ.toFixed(2)} rad/s`,
      )
    } catch (error) {
      setVehicleStatus('Nano 未连接')
      setLastCommand(error instanceof Error ? error.message : '控制命令下发失败')
    }
  }, [])

  const sendStopCommand = useCallback(async (label = '停止') => {
    try {
      const response = await fetch('/api/vehicle/stop', {
        method: 'POST',
        credentials: 'include',
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || '停止命令下发失败')
      }

      setVehicleStatus('Nano 在线')
      setLastCommand(`${label}：linear.x=0.00 m/s，angular.z=0.00 rad/s`)
    } catch (error) {
      setVehicleStatus('Nano 未连接')
      setLastCommand(error instanceof Error ? error.message : '停止命令下发失败')
    }
  }, [])

  const clearCommandLoop = useCallback(() => {
    if (commandLoopRef.current) {
      window.clearInterval(commandLoopRef.current)
      commandLoopRef.current = null
    }
  }, [])

  const startCommandLoop = useCallback((buildCommand) => {
    clearCommandLoop()

    const publish = () => {
      const command = buildCommand(latestControlRef.current)
      if (!command) {
        return
      }
      sendVehicleCommand(command.linearX, command.angularZ, command.label, command.acceleration)
    }

    publish()
    commandLoopRef.current = window.setInterval(publish, commandRepeatMs)
  }, [clearCommandLoop, sendVehicleCommand])

  const stopMotion = useCallback((label = '停止') => {
    clearCommandLoop()
    activePointerDirectionRef.current = null
    heldKeysRef.current.clear()
    setActiveDirections([])
    sendStopCommand(label)
  }, [clearCommandLoop, sendStopCommand])

  const buildKeyboardCommand = useCallback((controls = latestControlRef.current) => {
    const directions = heldKeysRef.current
    const linearAxis =
      (directions.has('forward') ? 1 : 0) + (directions.has('backward') ? -1 : 0)
    const angularAxis =
      (directions.has('left') ? 1 : 0) + (directions.has('right') ? -1 : 0)

    if (linearAxis === 0 && angularAxis === 0) {
      return null
    }

    return {
      linearX: linearAxis * controls.linearSpeed,
      angularZ: angularAxis * controls.angularSpeed,
      acceleration: controls.acceleration,
      label: '键盘遥控',
    }
  }, [])

  const refreshKeyboardLoop = useCallback(() => {
    const nextDirections = Array.from(heldKeysRef.current)
    setActiveDirections(nextDirections)

    if (nextDirections.length === 0) {
      clearCommandLoop()
      return
    }

    startCommandLoop(buildKeyboardCommand)
  }, [buildKeyboardCommand, clearCommandLoop, startCommandLoop])

  const handleDirectionStart = useCallback((button) => {
    if (button.stop) {
      stopMotion(button.label)
      return
    }

    activePointerDirectionRef.current = button.id
    setActiveDirections([button.id])
    startCommandLoop((controls) => ({
      linearX: button.linear * controls.linearSpeed,
      angularZ: button.angular * controls.angularSpeed,
      acceleration: controls.acceleration,
      label: button.label,
    }))
  }, [startCommandLoop, stopMotion])

  const handleDirectionEnd = useCallback(() => {
    if (activePointerDirectionRef.current) {
      stopMotion()
    }
  }, [stopMotion])

  useEffect(() => {
    const isFormControl = (target) =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement

    const handleKeyDown = (event) => {
      if (isFormControl(event.target)) {
        return
      }

      if (event.code === 'Space') {
        event.preventDefault()
        stopMotion('空格暂停')
        return
      }

      const direction = keyToDirection[event.key]
      if (!direction) {
        return
      }

      event.preventDefault()
      if (heldKeysRef.current.has(direction)) {
        return
      }

      activePointerDirectionRef.current = null
      heldKeysRef.current.add(direction)
      refreshKeyboardLoop()
    }

    const handleKeyUp = (event) => {
      const direction = keyToDirection[event.key]
      if (!direction) {
        return
      }

      event.preventDefault()
      heldKeysRef.current.delete(direction)

      if (heldKeysRef.current.size === 0) {
        stopMotion()
        return
      }

      refreshKeyboardLoop()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      clearCommandLoop()
    }
  }, [clearCommandLoop, refreshKeyboardLoop, stopMotion])

  return (
    <section className="device-control-page">
      <header className="device-control-header">
        <div>
          <p className="control-kicker">Device Control</p>
          <h1>设备控制</h1>
          <p>四驱车手动控制采用前进/后退叠加角速度的方式，实现弧线行驶。</p>
        </div>
        <div className="vehicle-actions">
          <button
            type="button"
            className="vehicle-connect-button"
            onClick={connectVehicle}
            disabled={isConnecting}
          >
            {isConnecting ? '连接中' : '连接车'}
          </button>
          <div className="vehicle-chip">
            <span className="vehicle-status-dot" />
            {vehicleStatus}
          </div>
        </div>
      </header>

      <nav className="control-tabs" aria-label="设备控制子导航">
        {controlSections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={activeSection === section.id ? 'control-tab active' : 'control-tab'}
            onClick={() => setActiveSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <div className="control-stage">
        <section className="camera-stage" aria-label="摄像头实时画面">
          {cameraUrl ? (
            <img src={cameraUrl} alt="无人车摄像头实时画面" />
          ) : (
            <div className="camera-placeholder">等待摄像头地址</div>
          )}
        </section>

        <aside className="teleop-panel" aria-label="无人车手动控制">
          <div className="vertical-sliders">
            <label>
              <input
                type="range"
                min="0.05"
                max="0.5"
                step="0.05"
                value={linearSpeed}
                onChange={(event) => setLinearSpeed(Number(event.target.value))}
                orient="vertical"
              />
              <span>线速度</span>
              <strong>{linearSpeed.toFixed(2)}</strong>
            </label>

            <label>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={angularSpeed}
                onChange={(event) => setAngularSpeed(Number(event.target.value))}
                orient="vertical"
              />
              <span>角速度</span>
              <strong>{angularSpeed.toFixed(2)}</strong>
            </label>

            <label>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={acceleration}
                onChange={(event) => setAcceleration(Number(event.target.value))}
                orient="vertical"
              />
              <span>加速度</span>
              <strong>{acceleration.toFixed(2)}</strong>
            </label>
          </div>

          <div className="direction-pad" aria-label="四方向控制">
            {directionButtons.map((button) => (
              <button
                key={button.id}
                type="button"
                className={`direction-key ${button.id} ${button.stop ? 'stop' : ''} ${
                  activeDirections.includes(button.id) ? 'pressed' : ''
                }`}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId)
                  handleDirectionStart(button)
                }}
                onPointerUp={handleDirectionEnd}
                onPointerCancel={handleDirectionEnd}
                onPointerLeave={handleDirectionEnd}
                title={button.label}
              >
                {button.symbol}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="emergency-button"
            onClick={() => sendStopCommand('急停')}
          >
            急停
          </button>

          <div className="command-preview">
            <span>最近命令</span>
            <strong>{lastCommand}</strong>
          </div>
        </aside>
      </div>
    </section>
  )
}

export default DeviceControl
