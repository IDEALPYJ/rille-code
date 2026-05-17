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
  onOpenProblems: () => void
}

export function StatusBar({ diagnostics, cursorLine, cursorColumn, problemsActive, onOpenProblems }: Props) {
  const errorCount = diagnostics.filter(diagnostic => diagnostic.severity === 'error').length
  const warningCount = diagnostics.filter(diagnostic => diagnostic.severity === 'warning').length

  return (
    <footer className="statusbar">
      <div className="statusbar-left">
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
