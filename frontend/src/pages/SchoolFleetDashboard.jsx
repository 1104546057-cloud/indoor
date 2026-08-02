/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as THREE from 'three'
import useBusinessOverview from '../hooks/useBusinessOverview'
import { labBuildingMap, labInspectionPointById } from '../data/labBuildingMap'
import { hanlinRoomMap, inspectionPointById, routeById } from '../data/hanlinRoomMap'
import { buildPatrolMonitorUrl } from '../utils/patrolMonitor'
import '../styles/SchoolFleetDashboard.css'

const FLEET_SIZE = 22
const OVERVIEW_WINDOW_LIMIT = 4
const MAX_ACTIVE_VISUALS = 4
const POWER_ROOM_DWELL_SECONDS = 3.2
const POWER_ROOM_TRAVEL_SECONDS = 2.1
const REPLAY_VIEW_PRESETS = [
  { progress: 0.06, cameraOffset: [-4.8, 3.5, 5.4], fov: 50 },
  { progress: 0.31, cameraOffset: [4.6, 2.9, 4.2], fov: 56 },
  { progress: 0.56, cameraOffset: [4.2, 3.8, -5.2], fov: 48 },
  { progress: 0.81, cameraOffset: [-4.4, 3.1, -4.6], fov: 58 },
]
const DEMO_REPLAY_CONFIG = {
  3: {
    map: hanlinRoomMap,
    routeId: 'route-p-main',
    roomName: '瀚林1号电房 / P柜区',
    taskName: 'P柜历史巡检点模拟',
    code: 'POWER-P DEMO',
  },
  4: {
    map: hanlinRoomMap,
    routeId: 'route-g-main',
    roomName: '瀚林1号电房 / G柜区',
    taskName: 'G柜历史巡检点模拟',
    code: 'POWER-G DEMO',
  },
}
const ACTIVE_RECORD_STATES = new Set(['dispatching', 'running'])
const REPLAY_RECORD_STATES = new Set(['completed', 'failed', 'cancelled', '已完成', '异常', '待审核'])
const ABNORMAL_STATES = new Set(['异常', '告警'])
const CAMERA_ROLES = [
  { role: 'high', label: '高位摄像头', code: 'CAM-H' },
  { role: 'middle', label: '中位摄像头', code: 'CAM-M' },
  { role: 'low', label: '低位摄像头', code: 'CAM-L' },
  { role: 'ptz', label: '云台摄像头', code: 'CAM-PTZ' },
]

function getPowerRoomReplayPhase(progress) {
  if (progress < 0.24) return { key: 'capture', label: '停车采集图像' }
  if (progress < 0.54) return { key: 'recognize', label: '扫描识别电箱' }
  if (progress < 0.82) return { key: 'upload', label: '上传巡检结果' }
  return { key: 'complete', label: '本点巡检完成' }
}

function vehicleNumber(value) {
  const match = String(value || '').match(/(\d+)$/)
  return match ? Number(match[1]) : null
}

function vehicleLabel(index) {
  return `${String(index).padStart(2, '0')}号车`
}

function recordMatchesVehicle(record, vehicleId) {
  const candidates = [
    record.robotName,
    record.robotCode,
    record.navigation?.vehicle_id,
    record.navigation?.vehicleId,
  ].filter(Boolean).map((value) => String(value).toLowerCase())
  return candidates.some((value) => value === vehicleId.toLowerCase() || value.includes(vehicleId.toLowerCase()))
}

function statusMeta(vehicle) {
  if (vehicle.abnormalCount > 0 && vehicle.activeRecord) return { key: 'alarm', label: '异常' }
  if (vehicle.activeRecord && ACTIVE_RECORD_STATES.has(vehicle.activeRecord.status)) {
    return vehicle.online ? { key: 'running', label: '巡检中' } : { key: 'warning', label: '任务中断联' }
  }
  if (vehicle.online) return { key: 'idle', label: '在线空闲' }
  return { key: 'offline', label: '离线' }
}

function smartGridColumns(count) {
  if (count <= 1) return 1
  if (count <= 4) return 2
  if (count <= 6) return 3
  if (count <= 9) return 3
  if (count <= 12) return 4
  if (count <= 16) return 4
  return 5
}

