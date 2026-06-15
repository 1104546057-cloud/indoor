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

// 前端遥控不是“点一次发一次”，而是按住按钮/方向键时持续刷新命令。
// Nano 端 vehicle_agent 有 command_timeout，超过 0.6s 没收到新命令会自动停车。
const commandRepeatMs = 160

// 车辆在线/离线状态定时刷新，用于下拉框显示 nano1/nano2/nano3 的状态。
const vehiclePollMs = 5000
const fallbackVehicles = [{ id: '', name: '默认车辆', online: false, status: 'unknown' }]

// 网页雷达图只是调试展示，不参与 ROS 导航；真实建图导航仍使用 ROS 原始 /lidar/scan。
const lidarMaxRange = 5
const lidarDemoPointCount = 100

// 当 Nano 上的 lidar_ws_server.py 未连接时，用演示点云占位。
// 这样页面布局和 Canvas 效果可以先看见，不会出现一块空白区域。
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

// 兼容两种雷达 WebSocket 数据格式：
// 1. 桥接服务已经转换好的 points: [{ x, y, range }]
// 2. 原始 LaserScan 风格的 ranges + angle_min + angle_increment
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

// 从点云里提取三个最容易看懂的摘要指标：
// 前方最近障碍、左侧最近障碍、右侧最近障碍。
function summarizeLidar(points) {
  const summary = {
    front: null,
    left: null,
    right: null,
  }

  points.forEach((point) => {
    const angle = Math.atan2(point.y, point.x)
    const range = point.range ?? Math.hypot(point.x, point.y)
    if (!Number.isFinite(range)) {
      return
    }

    if (Math.abs(angle) <= Math.PI / 8) {
      summary.front = summary.front === null ? range : Math.min(summary.front, range)
    } else if (angle > Math.PI / 8 && angle < (Math.PI * 7) / 8) {
      summary.left = summary.left === null ? range : Math.min(summary.left, range)
    } else if (angle < -Math.PI / 8 && angle > (-Math.PI * 7) / 8) {
      summary.right = summary.right === null ? range : Math.min(summary.right, range)
    }
  })

  return summary
}

function formatDistance(value) {
  return value === null ? '--' : `${value.toFixed(2)} m`
}

