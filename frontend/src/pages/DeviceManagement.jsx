/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from 'react'
import { fetchJson, jsonRequest } from '../api/business'
import BusinessResourceManager from '../components/BusinessResourceManager'
import useBusinessOverview from '../hooks/useBusinessOverview'
import '../styles/DeviceManagement.css'
import '../styles/BusinessModules.css'

const categories = [
  { id: 'overview', label: '设备总览', icon: 'SYS' },
  { id: 'robot', label: '巡检机器人', icon: 'BOT' },
  { id: 'room', label: '电房档案', icon: 'ROM' },
  { id: 'cabinet', label: '电柜档案', icon: 'CAB' },
  { id: 'item', label: '监测对象', icon: 'ROI' },
  { id: 'threshold', label: '阈值规则', icon: 'RUL' },
]
const typeLabels = { value: '数值仪表', lamp: '指示灯', handle: '手柄状态', switch: '开关状态', temperature: '温度识别', text: '文字识别' }
const roleLabels = { movement: '行驶主摄像头', high: '高位摄像头', middle: '中位摄像头', low: '低位摄像头', ptz: '云台摄像头' }
const PAGE_SIZE = 7

function statusTone(value) {
  if (['在线', '正常', '已配置', '启用', '已关闭'].includes(value)) return 'success'
  if (['离线', '停用', '异常', '紧急'].includes(value)) return 'danger'
  return 'warning'
}

function StatusBadge({ value }) {
  return <span className={`dm-status tone-${statusTone(value)}`}>{value}</span>
}

function formatTime(value) {
  if (!value) return '--'
  return String(value).replace('T', ' ').slice(0, 19)
}

function vehicleForm(vehicle) {
  const streams = vehicle?.camera_streams || {}
  return {
    robotCode: vehicle?.id || '', name: vehicle?.name || '', agentBaseUrl: vehicle?.agent_base_url || '',
    sshHost: vehicle?.ssh_host || '', sshPort: vehicle?.ssh_port || 22, sshUsername: vehicle?.ssh_username || '',
    sshPassword: '', startScript: vehicle?.start_script || '', active: vehicle?.active !== false,
    movement: streams.movement || '', high: streams.high || '', middle: streams.middle || '', low: streams.low || '', ptz: streams.ptz || '',
  }
}

