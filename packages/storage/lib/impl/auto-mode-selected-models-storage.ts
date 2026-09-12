import { createStorage, StorageEnum } from '../base/index.js';

export interface AutoModeModelSelection {
  selectedModelIds: string[];
  timestamp: number;
}

const defaultSelection: AutoModeModelSelection = {
  selectedModelIds: [],
  timestamp: 0,
};

export const autoModeSelectedModelsStorage = createStorage<AutoModeModelSelection>(
  'auto-mode-selected-models',
  defaultSelection,
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);
