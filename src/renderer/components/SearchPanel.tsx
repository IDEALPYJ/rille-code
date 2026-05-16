import { useCallback, useState } from 'react'
import { Search } from 'lucide-react'

interface Props {
  rootPath: string | null
  onOpenFile: (path: string) => Promise<void>
}

function fileName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}

function compactPath(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts.slice(-4).join(' / ') || path
}

export function SearchPanel({ rootPath, onOpenFile }: Props) {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [includeDependencies, setIncludeDependencies] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runSearch = useCallback(async () => {
    if (!rootPath || !query.trim()) {
      setResults([])
      return
    }

    setIsSearching(true)
    setError(null)
    try {
      const found = await window.rille.searchFiles(rootPath, query, { caseSensitive, includeDependencies })
      setResults(found)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setIsSearching(false)
    }
  }, [caseSensitive, includeDependencies, query, rootPath])

  return (
    <div className="side-view search-view">
      <div className="side-view-title">搜索</div>
      <div className="search-box">
        <Search size={14} />
        <input
          value={query}
          placeholder="搜索"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void runSearch()
          }}
        />
        <button type="button" onClick={runSearch} disabled={!rootPath || !query.trim() || isSearching}>
          {isSearching ? '...' : '查找'}
        </button>
      </div>
      <label className="option-row">
        <input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} />
        区分大小写
      </label>
      <label className="option-row">
        <input type="checkbox" checked={includeDependencies} onChange={(event) => setIncludeDependencies(event.target.checked)} />
        Include dependencies
      </label>
      {!rootPath && <div className="panel-empty">打开文件夹后可以搜索项目。</div>}
      {error && <div className="panel-error">{error}</div>}
      {rootPath && results.length === 0 && query.trim() && !isSearching && !error && (
        <div className="panel-empty">没有结果</div>
      )}
      <div className="search-results">
        {results.map((result) => (
          <button
            type="button"
            className="search-result"
            key={`${result.filePath}:${result.line}:${result.column}`}
            onClick={() => onOpenFile(result.filePath)}
          >
            <span className="result-file">{fileName(result.filePath)}</span>
            <span className="result-path">{compactPath(result.filePath)}:{result.line}</span>
            <span className="result-preview">{result.preview}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
