import React, { useState, useRef, useEffect } from 'react';
import { Database, Play, ChevronLeft, ChevronRight, AlertCircle, Terminal, ArrowRightLeft, Table, Columns } from 'lucide-react';
import { invoke } from "@tauri-apps/api/core";
import { format } from "sql-formatter";
import { ErDiagramData, DbConfig } from '../types/er';
import { useErSql, useErSqlActions, SqlEditorTab, QueryResult, SqlLogEntry } from '../hooks/useErData';
import { DbObject } from './Sidebar';
import ResultsTable from './ResultsTable';

interface SqlEditorProps {
    data: ErDiagramData;
    dbConfig?: DbConfig;
    onOpenDbConnect: () => void;
    isSidebarOpen: boolean;
    dbConnectionStatus: 'connected' | 'error' | 'disconnected';
    onConnectionStatusChange: (status: 'connected' | 'error' | 'disconnected') => void;
    catalog?: DbObject[];
}

const KEYWORDS = ['select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete', 'join', 'inner', 'left', 'right', 'outer', 'on', 'group by', 'order by', 'having', 'limit', 'offset', 'as', 'and', 'or', 'not', 'in', 'is', 'null', 'commit', 'rollback', 'create', 'drop', 'alter', 'truncate', 'describe', 'show', 'explain'];

