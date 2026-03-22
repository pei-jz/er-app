import React from 'react';
import { AppMode, AppView, ErDiagramData, CategoryMetadata, TableDisplayMode, DbConfig } from '../types/er';
import { Database, FileJson, ChevronRight, LayoutGrid, Plus, Edit3, Home, Minimize2, Maximize2, Settings, PanelLeftClose, RefreshCw } from 'lucide-react';

interface SidebarProps {
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
    onToggle?: () => void;
    appMode: AppMode;
    dbConfig?: DbConfig;
    dbConnectionStatus: 'connected' | 'error' | 'disconnected';
    onRefreshDb?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
    currentView, setCurrentView, displayMode, setDisplayMode, data, selectedCategoryId, onSelectCategory,
    onOpenImport, onOpenDbConnect, onCreateCategory, onEditCategory, onExportSql, onExportJson, onOpenSettings,
    onToggle, appMode, dbConfig, dbConnectionStatus, onRefreshDb
}) => {
    return (
        <div className="w-64 bg-neutral-800 border-r border-neutral-700 flex flex-col h-full shadow-lg shrink-0">
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

            <div className="grid grid-cols-2 gap-1 p-1.5 bg-neutral-900 mx-3 mt-4 rounded-xl shadow-inner border border-neutral-700/50">
                {appMode !== 'db' && (
                    <button
                        className={`py-1.5 px-1 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${currentView === 'diagram' ? 'bg-neutral-700 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-300'
                            }`}
                        onClick={() => setCurrentView('diagram')}
                    >
                        Diagram
                    </button>
                )}
                <button
                    className={`py-1.5 px-1 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${currentView === 'metadata' ? 'bg-neutral-700 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-300'
                        }`}
                    onClick={() => setCurrentView('metadata')}
                >
                    Metadata
                </button>
                {appMode !== 'db' && (
                    <button
                        className={`py-1.5 px-1 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${currentView === 'history' ? 'bg-neutral-700 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-300'
                            }`}
                        onClick={() => setCurrentView('history')}
                    >
                        History
                    </button>
                )}
                <button
                    className={`py-1.5 px-1 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${currentView === 'sql' ? 'bg-neutral-700 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-300'
                        }`}
                    onClick={() => setCurrentView('sql')}
                >
                    SQL
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-8">
                <div className="space-y-6">
                    {/* Diagram Specific Controls */}
                    {currentView === 'diagram' && appMode !== 'db' && (
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
                    {appMode !== 'db' && (
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
                                onClick={onRefreshDb}
                                className="w-full flex items-center gap-3 px-3 py-2 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded-xl transition-all border border-blue-500/30"
                            >
                                <RefreshCw size={14} className="text-blue-400" />
                                Refresh Schema
                            </button>
                        )}
                        {appMode !== 'db' && (
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
                    {appMode !== 'db' && (
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

            <div className="p-3 border-t border-neutral-700 bg-neutral-900/50 flex flex-col gap-2">
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
