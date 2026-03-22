import React, { useState } from 'react';
import { useErDiagram } from '../hooks/useErData';
import { DEFAULT_DATA_TYPES_CONFIG, DataTypeConfig } from '../types/er';
import { X, Settings, CheckCircle2, Circle, Database, Smartphone, Globe, Trash2, Plus } from 'lucide-react';

interface SettingsModalProps {
    onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
    const { data, updateSettings } = useErDiagram();
    const settings = data.settings || {} as any;
    const [activeTab, setActiveTab] = useState<'display' | 'types'>('display');

    const toggle = (key: string) => {
        updateSettings({ [key]: !settings[key] });
    };

    const sections = [
        {
            title: 'Table Metadata',
            icon: <Database size={14} />,
            items: [
                { id: 'showTableComment', label: 'Table Comment', description: 'Show table descriptions' },
                { id: 'showEngine', label: 'Engine', description: 'MySQL Storage Engine' },
                { id: 'showPartition', label: 'Partitioning', description: 'Show partition strategies' },
                { id: 'showTablespace', label: 'Tablespace', description: 'Show tablespace name' },
            ]
        },
        {
            title: 'Column - Common',
            icon: <Globe size={14} />,
            items: [
                { id: 'showColumnComment', label: 'Comment', description: 'Individual column descriptions' },
                { id: 'showDefaultValue', label: 'Default', description: 'Default values for columns' },
                { id: 'showLength', label: 'Length', description: 'Max character length' },
                { id: 'showPrecision', label: 'Precision', description: 'Numeric precision' },
                { id: 'showScale', label: 'Scale', description: 'Numeric scale' },
                { id: 'showAutoIncrement', label: 'Auto Inc', description: 'Auto-incrementing fields' },
                { id: 'showUnique', label: 'Unique', description: 'Unique constraints' },
                { id: 'showCheckConstraint', label: 'Check', description: 'Check constraints' },
            ]
        },
        {
            title: 'Column - MySQL',
            icon: <Smartphone size={14} />,
            items: [
                { id: 'showUnsigned', label: 'Unsigned', description: 'MySQL Unsigned attribute' },
                { id: 'showZerofill', label: 'Zerofill', description: 'MySQL Zerofill attribute' },
                { id: 'showBinary', label: 'Binary', description: 'MySQL Binary attribute' },
                { id: 'showCharset', label: 'Charset', description: 'Character set' },
                { id: 'showCollation', label: 'Collation', description: 'Collation' },
                { id: 'showOnUpdate', label: 'On Update', description: 'On update trigger' },
            ]
        },
        {
            title: 'Performance & Zoom',
            icon: <Smartphone size={14} />,
            items: [
                { id: 'highPerformanceMode', label: 'High Performance Mode', description: 'Force simplified rendering for large diagrams' },
                { id: 'disableAnimations', label: 'Disable Animations', description: 'Reduce CPU usage by disabling transitions' },
            ]
        }
    ];

    const activeDataTypes = settings.availableDataTypesConfigs || DEFAULT_DATA_TYPES_CONFIG;

    const addDataType = () => {
        updateSettings({
            availableDataTypesConfigs: [...activeDataTypes, { name: 'new_type', mysql: true, postgres: true, oracle: true }]
        });
    };

    const removeDataType = (idx: number) => {
        const next = [...activeDataTypes];
        next.splice(idx, 1);
        updateSettings({ availableDataTypesConfigs: next });
    };

    const updateDataType = (idx: number, updates: Partial<DataTypeConfig>) => {
        const next = [...activeDataTypes];
        next[idx] = { ...next[idx], ...updates };
        updateSettings({ availableDataTypesConfigs: next });
    };

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
            <div className="bg-neutral-900 border border-neutral-800 rounded-[2.5rem] w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden border-t-white/10">

                {/* Header */}
                <div className="px-8 py-6 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/50">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-neutral-800 flex items-center justify-center text-neutral-400 border border-neutral-700/50">
                            <Settings size={24} />
                        </div>
                        <div>
                            <h3 className="text-xl font-black text-white italic leading-tight tracking-tight">Settings</h3>
                            <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-[0.2em] mt-0.5">Customize workspace</p>
                        </div>
                    </div>

                    <div className="flex bg-neutral-800/40 p-1 rounded-2xl border border-neutral-700/30">
                        <button onClick={() => setActiveTab('display')} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'display' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-neutral-500 hover:text-white hover:bg-neutral-800/50'}`}>Display</button>
                        <button onClick={() => setActiveTab('types')} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'types' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/20' : 'text-neutral-500 hover:text-white hover:bg-neutral-800/50'}`}>Data Types</button>
                    </div>

