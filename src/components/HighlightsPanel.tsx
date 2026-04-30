import React, { useState } from 'react';
import { Annotation, Tag } from '../types';
import { cn } from '../lib/utils';
import { getTagColor } from '../lib/tagColors';
import { jsPDF } from 'jspdf';

interface HighlightsPanelProps {
  annotations: Annotation[];
  tags: Tag[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onUpdateNote: (id: string, note: string) => void;
  onDelete: (id: string) => void;
  onTagAnnotation: (annotationId: string, tagId: string) => void;
  onCreateTag: (label: string) => Tag;
}

export default function HighlightsPanel({
  annotations,
  tags,
  activeId,
  onSelect,
  onUpdateNote,
  onDelete,
  onTagAnnotation,
  onCreateTag,
}: HighlightsPanelProps) {
  const [openTagPickerId, setOpenTagPickerId] = useState<string | null>(null);
  const [newTagInput, setNewTagInput] = useState('');

  const handleExportPDF = () => {
    const doc = new jsPDF();
    let y = 20;
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Document Annotations', 20, y);
    y += 15;

    annotations.forEach(ann => {
      if (y > 260) { doc.addPage(); y = 20; }

      // Tag chips as text
      const tagLabels = ann.tagIds.map(id => tags.find(t => t.id === id)?.label).filter(Boolean);
      if (tagLabels.length > 0) {
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.setFont('helvetica', 'normal');
        doc.text(tagLabels.map(l => `#${l}`).join('  '), 20, y);
        y += 6;
      }

      doc.setFontSize(10);
      doc.setTextColor(80);
      doc.setFont('helvetica', 'italic');
      const highlightLines = doc.splitTextToSize(`"${ann.text}"`, 170);
      doc.text(highlightLines, 20, y);
      y += highlightLines.length * 5 + 4;

      doc.setFontSize(11);
      doc.setTextColor(0);
      doc.setFont('helvetica', 'normal');
      const noteLines = doc.splitTextToSize(ann.note || '(No note)', 170);
      doc.text(noteLines, 20, y);
      y += noteLines.length * 6 + 10;
    });

    doc.save('annotations.pdf');
  };

  const handleTagPickerSubmit = (annotationId: string) => {
    const label = newTagInput.trim();
    if (!label) return;
    const tag = onCreateTag(label);
    onTagAnnotation(annotationId, tag.id);
    setNewTagInput('');
  };

  return (
    <div className="h-full flex flex-col bg-[#FCFAF7]">
      <div className="p-8 flex justify-between items-end border-b border-[#E5E2DD] shrink-0">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest">Recent Highlights</h3>
          <span className="text-[10px] text-gray-400 italic block mt-1">{annotations.length} annotation{annotations.length !== 1 ? 's' : ''}</span>
        </div>
        <button
          onClick={handleExportPDF}
          className="px-4 py-1.5 text-xs bg-[#1A1A1A] text-white rounded-full flex items-center gap-2 hover:bg-black transition-colors"
        >
          <span>Export PDF</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M7 7l10 10M17 7v10H7" />
          </svg>
        </button>
      </div>

      <div
        className="flex-1 overflow-auto p-8 space-y-4 custom-scrollbar"
        onClick={() => { setOpenTagPickerId(null); setNewTagInput(''); }}
      >
        {annotations.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center text-gray-400 mt-10">
            <p className="text-sm">No highlights yet.</p>
            <p className="text-xs mt-2 italic">Select text in the document to annotate.</p>
          </div>
        ) : (
          annotations.map(ann => {
            const annTags = tags.filter(t => ann.tagIds.includes(t.id));
            const unusedTags = tags.filter(t => !ann.tagIds.includes(t.id));

            return (
              <div
                key={ann.id}
                className={cn(
                  'p-5 bg-white border rounded-xl transition-all cursor-pointer relative',
                  activeId === ann.id
                    ? 'border-[#1A1A1A] shadow-[0_2px_12px_rgba(0,0,0,0.06)]'
                    : 'border-[#E5E2DD] hover:border-gray-400'
                )}
                onClick={() => onSelect(ann.id)}
              >
                {/* Tag chips + delete button row */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                    {annTags.map(tag => {
                      const color = getTagColor(tag.colorKey);
                      return (
                        <button
                          key={tag.id}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors hover:opacity-70"
                          style={{ backgroundColor: color.bg, borderColor: color.border, color: color.text }}
                          onClick={e => { e.stopPropagation(); onTagAnnotation(ann.id, tag.id); }}
                          title="Click to remove tag"
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color.dot }} />
                          {tag.label}
                          <svg width="7" height="7" viewBox="0 0 10 10" fill="currentColor">
                            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                        </button>
                      );
                    })}

                    {/* Tag picker trigger */}
                    <div className="relative" onClick={e => e.stopPropagation()}>
                      <button
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border border-dashed border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors"
                        onClick={() => {
                          setOpenTagPickerId(openTagPickerId === ann.id ? null : ann.id);
                          setNewTagInput('');
                        }}
                      >
                        <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
                          <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                        Tag
                      </button>

                      {openTagPickerId === ann.id && (
                        <div className="absolute top-7 left-0 z-20 bg-white border border-[#E5E2DD] rounded-xl shadow-xl p-2 w-48">
                          {unusedTags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mb-2">
                              {unusedTags.map(tag => {
                                const color = getTagColor(tag.colorKey);
                                return (
                                  <button
                                    key={tag.id}
                                    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors hover:scale-105"
                                    style={{ backgroundColor: color.bg, borderColor: color.border, color: color.text }}
                                    onClick={() => { onTagAnnotation(ann.id, tag.id); setOpenTagPickerId(null); }}
                                  >
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color.dot }} />
                                    {tag.label}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          <div className="flex gap-1 border-t border-[#F3F1ED] pt-2">
                            <input
                              autoFocus={unusedTags.length === 0}
                              value={newTagInput}
                              onChange={e => setNewTagInput(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') { e.preventDefault(); handleTagPickerSubmit(ann.id); setOpenTagPickerId(null); }
                                if (e.key === 'Escape') setOpenTagPickerId(null);
                              }}
                              placeholder="New tag…"
                              className="flex-1 text-[10px] px-2 py-1 border border-[#E5E2DD] rounded-md outline-none focus:border-[#1A1A1A] bg-[#FAFAF8]"
                            />
                            <button
                              onClick={() => { handleTagPickerSubmit(ann.id); setOpenTagPickerId(null); }}
                              className="px-2 text-[10px] font-bold bg-[#1A1A1A] text-white rounded-md hover:bg-black"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={e => { e.stopPropagation(); onDelete(ann.id); }}
                    className="text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-red-500 transition-colors shrink-0"
                  >
                    Remove
                  </button>
                </div>

                {/* Highlighted excerpt */}
                <p
                  className="text-xs italic text-gray-600 mb-4 px-2 py-1 leading-relaxed rounded-md border"
                  style={
                    annTags[0]
                      ? { backgroundColor: getTagColor(annTags[0].colorKey).bg, borderColor: getTagColor(annTags[0].colorKey).border + '44' }
                      : { backgroundColor: '#FFFBF0', borderColor: '#E5E2DD' }
                  }
                >
                  "{ann.text}"
                </p>

                {/* Note textarea */}
                <textarea
                  className="w-full text-xs leading-relaxed resize-none outline-none bg-transparent placeholder-gray-400 font-sans"
                  rows={3}
                  placeholder="Record your exegesis here…"
                  value={ann.note}
                  onChange={e => onUpdateNote(ann.id, e.target.value)}
                  onClick={e => e.stopPropagation()}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
