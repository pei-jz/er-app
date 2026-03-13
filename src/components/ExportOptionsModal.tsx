import { FileJson, Files, X } from 'lucide-react';

interface ExportOptionsModalProps {
    type: 'json' | 'sql_full';
    onClose: () => void;
    onConfirm: (isSplit: boolean) => void;
}

export default function ExportOptionsModal({ type, onClose, onConfirm }: ExportOptionsModalProps) {
    const title = type === 'json' ? 'Export JSON' : 'Export Full DDL';
    const desc = type === 'json'
        ? 'Choose how you want to export the JSON data.'
        : 'Choose how you want to export the SQL DDL.';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-neutral-900 border border-neutral-700/50 rounded-2xl shadow-2xl w-[480px] overflow-hidden flex flex-col">
                <div className="px-5 py-4 flex items-center justify-between border-b border-neutral-800 bg-neutral-800/20">
                    <h2 className="text-sm font-black text-neutral-200 tracking-wider flex items-center gap-2">
                        {type === 'json' ? <FileJson size={16} className="text-yellow-400" /> : <Files size={16} className="text-blue-400" />}
                        {title}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-neutral-500 hover:text-white transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="p-5 flex flex-col gap-6">
                    <p className="text-sm text-neutral-400 leading-relaxed font-bold">
                        {desc}
                    </p>

                    <div className="flex flex-col gap-3">
                        <button
                            onClick={() => onConfirm(false)}
                            className="bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 p-4 rounded-xl flex items-center gap-4 text-left transition-all active:scale-[0.98]"
                        >
                            <div className="bg-neutral-900 p-3 rounded-lg border border-neutral-800">
                                <FileJson size={24} className="text-emerald-400" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-neutral-200">Single File</h3>
                                <p className="text-xs text-neutral-500 font-medium">Export everything into one large file.</p>
                            </div>
                        </button>

                        <button
                            onClick={() => onConfirm(true)}
                            className="bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 p-4 rounded-xl flex items-center gap-4 text-left transition-all active:scale-[0.98]"
                        >
                            <div className="bg-neutral-900 p-3 rounded-lg border border-neutral-800">
                                <Files size={24} className="text-blue-400" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-neutral-200">Multiple Files (Split)</h3>
                                <p className="text-xs text-neutral-500 font-medium">Export a separate file for each individual table.</p>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
