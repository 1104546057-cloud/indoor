import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getInspectionResults, subscribeInspectionResults, updateInspectionResultReview } from '../utils/inspectionResults'
import '../styles/Dashboard.css'

const fallbackVehicles = [
  { id: 'nano1', name: '巡检车 nano1', status: 'offline', online: false, voltage: null, speed: 0, battery: 82 },
  { id: 'nano2', name: '巡检车 nano2', status: 'offline', online: false, voltage: null, speed: 0, battery: 76 },
  { id: 'nano3', name: '巡检车 nano3', status: 'offline', online: false, voltage: null, speed: 0, battery: 71 },
]

const kpiCards = [
  { key: 'todayTasks', label: '今日巡检任务', value: '6', unit: '个', delta: '较昨日 +20%', tone: 'cyan' },
  { key: 'completed', label: '已完成巡检', value: '4', unit: '个', delta: '较昨日 +33%', tone: 'blue' },
  { key: 'completionRate', label: '巡检完成率', value: '66.7', unit: '%', delta: '较昨日 +10%', tone: 'green' },
  { key: 'aiRate', label: 'AI识别成功率', value: '98.7', unit: '%', delta: '较昨日 +2.1%', tone: 'violet' },
  { key: 'alarms', label: '异常告警', value: '3', unit: '个', delta: '较昨日 +25%', tone: 'red' },
  { key: 'onlineRobots', label: '在线机器人', value: '1', unit: '台', delta: '电量 82%', tone: 'cyan' },
]

const inspectionPoints = [
  { id: 1, name: '低压配电柜1', status: '已完成', eta: '10:42:15', result: '正常' },
  { id: 2, name: '变压器温控仪', status: '已完成', eta: '10:45:32', result: '正常' },
  { id: 3, name: '低压配电柜2', status: '巡检中', eta: '10:48:10', result: '识别中' },
  { id: 4, name: 'UPS电源柜', status: '待巡检', eta: '--', result: '--' },
  { id: 5, name: '蓄电池组', status: '待巡检', eta: '--', result: '--' },
]

const aiResults = [
  {
    id: 'meter-1',
    point: '低压配电柜1',
    title: '电压表',
    value: '380 V',
    range: '380 ± 10 V',
    time: '10:54:21',
    confidence: '98.6%',
    status: '正常',
    visual: 'dial',
  },
  {
    id: 'meter-2',
    point: '变压器温控仪',
    title: '电流表',
    value: '36.2 A',
    range: '0 ~ 50 A',
    time: '10:54:21',
    confidence: '97.3%',
    status: '正常',
    visual: 'digital',
  },
]

const eventStream = [
  { time: '10:42:15', text: '机器人到达巡检点【低压配电柜1】', type: 'done' },
  { time: '10:42:18', text: '启动 AI 识别，识别类型：仪表 OCR', type: 'scan' },
  { time: '10:42:21', text: 'AI 识别完成，结果：正常', type: 'done' },
  { time: '10:42:23', text: '识别图片与原始图上传成功', type: 'upload' },
  { time: '10:42:25', text: '前往下一个巡检点【变压器温控仪】', type: 'move' },
  { time: '10:45:32', text: '机器人到达巡检点【变压器温控仪】', type: 'done' },
]

const alarmFeed = [
  { time: '10:18:32', title: '低压配电柜2 电流异常', detail: '电流值：63.2 A', level: '高', state: '未处理' },
  { time: '09:47:11', title: '环境监测 烟雾浓度超标', detail: '烟雾值：35 ppm', level: '中', state: '未处理' },
  { time: '08:55:24', title: '蓄电池组 温度过高', detail: '温度值：45.6 ℃', level: '中', state: '未处理' },
]

