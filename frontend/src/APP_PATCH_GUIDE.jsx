/**
 * APP.JSX PATCH — Adds STRATEGY and ANIMATE tabs to VolEdge.
 *
 * Follow these 4 steps to integrate into your existing App.jsx:
 *
 * ════════════════════════════════════════════════════
 *  STEP 1: Add imports (top of file)
 * ════════════════════════════════════════════════════
 */

// ADD these two imports alongside your existing imports:
import StrategyPanel from './components/StrategyPanel'
import EquityAnimator from './components/EquityAnimator'

/**
 * ════════════════════════════════════════════════════
 *  STEP 2: Add state (inside App() function, with the other useState calls)
 * ════════════════════════════════════════════════════
 */

// ADD this line next to your other state declarations:
// const [strategyResult, setStrategyResult] = useState(null)

/**
 * ════════════════════════════════════════════════════
 *  STEP 3: Add tabs to the TABS array
 * ════════════════════════════════════════════════════
 *
 *  Find the TABS array (it looks like this):
 *
 *   const TABS = [
 *     { id: 'charts', label: 'CHARTS', icon: '▤' },
 *     { id: 'profile', label: 'PROFILE', icon: '▥' },
 *     ...
 *     { id: 'merge', label: 'MERGE', icon: '⊕' },
 *   ]
 *
 *  ADD these two entries BEFORE the merge tab:
 */

//    { id: 'strategy', label: 'STRATEGY', icon: '⚗', accent: true },
//    { id: 'animate', label: 'ANIMATE', icon: '▶', accent: true },

/**
 *  So the full TABS becomes:
 *
 *   const TABS = [
 *     { id: 'charts', label: 'CHARTS', icon: '▤' },
 *     { id: 'profile', label: 'PROFILE', icon: '▥' },
 *     { id: 'volatility', label: 'VOL', icon: '◈', accent: true },
 *     { id: 'signals', label: 'SIGNALS', icon: '⚡', accent: true },
 *     { id: 'results', label: 'DATA', icon: '≡' },
 *     { id: 'moments', label: 'MOMENTS', icon: '📈' },
 *     { id: 'strategy', label: 'STRATEGY', icon: '⚗', accent: true },
 *     { id: 'animate', label: 'ANIMATE', icon: '▶', accent: true },
 *     { id: 'merge', label: 'MERGE', icon: '⊕' },
 *   ]
 */

/**
 * ════════════════════════════════════════════════════
 *  STEP 4: Add tab content
 * ════════════════════════════════════════════════════
 *
 *  CRITICAL: The strategy and animate tabs must render OUTSIDE the
 *  {analysis && !loading && ( ... )} guard, because they don't need
 *  candle/GMM data — they fetch their own data via /strategy/run.
 *
 *  Find the section in your JSX that looks like this:
 *
 *    {activeTab === 'merge' && (
 *      <MergePanel />
 *    )}
 *
 *  The merge tab already renders outside the analysis guard.
 *  Add the strategy and animate tabs RIGHT BEFORE the merge tab:
 */

// PASTE THIS in the render section, BEFORE the merge tab:

/*

          {activeTab === 'strategy' && (
            <StrategyPanel onResult={setStrategyResult} />
          )}

          {activeTab === 'animate' && (
            <EquityAnimator strategyResult={strategyResult} />
          )}

          {activeTab === 'merge' && (
            <MergePanel />
          )}

*/

/**
 * ════════════════════════════════════════════════════
 *  IMPORTANT: Strategy → Animate data flow
 * ════════════════════════════════════════════════════
 *
 *  The StrategyPanel runs its own /strategy/run call and displays results.
 *  To also feed data to the EquityAnimator, you have two options:
 *
 *  OPTION A (Quick): Add a prop to StrategyPanel:
 *    <StrategyPanel onResult={setStrategyResult} />
 *
 *    Then in StrategyPanel.jsx, after setResult(data), also call:
 *      if (props.onResult) props.onResult(data)
 *
 *  OPTION B (Full integration): The StrategyPanel component already manages
 *    its own result state. You can lift that state to App.jsx and pass it down
 *    to both components. This is cleaner for larger integrations.
 *
 *  For now, OPTION A is simplest. Here's the exact change:
 *
 *  In StrategyPanel.jsx, change the export line to accept an onResult prop:
 *    export default function StrategyPanel({ onResult }) {
 *
 *  Then in handleRun(), after setResult(data), add:
 *    if (onResult) onResult(data)
 *
 *  And in App.jsx, render it as:
 *    <StrategyPanel onResult={setStrategyResult} />
 */

// ── That's it! The strategy + animation tabs are now live. ──

export default null // This file is a patch guide, not a component
