import React, { useState, useMemo } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { CsvConfig, TableMetadata } from '../types/er';
import { useErData } from '../hooks/useErData';
import { X, FileSpreadsheet, AlertCircle } from 'lucide-react';

const FIELD_TYPES: Record<string, 'string' | 'number' | 'bool'> = {
    comment: 'string',
    default_value: 'string',
    charset: 'string',
    collation: 'string',
    on_update: 'string',
    sequence_name: 'string',
    virtual_expression: 'string',
    check_constraint: 'string',
    length: 'number',
    precision: 'number',
    scale: 'number',
    is_autoincrement: 'bool',
    is_unique: 'bool',
    is_unsigned: 'bool',
    is_zerofill: 'bool',
    is_binary: 'bool',
    is_virtual: 'bool',
    is_nullable: 'bool',
};

const SETTING_TO_FIELD: Record<string, { field: string, label: string }> = {
    showColumnComment: { field: 'comment', label: 'Comment' },
    showDefaultValue: { field: 'default_value', label: 'Default' },
    showLength: { field: 'length', label: 'Length' },
    showPrecision: { field: 'precision', label: 'Precision' },
    showScale: { field: 'scale', label: 'Scale' },
    showAutoIncrement: { field: 'is_autoincrement', label: 'Auto Inc' },
    showUnique: { field: 'is_unique', label: 'Unique' },
    showCheckConstraint: { field: 'check_constraint', label: 'Check Const.' },
    showUnsigned: { field: 'is_unsigned', label: 'Unsigned' },
    showZerofill: { field: 'is_zerofill', label: 'Zerofill' },
    showBinary: { field: 'is_binary', label: 'Binary' },
    showCharset: { field: 'charset', label: 'Charset' },
    showCollation: { field: 'collation', label: 'Collation' },
    showOnUpdate: { field: 'on_update', label: 'On Update' },
    showSequence: { field: 'sequence_name', label: 'Sequence' },
    showVirtual: { field: 'is_virtual', label: 'Virtual' },
    showVirtualExpr: { field: 'virtual_expression', label: 'Virtual Expr' },
};

interface ImportModalProps {
    onClose: () => void;
    onImport: (tables: TableMetadata[]) => void;
}

