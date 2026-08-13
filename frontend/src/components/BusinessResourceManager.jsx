/* eslint-disable react/prop-types */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchJson, jsonRequest } from '../api/business'

const typeLabels = {
  value: '数值仪表',
  lamp: '指示灯',
  handle: '手柄状态',
  switch: '开关状态',
  temperature: '温度识别',
  text: '文字识别',
}
const cameraRoleLabels = { movement: '行驶主摄像头', high: '高位摄像头', middle: '中位摄像头', low: '低位摄像头', ptz: '云台摄像头' }
const resourceLabels = { room: '电房', cabinet: '电柜', item: '监测对象', threshold: '阈值规则' }
const endpointNames = { room: 'rooms', cabinet: 'cabinets', item: 'device-items', threshold: 'threshold-rules' }
const PAGE_SIZE = 8

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('无法读取图片'))
    reader.readAsDataURL(file)
  })
}

function ImageUploadField({ label, value, onChange }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const upload = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('图片不能超过 5 MB')
      return
    }
    setError('')
    setUploading(true)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const result = await fetchJson('/api/business/assets/image', jsonRequest('POST', { filename: file.name, data_url: dataUrl }))
      onChange(result.fileUrl)
    } catch (uploadError) {
      setError(uploadError.message || '图片上传失败')
    } finally {
      setUploading(false)
    }
  }
  return (
    <label className="business-upload-field">
      <span>{label}</span>
      <div><input value={value || ''} onChange={(event) => onChange(event.target.value)} placeholder="图片地址或上传本地图片" /><b>{uploading ? '上传中…' : '上传'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} disabled={uploading} /></b></div>
      {error ? <small className="business-upload-error">{error}</small> : null}
    </label>
  )
}

function RoiEditor({ imageUrl, roi, onChange }) {
  const hostRef = useRef(null)
  const [start, setStart] = useState(null)
  const coordinate = (event) => {
    const rect = hostRef.current.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)),
    }
  }
  const finish = (event) => {
    if (!start) return
    const end = coordinate(event)
    const next = {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    }
    setStart(null)
    if (next.width >= 1 && next.height >= 1) onChange(next)
  }
  return (
    <div className="roi-editor">
      <div className="roi-editor-head"><strong>识别区域 ROI</strong><span>{imageUrl ? '在图片上按住鼠标拖出识别框' : '请先上传参考图片'}</span>{roi ? <button type="button" onClick={() => onChange(null)}>清除</button> : null}</div>
      <div ref={hostRef} className={`roi-canvas${imageUrl ? ' ready' : ''}`} onPointerDown={(event) => imageUrl && setStart(coordinate(event))} onPointerUp={finish}>
        {imageUrl ? <img src={imageUrl} alt="监测对象参考" draggable="false" /> : <span>REFERENCE IMAGE</span>}
        {roi ? <i style={{ left: `${roi.x}%`, top: `${roi.y}%`, width: `${roi.width}%`, height: `${roi.height}%` }} /> : null}
      </div>
      {roi ? <small>X {roi.x.toFixed(1)}% · Y {roi.y.toFixed(1)}% · 宽 {roi.width.toFixed(1)}% · 高 {roi.height.toFixed(1)}%</small> : null}
    </div>
  )
}

function emptyForm(view) {
  if (view === 'item') return { itemType: 'value', recognitionType: 'meter', cameraRole: 'high', active: true }
  if (view === 'threshold') return { severity: '一般', active: true }
  return { active: true }
}

function formFromResource(view, resource) {
  if (!resource) return emptyForm(view)
  if (view === 'room') return { code: resource.roomCode, name: resource.name, location: resource.location || '', floorPlanUrl: resource.floorPlanUrl || '', description: resource.description || '', active: resource.active !== false }
  if (view === 'cabinet') return { code: resource.cabinetCode, name: resource.name, roomId: String(resource.roomId), typeId: resource.cabinetTypeId ? String(resource.cabinetTypeId) : '', x: resource.locationX ?? '', y: resource.locationY ?? '', photoUrl: resource.photoUrl || '', description: resource.description || '', active: resource.active !== false }
  if (view === 'item') {
    const values = resource.roi || []
    const roi = values.every((value) => value != null) ? { x: values[0], y: values[1], width: values[2], height: values[3] } : null
    return { code: resource.itemCode, name: resource.name, cabinetId: String(resource.cabinetId), itemType: resource.itemType, unit: resource.unit || '', expectedState: resource.expectedState || '', recognitionType: resource.recognitionType || '', cameraRole: resource.cameraRole || 'high', referenceImageUrl: resource.referenceImageUrl || '', pointId: resource.inspectionPointId ? String(resource.inspectionPointId) : '', roi, active: resource.active !== false }
  }
  return { itemId: String(resource.itemId), ruleName: resource.ruleName, warningMin: resource.warningMin ?? '', warningMax: resource.warningMax ?? '', alarmMin: resource.alarmMin ?? '', alarmMax: resource.alarmMax ?? '', expectedState: resource.expectedState || '', severity: resource.severity || '一般', active: resource.active !== false }
}

