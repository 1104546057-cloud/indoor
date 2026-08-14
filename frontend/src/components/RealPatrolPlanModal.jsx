/* eslint-disable react/prop-types */
import { useMemo, useState } from 'react'
import SlamMapEditor from './SlamMapEditor'

const PRIORITIES = ['低', '中', '高', '紧急']

function currentSchedule() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString()
  return { startDate: local.slice(0, 10), startTime: local.slice(11, 16) }
}

function normalizePlanPoint(point, index) {
  const pointId = String(point.pointCode || point.pointId || point.id || `plan-point-${index + 1}`)
  const name = point.pointName || point.name || point.targetName || `巡检点${index + 1}`
  return {
    id: pointId,
    pointId,
    name,
    pointName: name,
    targetName: name,
    x: Number(point.x),
    y: Number(point.y),
    yaw: Number(point.yaw || 0),
    sequence: index + 1,
  }
}

function normalizePlanPoints(points = []) {
  return points
    .map(normalizePlanPoint)
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
}

async function persistTask(task, editing) {
  const response = await fetch(editing ? `/api/tasks/${encodeURIComponent(task.id)}` : '/api/tasks', {
    method: editing ? 'PUT' : 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || '任务保存失败')
  return data.task
}

function defaultSelection(business, vehicles, task) {
  const roomIdsWithMaps = new Set(business.maps.map((map) => map.roomId))
  const rooms = business.rooms.filter((room) => room.active && roomIdsWithMaps.has(room.id))
  const room = rooms.find((item) => item.id === Number(task?.roomId)) || rooms[0] || null
  const maps = business.maps.filter((item) => item.roomId === room?.id)
  const map = maps.find((item) => item.id === Number(task?.mapId)) || maps.find((item) => item.active) || maps[0] || null
  const routes = business.routes.filter((item) => item.roomId === room?.id && item.mapId === map?.id && item.active)
  const route = routes.find((item) => item.id === Number(task?.routeDatabaseId))
    || routes.find((item) => item.routeCode === task?.routeId)
    || null
  const schedule = currentSchedule()
  return {
    roomId: room?.id || '',
    mapId: map?.id || '',
    routeId: route?.id || '',
    robot: task?.robot || vehicles.find((item) => item.online)?.id || vehicles[0]?.id || map?.vehicleId || 'nano1',
    name: task?.name || (room ? `${room.name}巡检计划` : ''),
    startDate: task?.start?.slice(0, 10) || schedule.startDate,
    startTime: task?.start?.slice(11, 16) || schedule.startTime,
    priority: task?.priority || '高',
  }
}

function defaultPlanPoints(business, task) {
  if (task?.routePoints?.length) return normalizePlanPoints(task.routePoints)
  if (!task?.routeDatabaseId) return []
  const route = business.routes.find((item) => item.id === Number(task.routeDatabaseId))
  return normalizePlanPoints(route?.points)
}

export default function RealPatrolPlanModal({ business, vehicles, editingTask, onClose, onSaved }) {
  const [form, setForm] = useState(() => defaultSelection(business, vehicles, editingTask))
  const [pointMode, setPointMode] = useState(() => editingTask?.routeDatabaseId ? 'saved' : 'custom')
  const [planPoints, setPlanPoints] = useState(() => defaultPlanPoints(business, editingTask))
  const [step, setStep] = useState(1)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const roomIdsWithMaps = useMemo(() => new Set(business.maps.map((map) => map.roomId)), [business.maps])
  const rooms = useMemo(
    () => business.rooms.filter((room) => room.active && roomIdsWithMaps.has(room.id)),
    [business.rooms, roomIdsWithMaps],
  )
  const room = rooms.find((item) => item.id === Number(form.roomId)) || null
  const maps = business.maps.filter((item) => item.roomId === room?.id)
  const map = maps.find((item) => item.id === Number(form.mapId)) || null
  const routes = business.routes.filter((item) => item.roomId === room?.id && item.mapId === map?.id && item.active)
  const route = routes.find((item) => item.id === Number(form.routeId)) || null
  const planPointIds = planPoints.map((point) => point.id)
  const legacyTask = Boolean(editingTask && (!editingTask.mapId || !editingTask.routePoints?.length))

  const setField = (name, value) => setForm((current) => ({ ...current, [name]: value }))
  const selectCustomMode = () => {
    setPointMode('custom')
    setForm((current) => ({ ...current, routeId: '' }))
  }
  const selectSavedMode = () => {
    setPointMode('saved')
    setPlanPoints([])
    setForm((current) => ({ ...current, routeId: '' }))
  }
  const clearPointsForMap = () => {
    setPointMode('custom')
    setPlanPoints([])
  }
  const changeRoom = (roomId) => {
    const nextRoomId = Number(roomId)
    const roomMaps = business.maps.filter((item) => item.roomId === nextRoomId)
    const nextMap = roomMaps.find((item) => item.active) || roomMaps[0] || null
    const nextRoom = rooms.find((item) => item.id === nextRoomId)
    setForm((current) => ({
      ...current,
      roomId: nextRoomId,
      mapId: nextMap?.id || '',
      routeId: '',
      name: nextRoom ? `${nextRoom.name}巡检计划` : current.name,
    }))
    clearPointsForMap()
  }
  const changeMap = (mapId) => {
    const nextMapId = Number(mapId)
    setForm((current) => ({ ...current, mapId: nextMapId, routeId: '' }))
    clearPointsForMap()
  }
  const changeRoute = (routeId) => {
    const nextRoute = routes.find((item) => item.id === Number(routeId))
    setPointMode('saved')
    setPlanPoints(normalizePlanPoints(nextRoute?.points))
    setForm((current) => ({
      ...current,
      routeId: nextRoute?.id || '',
      name: room && nextRoute ? `${room.name}-${nextRoute.name}` : current.name,
    }))
  }
  const addPoint = (coordinate) => {
    selectCustomMode()
    setPlanPoints((current) => {
      const sequence = current.length + 1
      const pointId = `custom-${Date.now()}-${sequence}`
      return [...current, {
        id: pointId,
        pointId,
        name: `巡检点${sequence}`,
        pointName: `巡检点${sequence}`,
        targetName: `巡检点${sequence}`,
        x: Number(coordinate.x.toFixed(3)),
        y: Number(coordinate.y.toFixed(3)),
        yaw: 0,
        sequence,
      }]
    })
  }
  const updatePoint = (pointId, changes) => {
    selectCustomMode()
    setPlanPoints((current) => current.map((point) => {
      if (point.id !== pointId) return point
      const next = { ...point, ...changes }
      if (changes.name !== undefined) {
        next.pointName = changes.name
        next.targetName = changes.name
      }
      return next
    }))
  }
  const removePoint = (pointId) => {
    selectCustomMode()
    setPlanPoints((current) => current
      .filter((point) => point.id !== pointId)
      .map((point, index) => ({ ...point, sequence: index + 1 })))
  }
  const movePoint = (index, offset) => {
    const nextIndex = index + offset
    if (nextIndex < 0 || nextIndex >= planPoints.length) return
    selectCustomMode()
    setPlanPoints((current) => {
      const next = [...current]
      const [point] = next.splice(index, 1)
      next.splice(nextIndex, 0, point)
      return next.map((item, itemIndex) => ({ ...item, sequence: itemIndex + 1 }))
    })
  }

  const save = async (event) => {
    event.preventDefault()
    if (!room || !map || planPoints.length === 0) {
      setNotice('请选择真实地图，并至少在地图上添加一个巡检点')
      return
    }
    setBusy(true)
    setNotice('')
    const duration = Math.max(12, 8 + planPoints.length * 2)
    const routePoints = normalizePlanPoints(planPoints)
    const taskId = editingTask?.id || `task-${Date.now()}`
    const savedRoute = pointMode === 'saved' ? route : null
    const task = {
      id: taskId,
      sceneId: room.roomCode,
      roomId: room.id,
      mapId: map.id,
      mapCode: map.mapCode,
      mapVersion: map.version,
      routeDatabaseId: savedRoute?.id || null,
      name: form.name.trim() || `${room.name}-${savedRoute?.name || '自选点巡检'}`,
      area: `${room.name} / ${map.name} V${map.version}`,
      robot: form.robot,
      routeId: savedRoute?.routeCode || `custom-${map.mapCode}-${taskId}`,
      pointIds: routePoints.map((point) => point.id),
      routePoints,
      start: `${form.startDate} ${form.startTime}`,
      status: editingTask?.status || '待执行',
      progress: editingTask?.progress || 0,
      priority: form.priority,
      detail: { pointTotal: routePoints.length, currentPoint: 0, eta: `${duration}分钟`, abnormalCount: 0 },
      timeline: [
        { time: form.startTime, label: '等待任务启动', type: 'WAIT', state: 'pending' },
        { time: '--:--', label: '地图与定位校验', type: 'MAP', state: 'pending' },
        { time: '--:--', label: '按计划点位导航', type: 'GO', state: 'pending' },
        { time: '--:--', label: '巡检完成', type: 'END', state: 'pending' },
      ],
      aiPreview: [],
    }
    try {
      const saved = await persistTask(task, Boolean(editingTask))
      onSaved(saved)
    } catch (error) {
      setNotice(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="task-modal-backdrop" role="presentation">
      <section className="task-plan-modal real-plan-modal" role="dialog" aria-modal="true" aria-labelledby="real-plan-modal-title">
        <div className="modal-heading"><div><span className="task-kicker">REAL PATROL PLAN</span><h2 id="real-plan-modal-title">{editingTask ? '编辑真实巡检计划' : '新建真实巡检计划'}</h2></div><button type="button" className="modal-close" aria-label="关闭任务表单" onClick={onClose}>×</button></div>
        <form className="plan-form" onSubmit={save}>
          <div className="plan-stepper">{['地图与选点', '任务确认'].map((label, index) => <button type="button" className={step === index + 1 ? 'active' : ''} disabled={index === 1 && (!map || planPoints.length === 0)} key={label} onClick={() => setStep(index + 1)}><span>{index + 1}</span>{label}</button>)}</div>
          {notice ? <div className="business-notice danger">{notice}</div> : null}
          {legacyTask ? <div className="business-notice danger">该旧任务没有绑定真实地图坐标点，不能按新数据链编辑；可保留历史记录或重新新建计划。</div> : null}
          {step === 1 ? <div className="real-plan-grid">
            <section className="real-plan-map-card">
              <div className="business-panel-title"><div><span>REAL SLAM MAP</span><h2>{map ? `${map.name} · V${map.version}` : '请选择地图'}</h2></div>{map ? <b className={map.active ? 'online' : 'offline'}>{map.active ? '当前导航地图' : '未启用'}</b> : null}</div>
              {map ? <SlamMapEditor map={map} points={planPoints} selectedPointIds={planPointIds} interactive onPick={addPoint} /> : <div className="slam-resource-empty">尚无真实地图</div>}
            </section>
            <section className="real-plan-fields">
              <label>电房<select required value={form.roomId} onChange={(event) => changeRoom(event.target.value)}><option value="">请选择</option>{rooms.map((item) => <option key={item.id} value={item.id}>{item.name}（{item.roomCode}）</option>)}</select></label>
              <label>地图版本<select required value={form.mapId} onChange={(event) => changeMap(event.target.value)}><option value="">请选择</option>{maps.map((item) => <option key={item.id} value={item.id}>{item.name} · V{item.version}{item.active ? '（当前）' : ''}</option>)}</select></label>
              <label>执行机器人<select required value={form.robot} onChange={(event) => setField('robot', event.target.value)}>{vehicles.length ? vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name || vehicle.id} · {vehicle.online ? '在线' : '离线'}</option>) : <option value={form.robot}>{form.robot}</option>}</select></label>
              <div className="real-plan-point-mode" role="group" aria-label="计划点位来源">
                <button type="button" className={pointMode === 'custom' ? 'active' : ''} onClick={selectCustomMode}>本次地图选点</button>
                <button type="button" className={pointMode === 'saved' ? 'active' : ''} disabled={routes.length === 0} onClick={selectSavedMode}>载入已有路线</button>
              </div>
              {pointMode === 'saved' ? <label>已有路线<select value={form.routeId} onChange={(event) => changeRoute(event.target.value)}><option value="">请选择</option>{routes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.points.length}点</option>)}</select></label> : <div className="scope-note">在左侧真实地图的白色可通行区域点击即可加点；调整名称、顺序或朝向后，将作为本次计划的点位快照保存。</div>}
              <div className="real-plan-point-head"><span>本次计划点位</span><b>{planPoints.length} 个</b></div>
              <div className="real-plan-point-list">
                {planPoints.length === 0 ? <div className="real-plan-point-empty">请在左侧地图上点击添加巡检点</div> : planPoints.map((point, index) => (
                  <article key={point.id} className="real-plan-point-item">
                    <b>{index + 1}</b>
                    <div>
                      <input aria-label={`第${index + 1}个巡检点名称`} value={point.name} onChange={(event) => updatePoint(point.id, { name: event.target.value })} />
                      <small>map({Number(point.x).toFixed(3)}, {Number(point.y).toFixed(3)})</small>
                      <label>Yaw<input aria-label={`第${index + 1}个巡检点朝向`} type="number" step="0.1" value={point.yaw} onChange={(event) => updatePoint(point.id, { yaw: Number(event.target.value || 0) })} /></label>
                    </div>
                    <nav aria-label={`第${index + 1}个巡检点排序`}>
                      <button type="button" disabled={index === 0} onClick={() => movePoint(index, -1)}>↑</button>
                      <button type="button" disabled={index === planPoints.length - 1} onClick={() => movePoint(index, 1)}>↓</button>
                      <button type="button" className="danger" onClick={() => removePoint(point.id)}>删除</button>
                    </nav>
                  </article>
                ))}
              </div>
              {!routes.length && map ? <div className="resource-optional-notice">当前地图没有正式路线，但不影响本次直接选点创建计划。</div> : null}
              <button type="button" className="business-primary" disabled={!map || planPoints.length === 0} onClick={() => setStep(2)}>下一步</button>
            </section>
          </div> : <div className="real-plan-confirm">
            <section><span>计划任务</span><h3>{room?.name || '--'} / {map ? `${map.name} V${map.version}` : '--'}</h3><p>{pointMode === 'saved' && route ? route.name : '本次地图直接选点'} · {planPoints.length} 个真实地图坐标点</p><ol>{planPoints.map((point, index) => <li key={point.id}><b>{index + 1}</b><span>{point.name}<small>map({Number(point.x).toFixed(3)}, {Number(point.y).toFixed(3)}) · yaw {Number(point.yaw).toFixed(2)}</small></span></li>)}</ol></section>
            <section className="real-plan-fields"><label>任务名称<input required value={form.name} onChange={(event) => setField('name', event.target.value)} /></label><div className="config-grid"><label>开始日<input type="date" required value={form.startDate} onChange={(event) => setField('startDate', event.target.value)} /></label><label>开始时间<input type="time" required value={form.startTime} onChange={(event) => setField('startTime', event.target.value)} /></label></div><label>任务优先级<select value={form.priority} onChange={(event) => setField('priority', event.target.value)}>{PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label><div className="scope-note">启动任务时会校验车端当前地图和 AMCL 定位；不一致时阻止行驶并提示到地图管理处理。</div><button type="submit" className="business-primary" disabled={busy || legacyTask}>{busy ? '保存中…' : editingTask ? '保存修改' : '创建真实计划'}</button></section>
          </div>}
        </form>
      </section>
    </div>
  )
}