function formatTime(value) {
  if (!value) return '--:--:--'
  const date = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return String(value).split(' ').pop() || '--:--:--'
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

function cameraStreamUrl(vehicleId, role, retry) {
  const query = new URLSearchParams({ vehicle_id: vehicleId, camera_role: role, retry: String(retry) })
  return `/api/vehicle/camera/stream?${query}`
}

function CameraFeed({ vehicle, role, title, code, enabled, configured = true, compact = false }) {
  const [retry, setRetry] = useState(0)
  const [streamState, setStreamState] = useState('loading')

  useEffect(() => {
    setStreamState(enabled && configured ? 'loading' : 'standby')
    setRetry(0)
  }, [configured, enabled, role, vehicle.id])

  const retryStream = (event) => {
    event.stopPropagation()
    setStreamState('loading')
    setRetry((value) => value + 1)
  }

  return (
    <article className={`fleet-camera ${compact ? 'is-compact' : ''} stream-${streamState}`}>
      <header>
        <div><i /><strong>{title}</strong><span>{code}</span></div>
        <em>{streamState === 'ready' ? 'LIVE' : streamState === 'loading' ? 'CONNECTING' : 'STANDBY'}</em>
      </header>
      <div className="fleet-camera-viewport">
        {enabled && configured && streamState !== 'error' ? (
          <img
            src={cameraStreamUrl(vehicle.id, role, retry)}
            alt={`${vehicle.label}${title}`}
            draggable="false"
            onLoad={() => setStreamState('ready')}
            onError={() => setStreamState('error')}
          />
        ) : (
          <div className="fleet-camera-placeholder">
            <span className="camera-placeholder-icon">CAM</span>
            <strong>{!configured ? '摄像头角色未配置' : enabled ? '视频流暂不可用' : vehicle.online ? '等待巡检任务启动' : '车辆当前离线'}</strong>
            <small>{!configured ? `请配置 camera_streams.${role}` : enabled ? '检查摄像头地址或重新连接' : `${vehicle.label} · ${vehicle.roomName}`}</small>
            {enabled && configured ? <button type="button" onClick={retryStream}>重新连接</button> : null}
          </div>
        )}
        <span className="camera-corner top-left" />
        <span className="camera-corner top-right" />
        <span className="camera-corner bottom-left" />
        <span className="camera-corner bottom-right" />
      </div>
      <footer>
        <span>{vehicle.roomName}</span>
        <b>{vehicle.taskName}</b>
        <em>{vehicle.progress}%</em>
      </footer>
    </article>
  )
}

function getVehicleMap(vehicle) {
  const sceneId = vehicle.record?.taskSceneId
  const area = vehicle.roomName || ''
  if (sceneId === 'lab-building' || area.includes('实验楼')) return labBuildingMap
  if (area.includes('瀚林') || area.includes('电房')) return hanlinRoomMap
  if (!vehicle.record && DEMO_REPLAY_CONFIG[vehicle.index]) return DEMO_REPLAY_CONFIG[vehicle.index].map
  return labBuildingMap
}

function toModelPoint(point, mapData) {
  const pointLookup = mapData.id === labBuildingMap.id ? labInspectionPointById : inspectionPointById
  const preset = pointLookup[point.id || point.point_id]
  if (preset) return { ...point, x: preset.x, y: preset.y }
  let x = Number(point.x)
  let y = Number(point.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (Math.abs(x) < 200 && Math.abs(y) < 200 && mapData.slamMap) {
    const slamMap = mapData.slamMap
    const [originX, originY] = slamMap.yaml.origin
    const pixelX = (x - originX) / slamMap.yaml.resolution
    const pixelY = slamMap.imageSize.height - ((y - originY) / slamMap.yaml.resolution)
    x = slamMap.coverage.x + (pixelX / slamMap.imageSize.width) * slamMap.coverage.width
    y = slamMap.coverage.y + (pixelY / slamMap.imageSize.height) * slamMap.coverage.depth
  }
  return { ...point, x, y }
}

function readTelemetryPose(telemetry, mapData) {
  const pose = telemetry?.pose?.position || telemetry?.pose || telemetry?.position
  if (!pose) return null
  const x = Number(pose.x)
  const y = Number(pose.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const modelPoint = toModelPoint({ x, y }, mapData)
  const orientation = telemetry?.pose?.orientation || telemetry?.orientation
  const quaternionYaw = orientation && Number.isFinite(Number(orientation.z)) && Number.isFinite(Number(orientation.w))
    ? Math.atan2(2 * (Number(orientation.w) * Number(orientation.z)), 1 - 2 * Number(orientation.z) ** 2)
    : 0
  return { ...modelPoint, yaw: Number(telemetry.yaw ?? telemetry.theta ?? quaternionYaw) || 0 }
}

function getReplayRoute(vehicle, mapData) {
  const savedPoints = vehicle.replayRecord?.routePoints || []
  const demoConfig = !vehicle.replayRecord ? DEMO_REPLAY_CONFIG[vehicle.index] : null
  const demoRoute = demoConfig?.routeId ? routeById[demoConfig.routeId] : null
  const demoRoutePoints = demoRoute?.pointIds.map((pointId) => inspectionPointById[pointId]).filter(Boolean) || []
  const sourcePoints = savedPoints.length
    ? savedPoints
    : demoRoutePoints.length
      ? demoRoutePoints
      : mapData.inspectionPoints || []
  return sourcePoints.map((point) => toModelPoint(point, mapData)).filter(Boolean)
}

function getRouteDisplayPath(routePoints, mapData) {
  const transitions = mapData.routeTransitions || {}
  return routePoints.reduce((path, point, index) => {
    if (index > 0) {
      const previousPoint = routePoints[index - 1]
      const previousId = previousPoint.id || previousPoint.point_id
      const pointId = point.id || point.point_id
      const directTransition = transitions[`${previousId}->${pointId}`]
      const reverseTransition = transitions[`${pointId}->${previousId}`]
      const transitionPoints = directTransition || (reverseTransition ? [...reverseTransition].reverse() : [])
      path.push(...transitionPoints)
    }
    path.push(point)
    return path
  }, [])
}

function ReplayStaticScene({ vehicle, mapData, routePoints }) {
  const width = mapData.size.width
  const height = mapData.size.height
  const displayRoute = getRouteDisplayPath(routePoints, mapData)
  const viewPreset = REPLAY_VIEW_PRESETS[(vehicle.index - 1) % REPLAY_VIEW_PRESETS.length]
  const marker = displayRoute[Math.min(displayRoute.length - 1, Math.floor(displayRoute.length * viewPreset.progress))]

  return (
    <div className="fleet-replay-static" aria-label={`${vehicle.label}静态路线回放预览`}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        <rect width={width} height={height} className="replay-static-floor" />
        {(mapData.halls || []).map((hall) => (
          <rect key={hall.id} x={hall.x} y={hall.y} width={hall.width} height={hall.depth} className="replay-static-hall" />
        ))}
        {(mapData.corridors || []).map((corridor) => (
          <line key={corridor.id} x1={corridor.x1} y1={corridor.y1} x2={corridor.x2} y2={corridor.y2} strokeWidth={corridor.width} className="replay-static-corridor" />
        ))}
        {(mapData.walls || []).map((wall) => (
          <line key={wall.id} x1={wall.x1} y1={wall.y1} x2={wall.x2} y2={wall.y2} strokeWidth={Math.max(wall.thickness || 200, 260)} className="replay-static-wall" />
        ))}
        {displayRoute.length > 1 ? <polyline points={displayRoute.map((point) => `${point.x},${point.y}`).join(' ')} className="replay-static-route" /> : null}
        {routePoints.map((point, index) => <circle key={`${point.id || index}`} cx={point.x} cy={point.y} r="850" className="replay-static-point" />)}
        {marker ? (
          <g className="replay-static-car" transform={`translate(${marker.x} ${marker.y})`}>
            <circle r="1350" />
            <path d="M -650 700 L 0 -1050 L 650 700 Z" />
          </g>
        ) : null}
      </svg>
      <span>STATIC PREVIEW</span>
    </div>
  )
}

function RouteReplay3D({ vehicle, mapData, routePoints, full = false }) {
  const mountRef = useRef(null)
  const phaseLabelRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || routePoints.length === 0) return undefined

    const width = mapData.size.width
    const height = mapData.size.height
    const isPowerRoomReplay = mapData.id === hanlinRoomMap.id
    const worldScale = 18 / Math.max(width, height)
    const worldPoint = (x, y, elevation = 0) => new THREE.Vector3(
      (Number(x) - width / 2) * worldScale,
      elevation,
      (Number(y) - height / 2) * worldScale,
    )
    const viewPreset = REPLAY_VIEW_PRESETS[(vehicle.index - 1) % REPLAY_VIEW_PRESETS.length]
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x02121b)
    scene.fog = new THREE.Fog(0x02121b, 18, 34)
    const camera = new THREE.PerspectiveCamera(full ? Math.max(44, viewPreset.fov - 4) : viewPreset.fov, 1, 0.1, 80)
    const renderer = new THREE.WebGLRenderer({ antialias: full, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, full ? 1.5 : 1))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    scene.add(new THREE.HemisphereLight(0xa8f4ff, 0x06131b, 1.25))
    const keyLight = new THREE.DirectionalLight(0x7deaf1, 1.45)
    keyLight.position.set(-7, 13, 9)
    scene.add(keyLight)

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width * worldScale * 1.08, height * worldScale * 1.08),
      new THREE.MeshStandardMaterial({ color: 0x082b38, roughness: 0.88, metalness: 0.12 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.04
    scene.add(floor)

    const grid = new THREE.GridHelper(22, 22, 0x1f7484, 0x124755)
    grid.position.y = 0.01
    scene.add(grid)

    const addSegment = (item, thickness, wallHeight, color, opacity = 1) => {
      const start = worldPoint(item.x1, item.y1)
      const end = worldPoint(item.x2, item.y2)
      const length = start.distanceTo(end)
      if (!Number.isFinite(length) || length <= 0) return
      const material = new THREE.MeshStandardMaterial({ color, transparent: opacity < 1, opacity, roughness: 0.72 })
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, wallHeight, Math.max(thickness * worldScale, 0.045)), material)
      mesh.position.copy(start).add(end).multiplyScalar(0.5)
      mesh.position.y = wallHeight / 2
      mesh.rotation.y = -Math.atan2(end.z - start.z, end.x - start.x)
      scene.add(mesh)
    }

    ;(mapData.corridors || []).forEach((corridor) => addSegment(corridor, corridor.width, 0.06, 0x176174, 0.92))
    ;(mapData.walls || []).forEach((wall) => addSegment(wall, wall.thickness || 180, 0.72, 0x64c0ce, 0.68))

    const addBlock = (item, blockHeight, color) => {
      const blockWidth = Math.max(Number(item.width || 800) * worldScale, 0.08)
      const blockDepth = Math.max(Number(item.depth || item.height || 800) * worldScale, 0.08)
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(blockWidth, blockHeight, blockDepth),
        new THREE.MeshStandardMaterial({ color, roughness: 0.68, metalness: 0.18 }),
      )
      const center = worldPoint(Number(item.x) + Number(item.width || 800) / 2, Number(item.y) + Number(item.depth || item.height || 800) / 2)
      mesh.position.set(center.x, blockHeight / 2, center.z)
      scene.add(mesh)
    }
    ;(mapData.halls || []).forEach((hall) => addBlock(hall, 0.12, 0x184b59))
    ;(mapData.columns || []).forEach((column) => addBlock(column, 0.82, 0x758e92))

    ;(mapData.landmarkLines || []).forEach((line) => {
      const lineWidth = Math.max((line.lineWidth || 100) * worldScale, 0.035)
      const x = (line.x - width / 2) * worldScale
      const z = (line.y - height / 2) * worldScale
      const markWidth = line.width * worldScale
      const markDepth = line.height * worldScale
      const material = new THREE.MeshBasicMaterial({ color: 0xe8d94a, transparent: true, opacity: 0.46 })
      ;[
        { x: x + markWidth / 2, z, width: markWidth, depth: lineWidth },
        { x: x + markWidth / 2, z: z + markDepth, width: markWidth, depth: lineWidth },
        { x, z: z + markDepth / 2, width: lineWidth, depth: markDepth },
        { x: x + markWidth, z: z + markDepth / 2, width: lineWidth, depth: markDepth },
      ].forEach((segment) => {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(segment.width, 0.025, segment.depth), material)
        strip.position.set(segment.x, 0.018, segment.z)
        scene.add(strip)
      })
    })

    const activeCabinetEdges = new Map()
    const cabinetTargets = new Map()
    ;(mapData.cabinets || []).forEach((cabinet) => {
      const cabinetWidth = Math.max(Number(cabinet.width || 800) * worldScale, 0.1)
      const cabinetDepth = Math.max(Number(cabinet.depth || 800) * worldScale, 0.1)
      const cabinetHeight = Math.max(Number(cabinet.height || 1800) * worldScale, 0.58)
      const cabinetGeometry = new THREE.BoxGeometry(cabinetWidth, cabinetHeight, cabinetDepth)
      const cabinetMaterial = new THREE.MeshStandardMaterial({
        color: cabinet.type === 'transformer' ? 0x62583b : 0x315e70,
        emissive: cabinet.type === 'transformer' ? 0x211c0e : 0x082a35,
        metalness: cabinet.type === 'transformer' ? 0.12 : 0.28,
        roughness: 0.48,
      })
      const cabinetMesh = new THREE.Mesh(cabinetGeometry, cabinetMaterial)
      const cabinetCenter = worldPoint(
        Number(cabinet.x) + Number(cabinet.width || 800) / 2,
        Number(cabinet.y) + Number(cabinet.depth || 800) / 2,
      )
      cabinetMesh.position.set(cabinetCenter.x, cabinetHeight / 2, cabinetCenter.z)
      scene.add(cabinetMesh)

      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(cabinetGeometry),
        new THREE.LineBasicMaterial({ color: 0x9deaf1, transparent: true, opacity: 0.52 }),
      )
      edge.position.copy(cabinetMesh.position)
      scene.add(edge)

      const activeEdge = new THREE.LineSegments(
        new THREE.EdgesGeometry(cabinetGeometry),
        new THREE.LineBasicMaterial({ color: 0xffdf66, transparent: true, opacity: 0 }),
      )
      activeEdge.position.copy(cabinetMesh.position)
      activeEdge.visible = false
      scene.add(activeEdge)
      activeCabinetEdges.set(cabinet.id, activeEdge)

      const panelMaterial = new THREE.MeshStandardMaterial({ color: 0x102b35, roughness: 0.36, metalness: 0.24 })
      const indicatorMaterial = new THREE.MeshBasicMaterial({ color: 0x63f2c6 })
      const frontIsVertical = cabinet.face === 'east' || cabinet.face === 'west'
      const panelGeometry = frontIsVertical
        ? new THREE.BoxGeometry(0.025, cabinetHeight * 0.76, cabinetDepth * 0.72)
        : new THREE.BoxGeometry(cabinetWidth * 0.72, cabinetHeight * 0.76, 0.025)
      const panel = new THREE.Mesh(panelGeometry, panelMaterial)
      panel.position.copy(cabinetMesh.position)
      const faceDirection = {
        north: new THREE.Vector3(0, 0, -1),
        south: new THREE.Vector3(0, 0, 1),
        east: new THREE.Vector3(1, 0, 0),
        west: new THREE.Vector3(-1, 0, 0),
      }[cabinet.face] || new THREE.Vector3(0, 0, 1)
      const faceDistance = frontIsVertical ? cabinetWidth / 2 + 0.016 : cabinetDepth / 2 + 0.016
      panel.position.addScaledVector(faceDirection, faceDistance)
      scene.add(panel)

      const indicator = new THREE.Mesh(new THREE.SphereGeometry(Math.max(cabinetWidth * 0.055, 0.028), 10, 10), indicatorMaterial)
      indicator.position.copy(panel.position).add(new THREE.Vector3(0, cabinetHeight * 0.21, 0)).addScaledVector(faceDirection, 0.022)
      scene.add(indicator)
      cabinetTargets.set(cabinet.id, panel.position.clone().add(new THREE.Vector3(0, cabinetHeight * 0.08, 0)))
    })

    const displayRoute = getRouteDisplayPath(routePoints, mapData)
    const worldRoute = displayRoute.map((point) => worldPoint(point.x, point.y, 0.1))
    const routeGeometry = new THREE.BufferGeometry().setFromPoints(worldRoute)
    const routeLine = new THREE.Line(routeGeometry, new THREE.LineBasicMaterial({ color: 0x48f0c7, transparent: true, opacity: 0.9 }))
    scene.add(routeLine)
    const pointMarkers = []
    worldRoute.forEach((point, index) => {
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(index === 0 ? 0.13 : 0.085, index === 0 ? 0.13 : 0.085, 0.06, 12),
        new THREE.MeshBasicMaterial({ color: index === 0 ? 0x5ff3bc : 0x5ce8ef }),
      )
      marker.position.copy(point)
      scene.add(marker)
      pointMarkers.push(marker)
    })

    const car = new THREE.Group()
    const carScale = isPowerRoomReplay ? 0.64 : 0.35
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.62 * carScale, 0.28 * carScale, 0.9 * carScale),
      new THREE.MeshStandardMaterial({ color: 0x73ecf4, roughness: 0.32, metalness: 0.42 }),
    )
    body.position.y = 0.22 * carScale
    car.add(body)
    const sensor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12 * carScale, 0.12 * carScale, 0.14 * carScale, 16),
      new THREE.MeshStandardMaterial({ color: 0xe2fbff, emissive: 0x164b55, roughness: 0.28 }),
    )
    sensor.position.y = 0.44 * carScale
    car.add(sensor)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.18 * carScale, 0.42 * carScale, 4), new THREE.MeshBasicMaterial({ color: 0xffc45c }))
    nose.rotation.x = Math.PI / 2
    nose.position.set(0, 0.24 * carScale, -0.62 * carScale)
    car.add(nose)
    const glow = new THREE.Mesh(new THREE.RingGeometry(0.48 * carScale, 0.62 * carScale, 24), new THREE.MeshBasicMaterial({ color: 0x37e9c2, transparent: true, opacity: 0.5, side: THREE.DoubleSide }))
    glow.rotation.x = -Math.PI / 2
    glow.position.y = 0.03
    car.add(glow)
    scene.add(car)

    const scanBeamGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(), new THREE.Vector3(),
      new THREE.Vector3(), new THREE.Vector3(),
      new THREE.Vector3(), new THREE.Vector3(),
    ])
    const scanBeam = new THREE.LineSegments(
      scanBeamGeometry,
      new THREE.LineBasicMaterial({ color: 0x67f4d1, transparent: true, opacity: 0.72 }),
    )
    scanBeam.visible = false
    scene.add(scanBeam)
    const scanTarget = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.18, 24),
      new THREE.MeshBasicMaterial({ color: 0xffdf66, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
    )
    scanTarget.visible = false
    scene.add(scanTarget)

    const segmentLengths = worldRoute.slice(0, -1).map((point, index) => point.distanceTo(worldRoute[index + 1]))
    const routeLength = segmentLengths.reduce((sum, value) => sum + value, 0) || 1
    const sampleRoute = (progress) => {
      let distance = progress * routeLength
      for (let index = 0; index < segmentLengths.length; index += 1) {
        if (distance <= segmentLengths[index]) {
          const ratio = segmentLengths[index] ? distance / segmentLengths[index] : 0
          return {
            position: worldRoute[index].clone().lerp(worldRoute[index + 1], ratio),
            next: worldRoute[index + 1],
          }
        }
        distance -= segmentLengths[index]
      }
      return { position: worldRoute.at(-1).clone(), next: worldRoute.at(-1) }
    }

    let frameId = 0
    let lastFrameAt = 0
    const replayDuration = full ? 52000 : 64000
    const powerRoomStepDuration = POWER_ROOM_DWELL_SECONDS + POWER_ROOM_TRAVEL_SECONDS
    const initialPowerRoomIndex = Math.min(
      worldRoute.length - 1,
      Math.max(0, Math.floor(viewPreset.progress * worldRoute.length)),
    )
    const startedAt = performance.now() - (
      isPowerRoomReplay
        ? initialPowerRoomIndex * powerRoomStepDuration * 1000
        : viewPreset.progress * replayDuration
    )
    const frameInterval = 1000 / (full ? 30 : 12)
    const cameraOffset = new THREE.Vector3(...viewPreset.cameraOffset).multiplyScalar(full ? 1.2 : 1)
    let lastPhaseText = ''
    const animate = (timestamp) => {
      frameId = window.requestAnimationFrame(animate)
      if (document.hidden || timestamp - lastFrameAt < frameInterval) return
      lastFrameAt = timestamp
      let routeIndex = 0
      let isDwelling = false
      let dwellProgress = 0
      let sampled
      if (isPowerRoomReplay) {
        const elapsedSeconds = Math.max(0, (timestamp - startedAt) / 1000)
        const cycleTime = elapsedSeconds % (worldRoute.length * powerRoomStepDuration)
        routeIndex = Math.floor(cycleTime / powerRoomStepDuration)
        const localTime = cycleTime % powerRoomStepDuration
        const nextIndex = (routeIndex + 1) % worldRoute.length
        isDwelling = localTime < POWER_ROOM_DWELL_SECONDS
        dwellProgress = isDwelling ? localTime / POWER_ROOM_DWELL_SECONDS : 1
        const travelProgress = isDwelling ? 0 : Math.min(1, (localTime - POWER_ROOM_DWELL_SECONDS) / POWER_ROOM_TRAVEL_SECONDS)
        sampled = {
          position: worldRoute[routeIndex].clone().lerp(worldRoute[nextIndex], travelProgress),
          next: worldRoute[nextIndex],
        }
      } else {
        const progress = ((timestamp - startedAt) / replayDuration) % 1
        sampled = sampleRoute(progress)
      }
      car.position.copy(sampled.position)
      const activeRoutePoint = routePoints[routeIndex]
      const activeCabinetId = activeRoutePoint?.cabinetId
      const cabinetTarget = activeCabinetId ? cabinetTargets.get(activeCabinetId) : null
      const headingTarget = isDwelling && cabinetTarget ? cabinetTarget : sampled.next
      const dx = headingTarget.x - sampled.position.x
      const dz = headingTarget.z - sampled.position.z
      if (Math.abs(dx) + Math.abs(dz) > 0.001) car.rotation.y = Math.atan2(-dx, -dz)
      glow.material.opacity = isDwelling
        ? 0.48 + Math.sin(timestamp * 0.01) * 0.16
        : 0.26 + Math.sin(timestamp * 0.006) * 0.08
      glow.scale.setScalar(isDwelling ? 1.08 + Math.sin(timestamp * 0.01) * 0.06 : 1)
      sensor.rotation.y = isDwelling ? Math.sin(timestamp * 0.006) * 0.72 : 0

      activeCabinetEdges.forEach((edge, cabinetId) => {
        edge.visible = isDwelling && cabinetId === activeCabinetId
        if (edge.visible) edge.material.opacity = 0.68 + Math.sin(timestamp * 0.009) * 0.24
      })
      pointMarkers.forEach((marker, index) => {
        const active = isPowerRoomReplay && index === routeIndex
        marker.scale.setScalar(active ? 1.35 + Math.sin(timestamp * 0.008) * 0.1 : 1)
        marker.material.color.setHex(active ? 0xffdf66 : index === 0 ? 0x5ff3bc : 0x5ce8ef)
      })

      const scanning = isPowerRoomReplay && isDwelling && Boolean(cabinetTarget)
      scanBeam.visible = scanning
      scanTarget.visible = scanning
      if (scanning) {
        car.updateMatrixWorld(true)
        const scanOrigin = car.localToWorld(new THREE.Vector3(0, 0.44 * carScale, -0.18 * carScale))
        const sweep = 0.12 + Math.sin(timestamp * 0.008) * 0.06
        scanBeamGeometry.setFromPoints([
          scanOrigin, cabinetTarget,
          scanOrigin, cabinetTarget.clone().add(new THREE.Vector3(sweep, 0.12, 0)),
          scanOrigin, cabinetTarget.clone().add(new THREE.Vector3(-sweep, -0.12, 0)),
        ])
        scanBeam.material.opacity = 0.48 + Math.sin(timestamp * 0.012) * 0.28
        scanTarget.position.copy(cabinetTarget)
        scanTarget.lookAt(scanOrigin)
        scanTarget.scale.setScalar(0.9 + Math.sin(timestamp * 0.011) * 0.16)
      }

      if (phaseLabelRef.current && isPowerRoomReplay) {
        const phase = isDwelling ? getPowerRoomReplayPhase(dwellProgress) : { key: 'moving', label: '驶向下一巡检点' }
        const targetName = isDwelling
          ? activeRoutePoint?.targetName
          : routePoints[(routeIndex + 1) % routePoints.length]?.targetName
        const phaseText = `${phase.label}${targetName ? ` · ${targetName}` : ''}`
        if (phaseText !== lastPhaseText) {
          phaseLabelRef.current.textContent = phaseText
          phaseLabelRef.current.dataset.phase = phase.key
          lastPhaseText = phaseText
        }
      }

      const targetPosition = sampled.position.clone().add(cameraOffset)
      camera.position.lerp(targetPosition, full ? 0.075 : 0.12)
      camera.lookAt(sampled.position.x, 0.18, sampled.position.z)
      renderer.render(scene, camera)
    }

    const resize = () => {
      const rect = mount.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      renderer.setSize(rect.width, rect.height, false)
      camera.aspect = rect.width / rect.height
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(mount)
    resize()
    const first = isPowerRoomReplay
      ? { position: worldRoute[initialPowerRoomIndex].clone() }
      : sampleRoute(viewPreset.progress)
    car.position.copy(first.position)
    camera.position.copy(first.position).add(cameraOffset)
    frameId = window.requestAnimationFrame(animate)

    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frameId)
      scene.traverse((object) => {
        object.geometry?.dispose?.()
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose())
        else object.material?.dispose?.()
      })
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [full, mapData, routePoints, vehicle.index])

  return (
    <div className={`fleet-replay-3d${full ? ' is-full' : ''}`} ref={mountRef} aria-label={`${vehicle.label}路线模拟3D跟随视角`}>
      {mapData.id === hanlinRoomMap.id ? <span className="fleet-replay-phase" ref={phaseLabelRef}>正在载入巡检动作</span> : null}
    </div>
  )
}

