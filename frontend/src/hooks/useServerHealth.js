// hooks/useServerHealth.js
import { useEffect } from 'react'
import { useStore } from '../store'
import { api } from '../lib/api'

export function useServerHealth() {
  const setServerStatus = useStore(s => s.setServerStatus)

  useEffect(() => {
    let timer

    async function check() {
      try {
        const res = await api.health.ready()
        setServerStatus(res.status === 'ready' ? 'online' : 'degraded')
      } catch {
        setServerStatus('offline')
      }
      timer = setTimeout(check, 15000)
    }

    check()
    return () => clearTimeout(timer)
  }, [])
}
