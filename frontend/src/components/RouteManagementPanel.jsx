import { useEffect, useMemo, useState } from 'react'
import { fetchJson, jsonRequest } from '../api/business'
import useBusinessOverview from '../hooks/useBusinessOverview'
import SlamMapEditor from './SlamMapEditor'

function chooseDefaultMap(maps, roomId) {
  const roomMaps = maps.filter((item) => item.roomId === Number(roomId))
  return roomMaps.find((item) => item.active) || roomMaps[0] || null
}

export default function RouteManagementPanel() {
  const { business, vehicles, loading, error, reload } = useBusinessOverview({ pollMs: 5000, includeVehicles: true })
  const [mode, setMode] = useState('point')
  const [form, setForm] = useState({ pointIds: [] })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const roomsWithMaps = useMemo(() => {
    const roomIds = new Set(business.maps.map((item) => item.roomId))
    return business.rooms.filter((room) => room.active && roomIds.has(room.id))
  }, [business.maps, business.rooms])
  const selectedRoomId = Number(form.roomId || roomsWithMaps[0]?.id || 0)
  const roomMaps = useMemo(
    () => business.maps.filter((item) => item.roomId === selectedRoomId),
    [business.maps, selectedRoomId],
  )
  const selectedMap = roomMaps.find((item) => item.id === Number(form.mapId))
    || roomMaps.find((item) => item.active)
    || roomMaps[0]
    || null
  const mapPoints = useMemo(
    () => business.points.filter((point) => point.roomId === selectedRoomId && point.mapId === selectedMap?.id),
    [business.points, selectedMap?.id, selectedRoomId],
  )
  const mapRoutes = useMemo(
    () => business.routes.filter((route) => route.roomId === selectedRoomId && route.mapId === selectedMap?.id),
    [business.routes, selectedMap?.id, selectedRoomId],
  )
  const roomCabinets = useMemo(
    () => business.cabinets.filter((cabinet) => cabinet.roomId === selectedRoomId && cabinet.active),
    [business.cabinets, selectedRoomId],
  )
  const activeVehicle = vehicles.find((vehicle) => vehicle.online) || vehicles[0]
  const update = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }))

  useEffect(() => {
    if (!roomsWithMaps.length || form.roomId) return
    const room = roomsWithMaps[0]
    const map = chooseDefaultMap(business.maps, room.id)
    setForm((current) => ({ ...current, roomId: String(room.id), mapId: map ? String(map.id) : '', pointIds: [] }))
  }, [business.maps, form.roomId, roomsWithMaps])

  const changeRoom = (event) => {
    const roomId = Number(event.target.value)
    const map = chooseDefaultMap(business.maps, roomId)
    setForm((current) => ({ ...current, roomId: String(roomId), mapId: map ? String(map.id) : '', cabinetId: '', pointIds: [] }))
  }

  const changeMap = (event) => {
    setForm((current) => ({ ...current, mapId: event.target.value, cabinetId: '', pointIds: [] }))
  }

  const toggleRoutePoint = (pointId) => {
    setForm((current) => {
      const pointIds = current.pointIds || []
      return {
        ...current,
        pointIds: pointIds.includes(pointId)
          ? pointIds.filter((item) => item !== pointId)
          : [...pointIds, pointId],
      }
    })
  }

  const saveResource = async (event) => {
    event.preventDefault()
    if (!selectedMap) return
    setBusy(true)
    try {
      const isPoint = mode === 'point'
      const payload = isPoint ? {
        point_code: form.code,
        name: form.name,
        room_id: selectedRoomId,
        map_id: selectedMap.id,
        cabinet_id: form.cabinetId ? Number(form.cabinetId) : null,
        x: Number(form.x),
        y: Number(form.y),
        yaw: Number(form.yaw || 0),
        camera_pan: Number(form.cameraPan || 0),
        camera_tilt: Number(form.cameraTilt || 0),
      } : {
        route_code: form.code,
        name: form.name,
        description: form.description || null,
        room_id: selectedRoomId,
        map_id: selectedMap.id,
        point_ids: form.pointIds || [],
      }
      await fetchJson(isPoint ? '/api/business/points' : '/api/business/routes', jsonRequest('POST', payload))
      setNotice(`${isPoint ? '巡检点' : '正式路线'}已保存，并绑定 ${selectedMap.name} V${selectedMap.version}`)
      setForm((current) => ({ roomId: current.roomId, mapId: current.mapId, pointIds: [] }))
      await reload(true)
    } catch (requestError) {
      setNotice(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="business-module-loading">正在读取真实电房、地图、巡检点和路线…</div>
  return (
    <section className="route-management-module">
      {error ? <div className="business-notice danger">{error}</div> : null}
      {notice ? <div className="business-notice">{notice}<button type="button" onClick={() => setNotice('')}>×</button></div> : null}
      <div className="route-resource-filter">
        <label>电房<select value={selectedRoomId || ''} onChange={changeRoom}><option value="">请选择</option>{roomsWithMaps.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
        <label>地图版本<select value={selectedMap?.id || ''} onChange={changeMap}><option value="">请选择</option>{roomMaps.map((item) => <option key={item.id} value={item.id}>{item.name} · V{item.version}{item.active ? '（当前导航）' : ''}</option>)}</select></label>
        <div><span>执行车辆</span><strong>{activeVehicle?.name || activeVehicle?.id || '未配置'}</strong><em className={activeVehicle?.online ? 'online' : 'offline'}>{activeVehicle?.online ? '在线' : '离线'}</em></div>
      </div>

      {!selectedMap ? <div className="business-empty">当前没有可配置的真实地图，请先在“设备管理 → 电房档案 → 地图管理”中保存地图。</div> : (
        <div className="route-module-top real-resource-layout">
          <section className="business-module-panel map-point-panel">
            <div className="business-panel-title"><div><span>SLAM MAP RESOURCE</span><h2>{selectedMap.name} · V{selectedMap.version}</h2></div><b>{mapPoints.length} 点 / {mapRoutes.length} 路线</b></div>
            <SlamMapEditor
              map={selectedMap}
              points={mapPoints}
              selectedPointIds={mode === 'route' ? form.pointIds : []}
              interactive={mode === 'point'}
              onPick={({ x, y }) => setForm((current) => ({ ...current, x: x.toFixed(3), y: y.toFixed(3) }))}
            />
          </section>

          <section className="business-module-panel route-editor-panel">
            <div className="business-panel-title"><div><span>POINT & ROUTE EDITOR</span><h2>真实巡检资源</h2></div><div className="business-toggle"><button type="button" className={mode === 'point' ? 'active' : ''} onClick={() => { setMode('point'); setForm((current) => ({ roomId: current.roomId, mapId: current.mapId, pointIds: [] })) }}>巡检点</button><button type="button" className={mode === 'route' ? 'active' : ''} onClick={() => { setMode('route'); setForm((current) => ({ roomId: current.roomId, mapId: current.mapId, pointIds: [] })) }}>路线</button></div></div>
            <form className="business-route-form" onSubmit={saveResource}>
              <div className="business-form-row"><label>业务编码<input required value={form.code || ''} onChange={update('code')} placeholder={mode === 'point' ? '例如：1111-P01' : '例如：1111-R01'} /></label><label>名称<input required value={form.name || ''} onChange={update('name')} /></label></div>
              {mode === 'point' ? <>
                <label>关联电柜或监测对象<select value={form.cabinetId || ''} onChange={update('cabinetId')}><option value="">不关联</option>{roomCabinets.map((cabinet) => <option key={cabinet.id} value={cabinet.id}>{cabinet.name}</option>)}</select></label>
                <div className="business-form-row four"><label>导航 X<input required type="number" step="0.001" value={form.x || ''} onChange={update('x')} /></label><label>导航 Y<input required type="number" step="0.001" value={form.y || ''} onChange={update('y')} /></label><label>车辆朝向(rad)<input type="number" step="0.01" value={form.yaw || ''} onChange={update('yaw')} /></label><label>云台俯仰<input type="number" step="0.1" value={form.cameraTilt || ''} onChange={update('cameraTilt')} /></label></div>
                <small className="resource-form-tip">点击左侧地图可自动填写 X/Y；朝向 0 表示地图正 X 方向。</small>
              </> : <>
                <label>路线说明<input value={form.description || ''} onChange={update('description')} /></label>
                <div className="real-point-picker">{mapPoints.length === 0 ? <p>该地图尚未标注巡检点</p> : mapPoints.map((point) => { const order = (form.pointIds || []).indexOf(point.id); return <button type="button" className={order >= 0 ? 'selected' : ''} key={point.id} onClick={() => toggleRoutePoint(point.id)}><b>{order >= 0 ? order + 1 : '+'}</b><span>{point.name}<small>{point.pointCode} · ({Number(point.x).toFixed(2)}, {Number(point.y).toFixed(2)})</small></span></button> })}</div>
              </>}
              <button className="business-primary" disabled={busy || (mode === 'route' && !(form.pointIds || []).length)}>{busy ? '保存中…' : `保存${mode === 'point' ? '巡检点' : '路线'}`}</button>
            </form>
          </section>
        </div>
      )}

      <div className="route-module-bottom real-resource-lists">
        <section className="business-module-panel"><div className="business-panel-title"><div><span>MAP POINTS</span><h2>当前地图巡检点</h2></div><b>{mapPoints.length} 个</b></div><div className="formal-route-list">{mapPoints.length === 0 ? <p>尚未标注巡检点</p> : mapPoints.map((point) => <article key={point.id}><div><span>{point.pointCode}</span><strong>{point.name}</strong><small>map({Number(point.x).toFixed(3)}, {Number(point.y).toFixed(3)}) · yaw {Number(point.yaw).toFixed(2)}</small></div></article>)}</div></section>
        <section className="business-module-panel"><div className="business-panel-title"><div><span>FORMAL ROUTES</span><h2>当前地图正式路线</h2></div><b>{mapRoutes.length} 条</b></div><div className="formal-route-list">{mapRoutes.length === 0 ? <p>尚未创建正式路线</p> : mapRoutes.map((route) => <article key={route.id}><div><span>{route.routeCode}</span><strong>{route.name}</strong><small>{route.points.map((point) => point.name).join(' → ')}</small></div><em>{route.points.length} 点</em></article>)}</div></section>
      </div>
    </section>
  )
}
