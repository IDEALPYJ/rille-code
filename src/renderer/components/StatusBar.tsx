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
  onSelectDiagnostic: (diagnostic: StatusDiagnostic) => void | Promise<void>
}

function shortName(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

export function StatusBar({ diagnostics, cursorLine, cursorColumn, onSelectDiagnostic }: Props) {
  const errorCount = diagnostics.filter(diagnostic => diagnostic.severity === 'error').length
  const warningCount = diagnostics.filter(diagnostic => diagnostic.severity === 'warning').length

  return (
    <footer className="statusbar">
      <div className="statusbar-left">
        <details className="problems-menu">
          <summary className="problems-summary" title="显示错误和警告">
            <span className="problem-count error">× {errorCount}</span>
            <span className="problem-count warning">△ {warningCount}</span>
          </summary>
          <div className="problems-popover">
            <div className="problems-title">问题</div>
            {diagnostics.length === 0 ? (
              <div className="problems-empty">没有错误或警告</div>
            ) : diagnostics.map(diagnostic => (
              <button
                type="button"
                key={diagnostic.id}
                className="problem-row"
                onClick={() => void onSelectDiagnostic(diagnostic)}
              >
                <span className={'problem-dot ' + diagnostic.severity}>{diagnostic.severity === 'error' ? '×' : '△'}</span>
                <span className="problem-main">
                  <span className="problem-message">{diagnostic.message}</span>
                  <span className="problem-location">{shortName(diagnostic.filePath)}:{diagnostic.line}:{diagnostic.column}</span>
                </span>
              </button>
            ))}
          </div>
        </details>
      </div>
      <div className="statusbar-right">
        <span className="cursor-position">Ln {cursorLine}, Col {cursorColumn}</span>
      </div>
    </footer>
  )
}
