import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '../styles/DeviceControl.css'

const directionButtons = [
  { id: 'forward', label: '前进', symbol: '▲', linear: 1, angular: 0 },
  { id: 'left', label: '左转', symbol: '◀', linear: 0, angular: 1 },
  { id: 'right', label: '右转', symbol: '▶', linear: 0, angular: -1 },
  { id: 'backward', label: '后退', symbol: '▼', linear: -1, angular: 0 },
]

const keyToDirection = {
  ArrowUp: 'forward',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowDown: 'backward',
}

const commandRepeatMs = 160
const vehiclePollMs = 5000
const fallbackVehicles = [{ id: '', name: '默认车辆', online: false, status: 'unknown' }]

const lidarMaxRange = 5
const lidarDemoPointCount = 100

function buildDemoLidarFrame(tick = 0) {
  const points = []
  for (let index = 0; index < lidarDemoPointCount; index += 1) {
    const angle = -Math.PI + (index / (lidarDemoPointCount - 1)) * Math.PI * 2
    const corridor = Math.abs(Math.sin(angle)) > 0.72 ? 1.15 : 3.4
    const frontObstacle = Math.abs(angle) < 0.18 ? 0.8 + Math.sin(tick / 12) * 0.06 : corridor
    const range = Math.min(corridor, frontObstacle) + Math.sin(index * 0.9 + tick / 8) * 0.03
    points.push({
      x: Math.cos(angle) * range,
      y: Math.sin(angle) * range,
      range,
    })
  }
  return points
}

