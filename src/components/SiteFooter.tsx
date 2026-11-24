export default function SiteFooter({ reviewUrl }: { reviewUrl?: string | null }) {
  if (!reviewUrl) return null;

  return (
    <footer className="py-8 px-4 text-center">
      <a
        href={reviewUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
        style={{ backgroundColor: 'var(--brand)' }}
      >
        <span>⭐</span>
        <span>Leave us a Google review</span>
      </a>
    </footer>
  );
}
