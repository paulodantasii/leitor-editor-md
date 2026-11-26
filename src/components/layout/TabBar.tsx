import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/useAppStore';
import { TabItem, TabGroup, HighlightColor } from '../../types';
import { getHighlightColorOption, HighlightPopover } from '../editor/HighlightPopover';
import { abbreviateMiddle } from '../../services/displayName';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { saveCoordinator } from '../../services/saveCoordinator';
import { isHomeTab } from '../../services/documentUtils';
import { X, Plus, Home } from 'lucide-react';

const TAB_LABEL_MAX_CHARS = {
  wide: { active: 48, inactive: 28 },
  narrow: { active: 30, inactive: 18 },
} as const;

interface TabBarProps {
  onRequestCloseTab: (e: React.MouseEvent, tab: TabItem) => void;
  onNewTab: () => void;
}

type TabRenderSegment =
  | { type: 'single'; tab: TabItem }
  | { type: 'group'; group: TabGroup; tabs: TabItem[] };

export type DropZonePosition = 'before' | 'group' | 'after';

export type TabDragSource = { type: 'tab'; id: string } | { type: 'group'; id: string };

export type HorizontalRect = { left: number; right: number; width: number };

export type RenderedTabRect = {
  tab: TabItem;
  rect: HorizontalRect;
};

export type RenderedSegmentRect = {
  type: 'single' | 'group';
  groupId?: string;
  collapsed?: boolean;
  rect: HorizontalRect;
  chipRect?: HorizontalRect | null;
  firstTab: TabItem;
  lastTab: TabItem;
  tabs: TabItem[];
};

export type ResolvedTabBarDropTarget =
  | {
      kind: 'tab';
      targetTabId: string;
      position: DropZonePosition;
      outsideGroup: boolean;
    }
  | {
      kind: 'group-chip';
      groupId: string;
    }
  | null;

export function computeTabDropZone(
  clientX: number,
  rect: HorizontalRect,
  source: TabDragSource | null,
  targetTab: TabItem,
  allTabs: TabItem[]
): DropZonePosition {
  const ratio = (clientX - rect.left) / Math.max(rect.width, 1);

  // Only allow 'group' center drop when dragging a different tab
  const canDropToGroup =
    source?.type === 'tab' &&
    source.id !== targetTab.id &&
    !(targetTab.groupId && allTabs.find((t) => t.id === source.id)?.groupId === targetTab.groupId);

  if (canDropToGroup && ratio >= 0.28 && ratio <= 0.72) {
    return 'group';
  }
  return ratio < 0.5 ? 'before' : 'after';
}

