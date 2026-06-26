export default function AlbumSkeleton() {
  return (
    <div className="min-h-dvh" style={{ background: '#FDFAF5' }}>
      <style>{`
        @keyframes hush-shimmer {
          0%   { background-position: -400px 0 }
          100% { background-position: 400px 0 }
        }
        .hush-shimmer {
          background: linear-gradient(90deg, #EDE5D8 25%, #F5EFE6 50%, #EDE5D8 75%);
          background-size: 800px 100%;
          animation: hush-shimmer 1.4s ease-in-out infinite;
          border-radius: 8px;
        }
      `}</style>

      {/* Header */}
      <div className="flex flex-col items-center pt-10 pb-6 px-4 gap-3">
        <div className="hush-shimmer" style={{ width: 48, height: 48, borderRadius: '50%' }} />
        <div className="hush-shimmer" style={{ width: 220, height: 22 }} />
        <div className="hush-shimmer" style={{ width: 140, height: 14, marginTop: 4 }} />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-center gap-3 pb-6 px-4">
        {[88, 104, 96].map((w, i) => (
          <div key={i} className="hush-shimmer" style={{ width: w, height: 38, borderRadius: 20 }} />
        ))}
      </div>

      {/* Photo grid */}
      <div
        className="grid px-4 pb-10 gap-2"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', maxWidth: 900, margin: '0 auto' }}
      >
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="hush-shimmer"
            style={{ aspectRatio: '1', borderRadius: 12, animationDelay: `${(i % 4) * 0.1}s` }}
          />
        ))}
      </div>
    </div>
  )
}