function ReplayFeed({ vehicle, animated, full = false }) {
  const mapData = getVehicleMap(vehicle)
  const routeCacheRef = useRef({ key: '', points: [] })
  const routeCacheKey = `${mapData.id}:${vehicle.index}:${JSON.stringify(vehicle.replayRecord?.routePoints || [])}`
  if (routeCacheRef.current.key !== routeCacheKey) {
    routeCacheRef.current = { key: routeCacheKey, points: getReplayRoute(vehicle, mapData) }
  }
  const routePoints = routeCacheRef.current.points
  const isDemo = !vehicle.replayRecord
  const demoConfig = isDemo ? DEMO_REPLAY_CONFIG[vehicle.index] : null
  const badge = animated ? (isDemo ? 'DEMO' : 'REPLAY') : 'STATIC'
  const recordTime = vehicle.replayRecord?.finishedAt || vehicle.replayRecord?.startedAt

  return (
    <article className={`fleet-camera fleet-replay-monitor${full ? ' is-full-replay' : ' is-compact'} ${animated ? 'is-animated' : 'is-static'}`}>
      <header>
        <div><i /><strong>{full ? '完整3D跟随视角' : `${vehicle.label}路线回放`}</strong><span>{isDemo ? demoConfig?.code || 'LAB-1 DEMO' : vehicle.replayRecord.recordCode || 'LAST TASK'}</span></div>
        <em>{badge}</em>
      </header>
      <div className="fleet-camera-viewport">
        {animated ? <RouteReplay3D vehicle={vehicle} mapData={mapData} routePoints={routePoints} full={full} /> : <ReplayStaticScene vehicle={vehicle} mapData={mapData} routePoints={routePoints} />}
        <span className="fleet-replay-mode-label">{isDemo ? demoConfig ? `${mapData.name} · 历史巡检点模拟` : '实验楼一模拟路线' : '上次完成任务 · 路线模拟'}</span>
        <span className="camera-corner top-left" />
        <span className="camera-corner top-right" />
        <span className="camera-corner bottom-left" />
        <span className="camera-corner bottom-right" />
      </div>
      <footer>
        <span>{vehicle.roomName}</span>
        <b>{isDemo ? demoConfig?.taskName || '无历史记录 / 演示路线' : vehicle.replayRecord.taskName}</b>
        <em>{recordTime ? formatTime(recordTime) : 'DEMO'}</em>
      </footer>
    </article>
  )
}

