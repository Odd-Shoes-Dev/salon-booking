'use client';

import { useState } from 'react';

interface Props {
  captureTargetId: string;
  fileName: string;
}

export default function PrintButton({ captureTargetId, fileName }: Props) {
  const [downloading, setDownloading] = useState(false);

  const downloadImage = async () => {
    const el = document.getElementById(captureTargetId);
    if (!el) return;
    setDownloading(true);
    try {
      const { default: html2canvas } = await import('html2canvas-pro');
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#f8fafc' });
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = fileName;
      a.click();
    } catch (err) {
      console.error('downloadImage error:', err);
      alert('Failed to generate image. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => window.print()}
        className="flex-1 py-3 rounded-lg bg-[var(--brand)] text-white text-sm font-medium"
      >
        Print Receipt
      </button>
      <button
        onClick={downloadImage}
        disabled={downloading}
        className="flex-1 py-3 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium disabled:opacity-50"
      >
        {downloading ? 'Generating…' : 'Download Image'}
      </button>
    </>
  );
}
