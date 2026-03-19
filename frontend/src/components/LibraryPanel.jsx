import { useState, useEffect } from 'react'
import { getStrategyLibrary, deleteFromLibrary } from '../api'

const MONO = "'JetBrains Mono', monospace"
const DM = "'DM Sans', sans-serif"

export default function LibraryPanel({ onSelectStrategy }) {
  const [strategies, setStrategies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchLibrary = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getStrategyLibrary()
      setStrategies(data.strategies || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLibrary()
  }, [])

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this saved strategy?")) return
    try {
      await deleteFromLibrary(id)
      await fetchLibrary()
    } catch (err) {
      alert(err.message)
    }
  }

  if (loading) {
    return <div style={{ padding: 20, color: '#9ca3af', fontFamily: MONO, fontSize: 12 }}>Loading library...</div>
  }

  if (error) {
    return <div style={{ padding: 20, color: '#ef4444', fontFamily: MONO, fontSize: 12 }}>Error: {error}</div>
  }

  return (
    <div style={S.container}>
      <div style={S.header}>
        <div style={S.title}>Strategy Library</div>
        <button onClick={fetchLibrary} style={S.refreshBtn}>↻ Refresh</button>
      </div>
      
      {strategies.length === 0 ? (
        <div style={S.empty}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📚</div>
          No saved strategies found. Save one from the Strategy tab!
        </div>
      ) : (
        <div style={S.grid}>
          {strategies.map(s => (
            <div key={s.id} style={S.card}>
              <div style={S.cardHeader}>
                <div style={S.cardTitle}>{s.name}</div>
                <div style={S.cardDate}>{new Date(s.created_at).toLocaleDateString()}</div>
              </div>
              <div style={S.cardDesc}>
                {s.description || "No description provided."}
              </div>
              
              <div style={S.tags}>
                {JSON.parse(s.tags || '[]').map(t => (
                  <span key={t} style={S.tag}>{t}</span>
                ))}
              </div>

              <div style={S.cardActions}>
                <button onClick={() => onSelectStrategy(s)} style={S.btnLoad}>Load / Fork</button>
                <button onClick={() => handleDelete(s.id)} style={S.btnDelete}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const S = {
  container: { padding: 24, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  title: { fontSize: 20, fontWeight: 600, fontFamily: DM, color: '#f3f4f6' },
  refreshBtn: { 
    background: 'transparent', border: '1px solid #1f2937', color: '#9ca3af', padding: '6px 12px',
    borderRadius: 6, cursor: 'pointer', fontFamily: MONO, fontSize: 11
  },
  empty: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    flex: 1, color: '#6b7280', fontFamily: DM, fontSize: 14
  },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16
  },
  card: {
    background: '#0d0e12', border: '1px solid #1f2937', borderRadius: 8, padding: 16,
    display: 'flex', flexDirection: 'column',
  },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: 600, color: '#e5e7eb', fontFamily: DM },
  cardDate: { fontSize: 10, color: '#4b5563', fontFamily: MONO },
  cardDesc: { fontSize: 12, color: '#9ca3af', fontFamily: DM, marginBottom: 16, flex: 1, minHeight: 40 },
  tags: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 },
  tag: { 
    background: '#111827', color: '#60a5fa', border: '1px solid #1e3a8a', 
    fontSize: 10, fontFamily: MONO, padding: '2px 6px', borderRadius: 4 
  },
  cardActions: { display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 12, borderTop: '1px solid #1a1d25' },
  btnLoad: {
    flex: 1, background: '#1e3a8a', color: '#60a5fa', border: 'none',
    padding: '8px', borderRadius: 4, fontFamily: MONO, fontSize: 11, cursor: 'pointer', fontWeight: 600
  },
  btnDelete: {
    background: 'transparent', color: '#ef4444', border: '1px solid #7f1d1d',
    padding: '8px 12px', borderRadius: 4, fontFamily: MONO, fontSize: 11, cursor: 'pointer'
  }
}
