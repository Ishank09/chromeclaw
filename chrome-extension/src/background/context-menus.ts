import { nanoid } from 'nanoid';
import { createWorkspaceFile, listWorkspaceFiles, updateWorkspaceFile } from '@extension/storage';
import { openSidePanel } from '@extension/shared';

const PARENT_ID = 'chromeclaw';
const SAVE_MEMORY_ID = 'chromeclaw-save-memory';
const SIMPLIFY_ID = 'chromeclaw-simplify';

const initContextMenus = (): void => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: PARENT_ID,
      title: 'ChromeClaw',
      contexts: ['selection'],
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

const handleContextMenuClick = async (
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
): Promise<void> => {
  const selectedText = info.selectionText?.trim();
  if (!selectedText) return;

  if (info.menuItemId === SAVE_MEMORY_ID) {
    await saveToMemory(selectedText, info.pageUrl ?? tab?.url ?? '');
  } else if (info.menuItemId === SIMPLIFY_ID) {
    // Store action in session storage so the side panel picks it up whenever ready.
    // This avoids the race condition where sendMessage fires before the panel mounts.
    await chrome.storage.session.set({
      chromeclaw_pending_action: { action: 'simplify', text: selectedText, nonce: Date.now() },
    });
    await openSidePanel();
  }
};

const registerContextMenuListeners = (): void => {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    const selectedText = info.selectionText?.trim();
    if (!selectedText) return;

    if (info.menuItemId === SIMPLIFY_ID) {
      // Store the action first so the side panel can pick it up whenever it opens.
      // Use chrome.storage.local (not session) — broader Brave compatibility.
      chrome.storage.local
        .set({ chromeclaw_pending_action: { action: 'simplify', text: selectedText, nonce: Date.now() } })
        .catch(err => console.error('[context-menu] Storage error:', err));

      // sidePanel.open() must be called synchronously during the user gesture.
      // Brave may not support it from context menus — fall back to a notification.
      const sidePanelApi = (chrome as unknown as { sidePanel?: { open: (opts: object) => Promise<void> } }).sidePanel;
      if (sidePanelApi?.open) {
        const openOpts: Record<string, unknown> = {};
        if (tab?.windowId) openOpts['windowId'] = tab.windowId;
        sidePanelApi.open(openOpts).catch(() => {
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon-48.png',
            title: 'ChromeClaw — Simplify ready',
            message: 'Click the ChromeClaw icon to open the panel and run Simplify.',
          });
        });
      } else {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icon-48.png',
          title: 'ChromeClaw — Simplify ready',
          message: 'Click the ChromeClaw icon to open the panel and run Simplify.',
        });
      }
    } else {
      handleContextMenuClick(info, tab).catch(err => {
        console.error('[context-menu] Error:', err);
      });
    }
  });
};

export { initContextMenus, registerContextMenuListeners };
