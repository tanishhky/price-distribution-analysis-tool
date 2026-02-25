import { useState, useRef } from 'react'

const MONO = "'JetBrains Mono', monospace"
const DM = "'DM Sans', sans-serif"

export default function MergePanel() {
    const fileInputRef = useRef(null)
    const [files, setFiles] = useState([])    // { name, data } objects
    const [mergeResult, setMergeResult] = useState(null)
    const [error, setError] = useState(null)

    const handleAddFiles = (fileList) => {
        const readers = Array.from(fileList).map(file => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = (e) => {
                    try {
                        const data = JSON.parse(e.target.result)
                        if (!data.candles) {
                            reject(new Error(`${file.name}: missing candles field`))
                            return
                        }
                        resolve({ name: file.name, data })
                    } catch { reject(new Error(`${file.name}: invalid JSON`)) }
                }
                reader.readAsText(file)
            })
        })
        Promise.allSettled(readers).then(results => {
            const successes = results.filter(r => r.status === 'fulfilled').map(r => r.value)
            const failures = results.filter(r => r.status === 'rejected').map(r => r.reason.message)
            if (failures.length > 0) setError(failures.join('; '))
            setFiles(prev => [...prev, ...successes])
            setMergeResult(null)
        })
    }

    const handleRemoveFile = (idx) => {
        setFiles(prev => prev.filter((_, i) => i !== idx))
        setMergeResult(null)
    }

    const handleMerge = () => {
        if (files.length < 2) {
            setError('Need at least 2 files to merge')
            return
        }
        setError(null)

        // Merge candles by timestamp (dedup)
        const candleMap = new Map()
        files.forEach(f => {
            (f.data.candles || []).forEach(c => {
                if (!candleMap.has(c.timestamp)) {
                    candleMap.set(c.timestamp, c)
                }
            })
        })
        const mergedCandles = Array.from(candleMap.values()).sort((a, b) => a.timestamp - b.timestamp)

        // Merge contracts by ticker (dedup)
        const contractMap = new Map()
        files.forEach(f => {
            (f.data.cached_contracts || []).forEach(c => {
                if (!contractMap.has(c.ticker)) {
                    contractMap.set(c.ticker, c)
                }
            })
        })
        const mergedContracts = Array.from(contractMap.values())

        // Merge bars (dedup by key)
        const mergedBars = {}
        files.forEach(f => {
            const bars = f.data.cached_bars || {}
            Object.keys(bars).forEach(k => {
                if (!mergedBars[k]) mergedBars[k] = bars[k]
            })
        })

        // Build overlap stats
        const totalInputCandles = files.reduce((s, f) => s + (f.data.candles?.length || 0), 0)
        const totalInputContracts = files.reduce((s, f) => s + (f.data.cached_contracts?.length || 0), 0)
        const totalInputBars = files.reduce((s, f) => s + Object.keys(f.data.cached_bars || {}).length, 0)
        const dedupedCandles = totalInputCandles - mergedCandles.length
        const dedupedContracts = totalInputContracts - mergedContracts.length
        const dedupedBars = totalInputBars - Object.keys(mergedBars).length

        // Date range of merged candles
        let startDate = '', endDate = ''
        if (mergedCandles.length > 0) {
            startDate = new Date(mergedCandles[0].timestamp).toISOString().slice(0, 10)
            endDate = new Date(mergedCandles[mergedCandles.length - 1].timestamp).toISOString().slice(0, 10)
        }

        // Use first file's metadata as base
        const base = files[0].data
        const merged = {
            _version: 3,
            ticker: base.ticker || 'MERGED',
            timeframe: base.timeframe || '1day',
            asset_class: base.asset_class || 'stocks',
            start_date: startDate,
            end_date: endDate,
            candles: mergedCandles,
            cached_contracts: mergedContracts,
            cached_bars: mergedBars,
            saved_at: new Date().toISOString(),
        }

        setMergeResult({
            data: merged,
            stats: {
                inputCandles: totalInputCandles, mergedCandles: mergedCandles.length, dedupedCandles,
                inputContracts: totalInputContracts, mergedContracts: mergedContracts.length, dedupedContracts,
                inputBars: totalInputBars, mergedBars: Object.keys(mergedBars).length, dedupedBars,
                startDate, endDate,
            },
        })
    }

    const handleDownloadMerged = () => {
        if (!mergeResult) return
        const blob = new Blob([JSON.stringify(mergeResult.data)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `voledge_${mergeResult.data.ticker}_merged_${mergeResult.data.saved_at.slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
    }

    return (
        <div style={S.container}>
            <div style={S.header}>
                <span style={S.headerIcon}>⊕</span>
                <span style={S.headerTitle}>Cache File Merger</span>
                <span style={S.headerSub}>Combine multiple data exports into one</span>
            </div>

            {/* Drop / Add area */}
            <div
                style={S.dropZone}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
                onDrop={e => { e.preventDefault(); e.stopPropagation(); handleAddFiles(e.dataTransfer.files) }}
            >
                <div style={S.dropIcon}>📁</div>
                <div style={S.dropText}>Click or drag cache files here</div>
                <div style={S.dropHint}>.json files exported with ↓ Save</div>
            </div>
            <input ref={fileInputRef} type="file" accept=".json" multiple style={{ display: 'none' }}
                onChange={e => { handleAddFiles(e.target.files); e.target.value = '' }} />

            {/* File list */}
            {files.length > 0 && (
                <div style={S.fileList}>
                    <div style={S.fileListHeader}>
                        <span>Files ({files.length})</span>
                        <button onClick={() => { setFiles([]); setMergeResult(null) }} style={S.clearBtn}>Clear all</button>
                    </div>
                    {files.map((f, i) => (
                        <div key={i} style={S.fileRow}>
                            <div style={S.fileName}>{f.name}</div>
                            <div style={S.fileMeta}>
                                <span>{f.data.ticker}</span>
                                <span>{f.data.candles?.length || 0} candles</span>
                                <span>{f.data.cached_contracts?.length || 0} contracts</span>
                            </div>
                            <button onClick={() => handleRemoveFile(i)} style={S.removeBtn}>✕</button>
                        </div>
                    ))}
                </div>
            )}

            {/* Actions */}
            {files.length >= 2 && (
                <button onClick={handleMerge} style={S.mergeBtn}>
                    ⊕ Merge {files.length} Files
                </button>
            )}

            {/* Error */}
            {error && (
                <div style={S.errorBox}>{error}</div>
            )}

            {/* Results */}
            {mergeResult && (
                <div style={S.resultBox}>
                    <div style={S.resultHeader}>Merge Complete</div>
                    <table style={S.statsTable}>
                        <thead>
                            <tr>
                                <th style={S.th}></th>
                                <th style={S.th}>Input</th>
                                <th style={S.th}>Merged</th>
                                <th style={S.th}>Deduped</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style={S.td}>Candles</td>
                                <td style={S.td}>{mergeResult.stats.inputCandles}</td>
                                <td style={{ ...S.td, color: '#22c55e' }}>{mergeResult.stats.mergedCandles}</td>
                                <td style={{ ...S.td, color: '#f59e0b' }}>{mergeResult.stats.dedupedCandles}</td>
                            </tr>
                            <tr>
                                <td style={S.td}>Contracts</td>
                                <td style={S.td}>{mergeResult.stats.inputContracts}</td>
                                <td style={{ ...S.td, color: '#22c55e' }}>{mergeResult.stats.mergedContracts}</td>
                                <td style={{ ...S.td, color: '#f59e0b' }}>{mergeResult.stats.dedupedContracts}</td>
                            </tr>
                            <tr>
                                <td style={S.td}>Bars</td>
                                <td style={S.td}>{mergeResult.stats.inputBars}</td>
                                <td style={{ ...S.td, color: '#22c55e' }}>{mergeResult.stats.mergedBars}</td>
                                <td style={{ ...S.td, color: '#f59e0b' }}>{mergeResult.stats.dedupedBars}</td>
                            </tr>
                        </tbody>
                    </table>
                    <div style={S.dateRange}>
                        Date range: {mergeResult.stats.startDate} → {mergeResult.stats.endDate}
                    </div>
                    <button onClick={handleDownloadMerged} style={S.downloadBtn}>
                        ↓ Download Merged ({(JSON.stringify(mergeResult.data).length / 1024).toFixed(0)} KB)
                    </button>
                </div>
            )}
        </div>
    )
}

const S = {
    container: { padding: '24px 32px', maxWidth: 700, margin: '0 auto' },
    header: { marginBottom: 24 },
    headerIcon: { fontSize: 24, color: '#3b82f6', marginRight: 10 },
    headerTitle: { fontSize: 18, fontWeight: 600, color: '#e5e7eb', fontFamily: DM },
    headerSub: { display: 'block', fontSize: 12, color: '#6b7280', fontFamily: MONO, marginTop: 4 },

    dropZone: {
        border: '2px dashed #1e2230', borderRadius: 8, padding: '32px 24px',
        textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.2s',
        background: '#0d0e12',
    },
    dropIcon: { fontSize: 28, marginBottom: 8 },
    dropText: { fontSize: 13, color: '#9ca3af', fontFamily: DM },
    dropHint: { fontSize: 10, color: '#4b5563', fontFamily: MONO, marginTop: 4 },

    fileList: { marginTop: 16, border: '1px solid #1a1d25', borderRadius: 6, overflow: 'hidden' },
    fileListHeader: {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 12px', background: '#111318', fontSize: 11, fontFamily: MONO,
        color: '#9ca3af', borderBottom: '1px solid #1a1d25',
    },
    clearBtn: {
        background: 'none', border: 'none', color: '#ef4444', fontSize: 10,
        fontFamily: MONO, cursor: 'pointer',
    },
    fileRow: {
        display: 'flex', alignItems: 'center', padding: '8px 12px',
        borderBottom: '1px solid #141720', gap: 12,
    },
    fileName: { fontSize: 11, fontFamily: MONO, color: '#e5e7eb', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' },
    fileMeta: {
        display: 'flex', gap: 8, fontSize: 10, fontFamily: MONO, color: '#6b7280',
    },
    removeBtn: {
        background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer',
        fontSize: 12, padding: '2px 4px',
    },

    mergeBtn: {
        marginTop: 16, width: '100%', padding: '10px 0', border: 'none', borderRadius: 6,
        background: 'linear-gradient(135deg, #7c3aed 0%, #3b82f6 100%)', color: '#fff',
        fontSize: 13, fontWeight: 600, fontFamily: MONO, cursor: 'pointer',
        letterSpacing: 0.3,
    },

    errorBox: {
        marginTop: 12, padding: '8px 12px', background: '#1a0a0a', border: '1px solid #7f1d1d',
        borderRadius: 4, fontSize: 11, fontFamily: MONO, color: '#fca5a5',
    },

    resultBox: {
        marginTop: 16, border: '1px solid #1a3a1a', borderRadius: 6,
        background: '#0a1a0a', padding: 16,
    },
    resultHeader: {
        fontSize: 13, fontWeight: 600, color: '#22c55e', fontFamily: MONO, marginBottom: 12,
    },
    statsTable: { width: '100%', borderCollapse: 'collapse', marginBottom: 12 },
    th: {
        fontSize: 10, fontFamily: MONO, color: '#6b7280', textAlign: 'right',
        padding: '4px 8px', borderBottom: '1px solid #1a3a1a',
    },
    td: {
        fontSize: 11, fontFamily: MONO, color: '#9ca3af', textAlign: 'right',
        padding: '4px 8px',
    },
    dateRange: { fontSize: 10, fontFamily: MONO, color: '#6b7280', marginBottom: 12 },
    downloadBtn: {
        width: '100%', padding: '8px 0', border: '1px solid #22c55e', borderRadius: 4,
        background: 'transparent', color: '#22c55e', fontSize: 11, fontFamily: MONO,
        cursor: 'pointer',
    },
}
