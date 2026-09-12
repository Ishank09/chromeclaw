import { customModelsStorage } from '@extension/storage';
import { PRESET_MODELS } from './default-models';
import { createLogger } from '../logging/logger-buffer';

const log = createLogger('model-init');

/**
 * Merge preset models into Chrome storage.
 * - Preset models are identified by their stable "preset-*" id.
 * - Existing preset entries are updated if the config changed.
 * - Non-preset (user-added) models are never touched.
 * - Skips presets with an empty apiKey (key not set in .env yet).
 */
export const initPresetModels = async (): Promise<void> => {
  try {
    const current = await customModelsStorage.get() ?? [];
    const currentMap = new Map(current.map(m => [m.id, m]));

    let changed = false;

    for (const preset of PRESET_MODELS) {
      if (!preset.apiKey) continue; // skip unconfigured presets

      const existing = currentMap.get(preset.id);
      const next = {
        id: preset.id,
        name: preset.name,
        provider: preset.provider,
        modelId: preset.modelId,
        baseUrl: preset.baseUrl,
        apiKey: preset.apiKey,
        supportsTools: preset.supportsTools ?? true,
        supportsReasoning: preset.supportsReasoning ?? false,
        contextWindow: preset.contextWindow,
        routingMode: preset.routingMode ?? 'direct',
        description: '',
      };

      if (!existing) {
        log.info('Adding preset model', { id: preset.id, name: preset.name });
        currentMap.set(preset.id, next);
        changed = true;
      } else {
        // Update if anything changed (e.g. new API key, new baseUrl)
        const same =
          existing.modelId === next.modelId &&
          existing.apiKey === next.apiKey &&
          existing.baseUrl === next.baseUrl &&
          existing.contextWindow === next.contextWindow;
        if (!same) {
          log.info('Updating preset model', { id: preset.id, name: preset.name });
          currentMap.set(preset.id, { ...existing, ...next });
          changed = true;
        }
      }
    }

    if (changed) {
      await customModelsStorage.set([...currentMap.values()]);
      log.info('Preset models synced', { total: currentMap.size });
    }
  } catch (err) {
    log.warn('Failed to init preset models', { error: String(err) });
  }
};
