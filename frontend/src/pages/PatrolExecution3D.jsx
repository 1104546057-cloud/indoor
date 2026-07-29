import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { hanlinRoomMap, inspectionPointById } from '../data/hanlinRoomMap'
import { labBuildingMap, labInspectionPointById } from '../data/labBuildingMap'
import { saveInspectionResult } from '../utils/inspectionResults'
import { loadPatrolMonitorContext, savePatrolMonitorContext } from '../utils/patrolMonitor'
import '../styles/PatrolExecution3D.css'

const SCALE = 0.001
const DWELL_SECONDS = 2.4
const TRAVEL_SECONDS = 1.7

function getInspectionPhase(dwellProgress) {
  if (dwellProgress < 0.25) return { key: 'capture', label: '采集图像' }
  if (dwellProgress < 0.55) return { key: 'recognize', label: '表计识别' }
  if (dwellProgress < 0.82) return { key: 'upload', label: '结果上传' }
  return { key: 'complete', label: '识别完成' }
}

const movingPhase = { key: 'moving', label: '行驶中' }
const anomalyByTarget = {
  P32: { type: '电流偏高', value: '47.8 A', confidence: '92.4%', level: 'warning' },
  G05: { type: '温度告警', value: '71.6 C', confidence: '94.2%', level: 'alarm' },
  T2: { type: '运行噪声异常', value: '68 dB', confidence: '90.8%', level: 'warning' },
}

function getRecognitionResult(point) {
  if (!point) {
    return {
      status: 'normal',
      summary: '等待采集',
      confidence: '--',
      metrics: [],
    }
  }

  const anomaly = anomalyByTarget[point.targetName]
  if (anomaly) {
    return {
      status: anomaly.level,
      summary: anomaly.type,
      confidence: anomaly.confidence,
      metrics: [
        { label: anomaly.type, value: anomaly.value },
        { label: '置信度', value: anomaly.confidence },
      ],
    }
  }

  const numericSeed = point.targetName.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const voltage = 378 + (numericSeed % 7)
  const current = (34 + (numericSeed % 18) / 10).toFixed(1)
  return {
    status: 'normal',
    summary: '识别正常',
    confidence: `${96 + (numericSeed % 30) / 10}%`,
    metrics: [
      { label: '电压', value: `${voltage} V` },
      { label: '电流', value: `${current} A` },
    ],
  }
}

