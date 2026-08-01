import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import MainLayout from './layouts/MainLayout'
import Login from './pages/Login'

const ClusterControl = lazy(() => import('./pages/ClusterControl'))
const ClusterManagement = lazy(() => import('./pages/ClusterManagement'))
const Dashboard = lazy(() => import('./pages/SchoolFleetDashboard'))
const DeviceControl = lazy(() => import('./pages/DeviceControl'))
const DeviceManagement = lazy(() => import('./pages/DeviceManagement'))
const PatrolExecution3D = lazy(() => import('./pages/PatrolExecution3D'))
const UserManagement = lazy(() => import('./pages/UserManagement'))

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
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="devices" element={<DeviceManagement />} />
        <Route path="device-control" element={<DeviceControl />} />
        <Route path="patrol-3d" element={<PatrolExecution3D />} />
        <Route path="cluster" element={<ClusterManagement />} />
        <Route path="cluster-control" element={<ClusterControl />} />
      </Route>

      {/* 未匹配路径回到登录页。 */}
      <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App