export function resolveTabBarDropTarget(params: {
  clientX: number;
  source: TabDragSource | null;
  tabs: TabItem[];
  tabRects: RenderedTabRect[];
  segmentRects: RenderedSegmentRect[];
}): ResolvedTabBarDropTarget {
  const { clientX, source, tabs, tabRects, segmentRects } = params;
  if (!source || tabs.length === 0 || segmentRects.length === 0) return null;

  // 1. Verificação de impacto direto em chip de grupo
  for (const seg of segmentRects) {
    if (
      seg.type === 'group' &&
      seg.groupId &&
      seg.chipRect &&
      clientX >= seg.chipRect.left &&
      clientX <= seg.chipRect.right
    ) {
      if (source.type === 'group' && source.id === seg.groupId) {
        return null;
      }
      return { kind: 'group-chip', groupId: seg.groupId };
    }
  }

  // 2. Verificação de impacto direto em uma aba renderizada
  for (const tr of tabRects) {
    if (clientX > tr.rect.left && clientX < tr.rect.right) {
      return {
        kind: 'tab',
        targetTabId: tr.tab.id,
        position: computeTabDropZone(clientX, tr.rect, source, tr.tab, tabs),
        outsideGroup: false,
      };
    }
  }

  // 3. Verificação de vão interno dentro de um grupo
  for (const seg of segmentRects) {
    if (seg.type === 'group' && clientX > seg.rect.left && clientX < seg.rect.right) {
      const groupTabRects = tabRects.filter((tr) => tr.tab.groupId === seg.groupId);
      if (groupTabRects.length > 0) {
        if (clientX <= groupTabRects[0].rect.left) {
          return {
            kind: 'tab',
            targetTabId: groupTabRects[0].tab.id,
            position: 'before',
            outsideGroup: false,
          };
        }

        const lastGroupTab = groupTabRects[groupTabRects.length - 1];
        if (clientX >= lastGroupTab.rect.right) {
          return {
            kind: 'tab',
            targetTabId: lastGroupTab.tab.id,
            position: 'after',
            outsideGroup: false,
          };
        }

        for (let i = 0; i < groupTabRects.length - 1; i++) {
          const cur = groupTabRects[i];
          const nxt = groupTabRects[i + 1];
          if (clientX >= cur.rect.right && clientX <= nxt.rect.left) {
            const midpoint = (cur.rect.right + nxt.rect.left) / 2;
            return clientX <= midpoint
              ? { kind: 'tab', targetTabId: cur.tab.id, position: 'after', outsideGroup: false }
              : { kind: 'tab', targetTabId: nxt.tab.id, position: 'before', outsideGroup: false };
          }
        }
      }

      const center = (seg.rect.left + seg.rect.right) / 2;
      return clientX < center
        ? { kind: 'tab', targetTabId: seg.firstTab.id, position: 'before', outsideGroup: true }
        : { kind: 'tab', targetTabId: seg.lastTab.id, position: 'after', outsideGroup: true };
    }
  }

  // 4. Posições antes do 1º segmento, depois do último segmento e vãos externos
  const firstSegment = segmentRects[0];
  if (clientX <= firstSegment.rect.left) {
    return {
      kind: 'tab',
      targetTabId: firstSegment.firstTab.id,
      position: 'before',
      outsideGroup: true,
    };
  }

  const lastSegment = segmentRects[segmentRects.length - 1];
  if (clientX >= lastSegment.rect.right) {
    return {
      kind: 'tab',
      targetTabId: lastSegment.lastTab.id,
      position: 'after',
      outsideGroup: true,
    };
  }

  for (let i = 0; i < segmentRects.length - 1; i++) {
    const cur = segmentRects[i];
    const nxt = segmentRects[i + 1];
    if (clientX >= cur.rect.right && clientX <= nxt.rect.left) {
      const midpoint = (cur.rect.right + nxt.rect.left) / 2;
      return clientX <= midpoint
        ? { kind: 'tab', targetTabId: cur.lastTab.id, position: 'after', outsideGroup: true }
        : { kind: 'tab', targetTabId: nxt.firstTab.id, position: 'before', outsideGroup: true };
    }
  }

  return null;
}

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

  // Responsive char budget for tab labels
  const isWide = useMediaQuery('(min-width: 768px)');

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
  const [dragSource, setDragSource] = useState<TabDragSource | null>(null);
  const dragSourceRef = useRef<TabDragSource | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    targetTabId: string;
    position: DropZonePosition;
    outsideGroup?: boolean;
  } | null>(null);
  const [chipDropTargetGroupId, setChipDropTargetGroupId] = useState<string | null>(null);
  const tabBarContainerRef = useRef<HTMLDivElement>(null);

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

  // Build contiguous render segments
  const segments = useMemo<TabRenderSegment[]>(() => {
    const result: TabRenderSegment[] = [];
    const groupMap = new Map(tabGroups.map((g) => [g.id, g]));
    let currentGroupSegment: { type: 'group'; group: TabGroup; tabs: TabItem[] } | null = null;

    for (const tab of tabs) {
      if (tab.groupId && groupMap.has(tab.groupId)) {
        const group = groupMap.get(tab.groupId)!;
        if (currentGroupSegment && currentGroupSegment.group.id === tab.groupId) {
          currentGroupSegment.tabs.push(tab);
        } else {
          if (currentGroupSegment) result.push(currentGroupSegment);
          currentGroupSegment = { type: 'group', group, tabs: [tab] };
        }
      } else {
        if (currentGroupSegment) {
          result.push(currentGroupSegment);
          currentGroupSegment = null;
        }
        result.push({ type: 'single', tab });
      }
    }
    if (currentGroupSegment) result.push(currentGroupSegment);
    return result;
  }, [tabs, tabGroups]);

  const findTabElementById = useCallback((tabId: string): HTMLElement | null => {
    const root = tabBarContainerRef.current ?? document;
    const elements = root.querySelectorAll<HTMLElement>('[data-tab-id]');
    for (const el of elements) {
      if (el.getAttribute('data-tab-id') === tabId) return el;
    }
    return null;
  }, []);

  const clearDragState = useCallback(() => {
    dragSourceRef.current = null;
    setDragSource(null);
    setDropIndicator(null);
    setChipDropTargetGroupId(null);
  }, []);

  const resolveDropTargetAtClientX = useCallback(
    (clientX: number, currentSource: TabDragSource | null): ResolvedTabBarDropTarget => {
      const containerEl = tabBarContainerRef.current;
      if (!containerEl || !currentSource || segments.length === 0) return null;

      const toHorizontalRect = (r: DOMRect): HorizontalRect => ({
        left: r.left,
        right: r.right,
        width: r.width,
      });

      const tabElMap = new Map<string, HorizontalRect>();
      containerEl.querySelectorAll<HTMLElement>('[data-tab-id]').forEach((el) => {
        const id = el.getAttribute('data-tab-id');
        if (id) tabElMap.set(id, toHorizontalRect(el.getBoundingClientRect()));
      });

      const tabRects: RenderedTabRect[] = [];
      for (const tab of tabs) {
        const rect = tabElMap.get(tab.id);
        if (rect) tabRects.push({ tab, rect });
      }

      const groupContainerMap = new Map<string, HorizontalRect>();
      containerEl.querySelectorAll<HTMLElement>('[data-group-container-id]').forEach((el) => {
        const id = el.getAttribute('data-group-container-id');
        if (id) groupContainerMap.set(id, toHorizontalRect(el.getBoundingClientRect()));
      });

      const groupChipMap = new Map<string, HorizontalRect>();
      containerEl.querySelectorAll<HTMLElement>('[data-group-chip-id]').forEach((el) => {
        const id = el.getAttribute('data-group-chip-id');
        if (id) groupChipMap.set(id, toHorizontalRect(el.getBoundingClientRect()));
      });

      const segmentRects: RenderedSegmentRect[] = [];
      for (const segment of segments) {
        if (segment.type === 'single') {
          const rect = tabElMap.get(segment.tab.id);
          if (rect) {
            segmentRects.push({
              type: 'single',
              rect,
              firstTab: segment.tab,
              lastTab: segment.tab,
              tabs: [segment.tab],
            });
          }
        } else if (segment.tabs.length > 0) {
          const rect = groupContainerMap.get(segment.group.id);
          if (rect) {
            segmentRects.push({
              type: 'group',
              groupId: segment.group.id,
              collapsed: Boolean(segment.group.collapsed),
              rect,
              chipRect: groupChipMap.get(segment.group.id) ?? null,
              firstTab: segment.tabs[0],
              lastTab: segment.tabs[segment.tabs.length - 1],
              tabs: segment.tabs,
            });
          }
        }
      }

      return resolveTabBarDropTarget({
        clientX,
        source: currentSource,
        tabs,
        tabRects,
        segmentRects,
      });
    },
    [segments, tabs]
  );

  const applyResolvedDropTarget = useCallback((resolved: ResolvedTabBarDropTarget) => {
    if (!resolved) {
      setChipDropTargetGroupId(null);
      setDropIndicator(null);
      return;
    }

    if (resolved.kind === 'group-chip') {
      setChipDropTargetGroupId(resolved.groupId);
      setDropIndicator(null);
      return;
    }

    setChipDropTargetGroupId(null);
    setDropIndicator((prev) =>
      prev &&
      prev.targetTabId === resolved.targetTabId &&
      prev.position === resolved.position &&
      Boolean(prev.outsideGroup) === resolved.outsideGroup
        ? prev
        : {
            targetTabId: resolved.targetTabId,
            position: resolved.position,
            outsideGroup: resolved.outsideGroup,
          }
    );
  }, []);

  // Execute drop on a target tab
  const executeDropOnTab = useCallback(
    (
      source: TabDragSource,
      targetTab: TabItem,
      position: DropZonePosition,
      targetElement: HTMLElement | null,
      outsideGroup = false
    ) => {
      if (source.type === 'group') {
        const edgePos = position === 'after' ? 'after' : 'before';
        moveTabGroup(source.id, targetTab.id, edgePos);
        return;
      }

      if (source.id === targetTab.id && !outsideGroup) return;

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

      // Edge reorder ('before' | 'after'): adopt targetTab's group membership when inside, or ungroup when dropped outside
      reorderTabs(source.id, targetTab.id, position, outsideGroup ? 'ungroup' : true);
    },
    [createTabGroup, moveTabGroup, openGroupColorPopoverAtElement, reorderTabs, updateTabGroup]
  );

  // Execute drop on a group header chip
  const executeDropOnGroupChip = useCallback(
    (source: TabDragSource, group: TabGroup) => {
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

  // Unified HTML5 Drag Handlers on the TabBar horizontal strip
  const handleContainerDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    const activeSource = dragSourceRef.current || dragSource;
    if (!activeSource) return;
    e.preventDefault();
  };

  const handleContainerDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const activeSource = dragSourceRef.current || dragSource;
    if (!activeSource) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    applyResolvedDropTarget(resolveDropTargetAtClientX(e.clientX, activeSource));
  };

  const handleContainerDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    const activeSource = dragSourceRef.current || dragSource;
    if (!activeSource) return;

    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) {
      return;
    }

    // In WebKit/Safari, relatedTarget may be null during dragleave between child nodes.
    if (e.clientX !== 0 || e.clientY !== 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      if (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      ) {
        return;
      }
    }

    setDropIndicator(null);
    setChipDropTargetGroupId(null);
  };

  const handleContainerDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const activeSource = dragSourceRef.current || dragSource;
    if (!activeSource) return;
    e.preventDefault();

    const resolved = resolveDropTargetAtClientX(e.clientX, activeSource);
    if (resolved?.kind === 'group-chip') {
      const targetGroup = tabGroups.find((g) => g.id === resolved.groupId);
      if (targetGroup) {
        executeDropOnGroupChip(activeSource, targetGroup);
      }
    } else if (resolved?.kind === 'tab') {
      const targetTab = tabs.find((t) => t.id === resolved.targetTabId);
      const tabEl = findTabElementById(resolved.targetTabId);
      if (targetTab) {
        executeDropOnTab(
          activeSource,
          targetTab,
          resolved.position,
          tabEl,
          resolved.outsideGroup
        );
      }
    }

    clearDragState();
  };

  // iPad / Touch Drag Handlers
  const handleTouchStartItem = (
    e: React.TouchEvent,
    source: TabDragSource,
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
      dragSourceRef.current = source;
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

    const activeSource = dragSourceRef.current || dragSource;
    if (!activeSource) return;
    e.preventDefault();

    const containerRect = tabBarContainerRef.current?.getBoundingClientRect();
    if (
      containerRect &&
      touch.clientY >= containerRect.top - 36 &&
      touch.clientY <= containerRect.bottom + 36
    ) {
      applyResolvedDropTarget(resolveDropTargetAtClientX(touch.clientX, activeSource));
      return;
    }

    setChipDropTargetGroupId(null);
    setDropIndicator(null);
  };

  const handleTouchEndItem = () => {
    if (touchHoldTimerRef.current) {
      clearTimeout(touchHoldTimerRef.current);
      touchHoldTimerRef.current = null;
    }

    const activeSource = dragSourceRef.current || dragSource;
    if (isTouchDraggingRef.current && activeSource) {
      if (chipDropTargetGroupId) {
        const targetGroup = tabGroups.find((g) => g.id === chipDropTargetGroupId);
        if (targetGroup) {
          executeDropOnGroupChip(activeSource, targetGroup);
        }
      } else if (dropIndicator) {
        const targetTab = tabs.find((t) => t.id === dropIndicator.targetTabId);
        const tabEl = findTabElementById(dropIndicator.targetTabId);
        if (targetTab) {
          executeDropOnTab(
            activeSource,
            targetTab,
            dropIndicator.position,
            tabEl,
            Boolean(dropIndicator.outsideGroup)
          );
        }
      }
    }

    isTouchDraggingRef.current = false;
    touchStartCoordsRef.current = null;
    clearDragState();
  };

  // Render a single tab item (used both standalone and inside a group)
  const renderTabPill = (tab: TabItem) => {
    const isActive = tab.id === activeTabId;
    const isEditing = editingTabId === tab.id;
    const isHome = isHomeTab(tab);
    const isHiddenByGroupEdgeIndicator = Boolean(tab.groupId && dropIndicator?.outsideGroup);
    const isDropTarget =
      dropIndicator?.targetTabId === tab.id && !isHiddenByGroupEdgeIndicator;
    const dropPos = isDropTarget ? dropIndicator?.position ?? null : null;
    const charLimits = isWide ? TAB_LABEL_MAX_CHARS.wide : TAB_LABEL_MAX_CHARS.narrow;
    const labelMaxChars = isActive ? charLimits.active : charLimits.inactive;

    return (
      <div
        key={tab.id}
        data-tab-id={tab.id}
        draggable={!isEditing}
        onDragStart={(e) => {
          const source: TabDragSource = { type: 'tab', id: tab.id };
          dragSourceRef.current = source;
          setDragSource(source);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', tab.id);
        }}
        onDragEnd={clearDragState}
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
          <span className="whitespace-pre overflow-hidden text-ellipsis text-[11px] sm:text-xs max-w-[calc(100vw-6rem)]">
            {abbreviateMiddle(tab.title, labelMaxChars)}
          </span>
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
    <div className="bg-slate-50/80 dark:bg-slate-950/40 border-t border-b border-slate-200/80 dark:border-slate-800/80 header-safe-area transition-colors">
      <div
        ref={tabBarContainerRef}
        onDragEnter={handleContainerDragEnter}
        onDragOver={handleContainerDragOver}
        onDragLeave={handleContainerDragLeave}
        onDrop={handleContainerDrop}
        className="h-7 sm:h-8 flex items-center px-3 py-0.5"
      >
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

          const firstGroupTab = groupTabs[0];
          const lastGroupTab = groupTabs[groupTabs.length - 1];
          const isFirstGroupTabVisible = visibleTabs.some((t) => t.id === firstGroupTab?.id);
          const isLastGroupTabVisible = visibleTabs.some((t) => t.id === lastGroupTab?.id);

          const showGroupBeforeIndicator = Boolean(
            dropIndicator &&
              firstGroupTab &&
              dropIndicator.targetTabId === firstGroupTab.id &&
              dropIndicator.position === 'before' &&
              (dropIndicator.outsideGroup || !isFirstGroupTabVisible)
          );
          const showGroupAfterIndicator = Boolean(
            dropIndicator &&
              lastGroupTab &&
              dropIndicator.targetTabId === lastGroupTab.id &&
              dropIndicator.position === 'after' &&
              (dropIndicator.outsideGroup || !isLastGroupTabVisible)
          );

          return (
            <div
              key={group.id}
              data-group-container-id={group.id}
              className={`rounded-lg border-2 ${colorOption.borderClass} px-1 py-0.5 flex items-center gap-1 bg-white/50 dark:bg-slate-900/50 transition-all shrink-0 ${
                chipDropTargetGroupId === group.id ? 'ring-2 ring-blue-500 bg-blue-50/30' : ''
              } ${showGroupBeforeIndicator ? 'border-l-2 !border-l-blue-500' : ''} ${
                showGroupAfterIndicator ? 'border-r-2 !border-r-blue-500' : ''
              }`}
            >
              {/* Clean Group Header Chip: [ ● Nome ] */}
              <div
                data-group-chip-id={group.id}
                draggable={!isGroupEditing}
                onDragStart={(e) => {
                  const source: TabDragSource = { type: 'group', id: group.id };
                  dragSourceRef.current = source;
                  setDragSource(source);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', group.id);
                }}
                onDragEnd={clearDragState}
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

        {/* New Tab (+) Button — drop area here is handled by the continuous TabBar strip */}
        <button
          type="button"
          onClick={onNewTab}
          title="Nova aba (tela inicial)"
          className="w-6 h-6 rounded flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-purple-600 dark:hover:text-purple-400 transition-colors shrink-0 cursor-pointer ml-0.5"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        </div>
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
