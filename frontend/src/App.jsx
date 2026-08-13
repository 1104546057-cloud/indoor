import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import PermissionGuard from './components/PermissionGuard'
import MainLayout from './layouts/MainLayout'
import Login from './pages/Login'

const ClusterControl = lazy(() => import('./pages/ClusterControl'))
const ClusterManagement = lazy(() => import('./pages/ClusterManagement'))
const Dashboard = lazy(() => import('./pages/SchoolFleetDashboard'))
const DeviceControl = lazy(() => import('./pages/DeviceControl'))
const DeviceManagement = lazy(() => import('./pages/DeviceManagement'))
const PatrolExecution3D = lazy(() => import('./pages/PatrolExecution3D'))
const UserManagement = lazy(() => import('./pages/UserManagement'))
const RoomMapManagement = lazy(() => import('./pages/RoomMapManagement'))

function App() {
  return (
    <Suspense fallback={<div className="route-loading">正在加载业务模块…</div>}>
      <Routes>
      {/* 登录页使用独立布局，不显示后台侧边栏。 */}
      <Route path="/login" element={<Login />} />

      {/* 后台页面统一经过路由守卫，并共用 MainLayout 的侧边栏和内容区。 */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        {/* 访问根路径时自动进入数据看板。 */}
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<PermissionGuard module="patrol_monitor"><Dashboard /></PermissionGuard>} />
        <Route path="users" element={<PermissionGuard module="user_management"><UserManagement /></PermissionGuard>} />
        <Route path="devices" element={<PermissionGuard module="device_resources"><DeviceManagement /></PermissionGuard>} />
        <Route path="devices/rooms/:roomId/maps" element={<PermissionGuard module="device_resources"><RoomMapManagement /></PermissionGuard>} />
        <Route path="device-control" element={<PermissionGuard module="patrol_monitor"><DeviceControl /></PermissionGuard>} />
        <Route path="patrol-3d" element={<PermissionGuard module="patrol_tasks"><PatrolExecution3D /></PermissionGuard>} />
        <Route path="cluster" element={<PermissionGuard module="device_resources"><ClusterManagement /></PermissionGuard>} />
        <Route path="cluster-control" element={<PermissionGuard module="patrol_tasks"><ClusterControl /></PermissionGuard>} />
      </Route>

      {/* 未匹配路径回到登录页。 */}
      <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App
