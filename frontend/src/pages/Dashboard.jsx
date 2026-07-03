/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, ImageOverlay, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  getInspectionResults,
  subscribeInspectionResults,
  updateInspectionResultReview,
} from '../utils/inspectionResults'
import '../styles/Dashboard.css'

// ---- Leaflet CRS: 像素坐标系，让我们的模型坐标和地图像素一一对应 ----
const MAP_IMAGE_W = 2560
const MAP_IMAGE_H = 1440
const MAP_BOUNDS = [[0, 0], [MAP_IMAGE_H, MAP_IMAGE_W]]

const pixelCRS = L.Util.extend(L.CRS.Simple, {
  transformation: new L.Transformation(1, 0, 1, 0),
})

// ---- 数据 ----
const fallbackVehicles = [
  { id: 'nano1', online: true, voltage: 47.8, speed: 0.8, battery: 82 },
  { id: 'nano2', online: false, voltage: null, speed: 0, battery: 76 },
  { id: 'nano3', online: false, voltage: null, speed: 0, battery: 71 },
]

const seedEvents = [
  { time: '10:42:15', text: 'nano1 到达点位 P22 配电室', type: 'ok' },
  { time: '10:42:18', text: 'AI 识别开始: 仪表 OCR', type: 'scan' },
  { time: '10:42:21', text: 'AI 识别完成，结果: 正常', type: 'ok' },
  { time: '10:42:23', text: '巡检图片上传成功', type: 'scan' },
  { time: '10:45:36', text: '前往下一点位 P23 空调机房', type: 'move' },
]

const seedAreas = [
  {
    id: 'west',
    title: '中法核工程与技术学院',
    status: '可巡检',
    statusTone: 'ready',
    points: 18,
    imageUrl: '/inspection-scenes/power-room.svg',
    anchorLatLng: [520, 710],
    cardOffset: { x: -210, y: -310 },
  },
  {
    id: 'east',
    title: '中山大学珠海校区教学楼A区',
    status: '巡检中',
    statusTone: 'running',
    points: 24,
    imageUrl: '/inspection-scenes/corridor.svg',
    anchorLatLng: [800, 1760],
    cardOffset: { x: -360, y: -10 },
  },
  {
    id: 'south',
    title: '蓝海科技产业园',
    status: '待巡检',
    statusTone: 'queued',
    points: 16,
    imageUrl: '/inspection-scenes/lab-room.svg',
    anchorLatLng: [880, 1120],
    cardOffset: { x: -510, y: 20 },
  },
]

