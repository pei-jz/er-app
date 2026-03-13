import { BaseEdge, EdgeProps, getSmoothStepPath, EdgeLabelRenderer } from '@xyflow/react';
import React from 'react';

const EREdge: React.FC<EdgeProps> = ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    data,
}) => {
    const offset = (style as any)?.offset || (data as any)?.offset || 0;
    const isOneToOne = (data as any)?.isOneToOne;


    // For now, let's just make the line look like a proper ER line with the SmoothStep path.
    const [edgePath, labelX, labelY] = getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 20,
        offset: 20 + offset, // Distribute paths
    });

    const isHighlighted = (data as any)?.isHighlighted;
    const isDimmed = (data as any)?.isDimmed;
    const edgeLabel = (data as any)?.label;
    const relationType = (data as any)?.relationType || 'none';

    // Highlight styles mapping
    const highlightStyles = {
        'to-parent': {
            stroke: '#10b981', // Emerald
            labelBg: 'bg-emerald-900/90',
            labelBorder: 'border-emerald-500',
            textColor: 'text-emerald-100'
        },
        'from-child': {
            stroke: '#f59e0b', // Orange
            labelBg: 'bg-orange-900/90',
            labelBorder: 'border-orange-500',
            textColor: 'text-orange-100'
        },
        'selected-edge': {
            stroke: '#d946ef', // Fuchsia
            labelBg: 'bg-fuchsia-900/90',
            labelBorder: 'border-fuchsia-500',
            textColor: 'text-fuchsia-100'
        },
        'none': {
            stroke: '#525252',
            labelBg: 'bg-slate-800/90',
            labelBorder: 'border-neutral-700',
            textColor: 'text-slate-200'
        }
    };

    const styleByRelation = highlightStyles[relationType as keyof typeof highlightStyles] || highlightStyles.none;

    const strokeColor = isHighlighted ? styleByRelation.stroke : '#525252';
    const strokeWidth = isHighlighted ? 2.5 : 1.5;
    const opacity = isDimmed ? 0.15 : (isHighlighted ? 1 : 0.8);

    const getMarkerOrient = (position: string = 'right', isStart: boolean) => {
        if (isStart) {
            switch (position) {
                case 'right': return '180';
                case 'bottom': return '270';
                case 'left': return '0';
                case 'top': return '90';
                default: return '0';
            }
        } else {
            switch (position) {
                case 'left': return '0';
                case 'top': return '90';
                case 'right': return '180';
                case 'bottom': return '270';
                default: return '0';
            }
        }
    };

    const startOrient = getMarkerOrient(sourcePosition as string, true);
    const endOrient = getMarkerOrient(targetPosition as string, false);

    return (
        <>
            <BaseEdge
                path={edgePath}
                interactionWidth={20}
                markerStart={isOneToOne ? `url(#marker-1to1-${id})` : `url(#marker-1ton-${id})`}
                markerEnd={`url(#marker-1-${id})`}
                style={{
                    ...style,
                    stroke: strokeColor,
                    strokeWidth,
                    opacity,
                    transition: 'all 0.3s ease-in-out',
                    cursor: 'pointer'
                }}
            />
            {/* Custom SVG Markers definition. */}
            <defs>
                {/* 1 side marker (TARGET -> end) */}
                <marker id={`marker-1-${id}`} markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="16" refX="8" refY="8" orient={endOrient}>
                    <line x1="8" y1="2" x2="8" y2="14" stroke={strokeColor} strokeWidth="2" />
                    <line x1="12" y1="2" x2="12" y2="14" stroke={strokeColor} strokeWidth="2" />
                </marker>
                {/* 1:N side marker (SOURCE -> start) - Crow's foot */}
                <marker id={`marker-1ton-${id}`} markerUnits="userSpaceOnUse" markerWidth="20" markerHeight="20" refX="15" refY="10" orient={startOrient}>
                    <circle cx="5" cy="10" r="3" fill="none" stroke={strokeColor} strokeWidth="2" />
                    <line x1="8" y1="10" x2="15" y2="10" stroke={strokeColor} strokeWidth="2" />
                    <line x1="8" y1="10" x2="18" y2="4" stroke={strokeColor} strokeWidth="2" />
                    <line x1="8" y1="10" x2="18" y2="16" stroke={strokeColor} strokeWidth="2" />
                </marker>
                {/* 1:1 side marker (SOURCE -> start) */}
                <marker id={`marker-1to1-${id}`} markerUnits="userSpaceOnUse" markerWidth="20" markerHeight="20" refX="10" refY="10" orient={startOrient}>
                    <line x1="6" y1="4" x2="6" y2="16" stroke={strokeColor} strokeWidth="2" />
                    <line x1="10" y1="4" x2="10" y2="16" stroke={strokeColor} strokeWidth="2" />
                </marker>
            </defs>
            {edgeLabel && isHighlighted && (
                <EdgeLabelRenderer>
                    <div
                        style={{
                            position: 'absolute',
                            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                            backdropFilter: 'blur(4px)',
                            padding: '6px 10px',
                            borderRadius: '8px',
                            fontSize: '10px',
                            fontWeight: 'bold',
                            pointerEvents: 'all',
                            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                            zIndex: 1000,
                            whiteSpace: 'pre', // Respect \n for multiline
                            lineHeight: '1.4'
                        }}

                        className={`nodrag nopan border ${styleByRelation.labelBg} ${styleByRelation.labelBorder} ${styleByRelation.textColor}`}
                    >
                        {edgeLabel}
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    );
};

export default React.memo(EREdge);