function makePayload(view, form) {
  const optionalNumber = (value) => value === '' || value == null ? null : Number(value)
  if (view === 'room') return { room_code: form.code?.trim(), name: form.name?.trim(), location: form.location || null, floor_plan_url: form.floorPlanUrl || null, description: form.description || null, is_active: form.active !== false }
  if (view === 'cabinet') return { cabinet_code: form.code?.trim(), name: form.name?.trim(), room_id: Number(form.roomId), cabinet_type_id: form.typeId ? Number(form.typeId) : null, location_x: optionalNumber(form.x), location_y: optionalNumber(form.y), photo_url: form.photoUrl || null, description: form.description || null, is_active: form.active !== false }
  if (view === 'item') return { item_code: form.code?.trim(), name: form.name?.trim(), cabinet_id: Number(form.cabinetId), item_type: form.itemType, unit: form.itemType === 'value' ? form.unit || null : null, expected_state: form.itemType === 'value' ? null : form.expectedState || null, recognition_type: form.recognitionType || null, camera_role: form.cameraRole || null, reference_image_url: form.referenceImageUrl || null, inspection_point_id: form.pointId ? Number(form.pointId) : null, roi_x: form.roi?.x ?? null, roi_y: form.roi?.y ?? null, roi_width: form.roi?.width ?? null, roi_height: form.roi?.height ?? null, is_active: form.active !== false }
  return { item_id: Number(form.itemId), rule_name: form.ruleName?.trim(), warning_min: optionalNumber(form.warningMin), warning_max: optionalNumber(form.warningMax), alarm_min: optionalNumber(form.alarmMin), alarm_max: optionalNumber(form.alarmMax), expected_state: form.expectedState || null, severity: form.severity, is_active: form.active !== false }
}

