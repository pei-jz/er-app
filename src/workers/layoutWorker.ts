import dagre from 'dagre';

self.onmessage = (e: MessageEvent) => {
    const { nodes, connections, displayMode } = e.data;

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', align: 'UL', edgesep: 30, ranksep: 90, nodesep: 150 });
    g.setDefaultEdgeLabel(() => ({}));

    const connectedTableNames = new Set<string>();
    connections.forEach((conn: any) => {
        connectedTableNames.add(conn.srcTable);
        connectedTableNames.add(conn.tgtTable);
    });

    nodes.forEach((t: any) => {
        if (connectedTableNames.has(t.name)) {
            const width = displayMode === 'compact' ? 250 : 300;
            const height = displayMode === 'compact' 
                ? (t.columns.filter((c: any) => c.is_primary_key || c.is_foreign_key).length * 25 + 60) 
                : (t.columns.length * 25 + 60);
            g.setNode(t.name, { width, height });
        }
    });

    connections.forEach((conn: any) => {
        g.setEdge(conn.tgtTable, conn.srcTable);
    });

    dagre.layout(g);

    const positions = new Map<string, { x: number, y: number }>();
    let maxX = 0;
    let maxY = 0;

    g.nodes().forEach(v => {
        const nodeWithPos = g.node(v);
        if (nodeWithPos) {
            positions.set(v, { x: nodeWithPos.x, y: nodeWithPos.y });
            maxX = Math.max(maxX, nodeWithPos.x + nodeWithPos.width);
            maxY = Math.max(maxY, nodeWithPos.y + nodeWithPos.height);
        }
    });

    // Handle isolated tables
    let isoCursorX = maxX > 0 ? maxX + 50 : 0;
    let isoCursorY = 0;
    const maxIsoY = maxY > 0 ? Math.max(maxY, 800) : 800;

    nodes.forEach((t: any) => {
        if (!connectedTableNames.has(t.name)) {
            const width = displayMode === 'compact' ? 250 : 300;
            const height = displayMode === 'compact' 
                ? (t.columns.filter((c: any) => c.is_primary_key || c.is_foreign_key).length * 25 + 60) 
                : (t.columns.length * 25 + 60);
            positions.set(t.name, { x: isoCursorX, y: isoCursorY });
            isoCursorY += height + 20;
            if (isoCursorY > maxIsoY) {
                isoCursorY = 0;
                isoCursorX += width + 30;
            }
        }
    });

    // Convert Map to Object for serialization
    const result: Record<string, { x: number, y: number }> = {};
    positions.forEach((pos, id) => {
        result[id] = pos;
    });

    self.postMessage(result);
};
