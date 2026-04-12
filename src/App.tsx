import { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import DiagramCanvas from "./components/DiagramCanvas";
import { useErDiagram, useErSqlActions } from "./hooks/useErData";
import ImportModal from "./components/ImportModal";
import DbConnectionModal from "./components/DbConnectionModal";
import CategoryEditModal from './components/CategoryEditModal';
import HistoryView from './components/HistoryView';
import SettingsModal from './components/SettingsModal';
import SchemaChangeModal from './components/SchemaChangeModal';
import MetadataEditor from "./components/MetadataEditor";
import ExportOptionsModal from "./components/ExportOptionsModal";
import WelcomeScreen from "./components/WelcomeScreen";
import SqlEditor from "./components/SqlEditor";
import ForeignKeyModal from "./components/ForeignKeyModal";
import { DbObject } from "./components/Sidebar";
import { AppMode, AppView, CategoryMetadata, TableDisplayMode, DEFAULT_DATA_TYPES_CONFIG, ErDiagramData, DbConfig, TableMetadata } from "./types/er";
import { save, open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { generateFullDdl, generateDiffDdl, generateTableDdl } from "./utils/ddlGenerator";
import { ReactFlowProvider } from "@xyflow/react";
import { PanelLeftOpen } from "lucide-react";

const GlobalKeyboardShortcuts = ({ onSave, setCurrentView }: { onSave: () => void, setCurrentView: (v: AppView) => void }) => {
    const { addSqlTab } = useErSqlActions();
    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey)) {
                if (e.key.toLowerCase() === 's') {
                    e.preventDefault();
                    onSave();
                } else if (e.key.toLowerCase() === 'n') {
                    e.preventDefault();
                    addSqlTab();
                    setCurrentView('sql');
                }
            }
        };
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [onSave, setCurrentView, addSqlTab]);
    return null;
};