function ResourceFields({ view, form, setForm, business }) {
  const update = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }))
  if (view === 'room') return <><div className="business-form-row"><label>业务编码<input required value={form.code || ''} onChange={update('code')} /></label><label>名称<input required value={form.name || ''} onChange={update('name')} /></label></div><label>位置说明<input value={form.location || ''} onChange={update('location')} /></label><ImageUploadField label="二维平面图" value={form.floorPlanUrl} onChange={(value) => setForm((current) => ({ ...current, floorPlanUrl: value }))} /><label>说明<textarea value={form.description || ''} onChange={update('description')} /></label></>
  if (view === 'cabinet') return <><div className="business-form-row"><label>业务编码<input required value={form.code || ''} onChange={update('code')} /></label><label>名称<input required value={form.name || ''} onChange={update('name')} /></label></div><label>所属电房<select required value={form.roomId || ''} onChange={update('roomId')}><option value="">请选择</option>{business.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label><label>电柜类型<select value={form.typeId || ''} onChange={update('typeId')}><option value="">未指定</option>{business.cabinetTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label><div className="business-form-row"><label>平面 X (%)<input type="number" min="0" max="100" value={form.x ?? ''} onChange={update('x')} /></label><label>平面 Y (%)<input type="number" min="0" max="100" value={form.y ?? ''} onChange={update('y')} /></label></div><ImageUploadField label="电柜参考图片" value={form.photoUrl} onChange={(value) => setForm((current) => ({ ...current, photoUrl: value }))} /><label>说明<textarea value={form.description || ''} onChange={update('description')} /></label></>
  if (view === 'item') {
    const cabinet = business.cabinets.find((entry) => String(entry.id) === String(form.cabinetId))
    const points = business.points.filter((point) => !cabinet || (point.roomId === cabinet.roomId && (!point.cabinetId || point.cabinetId === cabinet.id)))
    return <><div className="business-form-row"><label>业务编码<input required value={form.code || ''} onChange={update('code')} /></label><label>名称<input required value={form.name || ''} onChange={update('name')} /></label></div><label>所属电柜<select required value={form.cabinetId || ''} onChange={update('cabinetId')}><option value="">请选择</option>{business.cabinets.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><div className="business-form-row"><label>对象类型<select value={form.itemType || 'value'} onChange={update('itemType')}>{Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>识别类型<input value={form.recognitionType || ''} onChange={update('recognitionType')} placeholder="例如 meter / lamp" /></label></div><div className="business-form-row"><label>摄像头角色<select value={form.cameraRole || ''} onChange={update('cameraRole')}><option value="">未指定</option>{Object.entries(cameraRoleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>绑定巡检点<select value={form.pointId || ''} onChange={update('pointId')}><option value="">暂不绑定</option>{points.map((point) => <option value={point.id} key={point.id}>{point.name}</option>)}</select></label></div>{form.itemType === 'value' ? <label>单位<input value={form.unit || ''} onChange={update('unit')} /></label> : <label>期望状态<input value={form.expectedState || ''} onChange={update('expectedState')} /></label>}<ImageUploadField label="识别参考图片" value={form.referenceImageUrl} onChange={(value) => setForm((current) => ({ ...current, referenceImageUrl: value }))} /><RoiEditor imageUrl={form.referenceImageUrl} roi={form.roi} onChange={(roi) => setForm((current) => ({ ...current, roi }))} /></>
  }
  const selectedItem = business.deviceItems.find((item) => String(item.id) === String(form.itemId))
  return <><label>监测对象<select required value={form.itemId || ''} onChange={update('itemId')}><option value="">请选择</option>{business.deviceItems.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.itemCode}</option>)}</select></label><div className="business-form-row"><label>规则名称<input required value={form.ruleName || ''} onChange={update('ruleName')} /></label><label>告警等级<select value={form.severity || '一般'} onChange={update('severity')}>{['提示', '一般', '重要', '紧急'].map((value) => <option key={value}>{value}</option>)}</select></label></div>{selectedItem?.itemType === 'value' || !selectedItem ? <div className="business-form-row four"><label>预警下限<input type="number" step="0.01" value={form.warningMin ?? ''} onChange={update('warningMin')} /></label><label>预警上限<input type="number" step="0.01" value={form.warningMax ?? ''} onChange={update('warningMax')} /></label><label>告警下限<input type="number" step="0.01" value={form.alarmMin ?? ''} onChange={update('alarmMin')} /></label><label>告警上限<input type="number" step="0.01" value={form.alarmMax ?? ''} onChange={update('alarmMax')} /></label></div> : <label>期望状态<input value={form.expectedState || ''} onChange={update('expectedState')} /></label>}</>
}

export default function BusinessResourceManager({ view, business, onSaved }) {
  const navigate = useNavigate()
  const resources = useMemo(() => view === 'room' ? business.rooms : view === 'cabinet' ? business.cabinets : view === 'item' ? business.deviceItems : business.thresholdRules || [], [business, view])
  const [selectedId, setSelectedId] = useState(null)
  const [mode, setMode] = useState('view')
  const [form, setForm] = useState(emptyForm(view))
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const first = resources[0]
    setSelectedId(first?.id ?? null)
    setMode('view')
    setForm(formFromResource(view, first))
    setQuery('')
    setStatusFilter('all')
    setPage(1)
    setMessage('')
  }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = resources.find((resource) => resource.id === selectedId) || null
  const rows = useMemo(() => resources.map((resource) => {
    if (view === 'room') return { resource, code: resource.roomCode, name: resource.name, meta: resource.location || '未配置位置', detail: `${business.cabinets.filter((item) => item.roomId === resource.id).length} 个电柜`, active: resource.active !== false }
    if (view === 'cabinet') return { resource, code: resource.cabinetCode, name: resource.name, meta: business.rooms.find((room) => room.id === resource.roomId)?.name || '--', detail: `${business.deviceItems.filter((item) => item.cabinetId === resource.id).length} 个监测对象`, active: resource.active !== false }
    if (view === 'item') return { resource, code: resource.itemCode, name: resource.name, meta: `${typeLabels[resource.itemType] || resource.itemType} · ${cameraRoleLabels[resource.cameraRole] || '未指定摄像头'}`, detail: resource.inspectionPointId ? business.points.find((point) => point.id === resource.inspectionPointId)?.name || '巡检点已绑定' : '未绑定巡检点', active: resource.active !== false }
    const item = business.deviceItems.find((entry) => entry.id === resource.itemId)
    return { resource, code: `RULE-${String(resource.id).padStart(3, '0')}`, name: resource.ruleName, meta: item?.name || '未知监测对象', detail: resource.expectedState ? `期望 ${resource.expectedState}` : `预警 ${resource.warningMin ?? '--'}～${resource.warningMax ?? '--'} / 告警 ${resource.alarmMin ?? '--'}～${resource.alarmMax ?? '--'}`, active: resource.active !== false }
  }), [business, resources, view])
  const filtered = rows.filter((row) => {
    const keyword = query.trim().toLowerCase()
    const matchesQuery = !keyword || `${row.code} ${row.name} ${row.meta}`.toLowerCase().includes(keyword)
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? row.active : !row.active)
    return matchesQuery && matchesStatus
  })
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice((Math.min(page, pageCount) - 1) * PAGE_SIZE, Math.min(page, pageCount) * PAGE_SIZE)

  const select = (resource) => { setSelectedId(resource.id); setMode('view'); setForm(formFromResource(view, resource)); setMessage('') }
  const beginCreate = () => { setSelectedId(null); setMode('create'); setForm(emptyForm(view)); setMessage('') }
  const beginEdit = () => { if (selected) { setMode('edit'); setForm(formFromResource(view, selected)); setMessage('') } }
  const openMapManagement = () => {
    if (selected) {
      navigate(`/devices/rooms/${selected.id}/maps`)
      return
    }
    setSelectedId(null)
    setMode('create')
    setForm(emptyForm(view))
    setMessage('请先新增电房档案，保存后即可进入地图管理。')
  }
  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const endpoint = `/api/business/${endpointNames[view]}${mode === 'edit' ? `/${selected.id}` : ''}`
      await fetchJson(endpoint, jsonRequest(mode === 'edit' ? 'PUT' : 'POST', makePayload(view, form)))
      setMessage(`${resourceLabels[view]}已保存`)
      await onSaved()
      setMode('view')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }
  const remove = async (hard) => {
    if (!selected) return
    const prompt = hard ? `确认永久删除“${selected.name || selected.ruleName}”？有关联数据时后端会拒绝。` : `确认停用“${selected.name || selected.ruleName}”？历史数据会保留。`
    if (!window.confirm(prompt)) return
    try {
      await fetchJson(`/api/business/${endpointNames[view]}/${selected.id}?hard=${hard}`, { method: 'DELETE' })
      setMessage(hard ? '资源已删除' : '资源已停用')
      await onSaved()
      setSelectedId(null)
      setMode('view')
    } catch (error) {
      setMessage(error.message)
    }
  }

  return (
    <div className="business-resource-manager">
      <div className="business-resource-toolbar">
        <div className="business-resource-heading"><strong>{resourceLabels[view]}档案</strong><span>共 {resources.length} 项</span></div>
        <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="搜索编码、名称或所属资源" />
        <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }}><option value="all">全部状态</option><option value="active">启用</option><option value="inactive">停用</option></select>
        <div className="business-toolbar-actions">{view === 'room' ? <button type="button" className="map-entry" onClick={openMapManagement}>地图管理</button> : null}<button type="button" className="business-primary" onClick={beginCreate}>＋ 新增{resourceLabels[view]}</button></div>
      </div>
      <div className="business-resource-grid enhanced">
        <section className="business-resource-list"><div className="business-master-list">{pageRows.length ? pageRows.map((row) => <button type="button" className={`business-master-row${selected?.id === row.resource.id ? ' selected' : ''}`} key={row.resource.id} onClick={() => select(row.resource)}><span>{row.code}</span><div><strong>{row.name}</strong><small>{row.meta}</small><p>{row.detail}</p></div><em className={row.active ? 'active' : 'inactive'}>{row.active ? '启用' : '停用'}</em></button>) : <div className="business-empty">没有符合条件的数据</div>}</div><div className="business-pagination"><span>第 {Math.min(page, pageCount)} / {pageCount} 页</span><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>下一页</button></div></section>
        <form className="business-resource-form enhanced" onSubmit={submit}><div className="business-panel-title"><div><span>{mode === 'view' ? 'RESOURCE DETAIL' : 'MASTER DATA EDITOR'}</span><h2>{mode === 'create' ? `新增${resourceLabels[view]}` : mode === 'edit' ? `编辑${resourceLabels[view]}` : selected ? selected.name || selected.ruleName : `请选择${resourceLabels[view]}`}</h2></div>{selected && mode === 'view' ? <div className="resource-actions">{view === 'room' ? <button type="button" className="map-entry" onClick={() => navigate(`/devices/rooms/${selected.id}/maps`)}>地图管理</button> : null}<button type="button" onClick={beginEdit}>编辑</button><button type="button" onClick={() => remove(false)}>停用</button><button type="button" className="danger" onClick={() => remove(true)}>删除</button></div> : null}</div>{mode === 'view' ? selected ? <div className="resource-readonly"><fieldset disabled><ResourceFields view={view} form={form} setForm={() => {}} business={business} /></fieldset>{selected.active === false ? <b className="resource-disabled-notice">该资源当前已停用，可通过“编辑”重新启用</b> : null}</div> : <div className="business-empty">请选择左侧资源，或新建一项</div> : <><ResourceFields view={view} form={form} setForm={setForm} business={business} /><label className="resource-active-switch"><input type="checkbox" checked={form.active !== false} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} />保存后启用该资源</label><div className="resource-form-actions"><button type="button" onClick={() => { setMode('view'); setForm(formFromResource(view, selected)) }}>取消</button><button className="business-primary" disabled={saving}>{saving ? '保存中…' : '保存到数据库'}</button></div></>}{message ? <p className="business-form-message">{message}</p> : null}</form>
      </div>
    </div>
  )
}
