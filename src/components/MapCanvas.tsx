import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { Tag, TagRelation } from '../types';
import { getTagColor } from '../lib/tagColors';

interface MapCanvasProps {
  tags: Tag[];
  tagRelations: TagRelation[];
  activeTagId: string | null;
  onSelectTag: (id: string | null) => void;
  onCreateRelation: (sourceId: string, targetId: string) => void;
  onDeleteRelation: (id: string) => void;
  onUpdateRelationLabel: (id: string, label: string) => void;
  onDeleteTag: (id: string) => void;
  onRenameTag: (id: string, label: string) => void;
}

interface NodePopup {
  id: string;
  x: number;
  y: number;
}

interface EdgePopup {
  id: string;
  label: string;
  x: number;
  y: number;
}

interface RenameState {
  id: string;
  label: string;
  x: number;
  y: number;
}

// Stable D3 node with position cache
interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  colorKey: number;
}

const NODE_RADIUS = 22;
const HANDLE_RADIUS = 32;

export default function MapCanvas({
  tags,
  tagRelations,
  activeTagId,
  onSelectTag,
  onCreateRelation,
  onDeleteRelation,
  onUpdateRelationLabel,
  onDeleteTag,
  onRenameTag,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, undefined> | null>(null);
  const positionCacheRef = useRef<Map<string, { x: number; y: number; fx?: number; fy?: number }>>(new Map());
  const drawingFromRef = useRef<string | null>(null);

  const [nodePopup, setNodePopup] = useState<NodePopup | null>(null);
  const [edgePopup, setEdgePopup] = useState<EdgePopup | null>(null);
  const [renaming, setRenaming] = useState<RenameState | null>(null);

  const clearPopups = useCallback(() => {
    setNodePopup(null);
    setEdgePopup(null);
    setRenaming(null);
  }, []);

  useEffect(() => {
    const svg = d3.select(svgRef.current!);
    const container = containerRef.current!;
    const width = container.clientWidth;
    const height = container.clientHeight;

    svg.selectAll('*').remove();

    if (tags.length === 0) return;

    // ── Simulation nodes (preserve cached positions) ──────────────────────────
    const simNodes: SimNode[] = tags.map(tag => {
      const cached = positionCacheRef.current.get(tag.id);
      return {
        id: tag.id,
        label: tag.label,
        colorKey: tag.colorKey,
        x: cached?.x ?? width / 2 + (Math.random() - 0.5) * 120,
        y: cached?.y ?? height / 2 + (Math.random() - 0.5) * 120,
        fx: cached?.fx,
        fy: cached?.fy,
      };
    });

    const simLinks = tagRelations.map(r => ({
      ...r,
      source: r.sourceId,
      target: r.targetId,
    }));

    // ── SVG setup ─────────────────────────────────────────────────────────────
    svg.attr('width', width).attr('height', height);

    // Subtle dot-grid background
    const defs = svg.append('defs');
    const patternId = 'dot-grid';
    const pattern = defs.append('pattern')
      .attr('id', patternId)
      .attr('width', 24)
      .attr('height', 24)
      .attr('patternUnits', 'userSpaceOnUse');
    pattern.append('circle')
      .attr('cx', 12).attr('cy', 12).attr('r', 1)
      .attr('fill', '#E5E2DD');
    svg.append('rect')
      .attr('width', width).attr('height', height)
      .attr('fill', `url(#${patternId})`)
      .on('click', () => { onSelectTag(null); clearPopups(); });

    // Arrow marker
    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', NODE_RADIUS + 10)
      .attr('refY', 0)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('fill', '#94A3B8')
      .attr('d', 'M0,-5L10,0L0,5');

    // Ghost edge line (hidden until edge drawing starts)
    const ghostLine = svg.append('line')
      .attr('class', 'ghost-edge')
      .attr('stroke', '#94A3B8')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '5,4')
      .attr('pointer-events', 'none')
      .style('display', 'none');

    // ── Links layer ────────────────────────────────────────────────────────────
    const linkGroup = svg.append('g').attr('class', 'links');

    const linkGs = linkGroup.selectAll<SVGGElement, typeof simLinks[0]>('g')
      .data(simLinks, (d: any) => d.id)
      .join('g')
      .attr('class', 'link-group')
      .style('cursor', 'pointer')
      .on('click', function(event, d) {
        event.stopPropagation();
        const x = (((d.source as SimNode).x ?? 0) + ((d.target as SimNode).x ?? 0)) / 2;
        const y = (((d.source as SimNode).y ?? 0) + ((d.target as SimNode).y ?? 0)) / 2;
        setEdgePopup({ id: d.id, label: d.label, x, y });
        setNodePopup(null);
        setRenaming(null);
      });

    linkGs.append('line')
      .attr('class', 'link-line')
      .attr('stroke', '#CBD5E1')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3')
      .attr('marker-end', 'url(#arrow)');

    // Wider invisible hit target for edge clicks
    linkGs.append('line')
      .attr('class', 'link-hit')
      .attr('stroke', 'transparent')
      .attr('stroke-width', 12);

    linkGs.append('text')
      .attr('class', 'link-label')
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('font-family', 'Inter, ui-sans-serif, system-ui, sans-serif')
      .attr('fill', '#94A3B8')
      .attr('letter-spacing', '0.05em')
      .attr('pointer-events', 'none');

    // ── Nodes layer ────────────────────────────────────────────────────────────
    const nodeGroup = svg.append('g').attr('class', 'nodes');

    const nodeGs = nodeGroup.selectAll<SVGGElement, SimNode>('g')
      .data(simNodes, (d: any) => d.id)
      .join('g')
      .attr('class', 'node-group')
      .style('cursor', 'pointer');

    // Outer handle ring (visible on hover, drag to create edge)
    nodeGs.append('circle')
      .attr('class', 'handle-ring')
      .attr('r', HANDLE_RADIUS)
      .attr('fill', 'transparent')
      .attr('stroke', 'transparent')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4,3');

    // Inner node circle
    nodeGs.append('circle')
      .attr('class', 'node-circle')
      .attr('r', NODE_RADIUS)
      .attr('fill', (d) => getTagColor(d.colorKey).bg)
      .attr('stroke', (d) => getTagColor(d.colorKey).border)
      .attr('stroke-width', 1.5)
      .attr('opacity', (d) => activeTagId && d.id !== activeTagId ? 0.35 : 1);

    // Center dot
    nodeGs.append('circle')
      .attr('class', 'node-dot')
      .attr('r', 3)
      .attr('fill', (d) => getTagColor(d.colorKey).dot)
      .attr('pointer-events', 'none');

    // Label
    nodeGs.append('text')
      .attr('class', 'node-label')
      .attr('text-anchor', 'middle')
      .attr('dy', NODE_RADIUS + 14)
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .attr('fill', '#374151')
      .attr('font-family', 'Inter, ui-sans-serif, system-ui, sans-serif')
      .attr('letter-spacing', '0.03em')
      .attr('pointer-events', 'none')
      .text((d) => d.label);

    // ── Interactions ──────────────────────────────────────────────────────────

    // SVG-level mouse tracking for ghost line
    svg.on('mousemove', function(event) {
      if (!drawingFromRef.current) return;
      const [mx, my] = d3.pointer(event);
      ghostLine.attr('x2', mx).attr('y2', my);
    });

    svg.on('mouseup', function() {
      if (!drawingFromRef.current) return;
      ghostLine.style('display', 'none');
      drawingFromRef.current = null;
      nodeGs.select('.handle-ring')
        .attr('stroke', 'transparent')
        .attr('stroke-dasharray', '4,3');
    });

    // Hover on nodes while drawing edge
    nodeGs.on('mouseenter', function(event, d) {
      if (drawingFromRef.current && drawingFromRef.current !== d.id) {
        d3.select(this).select('.node-circle')
          .attr('stroke-width', 3);
      }
      // Show handle ring
      if (!drawingFromRef.current) {
        d3.select(this).select('.handle-ring')
          .attr('stroke', getTagColor(d.colorKey).border)
          .attr('stroke-opacity', 0.5);
      }
    });

    nodeGs.on('mouseleave', function(event, d) {
      if (!drawingFromRef.current) {
        d3.select(this).select('.node-circle').attr('stroke-width', 1.5);
      }
      d3.select(this).select('.handle-ring').attr('stroke', 'transparent');
    });

    // Node click — select tag
    nodeGs.on('click', function(event, d) {
      event.stopPropagation();
      onSelectTag(d.id === activeTagId ? null : d.id);
      const x = d.x ?? 0;
      const y = d.y ?? 0;
      setNodePopup({ id: d.id, x, y });
      setEdgePopup(null);
      setRenaming(null);
    });

    // Double-click node — rename
    nodeGs.on('dblclick', function(event, d) {
      event.stopPropagation();
      setRenaming({ id: d.id, label: d.label, x: d.x ?? 0, y: d.y ?? 0 });
      setNodePopup(null);
    });

    // Move drag (inner circle)
    const moveDrag = d3.drag<SVGGElement, SimNode>()
      .filter(function(event) {
        // Only activate on the inner circle area
        const r = Math.hypot(
          event.offsetX - (this.getBoundingClientRect().left + NODE_RADIUS - containerRef.current!.getBoundingClientRect().left),
          event.offsetY - (this.getBoundingClientRect().top + NODE_RADIUS - containerRef.current!.getBoundingClientRect().top)
        );
        return true; // We'll differentiate by distance below
      })
      .on('start', function(event, d) {
        // Start edge drawing if pointer is in the outer ring
        const svgPoint = d3.pointer(event, svgRef.current!);
        const dx = svgPoint[0] - (d.x ?? 0);
        const dy = svgPoint[1] - (d.y ?? 0);
        const dist = Math.hypot(dx, dy);

        if (dist > NODE_RADIUS + 2) {
          // Edge creation mode
          drawingFromRef.current = d.id;
          ghostLine
            .attr('x1', d.x ?? 0).attr('y1', d.y ?? 0)
            .attr('x2', d.x ?? 0).attr('y2', d.y ?? 0)
            .style('display', null);
          return;
        }

        // Node move mode
        if (!event.active) simulationRef.current?.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
        clearPopups();
      })
      .on('drag', function(event, d) {
        if (drawingFromRef.current) return; // edge drawing handled by svg mousemove
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', function(event, d) {
        if (drawingFromRef.current) {
          // Find if released over a node
          const target = simNodes.find(n => {
            const dx = (n.x ?? 0) - event.x;
            const dy = (n.y ?? 0) - event.y;
            return n.id !== d.id && Math.hypot(dx, dy) < NODE_RADIUS + 8;
          });
          if (target) {
            onCreateRelation(drawingFromRef.current, target.id);
          }
          ghostLine.style('display', 'none');
          drawingFromRef.current = null;
          nodeGs.select('.node-circle').attr('stroke-width', 1.5);
        } else {
          if (!event.active) simulationRef.current?.alphaTarget(0);
          d.fx = event.x;
          d.fy = event.y;
          positionCacheRef.current.set(d.id, { x: d.x!, y: d.y!, fx: event.x, fy: event.y });
        }
      });

    nodeGs.call(moveDrag);

    // ── Force simulation ───────────────────────────────────────────────────────
    const simulation = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink(simLinks).id((d: any) => d.id).distance(130).strength(0.4))
      .force('charge', d3.forceManyBody().strength(-320))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(0.05))
      .force('collide', d3.forceCollide(HANDLE_RADIUS + 8))
      .alphaDecay(0.028);

    simulationRef.current = simulation;

    simulation.on('tick', () => {
      linkGs.each(function(d) {
        const sx = (d.source as SimNode).x ?? 0;
        const sy = (d.source as SimNode).y ?? 0;
        const tx = (d.target as SimNode).x ?? 0;
        const ty = (d.target as SimNode).y ?? 0;

        d3.select(this).selectAll('.link-line, .link-hit')
          .attr('x1', sx).attr('y1', sy)
          .attr('x2', tx).attr('y2', ty);

        d3.select(this).select('.link-label')
          .attr('x', (sx + tx) / 2)
          .attr('y', (sy + ty) / 2 - 6)
          .text(d.label || '');
      });

      nodeGs.attr('transform', (d: SimNode) => `translate(${d.x},${d.y})`);

      simNodes.forEach(n => {
        if (!positionCacheRef.current.has(n.id) || n.vx !== 0 || n.vy !== 0) {
          positionCacheRef.current.set(n.id, {
            x: n.x!,
            y: n.y!,
            fx: n.fx ?? undefined,
            fy: n.fy ?? undefined,
          });
        }
      });
    });

    return () => {
      simulation.stop();
    };
  }, [tags, tagRelations, activeTagId]);

  // Re-apply active dim when activeTagId changes without full redraw
  useEffect(() => {
    if (!svgRef.current) return;
    d3.select(svgRef.current).selectAll('.node-circle')
      .attr('opacity', function(this: SVGCircleElement) {
        const d = d3.select(this.parentNode as Element).datum() as SimNode;
        return activeTagId && d.id !== activeTagId ? 0.35 : 1;
      });
  }, [activeTagId]);

  const getNodePos = (id: string) => positionCacheRef.current.get(id);

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[#FAFAF8]">
      <svg ref={svgRef} className="w-full h-full" />

      {/* Empty state */}
      {tags.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
          <div className="w-10 h-10 mb-4 rounded-full border border-dashed border-[#D1CEC9] flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5">
              <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">No tags yet</p>
          <p className="text-[11px] text-gray-400 mt-1">Add a tag above to start mapping</p>
        </div>
      )}

      {/* Node popup */}
      {nodePopup && (() => {
        const pos = getNodePos(nodePopup.id);
        if (!pos) return null;
        const tag = tags.find(t => t.id === nodePopup.id);
        if (!tag) return null;
        const px = Math.min(Math.max(pos.x, 70), (containerRef.current?.clientWidth ?? 300) - 70);
        const py = pos.y < 60 ? pos.y + NODE_RADIUS + 16 : pos.y - NODE_RADIUS - 56;
        return (
          <div
            className="absolute z-20 bg-white border border-[#E5E2DD] rounded-lg shadow-lg flex overflow-hidden"
            style={{ left: px - 64, top: py, minWidth: 128 }}
            onClick={e => e.stopPropagation()}
          >
            <button
              className="flex-1 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:bg-[#F9F7F4] hover:text-[#1A1A1A] transition-colors"
              onClick={() => {
                const p = getNodePos(nodePopup.id);
                setRenaming({ id: nodePopup.id, label: tag.label, x: p?.x ?? 0, y: p?.y ?? 0 });
                setNodePopup(null);
              }}
            >
              Rename
            </button>
            <div className="w-[1px] bg-[#E5E2DD]" />
            <button
              className="flex-1 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-red-400 hover:bg-red-50 transition-colors"
              onClick={() => { onDeleteTag(nodePopup.id); clearPopups(); }}
            >
              Delete
            </button>
          </div>
        );
      })()}

      {/* Rename overlay */}
      {renaming && (() => {
        const pos = getNodePos(renaming.id);
        if (!pos) return null;
        const px = Math.min(Math.max(pos.x, 80), (containerRef.current?.clientWidth ?? 300) - 80);
        const py = pos.y < 60 ? pos.y + NODE_RADIUS + 16 : pos.y - NODE_RADIUS - 52;
        return (
          <form
            className="absolute z-20 bg-white border border-[#1A1A1A] rounded-lg shadow-lg flex overflow-hidden"
            style={{ left: px - 80, top: py, width: 160 }}
            onSubmit={e => {
              e.preventDefault();
              if (renaming.label.trim()) onRenameTag(renaming.id, renaming.label);
              clearPopups();
            }}
          >
            <input
              autoFocus
              value={renaming.label}
              onChange={e => setRenaming({ ...renaming, label: e.target.value })}
              onKeyDown={e => { if (e.key === 'Escape') clearPopups(); }}
              className="flex-1 px-3 py-2 text-xs outline-none bg-transparent"
            />
            <button type="submit" className="px-3 py-2 text-[10px] font-bold text-[#1A1A1A] border-l border-[#E5E2DD] hover:bg-[#F9F7F4]">
              ↵
            </button>
          </form>
        );
      })()}

      {/* Edge popup */}
      {edgePopup && (() => {
        const rel = tagRelations.find(r => r.id === edgePopup.id);
        if (!rel) return null;
        const src = positionCacheRef.current.get(rel.sourceId);
        const tgt = positionCacheRef.current.get(rel.targetId);
        if (!src || !tgt) return null;
        const mx = (src.x + tgt.x) / 2;
        const my = (src.y + tgt.y) / 2;
        const px = Math.min(Math.max(mx, 90), (containerRef.current?.clientWidth ?? 300) - 90);
        const py = Math.min(Math.max(my - 52, 8), (containerRef.current?.clientHeight ?? 300) - 60);
        return (
          <div
            className="absolute z-20 bg-white border border-[#E5E2DD] rounded-lg shadow-lg overflow-hidden"
            style={{ left: px - 90, top: py, width: 180 }}
            onClick={e => e.stopPropagation()}
          >
            <input
              autoFocus
              value={edgePopup.label}
              onChange={e => {
                const label = e.target.value;
                setEdgePopup({ ...edgePopup, label });
                onUpdateRelationLabel(edgePopup.id, label);
              }}
              placeholder="Relation label…"
              className="w-full px-3 py-2 text-xs outline-none bg-transparent border-b border-[#E5E2DD] placeholder-gray-400"
            />
            <button
              className="w-full px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-red-400 hover:bg-red-50 transition-colors"
              onClick={() => { onDeleteRelation(edgePopup.id); clearPopups(); }}
            >
              Remove connection
            </button>
          </div>
        );
      })()}

      {/* Drag hint */}
      {tags.length > 1 && (
        <div className="absolute bottom-3 left-0 right-0 flex justify-center pointer-events-none">
          <span className="text-[9px] uppercase tracking-widest text-gray-400 bg-[#FAFAF8]/80 px-2 py-1 rounded-full">
            Drag from node edge to connect · Click to focus
          </span>
        </div>
      )}
    </div>
  );
}