// ---- 工具 ----
function formatVoltage(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${numeric.toFixed(1)} V` : '--'
}

function getClockParts() {
  const now = new Date()
  return {
    time: now.toLocaleTimeString('zh-CN', { hour12: false }),
    date: now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' }),
  }
}

function mapStoredResultToDisplay(result) {
  return {
    id: result.id,
    title: result.targetName || result.pointId || result.recognitionType || '识别结果',
    value: result.value || '--',
    status: result.status || '正常',
    confidence: result.confidence || '--',
    capturedAt: result.capturedAt || '--',
    reviewStatus: result.reviewStatus || '待复核',
    recognitionType: result.recognitionType || 'AI 识别',
    source: result,
  }
}

// ---- 地图交互钩子 ----
function PanZoomController({ onViewChange }) {
  const map = useMap()

  useMapEvents({
    moveend: () => {
      const center = map.getCenter()
      onViewChange({ center: [center.lat, center.lng], zoom: map.getZoom() })
    },
    zoomend: () => {
      const center = map.getCenter()
      onViewChange({ center: [center.lat, center.lng], zoom: map.getZoom() })
    },
  })

  return null
}

// ---- 机器人在地图上渲染 ----
function RobotLayer({ position, activeVehicle }) {
  const map = useMap()
  const markerRef = useRef(null)
  const ringRef = useRef(null)

  useEffect(() => {
    if (!markerRef.current) {
      const icon = L.divIcon({
        className: 'leaflet-robot-container',
        html: `<div class="leaflet-robot-ring"></div><div class="leaflet-robot-pill"><strong>${activeVehicle?.id || 'nano1'}</strong><span>${activeVehicle?.speed ?? 0.8} m/s</span><span>${activeVehicle?.battery ?? 82}%</span></div>`,
        iconSize: [48, 48],
        iconAnchor: [24, 24],
      })
      markerRef.current = L.marker(position, { icon, interactive: false }).addTo(map)
    } else {
      markerRef.current.setLatLng(position)
    }

    // 脉冲圆环
    if (!ringRef.current) {
      ringRef.current = L.circle(position, {
        radius: 85,
        color: '#4ce6ff',
        fillColor: '#4ce6ff',
        fillOpacity: 0.08,
        weight: 1.5,
        interactive: false,
      }).addTo(map)
    } else {
      ringRef.current.setLatLng(position)
    }

    return () => {
      if (markerRef.current) {
        markerRef.current.remove()
        markerRef.current = null
      }
      if (ringRef.current) {
        ringRef.current.remove()
        ringRef.current = null
      }
    }
  }, [position, activeVehicle, map])

  return null
}

// ---- 地图锚点 + 预览卡连线 ----
function AreaLayers({ areas }) {
  const map = useMap()
  const markersRef = useRef([])
  const linesRef = useRef([])

  useEffect(() => {
    // 清除旧层
    markersRef.current.forEach((m) => m.remove())
    linesRef.current.forEach((l) => l.remove())
    markersRef.current = []
    linesRef.current = []

    areas.forEach((area) => {
      // 锚点
      const dot = L.circle(area.anchorLatLng, {
        radius: 11,
        color: 'rgba(205, 251, 255, 0.9)',
        fillColor: area.statusTone === 'ready' ? '#44f0a3' : area.statusTone === 'running' ? '#4edfff' : '#ffc858',
        fillOpacity: 1,
        weight: 2,
        interactive: false,
      }).addTo(map)
      markersRef.current.push(dot)

      // 发光外圈
      const glow = L.circle(area.anchorLatLng, {
        radius: 38,
        color: '#4ce6ff',
        fillOpacity: 0,
        weight: 0.8,
        opacity: 0.3,
        interactive: false,
      }).addTo(map)
      markersRef.current.push(glow)
    })
  }, [areas, map])

  return null
}

// ---- 巡检路线 ----
function PatrolRouteLayer() {
  const map = useMap()
  const lineRef = useRef(null)
  const lineRef2 = useRef(null)

  useEffect(() => {
    const route1 = [[520, 710], [600, 1180], [880, 1120]]
    const route2 = [[600, 1180], [800, 1760]]

    lineRef.current = L.polyline(route1, {
      color: '#52e4ff',
      weight: 1.5,
      dashArray: '6 8',
      opacity: 0.65,
      interactive: false,
    }).addTo(map)

    lineRef2.current = L.polyline(route2, {
      color: '#52e4ff',
      weight: 1.5,
      dashArray: '6 8',
      opacity: 0.65,
      interactive: false,
    }).addTo(map)

    return () => {
      lineRef.current?.remove()
      lineRef2.current?.remove()
    }
  }, [map])

  return null
}

// ---- 弹窗 ----
function ResultModal({ result, onClose, onReview }) {
  if (!result) return null

  return (
    <div className="dashboard-modal-backdrop" onMouseDown={onClose}>
      <div className="dashboard-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dashboard-modal-head">
          <div>
            <span>AI RESULT REVIEW</span>
            <h3>{result.targetName || result.pointId || result.recognitionType || '识别详情'}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="dashboard-modal-grid">
          <div className="dashboard-modal-preview">
            <img src="/inspection-scenes/power-room.svg" alt="巡检预览" />
          </div>
          <div className="dashboard-modal-meta">
            <div><span>识别类型</span><strong>{result.recognitionType || '--'}</strong></div>
            <div><span>识别值</span><strong>{result.value || '--'}</strong></div>
            <div><span>识别状态</span><strong>{result.status || '--'}</strong></div>
            <div><span>置信度</span><strong>{result.confidence || '--'}</strong></div>
            <div><span>采集时间</span><strong>{result.capturedAt || '--'}</strong></div>
            <div><span>复核状态</span><strong>{result.reviewStatus || '待复核'}</strong></div>
          </div>
        </div>
        <div className="dashboard-modal-actions">
          <button type="button" onClick={() => onReview(result.id, '标记误报')}>标记误报</button>
          <button type="button" className="is-danger" onClick={() => onReview(result.id, '确认异常')}>确认异常</button>
        </div>
      </div>
    </div>
  )
}

// ---- 主组件 ----
function Dashboard() {
  const navigate = useNavigate()
  const [vehicles, setVehicles] = useState(fallbackVehicles)
  const [storedResults, setStoredResults] = useState(() => getInspectionResults())
  const [backendResults, setBackendResults] = useState([])
  const [selectedResult, setSelectedResult] = useState(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [captureMessage, setCaptureMessage] = useState('')
  const [clock, setClock] = useState(() => getClockParts())
  const [mapView, setMapView] = useState({ center: [720, 1280], zoom: -1 })
  const [showGrid, setShowGrid] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [showRoute, setShowRoute] = useState(true)

  // 时钟
  useEffect(() => {
    const timer = window.setInterval(() => setClock(getClockParts()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  // 车辆轮询
  useEffect(() => {
    let ignore = false
    async function loadVehicles() {
      try {
        const response = await fetch('/api/vehicles', { credentials: 'include' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        if (ignore) return
        const nextVehicles = data.vehicles?.length
          ? data.vehicles.map((vehicle, index) => ({
            speed: [0.8, 0.6, 0.5][index] ?? 0.5,
            battery: [82, 76, 71][index] ?? 70,
            ...vehicle,
          }))
          : fallbackVehicles
        setVehicles(nextVehicles)
      } catch {
        if (!ignore) setVehicles(fallbackVehicles)
      }
    }
    loadVehicles()
    const timer = window.setInterval(loadVehicles, 5000)
    return () => { ignore = true; window.clearInterval(timer) }
  }, [])

  // 识别结果订阅
  useEffect(() => subscribeInspectionResults(setStoredResults), [])

  // 识别结果轮询
  useEffect(() => {
    let ignore = false
    async function loadRecognitionResults() {
      try {
        const response = await fetch('/api/recognition/results?limit=50', { credentials: 'include' })
        if (!response.ok) return
        const data = await response.json()
        if (!ignore) setBackendResults(data.results || [])
      } catch {
        if (!ignore) setBackendResults([])
      }
    }
    loadRecognitionResults()
    const timer = window.setInterval(loadRecognitionResults, 5000)
    return () => { ignore = true; window.clearInterval(timer) }
  }, [])

  const refreshRecognitionResults = async () => {
    const response = await fetch('/api/recognition/results?limit=50', { credentials: 'include' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    setBackendResults(data.results || [])
  }

  const captureRecognition = async () => {
    setIsCapturing(true)
    setCaptureMessage('正在触发识别...')
    try {
      const response = await fetch('/api/recognition/capture', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: 'nano1camera', source: 'dashboard-manual' }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || data.error || `HTTP ${response.status}`)
      setCaptureMessage(`已采集 ${data.detections?.length || 0} 个目标`)
      await refreshRecognitionResults()
    } catch (error) {
      setCaptureMessage(error instanceof Error ? error.message : '采集失败')
    } finally {
      setIsCapturing(false)
    }
  }

  const recognitionSource = useMemo(
    () => (backendResults.length ? backendResults : storedResults),
    [backendResults, storedResults],
  )

  const displayResults = useMemo(
    () => recognitionSource.slice(0, 5).map(mapStoredResultToDisplay),
    [recognitionSource],
  )

  const anomalyResults = useMemo(
    () => recognitionSource.filter((r) => r.status === '异常' || r.status === '告警'),
    [recognitionSource],
  )

  const summary = useMemo(() => {
    const online = vehicles.filter((v) => v.online).length
    const active = vehicles.find((v) => v.online) || vehicles[0] || fallbackVehicles[0]
    return { total: vehicles.length, online, activeVehicle: active, aiCount: recognitionSource.length, alarmCount: anomalyResults.length }
  }, [anomalyResults.length, recognitionSource.length, vehicles])

  const alertSummary = useMemo(() => {
    const severe = anomalyResults.length || 3
    return [
      { label: '严重', value: severe, tone: 'danger' },
      { label: '重要', value: Math.max(Math.ceil(severe / 2), 1), tone: 'warn' },
      { label: '一般', value: Math.max(Math.ceil(severe / 1.5), 2), tone: 'info' },
    ]
  }, [anomalyResults.length])

  const handleReviewResult = async (resultId, reviewStatus) => {
    const backendResult = backendResults.find((r) => String(r.resultId || r.id) === String(resultId))
    if (backendResult?.resultId) {
      try {
        const response = await fetch(`/api/recognition/results/${backendResult.resultId}/review`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ review_status: reviewStatus }),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        await refreshRecognitionResults()
      } catch { /* keep local fallback */ }
    }
    updateInspectionResultReview(resultId, reviewStatus)
    setStoredResults(getInspectionResults())
    setSelectedResult(null)
  }

  const handleViewChange = useCallback(({ center, zoom }) => {
    setMapView({ center, zoom })
  }, [])

  const resetMapView = () => {
    // 通过强制重载地图回到初始状态
    setMapView({ center: [720, 1280], zoom: -1 })
  }

  return (
    <section className="dashboard-hud-page">
      {/* ======== Leaflet 交互地图 ======== */}
      <div className="hud-map-stage">
        <MapContainer
          center={[720, 1280]}
          zoom={-1}
          minZoom={-3}
          maxZoom={2}
          crs={pixelCRS}
          zoomControl={false}
          attributionControl={false}
          className="hud-leaflet-map"
          style={{ width: '100%', height: '100%' }}
        >
          <PanZoomController onViewChange={handleViewChange} />

          {/* 卫星底图 */}
          <ImageOverlay
            url="/maps/campus-satellite.png"
            bounds={MAP_BOUNDS}
          />

          {/* 巡检路线 */}
          {showRoute && <PatrolRouteLayer />}

          {/* 锚点 */}
          <AreaLayers areas={seedAreas} />

          {/* 机器人位置 */}
          <RobotLayer
            position={[710, 1180]}
            activeVehicle={summary.activeVehicle}
          />
        </MapContainer>

        {/* 地图遮罩渐晕 */}
        <div className="hud-map-vignette" />
      </div>

      {/* ======== HUD 浮层面板 ======== */}

      {/* 左上: 时间 */}
      <section className="hud-clock-panel">
        <strong>{clock.time}</strong>
        <span>{clock.date}</span>
      </section>

      {/* 右上: 指标块 */}
      <div className="hud-top-metrics">
        <article className="hud-metric-box">
          <span>在线机器人</span>
          <strong>{summary.online}/{summary.total}</strong>
          <small>车辆未连接，当前显示默认编队</small>
        </article>
        <article className="hud-metric-box">
          <span>AI 识别结果</span>
          <strong>{summary.aiCount}</strong>
          <small>识别流已接入控制台</small>
        </article>
        <article className="hud-metric-box">
          <span>异常告警</span>
          <strong className="tone-danger">{summary.alarmCount}</strong>
          <small>点击右下角快速复核</small>
        </article>
      </div>

      {/* 左侧中段: 任务卡 */}
      <section className="hud-task-panel">
        <div className="hud-panel-header">
          <h2>当前任务</h2>
          <em>巡检中</em>
        </div>
        <div className="hud-task-title">
          <strong>P线巡检任务</strong>
          <span>{summary.activeVehicle?.id || 'nano1'}</span>
        </div>
        <div className="hud-progress-row">
          <span>任务进度</span>
          <b>65%</b>
        </div>
        <div className="hud-progress-track">
          <span style={{ width: '65%' }} />
        </div>
        <dl className="hud-task-meta">
          <div><span>已完成/总点位</span><strong>23/35</strong></div>
          <div><span>当前点位</span><strong>P23 配电室</strong></div>
          <div><span>预计完成</span><strong>16:08</strong></div>
        </dl>
        <button type="button" className="hud-outline-button" onClick={() => navigate('/cluster-control')}>查看任务详情</button>
      </section>

      {/* 右侧中段: 工具面板 */}
      <section className="hud-tools-panel">
        <div className="hud-panel-header">
          <h3>地图工具</h3>
        </div>
        <div className="hud-icon-toolbar">
          <button type="button" aria-label="指针" title="指针">⌖</button>
          <button type="button" aria-label="定位" title="重置视角" onClick={resetMapView}>⌂</button>
          <button type="button" aria-label="标尺" title="标尺">⌗</button>
          <button type="button" aria-label="区域" title="区域">▱</button>
          <button type="button" aria-label="全屏" title="全屏">⛶</button>
        </div>
        <div className="hud-layer-panel">
          <div className="hud-layer-title">图层控制</div>
          <label>
            <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
            建筑标注
          </label>
          <label>
            <input type="checkbox" checked={showRoute} onChange={(e) => setShowRoute(e.target.checked)} />
            巡检路线
          </label>
          <label>
            <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
            坐标网格
          </label>
        </div>
        <div className="hud-view-info">
          <span>视口</span>
          <small>zoom {mapView.zoom} / {mapView.center[1].toFixed(0)},{mapView.center[0].toFixed(0)}</small>
        </div>
      </section>

      {/* 左下: 事件日志 */}
      <section className="hud-log-panel">
        <div className="hud-panel-header">
          <h3>事件日志</h3>
          <button type="button" className="hud-text-link">更多</button>
        </div>
        <div className="hud-log-list">
          {seedEvents.map((event) => (
            <div className="hud-log-row" key={`${event.time}-${event.text}`}>
              <span className={`hud-log-dot tone-${event.type}`} />
              <time>{event.time}</time>
              <p>{event.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 右下: 告警概览 */}
      <section className="hud-alert-panel">
        <div className="hud-panel-header">
          <h3>告警概览</h3>
          <button type="button" className="hud-text-link">更多</button>
        </div>
        <div className="hud-alert-totals">
          {alertSummary.map((item) => (
            <article key={item.label} className={`hud-alert-total tone-${item.tone}`}>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </article>
          ))}
        </div>
        <div className="hud-alert-list">
          {displayResults.slice(0, 3).map((result) => (
            <button type="button" key={result.id} className="hud-alert-row" onClick={() => setSelectedResult(result.source)}>
              <span>{result.capturedAt === '--' ? '10:18:32' : String(result.capturedAt).slice(11, 19)}</span>
              <b>{result.title}</b>
              <em>{result.value}</em>
            </button>
          ))}
        </div>
      </section>

      {/* 三张室内预览卡 (浮动在地图上) */}
      {seedAreas.map((area) => (
        <article
          key={area.id}
          className={`hud-preview-card tone-${area.statusTone}`}
          onClick={() => navigate('/cluster-control')}
        >
          <div className="hud-preview-head">
            <strong>{area.title}</strong>
            <em>{area.status}</em>
          </div>
          <img src={area.imageUrl} alt={`${area.title} 室内巡检预览`} />
          <div className="hud-preview-foot">
            <span>关键点位: {area.points}</span>
            <button type="button" onClick={(e) => { e.stopPropagation(); navigate('/cluster-control') }}>进入巡检</button>
          </div>
        </article>
      ))}

      {/* 底部图例 */}
      <div className="hud-legend-strip">
        <span><i className="legend-icon robot" />机器人</span>
        <span><i className="legend-icon route" />巡检路线</span>
        <span><i className="legend-icon point" />巡检点位</span>
        <span><i className="legend-icon area" />可巡检区域</span>
      </div>

      {/* 触发识别 */}
      <button type="button" className="hud-capture-button" onClick={captureRecognition} disabled={isCapturing}>
        {isCapturing ? '识别中...' : '触发识别'}
      </button>
      {captureMessage && <p className="hud-capture-message">{captureMessage}</p>}

      {/* 弹窗 */}
      <ResultModal result={selectedResult} onClose={() => setSelectedResult(null)} onReview={handleReviewResult} />
    </section>
  )
}

export default Dashboard