function App() {
  const [appMode, setAppMode] = useState<AppMode>('welcome');
  const [currentView, setCurrentView] = useState<AppView>('diagram');
  const [displayMode, setDisplayMode] = useState<TableDisplayMode>('compact');
  // State for Metadata double click routing
  const [initialMetadataTab, setInitialMetadataTab] = useState<'columns' | 'indices'>('columns');
  const [initialMetadataSearch, setInitialMetadataSearch] = useState<string>('');
  const {
    data, setData, addTables, clearTables, addCategory, updateCategory,
    setTablesForCategory, addTablesToCategory, updateTablePosition,
    updateCategoryPosition, addForeignKey, removeForeignKey, updateSettings
  } = useErDiagram();

  const [showImportModal, setShowImportModal] = useState(false);
  const [showDbModal, setShowDbModal] = useState(false);
  const [dbModalMode, setDbModalMode] = useState<'import' | 'connect'>('import');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showSchemaModal, setShowSchemaModal] = useState(false);
  const [schemaModalTarget, setSchemaModalTarget] = useState<string | undefined>(undefined);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [exportPrompt, setExportPrompt] = useState<'json' | 'sql_full' | null>(null);
  const [editingCategory, setEditingCategory] = useState<CategoryMetadata | undefined>(undefined);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dbConfig, setDbConfig] = useState<DbConfig | undefined>(undefined);
  const [dbConnectionStatus, setDbConnectionStatus] = useState<'connected' | 'error' | 'disconnected'>('disconnected');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [catalog, setCatalog] = useState<DbObject[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [showFkModal, setShowFkModal] = useState(false);

  useEffect(() => {
    invoke<string[]>('get_cmd_args').then(args => {
      const filePath = args.find(a => a.endsWith('.er'));
      if (filePath) {
        invoke<ErDiagramData>('load_er_file', { path: filePath })
          .then(loadedData => {
            setData(loadedData);
            setAppMode('design');
          })
          .catch(e => console.error("Failed to auto-load associated file:", e));
      }
    }).catch(console.error);
  }, []);

  const handleRefreshDb = async (overrideConfig?: DbConfig, forceLiveDbMode?: boolean) => {
    const configToUse = overrideConfig || dbConfig;
    if (!configToUse) return;
    try {
      const isLiveDb = forceLiveDbMode !== undefined ? forceLiveDbMode : (appMode === 'db');
      if (!isLiveDb) {
        const tables = await invoke<TableMetadata[]>('fetch_db_metadata', { config: configToUse });
        clearTables(); // Reset existing metadata before adding new one
        addTables(tables);
      } else {
        // In LiveDB mode, just fetch the catalog (table names etc)
        setIsLoadingCatalog(true);
        try {
          const startTime = Date.now();
          const cat = await invoke<DbObject[]>('fetch_db_catalog', { config: configToUse });
          const duration = Date.now() - startTime;
          window.dispatchEvent(new CustomEvent('add-sql-log', {
            detail: {
              sql: `(app) [Fetch Catalog]\n-- Backend executes DB-specific fetching queries:\n-- MySQL: SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()\n-- Postgres: SELECT tablename, 'TABLE' FROM pg_tables WHERE schemaname = current_schema()\n-- Oracle: SELECT OBJECT_NAME, OBJECT_TYPE FROM USER_OBJECTS`,
              duration_ms: duration,
              rows: cat.length,
              status: 'success'
            }
          }));
          setCatalog(cat);
        } finally {
          setIsLoadingCatalog(false);
        }
      }
      setDbConnectionStatus('connected');
    } catch (e) {
      console.error("Failed to refresh schema", e);
      setDbConnectionStatus('error');
      // Re-throw if we want the caller (modal) to handle it
      throw e;
    }
  };

  const handleSave = async () => {
    try {
      const path = await save({
        filters: [{ name: 'ER Diagram', extensions: ['er'] }],
        defaultPath: 'diagram.er'
      });
      if (path) {
        await invoke('save_er_file', { path, data });
        alert('Saved successfully!');
      }
    } catch (e) {
      alert(`Save failed: ${e} `);
    }
  };

  const handleLoad = async () => {
    try {
      const path = await open({
        filters: [{ name: 'ER Diagram', extensions: ['er'] }],
        multiple: false
      });
      if (path && typeof path === 'string') {
        const loadedData = await invoke<ErDiagramData>('load_er_file', { path });
        setData(loadedData);
        setAppMode('design');
      }
    } catch (e) {
      alert(`Load failed: ${e}`);
    }
  };

  const handleExportJson = () => {
    setExportPrompt('json');
  };

  const executeExportJson = async (isSplit: boolean) => {
    try {
      if (isSplit) {
        const dir = await open({ directory: true, multiple: false });
        if (dir && typeof dir === 'string') {
          for (const table of data.tables) {
            const tableJson = JSON.stringify(table, null, 2);
            await invoke('save_sql_file', { path: `${dir}/${table.name}.json`, content: tableJson });
          }
          alert(`Split JSON files exported successfully to ${dir}`);
        }
      } else {
        const jsonText = JSON.stringify(data.tables, null, 2);
        const path = await save({
          filters: [{ name: 'JSON', extensions: ['json'] }],
          defaultPath: `tables_export_${Date.now()}.json`
        });
        if (path) {
          await invoke('save_sql_file', { path, content: jsonText });
          alert('JSON exported successfully!');
        }
      }
    } catch (e) {
      console.error('Failed to export JSON:', e);
      alert('Failed to export JSON');
    }
  };

  const handleCreateCategory = () => {
    setEditingCategory(undefined);
    setShowCategoryModal(true);
  };

  const handleEditCategory = (cat: CategoryMetadata) => {
    setEditingCategory(cat);
    setShowCategoryModal(true);
  };

  const handleSaveCategory = (
    name: string,
    parentId: string | null,
    tableNames: string[],
    relatedCategoryIds: string[]
  ) => {
    const id = editingCategory?.id || crypto.randomUUID();

    if (editingCategory) {
      updateCategory(id, { name, parent_id: parentId, related_category_ids: relatedCategoryIds });
    } else {
      addCategory({ id, name, parent_id: parentId, related_category_ids: relatedCategoryIds, x: 0, y: 0 });
    }

    setTablesForCategory(id, tableNames);
    setShowCategoryModal(false);
  };

  const handleExportSql = async (type: 'full' | 'diff') => {
    if (type === 'full') {
      setExportPrompt('sql_full');
      return;
    }

    try {
      const sql = generateDiffDdl(data);
      const path = await save({
        filters: [{ name: 'SQL', extensions: ['sql'] }],
        defaultPath: `schema_diff_${Date.now()}.sql`
      });

      if (path) {
        await invoke('save_sql_file', { path, content: sql });
        alert('SQL exported successfully!');
      }
    } catch (error) {
      console.error('Failed to export diff SQL:', error);
      alert('Failed to export SQL');
    }
  };

  const executeExportSqlFull = async (isSplit: boolean) => {
    try {
      if (isSplit) {
        const dir = await open({ directory: true, multiple: false });
        if (dir && typeof dir === 'string') {
          for (const table of data.tables) {
            const tableDdl = `-- Table DDL Generated on ${new Date().toLocaleString()}\n\n` + generateTableDdl(table);
            await invoke('save_sql_file', { path: `${dir}/${table.name}.sql`, content: tableDdl });
          }
          alert(`Split SQL files exported successfully to ${dir}`);
        }
        return;
      }

      const sql = generateFullDdl(data);
      const path = await save({
        filters: [{ name: 'SQL', extensions: ['sql'] }],
        defaultPath: `schema_full_${Date.now()}.sql`
      });

      if (path) {
        await invoke('save_sql_file', { path, content: sql });
        alert('SQL exported successfully!');
      }
    } catch (error) {
      console.error('Failed to export full SQL:', error);
      alert('Failed to export SQL');
    }
  };

  const handleExportConfirm = (isSplit: boolean) => {
    const type = exportPrompt;
    setExportPrompt(null);
    if (type === 'json') {
      executeExportJson(isSplit);
    } else if (type === 'sql_full') {
      executeExportSqlFull(isSplit);
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-900 text-neutral-100 font-sans">
      <GlobalKeyboardShortcuts onSave={handleSave} setCurrentView={setCurrentView} />
      {appMode === 'welcome' && (
        <WelcomeScreen
          onStartDesign={() => setAppMode('design')}
          onStartDbConnect={() => { setDbModalMode('connect'); setShowDbModal(true); }}
          onOpenLocalFile={handleLoad}
        />
      )}

      {appMode !== 'welcome' && !isSidebarOpen && (
        <div className="absolute top-2 left-2 z-50">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-1.5 bg-neutral-800/90 backdrop-blur-md rounded-lg hover:bg-neutral-700 text-neutral-400 border border-neutral-700 shadow-xl transition-all"
            title="Open Sidebar"
          >
            <PanelLeftOpen size={18} />
          </button>
        </div>
      )}

      {appMode !== 'welcome' && isSidebarOpen && (
        <Sidebar
          currentView={appMode === 'db' ? 'sql' : currentView}
          setCurrentView={setCurrentView}
          displayMode={displayMode}
          setDisplayMode={setDisplayMode}
          data={data}
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={setSelectedCategoryId}
          onOpenImport={() => setShowImportModal(true)}
          onOpenDbConnect={() => { setDbModalMode(appMode === 'db' ? 'connect' : 'import'); setShowDbModal(true); }}
          onCreateCategory={handleCreateCategory}
          onEditCategory={handleEditCategory}
          onExportSql={handleExportSql}
          onExportJson={handleExportJson}
          onOpenSettings={() => setShowSettingsModal(true)}
          onOpenFkModal={() => setShowFkModal(true)}
          onToggle={() => setIsSidebarOpen(false)}
          appMode={appMode}
          dbConfig={dbConfig}
          dbConnectionStatus={dbConnectionStatus}
          onRefreshDb={() => handleRefreshDb()}
          catalog={catalog}
          isLoadingCatalog={isLoadingCatalog}
        />
      )}

      {appMode !== 'welcome' && (
        <div className="flex-1 relative min-w-0">
          <ReactFlowProvider>
            {appMode !== 'db' && (
              <div className={`h-full w-full ${currentView === 'diagram' ? 'block' : 'hidden'}`}>
                <DiagramCanvas
                  displayMode={displayMode}
                  data={data}
                  selectedCategoryId={selectedCategoryId}
                  onSelectCategory={setSelectedCategoryId}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={setSelectedNodeId}
                  onUpdateTablePosition={updateTablePosition}
                  onUpdateCategoryPosition={updateCategoryPosition}
                  onEditCategory={handleEditCategory}
                  addTablesToCategory={addTablesToCategory}
                  addForeignKey={addForeignKey}
                  removeForeignKey={removeForeignKey}
                  onTableDoubleClick={(tableName) => {
                    setInitialMetadataTab('columns');
                    setInitialMetadataSearch(tableName);
                    setCurrentView('metadata');
                  }}
                />
              </div>
            )}

            <div className={`h-full w-full ${currentView === 'history' ? 'block' : 'hidden'}`}>
              <HistoryView data={data} />
            </div>

            <div className={`h-full w-full ${currentView === 'metadata' ? 'block' : 'hidden'}`}>
              <MetadataEditor
                data={data}
                dbConfig={dbConfig}
                initialTab={initialMetadataTab}
                initialSearch={initialMetadataSearch}
                onShowInEr={(tableName: string | undefined) => {
                  if (tableName) {
                    setSelectedNodeId(tableName);
                    setCurrentView('diagram');
                  }
                }}
                onOpenSchemaChange={(tableName: string | undefined) => {
                  setSchemaModalTarget(tableName);
                  setShowSchemaModal(true);
                }}
                onSwitchToSql={() => setCurrentView('sql')}
                appMode={appMode}
              />
            </div>

            <div className={`h-full w-full ${currentView === 'sql' ? 'block' : 'hidden'}`}>
              <SqlEditor
                data={data}
                dbConfig={dbConfig}
                dbConnectionStatus={dbConnectionStatus}
                onConnectionStatusChange={setDbConnectionStatus}
                onOpenDbConnect={() => { setDbModalMode('connect'); setShowDbModal(true); }}
                isSidebarOpen={isSidebarOpen}
                catalog={catalog}
              />
            </div>
          </ReactFlowProvider>

          {showSettingsModal && (
            <SettingsModal onClose={() => setShowSettingsModal(false)} />
          )}

          {showSchemaModal && (
            <SchemaChangeModal
              onClose={() => setShowSchemaModal(false)}
              initialTarget={schemaModalTarget}
            />
          )}

          {/* Action Bar has been moved to Sidebar */}

          {exportPrompt && (
            <ExportOptionsModal
              type={exportPrompt}
              onClose={() => setExportPrompt(null)}
              onConfirm={handleExportConfirm}
            />
          )}
        </div>
      )}

      {showImportModal && (
        <ImportModal
          onClose={() => setShowImportModal(false)}
          onImport={(tables) => {
            clearTables(); // Reset existing metadata
            addTables(tables);

            // Auto append new data types from CSV
            const importedTypes = new Set<string>();
            tables.forEach(table => {
              table.columns.forEach(col => {
                const dt = (col.data_type || '').trim();
                if (dt) importedTypes.add(dt);
              });
            });

            const currentTypes = data.settings?.availableDataTypesConfigs || DEFAULT_DATA_TYPES_CONFIG;
            const newTypesList = [...currentTypes];
            let hasNew = false;

            importedTypes.forEach(t => {
              if (!newTypesList.some(existing => existing.name.toLowerCase() === t.toLowerCase())) {
                newTypesList.push({ name: t, mysql: true, postgres: true, oracle: true });
                hasNew = true;
              }
            });

            if (hasNew) {
              updateSettings({ availableDataTypesConfigs: newTypesList });
            }

            setSelectedCategoryId('all');
            setCurrentView('diagram');
          }}
        />
      )}

      {showDbModal && (
        <DbConnectionModal
          mode={dbModalMode}
          onClose={() => setShowDbModal(false)}
          onImport={async (tables, config) => {
            clearTables(); // Reset existing metadata
            addTables(tables);
            setDbConfig(config);
            setSelectedCategoryId('all');
            setCurrentView('sql');
          }}
          onConnect={async (config) => {
            // Wait for success before changing mode/closing modal
            await handleRefreshDb(config, true);
            
            setDbConfig(config);
            setAppMode('db');
            setCurrentView('sql');
          }}
        />
      )}

      {showCategoryModal && (
        <CategoryEditModal
          category={editingCategory}
          allCategories={data.categories}
          allTables={data.tables}
          onClose={() => setShowCategoryModal(false)}
          onSave={handleSaveCategory}
        />
      )}

      {showFkModal && (
        <ForeignKeyModal
          isOpen={showFkModal}
          onClose={() => setShowFkModal(false)}
          tables={data.tables}
          onAddForeignKey={addForeignKey}
          initialSourceTable={selectedNodeId || undefined}
        />
      )}
    </div>
  );
}

export default App;

