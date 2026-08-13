/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchJson, jsonRequest } from '../api/business'
import '../styles/RoomMapManagement.css'

const directions = [
  { id: 'forward', label: '前进', symbol: '↑', linear: 0.12, angular: 0 },
  { id: 'left', label: '左转', symbol: '←', linear: 0, angular: 0.25 },
  { id: 'right', label: '右转', symbol: '→', linear: 0, angular: -0.25 },
  { id: 'backward', label: '后退', symbol: '↓', linear: -0.1, angular: 0 },
]

function formatDate(value) {
  if (!value) return '--'
  return String(value).replace('T', ' ').slice(0, 19)
}

function modeLabel(mode) {
  return ({ navigation: '导航模式', mapping: '正在建图', mapping_stopped: '建图车已停止', idle: '空闲', fault: '故障' })[mode] || '状态未知'
}

function MapCanvas({ src, metadata, pose, interactive = false, yaw, onPose }) {
  const hostRef = useRef(null)
  const marker = useMemo(() => {
    if (!pose || !metadata?.available || !metadata.width || !metadata.height || !metadata.resolution) return null
    const [originX, originY] = metadata.origin || [0, 0]
    return {
      left: ((pose.x - originX) / metadata.resolution / metadata.width) * 100,
      top: (1 - ((pose.y - originY) / metadata.resolution / metadata.height)) * 100,
      rotate: -((pose.yaw || 0) * 180 / Math.PI) + 90,
    }
  }, [metadata, pose])

  const choosePose = (event) => {
    if (!interactive || !metadata?.width || !metadata?.height) return
    const rect = hostRef.current.getBoundingClientRect()
    const nx = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const ny = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    const [originX, originY] = metadata.origin || [0, 0]
    onPose({
      x: originX + nx * metadata.width * metadata.resolution,
      y: originY + (1 - ny) * metadata.height * metadata.resolution,
      yaw,
    })
  }

  return (
    <div ref={hostRef} className={`room-map-canvas${interactive ? ' interactive' : ''}`} onClick={choosePose}>
      {src ? <img src={src} alt="SLAM栅格地图" draggable="false" /> : <div className="room-map-empty"><b>MAP</b><span>等待车辆发布 /map</span></div>}
      {marker && marker.left >= 0 && marker.left <= 100 && marker.top >= 0 && marker.top <= 100 ? <i className="room-map-robot" style={{ left: `${marker.left}%`, top: `${marker.top}%`, transform: `translate(-50%, -50%) rotate(${marker.rotate}deg)` }}>▲</i> : null}
    </div>
  )
}

