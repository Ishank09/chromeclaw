import { nanoid } from 'nanoid';
import { createWorkspaceFile, listWorkspaceFiles, updateWorkspaceFile } from '@extension/storage';

const PARENT_ID = 'chromeclaw';
const SAVE_MEMORY_ID = 'chromeclaw-save-memory';
const SIMPLIFY_ID = 'chromeclaw-simplify';
const GROUP_TABS_ID = 'chromeclaw-group-tabs';

const initContextMenus = (): void => {
  chrome.contextMenus.removeAll(() => {
    // Parent visible in all contexts (required so Group My Tabs works without selection)
    chrome.contextMenus.create({
      id: PARENT_ID,
      title: 'ChromeClaw',
      contexts: ['all'],
    });
    chrome.contextMenus.create({
      id: SAVE_MEMORY_ID,
      parentId: PARENT_ID,
      title: 'Save to Memory',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: SIMPLIFY_ID,
      parentId: PARENT_ID,
      title: 'Simplify',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: GROUP_TABS_ID,
      parentId: PARENT_ID,
      title: 'Group My Tabs',
      contexts: ['all'],
    });
  });
};

const saveToMemory = async (text: string, sourceUrl: string): Promise<void> => {
  const today = new Date().toISOString().split('T')[0];
  const memoryFileName = `memory/${today}.md`;

  const allFiles = await listWorkspaceFiles('main');
  const existing = allFiles.find(f => f.name === memoryFileName);

  const timestamp = new Date().toLocaleTimeString();
  const sourceNote = sourceUrl ? `\nSource: ${sourceUrl}` : '';
  const entry = `\n## Saved at ${timestamp}${sourceNote}\n\n${text}\n`;

  if (existing) {
    await updateWorkspaceFile(existing.id, { content: (existing.content ?? '') + entry });
  } else {
    await createWorkspaceFile({
      id: nanoid(),
      name: memoryFileName,
      content: `# Memory — ${today}\n${entry}`,
      enabled: true,
      owner: 'agent',
      predefined: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      agentId: 'main',
    });
  }

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon-48.png',
    title: 'ChromeClaw',
    message: 'Saved to memory',
  });
};

const openPanel = (tab?: chrome.tabs.Tab): void => {
  const sidePanelApi = (chrome as unknown as { sidePanel?: { open: (opts: object) => Promise<void> } }).sidePanel;
  if (sidePanelApi?.open) {
    const openOpts: Record<string, unknown> = {};
    if (tab?.windowId) openOpts['windowId'] = tab.windowId;
    sidePanelApi.open(openOpts).catch(() => {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon-48.png',
        title: 'ChromeClaw',
        message: 'Click the ChromeClaw icon to open the panel.',
      });
    });
  } else {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon-48.png',
      title: 'ChromeClaw',
      message: 'Click the ChromeClaw icon to open the panel.',
    });
  }
};

const registerContextMenuListeners = (): void => {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === SIMPLIFY_ID) {
      const selectedText = info.selectionText?.trim();
      if (!selectedText) return;

      chrome.storage.local
        .set({ chromeclaw_pending_action: { action: 'simplify', text: selectedText, nonce: Date.now() } })
        .catch(err => console.error('[context-menu] Storage error:', err));

      // Must call synchronously during user gesture
      openPanel(tab);
    } else if (info.menuItemId === GROUP_TABS_ID) {
      // Open panel immediately (synchronous gesture requirement)
      openPanel(tab);

      // Async: collect tabs and store pending action
      chrome.tabs
        .query({ currentWindow: true })
        .then(tabs => {
          const filtered = tabs
            .filter(
              t =>
                t.id != null &&
                t.url &&
                !t.url.startsWith('chrome://') &&
                !t.url.startsWith('brave://') &&
                !t.url.startsWith('about:') &&
                !t.url.startsWith('chrome-extension://'),
            )
            .map(t => ({ id: t.id!, title: t.title ?? t.url ?? '', url: t.url ?? '' }));
          return chrome.storage.local.set({
            chromeclaw_pending_action: { action: 'group-tabs', tabs: filtered, nonce: Date.now() },
          });
        })
        .catch(err => console.error('[context-menu] Tab query error:', err));
    } else if (info.menuItemId === SAVE_MEMORY_ID) {
      const selectedText = info.selectionText?.trim();
      if (!selectedText) return;
      saveToMemory(selectedText, info.pageUrl ?? tab?.url ?? '').catch(err => {
        console.error('[context-menu] Save memory error:', err);
      });
    }
  });
};

export { initContextMenus, registerContextMenuListeners };
