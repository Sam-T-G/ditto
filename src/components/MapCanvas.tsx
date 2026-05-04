import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { Tag, TagRelation, Annotation } from '../types';
import { getTagColor } from '../lib/tagColors';

interface MapCanvasProps {
  documentId: string;
  tags: Tag[];
  tagRelations: TagRelation[];
  tagCounts: Record<string, number>;
  annotations: Annotation[];
  activeTagId: string | null;
  onSelectTag: (id: string | null) => void;
  onCreateRelation: (sourceId: string, targetId: string) => void;
  onDeleteRelation: (id: string) => void;
  onUpdateRelationLabel: (id: string, label: string) => void;
  onDeleteTag: (id: string) => void;
  onRenameTag: (id: string, label: string) => void;
}

interface NodePopup { id: string; }
interface EdgePopup { id: string; label: string; }
interface AdjPopup { sourceId: string; targetId: string; count: number; }
interface RenameState { id: string; label: string; }

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  colorKey: number;
}

interface ResolvedAdjPair {
  source: SimNode;
  target: SimNode;
  count: number;
}

interface ResolvedRelLink {
  id: string;
  label: string;
  source: SimNode;
  target: SimNode;
}

interface MapState {
  nodes: Record<string, { x: number; y: number }>;
  transform?: { k: number; x: number; y: number };
}

// Count how many annotations each pair of tags share
function computeAdjacency(annotations: Annotation[]): Map<string, Map<string, number>> {
  const adj = new Map<string, Map<string, number>>();
  for (const ann of annotations) {
    const tids = ann.tagIds;
    for (let i = 0; i < tids.length; i++) {
      for (let j = i + 1; j < tids.length; j++) {
        const a = tids[i], b = tids[j];
        if (!adj.has(a)) adj.set(a, new Map());
        if (!adj.has(b)) adj.set(b, new Map());
        adj.get(a)!.set(b, (adj.get(a)!.get(b) ?? 0) + 1);
        adj.get(b)!.set(a, (adj.get(b)!.get(a) ?? 0) + 1);
      }
    }
  }
  return adj;
}

const BASE_RADIUS = 14;
const MAX_RADIUS  = 46;

function nodeRadius(count: number) {
  return Math.round(Math.min(MAX_RADIUS, BASE_RADIUS + Math.sqrt(count) * 4));
}
function handleRadius(count: number) {
  return nodeRadius(count) + 12;
}

// Bezier path for directed manual-relation edges — asymmetric trim with arrow clearance
function linkPathData(sx: number, sy: number, tx: number, ty: number, sR: number, tR: number) {
  const dx = tx - sx, dy = ty - sy;
  const len = Math.hypot(dx, dy) || 1;
  const x1 = sx + (dx / len) * sR;
  const y1 = sy + (dy / len) * sR;
  const x2 = tx - (dx / len) * (tR + 4);
  const y2 = ty - (dy / len) * (tR + 4);
  const curvature = Math.min(40, len * 0.18);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const cpx = mx - (dy / len) * curvature;
  const cpy = my + (dx / len) * curvature;
  const lx = 0.25 * x1 + 0.5 * cpx + 0.25 * x2;
  const ly = 0.25 * y1 + 0.5 * cpy + 0.25 * y2;
  return { d: `M${x1},${y1} Q${cpx},${cpy} ${x2},${y2}`, lx, ly };
}

// Bezier path for undirected adjacency threads — symmetrically trimmed, subtler curve
function adjPathData(sx: number, sy: number, tx: number, ty: number, sR: number, tR: number) {
  const dx = tx - sx, dy = ty - sy;
  const len = Math.hypot(dx, dy) || 1;
  const x1 = sx + (dx / len) * sR;
  const y1 = sy + (dy / len) * sR;
  const x2 = tx - (dx / len) * tR;
  const y2 = ty - (dy / len) * tR;
  const curvature = Math.min(18, len * 0.07);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const cpx = mx - (dy / len) * curvature;
  const cpy = my + (dx / len) * curvature;
  return `M${x1},${y1} Q${cpx},${cpy} ${x2},${y2}`;
}

