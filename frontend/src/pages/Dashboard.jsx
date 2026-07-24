/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AlarmWorkflowPanel from '../components/AlarmWorkflowPanel'
import useBusinessOverview from '../hooks/useBusinessOverview'
import { hanlinRoomMap } from '../data/hanlinRoomMap'
import '../styles/Dashboard.css'
import '../styles/BusinessModules.css'

const kpiCards = [
  { key: 'taskSummary', label: '任务统计', value: '0/0', unit: '个', delta: '完成率 0%', tone: 'cyan' },
  { key: 'currentTask', label: '当前任务', value: '空闲', unit: '', delta: '暂无执行任务', tone: 'blue' },
  { key: 'aiRate', label: 'AI识别成功率', value: '98.7', unit: '%', delta: '较昨日 +2.1%', tone: 'violet' },
  { key: 'alarms', label: '异常告警', value: '3', unit: '个', delta: '较昨日 +25%', tone: 'red' },
  { key: 'onlineRobots', label: '在线机器人', value: '1', unit: '台', delta: '电量 82%', tone: 'cyan' },
]

function formatVoltage(value) {
  if (value == null || value === '') return '--'
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

function getScenarioMap(room) {
  return room.roomCode === 'ROOM-A1' ? hanlinRoomMap : null
}

function ScenarioTaskMap({ map, onSelectPoint }) {
  const scene = map.sceneMap

  if (!scene) {
    return (
      <div className="facility-live-map" aria-label={`${map.name}任务态势图`}>
        {map.floorPlanUrl ? <img src={map.floorPlanUrl} alt={`${map.name}二维平面图`} /> : <span className="map-empty-floor">请在电房资源中配置对应巡检区域平面图</span>}
        <span className="map-floor-shade" />
      </div>
    )
  }

  const routePoints = map.points.filter((point) => point.sceneX != null && point.sceneY != null)
  return (
    <div className="facility-live-map scenario-map" aria-label={`${scene.name}任务态势图`}>
      <svg viewBox={`0 0 ${scene.size.width} ${scene.size.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${scene.name}二维巡检平面图`}>
        <rect width={scene.size.width} height={scene.size.height} className="scenario-map-background" />
        {scene.landmarkLines.map((line) => <rect key={line.id} x={line.x} y={line.y} width={line.width} height={line.height} className="scenario-landmark" />)}
        {scene.cabinets.map((cabinet) => <rect key={cabinet.id} x={cabinet.x} y={cabinet.y} width={cabinet.width} height={cabinet.depth} className={`scenario-cabinet ${cabinet.type}`} />)}
        {routePoints.length > 1 ? <polyline points={routePoints.map((point) => `${point.sceneX},${point.sceneY}`).join(' ')} className="scenario-route" /> : null}
        {routePoints.map((point) => (
          <g
            className={`scenario-point${point.isCurrent ? ' is-current' : ''}${point.isCompleted ? ' is-completed' : ''}${point.isAbnormal ? ' is-abnormal' : ''}`}
            key={point.id}
            role="button"
            tabIndex={0}
            onClick={(event) => { event.stopPropagation(); onSelectPoint(point) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectPoint(point) }
            }}
          >
            <circle cx={point.sceneX} cy={point.sceneY} r="235" />
            <text x={point.sceneX} y={point.sceneY + 82}>{point.sequence}</text>
          </g>
        ))}
        {map.currentPoint?.sceneX != null ? <rect x={map.currentPoint.sceneX - 165} y={map.currentPoint.sceneY - 165} width="330" height="330" rx="64" className="scenario-robot" /> : null}
        {routePoints.filter((point) => point.alarm).map((point) => <g className="scenario-alarm" key={point.alarm.id} onClick={(event) => { event.stopPropagation(); onSelectPoint(point) }}><circle cx={point.sceneX + 265} cy={point.sceneY - 265} r="155" /><text x={point.sceneX + 265} y={point.sceneY - 200}>!</text></g>)}
      </svg>
    </div>
  )
}