function normalizeLidarFrame(frame) {
  if (Array.isArray(frame?.points)) {
    return frame.points
      .map((point) => ({
        x: Number(point.x),
        y: Number(point.y),
        range: Number(point.range ?? Math.hypot(Number(point.x), Number(point.y))),
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  }

  if (Array.isArray(frame?.ranges)) {
    const angleMin = Number(frame.angle_min ?? frame.angleMin ?? -Math.PI)
    const angleIncrement = Number(
      frame.angle_increment ?? frame.angleIncrement ?? (Math.PI * 2) / frame.ranges.length,
    )
    return frame.ranges
      .map((range, index) => {
        const value = Number(range)
        const angle = angleMin + index * angleIncrement
        return {
          x: Math.cos(angle) * value,
          y: Math.sin(angle) * value,
          range: value,
        }
      })
      .filter((point) => Number.isFinite(point.range) && point.range > 0.05)
  }

  return []
}

function DeviceControl() {
  const [cameraStreamUrl, setCameraStreamUrl] = useState('')
  const [lidarWsUrl, setLidarWsUrl] = useState('')
  const [lidarStatus, setLidarStatus] = useState('未连接')
  const [lidarPoints, setLidarPoints] = useState([])
  const [isLidarDemo, setIsLidarDemo] = useState(false)
  const [activeDirections, setActiveDirections] = useState([])
  const [vehicles, setVehicles] = useState(fallbackVehicles)
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [vehicleMenuOpen, setVehicleMenuOpen] = useState(false)
  const [controlMode, setControlMode] = useState('manual')
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionMessage, setConnectionMessage] = useState('车辆服务未连接')

  const commandLoopRef = useRef(null)
  const lidarCanvasRef = useRef(null)
  const heldKeysRef = useRef(new Set())
  const activePointerDirectionRef = useRef(null)
  const selectedVehicleIdRef = useRef('')
  const vehicleMenuRef = useRef(null)
  const controlProfileRef = useRef({
    linearSpeed: 0.2,
    angularSpeed: 0.3,
    acceleration: 0.4,
  })

  useEffect(() => {
    selectedVehicleIdRef.current = selectedVehicleId
  }, [selectedVehicleId])

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!vehicleMenuRef.current?.contains(event.target)) {
        setVehicleMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  const withVehicle = useCallback((path) => {
    const vehicleId = selectedVehicleIdRef.current
    if (!vehicleId) {
      return path
    }
    const separator = path.includes('?') ? '&' : '?'
    return `${path}${separator}vehicle_id=${encodeURIComponent(vehicleId)}`
  }, [])

  const cameraUrl = useMemo(() => {
    if (!cameraStreamUrl) {
      return ''
    }
    const separator = cameraStreamUrl.includes('?') ? '&' : '?'
    return `${cameraStreamUrl}${separator}t=${Date.now()}`
  }, [cameraStreamUrl])

  const loadVehicleInfo = useCallback(async (ignore = false) => {
    const [cameraResult, lidarResult] = await Promise.allSettled([
      fetch(withVehicle('/api/vehicle/camera'), { credentials: 'include' }),
      fetch(withVehicle('/api/vehicle/lidar'), { credentials: 'include' }),
    ])

    if (ignore) {
      return
    }

    if (cameraResult.status === 'fulfilled' && cameraResult.value.ok) {
      const cameraData = await cameraResult.value.json()
      setCameraStreamUrl(cameraData.stream_url || '')
    }

    if (lidarResult.status === 'fulfilled' && lidarResult.value.ok) {
      const lidarData = await lidarResult.value.json()
      setLidarWsUrl(lidarData.ws_url || '')
    }
  }, [withVehicle])

  const loadVehicleList = useCallback(async (ignore = false) => {
    try {
      const response = await fetch('/api/vehicles', { credentials: 'include' })
      if (!response.ok || ignore) {
        return
      }
      const data = await response.json()
      if (ignore) {
        return
      }
      const list = data.vehicles?.length ? data.vehicles : fallbackVehicles
      setVehicles(list)
      const defaultId = data.default_vehicle_id || (list.length > 0 ? list[0].id : '')
      setSelectedVehicleId((current) => current || defaultId)
    } catch {
      setVehicles(fallbackVehicles)
    }
  }, [])

  const connectVehicle = useCallback(async () => {
    setIsConnecting(true)
    setConnectionMessage('正在连接车辆服务...')

    try {
      const response = await fetch(withVehicle('/api/vehicle/connect'), {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.detail || '车辆连接失败')
      }

      const agentOnline = data.agent?.online ? 'agent 在线' : 'agent 未在线'
      const cameraReady = data.camera?.has_frame ? '摄像头已出帧' : '摄像头未出帧'
      setConnectionMessage(`${agentOnline}，${cameraReady}`)
      await loadVehicleList()
      await loadVehicleInfo()
    } catch (error) {
      setConnectionMessage(error instanceof Error ? error.message : '车辆连接失败')
    } finally {
      setIsConnecting(false)
    }
  }, [loadVehicleInfo, loadVehicleList, withVehicle])

  useEffect(() => {
    let ignore = false

    loadVehicleList(ignore)
    const timer = window.setInterval(() => loadVehicleList(ignore), vehiclePollMs)

    return () => {
      ignore = true
      window.clearInterval(timer)
    }
  }, [loadVehicleList])

  useEffect(() => {
    if (!selectedVehicleId) {
      return undefined
    }

    let ignore = false
    setCameraStreamUrl('')
    setLidarWsUrl('')
    setLidarPoints([])
    setLidarStatus('未连接')
    setIsLidarDemo(false)
    loadVehicleInfo(ignore)

    return () => {
      ignore = true
    }
  }, [selectedVehicleId, loadVehicleInfo])

  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId) || vehicles[0]
  const onlineVehicles = vehicles.filter((vehicle) => vehicle.online).length
  const pointCount = lidarPoints.length
  const nearestPoint = lidarPoints.reduce((nearest, point) => {
    const range = Number(point.range ?? Math.hypot(point.x, point.y))
    if (!Number.isFinite(range)) {
      return nearest
    }
    return Math.min(nearest, range)
  }, lidarMaxRange)

  const vehicleOnline = Boolean(selectedVehicle?.online)
  const vehicleStatusText = vehicleOnline ? 'ONLINE' : 'STANDBY'
  const cameraStatusText = cameraUrl ? 'STREAM' : 'WAIT'
  const lidarStatusText = pointCount > 0 ? 'ACTIVE' : isLidarDemo ? 'DEMO' : 'WAIT'

  const leftCards = [
    {
      title: 'TASK STATUS',
      rows: [
        ['巡检任务', '待命'],
        ['控制模式', controlMode === 'auto' ? 'AUTO' : 'MANUAL'],
        ['当前车辆', selectedVehicle?.name || selectedVehicle?.id || '未选择'],
        ['连接状态', connectionMessage],
      ],
      metrics: [
        { value: '03', label: '区域' },
        { value: '72%', label: '进度' },
      ],
    },
    {
      title: 'MAP / AREA',
      rows: [
        ['楼层区域', 'A1 通道'],
        ['定位状态', 'LOCAL'],
        ['导航地图', 'READY'],
      ],
      metrics: [
        { value: 'A1', label: 'ZONE' },
        { value: '12m', label: '半径' },
      ],
    },
    {
      title: 'ENVIRONMENT',
      rows: [
        ['温度', '24.8 C'],
        ['湿度', '46%'],
        ['照度', 'NORMAL'],
      ],
      metrics: [
        { value: '0', label: '烟雾' },
        { value: '98', label: '空气' },
      ],
    },
  ]

  const rightCards = [
    {
      title: 'ROBOT STATE',
      rows: [
        ['车辆状态', vehicleStatusText],
        ['摄像链路', cameraStatusText],
        ['雷达链路', lidarStatusText],
      ],
      metrics: [
        { value: onlineVehicles, label: '在线' },
        { value: vehicles.length, label: '总数' },
      ],
    },
    {
      title: 'POWER CORE',
      rows: [
        ['主电池', '86%'],
        ['电压', '24.2V'],
        ['电机温度', 'NORMAL'],
      ],
      metrics: [
        { value: '86%', label: 'BAT' },
        { value: '42W', label: '负载' },
      ],
    },
    {
      title: 'EVENTS',
      rows: [
        ['最近事件', pointCount > 0 ? '雷达刷新' : '等待数据'],
        ['最近距离', `${nearestPoint.toFixed(1)}m`],
        ['告警状态', nearestPoint < 1 ? 'NEAR' : 'CLEAR'],
      ],
      metrics: [
        { value: pointCount, label: '点云' },
        { value: nearestPoint < 1 ? '!' : 'OK', label: '告警' },
      ],
    },
  ]

  useEffect(() => {
    if (!lidarWsUrl) {
      return undefined
    }

    let closed = false
    let demoTimer = null
    const socket = new WebSocket(lidarWsUrl)

    const startDemo = () => {
      if (closed || demoTimer) {
        return
      }
      let tick = 0
      setIsLidarDemo(true)
      setLidarStatus('演示雷达')
      demoTimer = window.setInterval(() => {
        tick += 1
        setLidarPoints(buildDemoLidarFrame(tick))
      }, 160)
    }

    socket.onopen = () => {
      if (!closed) {
        setIsLidarDemo(false)
        setLidarStatus('雷达在线')
      }
    }

    socket.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data)
        const points = normalizeLidarFrame(frame)
        if (!points.length) {
          return
        }
        setIsLidarDemo(false)
        setLidarStatus('雷达在线')
        setLidarPoints(points)
      } catch {
        setLidarStatus('雷达数据错误')
      }
    }

    socket.onerror = startDemo
    socket.onclose = startDemo

    const fallbackTimer = window.setTimeout(() => {
      if (socket.readyState !== WebSocket.OPEN) {
        startDemo()
      }
    }, 1600)

    return () => {
      closed = true
      window.clearTimeout(fallbackTimer)
      if (demoTimer) {
        window.clearInterval(demoTimer)
      }
      socket.close()
    }
  }, [lidarWsUrl])

  useEffect(() => {
    const canvas = lidarCanvasRef.current
    if (!canvas) {
      return
    }

    const rect = canvas.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(rect.width * ratio))
    canvas.height = Math.max(1, Math.floor(rect.height * ratio))

    const context = canvas.getContext('2d')
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, rect.width, rect.height)

    const centerX = rect.width / 2
    const centerY = rect.height / 2
    const scale = Math.min(rect.width, rect.height) / (lidarMaxRange * 2.45)

    context.fillStyle = 'rgba(6, 21, 34, 0.08)'
    context.fillRect(0, 0, rect.width, rect.height)

    context.strokeStyle = 'rgba(95, 215, 255, 0.18)'
    context.lineWidth = 1
    ;[1, 2, 3, 4].forEach((meters) => {
      context.beginPath()
      context.arc(centerX, centerY, meters * scale, 0, Math.PI * 2)
      context.stroke()
    })

    context.strokeStyle = 'rgba(0, 191, 255, 0.22)'
    context.beginPath()
    context.moveTo(centerX, 0)
    context.lineTo(centerX, rect.height)
    context.moveTo(0, centerY)
    context.lineTo(rect.width, centerY)
    context.stroke()

    context.fillStyle = isLidarDemo ? 'rgba(255, 210, 92, 0.95)' : 'rgba(95, 215, 255, 0.95)'
    lidarPoints.forEach((point) => {
      const canvasX = centerX + point.y * scale
      const canvasY = centerY - point.x * scale
      if (canvasX < -4 || canvasX > rect.width + 4 || canvasY < -4 || canvasY > rect.height + 4) {
        return
      }
      context.beginPath()
      context.arc(canvasX, canvasY, 1.9, 0, Math.PI * 2)
      context.fill()
    })

    context.fillStyle = 'rgba(217, 246, 255, 0.94)'
    context.beginPath()
    context.moveTo(centerX, centerY - 13)
    context.lineTo(centerX - 9, centerY + 11)
    context.lineTo(centerX + 9, centerY + 11)
    context.closePath()
    context.fill()
  }, [isLidarDemo, lidarPoints])

  const sendVehicleCommand = useCallback(async (linearX, angularZ, label, acceleration) => {
    try {
      const response = await fetch('/api/vehicle/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          linear_x: linearX,
          angular_z: angularZ,
          acceleration,
          vehicle_id: selectedVehicleIdRef.current || undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || '控制命令下发失败')
      }
    } catch (error) {
      console.error(error)
    }
  }, [])

  const sendStopCommand = useCallback(async () => {
    try {
      await fetch(withVehicle('/api/vehicle/stop'), {
        method: 'POST',
        credentials: 'include',
      })
    } catch (error) {
      console.error(error)
    }
  }, [withVehicle])

  const clearCommandLoop = useCallback(() => {
    if (commandLoopRef.current) {
      window.clearInterval(commandLoopRef.current)
      commandLoopRef.current = null
    }
  }, [])

  const startCommandLoop = useCallback((buildCommand) => {
    clearCommandLoop()

    const publish = () => {
      const command = buildCommand(controlProfileRef.current)
      if (!command) {
        return
      }
      sendVehicleCommand(command.linearX, command.angularZ, command.label, command.acceleration)
    }

    publish()
    commandLoopRef.current = window.setInterval(publish, commandRepeatMs)
  }, [clearCommandLoop, sendVehicleCommand])

  const stopMotion = useCallback(() => {
    clearCommandLoop()
    activePointerDirectionRef.current = null
    heldKeysRef.current.clear()
    setActiveDirections([])
    sendStopCommand()
  }, [clearCommandLoop, sendStopCommand])

  const buildKeyboardCommand = useCallback((controls = controlProfileRef.current) => {
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
    activePointerDirectionRef.current = button.id
    setActiveDirections([button.id])
    startCommandLoop((controls) => ({
      linearX: button.linear * controls.linearSpeed,
      angularZ: button.angular * controls.angularSpeed,
      acceleration: controls.acceleration,
      label: button.label,
    }))
  }, [startCommandLoop])

  const handleDirectionEnd = useCallback(() => {
    if (activePointerDirectionRef.current) {
      stopMotion()
    }
  }, [stopMotion])

  const handleAutoToggle = () => {
    stopMotion()
    setControlMode((value) => (value === 'auto' ? 'manual' : 'auto'))
  }

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
        stopMotion()
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

  const renderHudCard = (card) => (
    <section className="hud-card" key={card.title}>
      <div className="hud-card-title">
        <span>{card.title}</span>
      </div>
      <div className="hud-metrics">
        {card.metrics.map((metric) => (
          <div className="hud-metric" key={`${card.title}-${metric.label}`}>
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
          </div>
        ))}
      </div>
      <div className="hud-row-list">
        {card.rows.map(([label, value]) => (
          <div className="hud-row" key={`${card.title}-${label}`}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </section>
  )

  return (
    <section className="device-control-page">
      <div className="cockpit-stage">
        <div className="frame-corner top-left" />
        <div className="frame-corner top-right" />
        <div className="frame-corner bottom-left" />
        <div className="frame-corner bottom-right" />

        <div className="vehicle-menu-anchor" ref={vehicleMenuRef}>
          <button
            type="button"
            className={`vehicle-menu-toggle${vehicleMenuOpen ? ' open' : ''}`}
            onClick={() => setVehicleMenuOpen((value) => !value)}
            aria-expanded={vehicleMenuOpen}
            aria-haspopup="listbox"
            title={selectedVehicle?.name || '选择车辆'}
          >
            <span className="vehicle-menu-emblem">V</span>
          </button>

          {vehicleMenuOpen && (
            <div className="vehicle-menu-dropdown" role="listbox" aria-label="车辆选择">
              <div className="vehicle-menu-heading">当前车辆</div>
              {vehicles.map((vehicle) => (
                <button
                  key={vehicle.id || 'default'}
                  type="button"
                  className={`vehicle-menu-item${selectedVehicleId === vehicle.id ? ' active' : ''}`}
                  onClick={() => {
                    stopMotion()
                    setSelectedVehicleId(vehicle.id)
                    setVehicleMenuOpen(false)
                  }}
                >
                  <span className={`vehicle-menu-dot ${vehicle.online ? 'online' : 'offline'}`} />
                  <span>{vehicle.name || vehicle.id}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="hud-column hud-column-left" aria-label="任务与环境状态">
          {leftCards.map(renderHudCard)}
        </aside>

        <main className="cockpit-center">
          <section className="camera-stage cockpit-view" aria-label="摄像头实时画面">
            <div className="camera-hud-label">
              <span className="live-dot" />
              <strong>LIVE</strong>
              <span>实时视频</span>
            </div>
            <button
              type="button"
              className="camera-connect-button"
              onClick={connectVehicle}
              disabled={isConnecting}
            >
              {isConnecting ? '连接中...' : '连接车辆'}
            </button>
            <div className="camera-link-status">{connectionMessage}</div>
            <div className="camera-corner top-left" />
            <div className="camera-corner top-right" />
            <div className="camera-corner bottom-left" />
            <div className="camera-corner bottom-right" />
            <div className="camera-reticle" />

            {cameraUrl ? (
              <img src={cameraUrl} alt="无人车摄像头实时画面" />
            ) : (
              <div className="camera-placeholder">
                <span>WAITING CAMERA LINK</span>
                <strong>等待摄像头连接</strong>
              </div>
            )}
          </section>
        </main>

        <aside className="hud-column hud-column-right" aria-label="机器人与告警状态">
          <section className="lidar-stage lidar-hud" aria-label={lidarStatus}>
            <div className="radar-title">
              <strong>RADAR</strong>
              <span>{lidarStatus}</span>
            </div>
            <div className="radar-shell">
              <canvas ref={lidarCanvasRef} aria-label="二维雷达点云画布" />
              <span className="radar-sweep" />
              <span className="radar-ring outer" />
              <span className="radar-ring inner" />
            </div>
          </section>
          {rightCards.map(renderHudCard)}
        </aside>

        <section className="cockpit-bottom-shell" aria-label="方向控制台">
          <div className="direction-console">
            {directionButtons.map((button) => (
              <button
                key={button.id}
                type="button"
                className={`direction-key ${button.id} ${
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
                <span>{button.symbol}</span>
                <small>{button.label}</small>
              </button>
            ))}
            <div className="control-core">
              <button type="button" className="core-stop" onClick={stopMotion}>STOP</button>
              <button
                type="button"
                className={`core-auto ${controlMode === 'auto' ? 'active' : ''}`}
                onClick={handleAutoToggle}
              >
                AUTO
              </button>
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}

export default DeviceControl
