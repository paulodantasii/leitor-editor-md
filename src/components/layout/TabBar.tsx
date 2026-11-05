import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/useAppStore';
import { TabItem, TabGroup, HighlightColor } from '../../types';
import { getHighlightColorOption, HighlightPopover } from '../editor/HighlightPopover';
import { MiddleEllipsisText } from '../ui/MiddleEllipsisText';
import { saveCoordinator } from '../../services/saveCoordinator';
import { isHomeTab } from '../../services/documentUtils';
import { X, Plus, Home } from 'lucide-react';

interface TabBarProps {
  onRequestCloseTab: (e: React.MouseEvent, tab: TabItem) => void;
  onNewTab: () => void;
}

type TabRenderSegment =
  | { type: 'single'; tab: TabItem }
  | { type: 'group'; group: TabGroup; tabs: TabItem[] };

type DropZonePosition = 'before' | 'group' | 'after';

export const TabBar: React.FC<TabBarProps> = ({ onRequestCloseTab, onNewTab }) => {
  const {
    tabs,
    activeTabId,
    tabGroups,
    switchTab,
    renameTab,
    reorderTabs,
    moveTabGroup,
    createTabGroup,
    assignTabToGroup,
    updateTabGroup,
    ungroupTabs,
  } = useAppStore(
    useShallow((state) => ({
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      tabGroups: state.tabGroups,
      switchTab: state.switchTab,
      renameTab: state.renameTab,
      reorderTabs: state.reorderTabs,
      moveTabGroup: state.moveTabGroup,
      createTabGroup: state.createTabGroup,
      assignTabToGroup: state.assignTabToGroup,
      updateTabGroup: state.updateTabGroup,
      ungroupTabs: state.ungroupTabs,
    }))
  );

  // Inline Tab Rename State
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const tabRenameInputRef = useRef<HTMLInputElement>(null);
  const isCancelingRenameRef = useRef(false);

  // Inline Group Rename State
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupTitle, setEditingGroupTitle] = useState('');
  const groupRenameInputRef = useRef<HTMLInputElement>(null);
  const groupClickTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Floating HighlightPopover State for Group Border Color & Ungroup
  const [colorPickerPopover, setColorPickerPopover] = useState<{
    groupId: string;
    x: number;
    y: number;
  } | null>(null);
  const popoverContainerRef = useRef<HTMLDivElement>(null);

  // Drag & Drop State (shared by Mouse HTML5 DnD and iPad Touch Drag)
  const [dragSource, setDragSource] = useState<
    { type: 'tab'; id: string } | { type: 'group'; id: string } | null
  >(null);
  const [dropIndicator, setDropIndicator] = useState<{
    targetTabId: string;
    position: DropZonePosition;
  } | null>(null);
  const [chipDropTargetGroupId, setChipDropTargetGroupId] = useState<string | null>(null);

  // Touch drag refs for iPad
  const touchHoldTimerRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartCoordsRef = useRef<{ x: number; y: number } | null>(null);
  const isTouchDraggingRef = useRef(false);

  // Close color picker popover when clicking/touching outside or pressing Escape
  useEffect(() => {
    if (!colorPickerPopover) return;

    const handleOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (popoverContainerRef.current && !popoverContainerRef.current.contains(target)) {
        setColorPickerPopover(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setColorPickerPopover(null);
      }
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside, { passive: true });
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [colorPickerPopover]);

  // Helper to open the HighlightPopover anchored below a group chip or tab element
  const openGroupColorPopoverAtElement = useCallback((groupId: string, el: HTMLElement | null) => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(140, Math.min(rect.left + rect.width / 2, window.innerWidth - 140));
    const y = rect.bottom + 6;
    setColorPickerPopover({ groupId, x, y });
  }, []);

  // Tab renaming handlers
  const handleStartTabRename = (tab: TabItem) => {
    if (isHomeTab(tab)) return;
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

  // Group renaming handlers
  const handleStartGroupRename = (group: TabGroup) => {
    if (groupClickTimerRef.current) {
      clearTimeout(groupClickTimerRef.current);
      groupClickTimerRef.current = null;
    }
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

  // Compute drop zone ('before' | 'group' | 'after') from pointer X inside a tab element
  const computeTabDropZone = (
    clientX: number,
    rect: DOMRect,
    source: { type: 'tab'; id: string } | { type: 'group'; id: string } | null,
    targetTab: TabItem
  ): DropZonePosition => {
    const ratio = (clientX - rect.left) / Math.max(rect.width, 1);

    // Only allow 'group' center drop when dragging a different tab
    const canDropToGroup =
      source?.type === 'tab' &&
      source.id !== targetTab.id &&
      !(targetTab.groupId && tabs.find((t) => t.id === source.id)?.groupId === targetTab.groupId);

    if (canDropToGroup && ratio >= 0.28 && ratio <= 0.72) {
      return 'group';
    }
    return ratio < 0.5 ? 'before' : 'after';
  };

  // Execute drop on a target tab
  const executeDropOnTab = useCallback(
    (
      source: { type: 'tab'; id: string } | { type: 'group'; id: string },
      targetTab: TabItem,
      position: DropZonePosition,
      targetElement: HTMLElement | null
    ) => {
      if (source.type === 'group') {
        const edgePos = position === 'after' ? 'after' : 'before';
        moveTabGroup(source.id, targetTab.id, edgePos);
        return;
      }

      if (source.id === targetTab.id) return;

      if (position === 'group') {
        if (targetTab.groupId) {
          // Target tab already in a group -> join that group right after targetTab
          reorderTabs(source.id, targetTab.id, 'after', true);
          updateTabGroup(targetTab.groupId, { collapsed: false });
        } else {
          // Neither tab (or target tab) has a group -> create new group with both and pop color picker!
          const newGroupId = createTabGroup([targetTab.id, source.id], { title: 'Grupo' });
          if (newGroupId) {
            requestAnimationFrame(() => {
              const chipEl = document.querySelector(
                `[data-group-chip-id="${newGroupId}"]`
              ) as HTMLElement | null;
              openGroupColorPopoverAtElement(newGroupId, chipEl || targetElement);
            });
          }
        }
        return;
      }

      // Edge reorder ('before' | 'after'): adopt targetTab's group membership (so dragging inside a group joins it, dragging outside leaves it)
      reorderTabs(source.id, targetTab.id, position, true);
    },
    [createTabGroup, moveTabGroup, openGroupColorPopoverAtElement, reorderTabs, updateTabGroup]
  );

  // Execute drop on a group header chip
  const executeDropOnGroupChip = useCallback(
    (source: { type: 'tab'; id: string } | { type: 'group'; id: string }, group: TabGroup) => {
      if (source.type === 'tab') {
        assignTabToGroup(source.id, group.id);
        updateTabGroup(group.id, { collapsed: false });
      } else if (source.type === 'group' && source.id !== group.id) {
        const firstGroupTab = tabs.find((t) => t.groupId === group.id);
        if (firstGroupTab) {
          moveTabGroup(source.id, firstGroupTab.id, 'before');
        }
      }
    },
    [assignTabToGroup, moveTabGroup, tabs, updateTabGroup]
  );

  // iPad / Touch Drag Handlers
  const handleTouchStartItem = (
    e: React.TouchEvent,
    source: { type: 'tab'; id: string } | { type: 'group'; id: string },
    isEditing: boolean
  ) => {
    if (isEditing) return;
    const touch = e.touches[0];
    if (!touch) return;

    touchStartCoordsRef.current = { x: touch.clientX, y: touch.clientY };
    isTouchDraggingRef.current = false;

    if (touchHoldTimerRef.current) clearTimeout(touchHoldTimerRef.current);
    touchHoldTimerRef.current = setTimeout(() => {
      isTouchDraggingRef.current = true;
      setDragSource(source);
    }, 180);
  };

  const handleTouchMoveItem = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;

    if (!isTouchDraggingRef.current) {
      if (touchStartCoordsRef.current) {
        const dx = Math.abs(touch.clientX - touchStartCoordsRef.current.x);
        const dy = Math.abs(touch.clientY - touchStartCoordsRef.current.y);
        if (dx > 8 || dy > 8) {
          if (touchHoldTimerRef.current) {
            clearTimeout(touchHoldTimerRef.current);
            touchHoldTimerRef.current = null;
          }
        }
      }
      return;
    }

    if (!dragSource) return;
    e.preventDefault();

    const elUnderFinger = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;
    if (!elUnderFinger) return;

    const groupChipEl = elUnderFinger.closest('[data-group-chip-id]') as HTMLElement | null;
    if (groupChipEl) {
      const targetGroupId = groupChipEl.getAttribute('data-group-chip-id');
      setChipDropTargetGroupId(targetGroupId);
      setDropIndicator(null);
      return;
    }

    setChipDropTargetGroupId(null);
    const tabEl = elUnderFinger.closest('[data-tab-id]') as HTMLElement | null;
    if (tabEl) {
      const targetTabId = tabEl.getAttribute('data-tab-id');
      const targetTab = tabs.find((t) => t.id === targetTabId);
      if (targetTab) {
        const rect = tabEl.getBoundingClientRect();
        const zone = computeTabDropZone(touch.clientX, rect, dragSource, targetTab);
        setDropIndicator({ targetTabId: targetTab.id, position: zone });
        return;
      }
    }

    setDropIndicator(null);
  };

  const handleTouchEndItem = () => {
    if (touchHoldTimerRef.current) {
      clearTimeout(touchHoldTimerRef.current);
      touchHoldTimerRef.current = null;
    }

    if (isTouchDraggingRef.current && dragSource) {
      if (chipDropTargetGroupId) {
        const targetGroup = tabGroups.find((g) => g.id === chipDropTargetGroupId);
        if (targetGroup) {
          executeDropOnGroupChip(dragSource, targetGroup);
        }
      } else if (dropIndicator) {
        const targetTab = tabs.find((t) => t.id === dropIndicator.targetTabId);
        const tabEl = document.querySelector(
          `[data-tab-id="${dropIndicator.targetTabId}"]`
        ) as HTMLElement | null;
        if (targetTab) {
          executeDropOnTab(dragSource, targetTab, dropIndicator.position, tabEl);
        }
      }
    }

    isTouchDraggingRef.current = false;
    touchStartCoordsRef.current = null;
    setDragSource(null);
    setDropIndicator(null);
    setChipDropTargetGroupId(null);
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
        if (currentGroupSegment) segments.push(currentGroupSegment);
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
  if (currentGroupSegment) segments.push(currentGroupSegment);

  // Render a single tab item (used both standalone and inside a group)
  const renderTabPill = (tab: TabItem) => {
    const isActive = tab.id === activeTabId;
    const isEditing = editingTabId === tab.id;
    const isHome = isHomeTab(tab);
    const isDropTarget = dropIndicator?.targetTabId === tab.id;
    const dropPos = isDropTarget ? dropIndicator.position : null;

    return (
      <div
        key={tab.id}
        data-tab-id={tab.id}
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
          const zone = computeTabDropZone(e.clientX, rect, dragSource, tab);
          setDropIndicator({ targetTabId: tab.id, position: zone });
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
          if (dragSource && dropIndicator) {
            executeDropOnTab(dragSource, tab, dropIndicator.position, e.currentTarget);
          }
          setDragSource(null);
          setDropIndicator(null);
        }}
        onDragEnd={() => {
          setDragSource(null);
          setDropIndicator(null);
        }}
        onTouchStart={(e) => handleTouchStartItem(e, { type: 'tab', id: tab.id }, isEditing)}
        onTouchMove={handleTouchMoveItem}
        onTouchEnd={handleTouchEndItem}
        onClick={() => {
          if (!isEditing && !isActive) switchTab(tab.id);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (!isEditing && !isHome) handleStartTabRename(tab);
        }}
        className={`group relative h-6 sm:h-6.5 px-2 py-0.5 rounded-md flex items-center gap-1.5 transition-all select-none shrink-0 cursor-pointer ${
          dropPos === 'before' ? 'border-l-2 border-l-blue-500 pl-1.5' : ''
        } ${dropPos === 'after' ? 'border-r-2 border-r-blue-500 pr-1.5' : ''} ${
          dropPos === 'group'
            ? 'ring-2 ring-amber-400 bg-amber-50/70 dark:bg-amber-950/40 scale-[1.03]'
            : ''
        } ${
          isActive || isEditing
            ? 'bg-white dark:bg-slate-800 shadow-xs border border-slate-200/90 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-semibold'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 font-medium'
        }`}
        title={
          isHome
            ? 'Tela inicial — Arraste para ordenar ou agrupar'
            : `${tab.title} — Arraste para as bordas para ordenar ou para o centro de outra aba para agrupar`
        }
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
        ) : isHome ? (
          <span className="flex items-center gap-1 text-[11px] sm:text-xs">
            <Home className="w-3 h-3 shrink-0" />
            <span>{tab.title}</span>
          </span>
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
  };

  const activePopoverGroup = colorPickerPopover
    ? tabGroups.find((g) => g.id === colorPickerPopover.groupId)
    : null;

  return (
    <div className="h-7 sm:h-8 bg-slate-50/80 dark:bg-slate-950/40 border-t border-slate-200/80 dark:border-slate-800/80 flex items-center px-3 py-0.5">
      <div className="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 max-w-7xl mx-auto w-full">
        {segments.map((segment) => {
          if (segment.type === 'single') {
            return renderTabPill(segment.tab);
          }

          const { group, tabs: groupTabs } = segment;
          const colorOption = getHighlightColorOption(group.color);
          const isGroupEditing = editingGroupId === group.id;
          const isCollapsed = Boolean(group.collapsed);

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
              {/* Clean Group Header Chip: [ ● Nome ] */}
              <div
                data-group-chip-id={group.id}
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
                  if (dragSource) {
                    executeDropOnGroupChip(dragSource, group);
                  }
                  setDragSource(null);
                  setDropIndicator(null);
                }}
                onDragEnd={() => {
                  setDragSource(null);
                  setDropIndicator(null);
                  setChipDropTargetGroupId(null);
                }}
                onTouchStart={(e) =>
                  handleTouchStartItem(e, { type: 'group', id: group.id }, isGroupEditing)
                }
                onTouchMove={handleTouchMoveItem}
                onTouchEnd={handleTouchEndItem}
                onClick={(e) => {
                  if (isGroupEditing) return;
                  e.stopPropagation();
                  // Delay single click slightly so double click can cancel it cleanly
                  if (groupClickTimerRef.current) {
                    clearTimeout(groupClickTimerRef.current);
                  }
                  groupClickTimerRef.current = setTimeout(() => {
                    groupClickTimerRef.current = null;
                    updateTabGroup(group.id, { collapsed: !isCollapsed });
                  }, 180);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!isGroupEditing) handleStartGroupRename(group);
                }}
                className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer select-none"
                title={`${group.title} — Toque na bolinha para cor/desagrupar, toque no nome para recolher, duplo toque para renomear`}
              >
                {/* Color Dot: 1 tap opens the HighlightPopover pill */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (groupClickTimerRef.current) {
                      clearTimeout(groupClickTimerRef.current);
                      groupClickTimerRef.current = null;
                    }
                    if (colorPickerPopover?.groupId === group.id) {
                      setColorPickerPopover(null);
                    } else {
                      openGroupColorPopoverAtElement(group.id, e.currentTarget);
                    }
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  title="Escolher cor da borda ou desfazer grupo"
                  className={`w-3 h-3 rounded-full border ${colorOption.borderClass} ${colorOption.bgClass} transition-transform hover:scale-125 active:scale-95 shrink-0 cursor-pointer`}
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
                  <span className="text-[11px] sm:text-xs font-bold text-slate-700 dark:text-slate-200 max-w-[110px] truncate">
                    {group.title}
                  </span>
                )}

                {isCollapsed && (
                  <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-400">
                    ({groupTabs.length})
                  </span>
                )}
              </div>

              {/* Group Tabs */}
              {visibleTabs.map((tab) => renderTabPill(tab))}
            </div>
          );
        })}

        {/* New Tab (+) Button — also serves as drop target to pull a tab out of a group to the end */}
        <button
          type="button"
          onClick={onNewTab}
          onDragOver={(e) => {
            if (dragSource?.type === 'tab') {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }
          }}
          onDrop={(e) => {
            if (dragSource?.type === 'tab') {
              e.preventDefault();
              assignTabToGroup(dragSource.id, null);
              setDragSource(null);
              setDropIndicator(null);
            }
          }}
          title="Nova aba (tela inicial)"
          className="w-6 h-6 rounded flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-purple-600 dark:hover:text-purple-400 transition-colors shrink-0 cursor-pointer ml-0.5"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Reused HighlightPopover Pill for Group Color Selection & Ungrouping */}
      {colorPickerPopover && activePopoverGroup && (
        <div
          ref={popoverContainerRef}
          style={{
            position: 'fixed',
            top: `${colorPickerPopover.y}px`,
            left: `${colorPickerPopover.x}px`,
            transform: 'translateX(-50%)',
          }}
          className="z-50 animate-in fade-in zoom-in-95 duration-150"
        >
          <HighlightPopover
            activeColor={activePopoverGroup.color}
            onSelectColor={(color: HighlightColor) => {
              updateTabGroup(activePopoverGroup.id, { color });
            }}
            onRemoveHighlight={() => {
              ungroupTabs(activePopoverGroup.id);
              setColorPickerPopover(null);
            }}
            onClose={() => setColorPickerPopover(null)}
          />
        </div>
      )}
    </div>
  );
};
