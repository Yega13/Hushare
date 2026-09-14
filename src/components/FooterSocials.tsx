import SocialGlyph from '@/components/SocialGlyph'
import { SOCIAL_PROFILES, socialHandleLabel } from '@/lib/social-profiles'

// THE SOCIALS, AS TWO PRINTS.
//
// Not a row of grey icons, which is what every footer on the web already has and what nobody's eye
// stops on. Hushare is a place photographs are handed around, so the accounts are handed over the
// same way: two small instant prints, dropped slightly askew, the network's mark where the picture
// would be. Hovering one picks it up -- it straightens and lifts off the page.
//
// The handle is in the site's handwriting face, which exists for exactly one other thing: the title
// written on the back of a flipped photo. Same gesture, same hand.
//
// NO NEW WORDS. The sentence is about.followPre / about.followPost, already translated into all three
// languages for /about. The network names are proper nouns and the handle is a handle, so nothing
// here needs a translation that nobody has proofread.
//
// Hook-free, so it has no reason to be a client component of its own; SiteFooter is one already.

type Props = {
  followPre: string
  followPost: string
}

export default function FooterSocials({ followPre, followPost }: Props) {
  const handle = socialHandleLabel()
  return (
    <div className="hush-foot-social">
      <div className="hush-foot-prints">
        {SOCIAL_PROFILES.map((profile) => (
          <a
            key={profile.network}
            href={profile.url}
            target="_blank"
            rel="noopener noreferrer"
            // Both prints show the same handle, so the network name is what tells a screen reader which
            // is which. NO title attribute: read from Chrome's accessibility tree, title="Instagram"
            // became a description announced after the name, so the network was said twice, and a title
            // equal to the label was exposed the same way rather than suppressed. The mark itself is the
            // visual cue.
            aria-label={`${profile.name} ${handle}`}
            className={`hush-foot-print hush-foot-print--${profile.network}`}
          >
            <span className="hush-foot-print-photo">
              <SocialGlyph network={profile.network} size={18} />
            </span>
          </a>
        ))}
      </div>
      <p className="hush-foot-follow">
        {followPre}{' '}
        {/* <body> already carries translate="no" for the whole app (see app/layout.tsx), so on this
            site it changes nothing. It is here so the handle stays a handle if this component is ever
            rendered outside that layout -- a browser translation would otherwise treat it as words. */}
        <span className="hush-foot-handle" translate="no">{handle}</span>{' '}
        {followPost}
      </p>
    </div>
  )
}
