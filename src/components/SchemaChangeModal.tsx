import React, { useState, useMemo } from 'react';
import { useErDiagram } from '../hooks/useErData';
import { TableMetadata, ColumnMetadata, SchemaChange, SchemaSnapshot, DEFAULT_DATA_TYPES_CONFIG } from '../types/er';
import { X, GitCommit, Plus, Trash2, Save, Database, Hash, ShieldCheck, AlertCircle } from 'lucide-react';

interface SchemaChangeModalProps {
    onClose: () => void;
    initialTarget?: string; // tableName
}

const SchemaChangeModal: React.FC<SchemaChangeModalProps> = ({ onClose, initialTarget }) => {
    const { data, setData, saveSnapshot } = useErDiagram();

    // Find original table or create a template for a new one
    const originalTable = useMemo(() => {
        return data.tables.find(t => t.name === initialTarget) || {
            name: 'New_Table',
            columns: [
                {
                    name: 'id',
                    data_type: 'int',
                    is_primary_key: true,
                    is_foreign_key: false,
                    is_nullable: false,
                    version: 1,
                    last_modified: Date.now()
                }
            ],
            indices: [],
            x: 100,
            y: 100
        };
    }, [data.tables, initialTarget]);

    // Local draft state
    const [localTable, setLocalTable] = useState<TableMetadata>({ ...originalTable, columns: originalTable.columns.map(c => ({ ...c })), indices: originalTable.indices ? originalTable.indices.map(i => ({ ...i, columns: [...i.columns] })) : [] });
    const [versionName, setVersionName] = useState('');
    const [description, setDescription] = useState('');
    const [activeTab, setActiveTab] = useState<'columns' | 'indices'>('columns');

    // New index local state
    const [newIndexName, setNewIndexName] = useState('');
    const [newIndexCols, setNewIndexCols] = useState<string[]>([]);
    const [newIndexUnique, setNewIndexUnique] = useState(false);

    // Detect changes
    const detectedChanges = useMemo(() => {
        const changes: SchemaChange[] = [];
        const isNew = !data.tables.some(t => t.name === initialTarget);

        if (isNew) {
            changes.push({
                type: 'create_table',
                targetName: localTable.name,
                description: `Created table ${localTable.name}`
            });
        } else {
            if (localTable.name !== originalTable.name) {
                changes.push({
                    type: 'alter_table',
                    targetName: originalTable.name,
                    description: `Renamed table to ${localTable.name}`
                });
            }

            // Check table-level fields
            if (localTable.mysql_engine !== originalTable.mysql_engine) {
                changes.push({ type: 'alter_table', targetName: localTable.name, description: `Changed engine to ${localTable.mysql_engine}` });
            }
            if (localTable.tablespace !== originalTable.tablespace) {
                changes.push({ type: 'alter_table', targetName: localTable.name, description: `Changed tablespace to ${localTable.tablespace}` });
            }

            // Check columns
            localTable.columns.forEach(lc => {
                const oc = originalTable.columns.find(c => c.name === lc.name);
                if (!oc) {
                    changes.push({
                        type: 'alter_table',
                        targetName: localTable.name,
                        description: `Added column ${lc.name} (${lc.data_type})`
                    });
                } else {
                    const diffs = [];
                    if (oc.data_type !== lc.data_type) diffs.push(`type: ${oc.data_type} -> ${lc.data_type}`);
                    if (oc.is_nullable !== lc.is_nullable) diffs.push(`nullable: ${oc.is_nullable} -> ${lc.is_nullable}`);
                    if (oc.is_primary_key !== lc.is_primary_key) diffs.push(`PK: ${oc.is_primary_key} -> ${lc.is_primary_key}`);
                    if (oc.default_value !== lc.default_value) diffs.push(`default: ${oc.default_value} -> ${lc.default_value}`);
                    if (oc.comment !== lc.comment) diffs.push(`comment changed`);
                    if (oc.length !== lc.length) diffs.push(`length: ${oc.length} -> ${lc.length}`);
                    if (oc.is_autoincrement !== lc.is_autoincrement) diffs.push(`auto_inc: ${oc.is_autoincrement} -> ${lc.is_autoincrement}`);

                    if (diffs.length > 0) {
                        changes.push({
                            type: 'alter_table',
                            targetName: localTable.name,
                            description: `Modified column ${lc.name} (${diffs.join(', ')})`
                        });
                    }
                }
            });

            originalTable.columns.forEach(oc => {
                if (!localTable.columns.some(c => c.name === oc.name)) {
                    changes.push({
                        type: 'alter_table',
                        targetName: localTable.name,
                        description: `Dropped column ${oc.name}`
                    });
                }
            });

            // Check indices
            const currentIndices = localTable.indices || [];
            const oldIndices = originalTable.indices || [];

            currentIndices.forEach(li => {
                const oi = oldIndices.find(i => i.name === li.name);
                if (!oi) {
                    changes.push({ type: 'create_index', targetName: localTable.name, description: `Added index ${li.name} (${li.columns.join(',')})` });
                }
            });
            oldIndices.forEach(oi => {
                if (!currentIndices.some(i => i.name === oi.name)) {
                    changes.push({ type: 'drop_index', targetName: localTable.name, description: `Dropped index ${oi.name}` });
                }
            });
        }

        return changes;
    }, [localTable, originalTable, data.tables, initialTarget]);

    const handleCommit = () => {
        if (!versionName.trim()) {
            alert('Please enter a version name');
            return;
        }

        // 1. Update the tables in the main data
        setData(prev => {
            const isNew = !prev.tables.some(t => t.name === initialTarget);
            let updatedTables = [...prev.tables];

            const finalTable = {
                ...localTable,
                columns: localTable.columns.map(c => {
                    const oc = originalTable.columns.find(o => o.name === c.name);
                    const hasChanged = !oc || JSON.stringify(oc) !== JSON.stringify(c);
                    return {
                        ...c,
                        version: hasChanged ? (c.version || 0) + 1 : c.version,
                        last_modified: hasChanged ? Date.now() : c.last_modified
                    };
                })
            };

            if (isNew) {
                updatedTables.push(finalTable);
            } else {
                updatedTables = updatedTables.map(t => t.name === initialTarget ? finalTable : t);
            }

            return { ...prev, tables: updatedTables };
        });

        // 2. Create and save snapshot
        const snapshot: SchemaSnapshot = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            versionName,
            author: 'Developer',
            description,
            changes: detectedChanges,
            tables: data.tables,
            categories: data.categories
        };

        saveSnapshot(snapshot);
        onClose();
    };

    const addColumn = () => {
        const newCol: ColumnMetadata = {
            name: `column_${localTable.columns.length + 1}`,
            data_type: 'varchar(255)',
            is_primary_key: false,
            is_foreign_key: false,
            is_nullable: true,
            version: 1,
            last_modified: Date.now()
        };
        setLocalTable(prev => ({ ...prev, columns: [...prev.columns, newCol] }));
    };

    const removeColumn = (name: string) => {
        setLocalTable(prev => ({ ...prev, columns: prev.columns.filter(c => c.name !== name) }));
    };

    const updateColumn = (idx: number, updates: Partial<ColumnMetadata>) => {
        setLocalTable(prev => {
            const newCols = [...prev.columns];
            newCols[idx] = { ...newCols[idx], ...updates };
            return { ...prev, columns: newCols };
        });
    };

    const addIndex = () => {
        if (!newIndexName || newIndexCols.length === 0) return;
        const newIdx = {
            name: newIndexName.trim(),
            columns: newIndexCols,
            is_unique: newIndexUnique,
            version: 1,
            last_modified: Date.now()
        };
        setLocalTable(prev => ({ ...prev, indices: [...(prev.indices || []), newIdx] }));
        setNewIndexName('');
        setNewIndexCols([]);
        setNewIndexUnique(false);
    };

    const removeIndex = (name: string) => {
        setLocalTable(prev => ({ ...prev, indices: (prev.indices || []).filter(i => i.name !== name) }));
    };

    const settings = data.settings || {} as any;
    const availableTypes = settings.availableDataTypesConfigs || DEFAULT_DATA_TYPES_CONFIG;
    const activeDb = settings.activeDatabase || 'all';

    const filteredTypes = useMemo(() => {
        if (activeDb === 'all') return availableTypes;
        return availableTypes.filter((t: any) => t[activeDb]);
    }, [availableTypes, activeDb]);

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
            <div className="bg-neutral-900 border border-neutral-800 rounded-[2.5rem] w-full max-w-7xl shadow-2xl flex flex-col max-h-[95vh] overflow-hidden border-t-white/10 text-neutral-300">

                {/* Header */}
                <div className="px-8 py-6 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/50">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20">
                            <GitCommit size={28} />
                        </div>
                        <div>
                            <h3 className="text-xl font-black text-white italic leading-tight tracking-tight">Register DB Change</h3>
                            <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-[0.2em] mt-0.5">
                                {initialTarget ? `Modify Table: ${initialTarget}` : 'New Schema Version'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-neutral-800 text-neutral-500 transition-all hover:text-white">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 flex overflow-hidden">
                    {/* Left Panel: Schema Editor */}
                    <div className="flex-1 flex flex-col border-r border-neutral-800 bg-black/20">
                        <div className="p-6 border-b border-neutral-800 bg-neutral-900/20 space-y-4">
                            <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500 ml-1 block">Table Configuration</label>
                            <div className="grid grid-cols-[1fr_auto] gap-4">
                                <div className="relative flex items-center h-12">
                                    {!!initialTarget ? (
                                        <div className="flex items-center gap-3 w-full bg-neutral-800/20 border border-neutral-700/50 rounded-2xl pl-12 pr-4 py-3 h-[50px]">
                                            <Database className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" size={18} />
                                            <span className="text-xl font-black text-blue-400 tracking-wide truncate">{localTable.name}</span>
                                        </div>
                                    ) : (
                                        <>
                                            <Database className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-600" size={16} />
                                            <input
                                                value={localTable.name}
                                                onChange={e => setLocalTable(prev => ({ ...prev, name: e.target.value }))}
                                                className="w-full bg-neutral-800/40 border border-neutral-700/50 rounded-2xl pl-12 pr-4 py-3 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-blue-500/50 transition-all h-[50px]"
                                                placeholder="Table Name"
                                            />
                                        </>
                                    )}
                                </div>
                                <div className="flex bg-neutral-800/40 p-1 rounded-2xl border border-neutral-700/50 h-[50px]">
                                    <button
                                        onClick={() => setActiveTab('columns')}
                                        className={`flex-1 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'columns' ? 'bg-blue-600 text-white' : 'text-neutral-500 hover:text-neutral-300'}`}
                                    >
                                        Columns
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('indices')}
                                        className={`flex-1 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'indices' ? 'bg-blue-600 text-white' : 'text-neutral-500 hover:text-neutral-300'}`}
                                    >
                                        Indices
                                    </button>
                                </div>
                            </div>

                            {/* Table Level Extra Settings */}
                            <div className="flex items-center gap-4">
                                {settings.showEngine && (
                                    <div className="flex-1 space-y-1">
                                        <p className="text-[9px] font-bold text-neutral-600 uppercase ml-2">Engine</p>
                                        <input
                                            value={localTable.mysql_engine || ''}
                                            onChange={e => setLocalTable(prev => ({ ...prev, mysql_engine: e.target.value }))}
                                            className="w-full bg-neutral-800/40 border border-neutral-700/50 rounded-xl px-4 py-2 text-xs text-white outline-none"
                                            placeholder="InnoDB"
                                        />
                                    </div>
                                )}
                                {settings.showTablespace && (
                                    <div className="flex-1 space-y-1">
                                        <p className="text-[9px] font-bold text-neutral-600 uppercase ml-2">Tablespace</p>
                                        <input
                                            value={localTable.tablespace || ''}
                                            onChange={e => setLocalTable(prev => ({ ...prev, tablespace: e.target.value }))}
                                            className="w-full bg-neutral-800/40 border border-neutral-700/50 rounded-xl px-4 py-2 text-xs text-white outline-none"
                                            placeholder="USERS"
                                        />
                                    </div>
                                )}
                                {settings.showTableComment && (
                                    <div className="flex-[2] space-y-1">
                                        <p className="text-[9px] font-bold text-neutral-600 uppercase ml-2">Comment</p>
                                        <input
                                            value={localTable.comment || ''}
                                            onChange={e => setLocalTable(prev => ({ ...prev, comment: e.target.value }))}
                                            className="w-full bg-neutral-800/40 border border-neutral-700/50 rounded-xl px-4 py-2 text-xs text-white outline-none"
                                            placeholder="Table Purpose..."
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto p-6 custom-scrollbar-horizontal">
                            {activeTab === 'columns' ? (
                                <div className="min-w-max space-y-3">
                                    {localTable.columns.map((col, idx) => (
                                        <div key={idx} className="group bg-neutral-800/20 border border-neutral-800/50 rounded-2xl p-4 flex items-center gap-4 hover:border-neutral-700 transition-all">
                                            <div className="flex flex-col gap-2">
                                                <input
                                                    value={col.name}
                                                    onChange={e => updateColumn(idx, { name: e.target.value })}
                                                    readOnly={!!initialTarget && originalTable.columns.some(c => c.name === col.name)}
                                                    className={`bg-transparent border-none text-xs font-black text-white outline-none w-40 focus:text-blue-400 ${!!initialTarget && originalTable.columns.some(c => c.name === col.name) ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                    placeholder="Column Name"
                                                />
                                                <select
                                                    value={col.data_type}
                                                    onChange={e => updateColumn(idx, { data_type: e.target.value })}
                                                    className="bg-neutral-800 border border-neutral-700/50 rounded-lg px-2 py-1 text-[10px] font-mono text-emerald-400 outline-none"
                                                >
                                                    {filteredTypes.map((t: any) => (
                                                        <option key={t.name} value={t.name} className="bg-neutral-800 text-white font-mono">{t.name}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="h-10 w-px bg-neutral-800 mx-2" />

                                            <div className="flex items-center gap-4">
                                                {settings.showLength && (
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-[8px] font-bold text-neutral-600 uppercase">Len</span>
                                                        <input
                                                            type="number"
                                                            value={col.length || ''}
                                                            onChange={e => updateColumn(idx, { length: parseInt(e.target.value) || undefined })}
                                                            className="w-16 bg-neutral-800/50 border border-neutral-700/50 rounded-lg px-2 py-1 text-[10px] text-white outline-none"
                                                        />
                                                    </div>
                                                )}
                                                {settings.showDefaultValue && (
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-[8px] font-bold text-neutral-600 uppercase">Default</span>
                                                        <input
                                                            value={col.default_value || ''}
                                                            onChange={e => updateColumn(idx, { default_value: e.target.value })}
                                                            className="w-24 bg-neutral-800/50 border border-neutral-700/50 rounded-lg px-2 py-1 text-[10px] text-white outline-none font-mono"
                                                        />
                                                    </div>
                                                )}
                                                {settings.showAutoIncrement && (
                                                    <button
                                                        onClick={() => updateColumn(idx, { is_autoincrement: !col.is_autoincrement })}
                                                        className={`p-1.5 mt-4 rounded-lg border transition-all ${col.is_autoincrement ? 'bg-blue-500/10 border-blue-500/50 text-blue-500' : 'bg-neutral-800 border-neutral-700 text-neutral-600'}`}
                                                        title="Auto Increment"
                                                    >
                                                        <Hash size={12} />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => updateColumn(idx, { is_primary_key: !col.is_primary_key })}
                                                    className={`p-1.5 mt-4 rounded-lg border transition-all ${col.is_primary_key ? 'bg-yellow-500/10 border-yellow-500/50 text-yellow-500' : 'bg-neutral-800 border-neutral-700 text-neutral-600'}`}
                                                    title="Primary Key"
                                                >
                                                    <ShieldCheck size={12} />
                                                </button>
                                                <button
                                                    onClick={() => updateColumn(idx, { is_nullable: !col.is_nullable })}
                                                    className={`p-1.5 mt-4 rounded-lg border transition-all ${!col.is_nullable ? 'bg-red-500/10 border-red-500/50 text-red-500' : 'bg-neutral-800 border-neutral-700 text-neutral-600'}`}
                                                    title="Not Null"
                                                >
                                                    <AlertCircle size={12} />
                                                </button>
                                            </div>

                                            <div className="h-10 w-px bg-neutral-800 mx-2" />

                                            <div className="flex-1 grid grid-cols-2 gap-4">
                                                {settings.showColumnComment && (
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-[8px] font-bold text-neutral-600 uppercase">Comment</span>
                                                        <input
                                                            value={col.comment || ''}
                                                            onChange={e => updateColumn(idx, { comment: e.target.value })}
                                                            className="w-full bg-neutral-800/50 border border-neutral-700/50 rounded-lg px-3 py-1.5 text-[10px] text-white outline-none"
                                                            placeholder="Description..."
                                                        />
                                                    </div>
                                                )}
                                                {settings.showCharset && (
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-[8px] font-bold text-neutral-600 uppercase">Charset</span>
                                                        <input
                                                            value={col.charset || ''}
                                                            onChange={e => updateColumn(idx, { charset: e.target.value })}
                                                            className="w-full bg-neutral-800/50 border border-neutral-700/50 rounded-lg px-3 py-1.5 text-[10px] text-white outline-none"
                                                            placeholder="utf8mb4"
                                                        />
                                                    </div>
                                                )}
                                            </div>

                                            <button
                                                onClick={() => removeColumn(col.name)}
                                                className="p-1.5 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-600 hover:text-red-400 hover:border-red-400/50 transition-all opacity-0 group-hover:opacity-100"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        onClick={addColumn}
                                        className="w-full py-4 border-2 border-dashed border-neutral-800 rounded-2xl text-neutral-500 hover:text-blue-400 hover:border-blue-500/30 hover:bg-blue-500/5 transition-all flex items-center justify-center gap-2 group"
                                    >
                                        <Plus size={16} className="group-hover:scale-110 transition-transform" />
                                        <span className="text-[10px] font-black uppercase tracking-widest">Add Column</span>
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {(localTable.indices || []).map((idx_item, i) => (
                                        <div key={i} className="group bg-neutral-800/20 border border-neutral-800/50 rounded-2xl p-4 flex items-center gap-4 hover:border-neutral-700 transition-all">
                                            <span className="text-white text-xs font-bold w-40">{idx_item.name}</span>
                                            <div className="h-10 w-px bg-neutral-800 mx-2" />
                                            <span className="text-emerald-400 font-mono text-[10px] bg-neutral-800/50 px-2 py-1 rounded-lg">
                                                {idx_item.columns.join(', ')}
                                            </span>
                                            {idx_item.is_unique && <span className="text-yellow-500 text-[10px] ml-4 font-bold">UNIQUE</span>}
                                            <div className="flex-1" />
                                            <button onClick={() => removeIndex(idx_item.name)} className="p-1.5 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-600 hover:text-red-400 hover:border-red-400/50 transition-all opacity-0 group-hover:opacity-100">
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    ))}
                                    <div className="bg-neutral-800/20 border border-neutral-800/50 rounded-2xl p-4 flex items-center gap-4 mt-4">
                                        <input
                                            value={newIndexName}
                                            onChange={e => setNewIndexName(e.target.value)}
                                            placeholder="Index Name"
                                            className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg px-2 py-1 text-xs text-white outline-none w-32"
                                        />
                                        <div className="flex-1 flex flex-col gap-2">
                                            <div className="flex flex-wrap gap-1 min-h-[24px] bg-neutral-900/40 border border-neutral-700/30 rounded-lg p-1.5 items-center">
                                                {newIndexCols.length === 0 && <span className="text-[10px] text-neutral-600 italic px-1">Select columns...</span>}
                                                {newIndexCols.map((col, i) => (
                                                    <span key={`${col}-${i}`} className="flex items-center gap-1 bg-blue-600/20 border border-blue-500/30 text-blue-400 text-[10px] font-bold px-2 py-0.5 rounded-md">
                                                        <span className="text-[8px] opacity-50 mr-0.5">{i + 1}.</span>
                                                        {col}
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                setNewIndexCols(prev => prev.filter((_, idx) => idx !== i));
                                                            }}
                                                            className="hover:text-white transition-colors ml-1 focus:outline-none"
                                                        >
                                                            <X size={10} />
                                                        </button>
                                                    </span>
                                                ))}
                                            </div>
                                            <select
                                                value=""
                                                onChange={e => {
                                                    if (e.target.value && !newIndexCols.includes(e.target.value)) {
                                                        setNewIndexCols([...newIndexCols, e.target.value]);
                                                    }
                                                }}
                                                className="bg-neutral-800 border border-neutral-700/50 rounded-lg px-2 py-1.5 text-xs text-white outline-none w-full"
                                            >
                                                <option value="" disabled className="text-neutral-500">Pick column to insert...</option>
                                                {Array.from(new Set(localTable.columns.map(c => c.name)))
                                                    .filter(cName => !newIndexCols.includes(cName))
                                                    .map(cName => (
                                                        <option key={cName} value={cName} className="bg-neutral-800 text-white">{cName}</option>
                                                    ))}
                                            </select>
                                        </div>
                                        <label className="flex items-center gap-1 text-[10px] text-neutral-400 cursor-pointer">
                                            <input type="checkbox" checked={newIndexUnique} onChange={e => setNewIndexUnique(e.target.checked)} className="accent-blue-500" /> Unique
                                        </label>
                                        <button onClick={addIndex} className="p-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
                                            <Plus size={14} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right Panel: Change Registration */}
                    <div className="w-[480px] flex-shrink-0 flex flex-col bg-neutral-900 border-l border-neutral-800">
                        <div className="p-6 flex-1 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500 ml-1">Version Title</label>
                                    <input
                                        value={versionName}
                                        onChange={e => setVersionName(e.target.value)}
                                        className="w-full bg-neutral-800/50 border border-neutral-700/50 rounded-xl px-4 py-3 text-xs font-bold text-white outline-none focus:ring-1 focus:ring-blue-500/50 transition-all"
                                        placeholder="e.g. Add User Table"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500 ml-1">Description</label>
                                    <textarea
                                        value={description}
                                        onChange={e => setDescription(e.target.value)}
                                        className="w-full bg-neutral-800/50 border border-neutral-700/50 rounded-xl px-4 py-3 text-xs text-neutral-400 outline-none focus:ring-1 focus:ring-blue-500/50 transition-all min-h-[100px]"
                                        placeholder="Explain the reason for this change..."
                                    />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-neutral-500 ml-1 flex items-center gap-2">
                                    <AlertCircle size={10} />
                                    Detected Changes
                                </h4>
                                <div className="space-y-2">
                                    {detectedChanges.length === 0 ? (
                                        <p className="text-[10px] text-neutral-600 italic px-1">No changes detected</p>
                                    ) : (
                                        detectedChanges.map((change, i) => (
                                            <div key={i} className="text-[10px] bg-neutral-800/40 p-2 rounded-lg border border-neutral-800 text-neutral-400 leading-relaxed font-medium">
                                                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 ${change.type === 'create_table' ? 'bg-emerald-500' : 'bg-blue-400'}`} />
                                                {change.description}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t border-neutral-800">
                            <button
                                onClick={handleCommit}
                                disabled={detectedChanges.length === 0}
                                className={`w-full py-4 rounded-2xl flex items-center justify-center gap-2 text-xs font-black transition-all active:scale-95 shadow-xl ${detectedChanges.length > 0 ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20' : 'bg-neutral-800 text-neutral-600 cursor-not-allowed'}`}
                            >
                                <Save size={16} />
                                COMMIT VERSION
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SchemaChangeModal;