function AiResultDetailModal({ result, onClose, onReview, onOpenAlarm }) {
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
            <span>巡检记录<b>{result.recordId ? `REC-${result.recordId}` : '--'}</b></span>
            <span>识别结果<b>{result.resultId || result.id || '--'}</b></span>
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
            {result.alarm ? <button type="button" className="alarm-link" onClick={() => onOpenAlarm(result.alarm)}>处理告警 {result.alarm.alarmCode}</button> : null}
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
  const location = useLocation()
  const { business } = useBusinessOverview({ pollMs: 8000 })
  const [vehicles, setVehicles] = useState([])
  const [statusText, setStatusText] = useState('等待车辆注册表同步')
  const [lastUpdated, setLastUpdated] = useState('--:--:--')
  const [backendResults, setBackendResults] = useState([])
  const [selectedResult, setSelectedResult] = useState(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [captureMessage, setCaptureMessage] = useState('')
  const [activeMapId, setActiveMapId] = useState(null)
  const [processTab, setProcessTab] = useState('points')

  useEffect(() => {
    const focusRoomId = location.state?.focusRoomId
    if (focusRoomId) setActiveMapId(focusRoomId)
  }, [location.state?.focusRoomId])

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

        const nextVehicles = data.vehicles || []

        setVehicles(nextVehicles)
        setStatusText('车辆注册表已同步')
        setLastUpdated(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
      } catch {
        if (ignore) return
        setVehicles([])
        setStatusText('车辆注册表读取失败')
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

  const operationalVehicles = useMemo(() => {
    const robotsByCode = new Map(business.robots.map((robot) => [robot.robotCode, robot]))
    const registeredVehicles = vehicles.map((vehicle) => {
      const robot = robotsByCode.get(vehicle.id)
      robotsByCode.delete(vehicle.id)
      return {
        ...robot,
        ...vehicle,
        // 在线状态只以车辆 Agent 的实时探测结果为准；电量和任务状态复用业务库回传数据。
        online: vehicle.online,
        taskStatus: robot?.status,
        battery: robot?.battery ?? vehicle.battery,
        position: robot?.position,
      }
    })

    return [
      ...registeredVehicles,
      ...Array.from(robotsByCode.values()).map((robot) => ({
        ...robot,
        id: robot.robotCode,
        taskStatus: robot.status,
        online: Boolean(robot.online),
      })),
    ]
  }, [business.robots, vehicles])

  const summary = useMemo(() => {
    const total = operationalVehicles.length
    const online = operationalVehicles.filter((vehicle) => vehicle.online).length
    const activeVehicle = operationalVehicles.find((vehicle) => vehicle.online) || operationalVehicles[0] || null

    return {
      total,
      online,
      offline: Math.max(total - online, 0),
      onlineRate: total ? Math.round((online / total) * 100) : 0,
      activeVehicle,
    }
  }, [operationalVehicles])

  const recognitionSource = backendResults

  const dashboardKpis = useMemo(() => {
    const normalCount = recognitionSource.filter((result) => result.status === '正常').length
    const aiRate = recognitionSource.length ? ((normalCount / recognitionSource.length) * 100).toFixed(1) : null
    const completedRecords = business.records.filter((record) => record.status === 'completed').length
    const completionRate = business.records.length ? ((completedRecords / business.records.length) * 100).toFixed(1) : '0.0'
    const openAlarmCount = business.alarms.filter((alarm) => alarm.status !== '已关闭').length

    return kpiCards.map((card) => {
      if (card.key === 'taskSummary') return { ...card, value: `${completedRecords}/${business.records.length}`, delta: `完成率 ${completionRate}%` }
      if (card.key === 'currentTask') {
        const runningRecord = business.records.find((record) => ['dispatching', 'running'].includes(record.status))
        return {
          ...card,
          value: runningRecord ? '执行中' : '空闲',
          delta: runningRecord?.taskName || '暂无执行任务',
        }
      }
      if (card.key === 'aiRate') {
        return {
          ...card,
          value: aiRate || '--',
          delta: recognitionSource.length ? `已识别 ${recognitionSource.length} 条` : '等待真实 AI 结果',
        }
      }
      if (card.key === 'alarms') {
        return {
          ...card,
          tone: openAlarmCount ? 'red' : 'green',
          value: String(openAlarmCount),
          delta: openAlarmCount ? '等待告警闭环' : '暂无未关闭告警',
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
  }, [business.alarms, business.records, recognitionSource, summary.online, summary.total])

  const dashboardAiResults = useMemo(() => (
    recognitionSource.slice(0, 5).map(mapStoredResultToDashboard)
  ), [recognitionSource])

  const activeRecord = business.records.find((record) => ['dispatching', 'running'].includes(record.status)) || business.records[0]
  const currentMission = activeRecord ? {
    name: activeRecord.taskName || '实车巡检任务',
    code: activeRecord.taskId || activeRecord.recordCode,
    route: activeRecord.routeName || '--',
    startTime: extractTime(activeRecord.startedAt),
    duration: activeRecord.status,
    progress: activeRecord.progress,
  } : { name: '暂无执行任务', code: '--', route: '--', startTime: '--', duration: '--', progress: 0 }

  const dashboardMaps = useMemo(() => business.rooms.map((room) => {
    const sceneMap = getScenarioMap(room)
    const roomCabinets = business.cabinets.filter((cabinet) => cabinet.roomId === room.id)
    const roomPoints = business.points.filter((point) => point.roomId === room.id)
    const route = business.routes.find((item) => item.name === activeRecord?.routeName)
      || business.routes.find((item) => item.roomId === room.id)
    const record = business.records.find((item) => item.routeName === route?.name)
    const robotName = record?.robotName || summary.activeVehicle?.name || summary.activeVehicle?.id || '未绑定实车'
    const isRunning = record && ['dispatching', 'running'].includes(record.status)
    const routePoints = route?.points?.length ? route.points : roomPoints
    const pointMarkers = routePoints.map((point, index) => {
      const cabinet = roomCabinets.find((item) => item.id === point.cabinetId)
      const scenePoint = sceneMap?.inspectionPoints[index]
      const x = cabinet?.locationX ?? Math.min(88, Math.max(12, Number(point.x) * 10 || 18 + index * 18))
      const y = cabinet?.locationY ?? Math.min(82, Math.max(14, Number(point.y) * 10 || 25 + index * 15))
      const result = recognitionSource.find((item) => item.pointId === point.pointCode || item.cabinetCode === cabinet?.cabinetCode)
      const alarm = result ? business.alarms.find((item) => Number(item.resultId) === Number(result.resultId || result.id)) : null
      const isAbnormal = result && ['异常', '告警'].includes(result.status)
      return {
        ...point,
        x,
        y,
        sceneX: scenePoint?.x,
        sceneY: scenePoint?.y,
        sequence: point.sequence || index + 1,
        result,
        alarm,
        isAbnormal,
        isCurrent: isRunning && record.currentSequence === (point.sequence || index + 1),
        isCompleted: record?.currentSequence > (point.sequence || index + 1),
      }
    })
    const anomalies = pointMarkers.filter((point) => point.alarm && point.alarm.status !== '已关闭')
    const currentPoint = isRunning ? (pointMarkers.find((point) => point.isCurrent) || pointMarkers[0]) : null
    return {
      id: room.id,
      name: room.name,
      roomCode: room.roomCode,
      floorPlanUrl: room.floorPlanUrl,
      sceneMap,
      task: record?.taskName || route?.name || '尚未配置巡检路线',
      taskId: record?.taskId || null,
      robot: robotName,
      status: isRunning ? '执行中' : route ? '待下发' : '未配置',
      statusTone: isRunning ? 'running' : route ? 'idle' : 'queued',
      progress: record?.progress || 0,
      pointCount: pointMarkers.length,
      cabinets: roomCabinets,
      points: pointMarkers,
      currentPoint,
      anomalies,
    }
  }), [activeRecord?.routeName, business.alarms, business.cabinets, business.points, business.records, business.rooms, business.routes, recognitionSource, summary.activeVehicle])

  const resolvedActiveMapId = activeMapId && dashboardMaps.some((map) => map.id === activeMapId)
    ? activeMapId
    : dashboardMaps.find((map) => map.statusTone === 'running')?.id || dashboardMaps[0]?.id

  const orderedDashboardMaps = useMemo(() => {
    if (!resolvedActiveMapId) return dashboardMaps
    return [...dashboardMaps].sort((a, b) => Number(b.id === resolvedActiveMapId) - Number(a.id === resolvedActiveMapId))
  }, [dashboardMaps, resolvedActiveMapId])

  const inspectionPoints = useMemo(() => {
    const route = business.routes.find((item) => item.name === activeRecord?.routeName) || business.routes[0]
    return (route?.points || business.points).map((point, index) => {
      const result = recognitionSource.find((item) => item.targetName === point.name || item.pointId === point.pointCode)
      const sequence = index + 1
      const status = !activeRecord
        ? '待巡检'
        : sequence < activeRecord.currentSequence
          ? '已完成'
          : sequence === activeRecord.currentSequence && ['dispatching', 'running'].includes(activeRecord.status)
            ? '巡检中'
            : '待巡检'
      return {
        id: point.id,
        name: point.name,
        status,
        eta: extractTime(result?.capturedAt),
        result: result?.status || '--',
      }
    })
  }, [activeRecord, business.points, business.routes, recognitionSource])

  const eventStream = useMemo(() => business.records.slice(0, 8).map((record) => ({
    time: extractTime(record.startedAt || record.finishedAt),
    text: `${record.taskName || record.recordCode} · ${record.routeName || '未关联路线'} · ${record.status}`,
    type: record.status === 'completed' ? 'done' : record.status === 'failed' ? 'upload' : 'move',
  })), [business.records])

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
        // 后端复核失败时，继续更新浏览器内的缓存结果。
      }
    }

    setSelectedResult(null)
  }

  const handleOpenAlarm = (alarm) => {
    setSelectedResult(null)
    window.requestAnimationFrame(() => {
      document.getElementById(`alarm-${alarm.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
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
              <div><dt>任务状态</dt><dd>{currentMission.duration}</dd></div>
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
            <button type="button" className="dashboard-link-button" onClick={() => navigate('/device-control', {
              state: { returnTo: '/dashboard', focusRoomId: resolvedActiveMapId, taskId: activeRecord?.taskId },
            })}>
              进入遥控台
            </button>
          </div>

          <div className="map-stage map-overview-stage" aria-label="多地图态势总览">
            <div className={`map-overview-grid${dashboardMaps.length > 1 ? ' has-previews' : ''}`}>
              {dashboardMaps.length === 0 ? <div className="business-empty">尚未建立电房档案</div> : null}
              {orderedDashboardMaps.map((map) => (
                <article
                  className={`facility-map-card tone-${map.statusTone}${map.id === resolvedActiveMapId ? ' is-active-map' : ' is-map-preview'}`}
                  key={map.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`切换到${map.name}`}
                  onClick={() => setActiveMapId(map.id)}
                  onDoubleClick={() => navigate('/cluster-control')}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    setActiveMapId(map.id)
                  }}
                >
                  <div className="facility-card-head">
                    <div>
                      <strong>{map.name}</strong>
                      <span>{map.task}</span>
                    </div>
                    <em>{map.status}</em>
                  </div>

                  <ScenarioTaskMap
                    map={map}
                    onSelectPoint={(point) => {
                      setActiveMapId(map.id)
                      if (point.result) setSelectedResult({ ...point.result, alarm: point.alarm, taskName: map.task })
                    }}
                  />

                  <div className="facility-card-foot">
                    <span><b>{map.robot}</b> 执行车</span>
                    <span>{map.pointCount} 点位</span>
                    <span className={map.anomalies.length > 0 ? 'map-alert-count is-active' : 'map-alert-count'}>
                      告警 {map.anomalies.length}
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
            {dashboardAiResults.length === 0 ? <div className="business-empty">等待真实车辆或 NX 服务上报识别结果</div> : null}
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
              <div><dt>机器人编号</dt><dd>{summary.activeVehicle?.id?.toUpperCase() || '--'}</dd></div>
              <div><dt>运行状态</dt><dd className={summary.activeVehicle?.online ? 'status-online' : ''}>{summary.activeVehicle?.taskStatus || summary.activeVehicle?.status || (summary.activeVehicle?.online ? '在线待命' : '离线')}</dd></div>
              <div><dt>实时电量</dt><dd>{summary.activeVehicle?.battery != null ? `${summary.activeVehicle.battery}%` : '--'}</dd></div>
              <div><dt>运行速度</dt><dd>{summary.activeVehicle?.speed != null ? `${summary.activeVehicle.speed} m/s` : '--'}</dd></div>
              <div><dt>主电池</dt><dd>{formatVoltage(summary.activeVehicle?.voltage)}</dd></div>
            </dl>
          </div>
        </section>
      </div>

      <div className="dashboard-bottom-grid">
        <section className="dashboard-panel process-panel">
          <div className="dashboard-panel-heading">
            <div className="process-tabs" role="tablist" aria-label="巡检过程">
              <button type="button" role="tab" aria-selected={processTab === 'points'} className={processTab === 'points' ? 'active' : ''} onClick={() => setProcessTab('points')}>
                巡检点 <span>{inspectionPoints.length}</span>
              </button>
              <button type="button" role="tab" aria-selected={processTab === 'logs'} className={processTab === 'logs' ? 'active' : ''} onClick={() => setProcessTab('logs')}>
                巡检日志 <span>{eventStream.length}</span>
              </button>
            </div>
            <button type="button" className="dashboard-text-button" onClick={() => navigate('/cluster-control')}>
              更多
            </button>
          </div>
          {processTab === 'points' ? <div className="points-table" role="tabpanel">
            <div className="points-row points-head">
              <span>序号</span>
              <span>巡检点名称</span>
              <span>状态</span>
              <span>到达时间</span>
              <span>AI识别结果</span>
            </div>
            {inspectionPoints.length === 0 ? <div className="business-empty">尚未配置正式巡检点</div> : null}
            {inspectionPoints.map((point) => (
              <div className="points-row" key={point.id}>
                <span>{point.id}</span>
                <strong>{point.name}</strong>
                <em className={`status-${point.status}`}>{point.status}</em>
                <span>{point.eta}</span>
                <span>{point.result}</span>
              </div>
            ))}
          </div> : <div className="logs-content" role="tabpanel">
            <div className="timeline">
              {eventStream.length === 0 ? <div className="business-empty">尚无实车巡检记录</div> : null}
              {eventStream.map((event) => (
                <div className="timeline-item" key={`${event.time}-${event.text}`}>
                  <span className={`timeline-dot type-${event.type}`} />
                  <time>{event.time}</time>
                  <p>{event.text}</p>
                </div>
              ))}
            </div>
          </div>}
        </section>
      </div>

      <AlarmWorkflowPanel compact />

      <AiResultDetailModal
        result={selectedResult}
        onClose={() => setSelectedResult(null)}
        onReview={handleReviewResult}
        onOpenAlarm={handleOpenAlarm}
      />
    </section>
  )
}

export default Dashboard