const facilityMaps = [
  {
    id: 'hanlin-1',
    name: '瀚林1号电房',
    task: 'P柜巡检任务',
    robot: 'nano1',
    status: '执行中',
    statusTone: 'running',
    progress: 65,
    pointCount: 35,
    currentPoint: 'P33',
    variant: 'hanlin',
  },
  {
    id: 'hanlin-2',
    name: '瀚林2号电房',
    task: '例行巡检待启动',
    robot: 'nano2',
    status: '待命',
    statusTone: 'idle',
    progress: 0,
    pointCount: 28,
    currentPoint: '--',
    variant: 'compact',
  },
  {
    id: 'distribution-b',
    name: '配电室B区',
    task: '夜间复核任务',
    robot: 'nano3',
    status: '排队中',
    statusTone: 'queued',
    progress: 0,
    pointCount: 42,
    currentPoint: '--',
    variant: 'wide',
  },
]

function formatVoltage(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${numeric.toFixed(1)} V` : '--'
}

function extractTime(value) {
  if (!value) return '--:--:--'
  return String(value).split(' ').pop()
}

function mapStoredResultToDashboard(result) {
  const isYoloResult = /yolo|目标检测|object detection/i.test(result.recognitionType || '')
  const targetName = result.targetName || result.value || result.pointId || '--'

  return {
    id: result.id,
    source: result,
    point: isYoloResult ? (result.robotId || 'nano1camera') : (result.targetName || result.pointId),
    title: result.recognitionType || 'AI识别',
    value: result.value || '--',
    range: isYoloResult ? `目标：${targetName}` : (result.status === '异常' ? '待人工复核' : '正常范围'),
    time: extractTime(result.capturedAt),
    confidence: result.confidence || '--',
    status: result.status || '正常',
    imageUrl: result.imageUrl || '',
    visual: isYoloResult ? 'target' : (result.visual === 'digital' ? 'digital' : 'dial'),
  }
}

function ReviewStatusPill({ status }) {
  const tone = status === '确认异常' ? 'confirmed' : status === '标记误报' ? 'false-positive' : 'pending'
  return <span className={`review-status-pill tone-${tone}`}>{status || '待复核'}</span>
}

function AiResultDetailModal({ result, onClose, onReview }) {
  if (!result) return null

  const pointName = result.targetName || result.pointId || '--'
  const status = result.status || '异常'

  return (
    <div className="ai-review-modal-backdrop" onMouseDown={onClose}>
      <div className="ai-review-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="ai-review-modal-head">
          <div>
            <span>AI RESULT REVIEW</span>
            <h3>{pointName} · {result.summary || result.recognitionType || '识别异常'}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="ai-review-modal-body">
          <div className="ai-review-preview">
            <div className="ai-review-frame">
              <span>{result.pointId || pointName}</span>
              <i />
            </div>
            <div className="ai-review-verdict">
              <strong className={status === '异常' ? 'is-danger' : ''}>{status}</strong>
              <p>{status === '异常' ? '识别结果超出预设安全范围，建议人工复核后闭环处理。' : '当前识别结果处于正常范围。'}</p>
            </div>
          </div>

          <div className="ai-review-detail-grid">
            <span>巡检任务<b>{result.taskName || result.taskId || '--'}</b></span>
            <span>执行设备<b>{result.robot || result.robotId || 'nano1'}</b></span>
            <span>识别点位<b>{pointName}</b></span>
            <span>识别类型<b>{result.recognitionType || '--'}</b></span>
            <span>识别值<b className={status === '异常' ? 'is-danger' : ''}>{result.value || '--'}</b></span>
            <span>置信度<b>{result.confidence || '--'}</b></span>
            <span>采集时间<b>{result.capturedAt || '--'}</b></span>
            <span>复核状态<b><ReviewStatusPill status={result.reviewStatus} /></b></span>
          </div>

          <div className="ai-review-modal-actions">
            {result.reviewedAt && <small>复核时间：{result.reviewedAt}</small>}
            <button type="button" onClick={() => onReview(result.id, '标记误报')}>标记误报</button>
            <button type="button" className="danger" onClick={() => onReview(result.id, '确认异常')}>确认异常</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Dashboard() {
  const navigate = useNavigate()
  const [vehicles, setVehicles] = useState(fallbackVehicles)
  const [statusText, setStatusText] = useState('等待车辆注册表同步')
  const [lastUpdated, setLastUpdated] = useState('--:--:--')
  const [storedResults, setStoredResults] = useState(() => getInspectionResults())
  const [backendResults, setBackendResults] = useState([])
  const [selectedResult, setSelectedResult] = useState(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [captureMessage, setCaptureMessage] = useState('')

  useEffect(() => {
    let ignore = false

    async function loadVehicles() {
      try {
        const response = await fetch('/api/vehicles', { credentials: 'include' })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const data = await response.json()
        if (ignore) return

        const nextVehicles = data.vehicles?.length ? data.vehicles.map((vehicle, index) => ({
          speed: [0.8, 0.6, 0.5][index] ?? 0.5,
          battery: [82, 76, 71][index] ?? 70,
          ...vehicle,
        })) : fallbackVehicles

        setVehicles(nextVehicles)
        setStatusText('车辆注册表已同步')
        setLastUpdated(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
      } catch {
        if (ignore) return
        setVehicles(fallbackVehicles)
        setStatusText('车辆 agent 未连接，显示默认车队')
        setLastUpdated(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
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
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const data = await response.json()
    setBackendResults(data.results || [])
  }

  const captureRecognition = async () => {
    setIsCapturing(true)
    setCaptureMessage('正在采集')
    try {
      const response = await fetch('/api/recognition/capture', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: 'nano1camera',
          source: 'dashboard-manual',
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.detail || data.error || `HTTP ${response.status}`)
      }
      setCaptureMessage(`已采集 ${data.detections?.length || 0} 个目标`)
      await refreshRecognitionResults()
    } catch (error) {
      setCaptureMessage(error instanceof Error ? error.message : '采集失败')
    } finally {
      setIsCapturing(false)
    }
  }

  const summary = useMemo(() => {
    const total = vehicles.length
    const online = vehicles.filter((vehicle) => vehicle.online).length
    const activeVehicle = vehicles.find((vehicle) => vehicle.online) || vehicles[0] || fallbackVehicles[0]

    return {
      total,
      online,
      offline: Math.max(total - online, 0),
      onlineRate: total ? Math.round((online / total) * 100) : 0,
      activeVehicle,
    }
  }, [vehicles])

  const recognitionSource = useMemo(() => (
    backendResults.length ? backendResults : storedResults
  ), [backendResults, storedResults])

  const anomalyResults = useMemo(() => (
    recognitionSource.filter((result) => result.status === '异常' || result.status === '告警')
  ), [recognitionSource])

  const pendingReviewCount = useMemo(() => (
    anomalyResults.filter((result) => result.reviewStatus === '待复核').length
  ), [anomalyResults])

  const dashboardKpis = useMemo(() => {
    const normalCount = recognitionSource.filter((result) => result.status === '正常').length
    const aiRate = recognitionSource.length ? ((normalCount / recognitionSource.length) * 100).toFixed(1) : null

    return kpiCards.map((card) => {
      if (card.key === 'aiRate' && aiRate) {
        return { ...card, value: aiRate, delta: `已识别 ${recognitionSource.length} 条` }
      }
      if (card.key === 'alarms') {
        return {
          ...card,
          value: String(anomalyResults.length),
          delta: pendingReviewCount ? `待复核 ${pendingReviewCount} 条` : '暂无待复核',
        }
      }
      if (card.key === 'onlineRobots') {
        return {
          ...card,
          value: String(summary.online),
          delta: `共 ${summary.total} 台`,
        }
      }
      return card
    })
  }, [anomalyResults.length, pendingReviewCount, recognitionSource, summary.online, summary.total])

  const dashboardAiResults = useMemo(() => (
    recognitionSource.length ? recognitionSource.slice(0, 5).map(mapStoredResultToDashboard) : aiResults
  ), [recognitionSource])

  const dashboardAlarms = useMemo(() => (
    anomalyResults.length
      ? anomalyResults.slice(0, 5).map((result) => ({
        time: extractTime(result.capturedAt),
        title: `${result.targetName || result.pointId} ${result.summary || result.recognitionType || '识别异常'}`,
        detail: `${result.recognitionType || '识别值'}：${result.value || '--'} / 置信度 ${result.confidence || '--'}`,
        level: result.level === 'alarm' ? '高' : '中',
        state: result.reviewStatus || '待复核',
        source: result,
      }))
      : alarmFeed
  ), [anomalyResults])

  const dashboardMaps = useMemo(() => (
    facilityMaps.map((map) => {
      if (map.id !== 'hanlin-1') {
        return { ...map, anomalies: 0, pendingReview: 0 }
      }

      return {
        ...map,
        anomalies: anomalyResults.length,
        pendingReview: pendingReviewCount,
        currentPoint: recognitionSource[0]?.pointId || map.currentPoint,
      }
    })
  ), [anomalyResults.length, pendingReviewCount, recognitionSource])

  const currentMission = {
    name: '上午例行巡检',
    code: 'TASK20200617001',
    route: '1号配电房_主线路',
    startTime: '08:30:00',
    duration: '60 分钟',
    progress: 65,
  }

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
        if (response.ok) {
          const data = await response.json()
          setBackendResults((current) => current.map((item) => (
            item.resultId === backendResult.resultId ? data.result : item
          )))
          setSelectedResult(data.result)
          return
        }
      } catch {
        // 后端复核失败时，继续走本地模拟数据逻辑。
      }
    }

    const nextResults = updateInspectionResultReview(resultId, reviewStatus)
    setStoredResults(nextResults)
    setSelectedResult(nextResults.find((result) => result.id === resultId) || null)
  }

  return (
    <section className="dashboard-page">
      <div className="dashboard-overview">
        {dashboardKpis.map((card) => (
          <article className={`dashboard-kpi-card tone-${card.tone}`} key={card.key}>
            <span className="kpi-orbit" />
            <div className="kpi-icon">{card.value}</div>
            <div className="kpi-copy">
              <p>{card.label}</p>
              <strong>{card.value}<em>{card.unit}</em></strong>
              <small>{card.delta}</small>
            </div>
          </article>
        ))}
      </div>

      <div className="dashboard-main-grid">
        <section className="dashboard-panel mission-panel">
          <div className="dashboard-panel-heading">
            <h2>当前巡检任务</h2>
            <span>{lastUpdated}</span>
          </div>
          <div className="mission-content">
            <dl className="mission-meta">
              <div><dt>任务名称</dt><dd>{currentMission.name}</dd></div>
              <div><dt>任务编号</dt><dd>{currentMission.code}</dd></div>
              <div><dt>巡检路线</dt><dd>{currentMission.route}</dd></div>
              <div><dt>开始时间</dt><dd>{currentMission.startTime}</dd></div>
              <div><dt>预计时长</dt><dd>{currentMission.duration}</dd></div>
            </dl>
            <div className="mission-progress-block">
              <div className="mission-progress-label">
                <span>任务进度</span>
                <strong>{currentMission.progress}%</strong>
              </div>
              <div className="mission-progress-bar">
                <span style={{ width: `${currentMission.progress}%` }} />
              </div>
            </div>
          </div>
        </section>

        <section className="dashboard-panel map-panel">
          <div className="dashboard-panel-heading">
            <div>
              <h2>多地图态势</h2>
              <span>{dashboardMaps.length} 张地图 / {summary.total} 台车辆</span>
            </div>
            <button type="button" className="dashboard-link-button" onClick={() => navigate('/device-control')}>
              进入遥控台
            </button>
          </div>

          <div className="map-stage map-overview-stage" aria-label="多地图态势总览">
            <div className="map-overview-grid">
              {dashboardMaps.map((map) => (
                <article
                  className={`facility-map-card tone-${map.statusTone}`}
                  key={map.id}
                  onClick={() => navigate('/cluster-control')}
                >
                  <div className="facility-card-head">
                    <div>
                      <strong>{map.name}</strong>
                      <span>{map.task}</span>
                    </div>
                    <em>{map.status}</em>
                  </div>

                  <div className={`facility-mini-map variant-${map.variant}`}>
                    <span className="mini-grid" />
                    <span className="mini-zone zone-main" />
                    <span className="mini-zone zone-side" />
                    <span className="mini-rack rack-a" />
                    <span className="mini-rack rack-b" />
                    <span className="mini-rack rack-c" />
                    <span className="mini-route route-a" />
                    <span className="mini-route route-b" />
                    <span className="mini-point point-a" />
                    <span className="mini-point point-b" />
                    <span className="mini-point point-c" />
                    <span className="mini-robot" />
                    {map.anomalies > 0 && (
                      <span className="mini-anomaly">
                        {map.currentPoint}
                      </span>
                    )}
                  </div>

                  <div className="facility-card-foot">
                    <span><b>{map.robot}</b> 执行车</span>
                    <span>{map.pointCount} 点位</span>
                    <span className={map.anomalies > 0 ? 'map-alert-count is-active' : 'map-alert-count'}>
                      异常 {map.anomalies}
                    </span>
                  </div>
                  <div className="facility-progress">
                    <span style={{ width: `${map.progress}%` }} />
                  </div>
                </article>
              ))}
            </div>

            <div className="map-overview-summary">
              <span><i className="legend-robot" />车辆位置</span>
              <span><i className="legend-point" />巡检路线</span>
              <span><i className="legend-current" />当前地图</span>
              <span><i className="legend-alarm" />异常点</span>
            </div>
          </div>
        </section>

        <section className="dashboard-panel ai-panel">
          <div className="dashboard-panel-heading">
            <h2>AI识别实时结果</h2>
            <div className="ai-panel-actions">
              <span>{captureMessage}</span>
              <button type="button" className="dashboard-text-button" onClick={captureRecognition} disabled={isCapturing}>
                {isCapturing ? '采集中' : '采集识别'}
              </button>
              <button type="button" className="dashboard-text-button" onClick={() => navigate('/cluster-control')}>
                更多
              </button>
            </div>
          </div>
          <div className="ai-result-list">
            {dashboardAiResults.map((result) => (
              <article
                className={`ai-result-card status-${result.status}${result.source ? ' is-clickable' : ''}`}
                key={result.id}
                role={result.source ? 'button' : undefined}
                tabIndex={result.source ? 0 : undefined}
                onClick={() => result.source && setSelectedResult(result.source)}
                onKeyDown={(event) => {
                  if (!result.source || (event.key !== 'Enter' && event.key !== ' ')) return
                  event.preventDefault()
                  setSelectedResult(result.source)
                }}
              >
                <div className="ai-result-stream">
                  <span className="stream-dot" />
                  <b>{result.point}</b>
                  <small>{result.time}</small>
                </div>
                <div className={`ai-result-visual visual-${result.visual}`}>
                  {result.imageUrl ? (
                    <img className="ai-result-image" src={result.imageUrl} alt={`${result.title} ${result.value}`} />
                  ) : result.visual === 'target' ? (
                    <div className="target-detection-mark">
                      <span />
                      <b />
                    </div>
                  ) : result.visual === 'dial' ? (
                    <>
                      <span className="dial-ring" />
                      <span className="dial-pointer" />
                      <span className="dial-center" />
                    </>
                  ) : (
                    <div className="digital-display">
                      <b>0000</b>
                      <b>3000</b>
                    </div>
                  )}
                </div>
                <dl className="ai-result-meta">
                  <div><dt>识别类型</dt><dd>{result.title}</dd></div>
                  <div><dt>识别值</dt><dd>{result.value}</dd></div>
                  <div><dt>标准范围</dt><dd>{result.range}</dd></div>
                  <div><dt>识别状态</dt><dd>{result.status}</dd></div>
                  <div><dt>置信度</dt><dd>{result.confidence}</dd></div>
                </dl>
                <span className={`ai-result-state state-${result.status}`}>{result.status}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="dashboard-panel robot-panel">
          <div className="dashboard-panel-heading">
            <h2>机器人状态</h2>
            <span>{statusText}</span>
          </div>
          <div className="robot-profile">
            <div className="robot-silhouette">
              <span className="robot-ring" />
              <div className="robot-shape">
                <span className="robot-head" />
                <span className="robot-body" />
                <span className="robot-wheel left" />
                <span className="robot-wheel right" />
              </div>
            </div>
            <dl className="robot-stats">
              <div><dt>机器人编号</dt><dd>{summary.activeVehicle?.id?.toUpperCase() || 'BOT-001'}</dd></div>
              <div><dt>运行状态</dt><dd className="status-online">{summary.activeVehicle?.online ? '巡检中' : '待命'}</dd></div>
              <div><dt>实时电量</dt><dd>{summary.activeVehicle?.battery ?? 82}%</dd></div>
              <div><dt>运行速度</dt><dd>{summary.activeVehicle?.speed ?? 0.8} m/s</dd></div>
              <div><dt>主电池</dt><dd>{formatVoltage(summary.activeVehicle?.voltage)}</dd></div>
            </dl>
          </div>
        </section>
      </div>

      <div className="dashboard-bottom-grid">
        <section className="dashboard-panel points-panel">
          <div className="dashboard-panel-heading">
            <h2>巡检点列表</h2>
            <button type="button" className="dashboard-text-button" onClick={() => navigate('/cluster-control')}>
              更多
            </button>
          </div>
          <div className="points-table">
            <div className="points-row points-head">
              <span>序号</span>
              <span>巡检点名称</span>
              <span>状态</span>
              <span>到达时间</span>
              <span>AI识别结果</span>
            </div>
            {inspectionPoints.map((point) => (
              <div className="points-row" key={point.id}>
                <span>{point.id}</span>
                <strong>{point.name}</strong>
                <em className={`status-${point.status}`}>{point.status}</em>
                <span>{point.eta}</span>
                <span>{point.result}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="dashboard-panel logs-panel">
          <div className="dashboard-panel-heading">
            <h2>巡检日志</h2>
            <button type="button" className="dashboard-text-button" onClick={() => navigate('/cluster-control')}>
              更多
            </button>
          </div>
          <div className="logs-content">
            <div className="timeline">
              {eventStream.map((event) => (
                <div className="timeline-item" key={`${event.time}-${event.text}`}>
                  <span className={`timeline-dot type-${event.type}`} />
                  <time>{event.time}</time>
                  <p>{event.text}</p>
                </div>
              ))}
            </div>
            <div className="logs-robot-preview">
              <span className="preview-ring" />
              <div className="robot-shape compact">
                <span className="robot-head" />
                <span className="robot-body" />
                <span className="robot-wheel left" />
                <span className="robot-wheel right" />
              </div>
            </div>
          </div>
        </section>

        <section className="dashboard-panel alerts-panel">
          <div className="dashboard-panel-heading">
            <h2>告警信息</h2>
            <button type="button" className="dashboard-text-button" onClick={() => navigate('/cluster-control')}>
              更多
            </button>
          </div>
          <div className="alerts-list">
            {dashboardAlarms.map((alarm) => (
              <article
                className={`alert-card level-${alarm.level}${alarm.source ? ' is-clickable' : ''}`}
                key={`${alarm.time}-${alarm.title}`}
                role={alarm.source ? 'button' : undefined}
                tabIndex={alarm.source ? 0 : undefined}
                onClick={() => alarm.source && setSelectedResult(alarm.source)}
                onKeyDown={(event) => {
                  if (!alarm.source || (event.key !== 'Enter' && event.key !== ' ')) return
                  event.preventDefault()
                  setSelectedResult(alarm.source)
                }}
              >
                <div className="alert-side">
                  <div className="alert-time">{alarm.time}</div>
                  <span className="alert-level">{alarm.level}</span>
                </div>
                <div className="alert-copy">
                  <strong>{alarm.title}</strong>
                  <p>{alarm.detail}</p>
                </div>
                <span className="alert-badge">{alarm.state}</span>
              </article>
            ))}
          </div>
        </section>
      </div>

      <AiResultDetailModal
        result={selectedResult}
        onClose={() => setSelectedResult(null)}
        onReview={handleReviewResult}
      />
    </section>
  )
}

export default Dashboard
