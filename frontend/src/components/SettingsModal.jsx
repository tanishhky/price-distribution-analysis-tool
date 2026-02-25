import { useState, useEffect, useRef } from 'react'

const MONO = "'JetBrains Mono', monospace"
const DM = "'DM Sans', sans-serif"

const DEFAULTS = {
    // Rate limiting
    batch_size: 5,
    batch_delay: 61,
    // Option expiry ranges
    near_expiry_min_days: 7,
    near_expiry_max_days: 45,
    far_expiry_min_days: 46,
    far_expiry_max_days: 180,
    // Moment evolution
    moment_window_ratio: 5,   // window = max(30, candles / ratio)
    moment_step_ratio: 30,    // step = max(5, candles / ratio)
    // GMM
    max_gmm_components: 10,
}

function loadSettings() {
    try {
        const saved = sessionStorage.getItem('voledge_settings')
        return saved ? { ...DEFAULTS, ...JSON.parse(saved) } : { ...DEFAULTS }
    } catch { return { ...DEFAULTS } }
}

function saveSettings(s) {
    sessionStorage.setItem('voledge_settings', JSON.stringify(s))
}

export function useSettings() {
    const [settings, setSettings] = useState(loadSettings)
    const update = (patch) => {
        setSettings(prev => {
            const next = { ...prev, ...patch }
            saveSettings(next)
            return next
        })
    }
    const reset = () => {
        setSettings({ ...DEFAULTS })
        saveSettings(DEFAULTS)
    }
    return [settings, update, reset]
}

export default function SettingsModal({ open, onClose, settings, onUpdate, onReset }) {
    const ref = useRef(null)

    useEffect(() => {
        if (!open) return
        const handler = (e) => {
            if (ref.current && !ref.current.contains(e.target)) onClose()
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [open, onClose])

    if (!open) return null

    const Field = ({ label, field, min, max, step = 1, unit = '' }) => (
        <div style={S.field}>
            <label style={S.fieldLabel}>{label}</label>
            <div style={S.fieldRow}>
                <input type="number" min={min} max={max} step={step}
                    value={settings[field]}
                    onChange={e => onUpdate({ [field]: Number(e.target.value) || min })}
                    style={S.fieldInput} />
                {unit && <span style={S.unit}>{unit}</span>}
            </div>
        </div>
    )

    return (
        <div ref={ref} style={S.modal}>
            <div style={S.header}>
                <span style={S.headerTitle}>⚙ Settings</span>
                <button onClick={onClose} style={S.closeBtn}>✕</button>
            </div>

            <div style={S.body}>
                <div style={S.group}>
                    <div style={S.groupTitle}>RATE LIMITING</div>
                    <div style={S.groupHint}>Polygon free tier: 5 req/min/key</div>
                    <Field label="Batch size (req/key)" field="batch_size" min={1} max={20} />
                    <Field label="Batch delay" field="batch_delay" min={5} max={120} unit="s" />
                </div>

                <div style={S.group}>
                    <div style={S.groupTitle}>OPTION EXPIRY RANGES</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <Field label="Near min" field="near_expiry_min_days" min={1} max={90} unit="d" />
                        <Field label="Near max" field="near_expiry_max_days" min={7} max={180} unit="d" />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <Field label="Far min" field="far_expiry_min_days" min={7} max={365} unit="d" />
                        <Field label="Far max" field="far_expiry_max_days" min={30} max={730} unit="d" />
                    </div>
                </div>

                <div style={S.group}>
                    <div style={S.groupTitle}>MOMENT EVOLUTION</div>
                    <div style={S.groupHint}>Window = max(30, candles ÷ ratio)</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <Field label="Window ratio" field="moment_window_ratio" min={2} max={20} />
                        <Field label="Step ratio" field="moment_step_ratio" min={5} max={100} />
                    </div>
                </div>

                <div style={S.group}>
                    <div style={S.groupTitle}>GMM PARAMS</div>
                    <Field label="Max N value" field="max_gmm_components" min={5} max={20} />
                </div>

                <button onClick={onReset} style={S.resetBtn}>Reset to defaults</button>
            </div>
        </div>
    )
}

const S = {
    modal: {
        position: 'absolute', top: 40, right: 12, width: 280,
        background: '#0f1014', border: '1px solid #1e2230', borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)', zIndex: 1000,
        overflow: 'hidden',
    },
    header: {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 14px', borderBottom: '1px solid #1a1d25',
    },
    headerTitle: { fontSize: 12, fontWeight: 600, color: '#e5e7eb', fontFamily: MONO },
    closeBtn: {
        background: 'none', border: 'none', color: '#6b7280', fontSize: 12,
        cursor: 'pointer', padding: '2px 4px',
    },
    body: { padding: '10px 14px 14px', maxHeight: 400, overflowY: 'auto' },
    group: { marginBottom: 14 },
    groupTitle: {
        fontSize: 9, fontWeight: 600, color: '#6b7280', letterSpacing: 1.2,
        fontFamily: MONO, marginBottom: 4,
    },
    groupHint: {
        fontSize: 9, color: '#4b5563', fontFamily: MONO, marginBottom: 6,
    },
    field: { marginBottom: 6 },
    fieldLabel: { fontSize: 10, color: '#9ca3af', fontFamily: MONO, display: 'block', marginBottom: 2 },
    fieldRow: { display: 'flex', alignItems: 'center', gap: 4 },
    fieldInput: {
        flex: 1, background: '#151820', border: '1px solid #1e2230',
        borderRadius: 3, color: '#e5e7eb', padding: '4px 6px', fontSize: 11,
        fontFamily: MONO, width: 60,
    },
    unit: { fontSize: 9, color: '#4b5563', fontFamily: MONO, minWidth: 12 },
    resetBtn: {
        width: '100%', background: 'none', border: '1px solid #1e2230',
        borderRadius: 4, color: '#6b7280', padding: '6px 0', fontSize: 10,
        fontFamily: MONO, cursor: 'pointer', marginTop: 4,
    },
}
