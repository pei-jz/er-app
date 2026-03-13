import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DbConfig, TableMetadata } from '../types/er';
import { X, Database, AlertCircle, Clock } from 'lucide-react';

interface DbConnectionModalProps {
    onClose: () => void;
    onImport?: (tables: TableMetadata[], config: DbConfig) => void;
    onConnect?: (config: DbConfig) => void;
    mode?: 'import' | 'connect';
}

const DbConnectionModal: React.FC<DbConnectionModalProps> = ({ onClose, onImport, onConnect, mode = 'import' }) => {
    const [config, setConfig] = useState<DbConfig>({
        db_type: 'mysql',
        host: 'localhost',
        port: 3306,
        user: 'root',
        pass: '',
        db_name: '',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [history, setHistory] = useState<Omit<DbConfig, 'pass'>[]>([]);

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

    const saveHistory = (c: DbConfig) => {
        try {
            const newEntry = { ...c, pass: '' };
            // Filter out exact same connection (ignoring pass and name) to avoid duplicates, 
            // but if name is different, maybe we want to keep it? 
            // For now, let's say host+port+user+db_name is the unique key.
            const filtered = history.filter(h => !(h.host === c.host && h.port === c.port && h.db_name === c.db_name && h.user === c.user));
            const updated = [newEntry, ...filtered].slice(0, 10);
            setHistory(updated);
            localStorage.setItem('db_connections_history', JSON.stringify(updated));
        } catch (e) {
            console.error("Failed to save history", e);
        }
    };

    const handleConnect = async () => {
        setLoading(true);
        setError(null);
        try {
            if (mode === 'import') {
                const tables = await invoke<TableMetadata[]>('fetch_db_metadata', { config });
                saveHistory(config);
                onImport?.(tables, config);
            } else {
                saveHistory(config);
                onConnect?.(config);
            }
            onClose();
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 text-neutral-100">
            <div className="bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-neutral-700 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Database className="text-blue-500" size={24} />
                        <h2 className="text-xl font-bold">{mode === 'import' ? 'Import from DB' : 'Database Connection'}</h2>
                    </div>
                    <button onClick={onClose} className="text-neutral-400 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    <div className="space-y-1">
                        <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Connection Name (Alias)</label>
                        <input
                            type="text"
                            value={config.name || ''}
                            onChange={e => setConfig({ ...config, name: e.target.value })}
                            placeholder="e.g. My Production DB"
                            className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-neutral-600"
                        />
                    </div>

                    <div className="space-y-1">
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
                            className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                        >
                            <option value="mysql">MySQL</option>
                            <option value="postgres">PostgreSQL</option>
                            <option value="oracle">Oracle</option>
                        </select>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2 space-y-1">
                            <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Host</label>
                            <input
                                type="text"
                                value={config.host}
                                onChange={e => setConfig({ ...config, host: e.target.value })}
                                className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Port</label>
                            <input
                                type="number"
                                value={config.port}
                                onChange={e => setConfig({ ...config, port: parseInt(e.target.value) || 0 })}
                                className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">User</label>
                            <input
                                type="text"
                                value={config.user}
                                onChange={e => setConfig({ ...config, user: e.target.value })}
                                className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Password</label>
                            <input
                                type="password"
                                value={config.pass}
                                onChange={e => setConfig({ ...config, pass: e.target.value })}
                                className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Database Name</label>
                        <input
                            type="text"
                            value={config.db_name}
                            onChange={e => setConfig({ ...config, db_name: e.target.value })}
                            placeholder="e.g. production_db"
                            className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                        />
                    </div>

                    {error && (
                        <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-xs">
                            <AlertCircle size={14} className="shrink-0 mt-0.5" />
                            <span>{error}</span>
                        </div>
                    )}

                    {history.length > 0 && (
                        <div className="pt-4 border-t border-neutral-700/50">
                            <h3 className="text-[10px] font-black uppercase text-neutral-500 mb-3 flex items-center gap-1">
                                <Clock size={12} /> Recent Connections
                            </h3>
                            <div className="max-h-32 overflow-y-auto custom-scrollbar pr-1">
                                <table className="w-full text-left border-collapse">
                                    <thead className="sticky top-0 bg-neutral-800 z-10">
                                        <tr className="text-[9px] uppercase tracking-widest text-neutral-600 border-b border-neutral-700">
                                            <th className="py-1 font-black">Name/Host</th>
                                            <th className="py-1 font-black">User</th>
                                            <th className="py-1 font-black">DB</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-neutral-700/30">
                                        {history.map((h, i) => (
                                            <tr
                                                key={i}
                                                onClick={() => setConfig({ ...h, pass: '' })}
                                                className="group hover:bg-neutral-700/50 cursor-pointer transition-colors"
                                            >
                                                <td className="py-2 pr-2">
                                                    <div className="flex flex-col">
                                                        <span className="text-xs font-bold text-neutral-300 group-hover:text-blue-400 truncate max-w-[120px]">
                                                            {h.name || h.host}
                                                        </span>
                                                        <span className="text-[9px] text-neutral-500">{h.host}:{h.port}</span>
                                                    </div>
                                                </td>
                                                <td className="py-2 pr-2 text-[10px] text-neutral-400 align-middle truncate max-w-[60px]">
                                                    {h.user}
                                                </td>
                                                <td className="py-2 text-[10px] text-neutral-400 align-middle truncate max-w-[80px]">
                                                    {h.db_name || '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 bg-neutral-900/50 border-t border-neutral-700 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-sm font-semibold hover:bg-neutral-800 transition-colors text-neutral-400"
                    >
                        Cancel
                    </button>
                    <button
                        disabled={loading}
                        onClick={handleConnect}
                        className="bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-500 px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 text-white shadow-lg shadow-blue-900/20"
                    >
                        {loading ? "Connecting..." : mode === 'import' ? "Connect & Import" : "Connect"}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DbConnectionModal;
