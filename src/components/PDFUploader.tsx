import React, { useCallback, useState } from 'react';
import { cn } from '../lib/utils';

interface PDFUploaderProps {
  onUpload: (file: File) => void;
  isLoading: boolean;
}

export default function PDFUploader({ onUpload, isLoading }: PDFUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragging(true);
    } else if (e.type === 'dragleave') {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0 && files[0].type === 'application/pdf') {
      onUpload(files[0]);
    } else {
      alert('Please upload a PDF file.');
    }
  }, [onUpload]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      if (e.target.files[0].type === 'application/pdf') {
         onUpload(e.target.files[0]);
      } else {
         alert('Please upload a PDF file.');
      }
    }
  }, [onUpload]);

  return (
    <div 
      className={cn(
        "flex flex-col items-center justify-center w-full max-w-xl mx-auto p-16 border border-[#E5E2DD] bg-white shadow-[0_2px_10px_rgba(0,0,0,0.02)] transition-all duration-300",
        isDragging ? "border-[#1A1A1A] bg-[#f8f6f3]" : "hover:border-gray-400",
        isLoading && "opacity-50 pointer-events-none"
      )}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      {isLoading ? (
        <svg className="animate-spin w-8 h-8 text-[#1A1A1A] mb-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
      ) : (
        <div className="w-12 h-12 mb-6 rounded-full border border border-[#1A1A1A] flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 5v14M5 12l7-7 7 7"/></svg>
        </div>
      )}
      
      <h3 className="text-xs font-bold uppercase tracking-widest text-[#1A1A1A] mb-2">
        {isLoading ? 'Reading Document' : 'Initialize Protocol'}
      </h3>
      <p className="text-xs text-gray-400 mb-8 max-w-xs text-center leading-relaxed">
        {isLoading
          ? 'Extracting text from document…'
          : 'Drag a PDF document onto this surface or initiate a manual selection process.'}
      </p>
      
      <button 
        className="relative px-6 py-2.5 bg-[#1A1A1A] text-white text-[10px] font-bold uppercase tracking-widest rounded-full hover:bg-black transition-colors"
        disabled={isLoading}
      >
        <span>{isLoading ? 'Processing...' : 'Browse Local Files'}</span>
        <input 
          type="file" 
          accept="application/pdf"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          onChange={handleChange}
        />
      </button>
    </div>
  );
}
