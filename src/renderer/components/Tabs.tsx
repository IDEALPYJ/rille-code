import type { OpenFile } from '../App'
import { X } from 'lucide-react'

interface Props {
  files: OpenFile[]
  activePath: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
}

export function Tabs({ files, activePath, onSelect, onClose }: Props) {
  if (files.length === 0) return null

  return (
    <div className="tabs-bar">
      {files.map(file => (
        <div
          key={file.path}
          className={'tab ' + (activePath === file.path ? 'active' : '')}
          onClick={() => onSelect(file.path)}
          title={file.path}
        >
          {file.isDirty && <span className="dirty-indicator" />}
          <span className="tab-name">{file.name}</span>
          <button
            type="button"
            className="tab-close"
            aria-label={'Close ' + file.name}
            onClick={(e) => {
              e.stopPropagation()
              onClose(file.path)
            }}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
