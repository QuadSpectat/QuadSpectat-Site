import { useState, useEffect, useCallback } from 'react'
import { listModels, deleteModel } from '@/lib/api'
import type { Model } from '@/lib/api'

interface UseModelsResult {
  models: Model[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  remove: (id: string) => Promise<void>
}

export function useModels(): UseModelsResult {
  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setModels(await listModels())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load models')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const remove = useCallback(async (id: string) => {
    await deleteModel(id)
    setModels((prev) => prev.filter((m) => m.id !== id))
  }, [])

  return { models, loading, error, refresh, remove }
}
