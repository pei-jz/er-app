import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Database, Table, Zap, ArrowRight, History, Layers, Terminal, GitCommit } from 'lucide-react';

export interface DbObject {
    name: string;
    object_type: string;
}

interface LiveDbSearchProps {
    catalog: DbObject[];
    onSelect: (obj: DbObject) => void;
    recentObjects: DbObject[];
}

const LiveDbSearch: React.FC<LiveDbSearchProps> = ({ catalog, onSelect, recentObjects }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isFocused, setIsFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const suggestions = useMemo(() => {
        if (!searchTerm) return [];
        const lowerSearch = searchTerm.toLowerCase();
        return catalog
            .filter(obj => obj.name.toLowerCase().includes(lowerSearch))
            .slice(0, 10);
    }, [catalog, searchTerm]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [searchTerm]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev + 1) % Math.max(suggestions.length, 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
        } else if (e.key === 'Enter') {
            if (suggestions[selectedIndex]) {
                onSelect(suggestions[selectedIndex]);
                setSearchTerm('');
            }
        } else if (e.key === 'Escape') {
            setIsFocused(false);
            inputRef.current?.blur();
        }
    };

    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if (e.key === '/' && (e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
                e.preventDefault();
                inputRef.current?.focus();
            }
        };
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, []);

    const getObjectIcon = (type: string) => {
        switch (type.toUpperCase()) {
            case 'TABLE': return <Table size={14} className="text-blue-400" />;
            case 'VIEW': return <Layers size={14} className="text-indigo-400" />;
            case 'SYNONYM': return <GitCommit size={14} className="text-emerald-400" />;
            case 'PROCEDURE':
            case 'FUNCTION': return <Terminal size={14} className="text-pink-400" />;
            case 'PACKAGE': return <Zap size={14} className="text-orange-400" />;
            default: return <Database size={14} className="text-neutral-400" />;
        }
    };

    const getObjectBadge = (type: string) => {
        const colors: Record<string, string> = {
            'TABLE': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
            'VIEW': 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
            'SYNONYM': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
            'PROCEDURE': 'bg-pink-500/10 text-pink-400 border-pink-500/20',
            'FUNCTION': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
            'PACKAGE': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
        };
        const colorClass = colors[type.toUpperCase()] || 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20';
        return <span className={`text-[9px] font-black tracking-tighter px-1.5 py-0.5 rounded border ${colorClass}`}>{type.slice(0, 3).toUpperCase()}</span>;
    };

    return (
        <div className="max-w-3xl mx-auto w-full space-y-8">
            <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl blur opacity-25 group-focus-within:opacity-50 transition duration-1000"></div>
                <div className="relative bg-neutral-900 border border-neutral-700/50 rounded-2xl shadow-2xl overflow-hidden">
                    <div className="flex items-center px-4 py-3 gap-3">
                        <Search className={`transition-colors ${isFocused ? 'text-blue-400' : 'text-neutral-500'}`} size={20} />
                        <input
                            ref={inputRef}
                            type="text"
                            placeholder="Press '/' to search tables, views, procedures..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onFocus={() => setIsFocused(true)}
                            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
                            onKeyDown={handleKeyDown}
                            className="bg-transparent border-none outline-none text-lg w-full text-neutral-100 placeholder:text-neutral-600"
                        />
                        <div className="flex items-center gap-1 bg-neutral-800 px-2 py-1 rounded text-[10px] font-bold text-neutral-500 border border-neutral-700">
                            ESC
                        </div>
                    </div>

                    {isFocused && suggestions.length > 0 && (
                        <div ref={listRef} className="border-t border-neutral-800 p-2 max-h-96 overflow-y-auto">
                            {suggestions.map((obj, idx) => (
                                <button
                                    key={`${obj.name}-${obj.object_type}`}
                                    onClick={() => onSelect(obj)}
                                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all ${idx === selectedIndex ? 'bg-blue-600/20 text-blue-100' : 'hover:bg-neutral-800/50 text-neutral-400'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        {getObjectIcon(obj.object_type)}
                                        <span className={`text-sm font-bold ${idx === selectedIndex ? 'text-white' : ''}`}>{obj.name}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {getObjectBadge(obj.object_type)}
                                        <ArrowRight size={14} className={`transition-transform ${idx === selectedIndex ? 'translate-x-0' : '-translate-x-2 opacity-0'}`} />
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {!searchTerm && recentObjects.length > 0 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
                    <div className="flex items-center gap-2 px-1 text-neutral-500">
                        <History size={14} />
                        <h2 className="text-[10px] font-black uppercase tracking-widest">Recently Explored</h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                        {recentObjects.map((obj) => (
                            <button
                                key={`recent-${obj.name}`}
                                onClick={() => onSelect(obj)}
                                className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-800 rounded-xl hover:border-blue-500/50 transition-all hover:shadow-lg group text-left"
                            >
                                <div className="w-8 h-8 rounded-lg bg-neutral-800 flex items-center justify-center group-hover:bg-blue-600/10 transition-colors">
                                    {getObjectIcon(obj.object_type)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs font-bold text-neutral-300 truncate">{obj.name}</div>
                                    <div className="text-[9px] text-neutral-500 uppercase tracking-widest">{obj.object_type}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {!searchTerm && recentObjects.length === 0 && (
                <div className="py-20 text-center space-y-4 opacity-50">
                    <div className="w-16 h-16 bg-neutral-800/50 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Database size={32} className="text-neutral-700" />
                    </div>
                    <h2 className="text-lg font-bold text-neutral-400">Database Explorer</h2>
                    <p className="text-sm text-neutral-600 max-w-sm mx-auto">
                        Search for any table, view, or package in your Live Database to start exploring its structure.
                    </p>
                </div>
            )}
        </div>
    );
};

export default LiveDbSearch;