function getEvidenceImage(point, result) {
  const seed = point?.targetName || 'P00'
  const isAbnormal = result.status !== 'normal'
  const title = point?.targetName || '等待点位'
  const metric = result.metrics[0] || { label: '识别状态', value: result.summary }
  const accent = isAbnormal ? '#ff7467' : '#35f0bd'
  const bg = isAbnormal ? '#24151c' : '#071b25'
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#12394a"/>
          <stop offset="1" stop-color="${bg}"/>
        </linearGradient>
        <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
          <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#2b6f81" stroke-width="1" opacity=".28"/>
        </pattern>
      </defs>
      <rect width="640" height="420" fill="url(#g)"/>
      <rect width="640" height="420" fill="url(#grid)"/>
      <rect x="58" y="62" width="246" height="276" rx="10" fill="#0b252e" stroke="#7fcbd8" stroke-width="3" opacity=".9"/>
      <rect x="91" y="92" width="180" height="76" fill="#10191c" stroke="#274f5a"/>
      <circle cx="181" cy="242" r="72" fill="#d8e1e4" stroke="#f0fbff" stroke-width="10"/>
      <path d="M181 242 L226 142" stroke="#11191c" stroke-width="8" stroke-linecap="round"/>
      <circle cx="181" cy="242" r="18" fill="#21170b"/>
      <rect x="342" y="82" width="214" height="126" fill="#0b252e" stroke="${accent}" stroke-width="3"/>
      <rect x="364" y="112" width="168" height="14" fill="${accent}" opacity=".72"/>
      <rect x="364" y="144" width="120" height="12" fill="#7fcbd8" opacity=".5"/>
      <rect x="364" y="172" width="146" height="12" fill="#7fcbd8" opacity=".36"/>
      <rect x="342" y="238" width="214" height="70" fill="#0b252e" stroke="#2b6f81"/>
      <text x="42" y="34" fill="#8be8f4" font-family="Courier New, monospace" font-size="18" font-weight="700">POINT CAPTURE / ${seed}</text>
      <text x="364" y="274" fill="#dffcff" font-family="Arial, sans-serif" font-size="22" font-weight="700">${metric.label}</text>
      <text x="364" y="300" fill="${accent}" font-family="Courier New, monospace" font-size="24" font-weight="700">${metric.value}</text>
      <text x="58" y="372" fill="#dffcff" font-family="Arial, sans-serif" font-size="30" font-weight="700">${title}</text>
      <text x="58" y="398" fill="#8cbac6" font-family="Arial, sans-serif" font-size="18">visual evidence snapshot</text>
      <rect x="28" y="24" width="584" height="368" fill="none" stroke="${accent}" stroke-width="2" opacity=".65"/>
    </svg>
  `

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const allInspectionPointById = {
  ...inspectionPointById,
  ...labInspectionPointById,
}

function toScenePoint(point, mapData) {
  return new THREE.Vector3(
    (point.x - mapData.size.width / 2) * SCALE,
    0,
    (point.y - mapData.size.height / 2) * SCALE,
  )
}

function mapPoseToModelPoint(pose, mapData) {
  const slamMap = mapData?.slamMap
  if (!pose || !slamMap?.coverage || !slamMap?.imageSize || !slamMap?.yaml) {
    return null
  }

  const [originX, originY] = slamMap.yaml.origin
  const resolution = slamMap.yaml.resolution
  const pixelX = (pose.x - originX) / resolution
  const pixelY = slamMap.imageSize.height - ((pose.y - originY) / resolution)
  const normalizedX = slamMap.transform?.flipX ? 1 - (pixelX / slamMap.imageSize.width) : pixelX / slamMap.imageSize.width
  const normalizedY = slamMap.transform?.flipY ? 1 - (pixelY / slamMap.imageSize.height) : pixelY / slamMap.imageSize.height

  return {
    x: slamMap.coverage.x + normalizedX * slamMap.coverage.width,
    y: slamMap.coverage.y + normalizedY * slamMap.coverage.depth,
    yaw: pose.yaw ?? 0,
  }
}

function quaternionToYaw(orientation) {
  if (!orientation || orientation.z === undefined || orientation.w === undefined) {
    return null
  }

  const x = Number(orientation.x || 0)
  const y = Number(orientation.y || 0)
  const z = Number(orientation.z)
  const w = Number(orientation.w)
  if (![x, y, z, w].every(Number.isFinite)) return null
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
}

function mapYawToSceneRotation(yaw) {
  // ROS map: yaw=0 points +X and positive yaw turns toward +Y.
  // Three.js model: the car nose points along local +Z, while map +Y is
  // rendered toward scene -Z. Therefore positive ROS yaw must be added.
  return Math.PI / 2 + yaw
}

function readVehiclePose(status, mapData) {
  const pose = status?.pose?.position || status?.pose || status?.position || status?.odom?.pose?.pose?.position
  if (!pose) return null

  const orientation = status?.orientation || status?.pose?.orientation || status?.odom?.pose?.pose?.orientation
  const yaw = status?.yaw ?? status?.theta ?? status?.pose?.yaw ?? orientation?.yaw ?? quaternionToYaw(orientation)
  const rawPose = {
    x: Number(pose.x),
    y: Number(pose.y),
    yaw: Number.isFinite(Number(yaw)) ? Number(yaw) : 0,
  }
  if (!Number.isFinite(rawPose.x) || !Number.isFinite(rawPose.y)) return null

  const modelPoint = mapPoseToModelPoint(rawPose, mapData)
  return {
    ...rawPose,
    modelPoint,
    receivedAt: Date.now(),
  }
}

function navigationResultsToRoutePoints(navigation, mapData) {
  return (navigation?.results || []).map((result, index) => {
    const storedPoint = allInspectionPointById[result.point_id]
    if (storedPoint) return storedPoint

    const source = result.source || {}
    const modelPoint = Number.isFinite(Number(source.model_x)) && Number.isFinite(Number(source.model_y))
      ? { x: Number(source.model_x), y: Number(source.model_y) }
      : mapPoseToModelPoint({ x: Number(result.x), y: Number(result.y), yaw: Number(result.yaw || 0) }, mapData)
    if (!modelPoint) return null

    return {
      id: result.point_id || `ROUTE-${index + 1}`,
      name: result.point_name || `路线点 ${index + 1}`,
      targetName: result.point_name || `路线点 ${index + 1}`,
      x: modelPoint.x,
      y: modelPoint.y,
      yaw: result.yaw || 0,
      recognitionTargets: [],
    }
  }).filter(Boolean)
}

const LIVE_STATE_LABELS = {
  idle: '等待路线',
  queued: '路线已接收',
  moving: '行驶中',
  arrived: '已到达点位',
  completed: '巡检完成',
  failed: '执行失败',
  cancelled: '已停止',
}

function addBoxEdges(scene, mesh, color = 0x77ddea) {
  const edges = new THREE.EdgesGeometry(mesh.geometry)
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.48 }))
  line.position.copy(mesh.position)
  scene.add(line)
}

function PatrolExecution3D() {
  const mountRef = useRef(null)
  const pausedRef = useRef(false)
  const vehiclePoseRef = useRef(null)
  const navigationRef = useRef(null)
  const [isPaused, setIsPaused] = useState(false)
  const [viewMode, setViewMode] = useState('free')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [routeProgress, setRouteProgress] = useState(0)
  const [inspectionPhase, setInspectionPhase] = useState(movingPhase)
  const [completedResults, setCompletedResults] = useState({})
  const [vehicleTelemetry, setVehicleTelemetry] = useState(null)
  const [liveRoutePoints, setLiveRoutePoints] = useState([])
  const [cameraAvailable, setCameraAvailable] = useState(true)
  const [cameraRetryNonce, setCameraRetryNonce] = useState(0)
  const [isStopping, setIsStopping] = useState(false)
  const [isLogModalOpen, setIsLogModalOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const query = useMemo(() => new URLSearchParams(location.search), [location.search])
  const queryExecutionId = query.get('execution_id')
  const queryTaskId = query.get('task_id')
  const storedTask = useMemo(
    () => loadPatrolMonitorContext({ executionId: queryExecutionId, taskId: queryTaskId }),
    [queryExecutionId, queryTaskId],
  )
  const task = useMemo(() => ({ ...(storedTask || {}), ...(location.state || {}) }), [location.state, storedTask])
  const executionId = queryExecutionId || task.executionId || null
  const vehicleId = query.get('vehicle_id') || task.robot || 'nano1'
  const isReplayMode = query.get('replay') === '1' || Boolean(task.replayMode)
  const sceneMap = task.sceneId === 'power-room' ? hanlinRoomMap : labBuildingMap
  const pointIds = useMemo(() => (
    task.pointIds?.length ? task.pointIds : []
  ), [task.pointIds])
  const executionRoutePoints = useMemo(() => (
    task.routePoints?.length
      ? task.routePoints
      : pointIds.length
        ? pointIds.map((pointId) => allInspectionPointById[pointId]).filter(Boolean)
        : liveRoutePoints
  ), [liveRoutePoints, pointIds, task.routePoints])
  const navigation = vehicleTelemetry?.navigation || vehicleTelemetry?.status?.navigation || null
  const currentPoint = executionRoutePoints[currentIndex] || executionRoutePoints[0]
  const nextPoint = executionRoutePoints[currentIndex + 1] || currentPoint
  const currentResult = useMemo(() => {
    if (isReplayMode) {
      return completedResults[currentPoint?.id] || getRecognitionResult(currentPoint)
    }
    return {
        status: 'normal',
        summary: navigation?.state === 'arrived' ? '车端已确认到点' : '等待真实识别结果',
        confidence: '--',
        metrics: [],
      }
  }, [completedResults, currentPoint, isReplayMode, navigation?.state])
  const evidenceImage = getEvidenceImage(currentPoint, currentResult)
  const evidenceState = !isReplayMode
    ? (vehicleTelemetry?.connected ? '实时画面' : '视频离线')
    : inspectionPhase.key === 'moving'
    ? '等待到点'
    : inspectionPhase.key === 'capture'
      ? '采集中'
      : inspectionPhase.key === 'recognize'
        ? '识别中'
        : inspectionPhase.key === 'upload'
          ? '上传中'
          : '已归档'
  const evidenceTime = (
    !isReplayMode
      ? vehicleTelemetry?.lastSuccessAt
        ? new Date(vehicleTelemetry.lastSuccessAt).toLocaleTimeString('zh-CN', { hour12: false })
        : '--:--:--'
      :
    inspectionPhase.key === 'moving'
      ? '--:--:--'
      : new Date().toLocaleTimeString('zh-CN', { hour12: false })
  )
  const abnormalRecords = Object.values(completedResults).filter((result) => result.status !== 'normal')
  const vehicleStatus = useMemo(() => {
    const status = vehicleTelemetry?.status || {}
    const battery = status.battery ?? status.battery_percent
    const voltage = status.voltage
    const speed = Number.parseFloat(status.odom_linear_x ?? status.twist?.linear_x ?? status.speed ?? status.linear_speed ?? 0)
    const localization = status.localization || {}

    return {
      name: vehicleId,
      online: isReplayMode ? '回放模式' : vehicleTelemetry?.connected ? '在线' : '离线',
      speed: isReplayMode ? '--' : `${Number.isFinite(speed) ? speed.toFixed(2) : '0.00'} m/s`,
      battery: battery == null ? '--' : `${battery}%`,
      voltage: voltage == null ? '--' : `${Number(voltage).toFixed(1)} V`,
      signal: isReplayMode ? '本地回放' : vehicleTelemetry?.connected ? '正常' : '中断',
      localization: isReplayMode ? '回放' : localization.valid ? '可信' : localization.last_error || '无有效位姿',
    }
  }, [isReplayMode, vehicleId, vehicleTelemetry])
  const executionLogs = useMemo(() => {
    const now = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    if (!isReplayMode) {
      const logs = []
      if (vehicleTelemetry?.error) {
        logs.push({ time: now, type: '异常', text: vehicleTelemetry.error })
      }
      if (navigation?.last_error) {
        logs.push({ time: now, type: '异常', text: navigation.last_error })
      }
      if (navigation) {
        logs.push({
          time: now,
          type: '路线',
          text: `${LIVE_STATE_LABELS[navigation.state] || navigation.state}，已到达 ${navigation.reached_count || 0}/${navigation.route_total || 0} 个点`,
        })
      }
      const localization = vehicleTelemetry?.status?.localization
      logs.push({
        time: now,
        type: '定位',
        text: localization?.valid
          ? `map 位姿有效，时延 ${Number(localization.pose_age || 0).toFixed(2)} s`
          : localization?.last_error || '等待 map → base_link 位姿',
      })
      logs.push({
        time: now,
        type: '通信',
        text: vehicleTelemetry?.connected ? `${vehicleId} 实时状态已连接` : `${vehicleId} 当前离线`,
      })
      return logs.slice(0, 6)
    }

    const logs = [
      { time: '08:30:00', type: '任务', text: `${task.taskName || '巡检任务'} 已载入，执行车辆 ${task.robot || 'nano1'}` },
      { time: '08:30:05', type: '回放', text: '演示路线已载入，此模式不读取车辆实时状态' },
    ]

    if (currentPoint) {
      logs.unshift({ time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), type: '点位', text: `当前到达 ${currentPoint.targetName}，${inspectionPhase.label}` })
    }
    if (currentResult.metrics[0]) {
      logs.unshift({ time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), type: '识别', text: `${currentResult.metrics[0].label}：${currentResult.metrics[0].value} / ${currentResult.summary}` })
    }
    if (abnormalRecords.length > 0) {
      const latest = abnormalRecords[abnormalRecords.length - 1]
      logs.unshift({ time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), type: '异常', text: `${latest.targetName} ${latest.summary}，等待人工复核` })
    }
    if (isPaused) {
      logs.unshift({ time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), type: '暂停', text: '巡检已暂停，车辆保持当前位置' })
    }

    return logs.slice(0, 6)
  }, [abnormalRecords, currentPoint, currentResult, inspectionPhase.label, isPaused, isReplayMode, navigation, task.robot, task.taskName, vehicleId, vehicleTelemetry])

  useEffect(() => {
    pausedRef.current = isPaused
  }, [isPaused])

  useEffect(() => {
    if (isReplayMode || cameraAvailable) return undefined
    const timer = window.setTimeout(() => {
      setCameraRetryNonce((value) => value + 1)
      setCameraAvailable(true)
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [cameraAvailable, isReplayMode])

  useEffect(() => {
    navigationRef.current = navigation
    if (isReplayMode || !navigation) return

    const total = Number(navigation.route_total || executionRoutePoints.length || 0)
    const reached = Math.min(total, Math.max(0, Number(navigation.reached_count || 0)))
    const oneBasedIndex = Number(navigation.route_index || (total > 0 ? 1 : 0))
    const index = total > 0 ? Math.min(total - 1, Math.max(0, oneBasedIndex - 1)) : 0
    setCurrentIndex(index)
    setRouteProgress(total > 0 ? Math.round((reached / total) * 100) : 0)
    setInspectionPhase(
      navigation.state === 'arrived' || navigation.state === 'completed'
        ? { key: 'complete', label: navigation.state === 'completed' ? '路线完成' : '车端确认到点' }
        : movingPhase,
    )
  }, [executionRoutePoints.length, isReplayMode, navigation])

  useEffect(() => {
    let cancelled = false

    const loadVehicleStatus = async () => {
      if (isReplayMode) return
      try {
        const response = await fetch(`/api/vehicle/status?vehicle_id=${encodeURIComponent(vehicleId)}`, {
          credentials: 'include',
        })
        const status = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(status.detail || `车辆状态请求失败（${response.status}）`)

        const activeExecutionId = executionId || status.navigation?.execution_id
        let routeNavigation = status.navigation || null
        if (activeExecutionId) {
          const routeResponse = await fetch(
            `/api/vehicle/navigation-route/status?vehicle_id=${encodeURIComponent(vehicleId)}&execution_id=${encodeURIComponent(activeExecutionId)}`,
            { credentials: 'include' },
          )
          const routeStatus = await routeResponse.json().catch(() => ({}))
          if (routeResponse.ok) routeNavigation = routeStatus.navigation || routeStatus
          else if (routeResponse.status !== 404) {
            throw new Error(routeStatus.detail || `路线状态请求失败（${routeResponse.status}）`)
          }
        }
        if (cancelled) return

        const nextPose = status.localization?.valid === false ? null : readVehiclePose(status, sceneMap)
        vehiclePoseRef.current = nextPose
        navigationRef.current = routeNavigation
        setVehicleTelemetry({
          connected: Boolean(status.online),
          status,
          pose: nextPose,
          navigation: routeNavigation,
          lastSuccessAt: Date.now(),
          error: null,
        })

        const routePoints = navigationResultsToRoutePoints(routeNavigation, sceneMap)
        if (routePoints.length > 0) setLiveRoutePoints(routePoints)
        if (activeExecutionId) {
          savePatrolMonitorContext({
            ...task,
            executionId: activeExecutionId,
            taskId: routeNavigation?.task_id || task.taskId,
            taskName: task.taskName || '实验楼一巡检任务',
            sceneId: task.sceneId || 'lab-building',
            robot: vehicleId,
            routePoints: task.routePoints?.length ? task.routePoints : routePoints,
          })
        }
      } catch (error) {
        if (!cancelled) {
          setVehicleTelemetry((current) => ({
            ...(current || {}),
            connected: false,
            error: error.message,
          }))
        }
      }
    }

    loadVehicleStatus()
    const timer = window.setInterval(loadVehicleStatus, 500)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [executionId, isReplayMode, sceneMap, task, vehicleId])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x041522)
    const sceneSpan = Math.max(sceneMap.size.width, sceneMap.size.height) * SCALE
    scene.fog = new THREE.Fog(0x041522, sceneSpan * 0.72, sceneSpan * 1.9)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    mount.appendChild(renderer.domElement)

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 260)
    const initialTarget = new THREE.Vector3(0, 0, viewMode === 'free' ? -1.55 : 0)
    if (viewMode === 'top') camera.position.set(0, sceneSpan * 0.82, 0.2)
    else if (viewMode === 'follow') camera.position.set(-6.2, 6.8, 7.2)
    else if (sceneMap.id === labBuildingMap.id) camera.position.set(4, sceneSpan * 0.58, sceneSpan * 0.66)
    else camera.position.set(0.8, 10.8, 12.2)
    camera.lookAt(initialTarget)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.48
    controls.minDistance = sceneMap.id === labBuildingMap.id ? 24 : 6
    controls.maxDistance = sceneMap.id === labBuildingMap.id ? 150 : 34
    controls.target.copy(initialTarget)

    const ambient = new THREE.AmbientLight(0xbdefff, 0.55)
    scene.add(ambient)

    const mainLight = new THREE.DirectionalLight(0xdffcff, 1.15)
    mainLight.position.set(-10, 18, 8)
    mainLight.castShadow = true
    scene.add(mainLight)

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(sceneMap.size.width * SCALE, sceneMap.size.height * SCALE),
      new THREE.MeshStandardMaterial({ color: 0x071d2a, roughness: 0.82 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)

    const grid = new THREE.GridHelper(sceneSpan * 1.08, 60, 0x1d6f83, 0x0d3548)
    grid.position.y = 0.004
    scene.add(grid)

    const corridorMaterial = new THREE.MeshStandardMaterial({
      color: 0x17687a,
      emissive: 0x082c35,
      roughness: 0.62,
      transparent: true,
      opacity: 0.94,
    })

    const hallMaterial = new THREE.MeshStandardMaterial({
      color: 0x234f61,
      emissive: 0x071f29,
      roughness: 0.72,
      transparent: true,
      opacity: 0.92,
    })
    sceneMap.halls?.forEach((hall) => {
      const elevation = hall.elevation * SCALE
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(hall.width * SCALE, 0.16, hall.depth * SCALE),
        hallMaterial,
      )
      slab.position.set(
        (hall.x + hall.width / 2 - sceneMap.size.width / 2) * SCALE,
        elevation + 0.08,
        (hall.y + hall.depth / 2 - sceneMap.size.height / 2) * SCALE,
      )
      slab.receiveShadow = true
      scene.add(slab)
    })

    const rampMaterial = new THREE.MeshStandardMaterial({ color: 0x36a8b5, roughness: 0.58 })
    sceneMap.ramps?.forEach((ramp) => {
      const dx = (ramp.x2 - ramp.x1) * SCALE
      const dz = (ramp.y2 - ramp.y1) * SCALE
      const length = Math.hypot(dx, dz)
      const startElevation = ramp.startElevation * SCALE
      const endElevation = ramp.endElevation * SCALE
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(length, 0.1, ramp.width * SCALE),
        rampMaterial,
      )
      mesh.position.set(
        ((ramp.x1 + ramp.x2) / 2 - sceneMap.size.width / 2) * SCALE,
        (startElevation + endElevation) / 2 + 0.11,
        ((ramp.y1 + ramp.y2) / 2 - sceneMap.size.height / 2) * SCALE,
      )
      mesh.rotation.order = 'YXZ'
      mesh.rotation.y = -Math.atan2(dz, dx)
      mesh.rotation.z = Math.atan2(endElevation - startElevation, length)
      mesh.receiveShadow = true
      scene.add(mesh)
    })

    const columnMaterial = new THREE.MeshStandardMaterial({ color: 0xb2a487, roughness: 0.78 })
    sceneMap.columns?.forEach((column) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(column.sizeX * SCALE, column.height * SCALE, column.sizeY * SCALE),
        columnMaterial,
      )
      mesh.position.set(
        (column.x - sceneMap.size.width / 2) * SCALE,
        column.height * SCALE / 2 + 0.16,
        (column.y - sceneMap.size.height / 2) * SCALE,
      )
      mesh.castShadow = true
      mesh.receiveShadow = true
      scene.add(mesh)
      addBoxEdges(scene, mesh, 0xd9cdb4)
    })

    sceneMap.corridors?.forEach((segment) => {
      const dx = (segment.x2 - segment.x1) * SCALE
      const dz = (segment.y2 - segment.y1) * SCALE
      const length = Math.hypot(dx, dz) + segment.width * SCALE
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(length, 0.16, segment.width * SCALE),
        corridorMaterial,
      )
      strip.position.set(
        ((segment.x1 + segment.x2) / 2 - sceneMap.size.width / 2) * SCALE,
        0.08,
        ((segment.y1 + segment.y2) / 2 - sceneMap.size.height / 2) * SCALE,
      )
      strip.rotation.y = -Math.atan2(dz, dx)
      strip.receiveShadow = true
      scene.add(strip)
    })

    const landmarkMaterial = new THREE.MeshBasicMaterial({ color: 0xf3e600, transparent: true, opacity: 0.78 })
    sceneMap.landmarkLines.forEach((line) => {
      const lineWidth = (line.lineWidth || 100) * SCALE
      const x = (line.x - sceneMap.size.width / 2) * SCALE
      const z = (line.y - sceneMap.size.height / 2) * SCALE
      const width = line.width * SCALE
      const height = line.height * SCALE
      const segments = [
        { x: x + width / 2, z, w: width, h: lineWidth },
        { x: x + width / 2, z: z + height, w: width, h: lineWidth },
        { x, z: z + height / 2, w: lineWidth, h: height },
        { x: x + width, z: z + height / 2, w: lineWidth, h: height },
      ]

      segments.forEach((segment) => {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(segment.w, 0.025, segment.h), landmarkMaterial)
        strip.position.set(segment.x, 0.018, segment.z)
        scene.add(strip)
      })
    })

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x7fcbd8,
      emissive: 0x0b3440,
      roughness: 0.58,
      transparent: true,
      opacity: 0.34,
    })
    sceneMap.walls?.forEach((segment) => {
      const dx = (segment.x2 - segment.x1) * SCALE
      const dz = (segment.y2 - segment.y1) * SCALE
      const length = Math.hypot(dx, dz)
      const height = Math.min((segment.height || 4000) * SCALE, 4)
      const thickness = Math.max((segment.thickness || 90) * SCALE, 0.045)
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(length, height, thickness),
        wallMaterial,
      )
      wall.position.set(
        ((segment.x1 + segment.x2) / 2 - sceneMap.size.width / 2) * SCALE,
        height / 2 + 0.14,
        ((segment.y1 + segment.y2) / 2 - sceneMap.size.height / 2) * SCALE,
      )
      wall.rotation.y = -Math.atan2(dz, dx)
      wall.receiveShadow = true
      scene.add(wall)
      //addBoxEdges(scene, wall, 0x9edfea)
    })

    const cabinetMaterial = new THREE.MeshStandardMaterial({
      color: 0x245164,
      metalness: 0.18,
      roughness: 0.42,
      transparent: true,
      opacity: 0.88,
    })
    const transformerMaterial = new THREE.MeshStandardMaterial({
      color: 0x514b34,
      metalness: 0.12,
      roughness: 0.7,
      transparent: true,
      opacity: 0.92,
    })

    const activeCabinetEdges = new Map()
    sceneMap.cabinets.forEach((cabinet) => {
      const width = cabinet.width * SCALE
      const depth = cabinet.depth * SCALE
      const height = cabinet.height * SCALE
      const geometry = new THREE.BoxGeometry(width, height, depth)
      const mesh = new THREE.Mesh(
        geometry,
        cabinet.type === 'transformer' ? transformerMaterial : cabinetMaterial,
      )
      mesh.position.set(
        (cabinet.x + cabinet.width / 2 - sceneMap.size.width / 2) * SCALE,
        height / 2,
        (cabinet.y + cabinet.depth / 2 - sceneMap.size.height / 2) * SCALE,
      )
      mesh.castShadow = true
      mesh.receiveShadow = true
      scene.add(mesh)
      addBoxEdges(scene, mesh, cabinet.type === 'transformer' ? 0xffcf72 : 0x9edfea)

      const activeEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0xfff275, transparent: true, opacity: 0 }),
      )
      activeEdges.position.copy(mesh.position)
      activeEdges.visible = false
      scene.add(activeEdges)
      activeCabinetEdges.set(cabinet.id, activeEdges)
    })

    const routePoints = executionRoutePoints
    const routeVectors = routePoints.map((point) => toScenePoint(point, sceneMap))
    const routeGeometry = new THREE.BufferGeometry().setFromPoints(routeVectors.map((point) => (
      new THREE.Vector3(point.x, 0.07, point.z)
    )))
    scene.add(new THREE.Line(routeGeometry, new THREE.LineBasicMaterial({ color: 0x35f0bd, linewidth: 2 })))

    const trailGeometry = new THREE.BufferGeometry().setFromPoints([])
    const trailLine = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({ color: 0xfff275, transparent: true, opacity: 0.82 }),
    )
    scene.add(trailLine)
    const trailPoints = []

    const pointMaterial = new THREE.MeshBasicMaterial({ color: 0x9edfea })
    const startMaterial = new THREE.MeshBasicMaterial({ color: 0x35f0bd })
    const activePointMaterial = new THREE.MeshBasicMaterial({ color: 0xfff275 })
    const pointMarkers = []
    routeVectors.forEach((point, index) => {
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(index === 0 ? 0.16 : 0.11, index === 0 ? 0.16 : 0.11, 0.055, 24),
        index === 0 ? startMaterial : pointMaterial,
      )
      marker.position.set(point.x, 0.08, point.z)
      scene.add(marker)
      pointMarkers.push(marker)
    })

    const car = new THREE.Group()
    const carBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.58, 0.26, 0.78),
      new THREE.MeshStandardMaterial({ color: 0x35f0bd, roughness: 0.36, metalness: 0.22 }),
    )
    carBody.position.y = 0.21
    car.add(carBody)
    const sensor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.14, 24),
      new THREE.MeshStandardMaterial({ color: 0xdffcff, roughness: 0.28 }),
    )
    sensor.position.y = 0.42
    car.add(sensor)
    const heading = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.34, 3),
      new THREE.MeshBasicMaterial({ color: 0xfff275 }),
    )
    heading.position.set(0, 0.36, 0.46)
    heading.rotation.x = Math.PI / 2
    car.add(heading)
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.58, 36),
      new THREE.MeshBasicMaterial({ color: 0x35f0bd, transparent: true, opacity: 0.32, side: THREE.DoubleSide }),
    )
    glow.rotation.x = -Math.PI / 2
    glow.position.y = 0.012
    car.add(glow)
    scene.add(car)

    function resize() {
      const { clientWidth, clientHeight } = mount
      renderer.setSize(clientWidth, clientHeight)
      camera.aspect = clientWidth / Math.max(clientHeight, 1)
      camera.updateProjectionMatrix()
    }

    let frameId = 0
    const clock = new THREE.Clock()
    let virtualElapsed = 0
    let lastUiIndex = -1
    let lastUiProgress = -1
    let lastUiPhase = ''
    let lastActiveCabinetId = ''
    let lastCompletedPointId = ''
    const animate = () => {
      const delta = clock.getDelta()
      if (isReplayMode && !pausedRef.current) {
        virtualElapsed += delta
      }
      if (routeVectors.length > 0) {
        const stepDuration = DWELL_SECONDS + TRAVEL_SECONDS
        const cycleTime = virtualElapsed % (routeVectors.length * stepDuration)
        const routeIndex = Math.floor(cycleTime / stepDuration)
        const localTime = cycleTime % stepDuration
        const nextIndex = (routeIndex + 1) % routeVectors.length
        const isDwelling = localTime < DWELL_SECONDS
        const t = isDwelling ? 0 : (localTime - DWELL_SECONDS) / TRAVEL_SECONDS
        const current = routeVectors[routeIndex]
        const next = routeVectors[nextIndex]
        const livePose = vehiclePoseRef.current
        const livePoint = livePose?.modelPoint ? toScenePoint(livePose.modelPoint, sceneMap) : null
        const usingLivePose = !isReplayMode && Boolean(livePoint)
        const shouldReplayRoute = isReplayMode
        const shouldRenderCar = usingLivePose || shouldReplayRoute
        const liveRouteIndex = Math.max(0, Number(navigationRef.current?.route_index || 1) - 1)
        const displayRouteIndex = usingLivePose
          ? Math.min(routeVectors.length - 1, liveRouteIndex)
          : shouldReplayRoute ? routeIndex : 0

        car.visible = shouldRenderCar
        trailLine.visible = shouldRenderCar

        if (usingLivePose) {
          car.position.lerp(livePoint, 0.42)
        } else if (shouldReplayRoute) {
          car.position.lerpVectors(current, next, t)
        } else {
          car.position.copy(routeVectors[0])
        }
        car.position.y = 0.08
        car.rotation.y = usingLivePose
          ? mapYawToSceneRotation(livePose.yaw)
          : Math.atan2(next.x - current.x, next.z - current.z)
        glow.material.opacity = isDwelling ? 0.46 + Math.sin(virtualElapsed * 8) * 0.14 : 0.22
        glow.scale.setScalar(isDwelling ? 1.12 + Math.sin(virtualElapsed * 8) * 0.08 : 1)

        const trailPoint = new THREE.Vector3(car.position.x, 0.09, car.position.z)
        const lastTrailPoint = trailPoints[trailPoints.length - 1]
        if (shouldRenderCar && (!lastTrailPoint || lastTrailPoint.distanceTo(trailPoint) > 0.05)) {
          trailPoints.push(trailPoint)
          if (trailPoints.length > 600) trailPoints.shift()
          trailGeometry.setFromPoints(trailPoints)
        }

        const activeCabinetId = routePoints[displayRouteIndex]?.cabinetId
        if (activeCabinetId !== lastActiveCabinetId) {
          activeCabinetEdges.forEach((edge, cabinetId) => {
            edge.visible = cabinetId === activeCabinetId
          })
          lastActiveCabinetId = activeCabinetId
        }
        const activePoint = routePoints[displayRouteIndex]
        const activeResult = getRecognitionResult(activePoint)
        const highlightColor = activeResult.status === 'normal' ? 0xfff275 : 0xff685f
        const pulse = isDwelling ? 0.72 + Math.sin(virtualElapsed * 7) * 0.18 : 0.34
        activeCabinetEdges.forEach((edge, cabinetId) => {
          if (cabinetId === activeCabinetId) {
            edge.material.color.setHex(highlightColor)
            edge.material.opacity = pulse
            edge.scale.setScalar(1.01)
          }
        })

        pointMarkers.forEach((marker, index) => {
          marker.material = index === displayRouteIndex ? activePointMaterial : index === 0 ? startMaterial : pointMaterial
          marker.scale.setScalar(index === displayRouteIndex ? 1.42 + Math.sin(virtualElapsed * 5) * 0.08 : 1)
        })
        if (viewMode === 'follow') {
          const cameraTarget = new THREE.Vector3(car.position.x - 4.2, 4.4, car.position.z + 4.8)
          camera.position.lerp(cameraTarget, 0.06)
          controls.target.lerp(car.position, 0.08)
        }
        const nextProgress = shouldRenderCar
          ? Math.round(((displayRouteIndex + (usingLivePose || isDwelling ? 0 : t)) / routeVectors.length) * 100)
          : 0
        const nextPhase = shouldRenderCar
          ? (isDwelling ? getInspectionPhase(localTime / DWELL_SECONDS) : movingPhase)
          : movingPhase
        if (isReplayMode && displayRouteIndex !== lastUiIndex) {
          lastUiIndex = displayRouteIndex
          setCurrentIndex(displayRouteIndex)
        }
        if (isReplayMode && nextProgress !== lastUiProgress) {
          lastUiProgress = nextProgress
          setRouteProgress(nextProgress)
        }
        if (isReplayMode && nextPhase.key !== lastUiPhase) {
          lastUiPhase = nextPhase.key
          setInspectionPhase(nextPhase)
        }
        if (isReplayMode && shouldRenderCar && nextPhase.key === 'complete' && routePoints[displayRouteIndex]?.id !== lastCompletedPointId) {
          const completedPoint = routePoints[displayRouteIndex]
          const recognitionResult = getRecognitionResult(completedPoint)
          const primaryMetric = recognitionResult.metrics[0] || { label: recognitionResult.summary, value: '--' }
          lastCompletedPointId = completedPoint.id
          saveInspectionResult({
            id: `${task.taskId || 'patrol-demo'}-${completedPoint.id}-${Date.now()}`,
            taskId: task.taskId || 'patrol-demo',
            taskName: task.taskName || '瀚林1号电房整房巡检',
            robot: task.robot || 'nano1',
            pointId: completedPoint.id,
            targetName: completedPoint.targetName,
            recognitionType: primaryMetric.label,
            value: primaryMetric.value,
            confidence: recognitionResult.confidence,
            status: recognitionResult.status === 'normal' ? '正常' : '异常',
            reviewStatus: recognitionResult.status === 'normal' ? '无需复核' : '待复核',
            summary: recognitionResult.summary,
            capturedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
            imageUrl: getEvidenceImage(completedPoint, recognitionResult),
            visual: recognitionResult.status === 'normal' ? 'meter' : 'digital',
          })
          setCompletedResults((currentResults) => ({
            ...currentResults,
            [completedPoint.id]: {
              pointId: completedPoint.id,
              targetName: completedPoint.targetName,
              ...recognitionResult,
            },
          }))
        }
      }
      controls.update()
      renderer.render(scene, camera)
      frameId = window.requestAnimationFrame(animate)
    }

    resize()
    animate()
    window.addEventListener('resize', resize)

    return () => {
      window.removeEventListener('resize', resize)
      window.cancelAnimationFrame(frameId)
      controls.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
    }
  }, [executionRoutePoints, isReplayMode, sceneMap, task.robot, task.taskId, task.taskName, viewMode])

  const handleExecutionControl = async () => {
    if (isReplayMode) {
      setIsPaused((value) => !value)
      return
    }
    if (!navigation?.execution_id || ['completed', 'failed', 'cancelled', 'idle'].includes(navigation.state)) return
    if (!window.confirm('确定停止当前巡检路线吗？车端会取消正在执行的 move_base 目标。')) return

    setIsStopping(true)
    try {
      const response = await fetch('/api/vehicle/navigation-route/cancel', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          execution_id: navigation.execution_id,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || '停止巡检失败')
      navigationRef.current = data.navigation
      setVehicleTelemetry((current) => ({ ...(current || {}), navigation: data.navigation }))
    } catch (error) {
      setVehicleTelemetry((current) => ({ ...(current || {}), error: error.message }))
    } finally {
      setIsStopping(false)
    }
  }

  const liveStateLabel = isReplayMode
    ? (isPaused ? '回放已暂停' : '路线回放中')
    : vehicleTelemetry?.connected
      ? LIVE_STATE_LABELS[navigation?.state] || '车辆在线'
      : '车辆离线'
  const routeTotal = Number(navigation?.route_total || executionRoutePoints.length || 0)
  const reachedCount = isReplayMode
    ? Math.min(routeTotal, currentIndex + 1)
    : Number(navigation?.reached_count || 0)
  const routeFinished = !isReplayMode && (
    !navigation?.execution_id
    || ['completed', 'failed', 'cancelled', 'idle'].includes(navigation?.state)
  )

  return (
    <section className="patrol-3d-page">
      <div className="patrol-3d-workspace">
        <div className="patrol-3d-viewport" ref={mountRef}>
          <div className="patrol-scene-title">
            <span>3D PATROL EXECUTION</span>
            <strong>{task.taskName || '实验楼一实时巡检'}</strong>
          </div>
          {!isReplayMode && (
            <div className={`live-connection-badge ${vehicleTelemetry?.connected ? 'is-online' : 'is-offline'}`}>
              <i />
              {vehicleTelemetry?.connected ? 'REAL-TIME / 车辆在线' : 'OFFLINE / 等待车辆数据'}
            </div>
          )}
          <section className="evidence-panel">
            <div className="evidence-head">
              <div>
                <span>{isReplayMode ? 'VISUAL EVIDENCE' : 'LIVE VEHICLE CAMERA'}</span>
                <strong>{isReplayMode ? '点位采集图像' : '车载实时视频'}</strong>
              </div>
              <b className={`evidence-${inspectionPhase.key}`}>{evidenceState}</b>
            </div>
            <div className="evidence-image">
              {isReplayMode ? (
                <img src={evidenceImage} alt={`${currentPoint?.targetName || '当前点位'}采集图像`} draggable="false" />
              ) : cameraAvailable ? (
                <img
                  src={`/api/vehicle/camera/stream?vehicle_id=${encodeURIComponent(vehicleId)}&camera_role=movement&retry=${cameraRetryNonce}`}
                  alt={`${vehicleId} 实时视频`}
                  draggable="false"
                  onLoad={() => setCameraAvailable(true)}
                  onError={() => setCameraAvailable(false)}
                />
              ) : (
                <button
                  type="button"
                  className="camera-retry"
                  onClick={() => {
                    setCameraRetryNonce((value) => value + 1)
                    setCameraAvailable(true)
                  }}
                >
                  视频流不可用，3 秒后自动重连（点击立即重试）
                </button>
              )}
              <i />
            </div>
            <dl className="evidence-meta">
              <div><dt>点位</dt><dd>{currentPoint?.targetName || '--'}</dd></div>
              <div><dt>采集时间</dt><dd>{evidenceTime}</dd></div>
              <div><dt>{isReplayMode ? '识别结论' : '执行状态'}</dt><dd>{isReplayMode ? currentResult.summary : liveStateLabel}</dd></div>
            </dl>
          </section>
          <div className="patrol-hud">
            <span>当前点位</span>
            <strong>{currentPoint?.targetName || '--'}</strong>
            <small>{inspectionPhase.label}</small>
            <div>
              <em>路线进度</em>
              <b>{routeProgress}%</b>
            </div>
            <i><b style={{ width: `${routeProgress}%` }} /></i>
          </div>
        </div>
        <aside className="patrol-3d-side">
          <button type="button" className="side-return-button" onClick={() => navigate('/cluster-control')}>返回任务</button>
          <div className="execution-dashboard">
            <div className="execution-card primary">
              <div>
                <span>任务状态</span>
                <strong>{liveStateLabel}</strong>
              </div>
              <b>{vehicleId}</b>
            </div>

            <div className="execution-progress">
              <div>
                <span>路线进度</span>
                <strong>{reachedCount} / {routeTotal}</strong>
              </div>
              <i><b style={{ width: `${routeProgress}%` }} /></i>
            </div>

            <div className="point-pair">
              <div className="execution-card compact">
                <span>当前点位</span>
                <strong>{currentPoint?.targetName || '--'}</strong>
                <small>{currentPoint?.recognitionTargets?.slice(0, 2).join(' / ') || '等待识别'}</small>
              </div>

              <div className="execution-card compact">
                <span>下一点位</span>
                <strong>{nextPoint?.targetName || '--'}</strong>
                <small>{navigation?.state === 'completed' ? '路线已完成' : '等待车端逐点确认'}</small>
              </div>
            </div>
          </div>

          <div className="vehicle-status-panel">
            <div className="side-section-head">
              <span>车辆状态</span>
              <b>{vehicleStatus.name}</b>
            </div>
            <div className="vehicle-status-grid">
              <div><dt>在线状态</dt><dd>{vehicleStatus.online}</dd></div>
              <div><dt>电量</dt><dd>{vehicleStatus.battery}</dd></div>
              <div><dt>速度</dt><dd>{vehicleStatus.speed}</dd></div>
              <div><dt>主电压</dt><dd>{vehicleStatus.voltage}</dd></div>
              <div><dt>通信</dt><dd>{vehicleStatus.signal}</dd></div>
              <div><dt>定位</dt><dd title={vehicleStatus.localization}>{vehicleStatus.localization}</dd></div>
            </div>
          </div>

          <div className="execution-log-panel">
            <div className="side-section-head">
              <span>执行日志</span>
              <button type="button" className="side-detail-button" onClick={() => setIsLogModalOpen(true)}>详细日志</button>
            </div>
            <div className="execution-log-list">
              {executionLogs.map((log, index) => (
                <article className={`execution-log-item type-${log.type}`} key={`${log.time}-${log.type}-${index}`}>
                  <time>{log.time}</time>
                  <strong>{log.type}</strong>
                  <p>{log.text}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="view-controls">
            <span>视角</span>
            <div>
              <button type="button" className={viewMode === 'free' ? 'active' : ''} onClick={() => setViewMode('free')}>自由</button>
              <button type="button" className={viewMode === 'top' ? 'active' : ''} onClick={() => setViewMode('top')}>俯视</button>
              <button type="button" className={viewMode === 'follow' ? 'active' : ''} onClick={() => setViewMode('follow')}>跟随</button>
            </div>
          </div>

          <button
            type="button"
            className="play-control"
            disabled={isStopping || routeFinished}
            onClick={handleExecutionControl}
          >
            {isReplayMode ? (isPaused ? '继续回放' : '暂停回放') : isStopping ? '正在停止…' : routeFinished ? '路线已结束' : '停止巡检'}
          </button>
        </aside>
      </div>

      {isLogModalOpen && (
        <div className="log-modal-backdrop" onMouseDown={() => setIsLogModalOpen(false)}>
          <section className="log-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="log-modal-head">
              <div>
                <span>EXECUTION OUTPUT</span>
                <h2>巡检执行详细日志</h2>
              </div>
              <button type="button" onClick={() => setIsLogModalOpen(false)} aria-label="关闭">×</button>
            </div>
            <div className="log-modal-body">
              {executionLogs.map((log, index) => (
                <article className={`log-detail-row type-${log.type}`} key={`${log.time}-${log.type}-detail-${index}`}>
                  <time>{log.time}</time>
                  <strong>{log.type}</strong>
                  <p>{log.text}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </section>
  )
}

export default PatrolExecution3D
