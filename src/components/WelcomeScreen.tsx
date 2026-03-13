import { PenTool, Database, FolderOpen, ArrowRight } from 'lucide-react';

interface WelcomeScreenProps {
    onStartDesign: () => void;
    onStartDbConnect: () => void;
    onOpenLocalFile: () => void;
}

export default function WelcomeScreen({ onStartDesign, onStartDbConnect, onOpenLocalFile }: WelcomeScreenProps) {
    return (
        <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-neutral-100 font-sans relative overflow-hidden">
            {/* Background Decoration */}
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10 max-w-2xl w-full p-8 flex flex-col items-center">
                <div className="flex items-center justify-center w-20 h-20 bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl mb-8">
                    <Database size={36} className="text-blue-500" />
                </div>

                <h1 className="text-4xl font-black tracking-tight mb-2">ER Diagram Designer</h1>
                <p className="text-neutral-400 text-center mb-12 max-w-md">
                    Choose your workspace mode to get started. You can design locally or connect directly to a live database.
                </p>

                <div className="grid grid-cols-2 gap-6 w-full max-w-xl mb-12">
                    <button
                        onClick={onStartDesign}
                        className="flex flex-col items-start p-6 bg-neutral-900 border border-neutral-800 hover:border-blue-500/50 rounded-2xl transition-all group hover:bg-neutral-800/80 text-left"
                    >
                        <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                            <PenTool size={24} className="text-blue-400" />
                        </div>
                        <h2 className="text-lg font-bold mb-2">Design Mode</h2>
                        <p className="text-xs text-neutral-500 leading-relaxed mb-4 flex-1">
                            Create ER diagrams from scratch or load a local project. Changes affect only your local canvas.
                        </p>
                        <div className="text-xs font-bold text-blue-400 flex items-center gap-1 mt-auto">
                            Start designing <ArrowRight size={12} className="group-hover:translate-x-1 transition-transform" />
                        </div>
                    </button>

                    <button
                        onClick={onStartDbConnect}
                        className="flex flex-col items-start p-6 bg-neutral-900 border border-neutral-800 hover:border-emerald-500/50 rounded-2xl transition-all group hover:bg-neutral-800/80 text-left"
                    >
                        <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                            <Database size={24} className="text-emerald-400" />
                        </div>
                        <h2 className="text-lg font-bold mb-2">Live DB Mode</h2>
                        <p className="text-xs text-neutral-500 leading-relaxed mb-4 flex-1">
                            Connect to a running database to generate the ER diagram and execute real-time SQL queries.
                        </p>
                        <div className="text-xs font-bold text-emerald-400 flex items-center gap-1 mt-auto">
                            Connect Database <ArrowRight size={12} className="group-hover:translate-x-1 transition-transform" />
                        </div>
                    </button>
                </div>

                <div className="flex items-center gap-2 text-sm text-neutral-500">
                    <span>Or open an existing project:</span>
                    <button
                        onClick={onOpenLocalFile}
                        className="flex items-center gap-2 px-4 py-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-600 rounded-lg transition-all font-bold text-white shadow-sm"
                    >
                        <FolderOpen size={16} />
                        Open File...
                    </button>
                </div>
            </div>
        </div>
    );
}
