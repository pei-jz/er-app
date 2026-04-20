import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
    ReactFlow, Background, Controls, MiniMap, Node, Edge, useNodesState, useEdgesState,
    Connection, HandleType, SelectionMode, useReactFlow, Handle, Position, useStore
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import TableNode from './TableNode';
import CategoryNode from './CategoryNode';
import EREdge from './EREdge';
import { ErDiagramData, CategoryMetadata, TableDisplayMode } from '../types/er';
import { ChevronRight, Home } from 'lucide-react';

const nodeTypes = {
    table: TableNode,
    category: CategoryNode,
    mouse: () => (
        <div style={{ width: 1, height: 1, opacity: 0 }}>
            <Handle type="target" position={Position.Top} id="target" style={{ opacity: 0 }} />
        </div>
    )
};

const edgeTypes = {
    'er-edge': EREdge,
};

interface DiagramCanvasProps {
    displayMode: TableDisplayMode;
    data: ErDiagramData;
    selectedCategoryId: string | null;
    onSelectCategory: (id: string | null) => void;
    selectedNodeId: string | null;
    onSelectNode: (id: string | null) => void;
    onUpdateTablePosition: (name: string, x: number, y: number) => void;
    onUpdateCategoryPosition: (id: string, x: number, y: number) => void;
    onEditCategory?: (cat: CategoryMetadata) => void;
    addTablesToCategory?: (categoryId: string, tableNames: string[]) => void;
    addForeignKey: (sourceTable: string, targetTable: string, pairs: { source: string, target: string }[]) => void;
    removeForeignKey: (sourceTable: string, sourceCol: string) => void;
    onEdgeSelect?: (edgeId: string | null) => void; // Added for edge selection
    onTableDoubleClick?: (tableName: string) => void;
}

interface PendingConnection {
    nodeId: string;
    handleId: string;
    type: HandleType;
}

// Highly optimized boolean selectors for React Flow Zustand store
// Using these instead of useViewport prevents DiagramCanvas from re-rendering on every pan/zoom frame!
const isLowDetailSelector = (s: any) => s.transform[2] < 0.6;
const isVeryLowDetailSelector = (s: any) => s.transform[2] < 0.3;

