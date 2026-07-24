/* eslint-disable react/prop-types */
import { useState } from 'react'
import { fetchJson, jsonRequest } from '../api/business'
import useBusinessOverview from '../hooks/useBusinessOverview'

const actions = { 待确认: '确认', 已确认: '派单', 处理中: '反馈', 待复核: '关闭' }

export default function AlarmWorkflowPanel({ compact = false }) {
  const { business, loading, error, reload } = useBusinessOverview({ pollMs: 8000 })
  const [busyId, setBusyId] = useState(null)
  const [notice, setNotice] = useState('')
  const openAlarmCount = business.alarms.filter((alarm) => alarm.status !== '已关闭').length
  const isEmpty = !loading && !error && business.alarms.length === 0

  if (compact && isEmpty && !notice) {
    return (
      <section className="alarm-workflow-module compact empty-state" aria-label="告警状态">
        <div className="alarm-clear-state"><span>✓</span><strong>当前无告警</strong><small>系统运行正常</small></div>
      </section>
    )
  }

  const transition = async (alarm) => {
    const action = actions[alarm.status]
    if (!action) return
    setBusyId(alarm.id)
    try {
      await fetchJson(`/api/business/alarms/${alarm.id}/transition`, jsonRequest('POST', {
        action,
        assigned_to: action === '派单' ? '值班工程师' : null,
        remark: `监控中心处置：${action}`,
      }))
      setNotice(`${alarm.alarmCode} 已完成“${action}”`)
      await reload(true)
    } catch (requestError) {
      setNotice(requestError.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className={`alarm-workflow-module${compact ? ' compact' : ''}${isEmpty ? ' empty-state' : ''}`}>
      <div className="business-panel-title"><div><span>ALARM WORKFLOW</span><h2>告警确认、派单、反馈与关闭</h2></div><b>{openAlarmCount} 条待闭环</b></div>
      {notice ? <div className="business-notice">{notice}<button type="button" onClick={() => setNotice('')}>×</button></div> : null}
      {error ? <div className="business-notice danger">{error}</div> : null}
      {loading ? <div className="business-empty">正在读取告警数据库…</div> : business.alarms.length === 0 ? <div className="business-empty">当前没有告警，真实 AI 上报异常后会自动生成。</div> : <div className="business-alarm-list">{business.alarms.map((alarm) => <article id={`alarm-${alarm.id}`} key={alarm.id} tabIndex={-1}><span className={`business-alarm-level level-${alarm.severity}`}>{alarm.severity}</span><div><small>{alarm.alarmCode} · {alarm.createdAt}</small><strong>{alarm.title}</strong><p>{alarm.description}</p><div className="business-alarm-history">{alarm.processes.map((process) => <i key={process.id}>{process.toStatus}</i>)}</div></div><aside><b>{alarm.status}</b>{actions[alarm.status] ? <button type="button" disabled={busyId === alarm.id} onClick={() => transition(alarm)}>{busyId === alarm.id ? '处理中…' : actions[alarm.status]}</button> : <em>流程完成</em>}</aside></article>)}</div>}
    </section>
  )
}
