import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '../styles/DeviceControl.css'

const controlSections = [
  { id: 'manual', label: '手动控制' },
  { id: 'recognition', label: '目标识别' },
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
  const [movementStreamUrl, setMovementStreamUrl] = useState('')
  const [recognitionStreamUrl, setRecognitionStreamUrl] = useState('')
  const [movementStreamHost, setMovementStreamHost] = useState('')
  const [cameraProfiles, setCameraProfiles] = useState([])
  const [cameraSettings, setCameraSettings] = useState({
    width: 3840,
    height: 2160,
    fps: 30,
    jpeg_quality: 95,
  })
  const [cameraActual, setCameraActual] = useState(null)
  const [movementRefreshKey, setMovementRefreshKey] = useState(0)
  const [recognitionRefreshKey, setRecognitionRefreshKey] = useState(0)
  const [isApplyingCamera, setIsApplyingCamera] = useState(false)
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false)
  const [dualBoard, setDualBoard] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [activeDirections, setActiveDirections] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const commandLoopRef = useRef(null)
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

  useEffect(() => {
    selectedVehicleIdRef.current = selectedVehicleId
  }, [selectedVehicleId])

  const withVehicle = useCallback((path) => {
    const vehicleId = selectedVehicleIdRef.current
    if (!vehicleId) {
      return path
    }
    const separator = path.includes('?') ? '&' : '?'
    return `${path}${separator}vehicle_id=${encodeURIComponent(vehicleId)}`
  }, [])

  const movementCameraUrl = useMemo(() => {
    if (!movementStreamUrl) {
      return ''
    }
    const separator = movementStreamUrl.includes('?') ? '&' : '?'
    return `${movementStreamUrl}${separator}t=${movementRefreshKey || Date.now()}`
  }, [movementStreamUrl, movementRefreshKey])

  const recognitionCameraUrl = useMemo(() => {
    if (!recognitionStreamUrl) {
      return ''
    }
    const separator = recognitionStreamUrl.includes('?') ? '&' : '?'
    return `${recognitionStreamUrl}${separator}t=${recognitionRefreshKey || Date.now()}`
  }, [recognitionStreamUrl, recognitionRefreshKey])

  const selectedProfileKey = useMemo(() => {
    const match = cameraProfiles.find(
      (profile) =>
        profile.width === cameraSettings.width && profile.height === cameraSettings.height,
    )
    return match ? `${match.width}x${match.height}` : `${cameraSettings.width}x${cameraSettings.height}`
  }, [cameraProfiles, cameraSettings.width, cameraSettings.height])

  const fpsOptions = useMemo(() => {
    const profile = cameraProfiles.find(
      (item) => item.width === cameraSettings.width && item.height === cameraSettings.height,
    )
    return profile?.fps_options || [60, 30, 25, 23, 20, 15, 10]
  }, [cameraProfiles, cameraSettings.width, cameraSettings.height])

  const resolveMovementStreamUrl = useCallback((movementData, recognitionUrl = '') => {
    if (!movementData) {
      return ''
    }

    const host = (movementData.movement_host || '').trim()
    const derivedUrl = host ? `http://${host}:8080/` : ''
    let streamUrl = (movementData.stream_url || derivedUrl || '').trim()

    if (
      movementData.dual_board
      && recognitionUrl
      && streamUrl === recognitionUrl
      && derivedUrl
      && derivedUrl !== recognitionUrl
    ) {
      streamUrl = derivedUrl
    }

    return streamUrl
  }, [])

  const applyRecognitionPayload = useCallback((cameraData) => {
    if (!cameraData) {
      return
    }
    setRecognitionStreamUrl(cameraData.stream_url || '')
    setCameraProfiles(cameraData.profiles || [])
    setDualBoard(Boolean(cameraData.dual_board))
    const settings = cameraData.settings || cameraData.defaults || {}
    setCameraSettings({
      width: settings.width || 3840,
      height: settings.height || 2160,
      fps: settings.fps || 30,
      jpeg_quality: settings.jpeg_quality || 95,
    })
    setCameraActual({
      width: settings.actual_width,
      height: settings.actual_height,
      fps: settings.actual_fps,
    })
  }, [])

  const loadVehicleInfo = useCallback(async (ignore = false) => {
    const [movementResult, recognitionResult, statusResult] = await Promise.allSettled([
      fetch(withVehicle('/api/vehicle/movement-camera'), { credentials: 'include' }),
      fetch(withVehicle('/api/vehicle/camera'), { credentials: 'include' }),
      fetch(withVehicle('/api/vehicle/status'), { credentials: 'include' }),
    ])

    if (ignore) {
      return
    }

    let recognitionUrl = ''
    if (recognitionResult.status === 'fulfilled' && recognitionResult.value.ok) {
      const recognitionData = await recognitionResult.value.json()
      recognitionUrl = recognitionData.stream_url || ''
      applyRecognitionPayload(recognitionData)
    }

    if (movementResult.status === 'fulfilled' && movementResult.value.ok) {
      const movementData = await movementResult.value.json()
      const movementUrl = resolveMovementStreamUrl(movementData, recognitionUrl)
      setMovementStreamUrl(movementUrl)
      setMovementStreamHost(movementData.movement_host || '')
      setDualBoard(Boolean(movementData.dual_board))

      if (
        movementData.dual_board
        && recognitionUrl
        && movementUrl === recognitionUrl
      ) {
        setLastCommand('配置异常：辅助摄像头与 4K 识别流地址相同，请检查 vehicles.json 或重启后端')
      } else if (
        movementData.status?.actual_width
        && Number(movementData.status.actual_width) > 1280
      ) {
        setLastCommand(
          `警告：运动板摄像头分辨率为 ${movementData.status.actual_width}x${movementData.status.actual_height}，可能未部署辅助摄像头脚本`,
        )
      }
    }

    if (statusResult.status === 'fulfilled' && statusResult.value.ok) {
      setVehicleStatus('Nano 在线')
      return
    }

    setVehicleStatus('Nano 未连接')
  }, [withVehicle, applyRecognitionPayload, resolveMovementStreamUrl])

  const applyCameraSettings = async () => {
    setIsApplyingCamera(true)
    setLastCommand('正在应用 4K 摄像头参数')

    try {
      const response = await fetch('/api/vehicle/camera/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          vehicle_id: selectedVehicleIdRef.current || undefined,
          width: cameraSettings.width,
          height: cameraSettings.height,
          fps: cameraSettings.fps,
          jpeg_quality: cameraSettings.jpeg_quality,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.detail || '摄像头参数应用失败')
      }

      if (data.settings) {
        setCameraActual({
          width: data.settings.actual_width,
          height: data.settings.actual_height,
          fps: data.settings.actual_fps,
        })
      }
      setRecognitionRefreshKey(Date.now())
      setLastCommand(
        `4K 摄像头已切换：${cameraSettings.width}x${cameraSettings.height} @ ${cameraSettings.fps}fps`,
      )
    } catch (error) {
      setLastCommand(error instanceof Error ? error.message : '摄像头参数应用失败')
    } finally {
      setIsApplyingCamera(false)
    }
  }

  const capturePhoto = async () => {
    setIsCapturingPhoto(true)
    setLastCommand('正在拍照…')

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 15000)

    try {
      const response = await fetch(withVehicle('/api/vehicle/camera/capture'), {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
      })

      if (!response.ok) {
        const contentType = response.headers.get('Content-Type') || ''
        if (contentType.includes('application/json')) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.detail || '拍照失败')
        }
        const text = await response.text().catch(() => '')
        throw new Error(text || '拍照失败')
      }

      const blob = await response.blob()
      if (!blob.size) {
        throw new Error('摄像头返回空图片')
      }
      const disposition = response.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename="(.+?)"/)
      const filename = match?.[1] || `capture_${selectedVehicleIdRef.current || 'vehicle'}_${Date.now()}.jpg`

      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)

      setLastCommand(`拍照成功，已下载 ${filename}`)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setLastCommand('拍照超时：请检查 nano1camera 识别板 8080 服务与 /snapshot 接口')
      } else {
        setLastCommand(error instanceof Error ? error.message : '拍照失败')
      }
    } finally {
      window.clearTimeout(timeoutId)
      setIsCapturingPhoto(false)
    }
  }

  useEffect(() => {
    let ignore = false

    const loadVehicleList = async () => {
      try {
        const response = await fetch('/api/vehicles', { credentials: 'include' })
        if (!response.ok) {
          return
        }
        const data = await response.json()
        if (ignore) {
          return
        }
        const list = data.vehicles || []
        setVehicles(list)
        const defaultId =
          data.default_vehicle_id || (list.length > 0 ? list[0].id : '')
        setSelectedVehicleId((current) => current || defaultId)
      } catch {
        // 列表拉取失败不阻塞页面。
      }
    }

    loadVehicleList()

    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    if (!selectedVehicleId) {
      return undefined
    }

    let ignore = false
    setMovementStreamUrl('')
    setRecognitionStreamUrl('')
    setMovementStreamHost('')
    setCameraProfiles([])
    setCameraActual(null)
    setDualBoard(false)
    setMovementRefreshKey(0)
    setRecognitionRefreshKey(0)
    setVehicleStatus('未连接')
    setLastCommand('等待下发控制命令')
    loadVehicleInfo(ignore)

    return () => {
      ignore = true
    }
  }, [selectedVehicleId, loadVehicleInfo])

  const connectVehicle = async () => {
    setIsConnecting(true)
    setVehicleStatus('正在连接')
    setLastCommand('正在启动运动控制板与识别摄像头服务')

    try {
      const response = await fetch(withVehicle('/api/vehicle/connect'), {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.detail || '连接车失败')
      }

      const movementUrl = resolveMovementStreamUrl(
        {
          stream_url: data.movement_camera_stream_url,
          movement_host: data.boards?.find?.((item) => item.board === 'movement')?.host
            || data.movement_host,
          dual_board: data.dual_board,
        },
        data.camera_stream_url || '',
      )

      setMovementStreamUrl(movementUrl)
      setMovementStreamHost(
        data.movement_host
          || data.boards?.find?.((item) => item.board === 'movement')?.host
          || '',
      )
      setRecognitionStreamUrl(data.camera_stream_url || '')
      setDualBoard(Boolean(data.dual_board))
      if (data.camera_settings) {
        setCameraSettings((current) => ({
          ...current,
          ...data.camera_settings,
        }))
      }
      setMovementRefreshKey(Date.now())
      setRecognitionRefreshKey(Date.now())
      setVehicleStatus(data.agent?.online ? 'Nano 在线' : 'Nano 启动中')
      setLastCommand(
        data.movement_camera?.has_frame && data.camera?.has_frame
          ? (data.dual_board
              ? '连接成功：辅助摄像头 + 4K 识别摄像头已就绪'
              : '连接成功：控制服务和摄像头服务已启动')
          : data.movement_camera?.has_frame
            ? (data.dual_board
                ? '运动板辅助摄像头已就绪；4K 识别摄像头仍在出图'
                : '连接命令已下发：摄像头正在出图')
            : '连接命令已下发：请检查运动板辅助摄像头服务',
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
      if (activeSection !== 'manual') {
        return
      }
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
      if (activeSection !== 'manual') {
        return
      }
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
  }, [activeSection, clearCommandLoop, refreshKeyboardLoop, stopMotion])

  const renderTeleopPanel = () => (
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
  )

  const renderRecognitionToolbar = () => (
    <div className="camera-toolbar">
      <label>
        <span>分辨率</span>
        <select
          value={selectedProfileKey}
          disabled={!recognitionStreamUrl || isApplyingCamera}
          onChange={(event) => {
            const profile = cameraProfiles.find(
              (item) => `${item.width}x${item.height}` === event.target.value,
            )
            if (!profile) {
              return
            }
            setCameraSettings((current) => ({
              ...current,
              width: profile.width,
              height: profile.height,
              fps: profile.fps_options.includes(current.fps)
                ? current.fps
                : profile.fps_options[0],
            }))
          }}
        >
          {cameraProfiles.length > 0 ? (
            cameraProfiles.map((profile) => (
              <option
                key={`${profile.width}x${profile.height}`}
                value={`${profile.width}x${profile.height}`}
              >
                {profile.label} ({profile.width}x{profile.height})
              </option>
            ))
          ) : (
            <option value={`${cameraSettings.width}x${cameraSettings.height}`}>
              {cameraSettings.width}x{cameraSettings.height}
            </option>
          )}
        </select>
      </label>

      <label>
        <span>帧率</span>
        <select
          value={cameraSettings.fps}
          disabled={!recognitionStreamUrl || isApplyingCamera}
          onChange={(event) =>
            setCameraSettings((current) => ({
              ...current,
              fps: Number(event.target.value),
            }))
          }
        >
          {fpsOptions.map((fps) => (
            <option key={fps} value={fps}>
              {fps} fps
            </option>
          ))}
        </select>
      </label>

      <label className="camera-quality">
        <span>画质 {cameraSettings.jpeg_quality}</span>
        <input
          type="range"
          min="70"
          max="100"
          step="1"
          value={cameraSettings.jpeg_quality}
          disabled={!recognitionStreamUrl || isApplyingCamera}
          onChange={(event) =>
            setCameraSettings((current) => ({
              ...current,
              jpeg_quality: Number(event.target.value),
            }))
          }
        />
      </label>

      <button
        type="button"
        className="camera-apply-button"
        disabled={!recognitionStreamUrl || isApplyingCamera}
        onClick={applyCameraSettings}
      >
        {isApplyingCamera ? '应用中' : '应用画面参数'}
      </button>

      <button
        type="button"
        className="camera-capture-button"
        disabled={!recognitionStreamUrl || isCapturingPhoto}
        onClick={capturePhoto}
      >
        {isCapturingPhoto ? '拍照中' : '拍照并下载'}
      </button>

      {cameraActual?.width ? (
        <span className="camera-actual">
          实际输出：{cameraActual.width}x{cameraActual.height}
          {cameraActual.fps ? ` @ ${Number(cameraActual.fps).toFixed(0)}fps` : ''}
        </span>
      ) : null}
    </div>
  )

  return (
    <section className="device-control-page">
      <header className="device-control-header">
        <div>
          <p className="control-kicker">Device Control</p>
          <h1>设备控制</h1>
          <p>
            手动控制页使用运动板辅助摄像头；目标识别页使用 4K 相机进行观测与拍照。
          </p>
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
              disabled={isConnecting || vehicles.length === 0}
            >
              {vehicles.length === 0 ? (
                <option value="">默认车辆</option>
              ) : (
                vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.name}
                  </option>
                ))
              )}
            </select>
          </label>
          <button
            type="button"
            className="vehicle-connect-button"
            onClick={connectVehicle}
            disabled={isConnecting || !selectedVehicleId}
          >
            {isConnecting ? '连接中' : '连接车'}
          </button>
          <div className="vehicle-chip">
            <span className="vehicle-status-dot" />
            {vehicleStatus}
            {dualBoard ? <span className="vehicle-dual-tag">双板</span> : null}
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

      {activeSection === 'manual' && (
        <div className="control-stage">
          <section className="camera-stage" aria-label="辅助摄像头实时画面">
            {movementStreamHost ? (
              <p className="camera-source-label">
                运动板辅助摄像头 · {movementStreamHost}:8080
              </p>
            ) : null}
            {movementCameraUrl ? (
              <img
                key={`movement-${movementCameraUrl}`}
                src={movementCameraUrl}
                alt="运动板辅助摄像头实时画面"
              />
            ) : (
              <div className="camera-placeholder">连接车辆后显示辅助摄像头画面</div>
            )}
          </section>
          {renderTeleopPanel()}
        </div>
      )}

      {activeSection === 'recognition' && (
        <div className="control-stage control-stage-full">
          <section className="camera-stage recognition-stage" aria-label="4K 目标识别画面">
            {renderRecognitionToolbar()}
            {recognitionCameraUrl ? (
              <img
                key={`recognition-${recognitionCameraUrl}`}
                src={recognitionCameraUrl}
                alt="4K 目标识别摄像头实时画面"
              />
            ) : (
              <div className="camera-placeholder">连接车辆后显示 4K 识别摄像头画面</div>
            )}
          </section>
        </div>
      )}

      {activeSection === 'status' && (
        <div className="section-placeholder">
          <h2>状态反馈</h2>
          <p>车辆状态：{vehicleStatus}</p>
          <p>{lastCommand}</p>
        </div>
      )}

      {activeSection === 'tasks' && (
        <div className="section-placeholder">
          <h2>任务控制</h2>
          <p>任务调度功能预留中。</p>
        </div>
      )}

      {activeSection === 'settings' && (
        <div className="section-placeholder">
          <h2>参数设置</h2>
          <p>全局参数设置功能预留中。</p>
        </div>
      )}
    </section>
  )
}

export default DeviceControl
