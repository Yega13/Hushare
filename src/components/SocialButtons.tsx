import SocialGlyph from '@/components/SocialGlyph'
import { SOCIAL_PROFILES, socialHandleLabel } from '@/lib/social-profiles'

// /about's "find us" buttons, one per network.
//
// A COMPONENT OF ITS OWN SO A TEST CAN RENDER IT. They were inline in /about, which is an async server
// component a test cannot render, so the only check possible was on its source -- and a review showed
// that check passing with the TikTok button pointed at Instagram, because the text it looked for was
// still there. Rendered, the mistake is a link with the wrong host, and tests/social-buttons sees it.
//
// Both buttons show the same handle, so the network name goes in the accessible label: a screen
// reader used to hear the handle twice with nothing to tell the two apart.
//
// Hook-free and no 'use client': it renders inside a server page.

export default function SocialButtons() {
  const handle = socialHandleLabel()
  return (
    <>
      {SOCIAL_PROFILES.map((profile) => (
        <a
          key={profile.network}
          href={profile.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${profile.name} ${handle}`}
          className="hush-press flex items-center gap-2.5 px-6 py-3 rounded-full font-semibold text-sm"
          style={{ background: '#FDFAF5', color: '#630826' }}
        >
          <SocialGlyph network={profile.network} />
          {handle}
        </a>
      ))}
    </>
  )
}
