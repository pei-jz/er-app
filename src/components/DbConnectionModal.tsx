import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DbConfig, TableMetadata } from '../types/er';
import { X, Database, AlertCircle, Clock, Plus, Server, Trash2, GripVertical, Save } from 'lucide-react';

interface DbConnectionModalProps {
    onClose: () => void;
    onImport?: (tables: TableMetadata[], config: DbConfig) => Promise<void>;
    onConnect?: (config: DbConfig) => Promise<void>;
    mode?: 'import' | 'connect';
}

const DbConnectionModal: React.FC<DbConnectionModalProps> = ({ onClose, onImport, onConnect, mode = 'import' }) => {
    const [config, setConfig] = useState<DbConfig>({
        db_type: 'mysql',
        host: '',
        port: 3306,
        user: '',
        pass: '',
        db_name: '',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [history, setHistory] = useState<Omit<DbConfig, 'pass'>[]>([]);
    const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
    const [overIndex, setOverIndex] = useState<number | null>(null);

    React.useEffect(() => {
        try {
            const saved = localStorage.getItem('db_connections_history');
            if (saved) {
                setHistory(JSON.parse(saved));
            }
        } catch (e) {
            console.error("Failed to parse history", e);
        }
    }, []);

    const generateDefaultName = (c: DbConfig) => {
        if (c.name) return c.name;
        return `${c.user}@${c.host}:${c.db_name}`;
    };

    const saveHistory = (c: DbConfig) => {
        try {
            const nameToUse = c.name || generateDefaultName(c);
            const newEntry = { ...c, name: nameToUse, pass: '' };
            const filtered = history.filter(h => !(h.host === c.host && h.port === c.port && h.db_name === c.db_name && h.user === c.user));
            const updated = [newEntry, ...filtered].slice(0, 15);
            setHistory(updated);
            localStorage.setItem('db_connections_history', JSON.stringify(updated));
            setConfig(prev => ({ ...prev, name: nameToUse }));
        } catch (e) {
            console.error("Failed to save history", e);
        }
    };

    const handleSaveHistoryOnly = () => {
        saveHistory(config);
        // Maybe show a brief success state or toast? For now, list update is feedback.
    };

    const handleDeleteHistory = (e: React.MouseEvent, index: number) => {
        e.stopPropagation();
        const updated = history.filter((_, i) => i !== index);
        setHistory(updated);
        localStorage.setItem('db_connections_history', JSON.stringify(updated));
    };

    React.useEffect(() => {
        if (draggingIndex === null) return;

        const handleMouseUp = () => {
            if (overIndex !== null && overIndex !== draggingIndex) {
                setHistory(prev => {
                    const updated = [...prev];
                    const [movedItem] = updated.splice(draggingIndex, 1);
                    updated.splice(overIndex, 0, movedItem);
                    localStorage.setItem('db_connections_history', JSON.stringify(updated));
                    return updated;
                });
            }
            setDraggingIndex(null);
            setOverIndex(null);
        };

        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [draggingIndex, overIndex]);

    const handleItemMouseDown = (index: number, e: React.MouseEvent) => {
        if (e.button !== 0) return;
        setDraggingIndex(index);
    };

    const handleItemMouseEnter = (index: number) => {
        if (draggingIndex !== null) {
            setOverIndex(index);
        }
    };

    const handleConnect = async () => {
        setLoading(true);
        setError(null);
        try {
            // Force close existing session first to ensure a fresh connection (user requirement)
            await invoke('close_db_session').catch(() => {});

            const nameToUse = config.name || generateDefaultName(config);
            const updatedConfig = { ...config, name: nameToUse };
            
            if (mode === 'import') {
                const tables = await invoke<TableMetadata[]>('fetch_db_metadata', { config: updatedConfig });
                saveHistory(updatedConfig);
                await onImport?.(tables, updatedConfig);
            } else {
                saveHistory(updatedConfig);
                await onConnect?.(updatedConfig);
            }
            // Only close on success
            onClose();
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleConnect();
        }
    };

    const handleNewConnection = () => {
        setConfig({
            db_type: 'mysql',
            host: '',
            port: 3306,
            user: '',
            pass: '',
            db_name: '',
            name: ''
        });
        setError(null);
    };

    const selectFromHistory = (h: Omit<DbConfig, 'pass'>) => {
        setConfig({ ...h, pass: '' });
        setError(null);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 text-neutral-100">
            <div className="bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-neutral-700 flex items-center justify-between bg-neutral-800/50">
                    <div className="flex items-center gap-3">
                        <Database className="text-blue-500" size={24} />
                        <h2 className="text-xl font-bold">{mode === 'import' ? 'Import from DB' : 'Database Connection'}</h2>
                    </div>
                    <button onClick={onClose} className="text-neutral-400 hover:text-white transition-colors p-1 hover:bg-neutral-700 rounded-lg">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex flex-1 min-h-0 overflow-hidden">
                    {/* Left Sidebar: Saved Connections */}
                    <div className="w-64 border-r border-neutral-700 bg-neutral-900/30 flex flex-col">
                        <div className="p-4 border-b border-neutral-700/50">
                            <button 
                                onClick={handleNewConnection}
                                className="w-full flex items-center justify-center gap-2 bg-neutral-700 hover:bg-neutral-600 py-2 rounded-lg text-xs font-bold transition-all"
                            >
                                <Plus size={14} /> New Connection
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                            <div className="px-2 pb-2">
                                <span className="text-[10px] font-black text-neutral-500 uppercase tracking-widest flex items-center gap-1">
                                    <Clock size={12} /> Recent
                                </span>
                            </div>
                            {history.length === 0 ? (
                                <div className="p-4 text-center">
                                    <p className="text-[10px] text-neutral-600">No saved connections</p>
                                </div>
                            ) : (
                                history.map((h, i) => (
                                    <div
                                        key={`${h.host}-${h.port}-${h.db_name}-${h.user}-${i}`}
                                        onMouseDown={(e) => handleItemMouseDown(i, e)}
                                        onMouseEnter={() => handleItemMouseEnter(i)}
                                        className={`w-full group flex items-center gap-1 px-1 rounded-lg transition-all select-none cursor-grab active:cursor-grabbing ${
                                            draggingIndex === i ? 'opacity-30' : overIndex === i ? 'bg-blue-500/10 scale-[1.02]' : ''
                                        }`}
                                    >
                                        <div className="p-1 text-neutral-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <GripVertical size={12} />
                                        </div>
                                        <div
                                            onClick={(e) => { e.stopPropagation(); selectFromHistory(h); }}
                                            className={`flex-1 text-left p-2.5 rounded-lg border transition-all flex items-center gap-2.5 cursor-pointer ${
                                                config.host === h.host && config.db_name === h.db_name && config.user === h.user 
                                                    ? 'bg-blue-600/10 border-blue-500/50' 
                                                    : 'border-transparent hover:bg-neutral-800'
                                            }`}
                                        >
                                            <div className={`p-1.5 rounded-md shrink-0 ${config.host === h.host && config.db_name === h.db_name && config.user === h.user ? 'bg-blue-500 text-white' : 'bg-neutral-800 text-neutral-400'}`}>
                                                <Server size={14} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[11px] font-bold text-neutral-200 group-hover:text-white truncate">
                                                    {h.name || h.host}
                                                </div>
                                                <div className="text-[9px] text-neutral-500 truncate lowercase opacity-70">
                                                    {h.db_type}://{h.host}
                                                </div>
                                            </div>
                                            <button
                                                onClick={(e) => handleDeleteHistory(e, i)}
                                                className="p-1.5 text-neutral-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded-md hover:bg-red-500/10"
                                                title="Delete history"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Right Pane: Connection Form */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-8 bg-neutral-800/30">
                        <div className="max-w-2xl mx-auto space-y-6">
                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Connection Alias</label>
                                    <input
                                        type="text"
                                        value={config.name || ''}
                                        onChange={e => setConfig({ ...config, name: e.target.value })}
                                        onKeyDown={handleKeyDown}
                                        placeholder="e.g. My Production DB"
                                        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-neutral-700"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Database Type</label>
                                    <select
                                        value={config.db_type}
                                        onChange={e => {
                                            const type = e.target.value as any;
                                            setConfig({
                                                ...config,
                                                db_type: type,
                                                port: type === 'mysql' ? 3306 : type === 'postgres' ? 5432 : 1521
                                            });
                                        }}
                                        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                    >
                                        <option value="mysql">MySQL</option>
                                        <option value="postgres">PostgreSQL</option>
                                        <option value="oracle">Oracle</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-4 gap-6">
                                <div className="col-span-3 space-y-2">
                                    <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Host / Endpoint</label>
                                    <input
                                        type="text"
                                        value={config.host}
                                        onChange={e => setConfig({ ...config, host: e.target.value })}
                                        onKeyDown={handleKeyDown}
                                        placeholder="localhost or 127.0.0.1"
                                        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Port</label>
                                    <input
                                        type="number"
                                        value={config.port}
                                        onChange={e => setConfig({ ...config, port: parseInt(e.target.value) || 0 })}
                                        onKeyDown={handleKeyDown}
                                        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Username</label>
                                    <input
                                        type="text"
                                        value={config.user}
                                        onChange={e => setConfig({ ...config, user: e.target.value })}
                                        onKeyDown={handleKeyDown}
                                        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Password</label>
                                    <input
                                        type="password"
                                        value={config.pass}
                                        onChange={e => setConfig({ ...config, pass: e.target.value })}
                                        onKeyDown={handleKeyDown}
                                        placeholder="••••••••"
                                        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Database Name</label>
                                <input
                                    type="text"
                                    value={config.db_name}
                                    onChange={e => setConfig({ ...config, db_name: e.target.value })}
                                    onKeyDown={handleKeyDown}
                                    placeholder="e.g. production_db"
                                    className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                />
                            </div>

                            {error && (
                                <div className="space-y-3 pt-2">
                                    <div className="flex items-start gap-4 p-4 bg-red-500/10 border border-red-500/50 rounded-xl text-red-400 text-xs leading-relaxed shadow-lg">
                                        <AlertCircle size={18} className="shrink-0 mt-0.5" />
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold mb-1">Connection Error</p>
                                            <p className="opacity-90 break-words">{error}</p>
                                        </div>
                                    </div>
                                    {error.includes('1045') && (
                                        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-[10px] leading-relaxed">
                                            <p className="font-bold mb-1 tracking-wider uppercase opacity-80">Troubleshooting Tip</p>
                                            <p>Access denied. Please check your password. If you are using 'localhost' on Windows, try using '127.0.0.1' instead, as MySQL permissions for these two can be different.</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="px-6 py-4 bg-neutral-900/80 border-t border-neutral-700 flex justify-between items-center bg-neutral-800">
                    <div className="text-[10px] text-neutral-500 font-medium">
                        * Passwords are not stored in history for security
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-6 py-2 rounded-lg text-sm font-semibold hover:bg-neutral-700 transition-colors text-neutral-400 border border-transparent hover:border-neutral-600"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSaveHistoryOnly}
                            className="px-6 py-2 rounded-lg text-sm font-semibold bg-neutral-700 hover:bg-neutral-600 transition-colors text-neutral-200 flex items-center gap-2"
                            title="Save connection without connecting"
                        >
                            <Save size={16} /> Save
                        </button>
                        <button
                            disabled={loading}
                            onClick={handleConnect}
                            className="bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-500 px-10 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 text-white shadow-xl shadow-blue-900/20 active:scale-95"
                        >
                            {loading ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Connecting...
                                </>
                            ) : mode === 'import' ? "Connect & Import" : "Connect"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DbConnectionModal;
