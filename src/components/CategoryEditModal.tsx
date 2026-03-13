import React, { useState, useMemo } from 'react';
import { X, Search, ChevronRight, ChevronLeft, FolderPlus, Info } from 'lucide-react';
import { CategoryMetadata, TableMetadata } from '../types/er';

interface CategoryEditModalProps {
    category?: CategoryMetadata;
    allCategories: CategoryMetadata[];
    allTables: TableMetadata[];
    onClose: () => void;
    onSave: (name: string, parentId: string | null, tableNames: string[], relatedCategoryIds: string[]) => void;
}

const CategoryEditModal: React.FC<CategoryEditModalProps> = ({
    category, allCategories, allTables, onClose, onSave
}) => {
    const [name, setName] = useState(category?.name || 'New Category');
    const [parentId, setParentId] = useState<string | null>(category?.parent_id || null);
    const [selectedTables, setSelectedTables] = useState<string[]>(
        allTables.filter(t => category ? (t.category_ids || []).includes(category.id) : false).map(t => t.name)
    );
    const [leftSearch, setLeftSearch] = useState('');
    const [rightSearch, setRightSearch] = useState('');
    const [relatedCategoryIds, setRelatedCategoryIds] = useState<string[]>(category?.related_category_ids || []);

    // Tables available for assignment:
    // 1. If no parent, show all tables
    // 2. If parent, show only tables belonging to parent
    const availablePool = useMemo(() => {
        if (!parentId) return allTables;
        return allTables.filter(t => (t.category_ids || []).includes(parentId));
    }, [allTables, parentId]);

    const leftList = useMemo(() => {
        return availablePool
            .filter(t => !selectedTables.includes(t.name))
            .filter(t => t.name.toLowerCase().includes(leftSearch.toLowerCase()));
    }, [availablePool, selectedTables, leftSearch]);

    const rightList = useMemo(() => {
        return allTables
            .filter(t => selectedTables.includes(t.name))
            .filter(t => t.name.toLowerCase().includes(rightSearch.toLowerCase()));
    }, [allTables, selectedTables, rightSearch]);
    const toggleTable = (tableName: string) => {
        if (selectedTables.includes(tableName)) {
            setSelectedTables(prev => prev.filter(n => n !== tableName));
        } else {
            setSelectedTables(prev => [...prev, tableName]);
        }
    };

    const toggleRelatedCategory = (catId: string) => {
        if (relatedCategoryIds.includes(catId)) {
            setRelatedCategoryIds(prev => prev.filter(id => id !== catId));
        } else {
            setRelatedCategoryIds(prev => [...prev, catId]);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 text-neutral-100">
            <div className="bg-neutral-800 border border-neutral-700 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 border-b border-neutral-700 flex items-center justify-between bg-neutral-900/50">
                    <div className="flex items-center gap-3">
                        <FolderPlus className="text-yellow-500" size={24} />
                        <h2 className="text-xl font-black italic">{category ? 'Edit Category' : 'Create Category'}</h2>
                    </div>
                    <button onClick={onClose} className="text-neutral-500 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 flex-1 overflow-y-auto space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                        {/* Name & Parent */}
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Category Name</label>
                            <input
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-yellow-500 outline-none transition-all"
                                placeholder="e.g. User Management"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Parent Category (Map Hierarchy)</label>
                            <select
                                value={parentId || ''}
                                onChange={e => setParentId(e.target.value || null)}
                                className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-yellow-500 outline-none transition-all"
                            >
                                <option value="">None (Top Level)</option>
                                {allCategories.filter(c => c.id !== category?.id && c.id !== 'all' && c.id !== 'other').map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Related Categories */}
                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest flex items-center gap-2">
                            Related Categories (Visual Connections)
                        </label>
                        <div className="bg-neutral-900/50 border border-neutral-700 rounded-xl p-3 max-h-32 overflow-y-auto custom-scrollbar flex flex-wrap gap-2">
                            {allCategories.filter(c => c.id !== category?.id && c.id !== 'all' && c.id !== 'other').length === 0 && (
                                <span className="text-xs text-neutral-500 italic">No other categories available.</span>
                            )}
                            {allCategories.filter(c => c.id !== category?.id && c.id !== 'all' && c.id !== 'other').map(c => (
                                <label key={c.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-all ${relatedCategoryIds.includes(c.id)
                                    ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                                    : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:bg-neutral-700'
                                    }`}>
                                    <input
                                        type="checkbox"
                                        checked={relatedCategoryIds.includes(c.id)}
                                        onChange={() => toggleRelatedCategory(c.id)}
                                        className="hidden"
                                    />
                                    <div className={`w-3 h-3 rounded-sm flex items-center justify-center border ${relatedCategoryIds.includes(c.id) ? 'bg-blue-500 border-blue-500' : 'border-neutral-500'
                                        }`}>
                                        {relatedCategoryIds.includes(c.id) && <X size={8} className="text-white rotate-45" />}
                                    </div>
                                    <span className="font-bold">{c.name}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                        <Info size={16} className="text-blue-400 shrink-0" />
                        <p className="text-[11px] text-blue-300 font-medium">
                            {parentId
                                ? `Only tables from parent "${allCategories.find(c => c.id === parentId)?.name}" are available.`
                                : "All tables in the project are available for top-level categories."}
                        </p>
                    </div>

                    {/* Table Picker */}
                    <div className="grid grid-cols-[1fr_60px_1fr] gap-4 h-[400px]">
                        {/* Left: Available */}
                        <div className="flex flex-col border border-neutral-700 rounded-2xl bg-neutral-900/30 overflow-hidden">
                            <div className="p-3 border-b border-neutral-700 bg-neutral-900/50 flex flex-col gap-2">
                                <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Available Tables ({leftList.length})</span>
                                <div className="relative">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                                    <input
                                        type="text"
                                        value={leftSearch}
                                        onChange={e => setLeftSearch(e.target.value)}
                                        placeholder="Search tables..."
                                        className="w-full bg-neutral-800 border-none rounded-lg pl-9 pr-3 py-1.5 text-xs focus:ring-1 focus:ring-yellow-500 outline-none transition-all"
                                    />
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                                {leftList.map(t => (
                                    <button
                                        key={t.name}
                                        onClick={() => toggleTable(t.name)}
                                        className="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-neutral-700 transition-colors flex items-center justify-between group"
                                    >
                                        <span className="truncate">{t.name}</span>
                                        <ChevronRight size={14} className="text-neutral-600 group-hover:text-yellow-500 translate-x-1 opacity-0 group-hover:opacity-100 transition-all" />
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Middle: Divider/Arrows (Visual only) */}
                        <div className="flex flex-col items-center justify-center gap-4 text-neutral-600">
                            <div className="p-2 rounded-full border border-neutral-700 bg-neutral-800/50">
                                <ChevronRight size={20} />
                            </div>
                            <div className="p-2 rounded-full border border-neutral-700 bg-neutral-800/50">
                                <ChevronLeft size={20} />
                            </div>
                        </div>

                        {/* Right: Selected */}
                        <div className="flex flex-col border border-neutral-700 rounded-2xl bg-neutral-900/30 overflow-hidden">
                            <div className="p-3 border-b border-neutral-700 bg-neutral-900/50 flex flex-col gap-2">
                                <span className="text-[10px] font-black text-yellow-500 uppercase tracking-widest">Selected Tables ({rightList.length})</span>
                                <div className="relative">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                                    <input
                                        type="text"
                                        value={rightSearch}
                                        onChange={e => setRightSearch(e.target.value)}
                                        placeholder="Search selected..."
                                        className="w-full bg-neutral-800 border-none rounded-lg pl-9 pr-3 py-1.5 text-xs focus:ring-1 focus:ring-yellow-500 outline-none transition-all"
                                    />
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                                {rightList.map(t => (
                                    <button
                                        key={t.name}
                                        onClick={() => toggleTable(t.name)}
                                        className="w-full text-left px-3 py-2 text-xs rounded-lg bg-yellow-500/5 border border-yellow-500/20 hover:bg-yellow-500/10 transition-colors flex items-center justify-between group mb-1"
                                    >
                                        <span className="truncate text-yellow-500 font-bold">{t.name}</span>
                                        <X size={14} className="text-neutral-500 group-hover:text-red-500 opacity-50 group-hover:opacity-100 transition-all" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-neutral-900/50 border-t border-neutral-700 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-5 py-2 rounded-xl text-sm font-semibold hover:bg-neutral-800 transition-colors text-neutral-400"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onSave(name, parentId, selectedTables, relatedCategoryIds)}
                        className="bg-yellow-500 hover:bg-yellow-400 px-8 py-2 rounded-xl text-sm font-black transition-all active:scale-95 text-neutral-900 shadow-lg shadow-yellow-900/20"
                    >
                        Save Category
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CategoryEditModal;
