/* eslint-disable react/prop-types */
import { useMemo, useState } from 'react'
import SlamMapEditor from './SlamMapEditor'

const PRIORITIES = ['低', '中', '高', '紧急']

function currentSchedule() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString()
  return { startDate: local.slice(0, 10), startTime: local.slice(11, 16) }
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
    || routes[0]
    || null
  const schedule = currentSchedule()
  return {
    roomId: room?.id || '',
    mapId: map?.id || '',
    routeId: route?.id || '',
    robot: task?.robot || vehicles.find((item) => item.online)?.id || vehicles[0]?.id || map?.vehicleId || 'nano1',
    name: task?.name || (room && route ? `${room.name}-${route.name}` : ''),
    startDate: task?.start?.slice(0, 10) || schedule.startDate,
    startTime: task?.start?.slice(11, 16) || schedule.startTime,
    priority: task?.priority || '高',
  }
}

export default function RealPatrolPlanModal({ business, vehicles, editingTask, onClose, onSaved }) {
  const [form, setForm] = useState(() => defaultSelection(business, vehicles, editingTask))
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
  const routePointIds = route?.points.map((point) => String(point.id)) || []
  const legacyTask = Boolean(editingTask && (!editingTask.mapId || !editingTask.routeDatabaseId))

  const setField = (name, value) => setForm((current) => ({ ...current, [name]: value }))
  const changeRoom = (roomId) => {
    const nextRoomId = Number(roomId)
    const roomMaps = business.maps.filter((item) => item.roomId === nextRoomId)
    const nextMap = roomMaps.find((item) => item.active) || roomMaps[0] || null
    const nextRoute = business.routes.find((item) => item.roomId === nextRoomId && item.mapId === nextMap?.id && item.active) || null
    const nextRoom = rooms.find((item) => item.id === nextRoomId)
    setForm((current) => ({
      ...current,
      roomId: nextRoomId,
      mapId: nextMap?.id || '',
      routeId: nextRoute?.id || '',
      name: nextRoom && nextRoute ? `${nextRoom.name}-${nextRoute.name}` : current.name,
    }))
  }
  const changeMap = (mapId) => {
    const nextMapId = Number(mapId)
    const nextRoute = business.routes.find((item) => item.roomId === room?.id && item.mapId === nextMapId && item.active) || null
    setForm((current) => ({ ...current, mapId: nextMapId, routeId: nextRoute?.id || '' }))
  }
  const changeRoute = (routeId) => {
    const nextRoute = routes.find((item) => item.id === Number(routeId))
    setForm((current) => ({ ...current, routeId: Number(routeId), name: room && nextRoute ? `${room.name}-${nextRoute.name}` : current.name }))
  }

  const save = async (event) => {
    event.preventDefault()
    if (!room || !map || !route) {
      setNotice('请先选择已经配置正式路线的真实地图')
      return
    }
    setBusy(true)
    setNotice('')
    const duration = Math.max(12, 8 + route.points.length * 2)
    const routePoints = route.points.map((point) => ({
      id: point.pointCode,
      pointId: point.pointCode,
      name: point.name,
      pointName: point.name,
      targetName: point.name,
      x: point.x,
      y: point.y,
      yaw: point.yaw,
    }))
    const task = {
      id: editingTask?.id || `task-${Date.now()}`,
      sceneId: room.roomCode,
      roomId: room.id,
      mapId: map.id,
      mapCode: map.mapCode,
      mapVersion: map.version,
      routeDatabaseId: route.id,
      name: form.name.trim() || `${room.name}-${route.name}`,
      area: `${room.name} / ${map.name} V${map.version}`,
      robot: form.robot,
      routeId: route.routeCode,
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
        { time: '--:--', label: '执行正式路线', type: 'GO', state: 'pending' },
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
          <div className="plan-stepper">{['电房、地图与路线', '任务确认'].map((label, index) => <button type="button" className={step === index + 1 ? 'active' : ''} key={label} onClick={() => setStep(index + 1)}><span>{index + 1}</span>{label}</button>)}</div>
          {notice ? <div className="business-notice danger">{notice}</div> : null}
          {legacyTask ? <div className="business-notice danger">该旧任务没有绑定真实地图版本，不能按新数据链编辑；可保留历史记录或重新新建计划。</div> : null}
          {step === 1 ? <div className="real-plan-grid">
            <section className="real-plan-map-card">
              <div className="business-panel-title"><div><span>REAL SLAM MAP</span><h2>{map ? `${map.name} · V${map.version}` : '请选择地图'}</h2></div>{map ? <b className={map.active ? 'online' : 'offline'}>{map.active ? '当前导航地图' : '未启用'}</b> : null}</div>
              {map ? <SlamMapEditor map={map} points={route?.points || []} selectedPointIds={routePointIds} /> : <div className="slam-resource-empty">尚无真实地图</div>}
            </section>
            <section className="real-plan-fields">
              <label>电房<select required value={form.roomId} onChange={(event) => changeRoom(event.target.value)}><option value="">请选择</option>{rooms.map((item) => <option key={item.id} value={item.id}>{item.name}（{item.roomCode}）</option>)}</select></label>
              <label>地图版本<select required value={form.mapId} onChange={(event) => changeMap(event.target.value)}><option value="">请选择</option>{maps.map((item) => <option key={item.id} value={item.id}>{item.name} · V{item.version}{item.active ? '（当前）' : ''}</option>)}</select></label>
              <label>正式路线<select required value={form.routeId} onChange={(event) => changeRoute(event.target.value)}><option value="">请选择</option>{routes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.points.length}点</option>)}</select></label>
              <label>执行机器人<select required value={form.robot} onChange={(event) => setField('robot', event.target.value)}>{vehicles.length ? vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name || vehicle.id} · {vehicle.online ? '在线' : '离线'}</option>) : <option value={form.robot}>{form.robot}</option>}</select></label>
              {!routes.length && map ? <div className="resource-disabled-notice">该地图尚未创建正式路线，请先到“巡检点与路线”完成配置。</div> : null}
              <button type="button" className="business-primary" disabled={!route} onClick={() => setStep(2)}>下一步</button>
            </section>
          </div> : <div className="real-plan-confirm">
            <section><span>计划任务</span><h3>{room?.name || '--'} / {map ? `${map.name} V${map.version}` : '--'}</h3><p>{route?.name || '尚未选择路线'} · {route?.points.length || 0} 个真实巡检点</p><ol>{route?.points.map((point) => <li key={point.id}><b>{point.sequence}</b><span>{point.name}<small>map({Number(point.x).toFixed(3)}, {Number(point.y).toFixed(3)}) · yaw {Number(point.yaw).toFixed(2)}</small></span></li>)}</ol></section>
            <section className="real-plan-fields"><label>任务名称<input required value={form.name} onChange={(event) => setField('name', event.target.value)} /></label><div className="config-grid"><label>开始日<input type="date" required value={form.startDate} onChange={(event) => setField('startDate', event.target.value)} /></label><label>开始时间<input type="time" required value={form.startTime} onChange={(event) => setField('startTime', event.target.value)} /></label></div><label>任务优先级<select value={form.priority} onChange={(event) => setField('priority', event.target.value)}>{PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label><div className="scope-note">启动任务时会校验车端当前地图和 AMCL 定位；不一致时阻止行驶并提示到地图管理处理。</div><button type="submit" className="business-primary" disabled={busy || legacyTask}>{busy ? '保存中…' : editingTask ? '保存修改' : '创建真实计划'}</button></section>
          </div>}
        </form>
      </section>
    </div>
  )
}
