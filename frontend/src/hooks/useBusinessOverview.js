import { useCallback, useEffect, useState } from 'react'
import { emptyBusinessOverview, fetchJson } from '../api/business'

export default function useBusinessOverview({ pollMs = 0, includeVehicles = false } = {}) {
  const [business, setBusiness] = useState(emptyBusinessOverview)
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [vehicleError, setVehicleError] = useState('')

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [overviewResult, vehicleResult] = await Promise.allSettled([
        fetchJson('/api/business/overview'),
        includeVehicles ? fetchJson('/api/vehicles') : Promise.resolve({ vehicles: [] }),
      ])
      if (overviewResult.status === 'fulfilled') {
        setBusiness(overviewResult.value)
        setError('')
      } else {
        setError(overviewResult.reason.message)
      }
      if (includeVehicles) {
        if (vehicleResult.status === 'fulfilled') {
          setVehicles(vehicleResult.value.vehicles || [])
          setVehicleError('')
        } else {
          setVehicleError(vehicleResult.reason.message)
        }
      }
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

  return { business, vehicles, loading, error, vehicleError, reload }
}
