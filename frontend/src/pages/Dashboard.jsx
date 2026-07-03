/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getInspectionResults,
  subscribeInspectionResults,
  updateInspectionResultReview,
} from '../utils/inspectionResults'
import '../styles/Dashboard.css'

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
    anchor: { x: 27.2, y: 31.8 },
    card: { x: 55.8, y: 15.6, w: 16.2 },
  },
  {
    id: 'east',
    title: '中山大学珠海校区教学楼A区',
    status: '巡检中',
    statusTone: 'running',
    points: 24,
    imageUrl: '/inspection-scenes/corridor.svg',
    anchor: { x: 77.4, y: 47.4 },
    card: { x: 59.6, y: 54.8, w: 16.1 },
  },
  {
    id: 'south',
    title: '蓝海科技产业园',
    status: '待巡检',
    statusTone: 'queued',
    points: 16,
    imageUrl: '/inspection-scenes/lab-room.svg',
    anchor: { x: 50.8, y: 58.2 },
    card: { x: 22.2, y: 56.5, w: 16.4 },
  },
]

function formatVoltage(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${numeric.toFixed(1)} V` : '--'
}

function getClockParts() {
  const now = new Date()
  const time = now.toLocaleTimeString('zh-CN', { hour12: false })
  const date = now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  })
  return { time, date }
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
          <button type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
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
          <button type="button" onClick={() => onReview(result.id, '标记误报')}>
            标记误报
          </button>
          <button type="button" className="is-danger" onClick={() => onReview(result.id, '确认异常')}>
            确认异常
          </button>
        </div>
      </div>
    </div>
  )
}

function Dashboard() {
  const navigate = useNavigate()
  const [vehicles, setVehicles] = useState(fallbackVehicles)
  const [storedResults, setStoredResults] = useState(() => getInspectionResults())
  const [backendResults, setBackendResults] = useState([])
  const [selectedResult, setSelectedResult] = useState(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [captureMessage, setCaptureMessage] = useState('')
  const [clock, setClock] = useState(() => getClockParts())

  useEffect(() => {
    const timer = window.setInterval(() => setClock(getClockParts()), 1000)
    return () => window.clearInterval(timer)
  }, [])

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
    return () => {
      ignore = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => subscribeInspectionResults(setStoredResults), [])

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
    return () => {
      ignore = true
      window.clearInterval(timer)
    }
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
        method: 'POST',
        credentials: 'include',
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
    () => recognitionSource.filter((result) => result.status === '异常' || result.status === '告警'),
    [recognitionSource],
  )

  const summary = useMemo(() => {
    const online = vehicles.filter((vehicle) => vehicle.online).length
    const activeVehicle = vehicles.find((vehicle) => vehicle.online) || vehicles[0] || fallbackVehicles[0]
    return {
      total: vehicles.length,
      online,
      activeVehicle,
      aiCount: recognitionSource.length,
      alarmCount: anomalyResults.length,
    }
  }, [anomalyResults.length, recognitionSource.length, vehicles])

  const alertSummary = useMemo(() => {
    const severe = anomalyResults.length || 3
    return [
      { label: '严重', value: severe, tone: 'danger' },
      { label: '重要', value: Math.max(Math.ceil(severe / 2), 1), tone: 'warn' },
      { label: '一般', value: Math.max(Math.ceil(severe / 1.5), 2), tone: 'info' },
    ]
  }, [anomalyResults.length])

  const routeConnectors = useMemo(
    () => seedAreas.map((area) => {
      const startX = area.card.x + area.card.w / 2
      const startY = area.id === 'south' ? area.card.y : area.card.y + 17.5
      const curveX = area.id === 'south' ? startX + 8 : (startX + area.anchor.x) / 2
      const curveY = area.id === 'south' ? area.anchor.y + 2 : (startY + area.anchor.y) / 2
      return {
        id: area.id,
        path: `M ${startX} ${startY} Q ${curveX} ${curveY} ${area.anchor.x} ${area.anchor.y}`,
      }
    }),
    [],
  )

  const handleReviewResult = async (resultId, reviewStatus) => {
    const backendResult = backendResults.find((result) => String(result.resultId || result.id) === String(resultId))
    if (backendResult?.resultId) {
      try {
        const response = await fetch(`/api/recognition/results/${backendResult.resultId}/review`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ review_status: reviewStatus }),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        await refreshRecognitionResults()
      } catch {
        // Keep local fallback.
      }
    }

    updateInspectionResultReview(resultId, reviewStatus)
    setStoredResults(getInspectionResults())
    setSelectedResult(null)
  }

  return (
    <section className="dashboard-hud-page">
      <div className="dashboard-hud-canvas">
        <div className="hud-map-darkener" />
        <div className="hud-map-vignette" />

        {/* ---- 左上: 时间 ---- */}
        <section className="hud-clock-panel">
          <strong>{clock.time}</strong>
          <span>{clock.date}</span>
        </section>

        {/* ---- 右上: 在线 / AI / 告警 指标 ---- */}
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

        {/* ---- 左上: 当前任务卡片 ---- */}
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
            <div><span>已完成 / 总点位</span><strong>23 / 35</strong></div>
            <div><span>当前点位</span><strong>P23 配电室</strong></div>
            <div><span>预计完成</span><strong>16:08</strong></div>
          </dl>
          <button type="button" className="hud-outline-button">查看任务详情</button>
        </section>

        {/* ---- 右上: 地图工具 ---- */}
        <section className="hud-tools-panel">
          <div className="hud-panel-header">
            <h3>地图工具</h3>
          </div>
          <div className="hud-icon-toolbar">
            <button type="button" aria-label="指针" title="指针">⌖</button>
            <button type="button" aria-label="定位" title="定位">⌂</button>
            <button type="button" aria-label="标尺" title="标尺">⌗</button>
            <button type="button" aria-label="区域" title="区域">▱</button>
            <button type="button" aria-label="全屏" title="全屏">⛶</button>
          </div>
          <div className="hud-layer-panel">
            <div className="hud-layer-title">图层控制</div>
            <label><input type="checkbox" defaultChecked /> 卫星影像</label>
            <label><input type="checkbox" defaultChecked /> 模板标注</label>
            <label><input type="checkbox" defaultChecked /> 巡检路线</label>
            <label><input type="checkbox" defaultChecked /> 设备位置</label>
            <label><input type="checkbox" /> 室内区域</label>
          </div>
        </section>

        {/* ---- 左下: 事件日志 ---- */}
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

        {/* ---- 右下: 告警概览 ---- */}
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
              <button
                type="button"
                key={result.id}
                className="hud-alert-row"
                onClick={() => setSelectedResult(result.source)}
              >
                <span>{result.capturedAt === '--' ? '10:18:32' : String(result.capturedAt).slice(11, 19)}</span>
                <b>{result.title}</b>
                <em>{result.value}</em>
              </button>
            ))}
          </div>
        </section>

        {/* ---- 地图中央: 机器人标记 ---- */}
        <div className="hud-robot-marker" style={{ left: '54.2%', top: '47.2%' }}>
          <div className="hud-robot-ring" />
          <div className="hud-robot-pill">
            <strong>{summary.activeVehicle?.id || 'nano1'}</strong>
            <span>速度: {summary.activeVehicle?.speed ?? 0.8} m/s</span>
            <span>电量: {summary.activeVehicle?.battery ?? 82}%</span>
          </div>
        </div>

        {/* ---- 路径和连接线 SVG ---- */}
        <svg className="hud-route-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <marker id="hud-arrowhead" markerWidth="6" markerHeight="6" refX="4.8" refY="3" orient="auto">
              <path d="M0 0 L6 3 L0 6 z" fill="#53e3ff" />
            </marker>
          </defs>
          <path className="hud-main-route" d="M 52 57 C 48 61, 44 61, 39 60 C 34 58, 30 55, 26 52" />
          <path className="hud-main-route" d="M 54 47 C 59 46, 64 46, 70 48 C 73 49, 76 51, 78 53" />
          {routeConnectors.map((connector) => (
            <path
              key={connector.id}
              className="hud-connector-route"
              d={connector.path}
              markerEnd="url(#hud-arrowhead)"
            />
          ))}
        </svg>

        {/* ---- 三个室内预览卡 + 锚点 ---- */}
        {seedAreas.map((area) => (
          <div key={area.id}>
            <span
              className={`hud-map-anchor tone-${area.statusTone}`}
              style={{ left: `${area.anchor.x}%`, top: `${area.anchor.y}%` }}
            />
            <article
              className={`hud-preview-card tone-${area.statusTone}`}
              style={{ left: `${area.card.x}%`, top: `${area.card.y}%`, width: `${area.card.w}%` }}
            >
              <div className="hud-preview-head">
                <strong>{area.title}</strong>
                <em>{area.status}</em>
              </div>
              <img src={area.imageUrl} alt={`${area.title} 室内巡检预览`} />
              <div className="hud-preview-foot">
                <span>关键点位: {area.points}</span>
                <button type="button" onClick={() => navigate('/cluster-control')}>进入巡检</button>
              </div>
            </article>
          </div>
        ))}

        {/* ---- 底部: 图例 ---- */}
        <div className="hud-legend-strip">
          <span><i className="legend-icon robot" /> 机器人位置</span>
          <span><i className="legend-icon route" /> 巡检路线</span>
          <span><i className="legend-icon point" /> 巡检点位</span>
          <span><i className="legend-icon area" /> 可巡检区域</span>
        </div>

        {/* ---- 触发识别按钮 ---- */}
        <button
          type="button"
          className="hud-capture-button"
          onClick={captureRecognition}
          disabled={isCapturing}
        >
          {isCapturing ? '识别中...' : '触发识别'}
        </button>
        {captureMessage && <p className="hud-capture-message">{captureMessage}</p>}
      </div>

      <ResultModal
        result={selectedResult}
        onClose={() => setSelectedResult(null)}
        onReview={handleReviewResult}
      />
    </section>
  )
}

export default Dashboard
