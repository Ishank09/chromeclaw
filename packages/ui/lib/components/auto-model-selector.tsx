import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from './ui';
import { cn } from '../utils';
import { useT } from '@extension/i18n';
import { autoModeSelectedModelsStorage } from '@extension/storage';
import { ChevronDownIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ChatModel } from '@extension/shared';

type AutoModelSelectorProps = {
  models: ChatModel[];
  selectedModelId: string;
  isAutoMode: boolean;
  onModelChange: (modelId: string) => void;
};

const AutoModelSelector = ({
  models,
  selectedModelId,
  isAutoMode,
  onModelChange,
}: AutoModelSelectorProps) => {
  const t = useT();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  // Load selected models from storage on mount
  useEffect(() => {
    autoModeSelectedModelsStorage.get().then(selection => {
      setSelectedIds(selection.selectedModelIds);
    });
  }, []);

  // Subscribe to changes
  useEffect(() => {
    const unsub = autoModeSelectedModelsStorage.subscribe(() => {
      autoModeSelectedModelsStorage.get().then(selection => {
        setSelectedIds(selection.selectedModelIds);
      });
    });
    return unsub;
  }, []);

  const realModels = models.filter(m => m.id !== '__auto__');

  const handleToggleModel = useCallback(
    async (modelId: string) => {
      setSelectedIds(prev => {
        const next = prev.includes(modelId)
          ? prev.filter(id => id !== modelId)
          : [...prev, modelId];

        // Persist to storage
        autoModeSelectedModelsStorage.set({
          selectedModelIds: next,
          timestamp: Date.now(),
        }).catch(console.error);

        return next;
      });
    },
    [],
  );

  if (!isAutoMode || realModels.length === 0) return null;

  const displayText = selectedIds.length === 0 ? 'All' : `${selectedIds.length}/${realModels.length}`;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          className={cn(
            'text-muted-foreground h-auto border-none bg-transparent px-2 py-1.5 font-medium shadow-none transition-colors',
            'hover:bg-accent hover:text-foreground',
          )}
          size="sm"
          title="Select models for auto mode"
          variant="ghost">
          {displayText}
          <ChevronDownIcon className="ml-1 size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <div className="px-2 py-1.5">
          <p className="text-muted-foreground text-xs font-semibold mb-2">
            Select Models
          </p>
          <div className="space-y-2">
            {realModels.map(model => {
              const modelId = model.dbId ?? model.id;
              return (
                <label
                  key={modelId}
                  className="flex items-center gap-2 cursor-pointer px-1 py-1 hover:bg-accent rounded">
                  <input
                    checked={selectedIds.includes(modelId)}
                    className="accent-primary size-4"
                    onChange={() => handleToggleModel(modelId)}
                    type="checkbox"
                  />
                  <span className="text-sm">{model.name}</span>
                </label>
              );
            })}
          </div>
          {selectedIds.length > 0 && (
            <Button
              className="w-full mt-2"
              onClick={() => {
                setSelectedIds([]);
                autoModeSelectedModelsStorage.set({
                  selectedModelIds: [],
                  timestamp: Date.now(),
                }).catch(console.error);
              }}
              size="sm"
              variant="outline">
              Clear All
            </Button>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export { AutoModelSelector };
export type { AutoModelSelectorProps };