const DiagramCanvas: React.FC<DiagramCanvasProps> = ({
    displayMode, data, selectedCategoryId, onSelectCategory, selectedNodeId, onSelectNode,
    onUpdateTablePosition, onUpdateCategoryPosition, onEditCategory, addForeignKey, removeForeignKey,
    onEdgeSelect, onTableDoubleClick
}) => {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const [isCtrlPressed, setIsCtrlPressed] = useState(false);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [isLayouting, setIsLayouting] = useState(false);
    const { screenToFlowPosition, fitView } = useReactFlow();

    // Use strictly memoized boolean selectors to watch zoom thresholds WITHOUT taking a 60-fps re-render hit
    const isLowDetailZoom = useStore(isLowDetailSelector);
    const isVeryLowDetailZoom = useStore(isVeryLowDetailSelector);

    const layoutCache = useRef<Map<string, { x: number, y: number }>>(new Map());
    const workerRef = useRef<Worker | null>(null);

    // Level of Detail Toggles
    const isLowDetail = isLowDetailZoom || data.settings?.highPerformanceMode;
    const isVeryLowDetail = isVeryLowDetailZoom || data.settings?.highPerformanceMode;
    const disableAnimations = data.settings?.disableAnimations;

    useEffect(() => {
        workerRef.current = new Worker(new URL('../workers/layoutWorker.ts', import.meta.url), { type: 'module' });
        workerRef.current.onmessage = (e) => {
            const positions = e.data;
            Object.entries(positions).forEach(([id, pos]: [string, any]) => {
                onUpdateTablePosition(id, pos.x, pos.y);
            });
            setIsLayouting(false);
            setShowConfirmModal(false);
        };
        return () => workerRef.current?.terminate();
    }, [onUpdateTablePosition]);

    // Helper: Determine best handles based on relative positions (MySQL Workbench Style)
    // Now supports slot distribution to prevent crowding
    const getAutoHandles = (sourceNode: Node, targetNode: Node, sourceSlot: number = 2, targetSlot: number = 2) => {
        const dx = targetNode.position.x - sourceNode.position.x;
        const dy = targetNode.position.y - sourceNode.position.y;

        let sourceSide = 'right';
        let targetSide = 'left';

        if (Math.abs(dx) > Math.abs(dy)) {
            if (dx > 0) {
                sourceSide = 'right';
                targetSide = 'left';
            } else {
                sourceSide = 'left';
                targetSide = 'right';
            }
        } else {
            if (dy > 0) {
                sourceSide = 'bottom';
                targetSide = 'top';
            } else {
                sourceSide = 'top';
                targetSide = 'bottom';
            }
        }

        return {
            sourceHandle: `${sourceSide}-source-slot-${isVeryLowDetail ? 2 : sourceSlot}`,
            targetHandle: `${targetSide}-target-slot-${isVeryLowDetail ? 2 : targetSlot}`
        };
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Control') setIsCtrlPressed(true);
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'Control') setIsCtrlPressed(false);
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        
        // Safety: ensure if window loses focus we reset state
        const handleBlur = () => setIsCtrlPressed(false);
        window.addEventListener('blur', handleBlur);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleBlur);
        };
    }, []);

    // Track mouse position everywhere for smooth preview
    useEffect(() => {
        if (!pendingConnection) return;

        const handleGlobalMouseMove = (e: MouseEvent) => {
            const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
            setMousePos(pos);
        };

        window.addEventListener('mousemove', handleGlobalMouseMove);
        return () => window.removeEventListener('mousemove', handleGlobalMouseMove);
    }, [pendingConnection, screenToFlowPosition]);

    const onPaneMouseMove = useCallback(() => {
        // Global listener handles mouse tracking
    }, []);

    const onConnectStart = useCallback((event: any, params: any) => {
        // Initialize mouse position immediately
        const clientX = event.clientX || (event.touches && event.touches[0].clientX);
        const clientY = event.clientY || (event.touches && event.touches[0].clientY);

        if (clientX !== undefined && clientY !== undefined) {
            const pos = screenToFlowPosition({ x: clientX, y: clientY });
            setMousePos(pos);
        }

        if (pendingConnection) {
            // Check if we clicked the same handle to cancel, or at least the same node
            if (pendingConnection.nodeId === params.nodeId && pendingConnection.handleId === params.handleId) {
                setPendingConnection(null);
                return;
            }

            // SECOND click - Complete the connection
            const source = pendingConnection;
            const target = params;

            if (source.handleId.includes(':::') && target.handleId.includes(':::')) {
                const sParts = source.handleId.split(':::');
                const tParts = target.handleId.split(':::');
                const sourceCol = sParts[0];
                const targetCol = tParts[0];

                if (sourceCol && targetCol && source.nodeId !== target.nodeId) {
                    addForeignKey(source.nodeId, target.nodeId, [{ source: sourceCol, target: targetCol }]);
                }
            } else if (source.handleId.includes(':::') && target.handleId.includes('slot')) {
                // Dragging from a column to a table's perimeter
                const sourceCol = source.handleId.split(':::')[0];
                if (sourceCol && source.nodeId !== target.nodeId) {
                    // Default to 'id' or ask? For now default to 'id' as it's common.
                    addForeignKey(source.nodeId, target.nodeId, [{ source: sourceCol, target: 'id' }]);
                }
            }
            setPendingConnection(null);
        } else {
            // FIRST click - Start the connection
            setPendingConnection(params);
        }
    }, [pendingConnection, addForeignKey, screenToFlowPosition]);

    const onConnectEnd = useCallback(() => {
        // We keep pendingConnection until Escape or second click
    }, []);

    const handleConnect = useCallback((params: Connection) => {
        // Standard drag-and-drop connection
        const sHandleId = params.sourceHandle || '';
        const tHandleId = params.targetHandle || '';

        if (sHandleId.includes(':::') && tHandleId.includes(':::')) {
            const sourceCol = sHandleId.split(':::')[0];
            const targetCol = tHandleId.split(':::')[0];

            if (sourceCol && targetCol) {
                addForeignKey(params.source, params.target, [{ source: sourceCol, target: targetCol }]);
            }
        } else if (sHandleId.includes(':::') && tHandleId.includes('slot')) {
            const sourceCol = sHandleId.split(':::')[0];
            if (sourceCol) {
                addForeignKey(params.source, params.target, [{ source: sourceCol, target: 'id' }]);
            }
        }
        setPendingConnection(null);
    }, [addForeignKey]);

    // Esc to cancel connection
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setPendingConnection(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Breadcrumbs calculation
    const breadcrumbs = useMemo(() => {
        const crumbs: CategoryMetadata[] = [];
        let currentId = selectedCategoryId;
        while (currentId) {
            const cat = data.categories.find(c => c.id === currentId);
            if (cat) {
                crumbs.unshift(cat);
                currentId = cat.parent_id || null;
            } else {
                break;
            }
        }
        return crumbs;
    }, [data.categories, selectedCategoryId]);

    // Main useEffect for Persistent Data
    // Selection state is now passed from App.tsx

    const onNodeClick = useCallback((_: any, node: Node) => {
        if (node.type === 'table') {
            onSelectNode(node.id);
            setSelectedEdgeId(null);
            if (onEdgeSelect) onEdgeSelect(null);
        } else {
            onSelectNode(null);
            setSelectedEdgeId(null);
            if (onEdgeSelect) onEdgeSelect(null);
        }
    }, [onSelectNode, onEdgeSelect]);

    const onPaneClick = useCallback(() => {
        onSelectNode(null);
        setSelectedEdgeId(null);
        if (onEdgeSelect) onEdgeSelect(null);
    }, [onSelectNode, onEdgeSelect]);

    const onEdgeClick = useCallback((_: any, edge: Edge) => {
        setSelectedEdgeId(edge.id);
        if (onEdgeSelect) onEdgeSelect(edge.id);
    }, [onEdgeSelect]);

    const onNodeDoubleClick = useCallback((_: any, node: Node) => {
        if (node.type === 'table' && onTableDoubleClick) {
            onTableDoubleClick(node.id);
        }
    }, [onTableDoubleClick]);

    // Auto-center on selection
    useEffect(() => {
        if (selectedNodeId) {
            fitView({
                nodes: [{ id: selectedNodeId }],
                duration: 1000,
                padding: 0.5,
                minZoom: 1,
                maxZoom: 1.2
            });
        }
    }, [selectedNodeId, fitView]);

    // Main useEffect for Persistent Data
    // 1. Calculate base visible tables and categories
    const { visibleTables, visibleCategories, visibleTableNames } = useMemo(() => {
        const vt = selectedCategoryId
            ? data.tables.filter(t => t.category_ids?.includes(selectedCategoryId))
            : [];
        const vc = data.categories.filter(c => selectedCategoryId ? c.parent_id === selectedCategoryId : !c.parent_id);
        const vtn = new Set(vt.map(t => t.name));
        return { visibleTables: vt, visibleCategories: vc, visibleTableNames: vtn };
    }, [data.tables, data.categories, selectedCategoryId]);

    // 2. Identify all unique table connections
    const connectionsMap = useMemo(() => {
        const map = new Map<string, {
            srcTable: string,
            tgtTable: string,
            fks: Array<{ srcCol: string, tgtCol: string, isUnique: boolean }>
        }>();

        data.tables.forEach(t => {
            if (!visibleTableNames.has(t.name)) return;
            t.columns.forEach(c => {
                if (c.is_foreign_key && c.references_table && visibleTableNames.has(c.references_table)) {
                    const key = `${t.name}->${c.references_table}`;
                    if (!map.has(key)) {
                        map.set(key, { srcTable: t.name, tgtTable: c.references_table, fks: [] });
                    }
                    const isUnique = c.is_primary_key || (t.indices || []).some(idx => idx.is_unique && idx.columns.includes(c.name));
                    map.get(key)!.fks.push({
                        srcCol: c.name,
                        tgtCol: c.references_column || 'id',
                        isUnique
                    });
                }
            });
        });
        return map;
    }, [data.tables, visibleTableNames]);

    const triggerAutoLayout = useCallback(() => {
        if (workerRef.current) {
            setIsLayouting(true);
            workerRef.current.postMessage({
                nodes: visibleTables,
                connections: Array.from(connectionsMap.values()),
                displayMode
            });
        }
    }, [visibleTables, connectionsMap, displayMode]);

    // 3. Identify related entities (Parent/Child distinction)
    const { parentTableNames, childTableNames, toParentEdgeIds, fromChildEdgeIds } = useMemo(() => {
        const ptn = new Set<string>();
        const ctn = new Set<string>();
        const tpei = new Set<string>();
        const fcei = new Set<string>();

        if (selectedNodeId) {
            data.tables.forEach((t) => {
                t.columns.forEach((c) => {
                    if (c.is_foreign_key && c.references_table) {
                        const edgeId = `e-${t.name}-${c.name}-${c.references_table}`;
                        if (t.name === selectedNodeId) {
                            ptn.add(c.references_table);
                            tpei.add(edgeId);
                        } else if (c.references_table === selectedNodeId) {
                            ctn.add(t.name);
                            fcei.add(edgeId);
                        }
                    }
                });
            });
        }
        return { parentTableNames: ptn, childTableNames: ctn, toParentEdgeIds: tpei, fromChildEdgeIds: fcei };
    }, [data.tables, selectedNodeId]);

    // 4. Map to store columns that should be explicitly highlighted
    const highlightedColumns = useMemo(() => {
        const map = new Map<string, Set<string>>();
        const addHighlight = (tableName: string, colName: string) => {
            if (!map.has(tableName)) map.set(tableName, new Set());
            map.get(tableName)!.add(colName);
        };

        if (selectedEdgeId) {
            connectionsMap.forEach((conn) => {
                const edgeId = `e-${conn.srcTable}-${conn.tgtTable}-${conn.fks.map(fk => fk.srcCol).join(',')}`;
                if (edgeId === selectedEdgeId) {
                    conn.fks.forEach(fk => {
                        addHighlight(conn.srcTable, fk.srcCol);
                        addHighlight(conn.tgtTable, fk.tgtCol);
                    });
                }
            });
        }
        return map;
    }, [selectedEdgeId, connectionsMap]);

    // 5. Pre-calculate layout positions (Dagre)
    const layoutedTablePositions = useMemo(() => {
        // We now use the worker for actual layout updates.
        // This memo is kept for initial placement of unpositioned nodes if needed,
        // but we'll simplify it or rely on the worker.
        return layoutCache.current;
    }, []);

    // 6. Sync nodes and edges on state change
    useEffect(() => {
        const sideUsage = new Map<string, number>();
        const getNextSlot = (tableId: string, side: string) => {
            const key = `${tableId}-${side}`;
            const count = sideUsage.get(key) || 0;
            sideUsage.set(key, count + 1);
            return count % 5;
        };

        const tNodes: Node[] = visibleTables.map(t => {
            const isSelected = t.name === selectedNodeId;
            const isParent = parentTableNames.has(t.name);
            const isChild = childTableNames.has(t.name);
            let isEdgeSource = false;
            let isEdgeTarget = false;
            if (selectedEdgeId) {
                const parts = selectedEdgeId.split('-');
                if (parts.length >= 3) {
                    const srcT = parts[1];
                    const tgtT = parts[2];
                    if (t.name === srcT) isEdgeSource = true;
                    if (t.name === tgtT) isEdgeTarget = true;
                }
            }

            const isRelated = isSelected || isParent || isChild || isEdgeSource || isEdgeTarget;
            const isDimmed = (selectedNodeId && !isRelated) || (selectedEdgeId && !isRelated);

            let relationType: 'self' | 'parent' | 'child' | 'to-parent' | 'from-child' | 'none' = 'none';
            if (isSelected) relationType = 'self';
            else if (isParent || isEdgeTarget) relationType = 'parent';
            else if (isChild || isEdgeSource) relationType = 'child';

            let finalX = t.x;
            let finalY = t.y;
            if (finalX === 0 && finalY === 0) {
                const lPos = layoutedTablePositions.get(t.name);
                if (lPos) {
                    finalX = lPos.x;
                    finalY = lPos.y;
                }
            }

            return {
                id: t.name,
                type: 'table',
                position: { x: finalX, y: finalY },
                data: {
                    ...t,
                    displayMode,
                    pendingConnection,
                    isHighlighted: isRelated,
                    isDimmed,
                    relationType,
                    selectedEdgeId,
                    isLowDetail,
                    isVeryLowDetail,
                    activeHighlightColumns: Array.from(highlightedColumns.get(t.name) || []),
                    fks: connectionsMap.get(`${t.name}->`)?.fks || Array.from(connectionsMap.values()).find(c => c.tgtTable === t.name || c.srcTable === t.name)?.fks || [],
                } as any,
                style: {
                    opacity: isDimmed ? 0.3 : 1,
                    transition: (isVeryLowDetail || disableAnimations) ? 'none' : 'all 0.2s ease-in-out',
                    zIndex: isSelected || selectedEdgeId ? 1000 : (isRelated ? 500 : 0)
                }
            };
        });

        const cNodes: Node[] = visibleCategories.map((c, index) => {
            let cx = c.x;
            let cy = c.y;
            if (cx === 0 && cy === 0) {
                cx = (index % 4) * 350 + 100;
                cy = Math.floor(index / 4) * 250 + 100;
            }
            return {
                id: c.id,
                type: 'category',
                position: { x: cx, y: cy },
                data: {
                    name: c.name,
                    onDrillDown: () => onSelectCategory(c.id),
                    onEdit: onEditCategory ? () => onEditCategory(c) : undefined,
                } as any,
            };
        });

        const rEdges: Edge[] = Array.from(connectionsMap.values()).map(({ srcTable, tgtTable, fks }) => {
            const stNode = visibleTables.find(vt => vt.name === srcTable)!;
            const ttNode = visibleTables.find(vt => vt.name === tgtTable)!;

            const dx = ttNode.x - stNode.x;
            const dy = ttNode.y - stNode.y;
            let sSide = 'right', tSide = 'left';
            if (Math.abs(dx) > Math.abs(dy)) {
                if (dx > 0) { sSide = 'right'; tSide = 'left'; }
                else { sSide = 'left'; tSide = 'right'; }
            } else {
                if (dy > 0) { sSide = 'bottom'; tSide = 'top'; }
                else { sSide = 'top'; tSide = 'bottom'; }
            }

            const sourceSlot = getNextSlot(srcTable, sSide);
            const targetSlot = getNextSlot(tgtTable, tSide);
            const edgeId = `e-${srcTable}-${tgtTable}-${fks.map(fk => fk.srcCol).join(',')}`;

            const isToParent = fks.some(fk => toParentEdgeIds.has(`e-${srcTable}-${fk.srcCol}-${tgtTable}`));
            const isFromChild = fks.some(fk => fromChildEdgeIds.has(`e-${srcTable}-${fk.srcCol}-${tgtTable}`));

            const isSelected = selectedEdgeId === edgeId;
            const isRelated = isToParent || isFromChild || isSelected;
            const isDimmed = (selectedNodeId && !isRelated) || (selectedEdgeId && !isRelated);

            let relationType = 'none';
            if (isSelected) relationType = 'selected-edge';
            else if (isToParent) relationType = 'to-parent';
            else if (isFromChild) relationType = 'from-child';

            const { sourceHandle, targetHandle } = getAutoHandles(
                { position: { x: stNode.x, y: stNode.y } } as any,
                { position: { x: ttNode.x, y: ttNode.y } } as any,
                sourceSlot,
                targetSlot
            );

            const isOneToOne = fks.some(fk => fk.isUnique);
            const labelText = fks.map(fk => `${fk.srcCol} → ${fk.tgtCol}`).join('\n');

            return {
                id: edgeId,
                source: srcTable,
                sourceHandle,
                target: tgtTable,
                targetHandle,
                type: 'er-edge',
                data: {
                    sourceTable: srcTable,
                    fks: fks,
                    isLowDetail,
                    isVeryLowDetail,
                    isHighlighted: isRelated,
                    isDimmed,
                    relationType,
                    label: isRelated ? labelText : '',
                    isOneToOne,
                },
                zIndex: isRelated ? 1000 : 0
            };
        });

        const catEdges: Edge[] = visibleCategories.flatMap(c =>
            (c.related_category_ids || [])
                .filter(relatedId => new Set(visibleCategories.map(cat => cat.id)).has(relatedId))
                .map(relatedId => ({
                    id: `e-cat-${c.id}-${relatedId}`,
                    source: c.id,
                    target: relatedId,
                    animated: true,
                    style: { stroke: '#eab308', strokeWidth: 4, strokeDasharray: '5,5', opacity: 0.8 },
                }))
        );

        const isNodeEqual = (a: Node, b: Node) => {
            if (a.id !== b.id || a.position.x !== b.position.x || a.position.y !== b.position.y) return false;
            if (a.style?.opacity !== b.style?.opacity || a.style?.zIndex !== b.style?.zIndex) return false;
            
            const ad = a.data as any, bd = b.data as any;
            if (!ad || !bd) return false;
            if (
                ad.isHighlighted !== bd.isHighlighted ||
                ad.isDimmed !== bd.isDimmed ||
                ad.relationType !== bd.relationType ||
                ad.selectedEdgeId !== bd.selectedEdgeId ||
                ad.displayMode !== bd.displayMode ||
                ad.isLowDetail !== bd.isLowDetail ||
                ad.isVeryLowDetail !== bd.isVeryLowDetail ||
                ad.pendingConnection !== bd.pendingConnection ||
                ad.columns !== bd.columns ||
                ad.activeHighlightColumns?.length !== bd.activeHighlightColumns?.length
            ) return false;
            
            return true;
        };

        const isEdgeEqual = (a: Edge, b: Edge) => {
            if (a.id !== b.id || a.sourceHandle !== b.sourceHandle || a.targetHandle !== b.targetHandle) return false;
            if (a.zIndex !== b.zIndex) return false;
            
            const ad = a.data as any, bd = b.data as any;
            if (!ad || !bd) return false;
            if (
                ad.isHighlighted !== bd.isHighlighted ||
                ad.isDimmed !== bd.isDimmed ||
                ad.relationType !== bd.relationType ||
                ad.label !== bd.label ||
                ad.isLowDetail !== bd.isLowDetail ||
                ad.isVeryLowDetail !== bd.isVeryLowDetail
            ) return false;
            return true;
        };

        setNodes(prev => {
            const prevMap = new Map(prev.map(n => [n.id, n]));
            let changed = false;
            const nextNodes = [...cNodes, ...tNodes].map(newNode => {
                const p = prevMap.get(newNode.id);
                if (p && isNodeEqual(p, newNode)) {
                    return p;
                }
                changed = true;
                return newNode;
            });
            if (!changed && prev.length === nextNodes.length) return prev;
            return nextNodes;
        });

        setEdges(prev => {
            const prevMap = new Map(prev.map(e => [e.id, e]));
            let changed = false;
            const nextEdges = [...rEdges, ...catEdges].map(newEdge => {
                const p = prevMap.get(newEdge.id);
                if (p && isEdgeEqual(p, newEdge)) {
                    return p;
                }
                changed = true;
                return newEdge;
            });
            if (!changed && prev.length === nextEdges.length) return prev;
            return nextEdges;
        });
    }, [
        visibleTables, visibleCategories, connectionsMap,
        parentTableNames, childTableNames, toParentEdgeIds, fromChildEdgeIds,
        highlightedColumns, layoutedTablePositions,
        selectedNodeId, selectedEdgeId, displayMode, pendingConnection,
        onSelectCategory, onEditCategory, isLowDetail, isVeryLowDetail, disableAnimations
    ]);

    // Transient Rendering (Mouse Node & Ghost Edge)
    const finalNodes = useMemo(() => {
        if (!pendingConnection) return nodes;
        return [
            ...nodes,
            {
                id: 'mouse-node',
                type: 'mouse',
                position: mousePos,
                data: {},
                draggable: false,
                style: { pointerEvents: 'none' } as any,
            } as Node
        ];
    }, [nodes, pendingConnection, mousePos]);

    const finalEdges = useMemo(() => {
        // Render optimization: CULL EDGES when zoomed out to save massive SVG drawing overhead!
        // We only show edges that are directly related to the selected item.
        let currentEdges = [...edges];
        if (isVeryLowDetail) {
            currentEdges = currentEdges.filter(e => {
                if (e.id === 'ghost-edge') return true; // Always show ghost edge if it exists
                return e.data?.isHighlighted || e.id === selectedEdgeId || (selectedNodeId && (e.source === selectedNodeId || e.target === selectedNodeId));
            });
        }

        if (!pendingConnection) return currentEdges;

        return [
            ...currentEdges,
            {
                id: 'draft-edge',
                source: pendingConnection.nodeId,
                sourceHandle: pendingConnection.handleId,
                target: 'mouse-node',
                targetHandle: 'target',
                type: 'straight',
                animated: true,
                style: {
                    stroke: '#10b981',
                    strokeWidth: 3,
                    strokeDasharray: '5,5',
                    opacity: 0.8,
                    pointerEvents: 'none',
                    zIndex: 2000
                } as any,
            } as Edge
        ];
    }, [edges, pendingConnection, mousePos]);

    const handleNodeDrag = (_: any, node: Node) => {
        if (node.type !== 'table') return;
        setEdges((eds) =>
            eds.map((edge) => {
                if (edge.source === node.id || edge.target === node.id) {
                    if (edge.type !== 'er-edge' || edge.id === 'draft-edge') return edge;
                    const sourceNode = node.id === edge.source ? node : nodes.find(n => n.id === edge.source);
                    const targetNode = node.id === edge.target ? node : nodes.find(n => n.id === edge.target);
                    if (!sourceNode || !targetNode || targetNode.id === 'mouse-node') return edge;
                    const { sourceHandle, targetHandle } = getAutoHandles(sourceNode, targetNode);
                    if (edge.sourceHandle === sourceHandle && edge.targetHandle === targetHandle) return edge;

                    return { ...edge, sourceHandle, targetHandle };
                }
                return edge;
            })
        );
    };

    const handleNodeDragStop = (_: any, node: Node) => {
        if (node.type === 'category') {
            onUpdateCategoryPosition(node.id, node.position.x, node.position.y);
        } else if (node.type === 'table') {
            onUpdateTablePosition(node.id, node.position.x, node.position.y);
        }
    };

    const handleEdgesDelete = (deletedEdges: Edge[]) => {
        deletedEdges.forEach(edge => {
            if (edge.type === 'er-edge') {
                const sHandleId = edge.sourceHandle || '';
                if (sHandleId.includes(':::')) {
                    const sourceCol = sHandleId.split(':::')[0];
                    if (sourceCol) {
                        removeForeignKey(edge.source, sourceCol);
                    }
                }
            }
        });
    };



    return (
        <div className={`w-full h-full bg-neutral-900 overflow-hidden relative group ${isCtrlPressed ? 'er-ctrl-pressed' : ''}`}>
            <div className="absolute top-6 left-6 z-10 flex items-center gap-2 bg-neutral-800/80 backdrop-blur-xl border border-neutral-700/50 p-1.5 rounded-2xl shadow-2xl">
                <button
                    onClick={() => onSelectCategory(null)}
                    className={`p-2 rounded-xl transition-all ${!selectedCategoryId ? 'bg-blue-600 text-white shadow-lg' : 'text-neutral-400 hover:bg-neutral-700 hover:text-white'}`}
                    title="Home"
                >
                    <Home size={18} />
                </button>
                {breadcrumbs.map((crumb, i) => (
                    <React.Fragment key={crumb.id}>
                        <ChevronRight size={14} className="text-neutral-600" />
                        <button
                            onClick={() => onSelectCategory(crumb.id)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${i === breadcrumbs.length - 1 ? 'bg-yellow-500 text-neutral-900 shadow-lg' : 'text-neutral-400 hover:bg-neutral-700 hover:text-white'}`}
                        >
                            {crumb.name}
                        </button>
                    </React.Fragment>
                ))}
            </div>

            <ReactFlow
                nodes={finalNodes}
                edges={finalEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeDragStop={handleNodeDragStop}
                onNodeDrag={handleNodeDrag}
                onNodeClick={onNodeClick}
                onNodeDoubleClick={onNodeDoubleClick}
                onEdgeClick={onEdgeClick}
                onPaneClick={onPaneClick}
                onConnect={handleConnect}
                onEdgesDelete={handleEdgesDelete}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                deleteKeyCode={['Backspace', 'Delete']}
                panOnScroll={true}
                zoomOnScroll={false}
                zoomOnPinch={true}
                panOnDrag={[1, 2]}
                selectionOnDrag={false}
                selectionMode={SelectionMode.Partial}
                fitView
                colorMode="dark"
                onPaneMouseMove={onPaneMouseMove}
                onConnectStart={onConnectStart}
                onConnectEnd={onConnectEnd}
                onlyRenderVisibleElements={true}
            >
                <Background gap={24} color="#262626" />
                <Controls />
                <MiniMap
                    nodeColor={(n) => n.type === 'category' ? '#eab308' : '#3b82f6'}
                    className="m-4 rounded-xl overflow-hidden grayscale opacity-30 pointer-events-none"
                    maskColor="rgba(0,0,0,0.6)"
                />
                <svg style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0 }}>
                    <defs>
                        {/* 1 side marker (TARGET -> end) */}
                        <marker id="marker-1-global" markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="16" refX="8" refY="8" orient="auto">
                            <line x1="8" y1="2" x2="8" y2="14" stroke="#525252" strokeWidth="2" />
                            <line x1="12" y1="2" x2="12" y2="14" stroke="#525252" strokeWidth="2" />
                        </marker>
                        {/* 1:1 side marker (SOURCE -> start) */}
                        <marker id="marker-1to1-global" markerUnits="userSpaceOnUse" markerWidth="20" markerHeight="20" refX="10" refY="10" orient="auto">
                            <line x1="6" y1="4" x2="6" y2="16" stroke="#525252" strokeWidth="2" />
                            <line x1="10" y1="4" x2="10" y2="16" stroke="#525252" strokeWidth="2" />
                        </marker>
                    </defs>
                </svg>
            </ReactFlow>

            <div className="absolute top-6 right-6 z-10 flex items-center gap-3">
                <button
                    onClick={() => setShowConfirmModal(true)}
                    className="bg-neutral-800/90 backdrop-blur-md border border-neutral-700 hover:bg-neutral-600 hover:text-white px-4 py-2.5 rounded-2xl shadow-2xl transition-all text-[10px] font-black uppercase tracking-widest text-blue-400 active:scale-95"
                >
                    Auto Layout
                </button>
            </div>

            <style>{`
                .react-flow__pane {
                    cursor: crosshair;
                }
                .react-flow__handle {
                    cursor: pointer !important;
                }
            `}</style>

            {/* Custom Confirm Modal */}
            {showConfirmModal && (
                <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-neutral-900 border border-neutral-700 rounded-3xl p-8 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-500">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                            </div>
                            <h3 className="text-lg font-black text-white">Apply Auto Layout</h3>
                        </div>
                        <p className="text-sm text-neutral-400 mb-8 leading-relaxed">
                            Are you sure you want to apply auto layout?<br />This will reset all your manual table positioning.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setShowConfirmModal(false)}
                                className="px-5 py-2.5 rounded-xl text-xs font-bold text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={triggerAutoLayout}
                                className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl text-xs font-black shadow-lg shadow-blue-900/20 transition-all active:scale-95"
                            >
                                Confirm
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Layouting Progress Overlay */}
            {isLayouting && (
                <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/60 backdrop-blur-md transition-all duration-300">
                    <div className="flex flex-col items-center gap-6 max-w-sm w-full p-8 bg-neutral-900/90 border border-neutral-700/50 rounded-3xl shadow-2xl animate-in zoom-in-95 duration-300">
                        <div className="relative">
                            <div className="w-20 h-20 rounded-full border-4 border-neutral-800 border-t-blue-500 animate-spin"></div>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-xs font-black text-blue-400">ER</span>
                            </div>
                        </div>
                        <div className="text-center space-y-2">
                            <h3 className="text-lg font-black text-white uppercase tracking-widest">Optimizing Layout</h3>
                            <p className="text-xs text-neutral-500 font-medium">Calculating optimal table positions...</p>
                        </div>
                        <div className="w-full h-1 bg-neutral-800 rounded-full overflow-hidden border border-neutral-800">
                            <div className="h-full bg-blue-500 rounded-full animate-progress-indeterminate"></div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Deeply memoize the canvas to prevent 6-second freezes when switching tabs out of Diagram view.
export default React.memo(DiagramCanvas, (prev, next) => {
    // Only re-render if the core data structure or relevant selections actually changed.
    return prev.data === next.data &&
           prev.displayMode === next.displayMode &&
           prev.selectedCategoryId === next.selectedCategoryId &&
           prev.selectedNodeId === next.selectedNodeId;
});
