import { useMemo, useState } from 'react'
import '../styles/UserManagement.css'

const orgTree = [
  {
    name: '运维中心',
    count: 5,
    children: [
      { name: '电源运维组', count: 3 },
      { name: '巡检人员', count: 2 },
      { name: '值班人员', count: 1 },
    ],
  },
  { name: '设备管理组', count: 2 },
  { name: '系统管理组', count: 2 },
  { name: '测试组', count: 1 },
  { name: '访客组', count: 1 },
  { name: '外部协作单位', count: 2 },
]

const users = [
  { id: 'u1', name: '张工', account: 'zhanggong', role: '系统管理员', dept: '运维中心', online: '在线', lastLogin: '2026-06-17 12:05:32', status: '启用' },
  { id: 'u2', name: '李工', account: 'ligong', role: '运维员', dept: '电源运维组', online: '离线', lastLogin: '2026-06-17 09:30:11', status: '启用' },
  { id: 'u3', name: '王工', account: 'wanggong', role: '设备管理员', dept: '设备管理组', online: '在线', lastLogin: '2026-06-17 11:42:08', status: '启用' },
  { id: 'u4', name: '赵工', account: 'zhaogong', role: '巡检管理员', dept: '运维中心', online: '离线', lastLogin: '2026-06-17 08:55:21', status: '启用' },
  { id: 'u5', name: '刘工', account: 'liugong', role: '运维员', dept: '电源运维组', online: '离线', lastLogin: '2026-06-16 18:20:33', status: '启用' },
  { id: 'u6', name: '测试账号', account: 'test001', role: '访客', dept: '外部协作单位', online: '离线', lastLogin: '2026-06-16 15:45:09', status: '禁用' },
  { id: 'u7', name: '维护账号', account: 'maintain', role: '设备管理员', dept: '设备管理组', online: '在线', lastLogin: '2026-06-17 10:15:44', status: '启用' },
]

const permissionRows = [
  '室内巡检监控',
  '设备管理',
  '巡检任务管理',
  '巡检报告管理',
  '系统用户管理',
  '系统设置',
]

const auditRows = [
  { time: '2026-06-17 12:05:32', user: '张工', type: '登录系统', content: '登录系统成功', ip: '192.168.1.101', result: '成功' },
  { time: '2026-06-17 11:38:14', user: '李工', type: '新增巡检计划', content: '新增巡检计划 A1通道巡检', ip: '192.168.1.102', result: '成功' },
  { time: '2026-06-17 11:42:08', user: '王工', type: '编辑设备', content: '修改巡检车 nano1 参数', ip: '192.168.1.103', result: '成功' },
  { time: '2026-06-17 10:48:21', user: '系统', type: '告警处理', content: '日巡检异常告警已处理', ip: '-', result: '成功' },
  { time: '2026-06-17 09:30:11', user: '李工', type: '导出报告', content: '导出巡检报告 20260617', ip: '192.168.1.102', result: '成功' },
]

const securityEvents = [
  { title: '异常登录尝试', desc: '账号 “test001” 在 2026-06-17 10:15 出现 5 次登录失败', time: '10:15', level: 'red' },
  { title: '账号权限变更', desc: '账号 “liugong” 的角色由“访客”变更为“运维员”', time: '09:22', level: 'amber' },
  { title: '密码强度过低', desc: '账号 “wanggong” 密码存在 7 天未更换', time: '06-16 18:30', level: 'blue' },
]

function Badge({ value }) {
  return <span className={`um-badge badge-${value}`}>{value}</span>
}

function SwitchCell({ active = true }) {
  return <span className={`permission-switch${active ? ' on' : ''}`} />
}

