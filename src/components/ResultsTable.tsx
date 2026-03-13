import React, { useState, useCallback, useMemo } from 'react';

interface QueryResult {
    columns: string[];
    rows: any[][];
    total_count?: number;
    has_more: boolean;
}

interface ResultsTableProps {
    results: QueryResult;
    offset: number;
    isTransposed: boolean;
    colWidths: Record<string, number>;
    onColResizeStart: (e: React.MouseEvent, colName: string) => void;
    onCellMouseDown: (e: React.MouseEvent, r: number, c: number) => void;
    onCellMouseEnter: (r: number, c: number) => void;
    onCellMouseUp: () => void;
    onRowMouseDown: (e: React.MouseEvent, r: number) => void;
    onRowMouseEnter: (r: number) => void;
    onContextMenu: (e: React.MouseEvent, rowIdx: number | null, colIdx: number | null, val: string, colName: string) => void;
    isCellSelected: (r: number, c: number) => boolean;
    activeCell: { r: number, c: number } | null;
    onKeyDown: (e: React.KeyboardEvent) => void;
    selectionBox: { r1: number, c1: number, r2: number, c2: number } | null;
}

const ResultsTable = React.memo(({
    results,
    offset,
    isTransposed,
    colWidths,
    onColResizeStart,
    onCellMouseDown,
    onCellMouseEnter,
    onCellMouseUp,
    onRowMouseDown,
    onRowMouseEnter,
    onContextMenu,
    isCellSelected,
    activeCell,
    onKeyDown,
    selectionBox
}: ResultsTableProps) => {
    const [scrollTop, setScrollTop] = useState(0);
    const [scrollLeft, setScrollLeft] = useState(0);
    const rowHeight = 33;
    const colWidth = 150;

    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        setScrollTop(e.currentTarget.scrollTop);
        setScrollLeft(e.currentTarget.scrollLeft);
    }, []);

    const totalWidth = useMemo(() => {
        if (!isTransposed) {
            return results.columns.reduce((sum, col) => sum + (colWidths[col] || 150), 48);
        } else {
            return (results.rows.length * colWidth) + (colWidths['__ROW_HEADER__'] || 150) + 40;
        }
    }, [isTransposed, results.columns, results.rows.length, colWidths]);

    const totalHeight = useMemo(() => {
        if (!isTransposed) {
            return (results.rows.length * rowHeight) + 40;
        } else {
            return (results.columns.length * rowHeight) + 40;
        }
    }, [isTransposed, results.rows.length, results.columns.length]);

    const renderNormalView = () => {
        const visibleCount = 50;
        const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - 5);
        const endIdx = Math.min(results.rows.length, startIdx + visibleCount);
        const items = [];

        if (startIdx > 0) {
            items.push(<tr key="top-spacer" style={{ height: startIdx * rowHeight }}><td colSpan={results.columns.length + 1}></td></tr>);
        }

        for (let i = startIdx; i < endIdx; i++) {
            const row = results.rows[i];
            const isRowHighlighted = selectionBox && i >= Math.min(selectionBox.r1, selectionBox.r2) && i <= Math.max(selectionBox.r1, selectionBox.r2);
            
            items.push(
                <tr key={i} className="hover:bg-blue-500/5 transition-colors group" style={{ height: rowHeight }}>
                    <td
                        onMouseDown={(e) => onRowMouseDown(e, i)}
                        onMouseEnter={() => onRowMouseEnter(i)}
                        onContextMenu={(e) => onContextMenu(e, i, null, '', '')}
                        className={`px-3 py-1.5 border-r border-b border-neutral-800/30 text-neutral-600 text-right sticky left-0 bg-neutral-950 group-hover:bg-blue-900/20 group-hover:text-blue-400 select-none z-10 w-12 text-[10px] cursor-pointer ${isRowHighlighted ? 'bg-blue-600/80 text-blue-50' : ''}`}>
                        {offset + i + 1}
                    </td>
                    {row.map((val, j) => {
                        const isSelected = isCellSelected(i, j);
                        const isActive = activeCell?.r === i && activeCell?.c === j;
                        return (
                            <td key={j}
                                className={`px-4 py-1.5 border-r border-b border-neutral-800/30 whitespace-nowrap overflow-hidden text-ellipsis relative cursor-context-menu select-none ${isSelected ? 'bg-blue-600/40 text-blue-50' : 'text-neutral-300'} ${isActive ? 'ring-2 ring-inset ring-blue-500 bg-blue-600/20' : ''}`}
                                style={{ width: colWidths[results.columns[j]] || 150, maxWidth: colWidths[results.columns[j]] || 150 }}
                                title={String(val)}
                                onMouseDown={(e) => onCellMouseDown(e, i, j)}
                                onMouseEnter={() => onCellMouseEnter(i, j)}
                                onMouseUp={onCellMouseUp}
                                onContextMenu={(e) => onContextMenu(e, i, j, String(val), results.columns[j])}
                            >
                                {val === "NULL" ? (
                                    <span className="text-neutral-700 italic">NULL</span>
                                ) : (
                                    <span>{val}</span>
                                )}
                            </td>
                        );
                    })}
                </tr>
            );
        }

        if (endIdx < results.rows.length) {
            items.push(<tr key="bottom-spacer" style={{ height: (results.rows.length - endIdx) * rowHeight }}><td colSpan={results.columns.length + 1}></td></tr>);
        }

        return (
            <div style={{ height: totalHeight, width: totalWidth, position: 'relative' }}>
                <table className="text-left border-collapse border-spacing-0 table-fixed absolute top-0 left-0" style={{ width: totalWidth }}>
                    <thead className="sticky top-0 z-20 bg-neutral-900 shadow-[0_1px_0_0_#262626]">
                        <tr>
                            <th className="px-3 py-2 border-r border-b border-neutral-800 text-neutral-500 font-bold bg-neutral-900 sticky left-0 z-30 w-12 text-center">
                                #
                            </th>
                            {results.columns.map((col, idx) => (
                                <th key={`${col}-${idx}`}
                                    className="border-r border-b border-neutral-800 text-neutral-400 font-black uppercase tracking-wider whitespace-nowrap bg-neutral-900 relative"
                                    style={{ width: colWidths[col] || 150, minWidth: 50, maxWidth: 800 }}
                                >
                                    <div className="px-4 py-2 truncate select-none">
                                        {col}
                                    </div>
                                    <div
                                        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-emerald-500/50 z-20"
                                        onMouseDown={(e) => onColResizeStart(e, col)}
                                    />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-neutral-950">
                        {items}
                    </tbody>
                </table>
            </div>
        );
    };

    const renderTransposedView = () => {
        const visibleCount = 20;
        const startIdx = Math.max(0, Math.floor(scrollLeft / colWidth) - 2);
        const endIdx = Math.min(results.rows.length, startIdx + visibleCount);

        return (
            <div style={{ height: totalHeight, width: totalWidth, position: 'relative' }}>
                <table className="text-left border-collapse border-spacing-0 absolute top-0 left-0 table-fixed" style={{ width: totalWidth }}>
                    <thead className="sticky top-0 z-20 bg-neutral-900 shadow-[0_1px_0_0_#262626]">
                        <tr>
                            <th className="px-0 py-0 border-r border-b border-neutral-800 text-neutral-400 font-black uppercase tracking-wider whitespace-nowrap bg-neutral-900 sticky left-0 z-30 relative" style={{ width: colWidths['__ROW_HEADER__'] || 150, minWidth: 50, maxWidth: 800 }}>
                                <div className="px-4 py-2 truncate select-none">
                                    Column Name
                                </div>
                                <div
                                    className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-emerald-500/50 z-20"
                                    onMouseDown={(e) => onColResizeStart(e, '__ROW_HEADER__')}
                                />
                            </th>
                            {(() => {
                                const headers = [];
                                if (startIdx > 0) {
                                    headers.push(<th key="left-spacer" style={{ width: startIdx * colWidth }}></th>);
                                }
                                for (let i = startIdx; i < endIdx; i++) {
                                    const isRowHighlighted = selectionBox && i >= Math.min(selectionBox.r1, selectionBox.r2) && i <= Math.max(selectionBox.r1, selectionBox.r2);
                                    headers.push(
                                        <th key={`h-${i}`}
                                            onMouseDown={(e) => onRowMouseDown(e, i)}
                                            onMouseEnter={() => onRowMouseEnter(i)}
                                            className={`px-4 py-2 border-r border-b border-neutral-800 text-neutral-500 font-bold bg-neutral-900 text-center cursor-pointer select-none transition-colors ${isRowHighlighted ? 'bg-blue-600/80 text-blue-50' : ''}`}
                                            style={{ width: colWidth, minWidth: colWidth, maxWidth: colWidth }}>
                                            Row {offset + i + 1}
                                        </th>
                                    );
                                }
                                if (endIdx < results.rows.length) {
                                    headers.push(<th key="right-spacer" style={{ width: (results.rows.length - endIdx) * colWidth }}></th>);
                                }
                                return headers;
                            })()}
                        </tr>
                    </thead>
                    <tbody className="bg-neutral-950">
                        {results.columns.map((col, i) => (
                            <tr key={i} className="hover:bg-blue-500/5 transition-colors group">
                                <td className="px-4 py-1.5 font-bold border-r border-b border-neutral-800/50 text-emerald-400 sticky left-0 bg-neutral-950 group-hover:bg-blue-900/20 z-10" style={{ width: colWidths['__ROW_HEADER__'] || 150, minWidth: 50, maxWidth: 800 }}>
                                    {col}
                                </td>
                                {(() => {
                                    const cells = [];
                                    if (startIdx > 0) {
                                        cells.push(<td key="left-spacer" style={{ width: startIdx * colWidth }}></td>);
                                    }
                                    for (let j = startIdx; j < endIdx; j++) {
                                        const row = results.rows[j];
                                        const isSelected = isCellSelected(j, i);
                                        const isActive = activeCell?.r === j && activeCell?.c === i;
                                        cells.push(
                                            <td key={j}
                                                className={`px-4 py-1.5 border-r border-b border-neutral-800/30 whitespace-nowrap overflow-hidden text-ellipsis cursor-context-menu select-none ${isSelected ? 'bg-blue-600/40 text-white' : 'text-neutral-300'} ${isActive ? 'ring-2 ring-inset ring-blue-500 bg-blue-600/20' : ''}`}
                                                style={{ width: colWidth, minWidth: colWidth, maxWidth: colWidth }}
                                                title={String(row[i])}
                                                onMouseDown={(e) => onCellMouseDown(e, j, i)}
                                                onMouseEnter={() => onCellMouseEnter(j, i)}
                                                onMouseUp={onCellMouseUp}
                                                onContextMenu={(e) => onContextMenu(e, j, i, String(row[i]), col)}
                                            >
                                                {row[i] === "NULL" ? (
                                                    <span className="text-neutral-700 italic">NULL</span>
                                                ) : (
                                                    <span>{row[i]}</span>
                                                )}
                                            </td>
                                        );
                                    }
                                    if (endIdx < results.rows.length) {
                                        cells.push(<td key="right-spacer" style={{ width: (results.rows.length - endIdx) * colWidth }}></td>);
                                    }
                                    return cells;
                                })()}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };

    return (
            <div 
                className="flex-1 w-full max-w-full overflow-auto custom-scrollbar relative bg-neutral-900 border border-neutral-800 outline-none"
            onScroll={handleScroll}
            onKeyDown={onKeyDown}
            tabIndex={0}
            style={{ contain: 'content' }}
        >
            <div style={{ width: 'max-content', minWidth: '100%' }}>
                {isTransposed ? renderTransposedView() : renderNormalView()}
            </div>
        </div>
    );
});

export default ResultsTable;
