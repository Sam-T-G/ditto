import React, { useMemo } from 'react';
import { Annotation, Tag, TagRelation } from '../types';
import { getTagColor } from '../lib/tagColors';

interface MetricsPanelProps {
  annotations: Annotation[];
  tags: Tag[];
  tagRelations: TagRelation[];
}

export default function MetricsPanel({ annotations, tags, tagRelations }: MetricsPanelProps) {
  const stats = useMemo(() => {
    const countByTag: Record<string, number> = {};
    for (const tag of tags) countByTag[tag.id] = 0;
    for (const ann of annotations) {
      for (const tid of ann.tagIds) {
        if (tid in countByTag) countByTag[tid]++;
      }
    }

    const relationsByTag: Record<string, number> = {};
    for (const tag of tags) relationsByTag[tag.id] = 0;
    for (const rel of tagRelations) {
      if (rel.sourceId in relationsByTag) relationsByTag[rel.sourceId]++;
      if (rel.targetId in relationsByTag) relationsByTag[rel.targetId]++;
    }

    const sorted = [...tags].sort((a, b) => (countByTag[b.id] ?? 0) - (countByTag[a.id] ?? 0));
    const maxCount = sorted.length > 0 ? (countByTag[sorted[0].id] ?? 0) : 0;
    const tagged = annotations.filter(a => a.tagIds.length > 0).length;
    const untagged = annotations.length - tagged;

    return { countByTag, relationsByTag, sorted, maxCount, tagged, untagged };
  }, [annotations, tags, tagRelations]);

  const noData = tags.length === 0 && annotations.length === 0;

  return (
    <div className="h-full flex flex-col bg-[#FCFAF7] overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-6 pb-4 border-b border-[#E5E2DD] shrink-0">
        <h3 className="text-xs font-bold uppercase tracking-widest">Metrics</h3>
        <span className="text-[10px] text-gray-400 italic block mt-0.5">
          {tags.length} tag{tags.length !== 1 ? 's' : ''} · {annotations.length} annotation{annotations.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar px-8 py-6 space-y-6">
        {noData ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-gray-400">
            <p className="text-sm">No data yet.</p>
            <p className="text-xs mt-2 italic">Add tags and annotations to see metrics.</p>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3">
              <SummaryCard label="Annotations" value={annotations.length} />
              <SummaryCard label="Tags" value={tags.length} />
              <SummaryCard label="Relations" value={tagRelations.length} />
              <SummaryCard label="Untagged" value={stats.untagged} dim={stats.untagged === 0} />
            </div>

            {/* Per-tag breakdown */}
            {tags.length > 0 && (
              <div>
                <p className="text-[9px] uppercase tracking-widest text-gray-400 font-semibold mb-3">
                  By tag
                </p>
                <div className="space-y-2">
                  {stats.sorted.map(tag => {
                    const count = stats.countByTag[tag.id] ?? 0;
                    const rels = stats.relationsByTag[tag.id] ?? 0;
                    const color = getTagColor(tag.colorKey);
                    const barPct = stats.maxCount > 0 ? (count / stats.maxCount) * 100 : 0;
                    const pct = annotations.length > 0
                      ? Math.round((count / annotations.length) * 100)
                      : 0;

                    return (
                      <div key={tag.id} className="bg-white border border-[#E5E2DD] rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{ backgroundColor: color.dot }}
                            />
                            <span
                              className="text-xs font-semibold truncate"
                              style={{ color: color.text }}
                            >
                              {tag.label}
                            </span>
                          </div>
                          <div className="flex items-baseline gap-1.5 shrink-0 ml-2">
                            <span className="text-lg font-bold text-[#1A1A1A] leading-none">{count}</span>
                            <span className="text-[9px] text-gray-400 uppercase tracking-wide">ann.</span>
                          </div>
                        </div>

                        {/* Bar */}
                        <div className="h-1.5 rounded-full bg-[#F3F1ED] overflow-hidden mb-2">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${barPct}%`, backgroundColor: color.dot }}
                          />
                        </div>

                        {/* Meta row */}
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] text-gray-400">
                            {pct}% of annotations
                          </span>
                          {rels > 0 && (
                            <span className="text-[9px] text-gray-400">
                              {rels} relation{rels !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, dim = false }: { label: string; value: number; dim?: boolean }) {
  return (
    <div className={`bg-white border border-[#E5E2DD] rounded-xl px-4 py-3 ${dim ? 'opacity-50' : ''}`}>
      <p className="text-[9px] uppercase tracking-widest text-gray-400 font-semibold">{label}</p>
      <p className="text-2xl font-bold text-[#1A1A1A] mt-0.5 leading-none">{value}</p>
    </div>
  );
}