function loadMapState(docId: string): MapState | null {
  try {
    const raw = localStorage.getItem(`textura:map:${docId}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveMapState(
  docId: string,
  nodes: Map<string, { x: number; y: number }>,
  transform: d3.ZoomTransform,
) {
  const nodeObj: Record<string, { x: number; y: number }> = {};
  nodes.forEach((v, k) => { nodeObj[k] = { x: v.x, y: v.y }; });
  try {
    localStorage.setItem(`textura:map:${docId}`, JSON.stringify({
      nodes: nodeObj,
      transform: { k: transform.k, x: transform.x, y: transform.y },
    }));
  } catch {}
}

export default function MapCanvas({
  documentId,
  tags,
  tagRelations,
  tagCounts,
  annotations,
  activeTagId,
  onSelectTag,
  onCreateRelation,
  onDeleteRelation,
  onUpdateRelationLabel,
  onDeleteTag,
  onRenameTag,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef       = useRef<SVGSVGElement>(null);
  const positionCacheRef  = useRef<Map<string, { x: number; y: number }>>(new Map());
  const zoomTransformRef  = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const zoomBehaviorRef   = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const drawingFromRef    = useRef<string | null>(null);

  const [layoutKey, setLayoutKey] = useState(0);
  const [nodePopup, setNodePopup] = useState<NodePopup | null>(null);
  const [edgePopup, setEdgePopup] = useState<EdgePopup | null>(null);
  const [adjPopup,  setAdjPopup]  = useState<AdjPopup | null>(null);
  const [renaming,  setRenaming]  = useState<RenameState | null>(null);

  const clearPopups = useCallback(() => {
    setNodePopup(null);
    setEdgePopup(null);
    setAdjPopup(null);
    setRenaming(null);
  }, []);

  const graphToScreen = useCallback((gx: number, gy: number) => {
    const t = zoomTransformRef.current;
    return { x: gx * t.k + t.x, y: gy * t.k + t.y };
  }, []);

  const getNodeScreenPos = useCallback((id: string) => {
    const pos = positionCacheRef.current.get(id);
    if (!pos) return null;
    return graphToScreen(pos.x, pos.y);
  }, [graphToScreen]);

  // Number of unique co-occurring pairs (for footer display)
  const adjPairCount = useMemo(() => {
    const pairs = new Set<string>();
    for (const ann of annotations) {
      const tids = ann.tagIds;
      for (let i = 0; i < tids.length; i++) {
        for (let j = i + 1; j < tids.length; j++) {
          const [a, b] = [tids[i], tids[j]];
          pairs.add(a < b ? `${a}:${b}` : `${b}:${a}`);
        }
      }
    }
    return pairs.size;
  }, [annotations]);

  useEffect(() => {
    const svg       = d3.select(svgRef.current!);
    const container = containerRef.current!;
    const width     = container.clientWidth;
    const height    = container.clientHeight;

    svg.selectAll('*').remove();

    // ── Restore saved positions ────────────────────────────────────────────────
    const saved = loadMapState(documentId);
    if (saved?.nodes) {
      for (const [id, pos] of Object.entries(saved.nodes)) {
        positionCacheRef.current.set(id, pos);
      }
    }

    if (tags.length === 0) return;

    // ── Build sim nodes from position cache ───────────────────────────────────
    const simNodes: SimNode[] = tags.map(tag => {
      const cached = positionCacheRef.current.get(tag.id);
      return {
        id: tag.id,
        label: tag.label,
        colorKey: tag.colorKey,
        x: cached?.x ?? width  / 2 + (Math.random() - 0.5) * 200,
        y: cached?.y ?? height / 2 + (Math.random() - 0.5) * 200,
      };
    });

    const nodeById = new Map(simNodes.map(n => [n.id, n]));
    const tagIdSet = new Set(tags.map(t => t.id));

    // ── Compute adjacency matrix ───────────────────────────────────────────────
    const adj = computeAdjacency(annotations);

    // Build undirected adjacency pairs (each pair deduplicated)
    const rawAdjPairs: Array<{ source: string; target: string; count: number }> = [];
    const seenPairs = new Set<string>();
    adj.forEach((targets, a) => {
      if (!tagIdSet.has(a)) return;
      targets.forEach((count, b) => {
        if (!tagIdSet.has(b)) return;
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (!seenPairs.has(key)) {
          seenPairs.add(key);
          rawAdjPairs.push({ source: a, target: b, count });
        }
      });
    });

    const maxAdj = Math.max(1, ...rawAdjPairs.map(p => p.count));

    // ── Run adjacency-weighted force sim for new/uncached nodes ───────────────
    const newNodes = simNodes.filter(n => !positionCacheRef.current.has(n.id));
    if (newNodes.length > 0) {
      // D3 mutates link objects — use a copy so rawAdjPairs stay as string IDs
      const adjLinksForSim = rawAdjPairs.map(p => ({ ...p }));
      const tempSim = d3.forceSimulation<SimNode>(simNodes)
        .force('link', d3.forceLink<SimNode, typeof adjLinksForSim[0]>(adjLinksForSim)
          .id(d => d.id)
          .distance(d => Math.max(80, 220 - (d.count / maxAdj) * 140))
          .strength(d => 0.08 + (d.count / maxAdj) * 0.6)
        )
        .force('charge', d3.forceManyBody().strength(-280))
        .force('collide', d3.forceCollide(55))
        .stop();
      for (let i = 0; i < 300; i++) tempSim.tick();
      simNodes.forEach(n => positionCacheRef.current.set(n.id, { x: n.x!, y: n.y! }));
    } else {
      simNodes.forEach(n => {
        if (!positionCacheRef.current.has(n.id)) {
          positionCacheRef.current.set(n.id, { x: n.x!, y: n.y! });
        }
      });
    }

    // Resolve adjacency pairs to SimNode refs for rendering
    const resolvedAdjPairs: ResolvedAdjPair[] = rawAdjPairs
      .map(p => ({ source: nodeById.get(p.source)!, target: nodeById.get(p.target)!, count: p.count }))
      .filter(p => p.source && p.target);

    // Resolve manual relation links to SimNode refs for rendering
    const resolvedRelLinks: ResolvedRelLink[] = tagRelations
      .map(r => ({ id: r.id, label: r.label, source: nodeById.get(r.sourceId)!, target: nodeById.get(r.targetId)! }))
      .filter(l => l.source && l.target);

    // ── SVG setup ──────────────────────────────────────────────────────────────
    svg.attr('width', width).attr('height', height);

    const defs = svg.append('defs');
    const pattern = defs.append('pattern')
      .attr('id', 'dot-grid').attr('width', 24).attr('height', 24)
      .attr('patternUnits', 'userSpaceOnUse');
    pattern.append('circle').attr('cx', 12).attr('cy', 12).attr('r', 1).attr('fill', '#E5E2DD');

    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -4 9 8').attr('refX', 9).attr('refY', 0)
      .attr('markerWidth', 7).attr('markerHeight', 7).attr('orient', 'auto')
      .append('path').attr('fill', '#9CA3AF').attr('d', 'M0,-4L9,0L0,4Z');

    svg.append('rect')
      .attr('width', width).attr('height', height)
      .attr('fill', 'url(#dot-grid)')
      .on('click', () => { onSelectTag(null); clearPopups(); });

    const zoomLayer = svg.append('g').attr('class', 'zoom-layer');

    // Ghost edge for manual relation drawing
    const ghostLine = zoomLayer.append('line')
      .attr('class', 'ghost-edge')
      .attr('stroke', '#6B7280').attr('stroke-width', 2)
      .attr('stroke-dasharray', '6,4').attr('stroke-linecap', 'round')
      .attr('opacity', 0.7).attr('pointer-events', 'none')
      .style('display', 'none');

    // ── Layer 1: adjacency threads (auto, undirected) ──────────────────────────
    const adjGroup = zoomLayer.append('g').attr('class', 'adj-links');

    const adjGs = adjGroup.selectAll<SVGGElement, ResolvedAdjPair>('g')
      .data(resolvedAdjPairs, d => `${d.source.id}:${d.target.id}`)
      .join('g')
      .attr('class', 'adj-group')
      .style('cursor', 'pointer')
      .on('click', function(event, d) {
        event.stopPropagation();
        setAdjPopup({ sourceId: d.source.id, targetId: d.target.id, count: d.count });
        setEdgePopup(null); setNodePopup(null); setRenaming(null);
      });

    // Visible thread — stroke-width and opacity encode co-occurrence strength
    adjGs.append('path').attr('class', 'adj-line')
      .attr('fill', 'none').attr('stroke-linecap', 'round')
      .attr('stroke', '#C4C0BB')
      .attr('stroke-width', d => 1 + (d.count / maxAdj) * 4.5)
      .attr('opacity',      d => 0.15 + (d.count / maxAdj) * 0.5);

    // Wider invisible hit target
    adjGs.append('path').attr('class', 'adj-hit')
      .attr('stroke', 'transparent').attr('stroke-width', 16).attr('fill', 'none');

    adjGs.on('mouseenter', function(_, d) {
      d3.select(this).select('.adj-line')
        .attr('stroke', '#8B87A0')
        .attr('opacity', Math.min(0.9, 0.4 + (d.count / maxAdj) * 0.5));
    });
    adjGs.on('mouseleave', function(_, d) {
      d3.select(this).select('.adj-line')
        .attr('stroke', '#C4C0BB')
        .attr('opacity', 0.15 + (d.count / maxAdj) * 0.5);
    });

    // ── Layer 2: manual relation edges (directed, labelled arrows) ─────────────
    const linkGroup = zoomLayer.append('g').attr('class', 'links');

    const linkGs = linkGroup.selectAll<SVGGElement, ResolvedRelLink>('g')
      .data(resolvedRelLinks, d => d.id)
      .join('g')
      .attr('class', 'link-group')
      .style('cursor', 'pointer')
      .on('click', function(event, d) {
        event.stopPropagation();
        setEdgePopup({ id: d.id, label: d.label });
        setAdjPopup(null); setNodePopup(null); setRenaming(null);
      });

    linkGs.append('path').attr('class', 'link-line')
      .attr('stroke', '#A09BA8').attr('stroke-width', 1.5)
      .attr('fill', 'none').attr('stroke-linecap', 'round')
      .attr('marker-end', 'url(#arrow)');
    linkGs.append('path').attr('class', 'link-hit')
      .attr('stroke', 'transparent').attr('stroke-width', 14).attr('fill', 'none');
    linkGs.append('rect').attr('class', 'link-label-bg')
      .attr('rx', 3).attr('fill', '#FAFAF8').attr('pointer-events', 'none');
    linkGs.append('text').attr('class', 'link-label')
      .attr('text-anchor', 'middle').attr('font-size', '9px')
      .attr('font-family', 'Inter, ui-sans-serif, system-ui, sans-serif')
      .attr('fill', '#6B7280').attr('letter-spacing', '0.04em')
      .attr('pointer-events', 'none');

    // ── Layer 3: nodes ────────────────────────────────────────────────────────
    const nodeGroup = zoomLayer.append('g').attr('class', 'nodes');

    const nodeGs = nodeGroup.selectAll<SVGGElement, SimNode>('g')
      .data(simNodes, d => d.id)
      .join('g')
      .attr('class', 'node-group')
      .style('cursor', 'pointer');

    nodeGs.append('circle').attr('class', 'handle-ring')
      .attr('r', d => handleRadius(tagCounts[d.id] ?? 0))
      .attr('fill', 'transparent').attr('stroke', 'transparent')
      .attr('stroke-width', 2).attr('stroke-dasharray', '4,3');

    nodeGs.append('circle').attr('class', 'node-circle')
      .attr('r', d => nodeRadius(tagCounts[d.id] ?? 0))
      .attr('fill',   d => getTagColor(d.colorKey).bg)
      .attr('stroke', d => getTagColor(d.colorKey).border)
      .attr('stroke-width', 1.5)
      .attr('opacity', d => activeTagId && d.id !== activeTagId ? 0.35 : 1);

    nodeGs.append('text').attr('class', 'node-count')
      .attr('text-anchor', 'middle').attr('dy', '0.35em')
      .attr('font-size', d => `${Math.max(9, Math.min(13, nodeRadius(tagCounts[d.id] ?? 0) * 0.5))}px`)
      .attr('font-weight', '700')
      .attr('fill', d => getTagColor(d.colorKey).text)
      .attr('pointer-events', 'none')
      .text(d => (tagCounts[d.id] ?? 0) > 0 ? String(tagCounts[d.id]) : '');

    nodeGs.append('text').attr('class', 'node-label')
      .attr('text-anchor', 'middle')
      .attr('dy', d => nodeRadius(tagCounts[d.id] ?? 0) + 14)
      .attr('font-size', '10px').attr('font-weight', '600').attr('fill', '#374151')
      .attr('font-family', 'Inter, ui-sans-serif, system-ui, sans-serif')
      .attr('letter-spacing', '0.03em').attr('pointer-events', 'none')
      .text(d => d.label);

    // ── Render positions for all layers ───────────────────────────────────────
    function renderPositions() {
      nodeGs.attr('transform', d => `translate(${d.x},${d.y})`);

      adjGs.each(function(d) {
        const sx = d.source.x ?? 0, sy = d.source.y ?? 0;
        const tx = d.target.x ?? 0, ty = d.target.y ?? 0;
        const sR = nodeRadius(tagCounts[d.source.id] ?? 0) + 2;
        const tR = nodeRadius(tagCounts[d.target.id] ?? 0) + 2;
        const path = adjPathData(sx, sy, tx, ty, sR, tR);
        d3.select(this).selectAll('.adj-line, .adj-hit').attr('d', path);
      });

      linkGs.each(function(d) {
        const sx = d.source.x ?? 0, sy = d.source.y ?? 0;
        const tx = d.target.x ?? 0, ty = d.target.y ?? 0;
        const sR = nodeRadius(tagCounts[d.source.id] ?? 0) + 2;
        const tR = nodeRadius(tagCounts[d.target.id] ?? 0) + 2;
        const { d: pathD, lx, ly } = linkPathData(sx, sy, tx, ty, sR, tR);
        d3.select(this).selectAll('.link-line, .link-hit').attr('d', pathD);

        const labelEl = d3.select(this).select<SVGTextElement>('.link-label');
        const text = d.label || '';
        labelEl.attr('x', lx).attr('y', ly + 4).text(text);
        const bgEl = d3.select(this).select<SVGRectElement>('.link-label-bg');
        if (text) {
          const bbox = (labelEl.node() as SVGTextElement).getBBox?.();
          if (bbox?.width > 0) {
            bgEl.attr('x', bbox.x - 3).attr('y', bbox.y - 1)
              .attr('width', bbox.width + 6).attr('height', bbox.height + 2);
          }
        } else {
          bgEl.attr('width', 0).attr('height', 0);
        }
      });
    }

    renderPositions();

    // ── Interactions ───────────────────────────────────────────────────────────

    svg.on('mousemove', function(event) {
      if (!drawingFromRef.current) return;
      const [gx, gy] = zoomTransformRef.current.invert(d3.pointer(event));
      const srcNode = simNodes.find(n => n.id === drawingFromRef.current);
      if (srcNode) {
        const dx = gx - (srcNode.x ?? 0), dy = gy - (srcNode.y ?? 0);
        const len = Math.hypot(dx, dy) || 1;
        const sR = nodeRadius(tagCounts[srcNode.id] ?? 0) + 2;
        ghostLine
          .attr('x1', (srcNode.x ?? 0) + (dx / len) * sR)
          .attr('y1', (srcNode.y ?? 0) + (dy / len) * sR);
      }
      ghostLine.attr('x2', gx).attr('y2', gy);
    });

    svg.on('mouseup', function() {
      if (!drawingFromRef.current) return;
      ghostLine.style('display', 'none');
      drawingFromRef.current = null;
      nodeGs.select<SVGCircleElement>('.node-circle')
        .attr('stroke-width', 1.5)
        .attr('opacity', (n: SimNode) => activeTagId && n.id !== activeTagId ? 0.35 : 1);
      nodeGs.select('.handle-ring').attr('stroke', 'transparent').attr('stroke-dasharray', '4,3');
    });

    nodeGs.on('mouseenter', function(_, d) {
      if (drawingFromRef.current && drawingFromRef.current !== d.id) {
        d3.select(this).select('.node-circle').attr('stroke-width', 3).attr('opacity', 1);
        d3.select(this).select('.handle-ring')
          .attr('stroke', getTagColor(d.colorKey).border)
          .attr('stroke-opacity', 0.8).attr('stroke-dasharray', '3,2');
      }
      if (!drawingFromRef.current) {
        d3.select(this).select('.handle-ring')
          .attr('stroke', getTagColor(d.colorKey).border)
          .attr('stroke-opacity', 0.5).attr('stroke-dasharray', '4,3');
      }
    });

    nodeGs.on('mouseleave', function(_, d) {
      if (drawingFromRef.current && drawingFromRef.current !== d.id) {
        d3.select(this).select('.node-circle')
          .attr('stroke-width', 1.5)
          .attr('opacity', d.id === drawingFromRef.current ? 1 : 0.45);
        d3.select(this).select('.handle-ring').attr('stroke', 'transparent');
      }
      if (!drawingFromRef.current) {
        d3.select(this).select('.node-circle').attr('stroke-width', 1.5);
        d3.select(this).select('.handle-ring').attr('stroke', 'transparent');
      }
    });

    nodeGs.on('click', function(event, d) {
      event.stopPropagation();
      onSelectTag(d.id === activeTagId ? null : d.id);
      setNodePopup({ id: d.id });
      setEdgePopup(null); setAdjPopup(null); setRenaming(null);
    });

    nodeGs.on('dblclick', function(event, d) {
      event.stopPropagation();
      setRenaming({ id: d.id, label: d.label });
      setNodePopup(null);
    });

    // Drag: move node body, or drag from outer ring to draw a manual relation
    const moveDrag = d3.drag<SVGGElement, SimNode>()
      .on('start', function(event, d) {
        const dist = Math.hypot(event.x - (d.x ?? 0), event.y - (d.y ?? 0));
        const nr   = nodeRadius(tagCounts[d.id] ?? 0);
        if (dist > nr + 2) {
          drawingFromRef.current = d.id;
          ghostLine
            .attr('stroke', getTagColor(d.colorKey).border)
            .attr('x1', d.x ?? 0).attr('y1', d.y ?? 0)
            .attr('x2', d.x ?? 0).attr('y2', d.y ?? 0)
            .style('display', null);
          nodeGs.select<SVGCircleElement>('.node-circle')
            .attr('opacity', (n: SimNode) => n.id === d.id ? 1 : 0.35);
          nodeGs.select<SVGCircleElement>('.handle-ring')
            .attr('stroke', (n: SimNode) => n.id !== d.id ? getTagColor(n.colorKey).border : 'transparent')
            .attr('stroke-opacity', 0.35).attr('stroke-dasharray', '4,3');
          return;
        }
        event.sourceEvent.stopPropagation();
        clearPopups();
      })
      .on('drag', function(event, d) {
        if (drawingFromRef.current) return;
        d.x = event.x; d.y = event.y;
        d3.select(this).attr('transform', `translate(${event.x},${event.y})`);

        adjGs.each(function(ad) {
          if (ad.source.id !== d.id && ad.target.id !== d.id) return;
          const path = adjPathData(
            ad.source.x ?? 0, ad.source.y ?? 0,
            ad.target.x ?? 0, ad.target.y ?? 0,
            nodeRadius(tagCounts[ad.source.id] ?? 0) + 2,
            nodeRadius(tagCounts[ad.target.id] ?? 0) + 2,
          );
          d3.select(this).selectAll('.adj-line, .adj-hit').attr('d', path);
        });

        linkGs.each(function(ld) {
          if (ld.source.id !== d.id && ld.target.id !== d.id) return;
          const { d: pathD, lx, ly } = linkPathData(
            ld.source.x ?? 0, ld.source.y ?? 0,
            ld.target.x ?? 0, ld.target.y ?? 0,
            nodeRadius(tagCounts[ld.source.id] ?? 0) + 2,
            nodeRadius(tagCounts[ld.target.id] ?? 0) + 2,
          );
          d3.select(this).selectAll('.link-line, .link-hit').attr('d', pathD);
          d3.select(this).select('.link-label').attr('x', lx).attr('y', ly + 4);
        });
      })
      .on('end', function(event, d) {
        if (drawingFromRef.current) {
          const target = simNodes.find(n => {
            const dx = (n.x ?? 0) - event.x, dy = (n.y ?? 0) - event.y;
            return n.id !== d.id && Math.hypot(dx, dy) < handleRadius(tagCounts[n.id] ?? 0);
          });
          if (target) onCreateRelation(drawingFromRef.current, target.id);
          ghostLine.style('display', 'none');
          drawingFromRef.current = null;
          nodeGs.select<SVGCircleElement>('.node-circle')
            .attr('stroke-width', 1.5)
            .attr('opacity', (n: SimNode) => activeTagId && n.id !== activeTagId ? 0.35 : 1);
          nodeGs.select('.handle-ring').attr('stroke', 'transparent');
        } else {
          positionCacheRef.current.set(d.id, { x: event.x, y: event.y });
          saveMapState(documentId, positionCacheRef.current, zoomTransformRef.current);
        }
      });

    nodeGs.call(moveDrag);

    // ── Zoom ──────────────────────────────────────────────────────────────────
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 5])
      .filter(event => {
        if (event.type === 'wheel') return true;
        const el = event.target as Element;
        if (el.closest?.('.node-group') || el.closest?.('.link-group') || el.closest?.('.adj-group')) return false;
        return true;
      })
      .on('zoom', event => {
        zoomLayer.attr('transform', event.transform);
        zoomTransformRef.current = event.transform;
        saveMapState(documentId, positionCacheRef.current, event.transform);
      });

    zoomBehaviorRef.current = zoom;
    svg.call(zoom);

    if (saved?.transform) {
      const { k, x, y } = saved.transform;
      svg.call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(k));
    }

    return () => { svg.on('.zoom', null); };
  }, [tags, tagRelations, tagCounts, annotations, documentId, layoutKey]);

  // Re-apply active dim without full redraw
  useEffect(() => {
    if (!svgRef.current) return;
    d3.select(svgRef.current).selectAll('.node-circle')
      .attr('opacity', function() {
        const d = d3.select((this as Element).parentNode as Element).datum() as SimNode;
        return activeTagId && d.id !== activeTagId ? 0.35 : 1;
      });
  }, [activeTagId]);

  const cw = containerRef.current?.clientWidth  ?? 400;
  const ch = containerRef.current?.clientHeight ?? 400;

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[#FAFAF8]">
      <svg ref={svgRef} className="w-full h-full" />

      {/* Controls: zoom + rearrange */}
      {tags.length > 0 && (
        <div className="absolute top-3 right-3 flex flex-col gap-1 z-10">
          <button
            className="w-7 h-7 bg-white border border-[#E5E2DD] rounded-md text-gray-500 hover:bg-[#F9F7F4] hover:text-[#1A1A1A] transition-colors flex items-center justify-center text-base font-light leading-none shadow-sm"
            onClick={() => { const z = zoomBehaviorRef.current; if (z) d3.select(svgRef.current!).transition().duration(200).call(z.scaleBy, 1.3); }}
          >+</button>
          <button
            className="w-7 h-7 bg-white border border-[#E5E2DD] rounded-md text-gray-500 hover:bg-[#F9F7F4] hover:text-[#1A1A1A] transition-colors flex items-center justify-center text-base font-light leading-none shadow-sm"
            onClick={() => { const z = zoomBehaviorRef.current; if (z) d3.select(svgRef.current!).transition().duration(200).call(z.scaleBy, 1 / 1.3); }}
          >−</button>
          <button
            className="w-7 h-7 bg-white border border-[#E5E2DD] rounded-md text-[9px] font-bold text-gray-400 hover:bg-[#F9F7F4] hover:text-[#1A1A1A] transition-colors flex items-center justify-center shadow-sm"
            title="Reset zoom"
            onClick={() => { const z = zoomBehaviorRef.current; if (z) d3.select(svgRef.current!).transition().duration(200).call(z.transform, d3.zoomIdentity); }}
          >⊙</button>
          <div className="w-[1px] bg-[#E5E2DD] mx-auto h-3" />
          <button
            title="Rearrange by co-occurrence"
            className="w-7 h-7 bg-white border border-[#E5E2DD] rounded-md text-gray-400 hover:bg-[#F9F7F4] hover:text-[#1A1A1A] transition-colors flex items-center justify-center shadow-sm"
            onClick={() => {
              positionCacheRef.current.clear();
              try { localStorage.removeItem(`textura:map:${documentId}`); } catch {}
              setLayoutKey(k => k + 1);
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
            </svg>
          </button>
        </div>
      )}

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
        const pos = getNodeScreenPos(nodePopup.id);
        if (!pos) return null;
        const tag = tags.find(t => t.id === nodePopup.id);
        if (!tag) return null;
        const nr  = nodeRadius(tagCounts[nodePopup.id] ?? 0);
        const px  = Math.min(Math.max(pos.x, 70), cw - 70);
        const py  = pos.y < 60 ? pos.y + nr + 16 : pos.y - nr - 56;
        return (
          <div className="absolute z-20 bg-white border border-[#E5E2DD] rounded-lg shadow-lg flex overflow-hidden"
            style={{ left: px - 64, top: py, minWidth: 128 }} onClick={e => e.stopPropagation()}>
            <button className="flex-1 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:bg-[#F9F7F4] hover:text-[#1A1A1A] transition-colors"
              onClick={() => { setRenaming({ id: nodePopup.id, label: tag.label }); setNodePopup(null); }}>Rename</button>
            <div className="w-[1px] bg-[#E5E2DD]" />
            <button className="flex-1 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-red-400 hover:bg-red-50 transition-colors"
              onClick={() => { onDeleteTag(nodePopup.id); clearPopups(); }}>Delete</button>
          </div>
        );
      })()}

      {/* Rename overlay */}
      {renaming && (() => {
        const pos = getNodeScreenPos(renaming.id);
        if (!pos) return null;
        const nr2 = nodeRadius(tagCounts[renaming.id] ?? 0);
        const px  = Math.min(Math.max(pos.x, 80), cw - 80);
        const py  = pos.y < 60 ? pos.y + nr2 + 16 : pos.y - nr2 - 52;
        return (
          <form className="absolute z-20 bg-white border border-[#1A1A1A] rounded-lg shadow-lg flex overflow-hidden"
            style={{ left: px - 80, top: py, width: 160 }}
            onSubmit={e => { e.preventDefault(); if (renaming.label.trim()) onRenameTag(renaming.id, renaming.label); clearPopups(); }}>
            <input autoFocus value={renaming.label}
              onChange={e => setRenaming({ ...renaming, label: e.target.value })}
              onKeyDown={e => { if (e.key === 'Escape') clearPopups(); }}
              className="flex-1 px-3 py-2 text-xs outline-none bg-transparent" />
            <button type="submit" className="px-3 py-2 text-[10px] font-bold text-[#1A1A1A] border-l border-[#E5E2DD] hover:bg-[#F9F7F4]">↵</button>
          </form>
        );
      })()}

      {/* Manual relation edge popup */}
      {edgePopup && (() => {
        const rel = tagRelations.find(r => r.id === edgePopup.id);
        if (!rel) return null;
        const src = positionCacheRef.current.get(rel.sourceId);
        const tgt = positionCacheRef.current.get(rel.targetId);
        if (!src || !tgt) return null;
        const mid = graphToScreen((src.x + tgt.x) / 2, (src.y + tgt.y) / 2);
        const px  = Math.min(Math.max(mid.x, 90), cw - 90);
        const py  = Math.min(Math.max(mid.y - 52, 8), ch - 60);
        return (
          <div className="absolute z-20 bg-white border border-[#E5E2DD] rounded-lg shadow-lg overflow-hidden"
            style={{ left: px - 90, top: py, width: 180 }} onClick={e => e.stopPropagation()}>
            <input autoFocus value={edgePopup.label}
              onChange={e => { const label = e.target.value; setEdgePopup({ ...edgePopup, label }); onUpdateRelationLabel(edgePopup.id, label); }}
              placeholder="Relation label…"
              className="w-full px-3 py-2 text-xs outline-none bg-transparent border-b border-[#E5E2DD] placeholder-gray-400" />
            <button className="w-full px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-red-400 hover:bg-red-50 transition-colors"
              onClick={() => { onDeleteRelation(edgePopup.id); clearPopups(); }}>Remove connection</button>
          </div>
        );
      })()}

      {/* Adjacency thread popup */}
      {adjPopup && (() => {
        const src = positionCacheRef.current.get(adjPopup.sourceId);
        const tgt = positionCacheRef.current.get(adjPopup.targetId);
        if (!src || !tgt) return null;
        const mid    = graphToScreen((src.x + tgt.x) / 2, (src.y + tgt.y) / 2);
        const px     = Math.min(Math.max(mid.x, 80), cw - 80);
        const py     = Math.min(Math.max(mid.y - 50, 8), ch - 68);
        const srcTag = tags.find(t => t.id === adjPopup.sourceId);
        const tgtTag = tags.find(t => t.id === adjPopup.targetId);
        return (
          <div className="absolute z-20 bg-white border border-[#E5E2DD] rounded-lg shadow-lg overflow-hidden"
            style={{ left: px - 80, top: py, width: 160 }} onClick={e => e.stopPropagation()}>
            <div className="px-3 pt-2.5 pb-0.5">
              <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1">Co-occurrence</div>
              <div className="text-[11px] text-gray-700 font-semibold leading-tight">
                {srcTag?.label} &amp; {tgtTag?.label}
              </div>
            </div>
            <div className="px-3 pb-2.5 pt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-[#1A1A1A] leading-none">{adjPopup.count}</span>
              <span className="text-[10px] text-gray-400">shared annotation{adjPopup.count !== 1 ? 's' : ''}</span>
            </div>
          </div>
        );
      })()}

      {/* Footer hint */}
      {tags.length > 1 && (
        <div className="absolute bottom-3 left-0 right-0 flex justify-center pointer-events-none">
          <span className="text-[9px] uppercase tracking-widest text-gray-400 bg-[#FAFAF8]/80 px-2 py-1 rounded-full">
            {adjPairCount > 0
              ? `${adjPairCount} co-occurrence thread${adjPairCount !== 1 ? 's' : ''} · click thread to inspect`
              : 'No co-occurrences yet — annotate with multiple tags'}
          </span>
        </div>
      )}
    </div>
  );
}
