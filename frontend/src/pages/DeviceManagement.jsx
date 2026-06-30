import { useMemo, useState } from 'react'
import '../styles/DeviceManagement.css'

const categories = [
  { id: 'overview', label: '设备总览', icon: 'SYS' },
  { id: 'robot', label: '巡检机器人', icon: 'BOT' },
  { id: 'asset', label: '电房资产', icon: 'CAB' },
  { id: 'sensor', label: '传感设备', icon: 'SNS' },
  { id: 'charge', label: '充电设施', icon: 'CHG' },
  { id: 'maintenance', label: '维护记录', icon: 'MNT' },
  { id: 'archive', label: '设备档案', icon: 'ARC' },
]

const stats = [
  { label: '设备总数', value: '36', unit: '台', delta: '较昨日 +12%', tone: 'cyan', icon: 'EQ' },
  { label: '在线设备', value: '28', unit: '台', delta: '较昨日 +8%', tone: 'green', icon: 'ON' },
  { label: '异常设备', value: '3', unit: '台', delta: '较昨日 -25%', tone: 'red', icon: 'AL' },
  { label: '待维护设备', value: '2', unit: '台', delta: '较昨日 -33%', tone: 'amber', icon: 'FX' },
  { label: '巡检点绑定率', value: '92', unit: '%', delta: '较昨日 +5%', tone: 'blue', icon: '92' },
]

const devices = [
  { id: 'robot-nano1', name: '巡检车 nano1', type: '巡检机器人', category: 'robot', area: 'A区电房', status: '在线', last: '10:42', battery: 82 },
  { id: 'robot-nano2', name: '巡检车 nano2', type: '巡检机器人', category: 'robot', area: 'B区电房', status: '在线', last: '11:15', battery: 78 },
  { id: 'cabinet-1', name: '低压配电柜1号', type: '配电柜', category: 'asset', area: 'A区电房', status: '正常', last: '10:45', battery: null },
  { id: 'cabinet-2', name: '低压配电柜2号', type: '配电柜', category: 'asset', area: 'A区电房', status: '异常', last: '10:48', battery: null },
  { id: 'transformer-1', name: '变压器1号', type: '变压器', category: 'asset', area: '变压器室', status: '正常', last: '09:30', battery: null },
  { id: 'ups-1', name: 'UPS电源柜', type: 'UPS', category: 'asset', area: 'UPS室', status: '正常', last: '09:30', battery: null },
  { id: 'charger-1', name: '充电桩1号', type: '充电设施', category: 'charge', area: '充电区', status: '在线', last: '11:20', battery: null },
  { id: 'sensor-1', name: '温湿度传感器1', type: '传感器', category: 'sensor', area: '低压室', status: '异常', last: '11:22', battery: null },
]

const boundPoints = [
  { name: 'A1 通道', count: '8个点', icon: 'A1' },
  { name: 'A2 机房', count: '6个点', icon: 'A2' },
  { name: 'A3 水泵房', count: '4个点', icon: 'A3' },
]

const maintenanceRows = [
  { time: '2026-06-15 10:30', name: '巡检车 nano1', type: '电池检查', content: '电池健康度检测', state: '已完成', operator: '张工' },
  { time: '2026-06-14 14:20', name: '低压配电柜2号', type: '异常复核', content: '电流偏高复核处理', state: '已完成', operator: '李工' },
  { time: '2026-06-12 09:15', name: '温湿度传感器1', type: '离线处理', content: '通信模块重启', state: '处理中', operator: '王工' },
  { time: '2026-06-10 16:40', name: '充电桩1号', type: '设备巡检', content: '充电模块检查', state: '已完成', operator: '刘工' },
]

const alarmRows = [
  { time: '11:22:48', name: '温湿度传感器1', type: '通信异常', content: '设备通信中断超过5分钟', state: '未处理' },
  { time: '10:48:21', name: '低压配电柜2号', type: '电流偏高', content: '电流超过设定阈值 30A', state: '未处理' },
  { time: '09:35:16', name: '充电桩1号', type: '充电异常', content: '充电连接异常', state: '处理中' },
  { time: '08:20:05', name: '巡检车 nano2', type: '运行异常', content: '激光雷达遮挡', state: '已处理' },
]

function StatusBadge({ value }) {
  return <span className={`dm-status status-${value}`}>{value}</span>
}

