import React from 'react';
import { AppMode, AppView, ErDiagramData, CategoryMetadata, TableDisplayMode, DbConfig, TableMetadata } from '../types/er';
import { Database, FileJson, ChevronRight, LayoutGrid, Plus, Edit3, Home, Minimize2, Maximize2, Settings, Link2, PanelLeftClose, RefreshCw, Search, Table, Layers } from 'lucide-react';
import { invoke } from "@tauri-apps/api/core";

export interface SidebarProps {
    currentView: AppView;
    setCurrentView: (view: AppView) => void;
    displayMode: TableDisplayMode;
    setDisplayMode: (mode: TableDisplayMode) => void;
    data: ErDiagramData;
    selectedCategoryId: string | null;
    onSelectCategory: (id: string | null) => void;
    onOpenImport: () => void;
    onOpenDbConnect: () => void;
    onCreateCategory: (parentId: string | null) => void;
    onEditCategory: (cat: CategoryMetadata) => void;
    onExportSql: (type: 'full' | 'diff') => void;
    onExportJson: () => void;
    onOpenSettings?: () => void;
    onOpenFkModal?: () => void;
    onToggle?: () => void;
    appMode: AppMode;
    dbConfig?: DbConfig;
    dbConnectionStatus: 'connected' | 'error' | 'disconnected';
    onRefreshDb?: () => void;
    catalog?: DbObject[];
    isLoadingCatalog?: boolean;
}

export interface DbObject {
    name: string;
    object_type: string;
}

