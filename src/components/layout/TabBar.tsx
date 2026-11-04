import React, { useRef, useState, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/useAppStore';
import { TabItem, TabGroup, HighlightColor } from '../../types';
import { getHighlightColorOption, HighlightColorSwatches } from '../editor/HighlightPopover';
import { MiddleEllipsisText } from '../ui/MiddleEllipsisText';
import { saveCoordinator } from '../../services/saveCoordinator';
import {
  X,
  Plus,
  Pencil,
  ChevronRight,
  ChevronDown,
  FolderMinus,
  FolderPlus,
  Palette,
} from 'lucide-react';

interface TabBarProps {
  onRequestCloseTab: (e: React.MouseEvent, tab: TabItem) => void;
  onNewFile: () => void;
}

type TabRenderSegment =
  | { type: 'single'; tab: TabItem }
  | { type: 'group'; group: TabGroup; tabs: TabItem[] };

export const TabBar: React.FC<TabBarProps> = ({ onRequestCloseTab, onNewFile }) => {
  const {
    tabs,
    activeTabId,
    tabGroups,
    switchTab,
    renameTab,
    openTab,
    reorderTabs,
    moveTabGroup,
    createTabGroup,
    assignTabToGroup,
    updateTabGroup,
    ungroupTabs,
    setIsEditable,
  } = useAppStore(
    useShallow((state) => ({
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      tabGroups: state.tabGroups,
      switchTab: state.switchTab,
      renameTab: state.renameTab,
      openTab: state.openTab,
      reorderTabs: state.reorderTabs,
      moveTabGroup: state.moveTabGroup,
      createTabGroup: state.createTabGroup,
      assignTabToGroup: state.assignTabToGroup,
      updateTabGroup: state.updateTabGroup,
      ungroupTabs: state.ungroupTabs,
      setIsEditable: state.setIsEditable,
    }))
  );

  // Tab renaming state
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const tabRenameInputRef = useRef<HTMLInputElement>(null);
  const isCancelingRenameRef = useRef(false);

  // Group renaming state
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupTitle, setEditingGroupTitle] = useState('');
  const groupRenameInputRef = useRef<HTMLInputElement>(null);

  // Tab context menu state
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const tabContextMenuRef = useRef<HTMLDivElement>(null);

  // Group context menu/popover state
  const [groupPopover, setGroupPopover] = useState<{ x: number; y: number; groupId: string } | null>(null);
  const groupPopoverRef = useRef<HTMLDivElement>(null);

  // Drag & Drop State
  const [dragSource, setDragSource] = useState<
    { type: 'tab'; id: string } | { type: 'group'; id: string } | null
  >(null);
  const [dropIndicator, setDropIndicator] = useState<{
    targetTabId: string;
    position: 'before' | 'after';
  } | null>(null);
  const [chipDropTargetGroupId, setChipDropTargetGroupId] = useState<string | null>(null);

  // Close menus when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (tabContextMenuRef.current && !tabContextMenuRef.current.contains(target)) {
        setTabContextMenu(null);
      }
      if (groupPopoverRef.current && !groupPopoverRef.current.contains(target)) {
        setGroupPopover(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTabContextMenu(null);
        setGroupPopover(null);
      }
    };

    if (tabContextMenu || groupPopover) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [tabContextMenu, groupPopover]);

  // Tab renaming triggers
  const handleStartTabRename = (tab: TabItem) => {
    isCancelingRenameRef.current = false;
    setEditingTabId(tab.id);
    setEditingTitle(tab.title);
    setTimeout(() => {
      const inputEl = tabRenameInputRef.current;
      if (inputEl) {
        inputEl.focus();
        const dotIndex = tab.title.lastIndexOf('.');
        if (dotIndex > 0) {
          inputEl.setSelectionRange(0, dotIndex);
        } else {
          inputEl.select();
        }
        inputEl.scrollLeft = 0;
        inputEl.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }, 30);
  };

  const handleFinishTabRename = () => {
    if (isCancelingRenameRef.current) {
      isCancelingRenameRef.current = false;
      return;
    }
    if (editingTabId) {
      const targetTabId = editingTabId;
      const prevTitle = tabs.find((t) => t.id === targetTabId)?.title;
      setEditingTabId(null);
      renameTab(targetTabId, editingTitle);

      const freshState = useAppStore.getState();
      if (
        targetTabId === freshState.activeTabId &&
        freshState.document?.oneDriveItemId &&
        freshState.document.title !== prevTitle
      ) {
        saveCoordinator.save({ interactive: false });
      }
    }
  };

  const handleTabRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleFinishTabRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      isCancelingRenameRef.current = true;
      setEditingTabId(null);
    }
  };

  // Group renaming triggers
  const handleStartGroupRename = (group: TabGroup) => {
    setEditingGroupId(group.id);
    setEditingGroupTitle(group.title);
    setTimeout(() => {
      const inputEl = groupRenameInputRef.current;
      if (inputEl) {
        inputEl.focus();
        inputEl.select();
      }
    }, 30);
  };

  const handleFinishGroupRename = () => {
    if (editingGroupId) {
      const nextTitle = editingGroupTitle.trim() || 'Grupo';
      updateTabGroup(editingGroupId, { title: nextTitle });
      setEditingGroupId(null);
    }
  };

  const handleGroupRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleFinishGroupRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditingGroupId(null);
    }
  };

  const handleOpenTabContextMenu = (e: React.MouseEvent, tab: TabItem) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = e.clientY + 8;
    setTabContextMenu({ x, y, tabId: tab.id });
    setGroupPopover(null);
  };

  const handleOpenGroupPopover = (e: React.MouseEvent, group: TabGroup) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 240);
    const y = e.clientY + 8;
    setGroupPopover({ x, y, groupId: group.id });
    setTabContextMenu(null);
  };

  // Add new blank document into a group
  const handleNewTabInGroup = (groupId: string) => {
    const newDocId = `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newTabId = openTab({
      title: 'Sem Título.md',
      content: '',
      docId: newDocId,
    });
    assignTabToGroup(newTabId, groupId);
    updateTabGroup(groupId, { collapsed: false });
    setIsEditable(true);
  };

  // Build contiguous render segments
  const segments: TabRenderSegment[] = [];
  const groupMap = new Map(tabGroups.map((g) => [g.id, g]));

  let currentGroupSegment: { type: 'group'; group: TabGroup; tabs: TabItem[] } | null = null;

  for (const tab of tabs) {
    if (tab.groupId && groupMap.has(tab.groupId)) {
      const group = groupMap.get(tab.groupId)!;
      if (currentGroupSegment && currentGroupSegment.group.id === tab.groupId) {
        currentGroupSegment.tabs.push(tab);
      } else {
        if (currentGroupSegment) {
          segments.push(currentGroupSegment);
        }
        currentGroupSegment = { type: 'group', group, tabs: [tab] };
      }
    } else {
      if (currentGroupSegment) {
        segments.push(currentGroupSegment);
        currentGroupSegment = null;
      }
      segments.push({ type: 'single', tab });
    }
  }

  if (currentGroupSegment) {
    segments.push(currentGroupSegment);
  }

  return (
    <div className="h-7 sm:h-8 bg-slate-50/80 dark:bg-slate-950/40 border-t border-slate-200/80 dark:border-slate-800/80 flex items-center px-3 py-0.5">
      <div className="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 max-w-7xl mx-auto w-full">
        {segments.map((segment) => {
          if (segment.type === 'single') {
            const tab = segment.tab;
            const isActive = tab.id === activeTabId;
            const isEditing = editingTabId === tab.id;
            const isDropTarget = dropIndicator?.targetTabId === tab.id;

            return (
              <div
                key={tab.id}
                draggable={!isEditing}
                onDragStart={(e) => {
                  setDragSource({ type: 'tab', id: tab.id });
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', tab.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'move';
                  const rect = e.currentTarget.getBoundingClientRect();
                  const isAfter = e.clientX > rect.left + rect.width / 2;
                  setDropIndicator({
                    targetTabId: tab.id,
                    position: isAfter ? 'after' : 'before',
                  });
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  if (dropIndicator?.targetTabId === tab.id) {
                    setDropIndicator(null);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!dragSource || !dropIndicator) return;
                  if (dragSource.type === 'tab') {
                    reorderTabs(dragSource.id, tab.id, dropIndicator.position, false);
                  } else if (dragSource.type === 'group') {
                    moveTabGroup(dragSource.id, tab.id, dropIndicator.position);
                  }
                  setDragSource(null);
                  setDropIndicator(null);
                }}
                onDragEnd={() => {
                  setDragSource(null);
                  setDropIndicator(null);
                }}
                onClick={() => {
                  if (!isEditing && !isActive) switchTab(tab.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!isEditing) handleStartTabRename(tab);
                }}
                onContextMenu={(e) => handleOpenTabContextMenu(e, tab)}
                className={`group relative h-6 sm:h-6.5 px-2 py-0.5 rounded-md flex items-center gap-1.5 transition-all select-none shrink-0 cursor-pointer ${
                  isDropTarget && dropIndicator.position === 'before'
                    ? 'border-l-2 border-l-blue-500 pl-1.5'
                    : ''
                } ${
                  isDropTarget && dropIndicator.position === 'after'
                    ? 'border-r-2 border-r-blue-500 pr-1.5'
                    : ''
                } ${
                  isActive || isEditing
                    ? 'bg-white dark:bg-slate-800 shadow-xs border border-slate-200/90 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-semibold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 font-medium'
                }`}
                title={`${tab.title} — Duplo clique para renomear, arraste para reordenar`}
              >
                {isEditing ? (
                  <div className="inline-grid items-center min-w-[110px] sm:min-w-[140px] max-w-[calc(100vw-4.5rem)] sm:max-w-[680px]">
                    <span
                      aria-hidden="true"
                      className="invisible col-start-1 row-start-1 whitespace-pre text-[11px] sm:text-xs font-semibold px-1.5 py-0 border border-transparent pointer-events-none select-none overflow-hidden"
                    >
                      {`${editingTitle || ' '}\u00A0\u00A0`}
                    </span>
                    <input
                      ref={tabRenameInputRef}
                      type="text"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={handleFinishTabRename}
                      onKeyDown={handleTabRenameKeyDown}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      aria-label="Renomear arquivo"
                      className="col-start-1 row-start-1 w-full min-w-0 select-text text-[11px] sm:text-xs font-semibold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 border border-blue-500 rounded px-1.5 py-0 outline-none shadow-xs"
                    />
                  </div>
                ) : (
                  <MiddleEllipsisText
                    text={tab.title}
                    showTooltip={false}
                    className="text-[11px] sm:text-xs max-w-[120px] sm:max-w-[180px] md:max-w-[240px]"
                  />
                )}

                <button
                  type="button"
                  onClick={(e) => onRequestCloseTab(e, tab)}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="w-3.5 h-3.5 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                  title={tab.isDirty ? 'Fechar aba (alterações não salvas)' : 'Fechar aba'}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          }

          // Group segment
          const { group, tabs: groupTabs } = segment;
          const colorOption = getHighlightColorOption(group.color);
          const isGroupEditing = editingGroupId === group.id;
          const isCollapsed = Boolean(group.collapsed);

          // If collapsed, only keep active tab visible if it is inside this group
          const visibleTabs = isCollapsed
            ? groupTabs.filter((t) => t.id === activeTabId)
            : groupTabs;

          return (
            <div
              key={group.id}
              className={`rounded-lg border-2 ${colorOption.borderClass} px-1 py-0.5 flex items-center gap-1 bg-white/50 dark:bg-slate-900/50 transition-all shrink-0 ${
                chipDropTargetGroupId === group.id ? 'ring-2 ring-blue-500 bg-blue-50/30' : ''
              }`}
            >
              {/* Group Chip / Header */}
              <div
                draggable={!isGroupEditing}
                onDragStart={(e) => {
                  setDragSource({ type: 'group', id: group.id });
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', group.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setChipDropTargetGroupId(group.id);
                }}
                onDragLeave={() => {
                  if (chipDropTargetGroupId === group.id) {
                    setChipDropTargetGroupId(null);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setChipDropTargetGroupId(null);
                  if (!dragSource) return;
                  if (dragSource.type === 'tab') {
                    assignTabToGroup(dragSource.id, group.id);
                    updateTabGroup(group.id, { collapsed: false });
                  } else if (dragSource.type === 'group' && dragSource.id !== group.id) {
                    // Move group before the first tab of this group
                    if (groupTabs.length > 0) {
                      moveTabGroup(dragSource.id, groupTabs[0].id, 'before');
                    }
                  }
                  setDragSource(null);
                  setDropIndicator(null);
                }}
                onDragEnd={() => {
                  setDragSource(null);
                  setDropIndicator(null);
                  setChipDropTargetGroupId(null);
                }}
                onClick={(e) => {
                  if (!isGroupEditing) {
                    e.stopPropagation();
                    updateTabGroup(group.id, { collapsed: !isCollapsed });
                  }
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!isGroupEditing) handleStartGroupRename(group);
                }}
                onContextMenu={(e) => handleOpenGroupPopover(e, group)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer select-none"
                title={`${group.title} — Clique para recolher/expandir, duplo clique para renomear, botão direito para opções`}
              >
                {/* Dot with group highlight color */}
                <span
                  className={`w-2.5 h-2.5 rounded-full border ${colorOption.borderClass} ${colorOption.bgClass} shrink-0`}
                />

                {isGroupEditing ? (
                  <input
                    ref={groupRenameInputRef}
                    type="text"
                    value={editingGroupTitle}
                    onChange={(e) => setEditingGroupTitle(e.target.value)}
                    onBlur={handleFinishGroupRename}
                    onKeyDown={handleGroupRenameKeyDown}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    className="w-20 text-[11px] sm:text-xs font-semibold px-1 py-0 rounded border border-blue-500 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 outline-none"
                  />
                ) : (
                  <span className="text-[11px] sm:text-xs font-bold text-slate-700 dark:text-slate-200 max-w-[100px] truncate">
                    {group.title}
                  </span>
                )}

                {/* Collapsed tab count indicator */}
                {isCollapsed && (
                  <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-400">
                    ({groupTabs.length})
                  </span>
                )}

                {/* Collapse / Expand chevron */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateTabGroup(group.id, { collapsed: !isCollapsed });
                  }}
                  className="w-3.5 h-3.5 p-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                  title={isCollapsed ? 'Expandir grupo' : 'Recolher grupo'}
                >
                  {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {/* Palette button for quick menu */}
                <button
                  type="button"
                  onClick={(e) => handleOpenGroupPopover(e, group)}
                  className="w-3.5 h-3.5 p-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                  title="Configurar grupo e cor da borda"
                >
                  <Palette className="w-2.5 h-2.5" />
                </button>
              </div>

              {/* Group tabs */}
              {visibleTabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                const isEditing = editingTabId === tab.id;
                const isDropTarget = dropIndicator?.targetTabId === tab.id;

                return (
                  <div
                    key={tab.id}
                    draggable={!isEditing}
                    onDragStart={(e) => {
                      setDragSource({ type: 'tab', id: tab.id });
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', tab.id);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = 'move';
                      const rect = e.currentTarget.getBoundingClientRect();
                      const isAfter = e.clientX > rect.left + rect.width / 2;
                      setDropIndicator({
                        targetTabId: tab.id,
                        position: isAfter ? 'after' : 'before',
                      });
                    }}
                    onDragLeave={(e) => {
                      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                      if (dropIndicator?.targetTabId === tab.id) {
                        setDropIndicator(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!dragSource || !dropIndicator) return;
                      if (dragSource.type === 'tab') {
                        reorderTabs(dragSource.id, tab.id, dropIndicator.position, true);
                      } else if (dragSource.type === 'group') {
                        moveTabGroup(dragSource.id, tab.id, dropIndicator.position);
                      }
                      setDragSource(null);
                      setDropIndicator(null);
                    }}
                    onDragEnd={() => {
                      setDragSource(null);
                      setDropIndicator(null);
                    }}
                    onClick={() => {
                      if (!isEditing && !isActive) switchTab(tab.id);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (!isEditing) handleStartTabRename(tab);
                    }}
                    onContextMenu={(e) => handleOpenTabContextMenu(e, tab)}
                    className={`group relative h-6 sm:h-6.5 px-2 py-0.5 rounded-md flex items-center gap-1.5 transition-all select-none shrink-0 cursor-pointer ${
                      isDropTarget && dropIndicator.position === 'before'
                        ? 'border-l-2 border-l-blue-500 pl-1.5'
                        : ''
                    } ${
                      isDropTarget && dropIndicator.position === 'after'
                        ? 'border-r-2 border-r-blue-500 pr-1.5'
                        : ''
                    } ${
                      isActive || isEditing
                        ? 'bg-white dark:bg-slate-800 shadow-xs border border-slate-200/90 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-semibold'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 font-medium'
                    }`}
                    title={`${tab.title} — Duplo clique para renomear, arraste para reordenar`}
                  >
                    {isEditing ? (
                      <div className="inline-grid items-center min-w-[110px] sm:min-w-[140px] max-w-[calc(100vw-4.5rem)] sm:max-w-[680px]">
                        <span
                          aria-hidden="true"
                          className="invisible col-start-1 row-start-1 whitespace-pre text-[11px] sm:text-xs font-semibold px-1.5 py-0 border border-transparent pointer-events-none select-none overflow-hidden"
                        >
                          {`${editingTitle || ' '}\u00A0\u00A0`}
                        </span>
                        <input
                          ref={tabRenameInputRef}
                          type="text"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onBlur={handleFinishTabRename}
                          onKeyDown={handleTabRenameKeyDown}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          aria-label="Renomear arquivo"
                          className="col-start-1 row-start-1 w-full min-w-0 select-text text-[11px] sm:text-xs font-semibold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 border border-blue-500 rounded px-1.5 py-0 outline-none shadow-xs"
                        />
                      </div>
                    ) : (
                      <MiddleEllipsisText
                        text={tab.title}
                        showTooltip={false}
                        className="text-[11px] sm:text-xs max-w-[120px] sm:max-w-[180px] md:max-w-[240px]"
                      />
                    )}

                    <button
                      type="button"
                      onClick={(e) => onRequestCloseTab(e, tab)}
                      onDoubleClick={(e) => e.stopPropagation()}
                      className="w-3.5 h-3.5 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                      title={tab.isDirty ? 'Fechar aba (alterações não salvas)' : 'Fechar aba'}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* New Tab (+) Button */}
        <button
          type="button"
          onClick={onNewFile}
          title="Nova aba (novo arquivo em branco)"
          className="w-6 h-6 rounded flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-purple-600 dark:hover:text-purple-400 transition-colors shrink-0 cursor-pointer ml-0.5"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tab Context Menu (Right Click on Tab) */}
      {tabContextMenu && (() => {
        const targetTab = tabs.find((t) => t.id === tabContextMenu.tabId);
        if (!targetTab) return null;
        const currentGroup = targetTab.groupId ? tabGroups.find((g) => g.id === targetTab.groupId) : null;
        const otherGroups = tabGroups.filter((g) => g.id !== targetTab.groupId);

        return (
          <div
            ref={tabContextMenuRef}
            style={{ top: `${tabContextMenu.y}px`, left: `${tabContextMenu.x}px` }}
            className="fixed z-50 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 p-1.5 space-y-1 animate-in fade-in zoom-in-95 text-xs font-medium"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                setTabContextMenu(null);
                handleStartTabRename(targetTab);
              }}
              className="w-full px-2 py-1.5 text-left rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5 text-slate-400" />
              Renomear
            </button>

            <button
              type="button"
              onClick={(e) => {
                setTabContextMenu(null);
                onRequestCloseTab(e, targetTab);
              }}
              className="w-full px-2 py-1.5 text-left rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center gap-2 text-red-600 dark:text-red-400 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              Fechar aba
            </button>

            <div className="border-t border-slate-200 dark:border-slate-700 my-1" />

            {/* Tab Group Section */}
            {currentGroup ? (
              <div className="space-y-1.5 py-0.5">
                <div className="px-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full border ${getHighlightColorOption(currentGroup.color).borderClass} ${getHighlightColorOption(currentGroup.color).bgClass}`}
                  />
                  <span>Grupo: {currentGroup.title}</span>
                </div>

                <div className="px-2 py-1 bg-slate-50 dark:bg-slate-900/60 rounded-lg">
                  <span className="block text-[10px] text-slate-400 mb-1">Mudar cor da borda:</span>
                  <HighlightColorSwatches
                    activeColor={currentGroup.color}
                    onSelectColor={(color) => {
                      updateTabGroup(currentGroup.id, { color });
                      setTabContextMenu(null);
                    }}
                    titlePrefix="Mudar cor do grupo para"
                    size="sm"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setTabContextMenu(null);
                    handleStartGroupRename(currentGroup);
                  }}
                  className="w-full px-2 py-1 text-left rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 text-slate-700 dark:text-slate-200 cursor-pointer text-xs"
                >
                  <Pencil className="w-3 h-3 text-slate-400" />
                  Renomear grupo
                </button>

                <button
                  type="button"
                  onClick={() => {
                    assignTabToGroup(targetTab.id, null);
                    setTabContextMenu(null);
                  }}
                  className="w-full px-2 py-1 text-left rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 text-slate-700 dark:text-slate-200 cursor-pointer text-xs"
                >
                  <FolderMinus className="w-3 h-3 text-slate-400" />
                  Remover do grupo
                </button>

                <button
                  type="button"
                  onClick={() => {
                    ungroupTabs(currentGroup.id);
                    setTabContextMenu(null);
                  }}
                  className="w-full px-2 py-1 text-left rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 text-amber-600 dark:text-amber-400 cursor-pointer text-xs"
                >
                  <FolderMinus className="w-3 h-3 text-amber-500" />
                  Desagrupar tudo
                </button>
              </div>
            ) : (
              <div className="space-y-1.5 py-0.5">
                <div className="px-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Novo grupo com esta aba
                </div>
                <div className="px-2 py-1 bg-slate-50 dark:bg-slate-900/60 rounded-lg">
                  <HighlightColorSwatches
                    onSelectColor={(color: HighlightColor) => {
                      createTabGroup([targetTab.id], { color, title: 'Grupo' });
                      setTabContextMenu(null);
                    }}
                    titlePrefix="Criar grupo com borda"
                    size="sm"
                  />
                </div>
              </div>
            )}

            {/* Move to another existing group */}
            {otherGroups.length > 0 && (
              <div className="pt-1 border-t border-slate-100 dark:border-slate-700/60 space-y-0.5">
                <div className="px-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Mover para grupo...
                </div>
                {otherGroups.map((g) => {
                  const cOpt = getHighlightColorOption(g.color);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => {
                        assignTabToGroup(targetTab.id, g.id);
                        updateTabGroup(g.id, { collapsed: false });
                        setTabContextMenu(null);
                      }}
                      className="w-full px-2 py-1 text-left rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 text-slate-700 dark:text-slate-200 cursor-pointer text-xs"
                    >
                      <span className={`w-2.5 h-2.5 rounded-full border ${cOpt.borderClass} ${cOpt.bgClass} shrink-0`} />
                      <span className="truncate">{g.title}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Group Popover / Context Menu */}
      {groupPopover && (() => {
        const group = tabGroups.find((g) => g.id === groupPopover.groupId);
        if (!group) return null;

        return (
          <div
            ref={groupPopoverRef}
            style={{ top: `${groupPopover.y}px`, left: `${groupPopover.x}px` }}
            className="fixed z-50 w-60 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 p-2.5 space-y-2.5 animate-in fade-in zoom-in-95 text-xs font-medium"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Quick Title Edit */}
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                Nome do Grupo
              </label>
              <input
                type="text"
                value={group.title}
                onChange={(e) => updateTabGroup(group.id, { title: e.target.value })}
                className="w-full px-2 py-1 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 outline-none focus:border-blue-500"
                placeholder="Nome do grupo..."
              />
            </div>

            {/* Border Color Swatches */}
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                Cor da Borda
              </label>
              <div className="p-1.5 bg-slate-50 dark:bg-slate-900/60 rounded-lg flex items-center justify-center">
                <HighlightColorSwatches
                  activeColor={group.color}
                  onSelectColor={(color) => updateTabGroup(group.id, { color })}
                  titlePrefix="Cor da borda:"
                  size="sm"
                />
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 pt-1 space-y-1">
              <button
                type="button"
                onClick={() => {
                  handleNewTabInGroup(group.id);
                  setGroupPopover(null);
                }}
                className="w-full px-2 py-1.5 text-left rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 text-slate-700 dark:text-slate-200 cursor-pointer text-xs"
              >
                <FolderPlus className="w-3.5 h-3.5 text-purple-500" />
                Nova aba no grupo
              </button>

              <button
                type="button"
                onClick={() => {
                  ungroupTabs(group.id);
                  setGroupPopover(null);
                }}
                className="w-full px-2 py-1.5 text-left rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center gap-2 text-red-600 dark:text-red-400 cursor-pointer text-xs"
              >
                <FolderMinus className="w-3.5 h-3.5" />
                Desagrupar abas
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