function FleetPrimaryTile({ vehicle, animated, onVisibilityChange, onSelect }) {
  const tileRef = useRef(null)
  const [isVisible, setIsVisible] = useState(false)
  const taskRunning = Boolean(vehicle.online && vehicle.activeRecord && ACTIVE_RECORD_STATES.has(vehicle.activeRecord.status))

  useEffect(() => {
    const element = tileRef.current
    if (!element) return undefined
    const observer = new IntersectionObserver(([entry]) => {
      const nextVisible = entry.isIntersecting && entry.intersectionRatio > 0.08
      setIsVisible(nextVisible)
      onVisibilityChange(vehicle.id, nextVisible)
    }, { threshold: [0, 0.08, 0.4] })
    observer.observe(element)
    return () => {
      observer.disconnect()
      onVisibilityChange(vehicle.id, false)
    }
  }, [onVisibilityChange, vehicle.id])

  return (
    <article
      ref={tileRef}
      className={`fleet-primary-tile status-${vehicle.status.key}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(vehicle.id)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onSelect(vehicle.id)
      }}
    >
      {taskRunning ? (
        <CameraFeed
          vehicle={vehicle}
          role="movement"
          title={`${vehicle.label}主摄像头`}
          code={`CAR-${String(vehicle.index).padStart(2, '0')}`}
          enabled={isVisible}
          configured={vehicle.cameraRoles.includes('movement')}
          compact
        />
      ) : <ReplayFeed vehicle={vehicle} animated={animated && isVisible} />}
      <span className="fleet-tile-status"><i />{taskRunning ? '实时巡检' : vehicle.status.label}</span>
    </article>
  )
}

function FleetRouteMap({ vehicle, telemetry, mapData }) {
  const navigation = telemetry?.navigation || vehicle.record?.navigation || {}
  const savedRoutePoints = vehicle.record?.routePoints || []
  const routePoints = savedRoutePoints.length
    ? savedRoutePoints.map((point) => toModelPoint(point, mapData)).filter(Boolean)
    : vehicle.activeRecord ? [] : getReplayRoute(vehicle, mapData)
  const points = routePoints.length ? routePoints : []
  const displayRoute = getRouteDisplayPath(points, mapData)
  const reachedCount = Number(navigation.reached_count ?? vehicle.record?.currentSequence ?? 0)
  const currentPose = readTelemetryPose(telemetry, mapData)
  const width = mapData.size.width
  const height = mapData.size.height
  const mapUnit = Math.min(width, height)
  const routeStrokeWidth = mapUnit * 0.006
  const pointRadius = mapUnit * 0.018
  const pointStrokeWidth = mapUnit * 0.0036
  const pointFontSize = mapUnit * 0.016
  const cabinetStrokeWidth = mapUnit * 0.0013
  const robotRadius = mapUnit * 0.021

  return (
    <div className="fleet-route-map">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${vehicle.label}实时路线地图`}>
        <rect width={width} height={height} className="fleet-map-floor" />
        {(mapData.halls || []).map((hall) => (
          <rect key={hall.id} x={hall.x} y={hall.y} width={hall.width} height={hall.depth} className="fleet-map-hall" />
        ))}
        {(mapData.corridors || []).map((corridor) => (
          <line key={corridor.id} x1={corridor.x1} y1={corridor.y1} x2={corridor.x2} y2={corridor.y2} strokeWidth={corridor.width} className="fleet-map-corridor" />
        ))}
        {(mapData.walls || []).map((wall) => (
          <line key={wall.id} x1={wall.x1} y1={wall.y1} x2={wall.x2} y2={wall.y2} strokeWidth={Math.max(wall.thickness, 260)} className="fleet-map-wall" />
        ))}
        {(mapData.cabinets || []).map((cabinet) => (
          <rect key={cabinet.id} x={cabinet.x} y={cabinet.y} width={cabinet.width} height={cabinet.depth} className={`fleet-map-cabinet ${cabinet.type || ''}`} style={{ strokeWidth: cabinetStrokeWidth }} />
        ))}
        {displayRoute.length > 1 ? (
          <polyline points={displayRoute.map((point) => `${point.x},${point.y}`).join(' ')} className="fleet-map-route" style={{ strokeWidth: routeStrokeWidth }} />
        ) : null}
        {points.map((point, index) => {
          const state = index < reachedCount ? 'completed' : index === reachedCount ? 'current' : 'waiting'
          return (
            <g className={`fleet-map-point is-${state}`} key={`${point.id || point.name}-${index}`}>
              <circle cx={point.x} cy={point.y} r={pointRadius} style={{ strokeWidth: pointStrokeWidth }} />
              <text x={point.x} y={point.y + pointFontSize * 0.34} style={{ fontSize: pointFontSize }}>{index + 1}</text>
            </g>
          )
        })}
        {currentPose ? (
          <g className="fleet-map-robot" transform={`translate(${currentPose.x} ${currentPose.y}) rotate(${currentPose.yaw * 180 / Math.PI})`}>
            <circle r={robotRadius} style={{ strokeWidth: pointStrokeWidth }} />
            <path d={`M ${-robotRadius * 0.52} ${robotRadius * 0.52} L 0 ${-robotRadius * 0.82} L ${robotRadius * 0.52} ${robotRadius * 0.52} Z`} />
          </g>
        ) : null}
      </svg>
      {!points.length ? <div className="fleet-map-empty">当前任务尚未保存路线点</div> : null}
      <div className="fleet-map-legend">
        <span><i className="done" />已到达</span>
        <span><i className="current" />当前目标</span>
        <span><i className="waiting" />未到达</span>
        <span><i className="robot" />车辆位置</span>
      </div>
    </div>
  )
}