const ImportModal: React.FC<ImportModalProps> = ({ onClose, onImport }) => {
    const { data } = useErData();
    const settings = data.settings || {} as any;

    const [filePath, setFilePath] = useState<string | null>(null);
    const [config, setConfig] = useState<CsvConfig>({
        table_col: 0,
        column_col: 1,
        type_col: 2,
        has_header: true,
    });

    // Initialize mapped fields based on settings
    const initialFields = useMemo(() => {
        const fields = [
            { id: 'table', label: 'Table Name (Required)', type: 'required' },
            { id: 'column', label: 'Column Name (Required)', type: 'required' },
            { id: 'type', label: 'Data Type (Required)', type: 'required' },
            { id: 'pk', label: 'PK Info (Optional)', type: 'optional' },
            { id: 'fk_table', label: 'FK Parent Table (Optional)', type: 'optional' },
            { id: 'fk_column', label: 'FK Parent Column (Optional)', type: 'optional' }
        ];

        Object.entries(SETTING_TO_FIELD).forEach(([settingKey, { field, label }]) => {
            if (settings[settingKey]) {
                fields.push({ id: field, label: `${label} (Optional)`, type: 'custom' });
            }
        });

        return fields;
    }, [settings]);

    const [mappedFields, setMappedFields] = useState<Array<{ id: string, label: string, type: string }>>(initialFields);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSelectFile = async () => {
        const selected = await open({
            multiple: false,
            filters: [{ name: 'CSV', extensions: ['csv'] }]
        });
        if (selected && typeof selected === 'string') {
            setFilePath(selected);
        }
    };

    const handleImport = async () => {
        if (!filePath) return;
        setLoading(true);
        setError(null);

        // Compute config dynamically from mappedFields
        let table_col = 0, column_col = 1, type_col = 2;
        let pk_col = undefined, fk_table_col = undefined, fk_column_col = undefined;
        const custom_string_cols: Record<string, number> = {};
        const custom_bool_cols: Record<string, number> = {};
        const custom_num_cols: Record<string, number> = {};

        mappedFields.forEach((field, index) => {
            if (field.id === 'table') table_col = index;
            else if (field.id === 'column') column_col = index;
            else if (field.id === 'type') type_col = index;
            else if (field.id === 'pk') pk_col = index;
            else if (field.id === 'fk_table') fk_table_col = index;
            else if (field.id === 'fk_column') fk_column_col = index;
            else if (field.id.startsWith('ignore')) { /* ignore */ }
            else {
                // custom field
                const fieldType = FIELD_TYPES[field.id];
                if (fieldType === 'string') custom_string_cols[field.id] = index;
                else if (fieldType === 'bool') custom_bool_cols[field.id] = index;
                else if (fieldType === 'number') custom_num_cols[field.id] = index;
            }
        });

        const finalConfig: CsvConfig = {
            has_header: config.has_header,
            table_col,
            column_col,
            type_col,
            pk_col,
            fk_table_col,
            fk_column_col,
            custom_string_cols,
            custom_bool_cols,
            custom_num_cols
        };

        try {
            const tables = await invoke<TableMetadata[]>('import_csv_metadata', {
                path: filePath,
                config: finalConfig
            });
            onImport(tables);
            onClose();
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedIndex(index);
        e.dataTransfer.setData('text/plain', index.toString());
        e.dataTransfer.effectAllowed = 'move';
        // Optional: Make the drag image transparent or custom if desired
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        if (draggedIndex === null || draggedIndex === index) return;

        // Reorder dynamically while dragging
        setMappedFields(prev => {
            const newFields = [...prev];
            const [draggedItem] = newFields.splice(draggedIndex, 1);
            newFields.splice(index, 0, draggedItem);
            return newFields;
        });
        setDraggedIndex(index);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDraggedIndex(null);
    };

    const handleDragEnd = () => {
        setDraggedIndex(null);
    };

    const addIgnoreCol = () => {
        setMappedFields(prev => [...prev, { id: `ignore_${Date.now()}`, label: 'IGNORE COLUMN', type: 'ignore' }]);
    };

    const removeField = (indexToRemove: number) => {
        setMappedFields(prev => prev.filter((_, idx) => idx !== indexToRemove));
    };

    const addAvailableField = (field: { id: string, label: string, type: string }) => {
        setMappedFields(prev => [...prev, field]);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 text-neutral-100">
            <div className="bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-neutral-700 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <FileSpreadsheet className="text-green-500" size={24} />
                        <h2 className="text-xl font-bold">Import CSV Metadata</h2>
                    </div>
                    <button onClick={onClose} className="text-neutral-400 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh]">
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-neutral-400">CSV File</label>
                        <div className="flex gap-2">
                            <div className="flex-1 bg-neutral-900 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-300 truncate">
                                {filePath || "No file selected..."}
                            </div>
                            <button
                                onClick={handleSelectFile}
                                className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-md text-sm font-semibold transition-colors shrink-0"
                            >
                                Browse
                            </button>
                        </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-neutral-700">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-neutral-300 uppercase tracking-tighter">Column Mapping (Drag to Reorder)</h3>
                            <button onClick={addIgnoreCol} className="text-xs bg-neutral-700 hover:bg-neutral-600 px-3 py-1 rounded text-white transition-all">+ Ignore Col</button>
                        </div>

                        <p className="text-xs text-neutral-500">The order of these items from top to bottom corresponds to CSV Columns 1, 2, 3...</p>

                        <div className="space-y-2 bg-neutral-900/50 p-2 rounded-xl border border-neutral-800">
                            {mappedFields.map((field, index) => (
                                <div
                                    key={`${field.id}-${index}`}
                                    draggable={true}
                                    onDragStart={(e) => handleDragStart(e, index)}
                                    onDragOver={(e) => handleDragOver(e, index)}
                                    onDrop={handleDrop}
                                    onDragEnd={handleDragEnd}
                                    className={`flex items-center justify-between bg-neutral-800 border p-3 rounded-lg cursor-grab active:cursor-grabbing transition-all select-none group shadow-sm ${draggedIndex === index ? 'opacity-50 border-blue-500 scale-[0.98]' : 'border-neutral-700 hover:border-blue-500/50'}`}
                                >
                                    <div className="flex items-center gap-3 pointer-events-none">
                                        <div className="text-[10px] font-black text-neutral-600 bg-neutral-900 px-2 py-1 rounded-md w-12 text-center border border-neutral-800 uppercase">
                                            Col {index + 1}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className={`text-sm font-bold ${field.type === 'ignore' ? 'text-neutral-500 italic' : (field.type === 'required' ? 'text-blue-400' : 'text-neutral-300')}`}>
                                                {field.label}
                                            </span>
                                        </div>
                                    </div>
                                    {field.type !== 'required' && (
                                        <button
                                            onClick={() => removeField(index)}
                                            className="text-neutral-500 hover:text-red-400 p-1 rounded-md hover:bg-neutral-700 transition-colors opacity-0 group-hover:opacity-100"
                                        >
                                            <X size={16} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>

                        {initialFields.filter((f: any) => !mappedFields.find(m => m.id === f.id)).length > 0 && (
                            <div className="mt-4 p-3 border border-neutral-700/50 rounded-xl bg-neutral-800/30">
                                <span className="text-xs font-bold text-neutral-500 uppercase tracking-widest mb-2 block">Unmapped Available Fields</span>
                                <div className="flex flex-wrap gap-2">
                                    {initialFields.filter((f: any) => !mappedFields.find(m => m.id === f.id)).map((field: any) => (
                                        <button
                                            key={field.id}
                                            onClick={() => addAvailableField(field)}
                                            className="px-2 py-1 bg-neutral-800 border border-neutral-700 text-[10px] text-neutral-400 hover:text-white rounded-md transition-all uppercase tracking-wider"
                                        >
                                            + {field.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="mt-4">
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    checked={config.has_header}
                                    onChange={e => setConfig({ ...config, has_header: e.target.checked })}
                                    className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-sm text-neutral-300 group-hover:text-white transition-colors">File has header row</span>
                            </label>
                        </div>

                        {error && (
                            <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/50 rounded-md text-red-400 text-sm">
                                <AlertCircle size={18} className="shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}
                    </div>

                    <div className="px-6 py-4 bg-neutral-900/50 border-t border-neutral-700 flex justify-end gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg text-sm font-semibold hover:bg-neutral-800 transition-colors text-neutral-300"
                        >
                            Cancel
                        </button>
                        <button
                            disabled={!filePath || loading}
                            onClick={handleImport}
                            className="bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-500 px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 text-white"
                        >
                            {loading ? "Importing..." : "Start Import"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};



export default ImportModal;
