/* eslint-disable react/prop-types */
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { clearUser, getStoredUser, hasRuntimeLogin, saveUser } from '../utils/auth'

function ProtectedRoute({ children }) {
  const [authState, setAuthState] = useState('checking')
  const user = getStoredUser()
  const userToken = user?.token

  useEffect(() => {
    let ignore = false

    async function verifySession() {
      const sessionUser = getStoredUser()
      if (!sessionUser?.token || !hasRuntimeLogin()) {
        clearUser()
        if (!ignore) setAuthState('guest')
        return
      }

      try {
        const response = await fetch('/api/auth/me', { credentials: 'include' })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const currentUser = await response.json()
        saveUser({ ...sessionUser, ...currentUser, token: sessionUser.token })
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
  }, [userToken])

  if (authState === 'checking') {
    return null
  }

  if (authState === 'guest') {
    return <Navigate to="/login" replace />
  }

  return children
}

export default ProtectedRoute
