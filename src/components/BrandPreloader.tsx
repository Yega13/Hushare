import Image from 'next/image'

type Props = {
  label?: string
}

export default function BrandPreloader({ label = 'Loading' }: Props) {
  return (
    <div className="hush-brand-preloader" role="status" aria-live="polite" aria-label={label}>
      <div className="hush-line-reveal-loader" aria-hidden="true">
        <Image
          src="/logo/logo-dark-transparent.png"
          alt=""
          width={618}
          height={146}
          priority
          className="hush-line-reveal-logo hush-line-reveal-logo-base"
        />
        <Image
          src="/logo/logo-dark-transparent.png"
          alt=""
          width={618}
          height={146}
          priority
          className="hush-line-reveal-logo hush-line-reveal-logo-fill"
        />
        <span className="hush-line-reveal-track" />
        <span className="hush-line-reveal-sweep" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  )
}
