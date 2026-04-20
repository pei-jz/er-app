import { createContext, useContext, useState, ReactNode, useCallback, useMemo } from 'react';
import { ErDiagramData, TableMetadata, CategoryMetadata, ColumnMetadata, IndexMetadata, SchemaSnapshot, MetadataSettings } from '../types/er';

export interface QueryResult {
    columns: string[];
    rows: string[][];
    has_more: boolean;
    total_count?: number;
    has_uncommitted_changes: boolean;
    errors?: string[];
}

export interface SqlLogEntry {
    time: string;
    sql: string;
    durationMs: number;
    rowsAffected?: number;
    error?: string;
}

export interface SqlEditorTab {
    id: string;
    name: string;
    sql: string;
    results: QueryResult | null;
    offset: number;
    error: string | null;
    isTransposed: boolean;
    logs: SqlLogEntry[];
    activeBottomTab: 'results' | 'logs';
    lastExecutedSql?: string;
}

interface ErSqlContextType {
    sqlTabs: SqlEditorTab[];
    activeSqlTabId: string;
    isGlobalExecuting: boolean;
}

interface ErSqlActionsContextType {
    setActiveSqlTabId: (id: string) => void;
    addSqlTab: (name?: string, initialSql?: string) => string;
    removeSqlTab: (id: string) => void;
    updateSqlTab: (id: string, updates: Partial<SqlEditorTab>) => void;
    setIsGlobalExecuting: (executing: boolean) => void;
}

interface ErDiagramContextType {
    data: ErDiagramData;
    setData: (newData: ErDiagramData | ((prev: ErDiagramData) => ErDiagramData)) => void;
    addTables: (newTables: TableMetadata[], merge?: boolean) => void;
    clearTables: () => void;
    addTable: () => void;
    updateTable: (tableName: string, updates: Partial<TableMetadata>) => void;
    addColumn: (tableName: string) => void;
    updateColumn: (tableName: string, columnName: string, updates: Partial<ColumnMetadata>) => void;
    addIndex: (tableName: string, index: IndexMetadata) => void;
    removeIndex: (tableName: string, indexName: string) => void;
    duplicateTable: (tableName: string) => void;
    duplicateColumn: (tableName: string, colName: string) => void;
    addCategory: (category: CategoryMetadata) => void;
    updateCategory: (id: string, updates: Partial<CategoryMetadata>) => void;
    setTablesForCategory: (categoryId: string, tableNames: string[]) => void;
    addTablesToCategory: (categoryId: string, tableNames: string[]) => void;
    updateTablePosition: (tableName: string, x: number, y: number) => void;
    updateCategoryPosition: (categoryId: string, x: number, y: number) => void;
    addForeignKey: (sourceTable: string, targetTable: string, pairs: { source: string, target: string }[]) => void;
    removeForeignKey: (sourceTable: string, sourceCol: string) => void;
    saveSnapshot: (snapshot: SchemaSnapshot) => void;
    updateSettings: (settings: Partial<MetadataSettings>) => void;
}

export const ErSqlContext = createContext<ErSqlContextType | undefined>(undefined);
export const ErSqlActionsContext = createContext<ErSqlActionsContextType | undefined>(undefined);
export const ErDiagramContext = createContext<ErDiagramContextType | undefined>(undefined);

const defaultSettings: MetadataSettings = {
    // Table
    showTableComment: true,
    showEngine: true,
    showPartition: false,
    showTablespace: false,

    // Column - Common
    showColumnComment: true,
    showDefaultValue: true,
    showLength: true,
    showPrecision: true,
    showScale: false,
    showAutoIncrement: true,
    showUnique: false,
    showCheckConstraint: false,

    // Column - MySQL Specific
    showUnsigned: false,
    showZerofill: false,
    showBinary: false,
    showCharset: false,
    showCollation: false,
    showOnUpdate: false,

    // Column - Oracle/Postgres/General Virtual
    showSequence: false,
    showVirtual: false,
    showVirtualExpr: false,
};