const Sidebar: React.FC<SidebarProps> = ({
    currentView, setCurrentView, displayMode, setDisplayMode, data, selectedCategoryId, onSelectCategory,
    onOpenImport, onOpenDbConnect, onCreateCategory, onEditCategory, onExportSql, onExportJson, onOpenSettings,
    onOpenFkModal, onToggle, appMode, dbConfig, dbConnectionStatus, onRefreshDb,
    catalog = [], isLoadingCatalog = false
}) => {
    const [searchTerm, setSearchTerm] = React.useState('');
    const [selectedTable, setSelectedTable] = React.useState<string | null>(null);
    const [tableDetails, setTableDetails] = React.useState<Record<string, TableMetadata>>({});
    const [isLoadingDetails, setIsLoadingDetails] = React.useState<Record<string, boolean>>({});
    const [propertiesTab, setPropertiesTab] = React.useState<'columns' | 'indices'>('columns');
    const [propertiesSearch, setPropertiesSearch] = React.useState('');

    // Fix: Reset selection when catalog changes
    React.useEffect(() => {
        if (selectedTable && catalog.length > 0) {
            const exists = catalog.some(obj => obj.name === selectedTable);
            if (!exists) {
                setSelectedTable(null);
                setTableDetails({});
            }
        } else if (catalog.length === 0) {
            setSelectedTable(null);
            setTableDetails({});
        }
    }, [catalog]);
    const toggleTable = async (tableName: string) => {
        if (selectedTable === tableName) {
            setSelectedTable(null);
            return;
        }
        setSelectedTable(tableName);

        if (!tableDetails[tableName] && dbConfig) {
            setIsLoadingDetails(prev => ({ ...prev, [tableName]: true }));
            try {
                const startTime = Date.now();
                const result = await invoke<TableMetadata>('fetch_table_columns', {
                    config: dbConfig,
                    tableName: tableName
                });
                const duration = Date.now() - startTime;
                window.dispatchEvent(new CustomEvent('add-sql-log', {
                    detail: {
                        sql: `(app) [Fetch Metadata] ${tableName}\n-- Backend executes db-specific structural queries for Columns and Indices:\n-- MySQL: SELECT ... FROM information_schema.columns WHERE table_name = '${tableName}'\n-- Postgres: SELECT ... FROM pg_attribute ... WHERE t.relname = '${tableName}'\n-- Oracle: SELECT ... FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '${tableName}'`,
                        duration_ms: duration,
                        rows: result.columns.length,
                        status: 'success'
                    }
                }));
                setTableDetails(prev => ({ ...prev, [tableName]: result }));
            } catch (e) {
                console.error("Failed to fetch table details", e);
            } finally {
                setIsLoadingDetails(prev => ({ ...prev, [tableName]: false }));
            }
        }
    };

    const [sidebarWidth, setSidebarWidth] = React.useState(256);
    const [topPaneHeightPct, setTopPaneHeightPct] = React.useState(55);
    const isResizing = React.useRef(false);
    const isVResizing = React.useRef(false);

    const startResizing = React.useCallback((mouseDownEvent: React.MouseEvent) => {
        isResizing.current = true;
        const startX = mouseDownEvent.clientX;
        const startWidth = sidebarWidth;

        const onMouseMove = (moveEvent: MouseEvent) => {
            if (isResizing.current) {
                const newWidth = Math.max(200, Math.min(800, startWidth + (moveEvent.clientX - startX)));
                setSidebarWidth(newWidth);
            }
            if (isVResizing.current) {
                const container = document.getElementById('sidebar-split-container');
                if (container) {
                    const rect = container.getBoundingClientRect();
                    const deltaY = moveEvent.clientY - rect.top;
                    const newPct = Math.max(20, Math.min(80, (deltaY / rect.height) * 100));
                    setTopPaneHeightPct(newPct);
                }
            }
        };

        const onMouseUp = () => {
            isResizing.current = false;
            isVResizing.current = false;
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, [sidebarWidth]);

    const startVResizing = React.useCallback((mouseDownEvent: React.MouseEvent) => {
        mouseDownEvent.preventDefault();
        isVResizing.current = true;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'row-resize';

        const onMouseMove = (moveEvent: MouseEvent) => {
            if (isVResizing.current) {
                const container = document.getElementById('sidebar-split-container');
                if (container) {
                    const rect = container.getBoundingClientRect();
                    const deltaY = moveEvent.clientY - rect.top;
                    const newPct = Math.max(20, Math.min(80, (deltaY / rect.height) * 100));
                    setTopPaneHeightPct(newPct);
                }
            }
        };

        const onMouseUp = () => {
            isVResizing.current = false;
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, []);

    const handleInsertSql = (text: string) => {
        window.dispatchEvent(new CustomEvent('insert-sql-text', { detail: { text, type: 'inline-comma' } }));
    };

    const handleInsertSqlNewline = (text: string) => {
        window.dispatchEvent(new CustomEvent('insert-sql-text', { detail: { text, type: 'newline' } }));
    };

    const [contextMenu, setContextMenu] = React.useState<{
        x: number, y: number,
        targetType: 'table' | 'column',
        tableName: string,
        columnName?: string
    } | null>(null);

    React.useEffect(() => {
        const handleClick = () => setContextMenu(null);
        document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    }, []);

    const handleMenuDDL = () => {
        if (!contextMenu) return;
        const tName = contextMenu.tableName;
        const meta = tableDetails[tName];
        if (!meta) return;
        let ddl = `-- Basic DDL representation\nCREATE TABLE ${tName} (\n`;
        meta.columns.forEach((c, idx) => {
            const pk = c.is_primary_key ? ' PRIMARY KEY' : '';
            const nul = c.is_nullable ? '' : ' NOT NULL';
            ddl += `    ${c.name} ${c.data_type}${pk}${nul}${idx < meta.columns.length - 1 ? ',' : ''}\n`;
        });
        ddl += `);\n`;
        handleInsertSqlNewline(ddl);
        setContextMenu(null);
    };

    const handleMenuSelect = () => {
        if (!contextMenu) return;
        const tName = contextMenu.tableName;
        const meta = tableDetails[tName];
        if (!meta) return;
        const cols = meta.columns.map(c => c.name).join(',\n    ');
        const sql = `SELECT\n    ${cols}\nFROM ${tName};`;
        handleInsertSqlNewline(sql);
        setContextMenu(null);
    };

    const handleMenuInsert = () => {
        if (!contextMenu) return;
        const tName = contextMenu.tableName;
        const meta = tableDetails[tName];
        if (!meta) return;
        const cols = meta.columns.map(c => c.name).join(', ');
        const vals = meta.columns.map(() => '?').join(', ');
        const sql = `INSERT INTO ${tName} (${cols})\nVALUES (${vals});`;
        handleInsertSqlNewline(sql);
        setContextMenu(null);
    };

    const handleMenuUpdate = () => {
        if (!contextMenu) return;
        const tName = contextMenu.tableName;
        if (contextMenu.targetType === 'column') {
            const sql = `UPDATE ${tName} SET ${contextMenu.columnName} = '?';`;
            handleInsertSqlNewline(sql);
        } else {
            const meta = tableDetails[tName];
            if (!meta) return;
            const sets = meta.columns.map(c => `${c.name} = '?'`).join(',\n    ');
            const sql = `UPDATE ${tName}\nSET\n    ${sets}\nWHERE 1=1;`;
            handleInsertSqlNewline(sql);
        }
        setContextMenu(null);
    };

    return (
        <div style={{ width: `${sidebarWidth}px` }} className="bg-neutral-800 border-r border-neutral-700 flex flex-col h-full shadow-lg shrink-0 relative group/sidebar">
            <div 
                onMouseDown={startResizing}
                className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-blue-500/50 z-50 transition-colors opacity-0 group-hover/sidebar:opacity-100"
            />
            {contextMenu && (
                <div 
                    className="fixed z-[100] bg-neutral-800 border border-neutral-700 shadow-xl rounded-xl overflow-hidden py-1 min-w-[150px] text-xs"
                    style={{ top: Math.min(contextMenu.y, window.innerHeight - 150), left: contextMenu.x }}
                >
                    {contextMenu.targetType === 'table' ? (
                        <>
                            <button onClick={handleMenuDDL} className="w-full text-left px-4 py-2 hover:bg-neutral-700 text-neutral-300">DDL(定義) 挿入</button>
                            <button onClick={handleMenuSelect} className="w-full text-left px-4 py-2 hover:bg-neutral-700 text-neutral-300">SELECT 作成</button>
                            <button onClick={handleMenuInsert} className="w-full text-left px-4 py-2 hover:bg-neutral-700 text-neutral-300">INSERT 作成</button>
                            <button onClick={handleMenuUpdate} className="w-full text-left px-4 py-2 hover:bg-neutral-700 text-neutral-300">UPDATE 作成</button>
                        </>
                    ) : (
                        <>
                            <button onClick={handleMenuUpdate} className="w-full text-left px-4 py-2 hover:bg-neutral-700 text-neutral-300">UPDATE(カラム) 作成</button>
                        </>
                    )}
                </div>
            )}
            <div className="p-4 border-b border-neutral-700 flex flex-col justify-between items-start gap-2 relative">
                <div className="flex w-full justify-between items-center">
                    <h1 className="text-xl font-black bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent italic">
                        ER ARCHITECT
                    </h1>
                    {onToggle && (
                        <button
                            onClick={onToggle}
                            className="text-neutral-500 hover:text-white transition-colors p-1"
                            title="Close Sidebar"
                        >
                            <PanelLeftClose size={18} />
                        </button>
                    )}
                </div>
                {appMode === 'design' && (
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                        <span>🎨 Design Mode</span>
                    </div>
                )}
                {appMode === 'db' && dbConfig && (
                    <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border w-full overflow-hidden whitespace-nowrap text-ellipsis ${dbConnectionStatus === 'connected' ? 'text-blue-400 bg-blue-500/10 border-blue-500/20' : 'text-red-400 bg-red-500/10 border-red-500/20'}`}>
                        <Database size={12} className="shrink-0" />
                        <span className="truncate">
                            {dbConnectionStatus === 'connected' ? `Live DB: ${dbConfig.host}` : `Error: ${dbConfig.host}`}
                        </span>
                    </div>
                )}
            </div>

            <div className={`grid ${(appMode as string) === 'db' ? 'grid-cols-1' : 'grid-cols-2'} gap-1 p-1.5 bg-neutral-900 mx-3 mt-4 rounded-xl shadow-inner border border-neutral-700/50`}>
                {(appMode as string) !== 'db' && (
                    <button
                        className={`py-1.5 px-1 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${currentView === 'diagram' ? 'bg-neutral-700 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-300'
                            }`}
                        onClick={() => setCurrentView('diagram')}
                    >
                        Diagram
                    </button>
                )}
                {(appMode as string) !== 'db' && (
                    <button
                        className={`py-1.5 px-1 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${currentView === 'metadata' ? 'bg-neutral-700 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-300'
                            }`}
                        onClick={() => setCurrentView('metadata')}
                    >
                        Metadata
                    </button>
                )}
                {(appMode as string) !== 'db' && (
                    <button
                        className={`py-1.5 px-1 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${currentView === 'history' ? 'bg-neutral-700 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-300'
                            }`}
                        onClick={() => setCurrentView('history')}
                    >
                        History
                    </button>
                )}
                <button
                    className={`py-1.5 px-1 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${currentView === 'sql' || (appMode as string) === 'db' ? 'bg-neutral-700 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-300'
                        }`}
                    onClick={() => setCurrentView('sql')}
                >
                    {(appMode as string) === 'db' ? 'Live SQL' : 'SQL'}
                </button>
            </div>

            {(appMode as string) === 'db' ? (
                <div id="sidebar-split-container" className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
                    {/* Top Area: Object Explorer */}
                    <div style={{ height: `${topPaneHeightPct}%` }} className="overflow-y-auto p-4 custom-scrollbar space-y-4 shrink-0 relative">
                        <div className="space-y-3">
                            <div className="flex items-center justify-between px-1">
                                <h2 className="text-[10px] font-black text-neutral-500 uppercase tracking-widest flex items-center gap-2">
                                    <Search size={10} className="text-blue-500" />
                                    Object Explorer
                                </h2>
                                {onRefreshDb && (
                                    <button 
                                        onClick={() => {
                                            setSelectedTable(null);
                                            setTableDetails({});
                                            onRefreshDb();
                                        }}
                                        className="text-neutral-500 hover:text-blue-400 p-0.5 rounded transition-colors bg-neutral-800 border border-neutral-700/50"
                                        title="Refresh Schema"
                                    >
                                        <RefreshCw size={12} className={isLoadingCatalog ? 'animate-spin text-blue-500' : ''} />
                                    </button>
                                )}
                            </div>
                            <div className="relative group">
                                <input
                                    type="text"
                                    placeholder="Filter tables..."
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 pl-8 text-xs focus:ring-1 focus:ring-blue-500 outline-none transition-all placeholder:text-neutral-600"
                                />
                                <Search size={12} className="absolute left-2.5 top-2.5 text-neutral-600 group-focus-within:text-blue-500 transition-colors" />
                            </div>
                        </div>

                        <div className="space-y-1 pr-1">
                            {isLoadingCatalog ? (
                                <div className="py-10 text-center space-y-2 opacity-50">
                                    <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                                    <p className="text-[9px] font-bold text-neutral-500 uppercase tracking-widest">Loading Catalog...</p>
                                </div>
                            ) : catalog.length === 0 ? (
                                <div className="py-10 text-center opacity-30 italic text-[10px]">No objects found</div>
                            ) : (
                                catalog
                                    .filter(obj => 
                                        obj.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                                        ((obj as any).comment && (obj as any).comment.toLowerCase().includes(searchTerm.toLowerCase()))
                                    )
                                    .sort((a, b) => a.name.localeCompare(b.name))
                                    .map(obj => (
                                        <div
                                            key={obj.name}
                                            className={`group flex flex-col px-2 py-1.5 rounded-lg transition-colors text-xs cursor-pointer select-none border border-transparent ${selectedTable === obj.name ? 'bg-blue-600/20 text-blue-400 border-blue-500/30 font-bold' : 'text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700/50'}`}
                                            onClick={() => toggleTable(obj.name)}
                                            onDoubleClick={() => handleInsertSql(obj.name)}
                                            onContextMenu={(e) => {
                                                e.preventDefault();
                                                setContextMenu({
                                                    x: e.clientX,
                                                    y: e.clientY,
                                                    targetType: 'table',
                                                    tableName: obj.name
                                                });
                                            }}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2 truncate">
                                                    {obj.object_type === 'TABLE' ? <Table size={12} className={`${selectedTable === obj.name ? 'text-blue-400' : 'text-blue-500'} shrink-0`} /> : <Layers size={12} className={`${selectedTable === obj.name ? 'text-indigo-400' : 'text-indigo-500'} shrink-0`} />}
                                                    <span className="truncate" title={obj.name}>{obj.name}</span>
                                                </div>
                                                <span className="text-[8px] font-black text-neutral-600 group-hover:text-neutral-500 transition-colors uppercase pr-1 shrink-0">{obj.object_type.slice(0, 3)}</span>
                                            </div>
                                            {(obj as any).comment && (
                                                <div className={`text-[9px] ml-5 truncate opacity-60 ${selectedTable === obj.name ? 'text-blue-300' : 'text-neutral-500'}`}>
                                                    {(obj as any).comment}
                                                </div>
                                            )}
                                        </div>
                                    ))
                            )}
                        </div>
                    </div>

                    <div 
                        onMouseDown={startVResizing}
                        className="h-1 bg-neutral-800 z-10 border-y border-neutral-700/50 cursor-row-resize hover:bg-blue-500/50 transition-colors shrink-0"
                    />

                    {/* Bottom Area: Table Properties */}
                    {selectedTable && (
                        <div className="flex-1 flex flex-col bg-neutral-900/40 min-h-0">
                            <div className="flex items-center gap-1 px-3 pt-2 bg-neutral-800/80 border-b border-neutral-700">
                                <button
                                    onClick={() => setPropertiesTab('columns')}
                                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-t-lg transition-colors ${propertiesTab === 'columns' ? 'bg-neutral-900/40 text-blue-400 border-x border-t border-neutral-700' : 'text-neutral-500 hover:text-neutral-300'}`}
                                >
                                    Columns
                                </button>
                                <button
                                    onClick={() => setPropertiesTab('indices')}
                                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-t-lg transition-colors ${propertiesTab === 'indices' ? 'bg-neutral-900/40 text-emerald-400 border-x border-t border-neutral-700' : 'text-neutral-500 hover:text-neutral-300'}`}
                                >
                                    Indices
                                </button>
                            </div>
                            
                            <div className="flex-1 flex flex-col min-h-0 p-3 space-y-3">
                                {isLoadingDetails[selectedTable] ? (
                                    <div className="flex-1 flex items-center justify-center italic text-xs text-neutral-500">Loading details...</div>
                                ) : tableDetails[selectedTable] ? (
                                    <>
                                        <input
                                            type="text"
                                            placeholder={`Filter ${propertiesTab}...`}
                                            value={propertiesSearch}
                                            onChange={e => setPropertiesSearch(e.target.value)}
                                            className="w-full bg-neutral-800 border border-neutral-700 rounded p-1.5 text-xs focus:ring-1 focus:ring-blue-500 outline-none text-neutral-300 placeholder:text-neutral-600 shrink-0"
                                        />
                                        <div className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar">
                                            {propertiesTab === 'columns' && (
                                                <table className="w-full text-left text-[10px] whitespace-nowrap">
                                                    <thead>
                                                        <tr className="text-neutral-500 uppercase tracking-widest border-b border-neutral-700/50">
                                                            <th className="font-semibold p-1 pb-2">Name</th>
                                                            <th className="font-semibold p-1 pb-2">Comment</th>
                                                            <th className="font-semibold p-1 pb-2">Type</th>
                                                            <th className="font-semibold p-1 pb-2">Req</th>
                                                            <th className="font-semibold p-1 pb-2">PK</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {tableDetails[selectedTable].columns
                                                            .filter(c => 
                                                                c.name.toLowerCase().includes(propertiesSearch.toLowerCase()) ||
                                                                (c.comment && c.comment.toLowerCase().includes(propertiesSearch.toLowerCase()))
                                                            )
                                                            .map(c => (
                                                            <tr 
                                                                key={c.name} 
                                                                className="border-b border-neutral-800/50 hover:bg-neutral-800/50 cursor-pointer"
                                                                onDoubleClick={() => handleInsertSql(c.name)}
                                                                onContextMenu={(e) => {
                                                                    e.preventDefault();
                                                                    setContextMenu({
                                                                        x: e.clientX,
                                                                        y: e.clientY,
                                                                        targetType: 'column',
                                                                        tableName: selectedTable,
                                                                        columnName: c.name
                                                                    });
                                                                }}
                                                            >
                                                                <td className="p-1 font-mono text-neutral-300">{c.name}</td>
                                                                <td className="p-1 text-neutral-500 italic max-w-[100px] truncate" title={c.comment}>{c.comment || '-'}</td>
                                                                <td className="p-1 text-emerald-400 truncate max-w-[80px]" title={c.data_type}>{c.data_type}</td>
                                                                <td className="p-1">
                                                                    {!c.is_nullable ? <span className="text-orange-400 font-bold">Yes</span> : <span className="text-neutral-600">No</span>}
                                                                </td>
                                                                <td className="p-1">
                                                                    {c.is_primary_key && <span className="text-yellow-500 font-bold">PK</span>}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            )}
                                            {propertiesTab === 'indices' && (
                                                <table className="w-full text-left text-[10px] whitespace-nowrap">
                                                    <thead>
                                                        <tr className="text-neutral-500 uppercase tracking-widest border-b border-neutral-700/50">
                                                            <th className="font-semibold p-1 pb-2">Name</th>
                                                            <th className="font-semibold p-1 pb-2">Columns</th>
                                                            <th className="font-semibold p-1 pb-2">Type</th>
                                                            <th className="font-semibold p-1 pb-2">Unique</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {tableDetails[selectedTable].indices && tableDetails[selectedTable].indices.length > 0 ? (
                                                            tableDetails[selectedTable].indices
                                                                .filter(idx => idx.name.toLowerCase().includes(propertiesSearch.toLowerCase()))
                                                                .map(idx => (
                                                                <tr key={idx.name} className="border-b border-neutral-800/50 hover:bg-neutral-800/50">
                                                                    <td className="p-1 text-neutral-300 font-mono truncate max-w-[100px]" title={idx.name}>{idx.name}</td>
                                                                    <td className="p-1 text-blue-400 truncate max-w-[100px]" title={idx.columns.join(', ')}>{idx.columns.join(', ')}</td>
                                                                    <td className="p-1">
                                                                        {idx.type ? (
                                                                            <span className={`px-1.5 py-0.5 rounded-sm font-bold text-[9px] ${
                                                                                idx.type === 'PK' ? 'bg-yellow-500/20 text-yellow-500' :
                                                                                idx.type === 'FK' ? 'bg-emerald-500/20 text-emerald-500' :
                                                                                idx.type === 'INDEX' ? 'bg-blue-500/30 text-blue-400' :
                                                                                'bg-neutral-500/20 text-neutral-400'
                                                                            }`}>
                                                                                {idx.type}
                                                                            </span>
                                                                        ) : (
                                                                            <span className="text-neutral-600">-</span>
                                                                        )}
                                                                    </td>
                                                                    <td className="p-1">
                                                                        {idx.is_unique && <span className="bg-yellow-500/20 text-yellow-500 px-1 py-0.5 rounded">UNIQUE</span>}
                                                                    </td>
                                                                </tr>
                                                            ))
                                                        ) : (
                                                            <tr><td colSpan={4} className="p-3 text-center italic text-neutral-600">No indices found</td></tr>
                                                        )}
                                                    </tbody>
                                                </table>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex-1 flex items-center justify-center italic text-xs text-red-500">Failed to load details</div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-8">
                <div className="space-y-6">
                    {/* Diagram Specific Controls */}
                    {currentView === 'diagram' && (appMode as string) !== 'db' && (
                        <div className="space-y-3">
                            <h2 className="text-[10px] font-black text-neutral-500 uppercase tracking-widest flex items-center gap-2 px-1">
                                <Maximize2 size={10} className="text-yellow-500" />
                                Diagram View
                            </h2>
                            <div className="flex p-1 bg-neutral-900 rounded-lg shadow-inner border border-neutral-700/50">
                                <button
                                    onClick={() => setDisplayMode('compact')}
                                    className={`flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-md text-[10px] font-bold uppercase transition-all ${displayMode === 'compact' ? 'bg-neutral-700 text-white shadow-md' : 'text-neutral-500 hover:text-neutral-300'
                                        }`}
                                >
                                    <Minimize2 size={12} />
                                    Compact
                                </button>
                                <button
                                    onClick={() => setDisplayMode('full')}
                                    className={`flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-md text-[10px] font-bold uppercase transition-all ${displayMode === 'full' ? 'bg-neutral-700 text-white shadow-md' : 'text-neutral-500 hover:text-neutral-300'
                                        }`}
                                >
                                    <Maximize2 size={12} />
                                    Full
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Structure Controls */}
                    {(appMode as string) !== 'db' && (
                        <div className="space-y-3">
                            <h2 className="text-[10px] font-black text-neutral-500 uppercase tracking-widest flex items-center gap-2 px-1">
                                <Plus size={10} className="text-blue-500" />
                                Structure
                            </h2>
                            <button
                                onClick={() => onCreateCategory(selectedCategoryId)}
                                className="w-full flex items-center gap-3 px-3 py-2 text-xs text-neutral-300 hover:text-white hover:bg-neutral-700/50 rounded-xl transition-all border border-neutral-700/50"
                            >
                                <Plus size={14} />
                                New Category
                            </button>
                            <button
                                onClick={onOpenFkModal}
                                className="w-full flex items-center gap-3 px-3 py-2 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 rounded-xl transition-all border border-emerald-500/30"
                            >
                                <Link2 size={14} />
                                New Relationship
                            </button>
                        </div>
                    )}

                    {/* Data Ops */}
                    <div className="space-y-3">
                        <h2 className="text-[10px] font-black text-neutral-500 uppercase tracking-widest flex items-center gap-2 px-1">
                            <Database size={10} className="text-emerald-500" />
                            Data Sources
                        </h2>
                        <button
                            onClick={onOpenDbConnect}
                            className="w-full flex items-center gap-3 px-3 py-2 text-xs text-neutral-400 hover:text-white hover:bg-neutral-700/50 rounded-xl transition-all border border-neutral-700/50"
                        >
                            <Database size={14} className="text-emerald-500" />
                            {appMode === 'db' ? 'Change Live DB' : 'Import from DB'}
                        </button>
                        {appMode === 'db' && (
                            <button
                                onClick={() => {
                                    setSelectedTable(null);
                                    setTableDetails({});
                                    if (onRefreshDb) onRefreshDb();
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded-xl transition-all border border-blue-500/30"
                            >
                                <RefreshCw size={14} className="text-blue-400" />
                                Refresh Schema
                            </button>
                        )}
                        {(appMode as string) !== 'db' && (
                            <>
                                <button
                                    onClick={onOpenImport}
                                    className="w-full flex items-center gap-3 px-3 py-2 text-xs text-neutral-400 hover:text-white hover:bg-neutral-700/50 rounded-xl transition-all border border-neutral-700/50"
                                >
                                    <FileJson size={14} className="text-yellow-500" />
                                    Import CSV
                                </button>
                                <button
                                    onClick={onExportJson}
                                    className="w-full flex items-center gap-3 px-3 py-2 text-xs text-neutral-400 hover:text-white hover:bg-neutral-700/50 rounded-xl transition-all border border-neutral-700/50"
                                >
                                    <FileJson size={14} className="text-blue-400" />
                                    Export JSON
                                </button>
                            </>
                        )}
                    </div>

                    {/* SQL Export */}
                    {currentView === 'metadata' && (
                        <div className="space-y-3">
                            <h2 className="text-[10px] font-black text-neutral-500 uppercase tracking-widest flex items-center gap-2 px-1">
                                <Database size={10} className="text-blue-500" />
                                Metadata Export
                            </h2>
                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={() => onExportSql('full')}
                                    className="w-full flex items-center gap-3 px-3 py-2 text-xs text-neutral-300 hover:text-white hover:bg-neutral-700/50 rounded-xl transition-all border border-neutral-700/50"
                                >
                                    <ChevronRight size={14} className="text-blue-400" />
                                    Export Full DDL
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Navigation Tree */}
                    {(appMode as string) !== 'db' && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between px-1">
                                <h2 className="text-[10px] font-black text-neutral-500 uppercase tracking-widest flex items-center gap-2">
                                    <LayoutGrid size={10} className="text-yellow-500" />
                                    Areas Explorer
                                </h2>
                                {selectedCategoryId && (
                                    <button
                                        onClick={() => onSelectCategory(null)}
                                        className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors font-black uppercase"
                                    >
                                        Reset View
                                    </button>
                                )}
                            </div>
                            <div className="space-y-1">
                                <button
                                    onClick={() => onSelectCategory(null)}
                                    className={`w-full flex items-center gap-3 px-3 py-2 text-xs rounded-xl transition-all ${!selectedCategoryId ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30 font-bold' : 'text-neutral-400 hover:bg-neutral-700/50'
                                        }`}
                                >
                                    <Home size={14} />
                                    World Map
                                </button>
                                <div className="mt-2 border-l border-neutral-700/50 ml-2">
                                    <CategoryTree
                                        categories={data.categories}
                                        onSelect={onSelectCategory}
                                        selectedId={selectedCategoryId}
                                        onEdit={onEditCategory}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
                </div>
            )}

            <div className="p-3 border-t border-neutral-700 bg-neutral-900/50 flex flex-col gap-2 shrink-0">
                <button
                    onClick={onOpenSettings}
                    className="flex justify-center items-center gap-2 w-full py-2 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors text-[10px] font-bold uppercase tracking-widest"
                >
                    <Settings size={14} />
                    Settings
                </button>
                <div className="text-center">
                    <span className="text-[10px] text-neutral-600 font-black uppercase tracking-widest">
                        {data.tables.length} Tables Syncing...
                    </span>
                </div>
            </div>
        </div>
    );
};

const CategoryTree: React.FC<{
    categories: CategoryMetadata[],
    onSelect: (id: string | null) => void,
    selectedId: string | null,
    onEdit: (cat: CategoryMetadata) => void,
    parentId?: string | null
}> = ({ categories, onSelect, selectedId, onEdit, parentId = null }) => {
    const children = categories.filter(c =>
        (parentId === null ? (!c.parent_id || c.parent_id === null) : c.parent_id === parentId)
    );
    if (children.length === 0) return null;

    return (
        <ul className="pl-3 space-y-1 mt-1">
            {children.map(c => (
                <li key={c.id}>
                    <div className={`group flex items-center gap-1 rounded-lg transition-all ${selectedId === c.id
                        ? 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/30'
                        : 'text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700/30'
                        }`}>
                        <button
                            onClick={() => onSelect(c.id)}
                            className="flex-1 flex items-center gap-2 px-2 py-1.5 text-xs font-bold truncate"
                        >
                            <ChevronRight size={12} className={`${selectedId === c.id ? 'rotate-90 text-yellow-500' : 'text-neutral-600'} transition-transform`} />
                            <span className="truncate">{c.name}</span>
                        </button>
                        <button
                            onClick={() => onEdit(c)}
                            className="p-1.5 opacity-0 group-hover:opacity-100 hover:text-white transition-opacity"
                        >
                            <Edit3 size={12} />
                        </button>
                    </div>
                    <CategoryTree categories={categories} onSelect={onSelect} selectedId={selectedId} onEdit={onEdit} parentId={c.id} />
                </li>
            ))}
        </ul>
    );
};

export default Sidebar;
