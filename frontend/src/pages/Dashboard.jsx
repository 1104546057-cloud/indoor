import '../styles/Dashboard.css'

function Dashboard() {
  return (
    <section className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>数据看板</h1>
        </div>
      </header>

      {/* 当前是看板占位数据，后续会替换为后端统计接口返回的真实数据。 */}
      <section className="dashboard-grid">
        <article className="metric-card">
          <span>在线车辆</span>
          <strong>0</strong>
        </article>
        <article className="metric-card">
          <span>巡检任务</span>
          <strong>0</strong>
        </article>
        <article className="metric-card">
          <span>告警信息</span>
          <strong>0</strong>
        </article>
      </section>
    </section>
  )
}

export default Dashboard