function UserManagement() {
  const [selectedUserId, setSelectedUserId] = useState('u1')
  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) || users[0],
    [selectedUserId],
  )

  return (
    <section className="user-console-page">
      <header className="user-hero">
        <div className="user-title">
          <span>SYSTEM USER CENTER</span>
          <h1>系统用户管理</h1>
          <p>用于维护平台账号、角色权限、登录状态与操作审计。</p>
        </div>
        <div className="user-kpis">
          <article><i>US</i><span>活跃用户</span><strong>3<em>人</em></strong><small>当前在线用户</small></article>
          <article><i>ON</i><span>在线用户</span><strong>1<em>人</em></strong><small>当前在线状态</small></article>
        </div>
        <div className="user-actions">
          <button type="button" className="primary">+ 新增用户</button>
          <button type="button">角色管理</button>
          <button type="button">导出日志</button>
        </div>
      </header>

      <div className="user-workbench">
        <aside className="um-panel org-panel">
          <div className="org-tabs">
            <button type="button" className="active">组织结构</button>
            <button type="button">角色管理</button>
          </div>
          <div className="org-search">搜索部门/角色名称</div>
          <div className="org-tree">
            {orgTree.map((group) => (
              <section key={group.name}>
                <div className="org-node">
                  <span>{group.children ? '▾' : '›'}</span>
                  <strong>{group.name}</strong>
                  <b>{group.count}</b>
                </div>
                {group.children && (
                  <div className="org-children">
                    {group.children.map((child) => (
                      <div className="org-node child active-child" key={child.name}>
                        <span />
                        <strong>{child.name}</strong>
                        <b>{child.count}</b>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </aside>

        <main className="um-panel user-list-panel">
          <div className="um-heading">
            <h2>用户账号列表</h2>
            <div className="user-filters">
              <input placeholder="搜索账号/姓名/编号" />
              <select defaultValue="all"><option value="all">角色类型</option></select>
              <select defaultValue="all"><option value="all">账号状态</option></select>
              <select defaultValue="all"><option value="all">在线状态</option></select>
              <button type="button">重置</button>
            </div>
          </div>
          <div className="user-table">
            <div className="user-row user-head">
              <span>用户姓名</span><span>账号</span><span>角色</span><span>所属部门</span><span>在线状态</span><span>最近登录</span><span>账号状态</span><span>操作</span>
            </div>
            <div className="user-table-body">
              {users.map((user) => (
                <button
                  type="button"
                  className={`user-row${selectedUserId === user.id ? ' selected' : ''}`}
                  key={user.id}
                  onClick={() => setSelectedUserId(user.id)}
                >
                  <strong><i>{user.name.slice(0, 1)}</i>{user.name}</strong>
                  <span>{user.account}</span>
                  <Badge value={user.role} />
                  <span>{user.dept}</span>
                  <Badge value={user.online} />
                  <span>{user.lastLogin}</span>
                  <Badge value={user.status} />
                  <b>查看　编辑　更多</b>
                </button>
              ))}
            </div>
          </div>
        </main>

        <aside className="um-panel user-detail-panel">
          <div className="um-heading compact"><h2>账号详情</h2></div>
          <div className="account-profile">
            <div className="avatar-face">{selectedUser.name.slice(0, 1)}</div>
            <div>
              <div className="profile-name"><strong>{selectedUser.name}</strong><Badge value={selectedUser.role} /></div>
              <p>账号：{selectedUser.account}</p>
              <p>所属部门：{selectedUser.dept}</p>
            </div>
            <dl>
              <div><dt>最近登录</dt><dd>{selectedUser.lastLogin}</dd></div>
              <div><dt>账号状态</dt><dd>{selectedUser.status}</dd></div>
              <div><dt>在线状态</dt><dd>{selectedUser.online}</dd></div>
            </dl>
          </div>
          <div className="detail-tabs">
            <button type="button" className="active">权限配置</button>
            <button type="button">基本信息</button>
            <button type="button">登录记录</button>
            <button type="button">安全设置</button>
          </div>
          <div className="permission-matrix">
            <div className="permission-row permission-head">
              <span>功能权限</span><span>新增</span><span>编辑</span><span>删除</span><span>导出</span>
            </div>
            {permissionRows.map((row, index) => (
              <div className="permission-row" key={row}>
                <strong>{row}</strong>
                <SwitchCell active />
                <SwitchCell active={index < 5} />
                <SwitchCell active={index < 3} />
                <SwitchCell active={index < 5} />
              </div>
            ))}
          </div>
        </aside>
      </div>

      <div className="user-bottom-grid">
        <section className="um-panel audit-panel">
          <div className="um-heading compact"><h2>操作审计日志</h2></div>
          <div className="audit-table">
            {auditRows.map((row) => (
              <div className="audit-row" key={`${row.time}-${row.content}`}>
                <span>{row.time}</span>
                <strong>{row.user}</strong>
                <span>{row.type}</span>
                <span>{row.content}</span>
                <span>{row.ip}</span>
                <Badge value={row.result} />
              </div>
            ))}
          </div>
        </section>

        <section className="um-panel security-panel">
          <div className="um-heading compact"><h2>安全提醒</h2></div>
          <div className="security-content">
            <div className="security-shield"><span>LOCK</span></div>
            <div className="security-list">
              {securityEvents.map((event) => (
                <article className={`security-event level-${event.level}`} key={event.title}>
                  <i />
                  <div><strong>{event.title}</strong><p>{event.desc}</p></div>
                  <time>{event.time}</time>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}

export default UserManagement
