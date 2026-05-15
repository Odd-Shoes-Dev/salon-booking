'use client';

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="flex-1 py-3 rounded-lg bg-[var(--brand)] text-white text-sm font-medium"
    >
      Print Receipt
    </button>
  );
}