export default function RoomMapManagement() {
  const { roomId } = useParams()
  const navigate = useNavigate()
  const commandTimerRef = useRef(null)
  const [room, setRoom] = useState(null)
  const [maps, setMaps] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [vehicleId, setVehicleId] = useState('')
  const [mapping, setMapping] = useState(null)
  const [selectedMapId, setSelectedMapId] = useState(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [saveForm, setSaveForm] = useState({ name: '', description: '' })
  const [poseDraft, setPoseDraft] = useState(null)
  const [poseYaw, setPoseYaw] = useState(0)
  const [imageRevision, setImageRevision] = useState(0)

  const selectedMap = maps.find((item) => item.id === selectedMapId) || maps[0] || null
  const activeMap = maps.find((item) => item.active) || null
  const selectedVehicle = vehicles.find((item) => item.id === vehicleId)
  const isMapping = mapping?.mode === 'mapping' || mapping?.mode === 'mapping_stopped'

  const loadPage = useCallback(async () => {
    const [mapResult, vehicleResult] = await Promise.all([
      fetchJson(`/api/business/rooms/${roomId}/maps`),
      fetchJson('/api/vehicles'),
    ])
    setRoom(mapResult.room)
    setMaps(mapResult.maps || [])
    setSelectedMapId((current) => current || mapResult.maps?.[0]?.id || null)
    const list = vehicleResult.vehicles || []
    setVehicles(list)
    setVehicleId((current) => current || vehicleResult.default_vehicle_id || list.find((item) => item.online)?.id || list[0]?.id || '')
  }, [roomId])

  useEffect(() => { loadPage().catch((error) => setNotice(error.message)) }, [loadPage])

  useEffect(() => {
    if (!vehicleId) return undefined
    let cancelled = false
    const refresh = async () => {
      try {
        const status = await fetchJson(`/api/business/rooms/${roomId}/mapping/status?vehicle_id=${encodeURIComponent(vehicleId)}`)
        if (!cancelled) {
          setMapping(status)
          if (status.map?.revision) setImageRevision(status.map.revision)
        }
      } catch (error) {
        if (!cancelled) setNotice(error.message)
      }
    }
    refresh()
    const timer = window.setInterval(refresh, 1500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [roomId, vehicleId])

  const run = async (label, action) => {
    setBusy(label)
    setNotice('')
    try { await action() } catch (error) { setNotice(error.message) } finally { setBusy('') }
  }

  const start = () => run('start', async () => {
    if (!window.confirm('开始建图会取消当前导航并切换到Cartographer。请确认车辆周围安全。')) return
    const status = await fetchJson(`/api/business/rooms/${roomId}/mapping/start`, jsonRequest('POST', { vehicle_id: vehicleId }))
    setMapping(status)
    setNotice('建图已启动，可以按住方向键低速扫描环境')
  })

  const stopVehicle = useCallback(async () => {
    if (!vehicleId) return
    await fetchJson(`/api/vehicle/stop?vehicle_id=${encodeURIComponent(vehicleId)}`, { method: 'POST' }).catch(() => {})
  }, [vehicleId])

  const clearCommandTimer = useCallback(() => {
    if (commandTimerRef.current) window.clearInterval(commandTimerRef.current)
    commandTimerRef.current = null
  }, [])

  const clearCommand = useCallback(() => {
    clearCommandTimer()
    stopVehicle()
  }, [clearCommandTimer, stopVehicle])

  useEffect(() => () => clearCommand(), [clearCommand])

  const beginDirection = (direction) => {
    if (!isMapping) return
    const publish = () => fetchJson('/api/vehicle/control', jsonRequest('POST', {
      vehicle_id: vehicleId,
      linear_x: direction.linear,
      angular_z: direction.angular,
      acceleration: 0.25,
    })).catch((error) => setNotice(error.message))
    clearCommandTimer()
    publish()
    commandTimerRef.current = window.setInterval(publish, 250)
  }

  const save = () => run('save', async () => {
    if (!saveForm.name.trim()) throw new Error('请填写地图名称')
    await stopVehicle()
    const result = await fetchJson(`/api/business/rooms/${roomId}/mapping/save`, jsonRequest('POST', {
      vehicle_id: vehicleId,
      name: saveForm.name.trim(),
      description: saveForm.description.trim() || null,
    }))
    await loadPage()
    setSelectedMapId(result.map.id)
    setSaveForm({ name: '', description: '' })
    setNotice(`地图 ${result.map.name} 已保存为V${result.map.version}`)
  })

  const discard = () => run('discard', async () => {
    if (!window.confirm('确认放弃本次未保存的地图？车辆会立即保持停止。')) return
    await stopVehicle()
    const status = await fetchJson(`/api/business/rooms/${roomId}/mapping/discard`, jsonRequest('POST', { vehicle_id: vehicleId }))
    setMapping(status)
    setNotice('本次建图已放弃')
  })

  const importCurrent = () => run('import', async () => {
    const name = window.prompt('请输入当前车端导航地图在本电房中的名称', '现有导航地图')
    if (!name?.trim()) return
    const result = await fetchJson(`/api/business/rooms/${roomId}/maps/import-current`, jsonRequest('POST', {
      vehicle_id: vehicleId,
      name: name.trim(),
    }))
    await loadPage()
    setSelectedMapId(result.map.id)
    setNotice(result.imported === false ? '当前车端地图已经在版本库中' : '当前车端导航地图已导入版本库')
  })

  const activate = () => run('activate', async () => {
    if (!selectedMap || !window.confirm(`确认让 ${selectedMap.vehicleId} 切换到“${selectedMap.name}”？当前导航会被取消。`)) return
    await fetchJson(`/api/vehicle/stop?vehicle_id=${encodeURIComponent(selectedMap.vehicleId)}`, { method: 'POST' }).catch(() => {})
    setVehicleId(selectedMap.vehicleId)
    await fetchJson(`/api/business/maps/${selectedMap.id}/activate`, jsonRequest('POST', { vehicle_id: selectedMap.vehicleId }))
    await loadPage()
    setNotice('导航地图已切换，请在地图上设置车辆初始位姿')
  })

  const publishPose = () => run('pose', async () => {
    if (!activeMap || !poseDraft) throw new Error('请先点击当前地图选择车辆位置')
    await fetchJson(`/api/business/maps/${activeMap.id}/initial-pose`, jsonRequest('POST', {
      vehicle_id: vehicleId,
      ...poseDraft,
      yaw: poseYaw,
    }))
    setNotice(`初始位姿已发布：(${poseDraft.x.toFixed(2)}, ${poseDraft.y.toFixed(2)})`)
  })

  const liveImage = mapping?.map?.available ? `/api/business/rooms/${roomId}/mapping/live.png?vehicle_id=${encodeURIComponent(vehicleId)}&revision=${imageRevision}` : ''
  const activeMapMetadata = activeMap ? { available: true, width: activeMap.width, height: activeMap.height, resolution: activeMap.resolution, origin: activeMap.origin } : null

  return (
    <section className="room-map-page">
      <header className="room-map-header"><div><button type="button" onClick={() => navigate('/devices')}>← 返回设备管理</button><span>POWER ROOM / SLAM MAPS</span><h1>{room?.name || '电房地图管理'}</h1></div><div className="room-map-mode"><i className={isMapping ? 'active' : ''} /><span>车辆 {vehicleId || '--'}</span><strong>{modeLabel(mapping?.mode)}</strong></div></header>
      {notice ? <div className="room-map-notice">{notice}<button type="button" onClick={() => setNotice('')}>×</button></div> : null}
      <div className="room-map-layout">
        <aside className="room-map-panel room-map-library"><div className="room-map-panel-title"><div><span>MAP LIBRARY</span><h2>地图版本库</h2></div><b>{maps.length} 个版本</b></div><div className="room-map-list">{maps.map((item) => <button type="button" key={item.id} className={selectedMap?.id === item.id ? 'selected' : ''} onClick={() => setSelectedMapId(item.id)}><img src={item.previewUrl} alt="" /><div><strong>{item.name}</strong><span>{item.mapCode}</span><small>V{item.version} · {formatDate(item.createdAt)}</small></div>{item.active ? <em>当前</em> : null}</button>)}{maps.length === 0 ? <div className="room-map-empty-list">尚无平台地图，可导入车端现有地图或开始一次新建图</div> : null}</div>{maps.length === 0 ? <button type="button" className="room-map-import" disabled={!selectedVehicle?.online || busy} onClick={importCurrent}>导入当前车端导航地图</button> : null}{selectedMap ? <div className="room-map-version-detail"><dl><div><dt>分辨率</dt><dd>{selectedMap.resolution || '--'} m/px</dd></div><div><dt>尺寸</dt><dd>{selectedMap.width || '--'} × {selectedMap.height || '--'}</dd></div><div><dt>建图车辆</dt><dd>{selectedMap.vehicleId}</dd></div><div><dt>原点</dt><dd>{selectedMap.origin?.slice(0, 2).map((value) => Number(value).toFixed(2)).join(', ')}</dd></div></dl><button type="button" disabled={selectedMap.active || busy} onClick={activate}>{selectedMap.active ? '当前导航地图' : '设为导航地图'}</button></div> : null}</aside>

        <main className="room-map-panel room-map-workspace"><div className="room-map-panel-title"><div><span>LIVE MAPPING</span><h2>实时雷达建图</h2></div><label>执行机器人<select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name || vehicle.id} · {vehicle.online ? '在线' : '离线'}</option>)}</select></label></div><div className="room-map-live"><MapCanvas src={liveImage} metadata={mapping?.map} pose={mapping?.pose} /><div className="room-map-telemetry"><span>雷达<b>{mapping?.lidar_age == null ? '--' : `${mapping.lidar_age.toFixed(1)}s`}</b></span><span>里程计<b>{mapping?.odom_age == null ? '--' : `${mapping.odom_age.toFixed(1)}s`}</b></span><span>地图尺寸<b>{mapping?.map?.available ? `${mapping.map.width}×${mapping.map.height}` : '--'}</b></span><span>建图时长<b>{mapping?.elapsed_seconds == null ? '--' : `${Math.round(mapping.elapsed_seconds)}s`}</b></span></div></div><div className="room-map-actions"><button type="button" className="primary" disabled={!selectedVehicle?.online || busy || isMapping} onClick={start}>开始新地图</button><button type="button" disabled={!isMapping || busy} onClick={stopVehicle}>停车并保持建图</button><button type="button" className="danger" disabled={!isMapping || busy} onClick={discard}>放弃本次地图</button></div><div className="room-map-save"><input value={saveForm.name} onChange={(event) => setSaveForm((current) => ({ ...current, name: event.target.value }))} placeholder="地图名称，例如：实验楼一层完整图" /><input value={saveForm.description} onChange={(event) => setSaveForm((current) => ({ ...current, description: event.target.value }))} placeholder="版本说明（可选）" /><button type="button" disabled={!isMapping || busy} onClick={save}>{busy === 'save' ? '保存中…' : '保存地图版本'}</button></div></main>

        <aside className="room-map-panel room-map-control"><div className="room-map-panel-title"><div><span>SAFE CONTROL</span><h2>建图遥控</h2></div><b>低速模式</b></div><div className="room-map-dpad">{directions.map((direction) => <button key={direction.id} type="button" className={direction.id} disabled={!isMapping} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); beginDirection(direction) }} onPointerUp={clearCommand} onPointerCancel={clearCommand} onPointerLeave={clearCommand}><b>{direction.symbol}</b><span>{direction.label}</span></button>)}<button type="button" className="stop" onClick={clearCommand}>STOP</button></div><p>按住方向键持续发送低速命令，松开立即停车。切换页面或断开操作后，车端超时保护也会自动归零。</p><div className="room-map-safety"><span>线速度上限 <b>0.12 m/s</b></span><span>角速度上限 <b>0.25 rad/s</b></span></div></aside>
      </div>

      <section className="room-map-panel room-map-localization"><div className="room-map-panel-title"><div><span>LOCALIZATION</span><h2>导航地图与初始位姿</h2></div><b>{activeMap ? `${activeMap.name} · V${activeMap.version}` : '尚未启用地图'}</b></div><div className="room-map-localization-grid"><MapCanvas src={activeMap?.previewUrl} metadata={activeMapMetadata} pose={mapping?.pose} interactive={Boolean(activeMap)} yaw={poseYaw} onPose={setPoseDraft} /><div className="room-map-pose-form"><p>切换地图后，在左侧地图点击车辆所在位置，再填写车头方向并发布。该操作只更新AMCL定位，不会驱动车辆。</p><label>地图X<input type="number" step="0.01" value={poseDraft?.x ?? ''} onChange={(event) => setPoseDraft((current) => ({ ...(current || {}), x: Number(event.target.value), y: current?.y || 0, yaw: poseYaw }))} /></label><label>地图Y<input type="number" step="0.01" value={poseDraft?.y ?? ''} onChange={(event) => setPoseDraft((current) => ({ ...(current || {}), y: Number(event.target.value), x: current?.x || 0, yaw: poseYaw }))} /></label><label>车头Yaw（rad）<input type="number" min={-3.142} max={3.142} step="0.01" value={poseYaw} onChange={(event) => setPoseYaw(Number(event.target.value))} /></label><button type="button" disabled={!activeMap || !poseDraft || busy} onClick={publishPose}>发布初始位姿</button></div></div></section>
    </section>
  )
}
