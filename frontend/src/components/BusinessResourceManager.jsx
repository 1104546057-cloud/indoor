/* eslint-disable react/prop-types */
import { useMemo, useState } from 'react'
import { fetchJson, jsonRequest } from '../api/business'

const typeLabels = { value: '数值仪表', lamp: '指示灯', handle: '手柄状态' }

function ResourceForm({ view, business, onSaved }) {
  const [form, setForm] = useState({ itemType: 'value' })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const update = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      let path = '/api/business/rooms'
      let payload = { room_code: form.code, name: form.name, location: form.location || null }
      if (view === 'cabinet') {
        path = '/api/business/cabinets'
        payload = {
          cabinet_code: form.code,
          name: form.name,
          room_id: Number(form.roomId),
          cabinet_type_id: form.typeId ? Number(form.typeId) : null,
          location_x: Number(form.x || 10),
          location_y: Number(form.y || 30),
        }
      }
      if (view === 'item' || view === 'threshold') {
        path = '/api/business/device-items'
        payload = {
          item_code: form.code,
          name: form.name,
          cabinet_id: Number(form.cabinetId),
          item_type: form.itemType,
          unit: form.itemType === 'value' ? form.unit || null : null,
          expected_state: form.itemType === 'value' ? null : form.expectedState || null,
          warning_min: form.warningMin ? Number(form.warningMin) : null,
          warning_max: form.warningMax ? Number(form.warningMax) : null,
          alarm_min: form.alarmMin ? Number(form.alarmMin) : null,
          alarm_max: form.alarmMax ? Number(form.alarmMax) : null,
        }
      }
      await fetchJson(path, jsonRequest('POST', payload))
      setForm({ itemType: 'value' })
      setMessage('资源已写入统一业务数据库')
      await onSaved()
    } catch (requestError) {
      setMessage(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  const isItem = view === 'item' || view === 'threshold'
  return (
    <form className="business-resource-form" onSubmit={submit}>
      <div className="business-panel-title"><div><span>MASTER DATA EDITOR</span><h2>新增{view === 'room' ? '电房' : view === 'cabinet' ? '电柜' : '监测对象与规则'}</h2></div></div>
      <div className="business-form-row">
        <label>业务编码<input required value={form.code || ''} onChange={update('code')} /></label>
        <label>名称<input required value={form.name || ''} onChange={update('name')} /></label>
      </div>
      {view === 'room' ? <label>位置说明<input value={form.location || ''} onChange={update('location')} /></label> : null}
      {view === 'cabinet' ? <>
        <label>所属电房<select required value={form.roomId || ''} onChange={update('roomId')}><option value="">请选择</option>{business.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
        <label>电柜类型<select value={form.typeId || ''} onChange={update('typeId')}><option value="">未指定</option>{business.cabinetTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
        <div className="business-form-row"><label>平面 X (%)<input type="number" value={form.x || ''} onChange={update('x')} /></label><label>平面 Y (%)<input type="number" value={form.y || ''} onChange={update('y')} /></label></div>
      </> : null}
      {isItem ? <>
        <label>所属电柜<select required value={form.cabinetId || ''} onChange={update('cabinetId')}><option value="">请选择</option>{business.cabinets.map((cabinet) => <option key={cabinet.id} value={cabinet.id}>{cabinet.name}</option>)}</select></label>
        <div className="business-form-row">
          <label>对象类型<select value={form.itemType} onChange={update('itemType')}>{Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          {form.itemType === 'value' ? <label>单位<input value={form.unit || ''} onChange={update('unit')} /></label> : <label>期望状态<input value={form.expectedState || ''} onChange={update('expectedState')} /></label>}
        </div>
        {form.itemType === 'value' ? <div className="business-form-row four"><label>预警下限<input type="number" step="0.01" value={form.warningMin || ''} onChange={update('warningMin')} /></label><label>预警上限<input type="number" step="0.01" value={form.warningMax || ''} onChange={update('warningMax')} /></label><label>告警下限<input type="number" step="0.01" value={form.alarmMin || ''} onChange={update('alarmMin')} /></label><label>告警上限<input type="number" step="0.01" value={form.alarmMax || ''} onChange={update('alarmMax')} /></label></div> : null}
      </> : null}
      <button className="business-primary" disabled={saving}>{saving ? '保存中…' : '保存到数据库'}</button>
      {message ? <p className="business-form-message">{message}</p> : null}
    </form>
  )
}

export default function BusinessResourceManager({ view, business, onSaved }) {
  const rows = useMemo(() => {
    if (view === 'room') return business.rooms.map((room) => ({ id: room.id, code: room.roomCode, name: room.name, meta: room.location || '未配置位置', detail: `${business.cabinets.filter((item) => item.roomId === room.id).length} 个电柜` }))
    if (view === 'cabinet') return business.cabinets.map((cabinet) => ({ id: cabinet.id, code: cabinet.cabinetCode, name: cabinet.name, meta: business.rooms.find((room) => room.id === cabinet.roomId)?.name || '--', detail: `${business.deviceItems.filter((item) => item.cabinetId === cabinet.id).length} 个监测对象` }))
    return business.deviceItems.map((item) => {
      const threshold = item.threshold
      const detail = item.itemType === 'value'
        ? `预警 ${threshold?.warningMin ?? '--'}～${threshold?.warningMax ?? '--'} / 告警 ${threshold?.alarmMin ?? '--'}～${threshold?.alarmMax ?? '--'} ${item.unit || ''}`
        : `期望状态：${threshold?.expectedState || item.expectedState || '--'}`
      return { id: item.id, code: item.itemCode, name: item.name, meta: typeLabels[item.itemType] || item.itemType, detail }
    })
  }, [business, view])

  return (
    <div className="business-resource-grid">
      <ResourceForm view={view} business={business} onSaved={onSaved} />
      <section className="business-resource-list">
        <div className="business-panel-title"><div><span>DATABASE RECORDS</span><h2>{view === 'room' ? '电房档案' : view === 'cabinet' ? '电柜档案' : '监测对象与阈值'}</h2></div><b>{rows.length} 项</b></div>
        <div className="business-master-list">{rows.map((row) => <article key={row.id}><span>{row.code}</span><div><strong>{row.name}</strong><small>{row.meta}</small><p>{row.detail}</p></div></article>)}</div>
      </section>
    </div>
  )
}