function VehicleSidebar({ fleet, selectedId, mode, rooms, roomFilter, onModeChange, onSelectVehicle, onSelectRoom }) {
  const orderedFleet = useMemo(() => [...fleet].sort((a, b) => {
    const order = { alarm: 0, running: 1, warning: 2, idle: 3, offline: 4 }
    return order[a.status.key] - order[b.status.key] || a.index - b.index
  }), [fleet])
  const roomFleet = fleet.filter((vehicle) => rooms.some((room) => vehicle.roomName.includes(room.name)))
  const roomOnlineCount = roomFleet.filter((vehicle) => vehicle.online).length
  const roomReplayCount = new Set(rooms.flatMap((room) => room.replayVehicleIndexes || [])).size
  const roomPointCount = rooms.reduce((sum, room) => sum + Number(room.pointCount || 0), 0)

  return (
    <aside className="fleet-sidebar">
      <header>
        <div><span>MONITOR TARGETS</span><h2>监控对象</h2></div>
        <b>{mode === 'rooms' ? rooms.length : FLEET_SIZE}</b>
      </header>
      <div className="fleet-sidebar-tabs">
        <button type="button" className={mode === 'vehicles' ? 'active' : ''} onClick={() => onModeChange('vehicles')}>车辆 {FLEET_SIZE}</button>
        <button type="button" className={mode === 'rooms' ? 'active' : ''} onClick={() => onModeChange('rooms')}>电房 {rooms.length}</button>
      </div>
      {mode === 'vehicles' ? (
        <div className="fleet-vehicle-list">
          {orderedFleet.map((vehicle) => (
            <button
              type="button"
              className={`fleet-vehicle-item status-${vehicle.status.key}${selectedId === vehicle.id ? ' active' : ''}`}
              key={vehicle.id}
              onClick={() => onSelectVehicle(vehicle.id)}
            >
              <span className="fleet-vehicle-index">{String(vehicle.index).padStart(2, '0')}</span>
              <span className="fleet-vehicle-copy"><strong>{vehicle.label}</strong><small>{vehicle.roomName}</small></span>
              <span className="fleet-vehicle-state"><i />{vehicle.status.label}<small>{vehicle.progress}%</small></span>
            </button>
          ))}
        </div>
      ) : (
        <div className="fleet-room-list">
          <button type="button" className={!roomFilter ? 'active' : ''} onClick={() => onSelectRoom('')}>
            <span className="fleet-room-copy">
              <strong>全部电房</strong>
              <small>{rooms.length} 个电房 · {roomPointCount} 个巡检点</small>
            </span>
            <b className="fleet-room-stats"><strong>{roomOnlineCount} 在线</strong><small>{roomReplayCount} 路回放</small></b>
          </button>
          {rooms.map((room) => {
            const related = fleet.filter((vehicle) => vehicle.roomName.includes(room.name))
            const replayCount = room.replayVehicleIndexes?.length || 0
            return (
              <button type="button" className={roomFilter === room.name ? 'active' : ''} key={room.id} onClick={() => onSelectRoom(room.name)}>
                <span className="fleet-room-copy">
                  <strong>{room.name}</strong>
                  <small>{room.roomCode || 'POWER ROOM'} · {room.demoReplay ? '历史巡检3D回放' : room.location || '后端电房数据'}</small>
                </span>
                <b className="fleet-room-stats">
                  <strong>{related.filter((vehicle) => vehicle.online).length} 在线 · {replayCount} 回放</strong>
                  <small>{room.pointCount || 0} 个巡检点</small>
                </b>
              </button>
            )
          })}
        </div>
      )}
      <footer>
        <span><i className="running" />巡检中</span>
        <span><i className="idle" />在线空闲</span>
        <span><i className="offline" />离线</span>
      </footer>
    </aside>
  )
}

