import Image from "next/image"
import Link from "next/link"
import { ArrowRight, Check, QrCode, ShieldCheck } from "lucide-react"
import FaqList from "@/components/FaqList"
import HamburgerMenu from "@/components/HamburgerMenu"
import AccountNavLink from "@/components/AccountNavLink"

type SeoLandingPageProps = {
  eyebrow: string
  title: string
  intro: string
  image: string
  imageAlt: string
  useCases: string[]
  details: Array<{
    title: string
    body: string
  }>
  faq: Array<{
    q: string
    a: string
  }>
  jsonLd: Record<string, unknown>
}

export default function SeoLandingPage({
  eyebrow,
  title,
  intro,
  image,
  imageAlt,
  useCases,
  details,
  faq,
  jsonLd,
}: SeoLandingPageProps) {
  return (
    <main style={{ background: "#FDFAF5", fontFamily: "var(--font-sans)" }} className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          // JSON.stringify does not escape </script>, which would break out of the script block.
          // Unicode-escape the forward slash to neutralise any </script> in the serialised value.
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />

      <nav
        className="hush-nav sticky top-0 z-50 flex items-center justify-between"
        style={{
          background: "rgba(253, 250, 245, 0.9)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(221, 213, 197, 0.75)",
        }}
      >
        <Link href="/" className="flex items-center" aria-label="Hushare home">
          <Image
            src="/logo/logo-dark-transparent.png"
            alt="Hushare"
            width={618}
            height={146}
            className="hush-logo"
            style={{ width: "auto" }}
            draggable={false}
          />
        </Link>
        <HamburgerMenu>
          <Link href="/pricing" className="text-sm font-medium hover:underline" style={{ color: "#630826" }}>
            Pricing
          </Link>
          <Link href="/about" className="text-sm font-medium hover:underline" style={{ color: "#630826" }}>
            About
          </Link>
          <Link href="/collabs" className="text-sm font-medium hover:underline" style={{ color: "#630826" }}>
            Collabs
          </Link>
          <Link href="/support" className="text-sm font-medium hover:underline" style={{ color: "#630826" }}>
            Support
          </Link>
          <AccountNavLink />
        </HamburgerMenu>
      </nav>

      <section className="hush-container-xl grid gap-10 py-10 md:grid-cols-[minmax(0,0.9fr)_minmax(360px,0.8fr)] md:items-center md:py-16">
        <div>
          <p className="mb-4 text-xs font-semibold uppercase" style={{ color: "#8B6F4E", letterSpacing: "0.16em" }}>
            {eyebrow}
          </p>
          <h1 style={{ color: "#630826", fontFamily: "var(--font-serif)", fontSize: "clamp(2.4rem, 6vw, 5rem)", fontWeight: 700, lineHeight: 1.02 }}>
            {title}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed" style={{ color: "#5C4A3C" }}>
            {intro}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/"
              className="hush-press inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 font-semibold"
              style={{ background: "#630826", color: "#FDFAF5" }}
            >
              Create an album <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center rounded-full px-6 py-3 font-semibold"
              style={{ border: "1px solid #DDD5C5", color: "#630826" }}
            >
              Compare plans
            </Link>
          </div>
        </div>
        <div
          className="relative overflow-hidden rounded-[8px]"
          style={{ minHeight: "clamp(360px, 48vw, 560px)", border: "1px solid rgba(221, 213, 197, 0.85)", boxShadow: "0 22px 60px rgba(99,8,38,0.16)" }}
        >
          <Image src={image} alt={imageAlt} fill sizes="(min-width: 768px) 40vw, 100vw" className="object-cover" priority draggable={false} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(99,8,38,0.35), transparent 55%)" }} />
        </div>
      </section>

      <section className="hush-container-xl grid gap-4 pb-12 md:grid-cols-3">
        {useCases.map((useCase) => (
          <div key={useCase} className="flex items-start gap-3 rounded-[8px] p-5" style={{ background: "#FFFFFF", border: "1px solid #E8E0D0" }}>
            <Check className="mt-0.5 h-5 w-5 flex-none" style={{ color: "#630826" }} />
            <p className="text-sm leading-relaxed" style={{ color: "#5C4A3C" }}>{useCase}</p>
          </div>
        ))}
      </section>

      <section className="hush-container-xl grid gap-5 pb-14 md:grid-cols-3">
        {details.map((detail, index) => {
          const Icon = index === 1 ? QrCode : index === 2 ? ShieldCheck : Check
          return (
            <article key={detail.title} className="rounded-[8px] p-6" style={{ background: "#FBF4E4", border: "1px solid rgba(196,166,120,0.35)" }}>
              <Icon className="mb-5 h-6 w-6" style={{ color: "#7C4A2D" }} />
              <h2 className="mb-3 text-xl font-semibold" style={{ color: "#630826", fontFamily: "var(--font-serif)" }}>
                {detail.title}
              </h2>
              <p className="text-sm leading-relaxed" style={{ color: "#5C4A3C" }}>
                {detail.body}
              </p>
            </article>
          )
        })}
      </section>

      <section className="hush-readable pb-20">
        <div className="mb-8 flex items-center gap-6">
          <div className="h-px flex-1" style={{ background: "#E8E0D0" }} />
          <h2 style={{ color: "#630826", fontFamily: "var(--font-serif)", fontSize: "1.4rem", fontWeight: 700, letterSpacing: "0.22em", lineHeight: 1, whiteSpace: "nowrap" }}>
            FAQ
          </h2>
          <div className="h-px flex-1" style={{ background: "#E8E0D0" }} />
        </div>
        <div
          className="hush-reveal rounded-[8px] px-6 py-2 sm:px-10 sm:py-4"
          style={{ background: "#FBF4E4", border: "1px solid rgba(196,166,120,0.35)", boxShadow: "0 10px 36px rgba(99,8,38,0.08)" }}
        >
          <FaqList items={faq.map((item) => ({ q: item.q, a: item.a }))} compactCount={6} plusSize={26} />
        </div>
      </section>
    </main>
  )
}
