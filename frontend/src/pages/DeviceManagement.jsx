/* eslint-disable react/prop-types */
import { useMemo, useState } from 'react'
import { fetchJson } from '../api/business'
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

const typeLabels = { value: '数值仪表', lamp: '指示灯', handle: '手柄状态' }

function StatusBadge({ value }) {
  return <span className={`dm-status status-${value}`}>{value}</span>
}

function DeviceManagement() {
  const [activeCategory, setActiveCategory] = useState('overview')
  const [selectedId, setSelectedId] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const { business, vehicles, loading, error, reload } = useBusinessOverview({ pollMs: 8000, includeVehicles: true })

  const rows = useMemo(() => {
    const vehicleRows = vehicles.map((vehicle) => ({
      id: `vehicle-${vehicle.id}`,
      sourceId: vehicle.id,
      name: vehicle.name || vehicle.id,
      type: '巡检机器人',
      category: 'robot',
      area: vehicle.ssh_host || vehicle.host || '现场网络',
      status: vehicle.online ? '在线' : '离线',
      last: vehicle.status || '--',
      battery: vehicle.battery,
      voltage: vehicle.voltage,
      raw: vehicle,
    }))
    const cabinetRows = business.cabinets.map((cabinet) => ({
      id: `cabinet-${cabinet.id}`,
      sourceId: cabinet.id,
      name: cabinet.name,
      type: '电柜',
      category: 'cabinet',
      area: business.rooms.find((room) => room.id === cabinet.roomId)?.name || '--',
      status: cabinet.active ? '正常' : '停用',
      last: `${business.deviceItems.filter((item) => item.cabinetId === cabinet.id).length} 个对象`,
      raw: cabinet,
    }))
    const itemRows = business.deviceItems.map((item) => ({
      id: `item-${item.id}`,
      sourceId: item.id,
      name: item.name,
      type: typeLabels[item.itemType] || item.itemType,
      category: 'item',
      area: business.cabinets.find((cabinet) => cabinet.id === item.cabinetId)?.name || '--',
      status: item.threshold ? '已配置' : '待配置',
      last: item.itemCode,
      raw: item,
    }))
    return [...vehicleRows, ...cabinetRows, ...itemRows]
  }, [business.cabinets, business.deviceItems, business.rooms, vehicles])

  const visibleRows = activeCategory === 'robot' ? rows.filter((row) => row.category === 'robot') : rows
  const selected = rows.find((row) => row.id === selectedId) || visibleRows[0] || rows[0]
  const openAlarms = business.alarms.filter((alarm) => alarm.status !== '已关闭')
  const boundCabinets = new Set(business.points.map((point) => point.cabinetId).filter(Boolean)).size
  const bindingRate = business.cabinets.length ? Math.round((boundCabinets / business.cabinets.length) * 100) : 0
  const stats = [
    { label: '资产与对象', value: rows.length, unit: '项', meta: `${business.rooms.length} 个电房`, tone: 'cyan', icon: 'EQ' },
    { label: '在线机器人', value: vehicles.filter((vehicle) => vehicle.online).length, unit: '台', meta: `共 ${vehicles.length} 台`, tone: 'green', icon: 'ON' },
    { label: '未闭环告警', value: openAlarms.length, unit: '条', meta: '来自阈值规则', tone: 'red', icon: 'AL' },
    { label: '正式巡检点', value: business.points.length, unit: '个', meta: `${business.routes.length} 条路线`, tone: 'amber', icon: 'PT' },
    { label: '电柜绑定率', value: bindingRate, unit: '%', meta: `${boundCabinets}/${business.cabinets.length}`, tone: 'blue', icon: 'BD' },
  ]
  const resourceView = ['room', 'cabinet', 'item', 'threshold'].includes(activeCategory)

  const initializeStandardResources = async () => {
    try {
      await fetchJson('/api/business/seed', { method: 'POST' })
      await reload(true)
      setActionNotice('标准电房、电柜、监测对象、阈值、巡检点和路线已校准')
    } catch (requestError) {
      setActionNotice(requestError.message)
    }
  }

  return (
    <section className="device-console-page">
      <aside className="device-sidebar">
        <div className="sidebar-title"><strong>设备管理</strong><span>ASSET & DEVICE MANAGEMENT</span></div>
        <nav className="device-category-nav" aria-label="设备与基础资源分类">{categories.map((item) => <button key={item.id} type="button" className={activeCategory === item.id ? 'active' : ''} onClick={() => setActiveCategory(item.id)}><i>{item.icon}</i><span>{item.label}</span></button>)}</nav>
        <button type="button" className="device-seed-button" onClick={initializeStandardResources}>校准标准资源</button>
      </aside>

      <main className="device-main">
        <section className="device-stat-grid">{stats.map((card) => <article className={`device-stat-card tone-${card.tone}`} key={card.label}><i>{card.icon}</i><div><span>{card.label}</span><strong>{card.value}<em>{card.unit}</em></strong><small>{card.meta}</small></div></article>)}</section>

        {error ? <div className="business-notice danger">{error}</div> : null}
        {actionNotice ? <div className="business-notice">{actionNotice}<button type="button" onClick={() => setActionNotice('')}>×</button></div> : null}
        {loading ? <div className="business-module-loading">正在读取统一业务数据库和车辆注册表…</div> : resourceView ? (
          <BusinessResourceManager view={activeCategory} business={business} onSaved={() => reload(true)} />
        ) : (
          <>
            <div className="device-workbench">
              <section className="dm-panel device-list-panel">
                <div className="dm-panel-heading"><h2>{activeCategory === 'robot' ? '真实车辆注册表' : '设备与业务资产'}</h2><button type="button" onClick={() => reload()}>刷新</button></div>
                <div className="device-table">
                  <div className="device-row device-head"><span>名称</span><span>类型</span><span>所属区域 / 地址</span><span>状态</span><span>业务信息</span><span>操作</span></div>
                  <div className="device-table-body">{visibleRows.length === 0 ? <div className="business-empty">当前分类没有真实数据</div> : visibleRows.map((row) => <button key={row.id} type="button" className={`device-row${selected?.id === row.id ? ' selected' : ''}`} onClick={() => setSelectedId(row.id)}><strong><i />{row.name}</strong><span>{row.type}</span><span>{row.area}</span><StatusBadge value={row.status} /><span>{row.last}</span><b>查看</b></button>)}</div>
                </div>
              </section>

              <section className="dm-panel device-detail-panel">
                <div className="dm-panel-heading compact"><h2>真实档案详情</h2></div>
                {selected ? <>
                  <div className="device-detail-hero">
                    <div className={`device-visual ${selected.category === 'robot' ? 'visual-robot' : 'visual-cabinet'}`}><span className="visual-body" /><span className="visual-shadow" /></div>
                    <div className="device-detail-copy"><div className="detail-title-line"><strong>{selected.name}</strong><StatusBadge value={selected.status} /></div><dl><div><dt>类型</dt><dd>{selected.type}</dd></div><div><dt>业务编号</dt><dd>{selected.raw.robotCode || selected.raw.cabinetCode || selected.raw.itemCode || selected.sourceId}</dd></div><div><dt>区域 / 地址</dt><dd>{selected.area}</dd></div><div><dt>适配方式</dt><dd>{selected.category === 'robot' ? '真实车辆 agent' : 'MySQL 主数据'}</dd></div></dl></div>
                    <div className="device-runtime"><dl><div><dt>在线状态</dt><dd>{selected.status}</dd></div><div><dt>电压</dt><dd>{selected.voltage ?? '--'}{selected.voltage != null ? ' V' : ''}</dd></div><div><dt>电量</dt><dd>{selected.battery ?? '--'}{selected.battery != null ? '%' : ''}</dd></div><div><dt>关联巡检点</dt><dd>{selected.category === 'cabinet' ? business.points.filter((point) => point.cabinetId === selected.sourceId).length : '--'}</dd></div></dl></div>
                  </div>
                  <div className="bound-points"><h3>关联业务资源</h3><div>{business.points.filter((point) => selected.category !== 'cabinet' || point.cabinetId === selected.sourceId).slice(0, 6).map((point) => <article key={point.id}><i>PT</i><strong>{point.name}</strong><span>{point.pointCode}</span></article>)}{business.points.length === 0 ? <span>尚未配置巡检点</span> : null}</div></div>
                </> : <div className="business-empty">尚未配置车辆或资产</div>}
              </section>
            </div>

            <div className="device-bottom-grid">
              <section className="dm-panel maintenance-panel"><div className="dm-panel-heading compact"><h2>最近巡检记录</h2></div><div className="mini-table">{business.records.slice(0, 4).map((record) => <div className="mini-row" key={record.id}><span>{record.startedAt || '--'}</span><strong>{record.taskId || record.recordCode}</strong><span>{record.status}</span><span>进度 {record.progress}%</span><StatusBadge value={record.failureReason ? '异常' : '正常'} /><span>{record.pointTotal} 点</span></div>)}{business.records.length === 0 ? <div className="business-empty">尚无实车巡检记录</div> : null}</div></section>
              <section className="dm-panel alarm-panel"><div className="dm-panel-heading compact"><h2>设备告警</h2></div><div className="mini-table alarm-table">{openAlarms.slice(0, 4).map((alarm) => <div className="mini-row" key={alarm.id}><span>{alarm.createdAt || '--'}</span><strong>{alarm.title}</strong><span>{alarm.severity}</span><span>{alarm.description}</span><StatusBadge value={alarm.status} /></div>)}{openAlarms.length === 0 ? <div className="business-empty">当前没有未闭环告警</div> : null}</div></section>
            </div>
          </>
        )}
      </main>
    </section>
  )
}

export default DeviceManagement
