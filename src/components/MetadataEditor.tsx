import React, { useState, useMemo, useEffect } from 'react';
import { useErData } from '../hooks/useErData';
import { ErDiagramData, ColumnMetadata, MetadataSettings, TableMetadata, DbConfig } from '../types/er';
import { Table, List, Settings as SettingsIcon, Search, ArrowRight, Database, Layers, CheckCircle2, Edit3, GitCommit, Terminal } from 'lucide-react';
import { invoke } from "@tauri-apps/api/core";

interface MetadataEditorProps {
    data: ErDiagramData;
    dbConfig?: DbConfig;
    initialTab?: EditorTab;
    initialSearch?: string;
    onShowInEr: (tableName: string) => void;
    onOpenSchemaChange: (tableName?: string) => void;
    onSwitchToSql: () => void;
}

interface DbObject {
    name: string;
    object_type: string;
}

type EditorTab = 'tables' | 'columns' | 'indices' | 'procedures' | 'functions' | 'synonyms' | 'packages';

const MetadataEditor: React.FC<MetadataEditorProps> = ({
    data, dbConfig, onShowInEr, onOpenSchemaChange, onSwitchToSql,
    initialTab = 'tables', initialSearch = ''
}) => {
    const [activeTab, setActiveTab] = useState<EditorTab>(initialTab);
    const [searchTerm, setSearchTerm] = useState(initialSearch);
    const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
    const [catalog, setCatalog] = useState<DbObject[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, tableName: string } | null>(null);
    const [colContextMenu, setColContextMenu] = useState<{ x: number, y: number, tableName: string, colName: string } | null>(null);
    const { addSqlTab } = useErData();

    useEffect(() => {
        if (initialTab) setActiveTab(initialTab);
        if (initialSearch !== undefined) setSearchTerm(initialSearch);
    }, [initialTab, initialSearch]);

    const fetchCatalog = async () => {
        if (!dbConfig) return;
        setIsLoading(true);
        try {
            const res = await invoke<DbObject[]>('fetch_db_catalog', { config: dbConfig });
            setCatalog(res);
        } catch (e) {
            console.error("Failed to fetch catalog:", e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (dbConfig) fetchCatalog();
    }, [dbConfig]);

    const filteredTables = useMemo(() => {
        return data.tables.filter(t =>
            t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (t.comment || '').toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [data.tables, searchTerm]);

    const settings = data.settings || {
        showTableComment: true,
        showEngine: true,
        showPartition: false,
        showTablespace: false,
        showColumnComment: true,
        showDefaultValue: true,
        showLength: true,
        showPrecision: true,
        showScale: false,
        showAutoIncrement: true,
        showUnique: false,
        showCheckConstraint: false,
        showUnsigned: false,
        showZerofill: false,
        showBinary: false,
        showCharset: false,
        showCollation: false,
        showOnUpdate: false,
        showSequence: false,
        showVirtual: false,
        showVirtualExpr: false,
    };

    const handleContextMenu = (e: React.MouseEvent, tableName: string) => {
        e.preventDefault();
        setColContextMenu(null);
        setContextMenu({ x: e.clientX, y: e.clientY, tableName });
    };

    const handleColContextMenu = (e: React.MouseEvent, tableName: string, colName: string) => {
        e.preventDefault();
        setContextMenu(null);
        setColContextMenu({ x: e.clientX, y: e.clientY, tableName, colName });
    };

    const closeContextMenu = () => {
        setContextMenu(null);
        setColContextMenu(null);
    };

    useEffect(() => {
        const handleGlobalClick = () => closeContextMenu();
        window.addEventListener('click', handleGlobalClick);
        return () => window.removeEventListener('click', handleGlobalClick);
    }, []);

    const generateInsertForTable = (tableName: string) => {
        const table = data.tables.find(t => t.name === tableName);
        if (!table) return;

        const cols = table.columns.map(c => c.name).join(', ');
        const vals = table.columns.map(c => isNaN(Number(c.data_type)) ? "'?'" : '?').join(', ');
        const sqlTemplate = `-- INSERT Template for ${tableName}\nINSERT INTO ${tableName} (${cols}) \nVALUES (${vals});`;

        addSqlTab(`Insert ${tableName}`, sqlTemplate);
        onSwitchToSql();
        closeContextMenu();
    };

    const generateUpdateForColumn = (tableName: string, colName: string) => {
        const table = data.tables.find(t => t.name === tableName);
        if (!table) return;

        const pks = table.columns.filter(c => c.is_primary_key).map(c => c.name);
        const whereClause = pks.length > 0
            ? pks.map(pk => `${pk} = ?`).join(' AND ')
            : '/* specify condition */';

        const sqlTemplate = `-- UPDATE Template for ${tableName}.${colName}\nUPDATE ${tableName}\nSET ${colName} = ?\nWHERE ${whereClause};`;

        addSqlTab(`Update ${tableName}`, sqlTemplate);
        onSwitchToSql();
        closeContextMenu();
    };

    return (
        <div className="flex flex-col h-full bg-neutral-900 text-neutral-200">
            {/* Header / Tabs */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-md sticky top-0 z-20 flex-wrap gap-y-4">
                <div className="flex items-center gap-4 flex-wrap">
                    <TabButton
                        active={activeTab === 'tables'}
                        onClick={() => setActiveTab('tables')}
                        icon={<Table size={16} />}
                        label="Tables"
                        count={data.tables.length}
                    />
                    <TabButton
                        active={activeTab === 'columns'}
                        onClick={() => setActiveTab('columns')}
                        icon={<List size={16} />}
                        label="Columns"
                        count={data.tables.reduce((acc, t) => acc + t.columns.length, 0)}
                    />
                    <TabButton
                        active={activeTab === 'indices'}
                        onClick={() => setActiveTab('indices')}
                        icon={<SettingsIcon size={16} />}
                        label="Indices"
                        count={data.tables.reduce((acc, t) => acc + (t.indices?.length || 0), 0)}
                    />
                    <TabButton
                        active={activeTab === 'procedures'}
                        onClick={() => setActiveTab('procedures')}
                        icon={<Terminal size={16} className="text-pink-400" />}
                        label="Procs"
                        count={catalog.filter(o => o.object_type === 'PROCEDURE').length}
                    />
                    <TabButton
                        active={activeTab === 'functions'}
                        onClick={() => setActiveTab('functions')}
                        icon={<Terminal size={16} className="text-blue-400" />}
                        label="Funcs"
                        count={catalog.filter(o => o.object_type === 'FUNCTION').length}
                    />
                    <TabButton
                        active={activeTab === 'synonyms'}
                        onClick={() => setActiveTab('synonyms')}
                        icon={<GitCommit size={16} className="text-emerald-400" />}
                        label="Synonyms"
                        count={catalog.filter(o => o.object_type === 'SYNONYM').length}
                    />
                    <TabButton
                        active={activeTab === 'packages'}
                        onClick={() => setActiveTab('packages')}
                        icon={<Layers size={16} className="text-orange-400" />}
                        label="Packages"
                        count={catalog.filter(o => o.object_type === 'PACKAGE').length}
                    />
                </div>

                <div className="flex items-center gap-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" size={14} />
                        <input
                            type="text"
                            placeholder="Search metadata..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="bg-neutral-800 border border-neutral-700 rounded-full pl-9 pr-4 py-1.5 text-xs focus:ring-2 focus:ring-blue-500/50 outline-none w-64 transition-all focus:w-80"
                        />
                    </div>
                    <button
                        onClick={() => onOpenSchemaChange()}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-full text-xs font-bold transition-all shadow-lg active:scale-95"
                    >
                        <GitCommit size={14} />
                        Schema Change
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-auto p-6 scroll-smooth">
                {activeTab === 'tables' && (
                    <div className="grid grid-cols-1 gap-4">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="text-[10px] uppercase tracking-widest text-neutral-500 border-b border-neutral-800">
                                    <th className="px-4 py-3 font-black">Table Name</th>
                                    <th className="px-4 py-3 font-black">Category</th>
                                    {(settings.showEngine || settings.showPartition) && (
                                        <th className="px-4 py-3 font-black w-[300px]">Storage / Partitioning</th>
                                    )}
                                    {settings.showTableComment && <th className="px-4 py-3 font-black">Comment</th>}
                                    <th className="px-4 py-3 font-black text-right w-40">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-800/50">
                                {filteredTables.map((t) => (
                                    <tr
                                        key={t.name}
                                        onClick={() => setSelectedRowId(t.name)}
                                        onContextMenu={(e) => handleContextMenu(e, t.name)}
                                        className={`group hover:bg-neutral-800/30 transition-colors cursor-pointer border-b border-neutral-800/30 ${selectedRowId === t.name ? 'bg-blue-600/20' : ''}`}
                                    >
                                        <td className="px-4 py-2">
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded bg-blue-500/10 flex items-center justify-center text-blue-400 shrink-0">
                                                    <Table size={12} />
                                                </div>
                                                <span className="text-xs font-bold text-neutral-200">{t.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-2">
                                            <div className="flex items-center gap-1">
                                                {data.categories.filter(c => t.category_ids?.includes(c.id)).length > 0 ? (
                                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-400 truncate max-w-[150px]" title={data.categories.filter(c => t.category_ids?.includes(c.id)).map(c => c.name).join(', ')}>
                                                        {data.categories.filter(c => t.category_ids?.includes(c.id)).map(c => c.name).join(', ')}
                                                    </span>
                                                ) : <span className="text-[10px] text-neutral-600">-</span>}
                                            </div>
                                        </td>
                                        {(settings.showEngine || settings.showPartition) && (
                                            <td className="px-4 py-2">
                                                <div className="flex items-center gap-4 bg-neutral-800/20 px-3 py-1.5 rounded-lg border border-neutral-800/50">
                                                    {settings.showEngine && (
                                                        <div className="flex items-center gap-2">
                                                            <Database size={10} className="text-neutral-500" />
                                                            <span className="text-[9px] text-neutral-600 font-bold uppercase tracking-tighter shrink-0">Engine</span>
                                                            <span className="text-[10px] text-blue-400 font-bold">{t.mysql_engine || 'InnoDB'}</span>
                                                        </div>
                                                    )}
                                                    {settings.showPartition && (
                                                        <div className="flex items-center gap-2">
                                                            <Layers size={10} className="text-neutral-500" />
                                                            <span className="text-[9px] text-neutral-600 font-bold uppercase tracking-tighter shrink-0">Partition</span>
                                                            {t.has_partition ? (
                                                                <span className="text-[10px] text-emerald-400 font-bold">{t.partition_strategy || 'Active'}</span>
                                                            ) : (
                                                                <span className="text-[10px] text-neutral-600">None</span>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                        )}
                                        {settings.showTableComment && (
                                            <td className="px-4 py-2">
                                                <span className="text-[11px] text-neutral-400">{t.comment || '-'}</span>
                                            </td>
                                        )}
                                        <td className="px-4 py-2 text-right">
                                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onShowInEr(t.name); }}
                                                    className="p-1 text-emerald-400 hover:bg-emerald-400/10 rounded-lg transition-all"
                                                    title="Show in ER Diagram"
                                                >
                                                    <ArrowRight size={14} />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onOpenSchemaChange(t.name); }}
                                                    className="p-1 text-blue-400 hover:bg-blue-400/10 rounded-lg transition-all flex items-center gap-1 px-2"
                                                    title="Edit schema for this table"
                                                >
                                                    <Edit3 size={14} />
                                                    <span className="text-[10px] font-bold">Edit</span>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {activeTab === 'columns' && (
                    <div className="space-y-8">
                        {data.tables.filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            t.columns.some(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()))).map(table => (
                                <TableColumnsView
                                    key={table.name}
                                    table={table}
                                    searchTerm={searchTerm}
                                    settings={settings}
                                    selected={selectedRowId === table.name}
                                    onEdit={() => onOpenSchemaChange(table.name)}
                                    onColContextMenu={handleColContextMenu}
                                />
                            ))}
                    </div>
                )}

                {activeTab === 'indices' && (
                    <div className="space-y-8">
                        {data.tables.filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            (t.indices || []).some(idx => idx.name.toLowerCase().includes(searchTerm.toLowerCase()))).map(table => (
                                <TableIndicesView
                                    key={table.name}
                                    table={table}
                                    searchTerm={searchTerm}
                                    onEdit={() => onOpenSchemaChange(table.name)}
                                />
                            ))}
                    </div>
                )}

                {['procedures', 'functions', 'synonyms', 'packages'].includes(activeTab) && (
                    <div className={`bg-neutral-800/20 rounded-2xl p-6 border border-neutral-800/50 transition-opacity ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {catalog
                                .filter((o: DbObject) => o.object_type.toLowerCase() === activeTab.slice(0, -1).replace('proc', 'procedure').replace('func', 'function'))
                                .filter((o: DbObject) => o.name.toLowerCase().includes(searchTerm.toLowerCase()))
                                .map((obj: DbObject) => (
                                    <div key={obj.name} className="flex items-center gap-3 p-3 bg-neutral-900/50 rounded-xl border border-neutral-800 hover:border-blue-500/50 transition-all group">
                                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform">
                                            {activeTab === 'procedures' && <Terminal size={14} />}
                                            {activeTab === 'functions' && <Terminal size={14} />}
                                            {activeTab === 'synonyms' && <GitCommit size={14} />}
                                            {activeTab === 'packages' && <Layers size={14} />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-bold text-neutral-200 truncate">{obj.name}</div>
                                            <div className="text-[10px] text-neutral-500 uppercase tracking-widest">{obj.object_type}</div>
                                        </div>
                                    </div>
                                ))}
                        </div>
                        {catalog.filter(o => o.object_type.toLowerCase() === activeTab.slice(0, -1).replace('proc', 'procedure').replace('func', 'function')).length === 0 && (
                            <div className="py-20 text-center">
                                <Search size={32} className="mx-auto text-neutral-700 mb-2 opacity-20" />
                                <p className="text-neutral-500 text-sm">No {activeTab} found in this database.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {contextMenu && (
                <div
                    className="fixed z-50 bg-neutral-800 border border-neutral-700 rounded-md shadow-xl py-1 text-xs text-neutral-300 min-w-[150px]"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={() => generateInsertForTable(contextMenu.tableName)}
                        className="w-full text-left px-4 py-2 hover:bg-blue-600 hover:text-white transition-colors flex items-center gap-2"
                    >
                        <Terminal size={12} />
                        Generate INSERT
                    </button>
                    <button
                        onClick={() => { onShowInEr(contextMenu.tableName); closeContextMenu(); }}
                        className="w-full text-left px-4 py-2 hover:bg-blue-600 hover:text-white transition-colors flex items-center gap-2"
                    >
                        <ArrowRight size={12} />
                        Show in ER
                    </button>
                </div>
            )}

            {colContextMenu && (
                <div
                    className="fixed z-50 bg-neutral-800 border border-neutral-700 rounded-md shadow-xl py-1 text-xs text-neutral-300 min-w-[150px]"
                    style={{ top: colContextMenu.y, left: colContextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={() => generateUpdateForColumn(colContextMenu.tableName, colContextMenu.colName)}
                        className="w-full text-left px-4 py-2 hover:bg-emerald-600 hover:text-white transition-colors flex items-center gap-2"
                    >
                        <GitCommit size={12} />
                        Generate UPDATE for {colContextMenu.colName}
                    </button>
                </div>
            )}
        </div>
    );
};

// --- Optimized Components --- //

const TableColumnsView = React.memo(({ table, searchTerm, settings, selected, onEdit, onColContextMenu }: { table: TableMetadata, searchTerm: string, settings: MetadataSettings, selected: boolean, onEdit: () => void, onColContextMenu: (e: React.MouseEvent, t: string, c: string) => void }) => {
    const sortedAndDeduplicatedColumns = useMemo(() => {
        const unique = new Map<string, ColumnMetadata>();
        table.columns.forEach(c => unique.set(c.name, c)); // Deduplicate by name
        return Array.from(unique.values()).filter(c =>
            c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            table.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [table.columns, table.name, searchTerm]);

    if (sortedAndDeduplicatedColumns.length === 0) return null;

    return (
        <div className={`space-y-3 bg-neutral-800/20 rounded-2xl p-4 border transition-colors ${selected ? 'border-blue-500/50 bg-blue-500/5' : 'border-neutral-800/50'}`}>
            <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                    <Table size={12} className="text-blue-400" />
                    <h3 className="text-xs font-black uppercase tracking-widest text-neutral-400">{table.name}</h3>
                </div>
                <button
                    onClick={onEdit}
                    className="text-[10px] font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1 bg-blue-400/10 px-3 py-1 rounded-full transition-all"
                >
                    <Edit3 size={10} />
                    Edit Table
                </button>
            </div>
            <div className="overflow-x-auto custom-scrollbar-horizontal pb-2">
                <table className="w-full text-left border-collapse min-w-max">
                    <thead>
                        <tr className="text-[10px] uppercase tracking-widest text-neutral-600 border-b border-neutral-800/50">
                            <th className="px-4 py-2 font-black min-w-[150px]">Column Name</th>
                            <th className="px-4 py-2 font-black min-w-[100px]">Type</th>
                            {settings.showLength && <th className="px-4 py-2 font-black w-20">Length</th>}
                            {settings.showPrecision && <th className="px-4 py-2 font-black w-20">Prec.</th>}
                            {settings.showScale && <th className="px-4 py-2 font-black w-20">Scale</th>}
                            <th className="px-4 py-2 font-black min-w-[150px]">Attributes</th>
                            {settings.showDefaultValue && <th className="px-4 py-2 font-black w-32">Default</th>}
                            {settings.showAutoIncrement && <th className="px-4 py-2 font-black w-24">Auto</th>}
                            {settings.showOnUpdate && <th className="px-4 py-2 font-black w-32">On Update</th>}
                            {settings.showCharset && <th className="px-4 py-2 font-black w-24">Charset</th>}
                            {settings.showSequence && <th className="px-4 py-2 font-black w-32">Sequence</th>}
                            {settings.showVirtual && <th className="px-4 py-2 font-black w-48">Virtual Expr</th>}
                            {settings.showUnique && <th className="px-4 py-2 font-black w-24">Unique</th>}
                            {settings.showCheckConstraint && <th className="px-4 py-2 font-black w-48">Check</th>}
                            {settings.showColumnComment && <th className="px-4 py-2 font-black min-w-[200px]">Comment</th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800/30">
                        {sortedAndDeduplicatedColumns.map((column) => (
                            <ColumnRow key={column.name} tableName={table.name} column={column} settings={settings} onColContextMenu={onColContextMenu} />
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
});

const ColumnRow = React.memo(({ tableName, column, settings, onColContextMenu }: { tableName: string, column: ColumnMetadata, settings: MetadataSettings, onColContextMenu: (e: React.MouseEvent, t: string, c: string) => void }) => (
    <tr
        onContextMenu={(e) => onColContextMenu(e, tableName, column.name)}
        className={`group hover:bg-neutral-800/30 transition-colors cursor-default`}
    >
        <td className="px-4 py-2 sticky left-0 bg-neutral-900 group-hover:bg-neutral-800/50 z-10 border-r border-neutral-800/30">
            <span className={`text-xs font-bold ${column.is_primary_key ? 'text-yellow-500' : 'text-neutral-200'}`}>
                {column.name}
            </span>
        </td>
        <td className="px-4 py-2">
            <span className="text-xs font-mono text-blue-400/80">{column.data_type}</span>
        </td>
        {settings.showLength && (
            <td className="px-4 py-2 text-xs text-neutral-400">{column.length || '-'}</td>
        )}
        {settings.showPrecision && (
            <td className="px-4 py-2 text-xs text-neutral-400">{column.precision || '-'}</td>
        )}
        {settings.showScale && (
            <td className="px-4 py-2 text-xs text-neutral-400">{column.scale || '-'}</td>
        )}
        <td className="px-4 py-2">
            <div className="flex flex-wrap gap-1">
                {column.is_primary_key && <TagBadge label="PK" color="text-yellow-500 bg-yellow-500/10" />}
                {column.is_nullable ? <TagBadge label="NULL" color="text-emerald-500 bg-emerald-500/10" /> : <TagBadge label="NOT NULL" color="text-neutral-500 bg-neutral-500/15" />}
                {column.is_unsigned && <TagBadge label="UNSIGNED" color="text-orange-400 bg-orange-400/10" />}
                {column.is_binary && <TagBadge label="BINARY" color="text-purple-400 bg-purple-400/10" />}
            </div>
        </td>
        {settings.showDefaultValue && (
            <td className="px-4 py-2 text-[11px] text-neutral-500 font-mono">{column.default_value || 'NULL'}</td>
        )}
        {settings.showAutoIncrement && (
            <td className="px-4 py-2 text-center">
                {column.is_autoincrement ? <CheckCircle2 size={14} className="text-blue-500 mx-auto" /> : '-'}
            </td>
        )}
        {settings.showOnUpdate && (
            <td className="px-4 py-2 text-[10px] text-neutral-500">{column.on_update || '-'}</td>
        )}
        {settings.showCharset && (
            <td className="px-4 py-2 text-[10px] text-neutral-500">{column.charset || '-'}</td>
        )}
        {settings.showSequence && (
            <td className="px-4 py-2 text-[10px] text-neutral-400 font-mono italic">{column.sequence_name || '-'}</td>
        )}
        {settings.showVirtual && (
            <td className="px-4 py-2 text-[10px] text-neutral-500 italic max-w-xs truncate">{column.virtual_expression || '-'}</td>
        )}
        {settings.showUnique && (
            <td className="px-4 py-2 text-center">
                {column.is_unique ? <CheckCircle2 size={14} className="text-emerald-500 mx-auto" /> : '-'}
            </td>
        )}
        {settings.showCheckConstraint && (
            <td className="px-4 py-2 text-[10px] text-neutral-500 italic max-w-xs truncate">{column.check_constraint || '-'}</td>
        )}
        {settings.showColumnComment && (
            <td className="px-4 py-2 text-[11px] text-neutral-500">{column.comment || '-'}</td>
        )}
    </tr>
));

const TableIndicesView = React.memo(({ table, searchTerm, onEdit }: { table: TableMetadata, searchTerm: string, onEdit: () => void }) => {
    const indices = useMemo(() => {
        return (table.indices || []).filter(idx =>
            idx.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            table.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [table.indices, table.name, searchTerm]);

    if (indices.length === 0) return null;

    return (
        <div className="space-y-3 bg-neutral-800/20 rounded-2xl p-4 border border-neutral-800/50">
            <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                    <Table size={12} className="text-emerald-400" />
                    <h3 className="text-xs font-black uppercase tracking-widest text-neutral-400">{table.name}</h3>
                </div>
                <button
                    onClick={onEdit}
                    className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 bg-emerald-400/10 px-3 py-1 rounded-full transition-all"
                >
                    <Edit3 size={10} />
                    Edit Table
                </button>
            </div>
            <div className="overflow-x-auto custom-scrollbar-horizontal pb-2">
                <table className="w-full text-left border-collapse min-w-max">
                    <thead>
                        <tr className="text-[10px] uppercase tracking-widest text-neutral-600 border-b border-neutral-800/50">
                            <th className="px-4 py-2 font-black w-64">Index Name</th>
                            <th className="px-4 py-2 font-black w-64">Columns</th>
                            <th className="px-4 py-2 font-black w-24">Type</th>
                            <th className="px-4 py-2 font-black text-center w-24">Unique</th>
                            <th className="px-4 py-2 font-black min-w-[200px]">Comment</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800/30">
                        {indices.map(index => (
                            <tr key={index.name} className="group hover:bg-neutral-800/30 transition-colors cursor-default">
                                <td className="px-4 py-2">
                                    <span className="text-xs font-bold text-emerald-400">{index.name}</span>
                                </td>
                                <td className="px-4 py-2">
                                    <div className="flex flex-wrap gap-1">
                                        {index.columns.length > 0 ? index.columns.map(c => (
                                            <span key={c} className="text-[10px] px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-400">
                                                {c}
                                            </span>
                                        )) : <span className="text-[10px] text-neutral-600 italic">No columns</span>}
                                    </div>
                                </td>
                                <td className="px-4 py-2">
                                    <span className="text-[10px] text-neutral-400">{index.type || 'BTREE'}</span>
                                </td>
                                <td className="px-4 py-2 text-center">
                                    <div className="flex justify-center">
                                        {index.is_unique ? <CheckCircle2 size={14} className="text-emerald-500" /> : <div className="w-3 h-3 rounded-full border border-neutral-700 mx-auto" />}
                                    </div>
                                </td>
                                <td className="px-4 py-2">
                                    <span className="text-[10px] text-neutral-500">{index.comment || '-'}</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
});

const TabButton: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number }> = ({
    active, onClick, icon, label, count
}) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-2 pb-4 transition-all border-b-2 font-bold px-1 relative ${active ? 'border-blue-500 text-white' : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
    >
        {icon}
        <span className="text-sm tracking-wide">{label}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? 'bg-blue-500 text-white' : 'bg-neutral-800 text-neutral-500'}`}>
            {count}
        </span>
    </button>
);

const TagBadge: React.FC<{ label: string; color: string }> = ({ label, color }) => (
    <span className={`text-[9px] font-black tracking-tighter px-1.5 py-0.5 rounded shadow-sm ${color}`}>
        {label}
    </span>
);

export default MetadataEditor;
