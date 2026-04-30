import React, { useState } from 'react';
import { cn } from '../lib/utils';
import type { DocumentSummary } from '../lib/api';

interface DocumentLibraryProps {
  documents: DocumentSummary[];
  isLoading: boolean;
  isUploading: boolean;
  errorMsg: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onUpload: (file: File) => void;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1)   return 'just now';
  if (minutes < 60)  return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)    return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7)      return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5)     return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export default function DocumentLibrary({
  documents,
  isLoading,
  isUploading,
  errorMsg,
  onOpen,
  onDelete,
  onUpload,
}: DocumentLibraryProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(e.type === 'dragenter' || e.type === 'dragover');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.type === 'application/pdf') onUpload(file);
  };

  return (
    <div
      className="min-h-screen bg-[#FCFAF7] text-[#1A1A1A] font-sans flex flex-col"
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#FCFAF7]/90 border-2 border-dashed border-[#1A1A1A] pointer-events-none">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-widest">Drop PDF to open</p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="h-16 border-b border-[#E5E2DD] px-10 flex items-center justify-between shrink-0">
        <h1 className="text-xl font-serif italic tracking-tight">
          Textura<span className="text-xs align-top font-sans font-normal ml-1 opacity-40">v2.0</span>
        </h1>

        <label className={cn(
          'flex items-center gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-widest rounded-full cursor-pointer transition-colors',
          isUploading
            ? 'bg-[#F3F1ED] text-gray-400 pointer-events-none'
            : 'bg-[#1A1A1A] text-white hover:bg-black'
        )}>
          {isUploading ? (
            <>
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Processing…
            </>
          ) : (
            <>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12l7-7 7 7" />
              </svg>
              Upload PDF
            </>
          )}
          <input
            type="file"
            accept="application/pdf"
            className="sr-only"
            disabled={isUploading}
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.target.value = '';
            }}
          />
        </label>
      </header>

      <main className="flex-1 px-10 py-10 max-w-6xl mx-auto w-full">

        {/* Error */}
        {errorMsg && (
          <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            <strong className="font-semibold block mb-0.5">Error:</strong>
            {errorMsg}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <svg className="animate-spin w-6 h-6 text-gray-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : documents.length === 0 ? (
          /* Empty state — full upload zone */
          <div className="flex flex-col items-center justify-center min-h-[60vh]">
            <div className="text-center mb-10">
              <p className="text-xs tracking-widest uppercase text-gray-400 font-semibold">Your Library is Empty</p>
              <p className="text-sm text-gray-400 mt-2">Upload a PDF to begin annotating</p>
            </div>
            <label className={cn(
              'flex flex-col items-center justify-center w-full max-w-md p-16 border border-[#E5E2DD] bg-white cursor-pointer transition-all duration-200',
              isUploading
                ? 'opacity-50 pointer-events-none'
                : 'hover:border-[#1A1A1A]'
            )}>
              {isUploading ? (
                <svg className="animate-spin w-8 h-8 text-[#1A1A1A] mb-6" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <div className="w-12 h-12 mb-6 rounded-full border border-[#1A1A1A] flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 5v14M5 12l7-7 7 7" />
                  </svg>
                </div>
              )}
              <span className="text-xs font-bold uppercase tracking-widest mb-2">
                {isUploading ? 'Processing Document' : 'Drop PDF or Browse'}
              </span>
              <span className="text-xs text-gray-400">
                {isUploading ? 'Extracting text…' : 'PDF documents up to 200 MB'}
              </span>
              <input type="file" accept="application/pdf" className="sr-only"
                disabled={isUploading}
                onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }}
              />
            </label>
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between mb-8">
              <h2 className="text-xs font-bold uppercase tracking-widest">
                Your Library
                <span className="ml-3 text-gray-400 font-normal normal-case tracking-normal">
                  {documents.length} document{documents.length !== 1 ? 's' : ''}
                </span>
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {documents.map(doc => (
                <div
                  key={doc.id}
                  className="group relative bg-white border border-[#E5E2DD] rounded-xl p-6 cursor-pointer hover:border-[#1A1A1A] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] transition-all duration-200"
                  onClick={() => onOpen(doc.id)}
                >
                  {/* Delete button */}
                  <button
                    className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500"
                    onClick={e => { e.stopPropagation(); setConfirmDeleteId(doc.id); }}
                    title="Delete document"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                    </svg>
                  </button>

                  {/* File icon */}
                  <div className="w-8 h-10 mb-4 border border-[#E5E2DD] rounded-sm flex items-end justify-center pb-1 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-0 h-0 border-l-[8px] border-l-[#E5E2DD] border-b-[8px] border-b-white" />
                    <span className="text-[7px] font-bold text-gray-400 uppercase tracking-wider">PDF</span>
                  </div>

                  <p className="text-sm font-semibold text-[#1A1A1A] mb-1 truncate pr-6" title={doc.originalName}>
                    {doc.originalName}
                  </p>
                  <p className="text-[10px] text-gray-400 mb-4">{timeAgo(doc.updatedAt)}</p>

                  <div className="flex items-center gap-4 text-[10px] text-gray-500">
                    <span className="flex items-center gap-1">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" />
                      </svg>
                      {doc.tagCount} tag{doc.tagCount !== 1 ? 's' : ''}
                    </span>
                    <span className="flex items-center gap-1">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      {doc.annotationCount} note{doc.annotationCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {/* Delete confirmation dialog */}
      {confirmDeleteId && (() => {
        const doc = documents.find(d => d.id === confirmDeleteId);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
            <div
              className="bg-white border border-[#E5E2DD] rounded-2xl p-8 shadow-2xl max-w-sm w-full mx-4"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-sm font-bold mb-2">Delete document?</h3>
              <p className="text-xs text-gray-500 mb-6 leading-relaxed">
                <strong className="text-[#1A1A1A]">{doc?.originalName}</strong> and all its
                annotations, tags, and connections will be permanently removed.
              </p>
              <div className="flex gap-3">
                <button
                  className="flex-1 py-2.5 text-xs font-bold uppercase tracking-widest border border-[#E5E2DD] rounded-lg hover:bg-[#F9F7F4] transition-colors"
                  onClick={() => setConfirmDeleteId(null)}
                >
                  Cancel
                </button>
                <button
                  className="flex-1 py-2.5 text-xs font-bold uppercase tracking-widest bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                  onClick={() => { onDelete(confirmDeleteId); setConfirmDeleteId(null); }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
