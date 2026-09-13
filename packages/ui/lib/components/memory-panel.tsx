import { Button } from './ui';
import { listWorkspaceFiles } from '@extension/storage';
import { X, Save, Brain } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DbWorkspaceFile } from '@extension/storage';

type MemoryPanelProps = {
  open: boolean;
  onClose: () => void;
};

const MemoryPanel = ({ open, onClose }: MemoryPanelProps) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<DbWorkspaceFile[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Move focus into the panel so the chat textarea no longer holds focus,
    // preventing the aria-hidden conflict on the chat container.
    panelRef.current?.focus();

    listWorkspaceFiles('main').then(all => {
      const memFiles = all
        .filter(f => f.name === 'MEMORY.md' || f.name.startsWith('memory/'))
        .sort((a, b) => {
          if (a.name === 'MEMORY.md') return -1;
          if (b.name === 'MEMORY.md') return 1;
          return b.name.localeCompare(a.name);
        });
      setFiles(memFiles);
      if (memFiles.length > 0) {
        const first = memFiles[0];
        setSelectedId(first.id);
        setContent(first.content ?? '');
      }
    });
  }, [open]);

  const handleSelect = (id: string) => {
    const file = files.find(f => f.id === id);
    if (!file) return;
    setSelectedId(id);
    setContent(file.content ?? '');
    setDirty(false);
  };

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await chrome.runtime.sendMessage({ type: 'WORKSPACE_UPDATE', id: selectedId, content });
      setFiles(prev =>
        prev.map(f => (f.id === selectedId ? { ...f, content } : f)),
      );
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const selectedFile = files.find(f => f.id === selectedId);

  return (
    <div
      className="fixed inset-y-0 right-0 z-50 flex w-80 flex-col border-l bg-background shadow-xl"
      ref={panelRef}
      tabIndex={-1}
      style={{ outline: 'none' }}
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-1.5 font-medium text-sm">
          <Brain className="size-4 text-muted-foreground" />
          Memory
        </div>
        <Button onClick={onClose} size="icon" variant="ghost" className="size-6">
          <X className="size-3.5" />
        </Button>
      </div>

      {files.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No memory files yet
        </div>
      ) : (
        <>
          <div className="flex gap-1 overflow-x-auto border-b px-2 py-1.5">
            {files.map(f => (
              <button
                key={f.id}
                onClick={() => handleSelect(f.id)}
                className={`shrink-0 rounded px-2 py-0.5 text-xs transition-colors ${
                  f.id === selectedId
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent/50'
                }`}
                type="button"
              >
                {f.name === 'MEMORY.md' ? 'MEMORY.md' : f.name.replace('memory/', '')}
              </button>
            ))}
          </div>

          <textarea
            className="flex-1 resize-none bg-transparent p-3 font-mono text-xs outline-none"
            onChange={e => {
              setContent(e.target.value);
              setDirty(true);
            }}
            placeholder={`${selectedFile?.name ?? 'memory'} is empty`}
            value={content}
          />

          <div className="flex items-center justify-end border-t px-3 py-2">
            <Button
              className="gap-1.5"
              disabled={!dirty || saving}
              onClick={handleSave}
              size="sm"
              variant="default"
            >
              <Save className="size-3.5" />
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export { MemoryPanel };
export type { MemoryPanelProps };
