/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchJson, jsonRequest } from '../api/business'
import '../styles/UserManagement.css'
import '../styles/BusinessModules.css'

const permissionRows = ['室内巡检监控', '设备与资源管理', '巡检任务管理', 'AI识别复核', '告警闭环', '系统用户管理']
const roleLabels = { admin: '系统管理员', operator: '运维员', viewer: '访客' }

function Badge({ value }) {
  return <span className={`um-badge badge-${value}`}>{value}</span>
}

function SwitchCell({ active = true }) {
  return <span className={`permission-switch${active ? ' on' : ''}`} />
}

function UserManagement() {
  const [users, setUsers] = useState([])
  const [logs, setLogs] = useState([])
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ role: 'operator' })

  const loadSystemData = useCallback(async () => {
    setLoading(true)
    try {
      const [userData, logData] = await Promise.all([
        fetchJson('/api/system/users'),
        fetchJson('/api/system/logs?limit=100'),
      ])
      setUsers(userData.users || [])
      setLogs(logData.logs || [])
      setSelectedUserId((current) => current || userData.users?.[0]?.id || null)
      setNotice('')
    } catch (requestError) {
      setNotice(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadSystemData() }, [loadSystemData])

  const selectedUser = users.find((user) => user.id === selectedUserId) || users[0]
  const roleGroups = useMemo(() => Object.entries(roleLabels).map(([role, label]) => ({ role, label, count: users.filter((user) => user.role === role).length })), [users])
  const activeCount = users.filter((user) => user.isActive).length

  const createUser = async (event) => {
    event.preventDefault()
    try {
      await fetchJson('/api/system/users', jsonRequest('POST', form))
      setForm({ role: 'operator' })
      setShowCreate(false)
      await loadSystemData()
      setNotice('用户已创建并写入系统数据库')
    } catch (requestError) {
      setNotice(requestError.message)
    }
  }

  const toggleUser = async (user) => {
    try {
      await fetchJson(`/api/system/users/${user.id}`, jsonRequest('PATCH', { is_active: !user.isActive }))
      await loadSystemData()
      setNotice(`${user.nickname || user.username} 已${user.isActive ? '禁用' : '启用'}`)
    } catch (requestError) {
      setNotice(requestError.message)
    }
  }

  return (
    <section className="user-console-page">
      <header className="user-hero">
        <div className="user-title"><span>SYSTEM USER CENTER</span><h1>系统用户管理</h1><p>账号、角色、状态和审计日志均来自统一数据库。</p></div>
        <div className="user-kpis"><article><i>US</i><span>系统用户</span><strong>{users.length}<em>人</em></strong><small>真实账号总数</small></article><article><i>ON</i><span>启用账号</span><strong>{activeCount}<em>人</em></strong><small>可登录平台</small></article></div>
        <div className="user-actions"><button type="button" className="primary" onClick={() => setShowCreate((value) => !value)}>+ 新增用户</button><button type="button" onClick={loadSystemData}>刷新数据</button></div>
      </header>

      {notice ? <div className={`business-notice${notice.includes('失败') || notice.includes('仅') ? ' danger' : ''}`}>{notice}<button type="button" onClick={() => setNotice('')}>×</button></div> : null}
      {showCreate ? <form className="system-user-create" onSubmit={createUser}><label>用户名<input required value={form.username || ''} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} /></label><label>显示名称<input required value={form.nickname || ''} onChange={(event) => setForm((current) => ({ ...current, nickname: event.target.value }))} /></label><label>初始密码<input required type="password" value={form.password || ''} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} /></label><label>角色<select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}>{Object.entries(roleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><button className="business-primary">创建账号</button></form> : null}

      <div className="user-workbench">
        <aside className="um-panel org-panel"><div className="org-tabs"><button type="button" className="active">角色分组</button></div><div className="org-search">来自 users.role 字段</div><div className="org-tree">{roleGroups.map((group) => <section key={group.role}><div className="org-node"><span>›</span><strong>{group.label}</strong><b>{group.count}</b></div></section>)}</div></aside>

        <main className="um-panel user-list-panel"><div className="um-heading"><h2>真实用户账号</h2><span>{loading ? '读取中…' : `${users.length} 个账号`}</span></div><div className="user-table"><div className="user-row user-head"><span>用户姓名</span><span>账号</span><span>角色</span><span>来源</span><span>账号状态</span><span>创建时间</span><span>更新时间</span><span>操作</span></div><div className="user-table-body">{users.map((user) => <button type="button" className={`user-row${selectedUser?.id === user.id ? ' selected' : ''}`} key={user.id} onClick={() => setSelectedUserId(user.id)}><strong><i>{(user.nickname || user.username).slice(0, 1)}</i>{user.nickname || user.username}</strong><span>{user.username}</span><Badge value={roleLabels[user.role] || user.role} /><span>MySQL</span><Badge value={user.isActive ? '启用' : '禁用'} /><span>{user.createdAt || '--'}</span><span>{user.updatedAt || '--'}</span><b>查看</b></button>)}</div></div></main>

        <aside className="um-panel user-detail-panel"><div className="um-heading compact"><h2>账号与权限详情</h2></div>{selectedUser ? <><div className="account-profile"><div className="avatar-face">{(selectedUser.nickname || selectedUser.username).slice(0, 1)}</div><div><div className="profile-name"><strong>{selectedUser.nickname || selectedUser.username}</strong><Badge value={roleLabels[selectedUser.role] || selectedUser.role} /></div><p>账号：{selectedUser.username}</p><p>数据表：users</p></div><dl><div><dt>创建时间</dt><dd>{selectedUser.createdAt || '--'}</dd></div><div><dt>账号状态</dt><dd>{selectedUser.isActive ? '启用' : '禁用'}</dd></div></dl></div><div className="detail-tabs"><button type="button" className="active">角色权限</button><button type="button" onClick={() => toggleUser(selectedUser)}>{selectedUser.isActive ? '禁用账号' : '启用账号'}</button></div><div className="permission-matrix"><div className="permission-row permission-head"><span>功能权限</span><span>查看</span><span>新增</span><span>编辑</span><span>删除</span></div>{permissionRows.map((row, index) => { const admin = selectedUser.role === 'admin'; const operator = selectedUser.role === 'operator'; return <div className="permission-row" key={row}><strong>{row}</strong><SwitchCell active /><SwitchCell active={admin || (operator && index < 5)} /><SwitchCell active={admin || (operator && index < 5)} /><SwitchCell active={admin} /></div> })}</div></> : <div className="business-empty">暂无用户</div>}</aside>
      </div>

      <div className="user-bottom-grid">
        <section className="um-panel audit-panel"><div className="um-heading compact"><h2>真实操作审计日志</h2><span>tb_system_log</span></div><div className="audit-table">{logs.length === 0 ? <div className="business-empty">暂无操作日志</div> : logs.map((log) => <div className="audit-row" key={log.id}><span>{log.createdAt || '--'}</span><strong>{log.username}</strong><span>{log.module}</span><span>{log.action} · {log.content || '--'}</span><span>{log.ipAddress || '--'}</span><Badge value={log.result} /></div>)}</div></section>
        <section className="um-panel security-panel"><div className="um-heading compact"><h2>账号安全状态</h2></div><div className="security-content"><div className="security-shield"><span>LOCK</span></div><div className="security-list">{users.filter((user) => !user.isActive).length === 0 ? <article className="security-event level-blue"><i /><div><strong>账号状态正常</strong><p>当前没有被禁用的系统账号</p></div><time>实时</time></article> : users.filter((user) => !user.isActive).map((user) => <article className="security-event level-red" key={user.id}><i /><div><strong>账号已禁用</strong><p>{user.username} 当前无法登录系统</p></div><time>数据库</time></article>)}</div></div></section>
      </div>
    </section>
  )
}

export default UserManagement
