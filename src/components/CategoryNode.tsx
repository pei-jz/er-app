import { Handle, Position } from '@xyflow/react';
import { Folder, Map, Maximize2 } from 'lucide-react';

interface CategoryNodeProps {
    data: {
        name: string;
        onDrillDown?: () => void;
        onEdit?: () => void;
    };
}

const CategoryNode: React.FC<CategoryNodeProps> = ({ data }) => {
    return (
        <div
            onDoubleClick={(e) => {
                e.stopPropagation();
                data.onEdit?.();
            }}
            className="bg-yellow-500/10 border-2 border-dashed border-yellow-500/30 rounded-3xl p-6 min-w-[300px] min-h-[200px] flex flex-col items-center justify-center relative group hover:border-yellow-500/60 transition-all cursor-pointer"
        >
            {/* Background Icon */}
            <Map className="absolute inset-0 m-auto text-yellow-500/5 -z-10" size={120} />

            <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-yellow-500/20 flex items-center justify-center text-yellow-500 group-hover:scale-110 transition-transform shadow-lg shadow-yellow-900/10">
                    <Folder size={24} />
                </div>
                <div className="text-center">
                    <h3 className="text-sm font-black text-yellow-500 uppercase tracking-widest">{data.name}</h3>
                    <p className="text-[10px] text-neutral-500 font-bold mt-1">Category Area</p>
                </div>
            </div>

            {/* Drill Down Button */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    data.onDrillDown?.();
                }}
                className="mt-6 flex items-center gap-2 px-4 py-2 bg-yellow-500 rounded-xl text-neutral-900 text-xs font-black shadow-lg shadow-yellow-900/20 hover:bg-yellow-400 active:scale-95 transition-all opacity-0 group-hover:opacity-100"
            >
                <Maximize2 size={14} />
                Explore Area
            </button>

            {/* Handles for connections if needed */}
            <Handle type="target" position={Position.Top} className="!opacity-0" />
            <Handle type="source" position={Position.Bottom} className="!opacity-0" />
        </div>
    );
};

export default CategoryNode;
