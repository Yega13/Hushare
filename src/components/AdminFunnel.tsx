import type { FunnelStep, PageEngagement, Throughput } from '@/lib/cf-analytics'

// The upload path as a rate, and how long each page held people.
//
// media_uploaded has recorded successes since the beginning, which gives a numerator and no
// denominator: a quiet night and a night where everything failed produce the same shape. Counting
// the step BEFORE each one turns "412 photos uploaded" into "412 of 500 chosen photos arrived", and
// only the second sentence tells you whether anything is wrong.
//
// Counted in FILES, not batches. Somebody choosing forty photos and losing them is a much worse
// event than somebody losing one, and a per-batch count flattens the two into the same row.

const LABELS: Record<string, string> = {
  picked: 'Chose files',
  started: 'Upload began',
  done: 'Landed in the album',
  failed: 'Lost on the way',
}

export default function AdminFunnel({
  funnel, engagement, throughput, color,
}: { funnel: FunnelStep[]; engagement: PageEngagement[]; throughput: Throughput; color: string }) {
  const picked = funnel.find((f) => f.step === 'picked')?.files ?? 0
  const done = funnel.find((f) => f.step === 'done')?.files ?? 0
  const top = Math.max(1, ...funnel.filter((f) => f.step !== 'failed').map((f) => f.files))
  const anyData = funnel.some((f) => f.files > 0)

  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))' }}>
      <div style={{ background: '#FFFFFF', border: '1px solid #E4DAC9', borderRadius: 12, padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#2A211C' }}>Upload funnel</div>
          <div style={{ fontSize: 12, color: '#8A7A66', fontVariantNumeric: 'tabular-nums' }}>
            {picked > 0 ? `${Math.round((done / picked) * 100)}% arrive` : 'no uploads yet'}
          </div>
        </div>

        {/* Throughput, so "uploads feel slow" stops being a feeling. The same complaint fits a slow
            connection, a slow phone and a slow server, and those are three different fixes — this
            says which. Median, because a mean would be whoever has fibre. */}
        {throughput.batches > 0 && (
          <p style={{ fontSize: 11.5, color: '#8A7A66', margin: '0 0 10px', fontVariantNumeric: 'tabular-nums' }}>
            Typical speed{' '}
            <strong style={{ color: '#2A211C' }}>
              {throughput.medianKbps >= 1024
                ? `${(throughput.medianKbps / 1024).toFixed(1)} MB/s`
                : `${throughput.medianKbps.toLocaleString('en-US')} KB/s`}
            </strong>{' '}
            across {throughput.batches.toLocaleString('en-US')} batches
          </p>
        )}

        {!anyData ? (
          <div style={{ fontSize: 12, color: '#A5977F', padding: '10px 0' }}>nothing recorded yet</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {funnel.map((f) => {
              const isLoss = f.step === 'failed'
              return (
                <div key={f.step}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
                    <span style={{ color: isLoss ? '#9B2C2C' : '#5C4A3C' }}>{LABELS[f.step] ?? f.step}</span>
                    <span style={{ color: '#2A211C', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {f.files.toLocaleString('en-US')}
                      {picked > 0 && !isLoss && (
                        <span style={{ color: '#A5977F', fontWeight: 400 }}> · {Math.round((f.files / picked) * 100)}%</span>
                      )}
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: '#F2ECE1', overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.min(100, (f.files / top) * 100)}%`,
                      height: '100%',
                      // Losses are red rather than a lighter shade of the same colour: it is the one
                      // row here that is meant to be alarming.
                      background: isLoss ? '#9B2C2C' : color,
                      opacity: isLoss ? 0.85 : 0.75,
                    }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div style={{ background: '#FFFFFF', border: '1px solid #E4DAC9', borderRadius: 12, padding: '14px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#2A211C', marginBottom: 4 }}>Time on each page</div>
        <p style={{ fontSize: 11, color: '#A5977F', margin: '0 0 10px' }}>
          Median, not average — one tab left open for twenty minutes would otherwise make a page look loved.
        </p>
        {engagement.length === 0 ? (
          <div style={{ fontSize: 12, color: '#A5977F', padding: '6px 0' }}>nothing recorded yet</div>
        ) : (
          <div style={{ display: 'grid', gap: 7 }}>
            {engagement.map((e) => (
              <div key={e.page} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: 12.5 }}>
                <span style={{ color: '#2A211C', textTransform: 'capitalize' }}>{e.page}</span>
                <span style={{ color: '#5C4A3C', fontVariantNumeric: 'tabular-nums', fontSize: 11.5 }}>
                  {e.medianDwell}s · {e.avgScroll}% down · {e.activePct}% touched it
                  <span style={{ color: '#A5977F' }}> · {e.views.toLocaleString('en-US')}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
