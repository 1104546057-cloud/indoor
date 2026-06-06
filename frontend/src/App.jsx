import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import MainLayout from './layouts/MainLayout'
import ClusterControl from './pages/ClusterControl'
import ClusterManagement from './pages/ClusterManagement'
import Dashboard from './pages/Dashboard'
import DeviceControl from './pages/DeviceControl'
import DeviceManagement from './pages/DeviceManagement'
import Login from './pages/Login'
import UserManagement from './pages/UserManagement'

function App() {
  return (
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
        <Route path="cluster" element={<ClusterManagement />} />
        <Route path="cluster-control" element={<ClusterControl />} />
      </Route>

      {/* 未匹配路径回到登录页。 */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

export default App
