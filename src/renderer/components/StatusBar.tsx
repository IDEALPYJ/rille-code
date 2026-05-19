export interface StatusDiagnostic {
  id: string
  filePath: string
  line: number
  column: number
  message: string
  severity: 'error' | 'warning'
}

interface Props {
  diagnostics: StatusDiagnostic[]
  cursorLine: number
  cursorColumn: number
  problemsActive: boolean
  connectionLabel: string
  isRemoteConnection: boolean
  onOpenProblems: () => void
}

export function StatusBar({ diagnostics, cursorLine, cursorColumn, problemsActive, connectionLabel, isRemoteConnection, onOpenProblems }: Props) {
  const errorCount = diagnostics.filter(diagnostic => diagnostic.severity === 'error').length
  const warningCount = diagnostics.filter(diagnostic => diagnostic.severity === 'warning').length

  return (
    <footer className="statusbar">
      <div className="statusbar-left">
        <span className={'connection-status ' + (isRemoteConnection ? 'remote' : 'local')} title={connectionLabel}>{connectionLabel}</span>
        <button
          type="button"
          className={'problems-summary ' + (problemsActive ? 'active' : '')}
          title="显示错误和警告"
          onClick={onOpenProblems}
        >
          <span className="problem-count error">× {errorCount}</span>
          <span className="problem-count warning">△ {warningCount}</span>
        </button>
      </div>
      <div className="statusbar-right">
        <span className="cursor-position">Ln {cursorLine}, Col {cursorColumn}</span>
      </div>
    </footer>
  )
}
