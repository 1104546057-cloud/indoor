import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { clearUser, getStoredUser, hasRuntimeLogin } from '../utils/auth'

function ProtectedRoute({ children }) {
  const [authState, setAuthState] = useState('checking')
  const user = getStoredUser()

  useEffect(() => {
    let ignore = false

    async function verifySession() {
      if (!user?.token || !hasRuntimeLogin()) {
        clearUser()
        if (!ignore) setAuthState('guest')
        return
      }

      try {
        const response = await fetch('/api/auth/me', { credentials: 'include' })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        if (!ignore) setAuthState('authed')
      } catch {
        clearUser()
        if (!ignore) setAuthState('guest')
      }
    }

    verifySession()

    return () => {
      ignore = true
    }
  }, [user?.token])

  if (authState === 'checking') {
    return null
  }

  if (authState === 'guest') {
    return <Navigate to="/login" replace />
  }

  return children
}

export default ProtectedRoute
