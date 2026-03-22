import { BaseEdge, EdgeProps, getSmoothStepPath, EdgeLabelRenderer } from '@xyflow/react';
import React from 'react';

const EREdge: React.FC<EdgeProps> = ({
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


    const isLowDetail = (data as any)?.isLowDetail;
    const isVeryLowDetail = (data as any)?.isVeryLowDetail;

    return (
        <>
            <BaseEdge
                path={edgePath}
                interactionWidth={20}
                markerStart={isOneToOne ? 'url(#marker-1to1-global)' : 'url(#marker-1ton-global)'}
                markerEnd="url(#marker-1-global)"
                style={{
                    ...style,
                    stroke: strokeColor,
                    strokeWidth,
                    opacity,
                    transition: isVeryLowDetail ? 'none' : 'all 0.3s ease-in-out',
                    cursor: 'pointer'
                }}
            />
            {edgeLabel && isHighlighted && !isLowDetail && (
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