function VehicleManager({ vehicles, vehicleError, onSaved }) {
  const [selectedId, setSelectedId] = useState(vehicles[0]?.id || '')
  const [mode, setMode] = useState('view')
  const [form, setForm] = useState(vehicleForm(vehicles[0]))
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const selected = vehicles.find((vehicle) => vehicle.id === selectedId) || null
  const filtered = vehicles.filter((vehicle) => {
    const keyword = query.trim().toLowerCase()
    return (!keyword || `${vehicle.id} ${vehicle.name} ${vehicle.ssh_host}`.toLowerCase().includes(keyword)) && (status === 'all' || (status === 'online') === Boolean(vehicle.online))
  })
  useEffect(() => {
    if (!selectedId && vehicles[0]) {
      setSelectedId(vehicles[0].id)
      setForm(vehicleForm(vehicles[0]))
    }
  }, [selectedId, vehicles])
  const update = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }))
  const choose = (vehicle) => { setSelectedId(vehicle.id); setForm(vehicleForm(vehicle)); setMode('view'); setMessage('') }
  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    try {
      const cameraStreams = Object.fromEntries(['movement', 'high', 'middle', 'low', 'ptz'].filter((role) => form[role]).map((role) => [role, form[role]]))
      const payload = { robot_code: form.robotCode.trim(), name: form.name.trim(), agent_base_url: form.agentBaseUrl.trim(), ssh_host: form.sshHost || null, ssh_port: Number(form.sshPort), ssh_username: form.sshUsername || null, ssh_password: form.sshPassword || null, start_script: form.startScript || null, camera_streams: cameraStreams, is_active: form.active !== false }
      const dbId = selected?.db_id
      await fetchJson(`/api/business/robots${mode === 'edit' ? `/${dbId}` : ''}`, jsonRequest(mode === 'edit' ? 'PUT' : 'POST', payload))
      setMessage('车辆档案与连接注册表已同步')
      await onSaved(true)
      setSelectedId(form.robotCode)
      setMode('view')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }
  const remove = async (hard) => {
    if (!selected?.db_id || !window.confirm(hard ? '确认永久删除该车辆？存在任务或记录时将被拒绝。' : '确认停用该车辆？历史记录会保留。')) return
    try {
      await fetchJson(`/api/business/robots/${selected.db_id}?hard=${hard}`, { method: 'DELETE' })
      setMessage(hard ? '车辆已删除' : '车辆已停用')
      setSelectedId('')
      await onSaved(true)
    } catch (error) { setMessage(error.message) }
  }
  return (
    <div className="vehicle-registry-manager">
      <div className="business-resource-toolbar"><div><strong>车辆注册与心跳</strong><span>共 {vehicles.length} 台</span></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索编号、名称或 IP" /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="online">在线</option><option value="offline">离线</option></select><button type="button" onClick={() => onSaved(true)}>刷新心跳</button><button type="button" className="business-primary" onClick={() => { setMode('create'); setSelectedId(''); setForm(vehicleForm()); setMessage('') }}>＋ 注册车辆</button></div>
      {vehicleError ? <div className="business-notice danger">车辆状态暂不可用：{vehicleError}</div> : null}
      <div className="vehicle-registry-grid">
        <section className="dm-panel vehicle-registry-list">{filtered.length ? filtered.map((vehicle) => <button type="button" className={selectedId === vehicle.id ? 'selected' : ''} key={vehicle.id} onClick={() => choose(vehicle)}><i className={vehicle.online ? 'online' : 'offline'} /><div><strong>{vehicle.name}</strong><span>{vehicle.id} · {vehicle.ssh_host || '未配置地址'}</span><small>最后响应 {formatTime(vehicle.last_seen_at || vehicle.checked_at)}</small></div><StatusBadge value={vehicle.online ? '在线' : '离线'} /></button>) : <div className="business-empty">没有符合条件的车辆</div>}</section>
        <form className="dm-panel vehicle-registry-form" onSubmit={submit}><div className="dm-panel-heading"><div><h2>{mode === 'create' ? '注册车辆' : mode === 'edit' ? '编辑车辆' : '车辆档案详情'}</h2><span>注册表与数据库统一维护</span></div>{selected && mode === 'view' ? <div className="resource-actions"><button type="button" onClick={() => setMode('edit')}>编辑</button><button type="button" onClick={() => remove(false)}>停用</button><button type="button" className="danger" onClick={() => remove(true)}>删除</button></div> : null}</div><fieldset disabled={mode === 'view'}><div className="business-form-row"><label>车辆编号<input required value={form.robotCode} onChange={update('robotCode')} disabled={mode === 'edit' || mode === 'view'} /></label><label>车辆名称<input required value={form.name} onChange={update('name')} /></label></div><label>Agent 地址<input required value={form.agentBaseUrl} onChange={update('agentBaseUrl')} placeholder="http://192.168.31.139:9000" /></label><div className="business-form-row three"><label>SSH 主机<input value={form.sshHost} onChange={update('sshHost')} /></label><label>端口<input type="number" value={form.sshPort} onChange={update('sshPort')} /></label><label>用户名<input value={form.sshUsername} onChange={update('sshUsername')} /></label></div>{mode !== 'view' ? <label>SSH 密码<input type="password" value={form.sshPassword} onChange={update('sshPassword')} placeholder={mode === 'edit' ? '留空表示保持原密码' : '仅写入本机注册表'} /></label> : null}<label>启动脚本<input value={form.startScript} onChange={update('startScript')} /></label><h3>摄像头地址</h3><div className="vehicle-camera-fields">{Object.entries(roleLabels).map(([role, label]) => <label key={role}>{label}<input value={form[role]} onChange={update(role)} placeholder="http://车辆IP:端口/" /></label>)}</div><label className="resource-active-switch"><input type="checkbox" checked={form.active !== false} onChange={update('active')} />启用车辆档案</label></fieldset>{mode !== 'view' ? <div className="resource-form-actions"><button type="button" onClick={() => { setMode('view'); setForm(vehicleForm(selected)) }}>取消</button><button className="business-primary" disabled={saving}>{saving ? '保存中…' : '保存车辆'}</button></div> : selected ? <div className="vehicle-heartbeat-detail"><span>电量 <b>{selected.battery ?? '--'}{selected.battery != null ? '%' : ''}</b></span><span>电压 <b>{selected.voltage ?? '--'}{selected.voltage != null ? ' V' : ''}</b></span><span>摄像头 <b>{selected.camera_roles?.length || 0} 路</b></span><span>最后检查 <b>{formatTime(selected.checked_at)}</b></span>{selected.error ? <p>{selected.error}</p> : null}</div> : <div className="business-empty">请选择车辆或注册新车辆</div>}{message ? <p className="business-form-message">{message}</p> : null}</form>
      </div>
    </div>
  )
}