export function ErDataProvider({ children, initialData }: { children: ReactNode, initialData?: ErDiagramData }) {
    const [data, setDataState] = useState<ErDiagramData>(initialData || {
        tables: [],
        categories: [{ id: 'all', name: 'ALL', x: 0, y: 0, related_category_ids: [] }],
        history: [],
        settings: defaultSettings
    });

    const [sqlTabs, setSqlTabs] = useState<SqlEditorTab[]>([
        {
            id: 'tab-1',
            name: 'Query 1',
            sql: '',
            results: null,
            offset: 0,
            error: null,
            isTransposed: false,
            logs: [],
            activeBottomTab: 'results',
            lastExecutedSql: ''
        }
    ]);
    const [activeSqlTabId, setActiveSqlTabId] = useState<string>('tab-1');
    const [isGlobalExecuting, setIsGlobalExecutingState] = useState<boolean>(false);

    // --- SQL ACTION WRAPPERS ---
    const addSqlTab = useCallback((name?: string, initialSql?: string) => {
        const id = Math.random().toString(36).substring(2, 9);
        const newTab: SqlEditorTab = {
            id,
            name: name || `Query ${sqlTabs.length + 1}`,
            sql: initialSql || '',
            results: null,
            offset: 0,
            error: null,
            isTransposed: false,
            logs: [],
            activeBottomTab: 'results',
            lastExecutedSql: ''
        };
        setSqlTabs(prev => [...prev, newTab]);
        setActiveSqlTabId(id);
        return id;
    }, [sqlTabs.length]);

    const removeSqlTab = useCallback((id: string) => {
        setSqlTabs(prev => {
            if (prev.length <= 1) return prev;
            const newTabs = prev.filter(t => t.id !== id);
            if (activeSqlTabId === id) {
                setActiveSqlTabId(newTabs[newTabs.length - 1].id);
            }
            return newTabs;
        });
    }, [activeSqlTabId]);

    const updateSqlTab = useCallback((id: string, updates: Partial<SqlEditorTab>) => {
        setSqlTabs(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    }, []);

    const setData = (newData: ErDiagramData | ((prev: ErDiagramData) => ErDiagramData)) => {
        if (typeof newData === 'function') {
            setDataState((prev) => {
                const updated = newData(prev);
                const hasAll = updated.categories.some(c => c.id === 'all');
                return hasAll ? updated : {
                    ...updated,
                    categories: [...updated.categories, { id: 'all', name: 'ALL', x: 0, y: 0, related_category_ids: [] }]
                };
            });
        } else {
            const hasAll = newData.categories.some(c => c.id === 'all');
            const finalData = hasAll ? newData : {
                ...newData,
                categories: [...newData.categories, { id: 'all', name: 'ALL', x: 0, y: 0, related_category_ids: [] }]
            };
            setDataState(finalData);
        }
    };

    const addTables = (newTables: TableMetadata[], merge: boolean = false) => {
        setData(prev => {
            if (!merge) {
                const positionedTables = newTables.map((t, i) => ({
                    ...t,
                    indices: t.indices || [],
                    columns: t.columns.map(c => ({
                        ...c,
                        is_nullable: c.is_nullable ?? true,
                        version: c.version ?? 1,
                        last_modified: c.last_modified ?? Date.now(),
                    })),
                    category_ids: t.category_ids?.length ? t.category_ids : ['all'],
                    x: t.x || (i % 5) * 300,
                    y: t.y || Math.floor(i / 5) * 200,
                }));
                return { ...prev, tables: [...prev.tables, ...positionedTables] };
            }

            const updatedTables = [...prev.tables];
            newTables.forEach(nt => {
                const existingIdx = updatedTables.findIndex(t => t.name === nt.name);
                if (existingIdx >= 0) {
                    const existing = updatedTables[existingIdx];
                    const mergedColumns = [...existing.columns];
                    nt.columns.forEach(nc => {
                        const colIdx = mergedColumns.findIndex(c => c.name === nc.name);
                        if (colIdx >= 0) {
                            const current = mergedColumns[colIdx];
                            if (current.data_type !== nc.data_type || current.is_primary_key !== nc.is_primary_key) {
                                mergedColumns[colIdx] = {
                                    ...current,
                                    ...nc,
                                    version: (current.version || 1) + 1,
                                    last_modified: Date.now()
                                };
                            }
                        } else {
                            mergedColumns.push({
                                ...nc,
                                version: 1,
                                last_modified: Date.now(),
                                is_nullable: nc.is_nullable ?? true
                            });
                        }
                    });
                    updatedTables[existingIdx] = { ...existing, columns: mergedColumns, indices: nt.indices || existing.indices };
                } else {
                    updatedTables.push({
                        ...nt,
                        indices: nt.indices || [],
                        columns: nt.columns.map(c => ({ ...c, version: 1, last_modified: Date.now(), is_nullable: c.is_nullable ?? true })),
                        category_ids: nt.category_ids?.length ? nt.category_ids : ['all'],
                        x: (updatedTables.length % 5) * 300,
                        y: Math.floor(updatedTables.length / 5) * 200,
                    });
                }
            });
            return { ...prev, tables: updatedTables };
        });
    };

    const clearTables = () => {
        setData(prev => ({ ...prev, tables: [] }));
    };

    const updateTable = (tableName: string, updates: Partial<TableMetadata>) => {
        setData(prev => ({
            ...prev,
            tables: prev.tables.map(t => t.name === tableName ? { ...t, ...updates } : t)
        }));
    };

    const updateColumn = (tableName: string, columnName: string, updates: Partial<ColumnMetadata>) => {
        setData(prev => ({
            ...prev,
            tables: prev.tables.map(t => {
                if (t.name === tableName) {
                    return {
                        ...t,
                        columns: t.columns.map(c => c.name === columnName ? {
                            ...c,
                            ...updates,
                            version: (updates.name || updates.data_type) ? (c.version || 1) + 1 : (c.version || 1),
                            last_modified: (updates.name || updates.data_type) ? Date.now() : (c.last_modified || Date.now())
                        } : c)
                    };
                }
                return t;
            })
        }));
    };

    const addIndex = (tableName: string, index: IndexMetadata) => {
        setData(prev => ({
            ...prev,
            tables: prev.tables.map(t => t.name === tableName ? { ...t, indices: [...(t.indices || []), index] } : t)
        }));
    };

    const removeIndex = (tableName: string, indexName: string) => {
        setData(prev => ({
            ...prev,
            tables: prev.tables.map(t => t.name === tableName ? { ...t, indices: (t.indices || []).filter(idx => idx.name !== indexName) } : t)
        }));
    };

    const addTable = () => {
        setData(prev => {
            const name = `NewTable_${prev.tables.length + 1}`;
            return {
                ...prev,
                tables: [
                    ...prev.tables,
                    {
                        name,
                        columns: [],
                        indices: [],
                        x: 100 + (prev.tables.length % 5) * 50,
                        y: 100 + Math.floor(prev.tables.length / 5) * 50
                    }
                ]
            };
        });
    };

    const addColumn = (tableName: string) => {
        setData(prev => ({
            ...prev,
            tables: prev.tables.map(t => {
                if (t.name === tableName) {
                    const colName = `col_${(t.columns || []).length + 1}`;
                    return {
                        ...t,
                        columns: [...(t.columns || []), {
                            name: colName,
                            data_type: 'varchar(255)',
                            is_primary_key: false,
                            is_foreign_key: false,
                            is_nullable: true,
                            version: 1,
                            last_modified: Date.now()
                        }]
                    };
                }
                return t;
            })
        }));
    };

    const addCategory = (category: CategoryMetadata) => {
        setData(prev => ({
            ...prev,
            categories: [...(prev.categories || []), category]
        }));
    };

    const updateCategory = (id: string, updates: Partial<CategoryMetadata>) => {
        setData(prev => ({
            ...prev,
            categories: (prev.categories || []).map(c => c.id === id ? { ...c, ...updates } : c)
        }));
    };

    const setTablesForCategory = (categoryId: string, tableNames: string[]) => {
        setData(prev => ({
            ...prev,
            tables: prev.tables.map(t => {
                let newCatIds = t.category_ids || [];
                if (tableNames.includes(t.name)) {
                    if (!newCatIds.includes(categoryId)) newCatIds = [...newCatIds, categoryId];
                } else {
                    newCatIds = newCatIds.filter(id => id !== categoryId);
                }
                if (newCatIds.length === 0) newCatIds = ['all'];
                return { ...t, category_ids: newCatIds };
            })
        }));
    };

    const addTablesToCategory = (categoryId: string, tableNames: string[]) => {
        setData(prev => ({
            ...prev,
            tables: prev.tables.map(t => {
                let newCatIds = t.category_ids || [];
                if (tableNames.includes(t.name) && !newCatIds.includes(categoryId)) {
                    newCatIds = [...newCatIds, categoryId];
                }
                return { ...t, category_ids: newCatIds };
            })
        }));
    };

    const updateTablePosition = (tableName: string, x: number, y: number) => {
        setData(prev => ({
            ...prev,
            tables: prev.tables.map(t =>
                t.name === tableName ? { ...t, x, y } : t
            )
        }));
    };

    const updateCategoryPosition = (categoryId: string, x: number, y: number) => {
        setData(prev => ({
            ...prev,
            categories: prev.categories.map(c =>
                c.id === categoryId ? { ...c, x, y } : c
            )
        }));
    };

    const addForeignKey = (sourceTable: string, targetTable: string, pairs: { source: string, target: string }[]) => {
        setData(prev => ({
            ...prev,
            tables: prev.tables.map(t => {
                if (t.name === sourceTable) {
                    const newColumns = t.columns.map(c => {
                        const pair = pairs.find(p => p.source === c.name);
                        if (pair) {
                            return {
                                ...c,
                                is_foreign_key: true,
                                references_table: targetTable,
                                references_column: pair.target,
                            };
                        }
                        return c;
                    });
                    return { ...t, columns: newColumns };
                }
                return t;
            })
        }));
    };

    const removeForeignKey = (sourceTable: string, sourceCol: string) => {
        setData(prev => ({
            ...prev,
            tables: prev.tables.map(t => {
                if (t.name === sourceTable) {
                    return {
                        ...t,
                        columns: t.columns.map(c => {
                            if (c.name === sourceCol) {
                                return {
                                    ...c,
                                    is_foreign_key: false,
                                    references_table: undefined,
                                    references_column: undefined,
                                };
                            }
                            return c;
                        })
                    };
                }
                return t;
            })
        }));
    };

    const duplicateTable = (tableName: string) => {
        setData(prev => {
            const table = prev.tables.find(t => t.name === tableName);
            if (!table) return prev;

            let newName = `${table.name}_copy`;
            let counter = 1;
            while (prev.tables.some(t => t.name === newName)) {
                newName = `${table.name}_copy_${counter}`;
                counter++;
            }

            return {
                ...prev,
                tables: [
                    ...prev.tables,
                    { ...table, name: newName, x: table.x + 30, y: table.y + 30 }
                ]
            };
        });
    };

    const duplicateColumn = (tableName: string, colName: string) => {
        setData(prev => ({
            ...prev,
            tables: prev.tables.map(t => {
                if (t.name === tableName) {
                    const col = t.columns.find(c => c.name === colName);
                    if (!col) return t;

                    let newName = `${col.name}_copy`;
                    let counter = 1;
                    while (t.columns.some(c => c.name === newName)) {
                        newName = `${col.name}_copy_${counter}`;
                        counter++;
                    }

                    return {
                        ...t,
                        columns: [...t.columns, { ...col, name: newName, version: 1, last_modified: Date.now() }]
                    };
                }
                return t;
            })
        }));
    };

    const saveSnapshot = (snapshot: SchemaSnapshot) => {
        setData(prev => ({
            ...prev,
            history: [...(prev.history || []), snapshot]
        }));
    };

    const updateSettings = (updates: Partial<MetadataSettings>) => {
        setData(prev => ({
            ...prev,
            settings: { ...(prev.settings || defaultSettings), ...updates }
        }));
    };

    const setIsGlobalExecuting = (executing: boolean) => {
        setIsGlobalExecutingState(executing);
    };

    const diagramValue = useMemo(() => ({
        data,
        setData,
        addTables,
        clearTables,
        addTable,
        updateTable,
        addColumn,
        updateColumn,
        addIndex,
        removeIndex,
        duplicateTable,
        duplicateColumn,
        addCategory,
        updateCategory,
        setTablesForCategory,
        addTablesToCategory,
        updateTablePosition,
        updateCategoryPosition,
        addForeignKey,
        removeForeignKey,
        saveSnapshot,
        updateSettings
    }), [
        data, addTables, clearTables, addTable, updateTable, addColumn,
        updateColumn, addIndex, removeIndex, duplicateTable, duplicateColumn,
        addCategory, updateCategory, setTablesForCategory, addTablesToCategory,
        updateTablePosition, updateCategoryPosition, addForeignKey, removeForeignKey,
        saveSnapshot, updateSettings
    ]);

    return (
        <ErSqlContext.Provider value={{ sqlTabs, activeSqlTabId, isGlobalExecuting }}>
            <ErSqlActionsContext.Provider value={{ 
                setActiveSqlTabId, 
                addSqlTab, 
                removeSqlTab, 
                updateSqlTab,
                setIsGlobalExecuting
            }}>
                <ErDiagramContext.Provider value={diagramValue}>
                    {children}
                </ErDiagramContext.Provider>
            </ErSqlActionsContext.Provider>
        </ErSqlContext.Provider>
    );
}

export function useErDiagram() {
    const context = useContext(ErDiagramContext);
    if (!context) {
        throw new Error('useErDiagram must be used within a ErDataProvider');
    }
    return context;
}

export function useErSql() {
    const context = useContext(ErSqlContext);
    if (!context) {
        throw new Error('useErSql must be used within a ErDataProvider');
    }
    return context;
}

export function useErSqlActions() {
    const context = useContext(ErSqlActionsContext);
    if (!context) {
        throw new Error('useErSqlActions must be used within a ErDataProvider');
    }
    return context;
}

export function useErData() {
    const diag = useErDiagram();
    const sql = useErSql();
    const sqlActions = useErSqlActions();
    return { ...diag, ...sql, ...sqlActions };
}