export default function SqlEditor({ data, dbConfig, onOpenDbConnect, isSidebarOpen, dbConnectionStatus, onConnectionStatusChange, catalog = [] }: SqlEditorProps) {
    const {
        sqlTabs: tabs,
        activeSqlTabId: activeTabId,
        isGlobalExecuting,
    } = useErSql();
    const {
        setActiveSqlTabId,
        addSqlTab,
        removeSqlTab,
        updateSqlTab,
        setIsGlobalExecuting,
    } = useErSqlActions();

    // Reset uncommitted changes flag when dbConfig changes (new session)
    useEffect(() => {
        tabs.forEach(tab => {
            if (tab.results?.has_uncommitted_changes) {
                updateSqlTab(tab.id, { 
                    results: { ...tab.results, has_uncommitted_changes: false } 
                });
            }
        });
    }, [dbConfig?.host, dbConfig?.db_name, dbConfig?.user, updateSqlTab]);

    const [isLoading, setIsLoading] = useState(false);
    const [cachedColumnsMetadata, setCachedColumnsMetadata] = useState<Record<string, ColumnMetadata[]>>({});
    const pendingFetches = useRef<Set<string>>(new Set());

    // Auto-complete state
    const [suggestions, setSuggestions] = useState<{ type: 'table' | 'column' | 'join', items: { label: string, value: string, comment?: string, type: string }[], replacePrefix: string } | null>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [cursorIdx, setCursorIdx] = useState(0);
    const [editorHeightPercent, setEditorHeightPercent] = useState(50);
    const [pendingCursor, setPendingCursor] = useState<number | null>(null);

    // Auto-scroll logic for suggestions
    useEffect(() => {
        if (suggestions && selectedIndex >= 0) {
            scrollToSuggestion(selectedIndex);
        }
    }, [selectedIndex, suggestions]);

    const [useAliasForJoin, setUseAliasForJoin] = useState(true);
    const [suggestionPos, setSuggestionPos] = useState({ top: 40, left: 40 });

    const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];
    const { sql, results, offset, error, isTransposed, logs, activeBottomTab } = activeTab;

    // Column widths state: { column_name: width_in_px }
    const [colWidths, setColWidths] = useState<Record<string, number>>({});

    // Context Menu state
    const [contextMenu, setContextMenu] = useState<{
        x: number, y: number,
        rowIdx: number | null,
        colIdx: number | null,
        val: string,
        colName: string
    } | null>(null);

    // Multi-cell selection state
    const [selectionBox, setSelectionBox] = useState<{ r1: number, c1: number, r2: number, c2: number } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [lastSelectedRow, setLastSelectedRow] = useState<number | null>(null);
    const [dragMode, setDragMode] = useState<'cell' | 'row' | null>(null);
    const [activeCell, setActiveCell] = useState<{ r: number, c: number } | null>(null);

    // Audio focus
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.focus();
        }
    }, [activeTabId]);

    useEffect(() => {
        const handleInsertText = (e: Event) => {
            const customEvent = e as CustomEvent<{ text: string, type: 'newline' | 'inline' | 'inline-comma' }>;
            const { text, type } = customEvent.detail;
            if (!textareaRef.current) return;
            const textarea = textareaRef.current;
            textarea.focus();

            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const currentSql = textarea.value || '';
            
            let textToInsert = text;
            if (type === 'newline') {
                const needsPrefix = start > 0 && currentSql[start - 1] !== '\n';
                const needsSuffix = end < currentSql.length && currentSql[end] !== '\n';
                textToInsert = `${needsPrefix ? '\n' : ''}${text}${needsSuffix ? '\n' : ''}`;
            } else if (type === 'inline-comma') {
                const textBeforeStart = currentSql.slice(0, start).trimEnd();
                const upperBefore = textBeforeStart.toUpperCase();
                const needsComma = textBeforeStart.length > 0 
                    && !textBeforeStart.endsWith(',') 
                    && !textBeforeStart.endsWith('(')
                    && !upperBefore.endsWith('SELECT')
                    && !upperBefore.endsWith('FROM')
                    && !upperBefore.endsWith('WHERE')
                    && !upperBefore.endsWith('SET');
                textToInsert = `${needsComma ? ', ' : ''}${text}`;
            }

            // Use document.execCommand to support Undo (Ctrl+Z)
            // Note: textarea must be focused.
            document.execCommand('insertText', false, textToInsert);
        };

        window.addEventListener('insert-sql-text', handleInsertText);
        return () => window.removeEventListener('insert-sql-text', handleInsertText);
    }, [activeTab.sql, activeTabId, updateSqlTab]);

    useEffect(() => {
        const handleAddSqlLog = (e: Event) => {
            const customEvent = e as CustomEvent<{ sql: string, duration_ms: number, rows: number, status?: 'success' | 'error' }>;
            const { sql, duration_ms, rows, status } = customEvent.detail;
            
            const newLog: SqlLogEntry = {
                time: new Date().toLocaleTimeString(),
                sql: sql,
                durationMs: duration_ms,
                rowsAffected: rows,
                error: status === 'error' ? 'Failed' : undefined
            };
            
            updateSqlTab(activeTabId, {
                logs: [newLog, ...(activeTab.logs || [])]
            });
        };

        window.addEventListener('add-sql-log', handleAddSqlLog);
        return () => window.removeEventListener('add-sql-log', handleAddSqlLog);
    }, [activeTabId, activeTab.logs, updateSqlTab]);


    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const suggestionsRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const caretRef = useRef<HTMLSpanElement>(null);

    React.useEffect(() => {
        setSelectedIndex(0);
        if (caretRef.current && suggestions) {
            setSuggestionPos({
                top: caretRef.current.offsetTop,
                left: caretRef.current.offsetLeft
            });
        }
    }, [suggestions]);

    React.useEffect(() => {
        if (pendingCursor !== null && textareaRef.current) {
            textareaRef.current.setSelectionRange(pendingCursor, pendingCursor);
            setPendingCursor(null);
        }
    }, [pendingCursor, sql]);

    const highlightSql = (text: string) => {
        const textBefore = text.slice(0, cursorIdx);
        const textAfter = text.slice(cursorIdx);
        return (
            <>
                {highlightTokens(textBefore, 'before')}
                <span ref={caretRef} />
                {highlightTokens(textAfter, 'after')}
            </>
        );
    };

    const highlightTokens = (segment: string, keyPrefix: string) => {
        const keywords = ['select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete', 'join', 'inner', 'left', 'right', 'outer', 'on', 'group by', 'order by', 'having', 'limit', 'offset', 'as', 'and', 'or', 'not', 'in', 'is', 'null'];
        const regex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'gi');
        const parts = segment.split(regex);
        return parts.map((part, i) => {
            if (i % 2 === 1) {
                return <span key={`${keyPrefix}-${i}`} className="text-pink-400 font-bold">{part}</span>;
            }
            return <span key={`${keyPrefix}-${i}`}>{part}</span>;
        });
    };

    const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
        if (overlayRef.current) {
            overlayRef.current.scrollTop = e.currentTarget.scrollTop;
            overlayRef.current.scrollLeft = e.currentTarget.scrollLeft;
        }
    };


    const startResize = (e: React.MouseEvent) => {
        e.preventDefault();
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'row-resize';

        const startY = e.clientY;
        const startPercent = editorHeightPercent;

        const doDrag = (moveEvent: MouseEvent) => {
            if (!containerRef.current) return;
            const containerHeight = containerRef.current.offsetHeight;
            const deltaY = moveEvent.clientY - startY;
            const deltaPercent = (deltaY / containerHeight) * 100;
            const newPercent = Math.min(Math.max(startPercent + deltaPercent, 10), 90);
            setEditorHeightPercent(newPercent);
        };

        const stopDrag = () => {
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
            document.removeEventListener('mousemove', doDrag);
            document.removeEventListener('mouseup', stopDrag);
        };

        document.addEventListener('mousemove', doDrag);
        document.addEventListener('mouseup', stopDrag);
    };

    const handleFormatSql = () => {
        if (!sql.trim()) return;

        let newSql = sql;
        if (textareaRef.current) {
            const start = textareaRef.current.selectionStart;
            const end = textareaRef.current.selectionEnd;
            if (start !== end) {
                const selectedText = sql.substring(start, end);
                const formattedSelection = format(selectedText, { language: 'postgresql' });
                newSql = sql.substring(0, start) + formattedSelection + sql.substring(end);
            } else {
                newSql = format(sql, { language: 'postgresql' });
            }
        } else {
            newSql = format(sql, { language: 'postgresql' });
        }

        updateActiveTab({ sql: newSql });
        if (textareaRef.current) {
            textareaRef.current.focus();
        }
    };

    const handleCellMouseDown = (e: React.MouseEvent, r: number, c: number) => {
        if (e.button !== 0) return; // Only trigger on left click

        setDragMode('cell');
        if (e.shiftKey && lastSelectedRow !== null) {
            setSelectionBox({
                r1: lastSelectedRow,
                c1: 0,
                r2: r,
                c2: results?.columns.length ? results.columns.length - 1 : 0
            });
        } else {
            setSelectionBox({ r1: r, c1: c, r2: r, c2: c });
            setLastSelectedRow(r);
        }
        setIsDragging(true);
        setActiveCell({ r, c });
    };

    const handleRowMouseDown = (e: React.MouseEvent, r: number) => {
        if (e.button !== 0) return;
        setDragMode('row');
        const maxCol = results?.columns.length ? results.columns.length - 1 : 0;

        if (e.shiftKey && lastSelectedRow !== null) {
            setSelectionBox({ r1: lastSelectedRow, c1: 0, r2: r, c2: maxCol });
        } else {
            setSelectionBox({ r1: r, c1: 0, r2: r, c2: maxCol });
            setLastSelectedRow(r);
        }
        setIsDragging(true);
        setActiveCell({ r, c: 0 });
    };

    const handleCellMouseEnter = (r: number, c: number) => {
        if (isDragging) {
            if (dragMode === 'row') {
                const maxCol = results?.columns.length ? results.columns.length - 1 : 0;
                setSelectionBox(prev => prev ? { ...prev, r2: r, c2: maxCol } : null);
            } else {
                setSelectionBox(prev => prev ? { ...prev, r2: r, c2: c } : null);
            }
        }
    };

    const handleRowMouseEnter = (r: number) => {
        if (isDragging && dragMode === 'row') {
            const maxCol = results?.columns.length ? results.columns.length - 1 : 0;
            setSelectionBox(prev => prev ? { ...prev, r2: r, c2: maxCol } : null);
        }
    };

    const handleCellMouseUp = () => {
        setIsDragging(false);
        setDragMode(null);
    };

    React.useEffect(() => {
        const handleGlobalMouseUp = () => setIsDragging(false);
        document.addEventListener('mouseup', handleGlobalMouseUp);
        return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
    }, []);

    const isCellSelected = (r: number, c: number) => {
        if (!selectionBox) return false;
        const rMin = Math.min(selectionBox.r1, selectionBox.r2);
        const rMax = Math.max(selectionBox.r1, selectionBox.r2);
        const cMin = Math.min(selectionBox.c1, selectionBox.c2);
        const cMax = Math.max(selectionBox.c1, selectionBox.c2);
        return r >= rMin && r <= rMax && c >= cMin && c <= cMax;
    };

    const handleContextMenu = (e: React.MouseEvent, rowIdx: number | null, colIdx: number | null, val: string, colName: string) => {
        e.preventDefault();

        // If right-clicked cell is not in the current selection, select only this cell
        if (rowIdx !== null && colIdx !== null && !isCellSelected(rowIdx, colIdx)) {
            setSelectionBox({ r1: rowIdx, c1: colIdx, r2: rowIdx, c2: colIdx });
        }

        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            rowIdx,
            colIdx,
            val,
            colName
        });
    };

    const closeContextMenu = () => setContextMenu(null);

    React.useEffect(() => {
        const handleCopy = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
                const target = e.target as HTMLElement;
                if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable) return;

                if (selectionBox && results) {
                    e.preventDefault();
                    executeContextMenuAction('copy');
                }
            }
        };

        const handleResultsMouseDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('.context-menu')) return;
            
            if (e.button !== 2 && !isDragging) {
                closeContextMenu();
            }
        };
        document.addEventListener('mousedown', handleResultsMouseDown);
        window.addEventListener('keydown', handleCopy);
        return () => {
            document.removeEventListener('mousedown', handleResultsMouseDown);
            window.addEventListener('keydown', handleCopy);
        };
    }, [isDragging, selectionBox, results]);

    const executeContextMenuAction = (action: 'copy' | 'where' | 'insert' | 'update') => {
        if (!results) return;
        if (!contextMenu && !selectionBox) return;

        const formatDateTimeString = (val: string, formatTemplate: string) => {
            if (!formatTemplate) return val;
            const match = val.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-]\d{2}:\d{2}))?)?$/);
            if (!match) return val;
            
            const [_, YYYY, MM, DD, HH, mm, ss, frac] = match;
            const hours = HH || '00';
            const minutes = mm || '00';
            const seconds = ss || '00';
            const fractional = frac || '000';
            const SSS = fractional.substring(0, 3).padEnd(3, '0');
            
            return formatTemplate
                .replace(/YYYY/g, YYYY)
                .replace(/MM/g, MM)
                .replace(/DD/g, DD)
                .replace(/HH24/gi, hours)
                .replace(/HH/g, hours)
                .replace(/MI/gi, minutes)
                .replace(/mm/g, minutes)
                .replace(/SS/g, seconds)
                .replace(/FF/gi, fractional)
                .replace(/SSS/g, SSS);
        };

        const quoteIfNeeded = (val: string) => {
            const v = String(val);
            if (!isNaN(Number(v)) && v.trim() !== '') return v;
            if (v === 'NULL') return v;
            
            let formattedValue = v;
            if (data.settings?.exportDateTimeFormat && /^\d{4}-\d{2}-\d{2}/.test(v)) {
                formattedValue = formatDateTimeString(v, data.settings.exportDateTimeFormat);
            }
            
            return `'${formattedValue.replace(/'/g, "''")}'`;
        };

        const hasSelection = selectionBox !== null;
        let rMin = contextMenu ? (contextMenu.rowIdx ?? 0) : (selectionBox ? Math.min(selectionBox.r1, selectionBox.r2) : 0);
        let rMax = contextMenu ? (contextMenu.rowIdx ?? 0) : (selectionBox ? Math.max(selectionBox.r1, selectionBox.r2) : 0);
        let cMin = contextMenu ? (contextMenu.colIdx ?? 0) : (selectionBox ? Math.min(selectionBox.c1, selectionBox.c2) : 0);
        let cMax = contextMenu ? (contextMenu.colIdx ?? 0) : (selectionBox ? Math.max(selectionBox.c1, selectionBox.c2) : 0);
        if (hasSelection && selectionBox) {
            rMin = Math.min(selectionBox.r1, selectionBox.r2);
            rMax = Math.max(selectionBox.r1, selectionBox.r2);
            cMin = Math.min(selectionBox.c1, selectionBox.c2);
            cMax = Math.max(selectionBox.c1, selectionBox.c2);
        }

        const extractTableName = (query: string) => {
            if (!query) return 'unknown_table';
            const regex = /(?:from|into|update|delete\s+from)\s+((?:"[^"]+"|[a-z0-9_]+)(?:\.(?:"[^"]+"|[a-z0-9_]+))?)/i;
            const m = query.match(regex);
            return m ? m[1] : 'unknown_table';
        };

        const targetSql = activeTab.lastExecutedSql || sql;
        const tableName = extractTableName(targetSql);

        switch (action) {
            case 'copy':
                if (hasSelection) {
                    let tsv = "";
                    for (let r = rMin; r <= rMax; r++) {
                        let rowVals = [];
                        for (let c = cMin; c <= cMax; c++) {
                            rowVals.push(results.rows[r][c]);
                        }
                        tsv += rowVals.join("\t") + "\n";
                    }
                    navigator.clipboard.writeText(tsv.trim());
                } else if (contextMenu) {
                    navigator.clipboard.writeText(contextMenu.val);
                }
                break;
            case 'where':
                if (hasSelection) {
                    let conditions = [];
                    for (let r = rMin; r <= rMax; r++) {
                        for (let c = cMin; c <= cMax; c++) {
                            const cName = results.columns[c];
                            const v = results.rows[r][c];
                            conditions.push(`${cName} = ${quoteIfNeeded(v)}`);
                        }
                    }
                    navigator.clipboard.writeText(conditions.join(' AND '));
                } else if (contextMenu) {
                    navigator.clipboard.writeText(`${contextMenu.colName} = ${quoteIfNeeded(contextMenu.val)}`);
                }
                break;
            case 'insert': {
                let insertStatements = "";
                for (let r = rMin; r <= rMax; r++) {
                    const rowData = results.rows[r];
                    const cols = results.columns.join(', ');
                    const vals = rowData.map(v => quoteIfNeeded(String(v))).join(', ');
                    insertStatements += `INSERT INTO ${tableName} (${cols}) VALUES (${vals});\n`;
                }

                addSqlTab(`Insert ${tableName.replace(/"/g, '')}`, insertStatements);
                break;
            }
            case 'update': {
                let updateStatements = "";

                for (let r = rMin; r <= rMax; r++) {
                    let setClauses = [];
                    for (let c = cMin; c <= cMax; c++) {
                        const cName = results.columns[c];
                        const val = results.rows[r][c];
                        setClauses.push(`${cName} = ${quoteIfNeeded(String(val))}`);
                    }
                    updateStatements += `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE /* specify condition */;\n`;
                }

                addSqlTab(`Update ${tableName.replace(/"/g, '')}`, updateStatements);
                break;
            }
        }
        closeContextMenu();
    };

    const updateActiveTab = (updates: Partial<SqlEditorTab>) => {
        updateSqlTab(activeTabId, updates);
    };

    const handleExecute = async (newOffset: number = 0, specificSql?: string) => {
        if (isGlobalExecuting) return; // Block multiple executions
        if (!dbConfig) {
            updateActiveTab({ error: "Database connection not configured. Please connect first via Sidebar." });
            return;
        }
        const executeQuery = specificSql || sql;
        if (!executeQuery.trim()) return;

        setIsGlobalExecuting(true);
        setIsLoading(true);
        updateActiveTab({ error: null });
        const startTime = Date.now();
        try {
            const res = await invoke<QueryResult>('execute_db_query', {
                config: dbConfig,
                sql: executeQuery,
                offset: newOffset,
                tabId: activeTabId
            });
            const durationMs = Date.now() - startTime;
            const hasErrors = res.errors && res.errors.length > 0;
            const errorStr = hasErrors ? res.errors.join('\n') : undefined;

            const newLog: SqlLogEntry = {
                time: new Date().toLocaleTimeString(),
                sql: executeQuery,
                durationMs,
                rowsAffected: res.total_count !== null ? Number(res.total_count) : undefined,
                error: errorStr
            };

            updateActiveTab({
                results: res,
                offset: newOffset,
                logs: [newLog, ...(activeTab.logs || [])],
                activeBottomTab: hasErrors ? 'logs' : 'results',
                lastExecutedSql: executeQuery,
                error: hasErrors ? "Some statements failed. Check logs for details." : null
            });
            const newWidths: Record<string, number> = {};
            res.columns.forEach(c => newWidths[c] = 150);
            setColWidths(newWidths);
        } catch (e) {
            const durationMs = Date.now() - startTime;
            const errorStr = String(e).toLowerCase();
            const isConnectionError = errorStr.includes('dpi-1010') || 
                                      errorStr.includes('connection refused') || 
                                      errorStr.includes('broken pipe') || 
                                      errorStr.includes('closed') ||
                                      errorStr.includes('timeout') ||
                                      errorStr.includes('not connected');
            
            if (isConnectionError) {
                onConnectionStatusChange('error');
            }

            const errLog: SqlLogEntry = {
                time: new Date().toLocaleTimeString(),
                sql: executeQuery,
                durationMs,
                error: String(e)
            };
            updateActiveTab({
                error: String(e),
                results: null,
                logs: [errLog, ...(activeTab.logs || [])],
                activeBottomTab: 'logs'
            });
        } finally {
            setIsLoading(false);
            setIsGlobalExecuting(false);
        }
    };

    const handleExplain = async () => {
        if (isGlobalExecuting) return;
        if (!dbConfig) {
            updateActiveTab({ error: "Database connection not configured." });
            return;
        }
        if (!sql.trim()) return;

        setIsGlobalExecuting(true);
        setIsLoading(true);
        updateActiveTab({ error: null });
        const startTime = Date.now();
        try {
            const plan = await invoke<string>('fetch_explain_plan', {
                config: dbConfig,
                sql: sql
            });
            const durationMs = Date.now() - startTime;
            const newLog: SqlLogEntry = {
                time: new Date().toLocaleTimeString(),
                sql: `-- EXPLAIN PLAN --\n${sql}`,
                durationMs,
                error: undefined // No error
            };

            // Show plan in logs for now as it's typically text-heavy
            updateActiveTab({
                logs: [{
                    ...newLog,
                    error: plan // Using error field for text output as it supports whitespace-pre-wrap
                }, ...(activeTab.logs || [])],
                activeBottomTab: 'logs'
            });
        } catch (e) {
            updateActiveTab({
                error: `Explain failed: ${e}`,
                activeBottomTab: 'logs'
            });
        } finally {
            setIsLoading(false);
            setIsGlobalExecuting(false);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        const pos = e.target.selectionStart;
        updateActiveTab({ sql: value });
        setCursorIdx(pos);
        
        // Fix: Auto-trigger suggestions for @, . and JOIN
        const charBefore = value[pos - 1];
        const textBefore = value.substring(0, pos);
        
        if (charBefore === '@' || charBefore === '.' || charBefore === '．') {
            updateSuggestions(value, pos);
        } else if (textBefore.toLowerCase().match(/(?:^|\s)join\s+$/)) {
            updateSuggestions(value, pos);
        } else if (suggestions) {
            // Keep updating suggestions as user types to filter the list
            updateSuggestions(value, pos);
        } else {
            setSuggestions(null);
        }
    };

    const triggerSuggestions = (pos?: number) => {
        const currentPos = pos ?? cursorIdx;
        updateSuggestions(activeTab.sql, currentPos);
    };

    const updateSuggestions = (currentSql: string, pos: number) => {
        interface SuggestionItem {
            label: string;
            comment?: string;
            value: string;
            type: 'table' | 'column' | 'keyword' | 'join';
        }

        const lowerSql = currentSql.toLowerCase();
        
        // Identify current SQL block (delimited by ;) - Optimized for large SQL
        const lastSemicolon = currentSql.lastIndexOf(';', pos - 1);
        const nextSemicolon = currentSql.indexOf(';', pos);
        const blockOffset = lastSemicolon === -1 ? 0 : lastSemicolon + 1;
        const currentBlock = currentSql.substring(blockOffset, nextSemicolon === -1 ? currentSql.length : nextSemicolon);
        
        const textBeforeInBlock = currentSql.substring(blockOffset, pos);

        // 1. Check for JOIN trigger first
        const joinMatch = textBeforeInBlock.match(/(?:^|\s)join\s+([a-zA-Z0-9_]*)$/i);
        if (joinMatch) {
            const typedTarget = joinMatch[1].toLowerCase();
            const mentioned = data.tables.filter(t => currentBlock.includes(t.name));

            if (mentioned.length > 0) {
                let joinItems: SuggestionItem[] = [];
                data.tables.forEach(t2 => {
                    if (typedTarget && !t2.name.toLowerCase().includes(typedTarget)) return;

                    mentioned.forEach(t1 => {
                        if (t1.name === t2.name) return;

                        const generateTableAlias = (name: string) => {
                            const parts = name.split(/[_-]/);
                            if (parts.length > 1) {
                                return parts.map(p => p[0]).join('').toLowerCase();
                            }
                            return name.substring(0, Math.min(3, name.length)).toLowerCase();
                        };

                        const getAlias = (tname: string) => {
                            const m = currentBlock.match(new RegExp(`\\b${tname}\\s+(?:as\\s+)?([a-zA-Z0-9_]+)\\b`, 'i'));
                            if (m) {
                                const potentialAlias = m[1].toLowerCase();
                                const ignores = ['as', 'join', 'on', 'where', 'select', 'from', 'and', 'or', 'inner', 'left', 'right', 'outer'];
                                if (!ignores.includes(potentialAlias)) return m[1];
                            }
                            return null;
                        };

                        const foundAlias1 = getAlias(t1.name);
                        const alias1 = foundAlias1 || t1.name;
                        const useAlias2 = !!foundAlias1 || useAliasForJoin;
                        const alias2 = useAlias2 ? generateTableAlias(t2.name) : t2.name;
                        const t2Display = (useAlias2 && alias2 !== t2.name) ? `${t2.name} ${alias2}` : t2.name;

                        // t1 has FK to t2
                        const fk1 = t1.columns.find(c => c.references_table === t2.name);
                        if (fk1) {
                            const val = `${t2Display} on ${alias1}.${fk1.name} = ${alias2}.${fk1.references_column}`;
                            joinItems.push({ label: val, value: val, type: 'join' });
                        }
                        // t2 has FK to t1
                        const fk2 = t2.columns.find(c => c.references_table === t1.name);
                        if (fk2) {
                            const val = `${t2Display} on ${alias2}.${fk2.name} = ${alias1}.${fk2.references_column}`;
                            joinItems.push({ label: val, value: val, type: 'join' });
                        }
                    });
                });

                if (joinItems.length > 0) {
                    setSuggestions({ type: 'join', items: joinItems, replacePrefix: joinMatch[1] });
                    return;
                }
            }
        }

        // 2. Normal table/column autocomplete
        const match = textBeforeInBlock.match(/(?:^|\s|,|\()([a-zA-Z0-9_@.．]*)$/);
        if (match) {
            let typed = match[1].toLowerCase();
            typed = typed.replace(/．/g, '.'); // Normalize full-width dot
            
            if (typed.startsWith('@')) {
                const tableMatch = typed.substring(1);
                
                const filtered: SuggestionItem[] = [];
                const seen = new Set<string>();
                
                const addUnique = (items: { label: string, comment?: string, value: string }[]) => {
                    for (const item of items) {
                        if (seen.size >= 15) break;
                        const lowerLabel = item.label.toLowerCase();
                        if (!seen.has(lowerLabel) && (lowerLabel.includes(tableMatch) || (item.comment && item.comment.toLowerCase().includes(tableMatch)))) {
                            seen.add(lowerLabel);
                            filtered.push({ ...item, type: 'table' });
                        }
                    }
                };

                addUnique(data.tables.map(t => ({ label: t.name, comment: t.comment, value: t.name })));
                if (filtered.length < 15) {
                    addUnique(catalog.map(o => ({ label: o.name, comment: (o as any).comment, value: o.name })));
                }

                setSuggestions({ type: 'table', items: filtered, replacePrefix: '@' + tableMatch });
                setSelectedIndex(0);
                return;
            }

            if (typed.includes('.')) {
                const parts = typed.split('.');
                const tableOrAlias = parts[0];
                const typedCol = parts[1] || '';
                
                // Identify real table name
                let realTableName = tableOrAlias;
                const aliasMatch = currentBlock.match(new RegExp(`\\b(\\w+)\\s+(?:as\\s+)?${tableOrAlias}\\b`, 'i'));
                if (aliasMatch) {
                    realTableName = aliasMatch[1];
                }

                // 1. Try ER Diagram tables
                const erTable = data.tables.find(t => t.name.toLowerCase() === realTableName.toLowerCase());
                if (erTable) {
                    const colMatches = erTable.columns
                        .filter(c => 
                            c.name.toLowerCase().includes(typedCol.toLowerCase()) || 
                            (c.comment && c.comment.toLowerCase().includes(typedCol.toLowerCase()))
                        )
                        .map(c => ({ label: c.name, comment: c.comment, value: c.name, type: 'column' as const }))
                        .sort((a, b) => a.label.localeCompare(b.label));
                    if (colMatches.length > 0) {
                        setSuggestions({ type: 'column', items: colMatches, replacePrefix: typedCol });
                        return;
                    }
                }

                // 2. Try Cached Columns (Live DB)
                // We need to store full metadata in cachedColumns, but for now we'll assume it's just names or we update cachedColumns structure.
                // Let's check if cachedColumns already has objects.
                const cached = (cachedColumnsMetadata[realTableName.toUpperCase()] || cachedColumnsMetadata[realTableName.toLowerCase()] || []);
                
                if (cached.length > 0) {
                    const colMatchesCached = cached
                        .filter(c => 
                            c.name.toLowerCase().includes(typedCol.toLowerCase()) || 
                            (c.comment && c.comment.toLowerCase().includes(typedCol.toLowerCase()))
                        )
                        .map(c => ({ label: c.name, comment: c.comment, value: c.name, type: 'column' as const }))
                        .sort((a, b) => a.label.localeCompare(b.label));
                    
                    if (colMatchesCached.length > 0) {
                        setSuggestions({ type: 'column', items: colMatchesCached, replacePrefix: typedCol });
                        return;
                    }
                }

                // 3. If not in ER and not cached, try to fetch (Live DB)
                if (!erTable && !cachedColumnsMetadata[realTableName.toUpperCase()] && !cachedColumnsMetadata[realTableName.toLowerCase()] && !pendingFetches.current.has(realTableName)) {
                    if (dbConfig) {
                        pendingFetches.current.add(realTableName);
                        setSuggestions({ 
                            type: 'column', 
                            items: [{ label: 'Loading columns...', value: '', type: 'column', comment: `Fetching ${realTableName} columns...` }], 
                            replacePrefix: typedCol 
                        });
                        
                        invoke<TableMetadata>('fetch_table_columns', {
                            config: dbConfig,
                            tableName: realTableName
                        }).then(result => {
                            setCachedColumnsMetadata(prev => ({ ...prev, [realTableName.toUpperCase()]: result.columns }));
                            pendingFetches.current.delete(realTableName);
                            if (textareaRef.current) {
                                triggerSuggestions(textareaRef.current.selectionStart);
                            }
                        }).catch(e => {
                            console.error(`Failed to fetch columns for ${realTableName}`, e);
                            pendingFetches.current.delete(realTableName);
                            setSuggestions(null);
                        });
                        return;
                    }
                }
                
                // If it's a dot completion, NEVER fall back to keywords
                setSuggestions(null);
                return;
            }
            
            if (!typed.includes('.') && !typed.startsWith('@')) {
                const filteredKeywords = KEYWORDS
                    .filter(k => k.startsWith(typed))
                    .map(k => ({ label: k, value: k, type: 'keyword' as const }));
                if (filteredKeywords.length > 0 && typed.length > 0) {
                    setSuggestions({ type: 'table', items: filteredKeywords, replacePrefix: typed });
                    setSelectedIndex(0);
                    return;
                }
            }
        }
        setSuggestions(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (suggestions) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((prev) => (prev + 1) % suggestions.items.length);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prev) => (prev - 1 + suggestions.items.length) % suggestions.items.length);
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                insertSuggestion(suggestions.items[selectedIndex].value);
                return;
            }
            if (e.key === 'Escape') {
                setSuggestions(null);
                return;
            }
        }

        // Ctrl+Space for autocomplete
        if (e.ctrlKey && e.code === 'Space') {
            e.preventDefault();
            triggerSuggestions(e.currentTarget.selectionStart);
            return;
        }

        if ((e.key === 'Enter' || e.key === 'r') && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            let executeText = sql;
            if (textareaRef.current) {
                const start = textareaRef.current.selectionStart;
                const end = textareaRef.current.selectionEnd;
                if (start !== end) {
                    executeText = sql.substring(start, end);
                }
            }
            handleExecute(0, executeText);
            return;
        }
    };

    const handleResultsKeyDown = (e: React.KeyboardEvent) => {
        if (!results || !activeCell) return;

        const maxR = results.rows.length - 1;
        const maxC = results.columns.length - 1;

        let { r, c } = activeCell;
        let newR = r;
        let newC = c;

        if (e.key === 'ArrowUp') newR = Math.max(0, r - 1);
        else if (e.key === 'ArrowDown') newR = Math.min(maxR, r + 1);
        else if (e.key === 'ArrowLeft') newC = Math.max(0, c - 1);
        else if (e.key === 'ArrowRight') newC = Math.min(maxC, c + 1);
        else if (e.key === ' ' && e.shiftKey) { // Shift+Space: Select row
            e.preventDefault();
            setSelectionBox({ r1: r, c1: 0, r2: r, c2: maxC });
            return;
        } else if (e.key === ' ' && e.ctrlKey) { // Ctrl+Space: Select col
            e.preventDefault();
            setSelectionBox({ r1: 0, c1: c, r2: maxR, c2: c });
            return;
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            setSelectionBox({ r1: 0, c1: 0, r2: maxR, c2: maxC });
            return;
        } else return;

        e.preventDefault();
        setActiveCell({ r: newR, c: newC });

        if (e.shiftKey && selectionBox) {
            const isFullRow = selectionBox.c1 === 0 && selectionBox.c2 === maxC;
            const isFullCol = selectionBox.r1 === 0 && selectionBox.r2 === maxR;

            if (isFullRow && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                setSelectionBox({ ...selectionBox, r2: newR, c2: maxC });
            } else if (isFullCol && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                setSelectionBox({ ...selectionBox, r2: maxR, c2: newC });
            } else {
                setSelectionBox({ ...selectionBox, r2: newR, c2: newC });
            }
        } else {
            setSelectionBox({ r1: newR, c1: newC, r2: newR, c2: newC });
        }

        // Scroll into view logic could be added here
    };

    const scrollToSuggestion = (index: number) => {
        if (!suggestionsRef.current) return;
        const container = suggestionsRef.current.querySelector('.suggestions-container');
        const item = container?.children[index] as HTMLElement;
        if (item && container) {
            const containerTop = container.scrollTop;
            const containerBottom = containerTop + container.clientHeight;
            const itemTop = item.offsetTop;
            const itemBottom = itemTop + item.clientHeight;

            if (itemTop < containerTop) {
                container.scrollTop = itemTop;
            } else if (itemBottom > containerBottom) {
                container.scrollTop = itemBottom - container.clientHeight;
            }
        }
    };

    const insertSuggestion = (suggestion: string) => {
        if (!suggestions) return;
        const textBeforeWord = sql.substring(0, cursorIdx - suggestions.replacePrefix.length);

        // Calculate suffix to replace (rest of the word after cursor)
        const after = sql.substring(cursorIdx);
        const suffixMatch = after.match(/^[\w$]+/);
        const suffixLength = suffixMatch ? suffixMatch[0].length : 0;
        const actualAfter = after.substring(suffixLength);

        let insertText = suggestion;
        if (suggestions.type === 'column') {
            const parts = suggestions.replacePrefix.split('.');
            if (parts.length > 1) {
                insertText = parts[0] + '.' + suggestion;
            }
        }

        if (suggestions.type === 'join' || suggestions.type === 'table') {
            insertText += ' ';
        }

        const newSql = textBeforeWord + insertText + actualAfter;
        updateActiveTab({ sql: newSql });
        setSuggestions(null);
        setPendingCursor(textBeforeWord.length + insertText.length);
        textareaRef.current?.focus();
    };

    // Tab Management
    const addNewTab = () => {
        addSqlTab();
    };

    const closeTab = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        removeSqlTab(id);
        // We now share the session, so we don't necessarily want to close the shared session when just one tab closes.
        // But if it was the last tab, maybe we should. For now, following user's shared session request.
        if (tabs.length === 1) {
            invoke('close_db_session').catch(console.error);
        }
    };

    // Column Resizer
    const handleColResizeStart = (e: React.MouseEvent, colName: string) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = colWidths[colName] || 150;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - startX;
            setColWidths(prev => ({
                ...prev,
                [colName]: Math.max(50, startWidth + deltaX) // Min width 50px
            }));
        };

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const handleCommit = async () => {
        if (!dbConfig || isGlobalExecuting) return;
        setIsGlobalExecuting(true);
        setIsLoading(true);
        try {
            await invoke('commit_transaction');
            const newLog: SqlLogEntry = {
                time: new Date().toLocaleTimeString(),
                sql: 'COMMIT;',
                durationMs: 0
            };
            updateActiveTab({
                logs: [newLog, ...(activeTab.logs || [])],
                activeBottomTab: 'logs',
                results: activeTab.results ? { ...activeTab.results, has_uncommitted_changes: false } : null
            });
        } catch (e) {
            updateActiveTab({ error: String(e) });
        } finally {
            setIsLoading(false);
            setIsGlobalExecuting(false);
        }
    };

    const handleRollback = async () => {
        if (!dbConfig || isGlobalExecuting) return;
        setIsGlobalExecuting(true);
        setIsLoading(true);
        try {
            await invoke('rollback_transaction');
            const newLog: SqlLogEntry = {
                time: new Date().toLocaleTimeString(),
                sql: 'ROLLBACK;',
                durationMs: 0
            };
            updateActiveTab({
                logs: [newLog, ...(activeTab.logs || [])],
                activeBottomTab: 'logs',
                results: activeTab.results ? { ...activeTab.results, has_uncommitted_changes: false } : null
            });
        } catch (e) {
            updateActiveTab({ error: String(e) });
        } finally {
            setIsLoading(false);
            setIsGlobalExecuting(false);
        }
    };


    return (
        <div className="flex flex-col h-full bg-neutral-900 text-neutral-200 overflow-hidden max-w-full relative">
            {isGlobalExecuting && (
                <div className="absolute top-0 left-0 w-full h-0.5 z-[100] bg-blue-500 overflow-hidden">
                    <div className="w-full h-full bg-blue-400 animate-progress origin-left"></div>
                </div>
            )}
            {/* Tabs Header */}
            <div className="flex items-center gap-1 px-4 py-2 border-b border-neutral-800 bg-neutral-900/50">
                {!isSidebarOpen && <div className="w-10"></div>}
                <div className="flex flex-1 overflow-x-auto custom-scrollbar">
                    {tabs.map(tab => (
                        <div
                            key={tab.id}
                            onClick={() => setActiveSqlTabId(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold border-r border-neutral-800 cursor-pointer min-w-[120px] max-w-[200px] select-none ${activeTabId === tab.id
                                ? 'bg-neutral-900 text-emerald-400 border-t-2 border-t-emerald-500'
                                : 'text-neutral-500 hover:bg-neutral-900/50 hover:text-neutral-300 border-t-2 border-t-transparent'
                                }`}
                        >
                            <Terminal size={12} className={activeTabId === tab.id ? 'text-emerald-500' : 'opacity-50'} />
                            <span className="truncate flex-1">{tab.name}</span>
                            {tabs.length > 1 && (
                                <button
                                    onClick={(e) => closeTab(e, tab.id)}
                                    className="p-0.5 rounded-sm hover:bg-neutral-700 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                    style={{ opacity: activeTabId === tab.id ? 1 : undefined }}
                                >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                </button>
                            )}
                        </div>
                    ))}
                    <button
                        onClick={addNewTab}
                        className="flex items-center justify-center px-4 py-2 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300 transition-colors"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
                    </button>
                </div>
            </div>

            <div className="flex-1 flex flex-col min-h-0 min-w-0 max-w-full">
                {/* Toolbar */}
                <div className="flex items-center justify-between p-3 border-b border-neutral-800 bg-neutral-900 shrink-0">
                    <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-800 rounded-lg border border-neutral-700">
                            <Terminal size={14} className="text-blue-400" />
                            <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">SQL Editor</span>
                        </div>
                        <button
                            onClick={handleFormatSql}
                            className="flex items-center gap-2 bg-neutral-700 hover:bg-neutral-600 transition-colors text-white px-4 py-1.5 rounded-lg text-sm font-bold"
                            title="Format SQL (Prettify)"
                        >
                            Format
                        </button>
                        <button
                            onClick={() => handleExecute()}
                            disabled={isGlobalExecuting}
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-bold transition-all shadow-lg active:scale-95 ${
                                isGlobalExecuting ? 'bg-neutral-800 text-neutral-600' : 'bg-blue-600 text-white hover:bg-blue-500 shadow-blue-900/20'
                            }`}
                            title="Execute SQL (Ctrl+R / Tab: Ctrl+Enter)"
                        >
                            <Play size={14} fill="currentColor" />
                            Execute
                        </button>

                        <button
                            onClick={handleExplain}
                            disabled={isGlobalExecuting}
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-bold transition-all shadow-lg active:scale-95 border ${
                                isGlobalExecuting ? 'bg-neutral-800 text-neutral-600 border-neutral-700' : 'bg-neutral-800 text-amber-400 border-amber-500/30 hover:bg-neutral-700'
                            }`}
                            title="Show Execution Plan"
                        >
                            <Terminal size={14} />
                            Explain
                        </button>
                        {dbConfig && (
                            <>
                                <div className="w-px h-6 bg-neutral-700 mx-1"></div>
                                <button
                                    onClick={handleCommit}
                                    disabled={isGlobalExecuting}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold transition-all shadow-lg ${
                                        activeTab.results?.has_uncommitted_changes 
                                        ? 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-emerald-900/20' 
                                        : 'bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-500/30'
                                    }`}
                                    title="Commit Transaction"
                                >
                                    Commit
                                </button>
                                <button
                                    onClick={handleRollback}
                                    disabled={isGlobalExecuting}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
                                        activeTab.results?.has_uncommitted_changes 
                                        ? 'bg-red-600 text-white hover:bg-red-500 shadow-xl shadow-red-900/20' 
                                        : 'bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-500/30'
                                    }`}
                                    title="Rollback Transaction"
                                >
                                    Rollback
                                </button>
                            </>
                        )}

                        <label className="flex items-center gap-2 text-xs text-neutral-400 hover:text-neutral-200 cursor-pointer transition-colors bg-neutral-800 px-3 py-1.5 rounded-lg border border-neutral-700">
                            <input
                                type="checkbox"
                                checked={useAliasForJoin}
                                onChange={(e) => setUseAliasForJoin(e.target.checked)}
                                className="rounded border-neutral-600 bg-neutral-900 text-blue-500 focus:ring-blue-500/50"
                            />
                            Use Alias for Auto-JOIN
                        </label>
                    </div>

                    <div className="flex items-center gap-2">
                        {dbConfig ? (
                            <button onClick={onOpenDbConnect} className={`text-[10px] px-3 py-1.5 rounded uppercase font-black transition-colors cursor-pointer flex items-center gap-1 border ${
                                dbConnectionStatus !== 'connected' 
                                    ? 'bg-red-500/10 hover:bg-red-500/20 text-red-500 border-red-500/20' 
                                    : activeTab.results?.has_uncommitted_changes
                                        ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-500 border-amber-500/40 shadow-lg shadow-amber-900/20'
                                        : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20'
                            }`}>
                                {dbConnectionStatus === 'connected' ? (
                                    activeTab.results?.has_uncommitted_changes ? (
                                        <><AlertCircle size={12} className="animate-pulse" /> UNCOMMITTED: {dbConfig.host}</>
                                    ) : (
                                        <>CONNECTED: {dbConfig.host}</>
                                    )
                                ) : (
                                    <><AlertCircle size={12} /> CONNECTION ERROR: {dbConfig.host}</>
                                )}
                            </button>
                        ) : (
                            <button onClick={onOpenDbConnect} className="text-[10px] bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-3 py-1.5 rounded uppercase font-black transition-colors cursor-pointer flex items-center gap-1">
                                <AlertCircle size={12} />
                                Click to Connect DB
                            </button>
                        )}
                    </div>
                </div>

                {/* Editor Area Area */}
                <div ref={containerRef} className="flex-1 flex flex-col min-h-0 min-w-0 max-w-full relative">
                    <div
                        className="relative p-2 bg-neutral-950 flex flex-col min-h-0"
                        style={{ height: `${editorHeightPercent}%` }}
                    >
                        <div className="relative w-full h-full rounded-md overflow-hidden">
                            <div
                                ref={overlayRef}
                                className="absolute inset-0 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words overflow-hidden pointer-events-none p-4 text-emerald-400/80"
                            >
                                {highlightSql(sql + (sql.endsWith('\n') ? ' ' : ''))}
                            </div>
                            <textarea
                                ref={textareaRef}
                                value={sql}
                                onChange={handleInputChange}
                                onKeyDown={handleKeyDown}
                                onScroll={handleScroll}
                                spellCheck={false}
                                placeholder="Type SQL here... (@table to search tables, alias. to search columns, type 'join ' for FKs)"
                                className="absolute inset-0 w-full h-full bg-transparent border-none outline-none resize-none font-mono text-sm leading-relaxed p-4 text-transparent caret-emerald-400 placeholder:text-neutral-700 m-0"
                            />
                        </div>

                        {suggestions && suggestions.items.length > 0 && (
                            <div
                                ref={suggestionsRef}
                                className="absolute z-50 w-auto min-w-[280px] max-w-lg bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-100"
                                style={{ top: suggestionPos.top + 24, left: suggestionPos.left }}
                            >
                                <div className="max-h-60 overflow-y-auto suggestions-container py-1 custom-scrollbar">
                                    {suggestions.items.map((item, index) => (
                                        <button
                                            key={`${item.value}-${index}`}
                                            onClick={() => insertSuggestion(item.value)}
                                            className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex flex-col gap-0.5 last:border-none ${index === selectedIndex ? 'bg-blue-600 text-white' : 'hover:bg-neutral-700'
                                                }`}
                                        >
                                            <div className="flex items-center gap-2">
                                                {item.type === 'table' && <Database size={12} className="opacity-50 shrink-0" />}
                                                {item.type === 'column' && <Columns size={12} className="opacity-50 shrink-0" />}
                                                {item.type === 'keyword' && <Terminal size={12} className="opacity-50 shrink-0" />}
                                                <span className="font-bold break-words whitespace-normal leading-tight">{item.label}</span>
                                            </div>
                                            {item.comment && (
                                                <div className={`text-[10px] ml-5 truncate opacity-70 ${index === selectedIndex ? 'text-blue-100' : 'text-neutral-400'}`}>
                                                    {item.comment}
                                                </div>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Resizer */}
                    <div
                        onMouseDown={startResize}
                        className="h-1.5 bg-neutral-800 hover:bg-blue-500 cursor-row-resize transition-colors opacity-50 relative z-10 hover:opacity-100 flex items-center justify-center group"
                    >
                        <div className="w-8 h-0.5 bg-neutral-600 rounded-full group-hover:bg-white transition-colors" />
                    </div>

                    {/* Results Area */}
                    <div
                        className="border-t border-neutral-800 bg-neutral-900 flex flex-col min-h-0 min-w-0 max-w-full"
                        style={{ height: `calc(${100 - editorHeightPercent}% - 6px)` }}
                    >
                        <div className="flex items-center justify-between p-3 border-b border-neutral-800 bg-neutral-800/30">
                            <div className="flex items-center gap-4">
                                <div className="flex items-center bg-neutral-900 rounded-lg p-1 border border-neutral-800">
                                    <button
                                        onClick={() => updateActiveTab({ activeBottomTab: 'results' })}
                                        className={`px-4 py-1 text-xs font-bold rounded-md transition-colors ${activeBottomTab === 'results' ? 'bg-neutral-800 text-emerald-400' : 'text-neutral-500 hover:text-neutral-300'}`}
                                    >
                                        Results
                                    </button>
                                    <button
                                        onClick={() => updateActiveTab({ activeBottomTab: 'logs' })}
                                        className={`px-4 py-1 text-xs font-bold rounded-md transition-colors flex items-center gap-2 ${activeBottomTab === 'logs' ? 'bg-neutral-800 text-emerald-400' : 'text-neutral-500 hover:text-neutral-300'}`}
                                    >
                                        Logs
                                        {(logs?.length || 0) > 0 && (
                                            <span className="bg-neutral-700 text-[10px] px-1.5 py-0.5 rounded-full text-white">{logs.length}</span>
                                        )}
                                    </button>
                                </div>

                                {activeBottomTab === 'results' && results?.total_count !== undefined && (
                                    <span className="bg-neutral-800 px-2 py-0.5 rounded text-[10px] font-black uppercase text-neutral-400 border border-neutral-700">
                                        Total: {results.total_count}
                                    </span>
                                )}
                            </div>

                            {activeBottomTab === 'results' && results && (results.total_count || 0) > 500 && (
                                <div className="flex items-center gap-2">
                                    <button
                                        disabled={offset === 0 || isLoading}
                                        onClick={() => handleExecute(Math.max(0, offset - 500))}
                                        className="p-1.5 hover:bg-neutral-700 rounded-md disabled:opacity-30 transition-colors"
                                    >
                                        <ChevronLeft size={16} />
                                    </button>
                                    <span className="text-xs font-mono text-neutral-500">
                                        Rows {offset + 1} - {Math.min(offset + 500, results.total_count || 0)}
                                    </span>
                                    <button
                                        disabled={!results.has_more || isLoading}
                                        onClick={() => handleExecute(offset + 500)}
                                        className="p-1.5 hover:bg-neutral-700 rounded-md disabled:opacity-30 transition-colors"
                                    >
                                        <ChevronRight size={16} />
                                    </button>
                                </div>
                            )}

                            {activeBottomTab === 'results' && results && (
                                <button
                                    onClick={() => updateActiveTab({ isTransposed: !isTransposed })}
                                    className={`ml-4 p-1.5 rounded-md transition-colors flex items-center gap-1.5 text-xs font-bold border ${isTransposed
                                        ? 'bg-blue-600 border-blue-500 text-white'
                                        : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700'
                                        }`}
                                    title="Transpose Results (Switch Rows & Columns)"
                                >
                                    <ArrowRightLeft size={14} />
                                    Transpose
                                </button>
                            )}
                        </div>

                        <div className="flex-1 min-h-0 bg-neutral-950 font-mono text-xs overflow-hidden flex flex-col relative w-full max-w-full">
                            {activeBottomTab === 'logs' ? (
                                <div className="overflow-auto w-full h-full custom-scrollbar p-4">
                                    {logs && logs.length > 0 ? (
                                        <div className="flex flex-col gap-4">
                                            {logs.map((log, i) => (
                                                <div key={i} className={`p-4 rounded-lg border flex flex-col gap-2 ${log.error ? 'bg-red-500/5 border-red-500/20' : 'bg-neutral-900/50 border-neutral-800'}`}>
                                                    <div className="flex items-center justify-between text-neutral-500 text-[10px] uppercase font-bold tracking-widest">
                                                        <span>{log.time}</span>
                                                        <div className="flex gap-4 items-center">
                                                            {log.rowsAffected !== undefined && (
                                                                <span className="text-emerald-500">{log.rowsAffected} rows affected</span>
                                                            )}
                                                            <span>{log.durationMs}ms</span>
                                                        </div>
                                                    </div>
                                                    <div className="whitespace-pre-wrap text-neutral-300 pointer-events-auto select-text font-mono">
                                                        {log.sql}
                                                    </div>
                                                    {log.error && (
                                                        <div className="text-red-400 font-bold mt-2 whitespace-pre-wrap flex items-start gap-2">
                                                            <AlertCircle size={14} className="mt-0.5 shrink-0" />
                                                            {log.error}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="h-full flex items-center justify-center text-neutral-600">No execution logs yet for this session.</div>
                                    )}
                                </div>
                            ) : error ? (
                                <div className="p-8 flex flex-col items-center text-center overflow-auto h-full">
                                    <div className="bg-red-500/10 p-4 rounded-full mb-4 shrink-0">
                                        <AlertCircle size={32} className="text-red-500" />
                                    </div>
                                    <h4 className="text-red-400 font-bold mb-2 uppercase tracking-wider shrink-0">Execution Error</h4>
                                    <p className="text-neutral-500 max-w-md whitespace-pre-wrap">{error}</p>
                                </div>
                            ) : results ? (
                                <ResultsTable
                                    results={results}
                                    offset={offset}
                                    isTransposed={isTransposed}
                                    colWidths={colWidths}
                                    onColResizeStart={handleColResizeStart}
                                    onCellMouseDown={handleCellMouseDown}
                                    onCellMouseEnter={handleCellMouseEnter}
                                    onCellMouseUp={handleCellMouseUp}
                                    onRowMouseDown={handleRowMouseDown}
                                    onRowMouseEnter={handleRowMouseEnter}
                                    onContextMenu={handleContextMenu}
                                    isCellSelected={isCellSelected}
                                    activeCell={activeCell}
                                    selectionBox={selectionBox}
                                    onKeyDown={handleResultsKeyDown}
                                />
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-neutral-700 opacity-50 grayscale">
                                    <Play size={48} className="mb-4" />
                                    <p className="font-bold uppercase tracking-widest text-sm">Write SQL & Execute to see results</p>
                                </div>
                            )}
                        </div>
                    </div>
                    {contextMenu && (
                        <div
                            className="context-menu fixed z-50 bg-neutral-800 border border-neutral-700 rounded-md shadow-xl py-1 text-xs text-neutral-300 min-w-[200px]"
                            style={{ top: contextMenu.y, left: contextMenu.x }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button onClick={() => executeContextMenuAction('copy')} className="w-full text-left px-4 py-1.5 hover:bg-blue-600 hover:text-white transition-colors">
                                Copy Value
                            </button>
                            <button onClick={() => executeContextMenuAction('where')} className="w-full text-left px-4 py-1.5 hover:bg-blue-600 hover:text-white transition-colors">
                                Copy as WHERE ...
                            </button>
                            <div className="h-px bg-neutral-700 my-1" />
                            <button onClick={() => executeContextMenuAction('insert')} disabled={contextMenu.rowIdx === null} className="w-full text-left px-4 py-1.5 hover:bg-emerald-600 hover:text-white transition-colors disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-neutral-300">
                                Generate INSERT
                            </button>
                            <button onClick={() => executeContextMenuAction('update')} disabled={contextMenu.rowIdx === null} className="w-full text-left px-4 py-1.5 hover:bg-emerald-600 hover:text-white transition-colors disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-neutral-300">
                                Generate UPDATE
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