function DeviceControl() {
  // 页面基础状态：当前标签页、速度参数、最近命令提示、车辆连接状态。
  const [activeSection, setActiveSection] = useState('manual')
  const [linearSpeed, setLinearSpeed] = useState(0.2)
  const [angularSpeed, setAngularSpeed] = useState(0.3)
  const [acceleration, setAcceleration] = useState(0.4)
  const [lastCommand, setLastCommand] = useState('等待下发控制命令')
  const [vehicleStatus, setVehicleStatus] = useState('未连接')

  // 摄像头和雷达显示状态。摄像头走 Nano 的 MJPEG HTTP，雷达走 Nano 的 WebSocket。
  const [cameraStreamUrl, setCameraStreamUrl] = useState('')
  const [lidarWsUrl, setLidarWsUrl] = useState('')
  const [lidarStatus, setLidarStatus] = useState('未连接')
  const [lidarPoints, setLidarPoints] = useState([])
  const [lidarSummary, setLidarSummary] = useState({ front: null, left: null, right: null })
  const [isLidarDemo, setIsLidarDemo] = useState(false)

  // 多车相关状态：车辆列表来自 /api/vehicles，selectedVehicleId 决定后续请求发给哪台车。
  const [isConnecting, setIsConnecting] = useState(false)
  const [activeDirections, setActiveDirections] = useState([])
  const [vehicles, setVehicles] = useState(fallbackVehicles)
  const [selectedVehicleId, setSelectedVehicleId] = useState('')

  // ref 用来给定时器、键盘事件、WebSocket 回调读取最新值，避免闭包拿到旧状态。
  const commandLoopRef = useRef(null)
  const lidarCanvasRef = useRef(null)
  const heldKeysRef = useRef(new Set())
  const activePointerDirectionRef = useRef(null)
  const selectedVehicleIdRef = useRef('')
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

  // 把当前选中的车辆 id 同步到 ref，供持续控制循环里的闭包读取最新值。
  useEffect(() => {
    selectedVehicleIdRef.current = selectedVehicleId
  }, [selectedVehicleId])

  // 给接口 URL 追加 vehicle_id 查询参数；为空时由后端使用默认车。
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

  // 刷新当前车辆的摄像头地址、车辆 agent 状态、雷达 WebSocket 地址。
  // 这个函数只拿“地址和状态”，不负责真正启动 Nano 服务。
  const loadVehicleInfo = useCallback(async (ignore = false) => {
    const [cameraResult, statusResult, lidarResult] = await Promise.allSettled([
      fetch(withVehicle('/api/vehicle/camera'), { credentials: 'include' }),
      fetch(withVehicle('/api/vehicle/status'), { credentials: 'include' }),
      fetch(withVehicle('/api/vehicle/lidar'), { credentials: 'include' }),
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

    let statusOnline = false
    if (statusResult.status === 'fulfilled') {
      const statusResponse = statusResult.value
      statusOnline = statusResponse.ok
    }
    setVehicleStatus(statusOnline ? 'Nano 在线' : 'Nano 未连接')

    if (lidarResult.status === 'fulfilled') {
      const lidarResponse = lidarResult.value
      if (!ignore && lidarResponse.ok) {
        const lidarData = await lidarResponse.json()
        setLidarWsUrl(lidarData.ws_url || '')
      }
    }
  }, [withVehicle])

  // 拉取车辆注册表，并逐台显示在线/离线。
  // 后端判断在线的标准是该车 vehicle_agent 的 /status 是否可访问。
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
      // 列表拉取失败不阻塞页面，仍可使用后端默认车。
      setVehicles(fallbackVehicles)
    }
  }, [])

  // 进入页面时拉取车辆列表，并周期刷新在线/离线状态。
  useEffect(() => {
    let ignore = false

    loadVehicleList(ignore)
    const timer = window.setInterval(() => loadVehicleList(ignore), vehiclePollMs)

    return () => {
      ignore = true
      window.clearInterval(timer)
    }
  }, [loadVehicleList])

  // 选中车辆变化时（含首次确定默认车），刷新该车的摄像头与状态。
  useEffect(() => {
    if (!selectedVehicleId) {
      return undefined
    }

    let ignore = false
    setCameraStreamUrl('')
    setLidarWsUrl('')
    setLidarPoints([])
    setLidarSummary({ front: null, left: null, right: null })
    setLidarStatus('未连接')
    setIsLidarDemo(false)
    setVehicleStatus('未连接')
    setLastCommand('等待下发控制命令')
    loadVehicleInfo(ignore)

    return () => {
      ignore = true
    }
  }, [selectedVehicleId, loadVehicleInfo])

  // 点击“连接车”：
  // 前端请求 FastAPI，FastAPI 再通过 SSH 到 Nano 执行 start_vehicle_services.sh。
  // 启动成功后，Nano 上会有 vehicle_agent(9000) 和 camera_mjpeg_server(8080)。
  const connectVehicle = async () => {
    setIsConnecting(true)
    setVehicleStatus('正在连接')
    setLastCommand('正在启动 Nano 控制和摄像头服务')

    try {
      const response = await fetch(withVehicle('/api/vehicle/connect'), {
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

  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId)
  const selectedVehicleOnline = Boolean(selectedVehicle?.online)

  // 雷达 WebSocket 主逻辑：
  // - 成功连接 ws://车辆IP:8090/ws/lidar 后，接收真实 /lidar/scan 转换点云。
  // - 连接失败或断开时，切到演示点云，页面明确标注“演示数据”。
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
      setLidarStatus('雷达桥接未连接，显示演示数据')
      demoTimer = window.setInterval(() => {
        tick += 1
        const points = buildDemoLidarFrame(tick)
        setLidarPoints(points)
        setLidarSummary(summarizeLidar(points))
      }, 160)
    }

    socket.onopen = () => {
      if (closed) {
        return
      }
      setIsLidarDemo(false)
      setLidarStatus('雷达在线')
    }

    socket.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data)
        const points = normalizeLidarFrame(frame)
        if (!points.length) {
          return
        }
        setIsLidarDemo(false)
        setLidarStatus(`雷达在线：${points.length} 点`)
        setLidarPoints(points)
        setLidarSummary(summarizeLidar(points))
      } catch {
        setLidarStatus('雷达数据格式错误')
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

  // Canvas 绘制雷达图。
  // 坐标约定：车辆在画布中心偏下，车头朝上；point.x 表示前后，point.y 表示左右。
  // Canvas 只负责可视化，不把点云反传给 ROS，也不参与避障决策。
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
    const centerY = rect.height * 0.58
    const scale = Math.min(rect.width, rect.height) / (lidarMaxRange * 2.25)

    context.fillStyle = '#0f181f'
    context.fillRect(0, 0, rect.width, rect.height)

    context.strokeStyle = 'rgba(216, 226, 223, 0.18)'
    context.lineWidth = 1
    ;[1, 2, 3, 4, 5].forEach((meters) => {
      context.beginPath()
      context.arc(centerX, centerY, meters * scale, 0, Math.PI * 2)
      context.stroke()
    })

    context.strokeStyle = 'rgba(216, 226, 223, 0.22)'
    context.beginPath()
    context.moveTo(centerX, centerY - lidarMaxRange * scale)
    context.lineTo(centerX, centerY + lidarMaxRange * scale)
    context.moveTo(centerX - lidarMaxRange * scale, centerY)
    context.lineTo(centerX + lidarMaxRange * scale, centerY)
    context.stroke()

    context.fillStyle = isLidarDemo ? '#f0b84f' : '#37c98b'
    lidarPoints.forEach((point) => {
      const canvasX = centerX + point.y * scale
      const canvasY = centerY - point.x * scale
      if (
        canvasX < -4 ||
        canvasX > rect.width + 4 ||
        canvasY < -4 ||
        canvasY > rect.height + 4
      ) {
        return
      }
      context.beginPath()
      context.arc(canvasX, canvasY, 2, 0, Math.PI * 2)
      context.fill()
    })

    context.fillStyle = '#ffffff'
    context.beginPath()
    context.moveTo(centerX, centerY - 12)
    context.lineTo(centerX - 8, centerY + 10)
    context.lineTo(centerX + 8, centerY + 10)
    context.closePath()
    context.fill()

    context.fillStyle = 'rgba(255, 255, 255, 0.72)'
    context.font = '12px sans-serif'
    context.fillText('前', centerX - 6, centerY - lidarMaxRange * scale - 8)
    context.fillText('左', centerX - lidarMaxRange * scale - 16, centerY + 4)
    context.fillText('右', centerX + lidarMaxRange * scale + 8, centerY + 4)
  }, [isLidarDemo, lidarPoints])

  // 下发速度命令到后端，再由后端转发到 Nano vehicle_agent 的 /cmd_vel。
  // 真正进入 ROS 后，会变成 geometry_msgs/Twist 发布到 /cmd_vel。
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
          vehicle_id: selectedVehicleIdRef.current || undefined,
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

  // 停止/急停都走 Nano agent 的 /stop，最终效果是发布零速度。
  const sendStopCommand = useCallback(async (label = '停止') => {
    try {
      const response = await fetch(withVehicle('/api/vehicle/stop'), {
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
  }, [withVehicle])

  const clearCommandLoop = useCallback(() => {
    if (commandLoopRef.current) {
      window.clearInterval(commandLoopRef.current)
      commandLoopRef.current = null
    }
  }, [])

  // 开始持续发控制命令。
  // 鼠标按住按钮、键盘方向键按住时都会进入这里，直到松开/停止才清理定时器。
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

  // 停止当前运动：清定时器、清按键状态、发送零速度。
  const stopMotion = useCallback((label = '停止') => {
    clearCommandLoop()
    activePointerDirectionRef.current = null
    heldKeysRef.current.clear()
    setActiveDirections([])
    sendStopCommand(label)
  }, [clearCommandLoop, sendStopCommand])

  // 根据当前按住的键盘方向键组合，合成 linear.x 和 angular.z。
  // 例如 ↑ + ← 会得到：前进速度 + 左转角速度，从而走左弧线。
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

  // 键盘按键集合变化后，刷新持续控制循环。
  const refreshKeyboardLoop = useCallback(() => {
    const nextDirections = Array.from(heldKeysRef.current)
    setActiveDirections(nextDirections)

    if (nextDirections.length === 0) {
      clearCommandLoop()
      return
    }

    startCommandLoop(buildKeyboardCommand)
  }, [buildKeyboardCommand, clearCommandLoop, startCommandLoop])

  // 鼠标/触摸按下方向按钮时，开始持续发送对应方向命令。
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

  // 鼠标/触摸松开或移出按钮时，立即停止车辆。
  const handleDirectionEnd = useCallback(() => {
    if (activePointerDirectionRef.current) {
      stopMotion()
    }
  }, [stopMotion])

  // 全局键盘控制：
  // 方向键控制车辆，空格停止；如果焦点在输入框/下拉框里，则不拦截键盘事件。
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
          <label className="vehicle-selector">
            <span>车辆</span>
            <select
              value={selectedVehicleId}
              onChange={(event) => {
                stopMotion('切换车辆')
                setSelectedVehicleId(event.target.value)
              }}
              disabled={isConnecting}
            >
              {vehicles.map((vehicle) => (
                <option key={vehicle.id || 'default'} value={vehicle.id}>
                  {vehicle.name} {vehicle.online ? '在线' : '离线'}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="vehicle-connect-button"
            onClick={connectVehicle}
            disabled={isConnecting}
          >
            {isConnecting ? '连接中' : '连接车'}
          </button>
          <div className="vehicle-chip">
            <span
              className={`vehicle-status-dot ${
                selectedVehicleOnline ? 'online' : 'offline'
              }`}
            />
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
        <div className="sensor-stage">
          <section className="camera-stage" aria-label="摄像头实时画面">
            {cameraUrl ? (
              <img src={cameraUrl} alt="无人车摄像头实时画面" />
            ) : (
              <div className="camera-placeholder">等待摄像头地址</div>
            )}
          </section>

          <section className="lidar-stage" aria-label="雷达二维点云">
            <div className="lidar-header">
              <div>
                <span>2D LiDAR</span>
                <strong>{lidarStatus}</strong>
              </div>
              <small>{isLidarDemo ? '演示数据' : '/lidar/scan'}</small>
            </div>
            <canvas ref={lidarCanvasRef} aria-label="二维雷达点云画布" />
            <div className="lidar-metrics">
              <span>前方 {formatDistance(lidarSummary.front)}</span>
              <span>左侧 {formatDistance(lidarSummary.left)}</span>
              <span>右侧 {formatDistance(lidarSummary.right)}</span>
            </div>
          </section>
        </div>

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