function DeviceManagement() {
  const [activeCategory, setActiveCategory] = useState('overview')
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [actionNotice, setActionNotice] = useState('')
  const { business, vehicles, loading, error, vehicleError, reload } = useBusinessOverview({ pollMs: 8000, includeVehicles: true })

  const rows = useMemo(() => {
    const vehicleRows = vehicles.map((vehicle) => ({ id: `vehicle-${vehicle.id}`, sourceId: vehicle.id, name: vehicle.name || vehicle.id, type: '巡检机器人', category: 'robot', area: vehicle.ssh_host || '未配置地址', status: vehicle.online ? '在线' : '离线', info: vehicle.last_seen_at ? `最后响应 ${formatTime(vehicle.last_seen_at)}` : vehicle.error || '尚未收到心跳', battery: vehicle.battery, voltage: vehicle.voltage, raw: vehicle }))
    const cabinetRows = business.cabinets.map((cabinet) => ({ id: `cabinet-${cabinet.id}`, sourceId: cabinet.id, name: cabinet.name, type: '电柜', category: 'cabinet', area: business.rooms.find((room) => room.id === cabinet.roomId)?.name || '--', status: cabinet.active ? '正常' : '停用', info: `${business.deviceItems.filter((item) => item.cabinetId === cabinet.id).length} 个监测对象`, raw: cabinet }))
    const itemRows = business.deviceItems.map((item) => ({ id: `item-${item.id}`, sourceId: item.id, name: item.name, type: typeLabels[item.itemType] || item.itemType, category: 'item', area: business.cabinets.find((cabinet) => cabinet.id === item.cabinetId)?.name || '--', status: item.active === false ? '停用' : item.threshold ? '已配置' : '待配置', info: item.inspectionPointId ? '已绑定巡检点' : '未绑定巡检点', raw: item }))
    return [...vehicleRows, ...cabinetRows, ...itemRows]
  }, [business.cabinets, business.deviceItems, business.rooms, vehicles])
  useEffect(() => {
    setSelectedId('')
    setQuery('')
    setStatusFilter('all')
    setPage(1)
  }, [activeCategory])
  const filteredRows = rows.filter((row) => {
    const keyword = query.trim().toLowerCase()
    return (!keyword || `${row.name} ${row.type} ${row.area} ${row.sourceId}`.toLowerCase().includes(keyword)) && (statusFilter === 'all' || (statusFilter === 'normal' ? ['在线', '正常', '已配置'].includes(row.status) : !['在线', '正常', '已配置'].includes(row.status)))
  })
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const pageRows = filteredRows.slice((Math.min(page, pageCount) - 1) * PAGE_SIZE, Math.min(page, pageCount) * PAGE_SIZE)
  const selected = rows.find((row) => row.id === selectedId) || pageRows[0] || rows[0]
  const openAlarms = business.alarms.filter((alarm) => alarm.status !== '已关闭')
  const activeCabinets = business.cabinets.filter((cabinet) => cabinet.active !== false)
  const boundCabinets = new Set(business.points.filter((point) => activeCabinets.some((cabinet) => cabinet.id === point.cabinetId)).map((point) => point.cabinetId)).size
  const bindingRate = activeCabinets.length ? Math.round((boundCabinets / activeCabinets.length) * 100) : 0
  const stats = [
    { label: '管理资源', value: business.rooms.length + business.cabinets.length + business.deviceItems.length + vehicles.length, unit: '项', meta: `${business.rooms.length} 个电房`, tone: 'cyan', icon: 'EQ' },
    { label: '在线机器人', value: vehicles.filter((vehicle) => vehicle.online).length, unit: '台', meta: `共 ${vehicles.length} 台`, tone: 'green', icon: 'ON' },
    { label: '未闭环告警', value: openAlarms.length, unit: '条', meta: '来自识别与阈值规则', tone: 'red', icon: 'AL' },
    { label: '启用巡检点', value: business.points.filter((point) => point.active !== false).length, unit: '个', meta: `${business.routes.filter((route) => route.active !== false).length} 条路线`, tone: 'amber', icon: 'PT' },
    { label: '电柜绑定率', value: bindingRate, unit: '%', meta: `${boundCabinets}/${activeCabinets.length}`, tone: 'blue', icon: 'BD' },
  ]
  const resourceView = ['room', 'cabinet', 'item', 'threshold'].includes(activeCategory)
  const selectedItemIds = selected?.category === 'item' ? [selected.sourceId] : selected?.category === 'cabinet' ? business.deviceItems.filter((item) => item.cabinetId === selected.sourceId).map((item) => item.id) : []
  const isSelectedRobotRecord = (record) => record.robotCode === selected?.sourceId || record.robotName === selected?.name || record.robotName === selected?.sourceId
  const contextualAlarms = selected?.category === 'robot' ? openAlarms.filter((alarm) => business.records.some((record) => record.taskId === alarm.taskId && isSelectedRobotRecord(record))) : selectedItemIds.length ? openAlarms.filter((alarm) => selectedItemIds.includes(alarm.itemId)) : openAlarms
  const contextualRecords = selected?.category === 'robot' ? business.records.filter(isSelectedRobotRecord) : selected?.category === 'cabinet' ? business.records.filter((record) => business.images.some((image) => image.recordId === record.id && image.cabinetId === selected.sourceId)) : selected?.category === 'item' ? business.records.filter((record) => business.results.some((result) => result.recordId === record.id && result.itemCode === selected.raw.itemCode)) : business.records
  const associatedPoints = selected?.category === 'cabinet' ? business.points.filter((point) => point.cabinetId === selected.sourceId) : selected?.category === 'item' ? business.points.filter((point) => point.id === selected.raw.inspectionPointId) : selected?.category === 'robot' ? Array.from(new Map(contextualRecords.flatMap((record) => record.routePoints || []).map((point) => [point.id || point.name, point])).values()) : []

  const initializeStandardResources = async () => {
    if (!window.confirm('该操作会补充 A1 标准演示资源，确认继续？')) return
    try { await fetchJson('/api/business/seed', { method: 'POST' }); await reload(true); setActionNotice('标准资源初始化完成') } catch (requestError) { setActionNotice(requestError.message) }
  }

  return (
    <section className="device-console-page">
      <aside className="device-sidebar"><div className="sidebar-title"><strong>设备管理</strong><span>ASSET & DEVICE MANAGEMENT</span></div><nav className="device-category-nav" aria-label="设备与基础资源分类">{categories.map((item) => <button key={item.id} type="button" className={activeCategory === item.id ? 'active' : ''} onClick={() => setActiveCategory(item.id)}><i>{item.icon}</i><span>{item.label}</span></button>)}</nav><button type="button" className="device-seed-button" onClick={initializeStandardResources}>初始化标准资源</button></aside>
      <main className="device-main"><section className="device-stat-grid">{stats.map((card) => <article className={`device-stat-card tone-${card.tone}`} key={card.label}><i>{card.icon}</i><div><span>{card.label}</span><strong>{card.value}<em>{card.unit}</em></strong><small>{card.meta}</small></div></article>)}</section>{error ? <div className="business-notice danger">业务数据库暂不可用：{error}</div> : null}{actionNotice ? <div className="business-notice">{actionNotice}<button type="button" onClick={() => setActionNotice('')}>×</button></div> : null}{loading ? <div className="business-module-loading">正在读取设备档案与车辆心跳…</div> : resourceView ? <BusinessResourceManager view={activeCategory} business={business} onSaved={() => reload(true)} /> : activeCategory === 'robot' ? <VehicleManager vehicles={vehicles} vehicleError={vehicleError} onSaved={async (force) => { if (force) await fetchJson('/api/vehicles?force_refresh=true'); await reload(true) }} /> : <><div className="device-overview-toolbar"><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="搜索设备名称、编号、类型或区域" /><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }}><option value="all">全部状态</option><option value="normal">正常 / 在线</option><option value="abnormal">异常 / 离线 / 待配置</option></select><button type="button" onClick={() => reload()}>刷新</button></div><div className="device-workbench"><section className="dm-panel device-list-panel"><div className="dm-panel-heading"><h2>设备与业务资产</h2><span>{filteredRows.length} 项结果</span></div><div className="device-table"><div className="device-row device-head"><span>名称</span><span>类型</span><span>所属区域 / 地址</span><span>状态</span><span>业务信息</span><span>操作</span></div><div className="device-table-body">{pageRows.length === 0 ? <div className="business-empty">当前条件下没有设备</div> : pageRows.map((row) => <button key={row.id} type="button" className={`device-row${selected?.id === row.id ? ' selected' : ''}`} onClick={() => setSelectedId(row.id)}><strong><i />{row.name}</strong><span>{row.type}</span><span>{row.area}</span><StatusBadge value={row.status} /><span>{row.info}</span><b>详情</b></button>)}</div><div className="business-pagination"><span>第 {Math.min(page, pageCount)} / {pageCount} 页</span><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>下一页</button></div></div></section><section className="dm-panel device-detail-panel"><div className="dm-panel-heading compact"><h2>当前设备详情</h2><StatusBadge value={selected?.status || '--'} /></div>{selected ? <><div className="device-detail-hero"><div className={`device-visual ${selected.category === 'robot' ? 'visual-robot' : 'visual-cabinet'}`}><span className="visual-body" /><span className="visual-shadow" /></div><div className="device-detail-copy"><div className="detail-title-line"><strong>{selected.name}</strong></div><dl><div><dt>类型</dt><dd>{selected.type}</dd></div><div><dt>业务编号</dt><dd>{selected.raw.robotCode || selected.raw.cabinetCode || selected.raw.itemCode || selected.sourceId}</dd></div><div><dt>区域 / 地址</dt><dd>{selected.area}</dd></div><div><dt>数据来源</dt><dd>{selected.category === 'robot' ? '车辆注册表 + 数据库心跳' : 'MySQL 主数据'}</dd></div></dl></div><div className="device-runtime"><dl><div><dt>当前状态</dt><dd>{selected.status}</dd></div><div><dt>电压</dt><dd>{selected.voltage ?? '--'}{selected.voltage != null ? ' V' : ''}</dd></div><div><dt>电量</dt><dd>{selected.battery ?? '--'}{selected.battery != null ? '%' : ''}</dd></div><div><dt>关联巡检点</dt><dd>{associatedPoints.length}</dd></div></dl></div></div><div className="bound-points"><h3>关联巡检点与业务资源</h3><div>{associatedPoints.slice(0, 6).map((point) => <article key={point.id || point.name}><i>PT</i><strong>{point.name}</strong><span>{point.pointCode || point.id || '--'}</span></article>)}{associatedPoints.length === 0 ? <span>当前设备尚未建立直接巡检点关联</span> : null}</div></div></> : <div className="business-empty">尚未配置设备</div>}</section></div><div className="device-bottom-grid"><section className="dm-panel maintenance-panel"><div className="dm-panel-heading compact"><h2>当前设备巡检记录</h2><span>{contextualRecords.length} 条</span></div><div className="mini-table">{contextualRecords.slice(0, 4).map((record) => <div className="mini-row" key={record.id}><span>{formatTime(record.startedAt)}</span><strong>{record.taskName || record.taskId || record.recordCode}</strong><span>{record.status}</span><span>进度 {record.progress}%</span><StatusBadge value={record.failureReason ? '异常' : '正常'} /><span>{record.pointTotal} 点</span></div>)}{contextualRecords.length === 0 ? <div className="business-empty">该设备暂无巡检记录</div> : null}</div></section><section className="dm-panel alarm-panel"><div className="dm-panel-heading compact"><h2>当前设备告警</h2><span>{contextualAlarms.length} 条未闭环</span></div><div className="mini-table alarm-table">{contextualAlarms.slice(0, 4).map((alarm) => <div className="mini-row" key={alarm.id}><span>{formatTime(alarm.createdAt)}</span><strong>{alarm.title}</strong><span>{alarm.severity}</span><span>{alarm.description}</span><StatusBadge value={alarm.status} /></div>)}{contextualAlarms.length === 0 ? <div className="business-empty">当前设备没有未闭环告警</div> : null}</div></section></div></>}</main>
    </section>
  )
}

export default DeviceManagement
