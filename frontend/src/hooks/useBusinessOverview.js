import { useCallback, useEffect, useState } from 'react'
import { emptyBusinessOverview, fetchJson } from '../api/business'

export default function useBusinessOverview({ pollMs = 0, includeVehicles = false } = {}) {
  const [business, setBusiness] = useState(emptyBusinessOverview)
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const requests = [fetchJson('/api/business/overview')]
      if (includeVehicles) requests.push(fetchJson('/api/vehicles'))
      const [overview, vehicleData] = await Promise.all(requests)
      setBusiness(overview)
      if (includeVehicles) setVehicles(vehicleData.vehicles || [])
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [includeVehicles])

  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    if (!pollMs) return undefined
    const timer = window.setInterval(() => reload(true), pollMs)
    return () => window.clearInterval(timer)
  }, [pollMs, reload])

  return { business, vehicles, loading, error, reload }
}
