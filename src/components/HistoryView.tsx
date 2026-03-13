import React, { useState, useMemo, useEffect } from 'react';
import { ErDiagramData, SchemaSnapshot } from '../types/er';
import { History, Search, Calendar, User, ArrowRight, FileCode, Copy, Check } from 'lucide-react';
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

interface HistoryViewProps {
    data: ErDiagramData;
}

const HistoryView: React.FC<HistoryViewProps> = ({ data }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [copied, setCopied] = useState<string | null>(null);

    const groupedHistory = useMemo(() => {
        if (!data.history) return [];
        const groups = new Map<string, SchemaSnapshot[]>();

        [...data.history].reverse().forEach(s => {
            if (!groups.has(s.versionName)) {
                groups.set(s.versionName, []);
            }
            groups.get(s.versionName)!.push(s);
        });

        return Array.from(groups.values()).filter(group => {
            const first = group[0];
            const term = searchTerm.toLowerCase();
            return first.versionName.toLowerCase().includes(term) ||
                group.some(s => s.description.toLowerCase().includes(term)) ||
                first.author.toLowerCase().includes(term);
        });
    }, [data.history, searchTerm]);

    const [selectedVersionName, setSelectedVersionName] = useState<string | null>(null);

    useEffect(() => {
        if (!selectedVersionName && groupedHistory.length > 0) {
            setSelectedVersionName(groupedHistory[0][0].versionName);
        }
    }, [groupedHistory, selectedVersionName]);

    const selectedGroup = useMemo(() => {
        return groupedHistory.find(g => g[0].versionName === selectedVersionName);
    }, [groupedHistory, selectedVersionName]);

    const handleCopy = (text: string, key: string) => {
        navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    };

    const generateGroupSQL = (group: SchemaSnapshot[]) => {
        if (!group || group.length === 0) return '';
        const versionName = group[0].versionName;
        const chronological = [...group].reverse();

        let sql = `-- Version: ${versionName}\n-- Date: ${new Date(chronological[chronological.length - 1].timestamp).toLocaleString()}\n\n`;

        chronological.forEach((snapshot, i) => {
            if (chronological.length > 1) {
                sql += `-- [Update ${i + 1} - ${new Date(snapshot.timestamp).toLocaleString()}]\n`;
            }
            if (snapshot.description) {
                sql += `-- Description: ${snapshot.description}\n`;
            }
            snapshot.changes.forEach(change => {
                if (change.type === 'create_table') {
                    sql += `-- Created table ${change.targetName}\nCREATE TABLE ${change.targetName} (\n  id INT PRIMARY KEY\n);\n\n`;
                } else if (change.type === 'alter_table') {
                    sql += `-- ${change.description}\nALTER TABLE ${change.targetName} ...;\n\n`;
                }
            });
            sql += '\n';
        });
        return sql.trim() + '\n';
    };

    const handleExportDDL = async () => {
        if (!selectedGroup) return;
        try {
            const sql = generateGroupSQL(selectedGroup);
            const path = await save({
                filters: [{ name: 'SQL', extensions: ['sql'] }],
                defaultPath: `diff_${selectedGroup[0].versionName.replace(/[^a-z0-9]/gi, '_')}.sql`
            });
            if (path) {
                await invoke('save_sql_file', { path, content: sql });
                alert('Diff DDL Exported successfully!');
            }
        } catch (e) {
            console.error('Failed to export:', e);
            alert('Failed to export SQL');
        }
    };

    return (
        <div className="w-full h-full bg-[#1e1e1e] flex overflow-hidden">
            {/* Left Column: Version List */}
            <div className="w-96 border-r border-neutral-800 flex flex-col h-full bg-neutral-900/30">
                <div className="p-6 border-b border-neutral-800">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-xl bg-blue-600/10 flex items-center justify-center text-blue-400 border border-blue-500/20">
                            <History size={20} />
                        </div>
                        <h2 className="text-xl font-black text-white italic tracking-tight">History</h2>
                    </div>

                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" size={14} />
                        <input
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            placeholder="Search versions..."
                            className="w-full bg-neutral-800/50 border border-neutral-700/30 rounded-xl pl-10 pr-4 py-2 text-xs text-neutral-300 outline-none focus:ring-1 focus:ring-blue-500/50 transition-all font-medium"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                    {groupedHistory.length === 0 ? (
                        <div className="py-10 text-center text-neutral-600">
                            <p className="text-xs font-bold uppercase tracking-widest italic">No results found</p>
                        </div>
                    ) : (
                        groupedHistory.map(group => {
                            const first = group[0];
                            const allChanges = group.flatMap(s => s.changes);
                            const changedTables = Array.from(new Set(allChanges.map(c => c.targetName))).join(', ');
                            const isSelected = selectedVersionName === first.versionName;

                            return (
                                <button
                                    key={first.versionName}
                                    onClick={() => setSelectedVersionName(first.versionName)}
                                    className={`w-full text-left p-4 rounded-2xl transition-all border ${isSelected ? 'bg-blue-600/10 border-blue-500/30' : 'bg-transparent border-transparent hover:bg-neutral-800/40'}`}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <h4 className={`text-xs font-black uppercase tracking-tight truncate max-w-[180px] ${isSelected ? 'text-blue-400' : 'text-neutral-200'}`}>
                                            {first.versionName}
                                        </h4>
                                        <span className="text-[9px] font-bold text-neutral-600">
                                            {new Date(first.timestamp).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-neutral-500 truncate mb-2 font-medium">
                                        {changedTables || 'Generic settings change'}
                                    </p>
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center gap-1 text-[8px] font-bold text-neutral-600 uppercase tracking-widest">
                                            <User size={8} /> {first.author}
                                        </div>
                                        <div className="flex items-center gap-1 text-[8px] font-bold text-emerald-600 uppercase tracking-widest bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                            {group.length} updates
                                        </div>
                                        <div className="flex items-center gap-1 text-[8px] font-bold text-neutral-600 uppercase tracking-widest">
                                            <FileCode size={8} /> {allChanges.length} changes
                                        </div>
                                    </div>
                                </button>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Right Column: Version Details */}
            <div className="flex-1 flex flex-col h-full overflow-hidden bg-neutral-900/10">
                {selectedGroup ? (
                    <>
                        <div className="p-8 border-b border-neutral-800 bg-neutral-900/20">
                            <div className="flex justify-between items-start mb-6">
                                <div>
                                    <div className="flex items-center gap-3 mb-2">
                                        <h3 className="text-2xl font-black text-white italic tracking-tighter">{selectedGroup[0].versionName}</h3>
                                        <span className="px-3 py-1 rounded-full bg-blue-600/10 border border-blue-500/30 text-blue-400 text-[9px] font-black uppercase tracking-widest">
                                            {selectedGroup.length} Snapshots
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4 text-neutral-500">
                                        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest">
                                            <Calendar size={12} className="text-neutral-600" />
                                            {new Date(selectedGroup[0].timestamp).toLocaleString()}
                                        </div>
                                        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest border-l border-neutral-800 pl-4">
                                            <User size={12} className="text-neutral-600" />
                                            {selectedGroup[0].author}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleExportDDL}
                                        className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black uppercase tracking-widest transition-all shadow-xl shadow-blue-900/20 active:scale-95 flex items-center gap-2"
                                    >
                                        <FileCode size={14} />
                                        Generate Diff DDL
                                    </button>
                                </div>
                            </div>
                            {selectedGroup.map((s, idx) => (
                                s.description && (
                                    <p key={s.id} className="text-sm text-neutral-400 leading-relaxed font-medium bg-neutral-800/30 p-4 rounded-2xl border border-neutral-800/50 italic mb-2">
                                        {selectedGroup.length > 1 && <span className="font-black text-neutral-500 mr-2 text-xs uppercase tracking-widest">Update {selectedGroup.length - idx}:</span>}
                                        {s.description}
                                    </p>
                                )
                            ))}
                        </div>

                        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar grid grid-cols-2 gap-8">
                            {/* Change Log */}
                            <div className="space-y-6">
                                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500 flex items-center gap-2">
                                    <ArrowRight size={10} className="text-blue-500" />
                                    Combined Changes
                                </h4>
                                <div className="space-y-3">
                                    {selectedGroup.flatMap(s => s.changes).map((change, i) => (
                                        <div key={i} className="group p-4 bg-neutral-800/20 border border-neutral-800/50 rounded-2xl hover:border-neutral-700 transition-all">
                                            <div className="flex items-center gap-3 mb-1">
                                                <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${change.type.includes('create') ? 'bg-emerald-500/10 text-emerald-500' :
                                                        change.type.includes('drop') ? 'bg-red-500/10 text-red-500' :
                                                            'bg-blue-500/10 text-blue-400'
                                                    }`}>
                                                    {change.type.replace('_', ' ')}
                                                </span>
                                                <span className="text-xs font-black text-neutral-200">{change.targetName}</span>
                                            </div>
                                            <p className="text-xs text-neutral-500 font-medium">
                                                {change.description}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* DDL Preview */}
                            <div className="space-y-6">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500 flex items-center gap-2">
                                        <FileCode size={10} className="text-emerald-500" />
                                        Version DDL Preview
                                    </h4>
                                    <button
                                        onClick={() => handleCopy(generateGroupSQL(selectedGroup), 'sql')}
                                        className="text-[10px] font-bold text-neutral-500 hover:text-white flex items-center gap-1 transition-colors"
                                    >
                                        {copied === 'sql' ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
                                        {copied === 'sql' ? 'Copied!' : 'Copy SQL'}
                                    </button>
                                </div>
                                <div className="bg-neutral-950/50 border border-neutral-800/80 rounded-2xl p-6 h-[400px] overflow-auto custom-scrollbar font-mono text-[11px] leading-relaxed text-emerald-500/80">
                                    <pre className="whitespace-pre-wrap">{generateGroupSQL(selectedGroup)}</pre>
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-20 text-center opacity-40">
                        <History size={64} className="text-neutral-700 mb-6" />
                        <h3 className="text-xl font-black text-neutral-500 italic uppercase tracking-widest">Select a version</h3>
                        <p className="text-sm text-neutral-600 max-w-sm mt-2 font-medium">
                            Choose a version from the left panel to see detailed changes and generate DDL.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default HistoryView;
