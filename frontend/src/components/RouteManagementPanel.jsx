import { useMemo, useState } from 'react'
import { fetchJson, jsonRequest } from '../api/business'
import useBusinessOverview from '../hooks/useBusinessOverview'

export default function RouteManagementPanel() {
  const { business, vehicles, loading, error, reload } = useBusinessOverview({ pollMs: 5000, includeVehicles: true })
  const [mode, setMode] = useState('point')
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const update = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }))
  const activeVehicle = vehicles.find((vehicle) => vehicle.online) || vehicles[0]
  const latestImages = useMemo(() => business.images.slice(0, 12), [business.images])

  const saveResource = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      const isPoint = mode === 'point'
      const payload = isPoint ? {
        point_code: form.code,
        name: form.name,
        room_id: Number(form.roomId),
        cabinet_id: form.cabinetId ? Number(form.cabinetId) : null,
        x: Number(form.x),
        y: Number(form.y),
        yaw: Number(form.yaw || 0),
        camera_pan: Number(form.cameraPan || 0),
        camera_tilt: Number(form.cameraTilt || 0),
      } : {
        route_code: form.code,
        name: form.name,
        room_id: Number(form.roomId),
        point_ids: (form.pointIds || '').split(',').map(Number).filter(Boolean),
      }
      await fetchJson(isPoint ? '/api/business/points' : '/api/business/routes', jsonRequest('POST', payload))
      setNotice(`${isPoint ? '巡检点' : '正式路线'}已保存`)
      setForm({})
      await reload(true)
    } catch (requestError) {
      setNotice(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  const dispatchRoute = async (route) => {
    if (!activeVehicle?.id || !activeVehicle.online) return
    setBusy(true)
    try {
      const result = await fetchJson(`/api/business/routes/${route.id}/start`, jsonRequest('POST', {
        vehicle_id: activeVehicle.id,
        speed: 0.6,
      }))
      setNotice(`任务 ${result.taskId} 已下发到 ${activeVehicle.name || activeVehicle.id}`)
      await reload(true)
    } catch (requestError) {
      setNotice(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="business-module-loading">正在读取巡检点、路线和实车状态…</div>
  return (
    <section className="route-management-module">
      {error ? <div className="business-notice danger">{error}</div> : null}
      {notice ? <div className="business-notice">{notice}<button type="button" onClick={() => setNotice('')}>×</button></div> : null}
      <div className="route-module-top">
        <section className="business-module-panel route-editor-panel">
          <div className="business-panel-title"><div><span>POINT & ROUTE EDITOR</span><h2>巡检点与正式路线</h2></div><div className="business-toggle"><button type="button" className={mode === 'point' ? 'active' : ''} onClick={() => { setMode('point'); setForm({}) }}>巡检点</button><button type="button" className={mode === 'route' ? 'active' : ''} onClick={() => { setMode('route'); setForm({}) }}>路线</button></div></div>
          <form className="business-route-form" onSubmit={saveResource}>
            <div className="business-form-row"><label>业务编码<input required value={form.code || ''} onChange={update('code')} /></label><label>名称<input required value={form.name || ''} onChange={update('name')} /></label></div>
            <label>所属电房<select required value={form.roomId || ''} onChange={update('roomId')}><option value="">请选择</option>{business.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
            {mode === 'point' ? <>
              <label>关联电柜<select value={form.cabinetId || ''} onChange={update('cabinetId')}><option value="">不关联</option>{business.cabinets.map((cabinet) => <option key={cabinet.id} value={cabinet.id}>{cabinet.name}</option>)}</select></label>
              <div className="business-form-row four"><label>导航 X<input required type="number" step="0.01" value={form.x || ''} onChange={update('x')} /></label><label>导航 Y<input required type="number" step="0.01" value={form.y || ''} onChange={update('y')} /></label><label>航向角<input type="number" step="0.01" value={form.yaw || ''} onChange={update('yaw')} /></label><label>云台俯仰<input type="number" step="0.1" value={form.cameraTilt || ''} onChange={update('cameraTilt')} /></label></div>
            </> : <label>巡检点 ID 顺序<input required value={form.pointIds || ''} onChange={update('pointIds')} placeholder={business.points.map((point) => point.id).join(',')} /></label>}
            <button className="business-primary" disabled={busy}>{busy ? '保存中…' : `保存${mode === 'point' ? '巡检点' : '路线'}`}</button>
          </form>
        </section>

        <section className="business-module-panel route-dispatch-panel">
          <div className="business-panel-title"><div><span>REAL VEHICLE DISPATCH</span><h2>路线下发</h2></div><b className={activeVehicle?.online ? 'online' : 'offline'}>{activeVehicle?.online ? '实车在线' : '实车离线'}</b></div>
          <div className="route-vehicle-line"><strong>{activeVehicle?.name || activeVehicle?.id || '未配置车辆'}</strong><span>{activeVehicle?.ssh_host || activeVehicle?.host || '请配置 vehicles.json'}</span></div>
          <div className="formal-route-list">{business.routes.map((route) => <article key={route.id}><div><span>{route.routeCode}</span><strong>{route.name}</strong><small>{route.points.map((point) => point.name).join(' → ')}</small></div><button type="button" disabled={busy || !activeVehicle?.online} onClick={() => dispatchRoute(route)}>下发到实车</button></article>)}</div>
        </section>
      </div>

      <div className="route-module-bottom">
        <section className="business-module-panel"><div className="business-panel-title"><div><span>EXECUTION RECORDS</span><h2>真实巡检记录</h2></div><b>{business.records.length} 条</b></div><div className="business-record-list">{business.records.length === 0 ? <p>尚无实车巡检记录</p> : business.records.map((record) => <article key={record.id}><div><strong>{record.taskId || record.recordCode}</strong><span>{record.status}{record.failureReason ? ` · ${record.failureReason}` : ''}</span></div><i><b style={{ width: `${record.progress}%` }} /></i><em>{record.progress}%</em></article>)}</div></section>
        <section className="business-module-panel"><div className="business-panel-title"><div><span>IMAGE ARCHIVE</span><h2>现场图片归档</h2></div><b>{business.images.length} 张</b></div>{latestImages.length === 0 ? <div className="business-empty">等待车辆或 NX 服务上传图片</div> : <div className="business-image-grid">{latestImages.map((image) => <figure key={image.id}><img src={image.fileUrl} alt={`巡检记录 ${image.recordId} 图片 ${image.sequence}`} /><figcaption>记录 #{image.recordId} · 图 {image.sequence}</figcaption></figure>)}</div>}</section>
      </div>
    </section>
  )
}
