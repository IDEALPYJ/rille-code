import { useRef, useCallback, useEffect } from 'react'
import MonacoEditor, { type BeforeMount, type Monaco, type OnMount } from '@monaco-editor/react'
import type { editor, IDisposable } from 'monaco-editor'

export interface EditorDiagnostic {
  id: string
  filePath: string
  line: number
  column: number
  message: string
  severity: 'error' | 'warning'
}

interface Props {
  path: string
  language: string
  value: string
  onChange: (value: string | undefined) => void
  onSave: () => void
  onEditorMount?: (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => void
  onCursorPositionChange?: (position: { line: number; column: number }) => void
  onDiagnosticsChange?: (diagnostics: EditorDiagnostic[]) => void
  breakpointLines?: number[]
  onBreakpointToggle?: (line: number) => void
}

function pathFromMarker(marker: editor.IMarker): string {
  return marker.resource.fsPath || decodeURIComponent(marker.resource.path)
}

export function Editor({
  path,
  language,
  value,
  onChange,
  onSave,
  onEditorMount,
  onCursorPositionChange,
  onDiagnosticsChange,
  breakpointLines = [],
  onBreakpointToggle,
}: Props) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const onSaveRef = useRef(onSave)
  const disposablesRef = useRef<IDisposable[]>([])
  const breakpointDecorationIdsRef = useRef<string[]>([])

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])


  const updateBreakpointDecorations = useCallback((lines: number[]) => {
    const ed = editorRef.current
    if (!ed) return
    breakpointDecorationIdsRef.current = ed.deltaDecorations(
      breakpointDecorationIdsRef.current,
      lines.map(line => ({
        range: {
          startLineNumber: line,
          startColumn: 1,
          endLineNumber: line,
          endColumn: 1,
        },
        options: {
          glyphMarginClassName: 'editor-breakpoint-glyph',
          glyphMarginHoverMessage: { value: 'Breakpoint' },
        },
      })),
    )
  }, [])

  useEffect(() => {
    updateBreakpointDecorations(breakpointLines)
  }, [breakpointLines, updateBreakpointDecorations])

  useEffect(() => {
    return () => {
      if (editorRef.current) {
        breakpointDecorationIdsRef.current = editorRef.current.deltaDecorations(breakpointDecorationIdsRef.current, [])
      }
      disposablesRef.current.forEach(disposable => disposable.dispose())
      disposablesRef.current = []
      editorRef.current = null
    }
  }, [])

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    monaco.editor.defineTheme('rille-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '7A8494' },
        { token: 'keyword', foreground: '2457C5' },
        { token: 'number', foreground: 'A855F7' },
        { token: 'string', foreground: '0F7A55' },
      ],
      colors: {
        'editor.background': '#FBFCFE',
        'editor.foreground': '#1D2433',
        'editorLineNumber.foreground': '#AAB4C4',
        'editorLineNumber.activeForeground': '#42526E',
        'editorCursor.foreground': '#2563EB',
        'editor.selectionBackground': '#D9E7FF',
        'editor.inactiveSelectionBackground': '#E8EEF7',
        'editor.lineHighlightBackground': '#F2F6FC',
        'editorIndentGuide.background1': '#E3E9F2',
        'editorIndentGuide.activeBackground1': '#B8C5D8',
        'editorWhitespace.foreground': '#CCD5E2',
        'editorWidget.background': '#FFFFFF',
        'editorWidget.border': '#D8E0EC',
        'editorSuggestWidget.background': '#FFFFFF',
        'editorSuggestWidget.border': '#D8E0EC',
        'editorSuggestWidget.selectedBackground': '#EEF5FF',
        'scrollbarSlider.background': '#CBD5E166',
        'scrollbarSlider.hoverBackground': '#AAB7CA88',
        'scrollbarSlider.activeBackground': '#8E9CB2AA',
      },
    })
  }, [])

  const handleMount: OnMount = useCallback((ed, monaco) => {
    disposablesRef.current.forEach(disposable => disposable.dispose())
    disposablesRef.current = []
    editorRef.current = ed
    onEditorMount?.(ed, monaco)

    const emitCursor = () => {
      const position = ed.getPosition()
      if (position) {
        onCursorPositionChange?.({ line: position.lineNumber, column: position.column })
      }
    }

    const emitDiagnostics = () => {
      const markers: editor.IMarker[] = monaco.editor.getModelMarkers({})
      const diagnostics = markers
        .filter(marker => marker.severity === monaco.MarkerSeverity.Error || marker.severity === monaco.MarkerSeverity.Warning)
        .map(marker => ({
          id: `${marker.resource.toString()}:${marker.startLineNumber}:${marker.startColumn}:${marker.message}`,
          filePath: pathFromMarker(marker),
          line: marker.startLineNumber,
          column: marker.startColumn,
          message: marker.message,
          severity: marker.severity === monaco.MarkerSeverity.Error ? 'error' as const : 'warning' as const,
        }))
      onDiagnosticsChange?.(diagnostics)
    }

    disposablesRef.current.push(
      ed.onDidChangeCursorPosition(emitCursor),
      monaco.editor.onDidChangeMarkers(emitDiagnostics),
      ed.onMouseDown((event) => {
        if (event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && event.target.position) {
          onBreakpointToggle?.(event.target.position.lineNumber)
        }
      }),
    )

    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current()
    })

    emitCursor()
    updateBreakpointDecorations(breakpointLines)
    setTimeout(emitDiagnostics, 0)
    ed.focus()
  }, [breakpointLines, onBreakpointToggle, onCursorPositionChange, onDiagnosticsChange, onEditorMount, updateBreakpointDecorations])

  return (
    <div className="monaco-shell">
      <MonacoEditor
        key={path}
        path={path}
        height="100%"
        language={language}
        value={value}
        onChange={onChange}
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        theme="rille-light"
        loading={<div className="empty-editor"><p>Loading editor...</p></div>}
        options={{
          fontSize: 14,
          fontFamily: "var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace)",
          fontLigatures: true,
          minimap: { enabled: false },
          lineNumbers: 'on',
          renderWhitespace: 'selection',
          bracketPairColorization: { enabled: true },
          autoClosingBrackets: 'always',
          autoClosingQuotes: 'always',
          formatOnPaste: true,
          tabSize: 2,
          insertSpaces: false,
          detectIndentation: true,
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          scrollBeyondLastLine: false,
          padding: { top: 14, bottom: 14 },
          suggest: {
            preview: true,
            showWords: true,
            showSnippets: true,
          },
          inlineSuggest: {
            enabled: true,
            mode: 'subwordSmart' as const,
            showToolbar: 'onHover' as const,
          },
          quickSuggestions: true,
          parameterHints: { enabled: true },
          folding: true,
          glyphMargin: true,
          lineDecorationsWidth: 12,
          lineNumbersMinChars: 3,
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          overviewRulerLanes: 0,
          renderLineHighlight: 'all',
          contextmenu: true,
          fixedOverflowWidgets: true,
          automaticLayout: true,
        }}
      />
    </div>
  )
}