                    <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-neutral-800 text-neutral-500 transition-all hover:text-white">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar space-y-8">
                    {activeTab === 'display' && (
                        <div className="grid grid-cols-2 gap-x-12 gap-y-8">
                            {sections.map(section => (
                                <div key={section.title} className="space-y-4">
                                    <div className="flex items-center gap-2 ml-1">
                                        <span className="text-neutral-500">{section.icon}</span>
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-500">{section.title}</h4>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2">
                                        {section.items.map(item => (
                                            <button
                                                key={item.id}
                                                onClick={() => toggle(item.id)}
                                                className="flex items-center justify-between px-4 py-3 rounded-xl bg-neutral-800/40 border border-neutral-700/30 hover:bg-neutral-800 transition-all text-left group"
                                            >
                                                <div className="flex-1">
                                                    <p className="text-[11px] font-bold text-neutral-200 group-hover:text-white transition-colors">{item.label}</p>
                                                    <p className="text-[9px] text-neutral-500 mt-0.5">{item.description}</p>
                                                </div>
                                                <div className={`transition-all ${settings[item.id] ? 'text-blue-500' : 'text-neutral-700'}`}>
                                                    {settings[item.id] ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeTab === 'types' && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between ml-1 text-emerald-500 mb-4 border-b border-neutral-800 pb-4">
                                <div className="flex items-center gap-3">
                                    <Database size={18} />
                                    <h4 className="text-[12px] font-black uppercase tracking-widest">Type Configuration</h4>
                                </div>
                                <button onClick={addDataType} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-900/20 active:scale-95">
                                    <Plus size={14} /> Add Type
                                </button>
                            </div>

                            <div className="bg-neutral-800/20 border border-neutral-700/30 rounded-2xl p-4 mb-6">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-neutral-500 mb-3">Global Target Database</h4>
                                <p className="text-[9px] text-neutral-500 mb-3">Select the target database for your project. The column type dropdowns will be filtered to only show types compatible with the selected engine.</p>
                                <div className="flex gap-2">
                                    {(['all', 'mysql', 'postgres', 'oracle'] as const).map(db => (
                                        <button
                                            key={db}
                                            onClick={() => updateSettings({ activeDatabase: db })}
                                            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${(settings.activeDatabase || 'all') === db
                                                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/50'
                                                    : 'bg-neutral-800/40 text-neutral-500 hover:bg-neutral-800 border border-neutral-700/30'
                                                }`}
                                        >
                                            {db}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-4 pb-2 text-[9px] font-black text-neutral-500 uppercase tracking-widest">
                                <div>Type Name</div>
                                <div className="w-16 text-center">MySQL</div>
                                <div className="w-16 text-center">PostgreSQL</div>
                                <div className="w-16 text-center">Oracle</div>
                                <div className="w-10"></div>
                            </div>

                            <div className="space-y-2">
                                {activeDataTypes.map((t: DataTypeConfig, idx: number) => (
                                    <div key={idx} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 items-center bg-neutral-800/40 border border-neutral-700/30 rounded-xl p-3 hover:bg-neutral-800 transition-all">
                                        <input
                                            value={t.name}
                                            onChange={e => updateDataType(idx, { name: e.target.value })}
                                            className="bg-neutral-900/50 border border-neutral-700/50 rounded-lg px-3 py-2 text-xs text-emerald-400 font-mono outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all w-full"
                                            placeholder="DataType"
                                        />

                                        <label className="w-16 flex justify-center cursor-pointer">
                                            <input type="checkbox" checked={!!t.mysql} onChange={e => updateDataType(idx, { mysql: e.target.checked })} className="accent-emerald-500 w-4 h-4 cursor-pointer" />
                                        </label>
                                        <label className="w-16 flex justify-center cursor-pointer">
                                            <input type="checkbox" checked={!!t.postgres} onChange={e => updateDataType(idx, { postgres: e.target.checked })} className="accent-emerald-500 w-4 h-4 cursor-pointer" />
                                        </label>
                                        <label className="w-16 flex justify-center cursor-pointer">
                                            <input type="checkbox" checked={!!t.oracle} onChange={e => updateDataType(idx, { oracle: e.target.checked })} className="accent-emerald-500 w-4 h-4 cursor-pointer" />
                                        </label>

                                        <button onClick={() => removeDataType(idx)} className="w-10 flex justify-center text-neutral-600 hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-neutral-800">
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-8 border-t border-neutral-800 bg-neutral-900/50 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-8 py-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
                    >
                        Close & Apply
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
