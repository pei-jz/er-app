import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { TableMetadata } from '../types/er';
import { Table as TableIcon, Link } from 'lucide-react';

interface TableNodeData extends TableMetadata {
    displayMode?: 'compact' | 'full';
    pendingConnection?: { nodeId: string; handleId: string; type: string } | null;
    isHighlighted?: boolean;
    isDimmed?: boolean;
    relationType?: 'self' | 'parent' | 'child' | 'to-parent' | 'from-child' | 'selected-edge' | 'none';
    selectedEdgeId?: string | null;
    fks?: Array<{ srcCol: string, tgtCol: string, isUnique: boolean }>;
    activeHighlightColumns?: string[];
}

interface TableNodeProps {
    id: string;
    data: TableNodeData;
}

const TableNode: React.FC<TableNodeProps> = ({ data }) => {
    const displayMode = data.displayMode || 'compact';

    // Compact mode: show PK + FK only. Full mode: show all columns.
    const visibleColumns = displayMode === 'compact'
        ? data.columns.filter(c => c.is_primary_key || c.is_foreign_key)
        : data.columns;

    const isHighlighted = data.isHighlighted;
    const isDimmed = data.isDimmed;
    const relationType = data.relationType || 'none';

    // Highlight styles mapping
    const highlightStyles = {
        self: {
            border: 'border-blue-500',
            glow: 'shadow-[0_0_20px_rgba(59,130,246,0.5)]',
            header: 'bg-blue-600/20 border-blue-500/50',
            icon: 'text-blue-300',
            iconBg: 'bg-blue-400/30',
            text: 'text-blue-50'
        },
        parent: {
            border: 'border-emerald-500',
            glow: 'shadow-[0_0_20px_rgba(16,185,129,0.5)]',
            header: 'bg-emerald-600/20 border-emerald-500/50',
            icon: 'text-emerald-300',
            iconBg: 'bg-emerald-400/30',
            text: 'text-emerald-50'
        },
        child: {
            border: 'border-orange-500',
            glow: 'shadow-[0_0_20px_rgba(245,158,11,0.5)]',
            header: 'bg-orange-600/20 border-orange-500/50',
            icon: 'text-orange-300',
            iconBg: 'bg-orange-400/30',
            text: 'text-orange-50'
        },
        'to-parent': {
            border: 'border-emerald-500', glow: '', header: 'bg-emerald-600/20', icon: 'text-emerald-300', iconBg: 'bg-emerald-400/30', text: 'text-emerald-50'
        },
        'from-child': {
            border: 'border-orange-500', glow: '', header: 'bg-orange-600/20', icon: 'text-orange-300', iconBg: 'bg-orange-400/30', text: 'text-orange-50'
        },
        'selected-edge': {
            border: 'border-fuchsia-500', glow: '', header: 'bg-fuchsia-600/20', icon: 'text-fuchsia-300', iconBg: 'bg-fuchsia-400/30', text: 'text-fuchsia-50'
        },
        none: {
            border: 'border-neutral-700',
            glow: '',
            header: 'bg-neutral-900 border-neutral-700',
            icon: 'text-blue-400',
            iconBg: 'bg-blue-600/20',
            text: 'text-neutral-100'
        },
        edgeHighlight: {
            // For specifically highlighted columns within a dimmed/non-highlighted table
            border: 'border-neutral-500',
            bg: 'bg-indigo-900/40',
            text: 'text-indigo-200'
        }
    };

    const styleByRelation = highlightStyles[relationType] || highlightStyles.none;

    return (
        <div className={`bg-neutral-800 border-2 rounded-lg shadow-xl overflow-hidden min-w-[200px] transition-all duration-300 ${isHighlighted ? `${styleByRelation.border} ${styleByRelation.glow} scale-[1.02]` : 'border-neutral-700'
            } ${isDimmed ? 'opacity-40' : 'opacity-100'}`}>
            {/* Header - Always show table name */}
            <div className={`px-3 py-2 border-b flex items-center gap-2 ${isHighlighted ? styleByRelation.header : 'bg-neutral-900 border-neutral-700'
                }`}>
                <div className={`w-5 h-5 rounded flex items-center justify-center ${isHighlighted ? styleByRelation.iconBg : 'bg-blue-600/20'
                    }`}>
                    <TableIcon size={12} className={isHighlighted ? styleByRelation.icon : "text-blue-400"} />
                </div>
                <span className={`text-xs font-black truncate ${isHighlighted ? styleByRelation.text : 'text-neutral-100'
                    }`}>{data.name}</span>
            </div>

            {/* Column List */}
            <div className="p-2 space-y-1">
                {visibleColumns.map((col, idx) => {
                    const isPK = col.is_primary_key;
                    const isFK = col.is_foreign_key;

                    const isSourceHandle = (handleId: string) => data.pendingConnection?.handleId === handleId;

                    // Determine if this specific column is part of the currently selected edge or table relation
                    let isColumnHighlighted = false;
                    if (data.activeHighlightColumns && data.activeHighlightColumns.length > 0) {
                        isColumnHighlighted = data.activeHighlightColumns.includes(col.name);
                    } else if (data.selectedEdgeId && data.fks) {
                        // Fallback logic
                        if (data.relationType === 'to-parent' || data.relationType === 'self' || data.relationType === 'selected-edge') {
                            isColumnHighlighted = data.fks.some(fk => fk.srcCol === col.name);
                        }
                        if (data.relationType === 'from-child' || data.relationType === 'self' || data.relationType === 'selected-edge') {
                            isColumnHighlighted = data.fks.some(fk => fk.tgtCol === col.name);
                        }
                    }

                    const colHighlightClass = isColumnHighlighted
                        ? 'bg-indigo-900/60 ring-1 ring-indigo-500/50'
                        : 'hover:bg-neutral-700/30';

                    return (
                        <div key={`${col.name}-${idx}`} className={`relative flex items-center justify-between gap-3 text-[10px] group rounded px-1 py-0.5 transition-colors ${colHighlightClass}`}>
                            {/* Left Side Source Handle (Small dot for UX) */}
                            <Handle
                                type="source"
                                position={Position.Left}
                                id={`${col.name}-${idx}-left-source`}
                                style={{
                                    left: -6,
                                    background: isSourceHandle(`${col.name}-${idx}-left-source`) ? '#10b981' : '#3b82f6',
                                    width: isSourceHandle(`${col.name}-${idx}-left-source`) ? 12 : 10,
                                    height: isSourceHandle(`${col.name}-${idx}-left-source`) ? 12 : 10,
                                    border: '2px solid white',
                                    zIndex: 10,
                                    opacity: (data.pendingConnection || isSourceHandle(`${col.name}-${idx}-left-source`)) ? 1 : 0
                                }}
                                className="transition-all hover:scale-125 cursor-crosshair group-hover:opacity-100 shadow-lg"
                            />

                            <div className="flex items-center gap-1.5 font-bold">
                                {isPK && <span className="text-yellow-500 font-black">PK</span>}
                                {isFK && <Link size={10} className="text-emerald-400" />}
                                {!isPK && !isFK && <span className="w-3" />}
                                <span className={isColumnHighlighted ? "text-indigo-200" : (isPK ? "text-yellow-100" : isFK ? "text-emerald-100" : "text-neutral-300")}>{col.name}</span>
                            </div>
                            <div className="flex flex-col items-end">
                                <span className="text-neutral-500 text-[9px] uppercase font-bold tracking-tighter">{col.data_type}</span>
                                {isFK && <span className="text-emerald-500/50 text-[5px] font-black leading-none truncate max-w-[60px]">→ {col.references_table}</span>}
                            </div>

                            {/* Right Side Source Handle (Small dot for UX) */}
                            <Handle
                                type="source"
                                position={Position.Right}
                                id={`${col.name}-${idx}-right-source`}
                                style={{
                                    right: -6,
                                    background: isSourceHandle(`${col.name}-${idx}-right-source`) ? '#10b981' : '#3b82f6',
                                    width: isSourceHandle(`${col.name}-${idx}-right-source`) ? 12 : 10,
                                    height: isSourceHandle(`${col.name}-${idx}-right-source`) ? 12 : 10,
                                    border: '2px solid white',
                                    zIndex: 10,
                                    opacity: (data.pendingConnection || isSourceHandle(`${col.name}-${idx}-right-source`)) ? 1 : 0
                                }}
                                className="transition-all hover:scale-125 cursor-crosshair group-hover:opacity-100 shadow-lg"
                            />
                        </div>
                    );
                })}

                {visibleColumns.length === 0 && (
                    <div className="py-1 text-center">
                        <span className="text-[9px] text-neutral-500 italic">No Columns to Display</span>
                    </div>
                )}
            </div>

            {/* Perimeter Target Handles (Multiple slots per side for distribution) */}
            {[0, 1, 2, 3, 4].map((slot) => {
                const offset = `${(slot + 1) * 20}%`;
                return (
                    <React.Fragment key={`slots-${slot}`}>
                        <Handle
                            type="target"
                            position={Position.Top}
                            id={`top-target-slot-${slot}`}
                            style={{
                                left: offset,
                                top: 0,
                                opacity: data.pendingConnection ? 1 : 0,
                                background: '#10b981',
                                border: '2px solid white',
                                width: 10,
                                height: 10,
                                zIndex: 20
                            }}
                            className="transition-all hover:scale-150 shadow-[0_0_10px_rgba(16,185,129,0.8)]"
                        />
                        <Handle
                            type="target"
                            position={Position.Bottom}
                            id={`bottom-target-slot-${slot}`}
                            style={{
                                left: offset,
                                bottom: 0,
                                opacity: data.pendingConnection ? 1 : 0,
                                background: '#10b981',
                                border: '2px solid white',
                                width: 10,
                                height: 10,
                                zIndex: 20
                            }}
                            className="transition-all hover:scale-150 shadow-[0_0_10px_rgba(16,185,129,0.8)]"
                        />
                        <Handle
                            type="target"
                            position={Position.Left}
                            id={`left-target-slot-${slot}`}
                            style={{
                                top: offset,
                                left: 0,
                                opacity: data.pendingConnection ? 1 : 0,
                                background: '#10b981',
                                border: '2px solid white',
                                width: 10,
                                height: 10,
                                zIndex: 20
                            }}
                            className="transition-all hover:scale-150 shadow-[0_0_10px_rgba(16,185,129,0.8)]"
                        />
                        <Handle
                            type="target"
                            position={Position.Right}
                            id={`right-target-slot-${slot}`}
                            style={{
                                top: offset,
                                right: 0,
                                opacity: data.pendingConnection ? 1 : 0,
                                background: '#10b981',
                                border: '2px solid white',
                                width: 10,
                                height: 10,
                                zIndex: 20
                            }}
                            className="transition-all hover:scale-150 shadow-[0_0_10px_rgba(16,185,129,0.8)]"
                        />

                        <Handle
                            type="source"
                            position={Position.Top}
                            id={`top-source-slot-${slot}`}
                            style={{ left: offset, top: 0, opacity: 0 }}
                        />
                        <Handle
                            type="source"
                            position={Position.Bottom}
                            id={`bottom-source-slot-${slot}`}
                            style={{ left: offset, bottom: 0, opacity: 0 }}
                        />
                        <Handle
                            type="source"
                            position={Position.Left}
                            id={`left-source-slot-${slot}`}
                            style={{ top: offset, left: 0, opacity: 0 }}
                        />
                        <Handle
                            type="source"
                            position={Position.Right}
                            id={`right-source-slot-${slot}`}
                            style={{ top: offset, right: 0, opacity: 0 }}
                        />
                    </React.Fragment>
                );
            })}
        </div>
    );
};

export default React.memo(TableNode, (prev, next) => {
    // Return true if passing next props to render would return the same result as passing prev props to render, otherwise return false
    return (
        prev.id === next.id &&
        prev.data.isHighlighted === next.data.isHighlighted &&
        prev.data.isDimmed === next.data.isDimmed &&
        prev.data.relationType === next.data.relationType &&
        prev.data.displayMode === next.data.displayMode &&
        prev.data.pendingConnection === next.data.pendingConnection &&
        prev.data.selectedEdgeId === next.data.selectedEdgeId &&
        prev.data.activeHighlightColumns === next.data.activeHighlightColumns &&
        prev.data.columns === next.data.columns // Shallow check is usually enough if handled by state
    );
});