function SchoolFleetDashboard() {
  const navigate = useNavigate()
  const { business, vehicles: registeredVehicles, loading, error } = useBusinessOverview({ pollMs: 5000, includeVehicles: true })
  const [selectedVehicleId, setSelectedVehicleId] = useState(null)
  const [sidebarMode, setSidebarMode] = useState('vehicles')
  const [roomFilter, setRoomFilter] = useState('')
  const [telemetry, setTelemetry] = useState(null)
  const [visibleTileIds, setVisibleTileIds] = useState(() => new Set())

  const fleet = useMemo(() => {
    const registryByNumber = new Map()
    registeredVehicles.forEach((vehicle, index) => {
      const number = vehicleNumber(vehicle.id) || index + 1
      if (number >= 1 && number <= FLEET_SIZE) registryByNumber.set(number, vehicle)
    })
    const robotByNumber = new Map()
    business.robots.forEach((robot, index) => {
      const number = vehicleNumber(robot.robotCode || robot.id) || index + 1
      if (number >= 1 && number <= FLEET_SIZE) robotByNumber.set(number, robot)
    })

    return Array.from({ length: FLEET_SIZE }, (_, offset) => {
      const index = offset + 1
      const demoConfig = DEMO_REPLAY_CONFIG[index]
      const registered = registryByNumber.get(index)
      const robot = robotByNumber.get(index)
      const id = registered?.id || robot?.robotCode || `nano${index}`
      const matchingRecords = business.records.filter((item) => recordMatchesVehicle(item, id))
      const activeRecord = matchingRecords.find((item) => ACTIVE_RECORD_STATES.has(item.status)) || null
      const replayRecord = matchingRecords.find((item) => REPLAY_RECORD_STATES.has(item.status)) || null
      const record = activeRecord || replayRecord
      const results = record ? business.results.filter((result) => result.taskId === record.taskId) : []
      const abnormalCount = results.filter((result) => ABNORMAL_STATES.has(result.status)).length
      const online = Boolean(registered?.online)
      const vehicle = {
        index,
        id,
        registered: Boolean(registered),
        label: vehicleLabel(index),
        name: registered?.name || robot?.name || vehicleLabel(index),
        online,
        // Older backends did not expose camera_roles; movement is the
        // compatible primary stream in that deployment mode.
        cameraRoles: registered?.camera_roles || (registered ? ['movement'] : []),
        voltage: registered?.voltage ?? robot?.voltage,
        battery: robot?.battery,
        record,
        activeRecord,
        replayRecord,
        results,
        abnormalCount,
        roomName: record?.taskArea || demoConfig?.roomName || '实验楼一层 / 演示区域',
        taskName: activeRecord?.taskName || replayRecord?.taskName || demoConfig?.taskName || '实验楼一演示路线',
        progress: Number(record?.progress || 0),
      }
      return { ...vehicle, status: statusMeta(vehicle) }
    })
  }, [business.records, business.results, business.robots, registeredVehicles])

  const monitoredRooms = useMemo(() => {
    const rooms = business.rooms
      .filter((room) => room.active !== false)
      .map((room) => ({
        ...room,
        pointCount: business.points.filter((point) => point.roomId === room.id).length,
        routeCount: business.routes.filter((route) => route.roomId === room.id).length,
        replayVehicleIndexes: [],
      }))
    const replayVehicleIndexes = Object.entries(DEMO_REPLAY_CONFIG)
      .filter(([, config]) => config.map.id === hanlinRoomMap.id)
      .map(([index]) => Number(index))
    const replayRouteIds = new Set(Object.values(DEMO_REPLAY_CONFIG)
      .filter((config) => config.map.id === hanlinRoomMap.id)
      .map((config) => config.routeId))
    const demoRoom = {
      id: `demo-${hanlinRoomMap.id}`,
      roomCode: 'HL-001',
      name: hanlinRoomMap.name,
      location: '瀚林1号电房',
      description: '历史巡检点模拟 3D 动画数据',
      active: true,
      demoReplay: true,
      pointCount: hanlinRoomMap.inspectionPoints.length,
      routeCount: replayRouteIds.size,
      replayVehicleIndexes,
    }
    const existingIndex = rooms.findIndex((room) => room.roomCode === demoRoom.roomCode || room.name === demoRoom.name)
    if (existingIndex >= 0) {
      const backendRoom = rooms[existingIndex]
      rooms[existingIndex] = {
        ...demoRoom,
        ...backendRoom,
        demoReplay: true,
        pointCount: backendRoom.pointCount || demoRoom.pointCount,
        routeCount: backendRoom.routeCount || demoRoom.routeCount,
        replayVehicleIndexes,
      }
    } else {
      rooms.push(demoRoom)
    }
    return rooms
  }, [business.points, business.rooms, business.routes])

  const selectedVehicle = fleet.find((vehicle) => vehicle.id === selectedVehicleId) || null
  const selectedActiveTaskId = selectedVehicle?.activeRecord?.taskId || null
  const runningCount = fleet.filter((vehicle) => vehicle.status.key === 'running').length
  const onlineCount = fleet.filter((vehicle) => vehicle.online).length
  const alarmCount = fleet.reduce((sum, vehicle) => sum + vehicle.abnormalCount, 0)
  const visibleVehicles = useMemo(() => {
    const order = { running: 0, alarm: 1, warning: 2, idle: 3, offline: 4 }
    return fleet
      .filter((vehicle) => !roomFilter || vehicle.roomName.includes(roomFilter))
      .sort((left, right) => order[left.status.key] - order[right.status.key] || left.index - right.index)
      .slice(0, OVERVIEW_WINDOW_LIMIT)
  }, [fleet, roomFilter])
  const gridColumns = smartGridColumns(visibleVehicles.length)
  const animatedReplayIds = useMemo(() => {
    const visibleLiveCount = visibleVehicles.filter((vehicle) => (
      visibleTileIds.has(vehicle.id)
      && vehicle.online
      && vehicle.activeRecord
      && ACTIVE_RECORD_STATES.has(vehicle.activeRecord.status)
    )).length
    const availableReplaySlots = Math.max(0, MAX_ACTIVE_VISUALS - visibleLiveCount)
    const candidates = visibleVehicles.filter((vehicle) => (
      visibleTileIds.has(vehicle.id)
      && !(vehicle.online && vehicle.activeRecord && ACTIVE_RECORD_STATES.has(vehicle.activeRecord.status))
    )).sort((left, right) => Number(right.online) - Number(left.online) || Number(Boolean(right.replayRecord)) - Number(Boolean(left.replayRecord)) || left.index - right.index)
    return new Set(candidates.slice(0, availableReplaySlots).map((vehicle) => vehicle.id))
  }, [visibleTileIds, visibleVehicles])

  const handleTileVisibility = useCallback((vehicleId, isVisible) => {
    setVisibleTileIds((current) => {
      const hasVehicle = current.has(vehicleId)
      if (hasVehicle === isVisible) return current
      const next = new Set(current)
      if (isVisible) next.add(vehicleId)
      else next.delete(vehicleId)
      return next
    })
  }, [])

  useEffect(() => {
    if (!selectedVehicle?.registered || !selectedActiveTaskId) {
      setTelemetry(null)
      return undefined
    }
    let cancelled = false
    async function loadTelemetry() {
      try {
        const response = await fetch(`/api/vehicle/status?vehicle_id=${encodeURIComponent(selectedVehicle.id)}`, { credentials: 'include' })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.detail || `车辆状态请求失败（${response.status}）`)
        if (!cancelled) setTelemetry({ ...data, connected: Boolean(data.online), receivedAt: Date.now() })
      } catch (requestError) {
        if (!cancelled) setTelemetry((current) => ({ ...(current || {}), connected: false, error: requestError.message }))
      }
    }
    loadTelemetry()
    const timer = window.setInterval(loadTelemetry, 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [selectedActiveTaskId, selectedVehicle?.id, selectedVehicle?.registered])

  const taskRunning = Boolean(selectedVehicle?.online && selectedVehicle?.activeRecord && ACTIVE_RECORD_STATES.has(selectedVehicle.activeRecord.status))
  const selectedMap = selectedVehicle ? getVehicleMap(selectedVehicle) : labBuildingMap
  const navigation = telemetry?.navigation || selectedVehicle?.record?.navigation || {}
  const replayPointTotal = selectedVehicle && !selectedVehicle.activeRecord ? getReplayRoute(selectedVehicle, selectedMap).length : 0
  const pointTotal = Number(navigation.route_total ?? selectedVehicle?.record?.pointTotal ?? selectedVehicle?.record?.routePoints?.length ?? replayPointTotal)
  const reachedCount = Number(navigation.reached_count ?? selectedVehicle?.record?.currentSequence ?? 0)

  const selectVehicle = (vehicleId) => {
    setSelectedVehicleId(vehicleId)
    setSidebarMode('vehicles')
  }

  return (
    <section className={`school-fleet-dashboard${selectedVehicle ? ' is-detail' : ''}`}>
      <header className="fleet-page-header">
        <div className="fleet-title">
          <span>SCHOOL-LEVEL VEHICLE MONITORING</span>
          <h1>{selectedVehicle ? `${selectedVehicle.label}巡检详情` : '巡检车辆监控中心'}</h1>
          <p>{selectedVehicle ? `${selectedVehicle.roomName} · ${selectedVehicle.taskName}` : '实时车辆优先显示主摄像头，其余车辆回放最近路线或实验楼一演示路线'}</p>
        </div>
        <div className="fleet-summary">
          <span><small>车辆总数</small><strong>22</strong><em>台</em></span>
          <span className="online"><small>当前在线</small><strong>{onlineCount}</strong><em>台</em></span>
          <span className="running"><small>巡检中</small><strong>{runningCount}</strong><em>台</em></span>
          <span className={alarmCount ? 'alarm' : ''}><small>识别异常</small><strong>{alarmCount}</strong><em>项</em></span>
        </div>
        {selectedVehicle ? <button type="button" className="fleet-back-button" onClick={() => { setSelectedVehicleId(null); setTelemetry(null) }}>← 返回学校总览</button> : null}
      </header>

      <div className="fleet-page-body">
        <main className="fleet-monitor-main">
          {!selectedVehicle ? (
            <section className="fleet-overview-panel">
              <div className="fleet-section-heading">
                <div><span>SMART MONITOR WALL</span><h2>{roomFilter || '全部车辆监控'}</h2></div>
                <div><b>{visibleVehicles.length}</b> 个窗口 · 最多 {MAX_ACTIVE_VISUALS} 路动态画面 · {gridColumns} 列布局</div>
              </div>
              {loading ? <div className="fleet-empty-state"><strong>正在同步车辆监控状态</strong><span>请稍候</span></div> : null}
              {!loading && error ? <div className="fleet-empty-state is-error"><strong>监控数据读取失败</strong><span>{error}</span></div> : null}
              {!loading && !error && visibleVehicles.length === 0 ? (
                <div className="fleet-empty-state"><span className="empty-radar" /><strong>{roomFilter ? `${roomFilter}暂无关联车辆` : '暂无车辆数据'}</strong><span>可在右侧切换全部车辆或其他电房</span></div>
              ) : null}
              <div className="fleet-camera-wall" style={{ '--fleet-columns': gridColumns }}>
                {visibleVehicles.map((vehicle) => (
                  <FleetPrimaryTile
                    key={vehicle.id}
                    vehicle={vehicle}
                    animated={animatedReplayIds.has(vehicle.id)}
                    onVisibilityChange={handleTileVisibility}
                    onSelect={selectVehicle}
                  />
                ))}
              </div>
            </section>
          ) : (
            <section className="fleet-detail-panel">
              <div className="fleet-detail-toolbar">
                <div className={`vehicle-live-state status-${selectedVehicle.status.key}`}><i />{selectedVehicle.status.label}</div>
                <span>车辆编号 <b>{selectedVehicle.id}</b></span>
                <span>电量 <b>{selectedVehicle.battery == null ? '--' : `${selectedVehicle.battery}%`}</b></span>
                <span>电压 <b>{selectedVehicle.voltage == null ? '--' : `${Number(selectedVehicle.voltage).toFixed(1)} V`}</b></span>
                <span>数据更新 <b>{telemetry?.receivedAt ? new Date(telemetry.receivedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '--:--:--'}</b></span>
                {selectedVehicle.record?.executionId ? (
                  <button type="button" onClick={() => navigate(buildPatrolMonitorUrl({
                    executionId: selectedVehicle.record.executionId,
                    vehicleId: selectedVehicle.id,
                    taskId: selectedVehicle.record.taskId,
                  }))}>打开三维跟踪</button>
                ) : null}
              </div>

              {taskRunning ? (
                <div className="fleet-four-camera-grid">
                  {CAMERA_ROLES.map((camera) => (
                    <CameraFeed
                      key={camera.role}
                      vehicle={selectedVehicle}
                      role={camera.role}
                      title={camera.label}
                      code={camera.code}
                      enabled
                      configured={selectedVehicle.cameraRoles.includes(camera.role)}
                    />
                  ))}
                </div>
              ) : (
                <div className="fleet-detail-replay">
                  <ReplayFeed vehicle={selectedVehicle} animated full />
                </div>
              )}

              <div className="fleet-detail-bottom">
                <article className="fleet-route-panel">
                  <header><div><span>{taskRunning ? 'REAL-TIME MAP' : 'REPLAY ROUTE'}</span><h2>{taskRunning ? '实时地图、车辆与路线' : '历史任务路线与巡检点'}</h2></div><b>{selectedMap.name}</b></header>
                  <FleetRouteMap vehicle={selectedVehicle} telemetry={telemetry} mapData={selectedMap} />
                </article>
                <article className="fleet-task-panel">
                  <header><div><span>TASK & RECOGNITION</span><h2>任务进度、点位与识别结果</h2></div><b>{selectedVehicle.abnormalCount} 异常</b></header>
                  <div className="fleet-task-progress">
                    <div><span>任务进度</span><strong>{selectedVehicle.progress}%</strong></div>
                    <div className="fleet-progress-track"><i style={{ width: `${selectedVehicle.progress}%` }} /></div>
                  </div>
                  <dl className="fleet-task-meta">
                    <div><dt>任务名称</dt><dd>{selectedVehicle.taskName}</dd></div>
                    <div><dt>任务编号</dt><dd>{selectedVehicle.record?.taskId || '--'}</dd></div>
                    <div><dt>所属电房</dt><dd>{selectedVehicle.roomName}</dd></div>
                    <div><dt>开始时间</dt><dd>{formatTime(selectedVehicle.record?.startedAt)}</dd></div>
                    <div><dt>巡检点位</dt><dd>{reachedCount} / {pointTotal}</dd></div>
                    <div><dt>导航状态</dt><dd>{navigation.state || selectedVehicle.record?.status || '路线模拟回放'}</dd></div>
                  </dl>
                  <div className="fleet-result-list">
                    <div className="fleet-result-list-head"><span>最近识别结果</span><b>{selectedVehicle.results.length} 项</b></div>
                    {!selectedVehicle.results.length ? <div className="fleet-result-empty">{taskRunning ? '等待车辆到点并上传识别结果' : '演示回放不生成实时识别结果'}</div> : null}
                    {selectedVehicle.results.slice(0, 6).map((result) => (
                      <div className={`fleet-result-item ${ABNORMAL_STATES.has(result.status) ? 'is-abnormal' : ''}`} key={result.id}>
                        <span>{result.targetName || result.pointId || '巡检目标'}<small>{result.recognitionType || 'AI识别'}</small></span>
                        <strong>{result.value || '--'} {result.unit || ''}</strong>
                        <em>{result.status || '--'}</em>
                        <time>{formatTime(result.capturedAt)}</time>
                      </div>
                    ))}
                  </div>
                </article>
              </div>
            </section>
          )}
        </main>

        <VehicleSidebar
          fleet={fleet}
          selectedId={selectedVehicle?.id}
          mode={sidebarMode}
          rooms={monitoredRooms}
          roomFilter={roomFilter}
          onModeChange={setSidebarMode}
          onSelectVehicle={selectVehicle}
          onSelectRoom={(roomName) => { setRoomFilter(roomName); setSelectedVehicleId(null) }}
        />
      </div>
    </section>
  )
}

export default SchoolFleetDashboard