function DeviceManagement() {
  const [activeCategory, setActiveCategory] = useState('overview')
  const [selectedId, setSelectedId] = useState('robot-nano1')

  const visibleDevices = useMemo(() => {
    if (activeCategory === 'overview') return devices
    if (activeCategory === 'maintenance' || activeCategory === 'archive') return devices
    return devices.filter((device) => device.category === activeCategory)
  }, [activeCategory])

  const selectedDevice = devices.find((device) => device.id === selectedId) || visibleDevices[0] || devices[0]
  const isRobot = selectedDevice.category === 'robot'

  return (
    <section className="device-console-page">
      <aside className="device-sidebar">
        <div className="sidebar-title">
          <strong>设备管理</strong>
          <span>DEVICE MANAGEMENT</span>
        </div>
        <nav className="device-category-nav" aria-label="设备分类">
          {categories.map((item) => (
            <button
              key={item.id}
              type="button"
              className={activeCategory === item.id ? 'active' : ''}
              onClick={() => setActiveCategory(item.id)}
            >
              <i>{item.icon}</i>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="device-main">
        <section className="device-stat-grid">
          {stats.map((card) => (
            <article className={`device-stat-card tone-${card.tone}`} key={card.label}>
              <i>{card.icon}</i>
              <div>
                <span>{card.label}</span>
                <strong>{card.value}<em>{card.unit}</em></strong>
                <small>{card.delta}</small>
              </div>
            </article>
          ))}
        </section>

        <div className="device-workbench">
          <section className="dm-panel device-list-panel">
            <div className="dm-panel-heading">
              <h2>设备列表</h2>
              <div className="device-filters">
                <input placeholder="搜索设备名称" />
                <select defaultValue="all"><option value="all">设备类型</option></select>
                <select defaultValue="all"><option value="all">设备状态</option></select>
                <select defaultValue="all"><option value="all">所属区域</option></select>
                <button type="button">重置</button>
              </div>
            </div>

            <div className="device-table">
              <div className="device-row device-head">
                <span>设备名称</span>
                <span>设备类型</span>
                <span>所属区域</span>
                <span>状态</span>
                <span>最近巡检</span>
                <span>操作</span>
              </div>
              <div className="device-table-body">
                {visibleDevices.map((device) => (
                  <button
                    key={device.id}
                    type="button"
                    className={`device-row${selectedDevice.id === device.id ? ' selected' : ''}`}
                    onClick={() => setSelectedId(device.id)}
                  >
                    <strong><i />{device.name}</strong>
                    <span>{device.type}</span>
                    <span>{device.area}</span>
                    <StatusBadge value={device.status} />
                    <span>{device.last}</span>
                    <b>查看　编辑　更多</b>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="dm-panel device-detail-panel">
            <div className="dm-panel-heading compact"><h2>设备详情</h2></div>
            <div className="device-detail-hero">
              <div className={`device-visual ${isRobot ? 'visual-robot' : 'visual-cabinet'}`}>
                <span className="visual-body" />
                <span className="visual-shadow" />
              </div>
              <div className="device-detail-copy">
                <div className="detail-title-line">
                  <strong>{selectedDevice.name}</strong>
                  <StatusBadge value={selectedDevice.status} />
                </div>
                <dl>
                  <div><dt>设备类型</dt><dd>{selectedDevice.type}</dd></div>
                  <div><dt>设备编号</dt><dd>{isRobot ? 'ROBOT-0001' : 'ASSET-0108'}</dd></div>
                  <div><dt>所属区域</dt><dd>{selectedDevice.area}</dd></div>
                  <div><dt>IP地址</dt><dd>{isRobot ? '192.168.31.139' : '--'}</dd></div>
                  <div><dt>固件版本</dt><dd>{isRobot ? 'v2.1.6' : 'v1.0.3'}</dd></div>
                  <div><dt>运行时长</dt><dd>{isRobot ? '128 h' : '24 h'}</dd></div>
                </dl>
              </div>
              <div className="device-runtime">
                <dl>
                  <div><dt>电量</dt><dd>{selectedDevice.battery ? `${selectedDevice.battery}%` : '--'}<i><b style={{ width: `${selectedDevice.battery || 68}%` }} /></i></dd></div>
                  <div><dt>运行速度</dt><dd>{isRobot ? '0.6 m/s' : '--'}</dd></div>
                  <div><dt>定位状态</dt><dd>正常</dd></div>
                  <div><dt>相机状态</dt><dd>{isRobot ? '在线' : '--'}</dd></div>
                  <div><dt>LiDAR状态</dt><dd>{isRobot ? '在线' : '--'}</dd></div>
                  <div><dt>通信状态</dt><dd>正常</dd></div>
                </dl>
              </div>
            </div>

            <div className="bound-points">
              <h3>绑定巡检点</h3>
              <div>
                {boundPoints.map((point) => (
                  <article key={point.name}>
                    <i>{point.icon}</i>
                    <strong>{point.name}</strong>
                    <span>{point.count}</span>
                  </article>
                ))}
                <button type="button">+ 绑定巡检点</button>
              </div>
            </div>

            <div className="recent-result">
              <div className="accuracy-ring">
                <strong>98.7%</strong>
                <span>识别准确率</span>
              </div>
              <dl>
                <div><dt>巡检时间</dt><dd>2026-06-17 10:42</dd></div>
                <div><dt>巡检点数</dt><dd>8个</dd></div>
                <div><dt>识别仪表数</dt><dd>24个</dd></div>
              </dl>
              <dl>
                <div><dt>正常</dt><dd className="ok">23个</dd></div>
                <div><dt>异常</dt><dd className="bad">1个</dd></div>
                <div><dt>无法识别</dt><dd>0个</dd></div>
              </dl>
            </div>
          </section>
        </div>

        <div className="device-bottom-grid">
          <section className="dm-panel maintenance-panel">
            <div className="dm-panel-heading compact"><h2>维护记录</h2><button type="button">更多</button></div>
            <div className="mini-table">
              {maintenanceRows.map((row) => (
                <div className="mini-row" key={`${row.time}-${row.name}`}>
                  <span>{row.time}</span>
                  <strong>{row.name}</strong>
                  <span>{row.type}</span>
                  <span>{row.content}</span>
                  <StatusBadge value={row.state} />
                  <span>{row.operator}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="dm-panel alarm-panel">
            <div className="dm-panel-heading compact"><h2>设备告警</h2><button type="button">更多</button></div>
            <div className="mini-table alarm-table">
              {alarmRows.map((row) => (
                <div className="mini-row" key={`${row.time}-${row.name}`}>
                  <span>{row.time}</span>
                  <strong>{row.name}</strong>
                  <span>{row.type}</span>
                  <span>{row.content}</span>
                  <StatusBadge value={row.state} />
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </section>
  )
}

export default DeviceManagement
