import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Link2, ArrowRight, Plus, Trash2, Search, ChevronDown } from 'lucide-react';
import { TableMetadata } from '../types/er';

interface ForeignKeyModalProps {
    isOpen: boolean;
    onClose: () => void;
    tables: TableMetadata[];
    onAddForeignKey: (sourceTable: string, targetTable: string, pairs: { source: string, target: string }[]) => void;
    initialSourceTable?: string;
}

interface CustomSelectProps {
    value: string;
    onSelect: (val: string) => void;
    options: string[];
    label: string;
    placeholder: string;
    searchable?: boolean;
    colorTheme?: 'emerald' | 'blue';
}

const CustomSelect: React.FC<CustomSelectProps> = ({ 
    value, 
    onSelect, 
    options, 
    label, 
    placeholder, 
    searchable = true,
    colorTheme = 'emerald'
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const filteredOptions = useMemo(() => {
        if (!searchable) return options;
        return options.filter(opt => opt.toLowerCase().includes(search.toLowerCase()));
    }, [options, search, searchable]);

    // Reset active index when list changes
    useEffect(() => {
        setActiveIndex(0);
    }, [filteredOptions]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isOpen) {
            if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                setIsOpen(true);
            }
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setActiveIndex(prev => (prev + 1) % filteredOptions.length);
                break;
            case 'ArrowUp':
                e.preventDefault();
                setActiveIndex(prev => (prev - 1 + filteredOptions.length) % filteredOptions.length);
                break;
            case 'Enter':
                e.preventDefault();
                if (filteredOptions[activeIndex]) {
                    onSelect(filteredOptions[activeIndex]);
                    setIsOpen(false);
                }
                break;
            case 'Escape':
                e.preventDefault();
                setIsOpen(false);
                break;
            case 'Tab':
                setIsOpen(false);
                break;
        }
    };

    // Scroll active item into view
    useEffect(() => {
        if (isOpen && listRef.current) {
            const activeItem = listRef.current.children[activeIndex] as HTMLElement;
            if (activeItem) {
                const listHeight = listRef.current.offsetHeight;
                const itemTop = activeItem.offsetTop;
                const itemHeight = activeItem.offsetHeight;
                const scrollTop = listRef.current.scrollTop;

                if (itemTop < scrollTop) {
                    listRef.current.scrollTop = itemTop;
                } else if (itemTop + itemHeight > scrollTop + listHeight) {
                    listRef.current.scrollTop = itemTop + itemHeight - listHeight;
                }
            }
        }
    }, [activeIndex, isOpen]);

    const themeClass = colorTheme === 'emerald' ? 'bg-emerald-600' : 'bg-blue-600';
    const borderFocusClass = colorTheme === 'emerald' ? 'focus-within:ring-emerald-500/50' : 'focus-within:ring-blue-500/50';

    return (
        <div className="space-y-2 relative" ref={containerRef} onKeyDown={handleKeyDown}>
            <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest pl-1">{label}</label>
            <div 
                className={`w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 text-sm text-neutral-200 flex items-center justify-between cursor-pointer hover:border-neutral-600 transition-all ${isOpen ? `ring-2 ${borderFocusClass}` : ''}`}
                onClick={() => setIsOpen(!isOpen)}
                tabIndex={0}
            >
                <span className={value ? "text-neutral-100 font-bold" : "text-neutral-500 font-bold"}>
                    {value || placeholder}
                </span>
                <ChevronDown size={16} className={`text-neutral-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>

            {isOpen && (
                <div className="absolute top-full left-0 right-0 mt-2 z-[110] bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                    {searchable && (
                        <div className="p-2 border-b border-neutral-800 flex items-center gap-2 bg-neutral-900/50">
                            <Search size={14} className="text-neutral-500 ml-2" />
                            <input
                                autoFocus
                                className="bg-transparent border-none outline-none text-sm text-neutral-200 py-2 w-full font-bold placeholder:text-neutral-600"
                                placeholder={`Filter ${label.toLowerCase()}...`}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                            />
                        </div>
                    )}
                    <div 
                        className="max-h-60 overflow-y-auto p-1 custom-scrollbar"
                        ref={listRef}
                    >
                        {filteredOptions.map((opt, idx) => (
                            <div 
                                key={opt}
                                className={`px-4 py-2.5 rounded-xl text-sm font-bold cursor-pointer transition-colors ${
                                    value === opt ? themeClass + ' text-white' : 
                                    activeIndex === idx ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                                }`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onSelect(opt);
                                    setIsOpen(false);
                                }}
                                onMouseEnter={() => setActiveIndex(idx)}
                            >
                                {opt}
                            </div>
                        ))}
                        {filteredOptions.length === 0 && (
                            <div className="px-4 py-8 text-center text-xs text-neutral-600 font-black uppercase tracking-widest">
                                No options found
                            </div>
                        )}
                    </div>
                </div>
            )}
            
            {/* Backdrop to close dropdown */}
            {isOpen && <div className="fixed inset-0 z-[105]" onClick={() => setIsOpen(false)} />}
        </div>
    );
};

const ForeignKeyModal: React.FC<ForeignKeyModalProps> = ({ isOpen, onClose, tables, onAddForeignKey, initialSourceTable }) => {
    const [sourceTable, setSourceTable] = useState('');
    const [targetTable, setTargetTable] = useState('');
    const [pairs, setPairs] = useState<{ source: string, target: string }[]>([{ source: '', target: '' }]);

    useEffect(() => {
        if (initialSourceTable) {
            setSourceTable(initialSourceTable);
            const sourceObj = tables.find(t => t.name === initialSourceTable);
            if (sourceObj && sourceObj.columns.length > 0) {
                setPairs([{ source: sourceObj.columns[0].name, target: '' }]);
            }
        } else if (tables.length > 0 && !sourceTable) {
            setSourceTable(tables[0].name);
            setPairs([{ source: tables[0].columns[0]?.name || '', target: '' }]);
        }
    }, [initialSourceTable, tables]);

    if (!isOpen) return null;

    const sourceObject = tables.find(t => t.name === sourceTable);
    const targetObject = tables.find(t => t.name === targetTable);

    const handleSave = () => {
        const validPairs = pairs.filter(p => p.source && p.target);
        if (sourceTable && targetTable && validPairs.length > 0) {
            onAddForeignKey(sourceTable, targetTable, validPairs);
            onClose();
        }
    };

    const addPair = () => {
        setPairs([...pairs, { source: '', target: '' }]);
    };

    const updatePair = (index: number, field: 'source' | 'target', value: string) => {
        const newPairs = [...pairs];
        newPairs[index][field] = value;
        setPairs(newPairs);
    };

    const removePair = (index: number) => {
        if (pairs.length > 1) {
            setPairs(pairs.filter((_, i) => i !== index));
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-neutral-900 border border-neutral-800 rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-600/20 flex items-center justify-center text-emerald-400">
                            <Link2 size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-neutral-100 uppercase tracking-tight">Create Relationship</h2>
                            <p className="text-xs text-neutral-500 font-bold">ESTABLISH FOREIGN KEY CONSTRAINTS</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-neutral-800 rounded-xl text-neutral-400 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-8 space-y-6 overflow-y-auto max-h-[75vh] custom-scrollbar">
                    <div className="grid grid-cols-2 gap-8 items-start">
                        <CustomSelect 
                            label="Source Table (Child)"
                            placeholder="Select source..."
                            value={sourceTable}
                            onSelect={(name) => {
                                setSourceTable(name);
                                const cols = tables.find(t => t.name === name)?.columns || [];
                                setPairs([{ source: cols[0]?.name || '', target: '' }]);
                            }}
                            options={tables.map(t => t.name)}
                        />
                        <CustomSelect 
                            label="Target Table (Parent)"
                            placeholder="Select target..."
                            value={targetTable}
                            onSelect={(name) => {
                                setTargetTable(name);
                                const cols = tables.find(t => t.name === name)?.columns || [];
                                const pk = cols.find(c => c.is_primary_key)?.name || cols[0]?.name || '';
                                const newPairs = pairs.map(p => ({ ...p, target: p.target || pk }));
                                setPairs(newPairs);
                            }}
                            options={tables.map(t => t.name)}
                        />
                    </div>

                    <div className="space-y-4 pt-4">
                        <div className="flex items-center justify-between pl-1">
                            <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest font-bold">Column Mapping</label>
                            <button 
                                onClick={addPair}
                                className="flex items-center gap-1.5 text-[10px] font-black text-emerald-500 uppercase tracking-widest hover:text-emerald-400 transition-colors bg-emerald-500/10 px-3 py-1.5 rounded-lg border border-emerald-500/20"
                            >
                                <Plus size={14} />
                                Add Column Pair
                            </button>
                        </div>

                        <div className="space-y-3">
                            {pairs.map((pair, idx) => (
                                <div key={idx} className="flex items-center gap-4 animate-in slide-in-from-left-2 duration-200">
                                    <div className="flex-1">
                                        <CustomSelect 
                                            label=""
                                            placeholder="Select Child Column"
                                            value={pair.source}
                                            onSelect={(val) => updatePair(idx, 'source', val)}
                                            options={sourceObject?.columns.map(c => c.name) || []}
                                            searchable={false}
                                        />
                                    </div>
                                    <div className="text-neutral-700 mt-6">
                                        <ArrowRight size={18} />
                                    </div>
                                    <div className="flex-1">
                                        <CustomSelect 
                                            label=""
                                            placeholder="Select Parent Column"
                                            value={pair.target}
                                            onSelect={(val) => updatePair(idx, 'target', val)}
                                            options={targetObject?.columns.map(c => c.name) || []}
                                            searchable={false}
                                            colorTheme="blue"
                                        />
                                    </div>
                                    <button 
                                        onClick={() => removePair(idx)}
                                        disabled={pairs.length === 1}
                                        className="mt-6 p-2.5 text-neutral-500 hover:text-red-400 disabled:opacity-0 transition-colors rounded-xl hover:bg-neutral-800 border border-neutral-700/50"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-5 flex gap-5 items-start mt-4">
                        <div className="mt-1 w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                            <Link2 size={16} />
                        </div>
                        <div className="text-xs text-neutral-400 leading-relaxed font-bold">
                            Table <span className="text-emerald-400 uppercase tracking-tight">{sourceTable || '...'}</span> references <span className="text-blue-400 uppercase tracking-tight">{targetTable || '...'}</span> 
                            {pairs.filter(p => p.source && p.target).length > 0 ? (
                                <ul className="mt-3 space-y-2 text-[10px] text-neutral-500">
                                    {pairs.map((p, i) => p.source && p.target ? (
                                        <li key={i} className="flex items-center gap-3">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/50" />
                                            <span className="text-neutral-300">{p.source}</span> 
                                            <ArrowRight size={10} className="text-neutral-600" /> 
                                            <span className="text-neutral-300">{p.target}</span>
                                        </li>
                                    ) : null)}
                                </ul>
                            ) : null}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-8 py-6 bg-neutral-900/50 border-t border-neutral-800 flex items-center justify-end gap-4">
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest text-neutral-400 hover:text-white transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!sourceTable || !targetTable || pairs.filter(p => p.source && p.target).length === 0}
                        className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-20 text-white px-10 py-3 rounded-2xl text-sm font-black uppercase tracking-widest shadow-lg shadow-emerald-900/40 transition-all active:scale-95 flex items-center gap-2"
                    >
                        Create Relationship
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ForeignKeyModal;
