import type { PrivacyContent } from './types'
import { INK } from './types'

// English is the BINDING version of this policy. The other locales translate it, and where a
// translation and this file disagree this file governs — stated openly on the translated pages
// rather than hidden in a footnote.
//
// These bodies were lifted verbatim out of privacy/page.tsx when the page became multilingual, so
// the published English text did not change by a single character in the move. The array shape is
// what keeps three languages honest: a section added here with no counterpart in ru.tsx / hy.tsx
// shows up as a gap instead of quietly serving English to a Russian reader.
export const en: PrivacyContent = {
  localeNote: null,
  sections: [
  {
    id: 'who-we-are',
    heading: 'Who is responsible',
    body: (
      <>
          <p>
            Hushare is operated from <strong style={INK}>Yerevan, Armenia</strong>.
            Under data-protection law we are the data controller for the
            information described in this policy, and we are accountable for it.
          </p>
          <p className="mt-3">
            Privacy questions, deletion requests and complaints go to{' '}
            <a
              href="mailto:privacy@hushare.space"
              style={{ color: '#630826', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
            >
              privacy@hushare.space
            </a>
            . We reply within <strong style={INK}>one working day</strong> and
            complete requests within <strong style={INK}>one month</strong>, the
            deadline the GDPR sets. If a request is genuinely complex and will
            take longer than that, we tell you inside the first month and explain
            why.
          </p>
          <p className="mt-3">
            <strong style={INK}>Who decides what happens to an album.</strong>{' '}
            If you create an album, you decide what it is for, who receives the
            link, which features are switched on, and how long it lasts - in the
            language of the GDPR you are the controller of the photographs inside
            it, and we process them on your instructions. We are the controller in
            our own right for a narrower set: accounts, payments, security and
            abuse records, aggregate counts of how the service is used, and
            support correspondence.
          </p>
      </>
    ),
  },
  {
    id: 'what-we-collect',
    heading: 'What we collect',
    body: (
      <>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong style={INK}>Album title</strong> - the name you give your album.
            </li>
            <li>
              <strong style={INK}>Photos and videos</strong> uploaded by you
              or anyone you share the album link with. Photos have their hidden
              camera data - including GPS location, if the phone recorded any -
              removed in your browser before they ever reach us.{' '}
              <strong style={INK}>Videos do not:</strong> they upload as they
              are, so a video may still carry the location it was filmed at.
            </li>
            <li>
              <strong style={INK}>Owner token</strong> - a random string
              embedded in the private link you receive. It is how we recognise
              you as the album creator.
            </li>
            <li>
              <strong style={INK}>Request metadata</strong> - IP address, browser
              string and timestamps, used to stop abuse and spam. Deleted after
              30 days.
            </li>
            <li>
              <strong style={INK}>Live presence</strong> - while a page is open
              we record which page it is, with a short-lived random session id,
              so we can see how many people are using Hushare right now. It is
              not tied to your identity or your account, and each record is
              deleted within 10 minutes of you closing the page.
            </li>
          </ul>
          <p className="mt-3">
            Creating and sharing an album needs{' '}
            <strong style={INK}>no account at all</strong> - and on that path
            we hold nothing that identifies you personally: no name, no email,
            no password. The technical records above (an address your requests
            came from, which page is open) still exist, because a website
            cannot run without them. If you choose to sign in (by email link or Google) to
            keep your albums together or to subscribe, we store your email
            address and, where Google supplies it, your name and profile
            picture. We never ask for a phone number, and we run no advertising
            networks and no identity-based profiling. Section 4 lists every outside
            company that touches any of it, and section 6 covers what is stored
            in your own browser.
          </p>
      </>
    ),
  },
  {
    id: 'how-we-use',
    heading: 'How we use it',
    body: (
      <>
          <ul className="list-disc pl-5 space-y-2">
            <li>To create, store, and display your albums.</li>
            <li>
              To prevent abuse (spam uploads, illegal content) and keep the
              service stable.
            </li>
            <li>
              To understand, in aggregate, how Hushare is used so we can
              improve it.
            </li>
          </ul>
        
          <p className="mt-5">
            <strong style={INK}>Why we are allowed to.</strong> European law
            says we need a specific reason for each of these, not just a good
            intention. Ours:
          </p>
          <ul className="list-disc pl-5 space-y-2 mt-3">
            <li>
              Storing and showing your album, running your account, taking
              payment - because it is the service you asked us for.
            </li>
            <li>
              Blocking spam and abuse, and keeping security records - because we
              have a legitimate interest in the service not being wrecked for
              everyone else. Those records are kept 30 days and never used to
              build a profile of you.
            </li>
            <li>
              Counting how the service is used - the same legitimate interest,
              measured without identifying anyone.
            </li>
            <li>
              Keeping billing records for seven years - because tax law requires
              it.
            </li>
            <li>
              <strong style={INK}>Face search - only with consent</strong> from
              the people whose faces they are. See section 5: this one works
              differently from everything else on the list.
            </li>
          </ul>
      </>
    ),
  },
  {
    id: 'third-parties',
    heading: 'Third-party processors',
    body: (
      <>
          <p>
            To run Hushare we use a small, vetted set of infrastructure
            providers:
          </p>
          <ul className="list-disc pl-5 space-y-2 mt-3">
            <li>
              <strong style={INK}>Supabase</strong> - the database. It holds
              album records, captions, and account details. It does{' '}
              <strong style={INK}>not</strong> hold your photos or videos.
              Hosted in Sydney, Australia.
            </li>
            <li>
              <strong style={INK}>Cloudflare</strong> - this is where your
              photos and videos actually live: photos in R2 storage, videos in
              Stream. Cloudflare also provides the hosting, the content
              delivery network, DDoS protection, and Turnstile, the check that
              tells a person from a bot on our support and report forms.
              Distributed across Cloudflare&apos;s global network.
            </li>
            <li>
              <strong style={INK}>Amazon Web Services</strong> - image analysis
              (Rekognition, in Ireland) for the optional Face Finder and
              race-number search features. A photo is only ever sent to AWS if
              the album owner has switched one of those features on. Albums
              without them are never sent to AWS at all.
            </li>
            <li>
              <strong style={INK}>Resend</strong> - delivery of account and
              notification emails.
            </li>
            <li>
              <strong style={INK}>Polar</strong> - subscription checkout and
              billing. Card details go to Polar and its payment providers; we
              never receive or store them.
            </li>
            <li>
              <strong style={INK}>Cloudflare Workers AI</strong> - the assistant
              in the help bubble. What you type into it is sent to a language
              model running on Cloudflare&apos;s network to write a reply. It
              never sees your photos. Please don&apos;t type anything into it
              you would mind us reading, because if you ask to be put through to
              a person, the conversation is emailed to us.
            </li>
            <li>
              <strong style={INK}>Cloudflare Analytics Engine</strong> - our
              own usage statistics: albums created, photos uploaded, searches
              run, and so on. To be precise about what an event record holds, it
              can include the album&rsquo;s id and, if you were signed in, your
              account id - so this is not fully anonymous, and we would rather
              say that than call it &ldquo;anonymous statistics&rdquo;. It never
              contains your name, your email, or your photos. Questions typed
              into our support chat are also logged here, with obvious personal
              details stripped out first, so we can see what people get stuck on.
              Kept for 90 days.
            </li>
            <li>
              <strong style={INK}>Google (Gmail)</strong> - our support inbox. If
              you email us, report something, or ask the assistant for a human,
              that message is stored in a Google mailbox.
            </li>
          </ul>
          <p className="mt-3">
            These providers process data strictly on our behalf under
            contractual data-processing terms.
          </p>
      </>
    ),
  },
  {
    id: 'face-search',
    heading: 'Face search and race numbers',
    body: (
      <>
          <p>
            Two optional features read the contents of photos. Both are{' '}
            <strong style={INK}>off by default</strong> and only ever run if the
            album owner deliberately switches them on for that album.
          </p>
          <ul className="list-disc pl-5 space-y-2 mt-3">
            <li>
              <strong style={INK}>Face Finder</strong> lets a guest find photos
              of themselves. When it is enabled, photos in that album are sent
              to Amazon Rekognition, which computes a mathematical
              representation of each face - a{' '}
              <strong style={INK}>biometric identifier</strong> - and stores it
              in a face collection belonging to that album alone. A guest
              searching takes a selfie, which is compared against that
              collection and is <strong style={INK}>not stored</strong>. We
              never receive names, and the stored representation cannot be
              turned back into a photograph.
            </li>
            <li>
              <strong style={INK}>Race number search</strong> reads printed
              numbers (such as a runner&rsquo;s bib) so guests can find their
              photos by number. This detects text, not people, and creates no
              biometric data.
            </li>
          </ul>
          <p className="mt-3">
            <strong style={INK}>Who can run a search.</strong> We should be plain
            about this, because the name of the feature suggests otherwise:
            anyone who can open your album can run a face search on it, and
            nothing stops them searching for a face that is not their own. The
            feature finds people; it does not check who is asking. If that is not
            what you want for your album, leave it switched off.
          </p>
          <p className="mt-3">
            Face data is deleted when any one of these happens, whichever comes
            first: the photo it came from is deleted, the album is deleted, the
            owner switches Face Finder off, or{' '}
            <strong style={INK}>90 days pass with no new photo added</strong> to
            the album. That last one runs on its own - nobody has to remember it,
            so an album that has finished its event stops holding face data three
            months later either way. <strong style={INK}>If you are an event organiser,
            telling people is not enough.</strong> A face template is biometric
            data, which European law protects more strictly than almost anything
            else: it is prohibited by default, and the exception we rely on is
            the <strong style={INK}>explicit consent</strong> of the person whose
            face it is. Consent means an active choice they made and that you can
            evidence - not a sign at the venue they may have walked past, and not
            a sentence in an email they may never have opened.
          </p>
          <p className="mt-3">
            In practice that is one unticked box on your entry or invitation
            form. You are welcome to use our wording:{' '}
            <em>
              &ldquo;I agree that photographs of me from this event may be made
              searchable by face, so that I can find my own pictures. I can
              withdraw this at any time.&rdquo;
            </em>{' '}
            Keep a record of who ticked it. If someone leaves it unticked, that
            is a complete answer - they simply do not get face search.
          </p>
          <p className="mt-3">
            If collecting that is impractical,{' '}
            <strong style={INK}>leave Face Finder off and use race-number search
            instead</strong>. It reads the digits printed on a bib, identifies
            nobody, creates no biometric data, and needs consent from no one. At
            a race it finds most of the same photographs.
          </p>
          <p className="mt-3">
            To have face data for a specific person or album removed at any
            time, contact us at the address in the final section and we will
            delete it.
          </p>
      </>
    ),
  },
  {
    id: 'cookies',
    heading: 'Cookies and local storage',
    body: (
      <>
          <p>
            Hushare stores a small amount of data in your own browser, and one
            item of it is genuinely sensitive:
          </p>
          <ul className="list-disc pl-5 space-y-2 mt-3">
            <li>
              <strong style={INK}>Your album management links</strong>, kept in
              local storage so you can get back to albums you created without
              an account. These act as passwords: anyone with access to your
              browser can administer those albums. They never leave your device
              except when you open one.
            </li>
            <li>
              <strong style={INK}>Cookies needed to run the service</strong> -
              the one that keeps you signed in, the one that remembers you
              unlocked a password-protected album, the one that identifies you
              as an album&apos;s owner, and one that counts how many albums
              you have created without an account, so the free limit works.
            </li>
            <li>
              <strong style={INK}>A random id</strong> for the page you are
              reading now and for voting on polls, so a vote is counted once.
              It is not linked to you or to any account.
            </li>
          </ul>
          <p className="mt-3">
            We run <strong style={INK}>no third-party analytics script</strong>,
            no advertising cookies, and no cross-site identifiers. We count
            visits using Cloudflare Web Analytics, which works without a cookie
            and without giving your browser an identifier - there is nothing for
            you to consent to and nothing for you to switch off, because there
            is nothing following you. We used Google Analytics until 17 August
            2026 and removed it.
          </p>
      </>
    ),
  },
  {
    id: 'sharing',
    heading: 'Who can see your album',
    body: (
      <>
          <p>
            Albums are <strong style={INK}>unlisted</strong>. They are not
            indexed by search engines, cannot be browsed from the site, and
            are only reachable by someone who has the link. You decide who
            receives that link. We do not sell, rent, or share your data with
            advertisers - ever.
          </p>
          <p className="mt-3">
            <strong style={INK}>What we never do with your photos.</strong> We do
            not sell or rent them. We do not show adverts against them. We do not
            use them to train AI models - not ours, not anyone else&apos;s. We do
            not let search engines index albums. We never switch face search on
            ourselves for an album; only its owner can do that.
          </p>
          <p className="mt-3">
            In limited circumstances the person who runs Hushare may access
            album content - including photos and videos - where it is necessary
            to keep the service running: to respond to a report or legal request, to investigate
            suspected illegal or abusive content, to comply with applicable law,
            or to help you with a support request you have raised. We access
            content only when there is a specific, legitimate reason to do so -
            never to browse albums out of curiosity, and never for advertising.
          </p>
      </>
    ),
  },
  {
    id: 'retention',
    heading: 'How long we keep things',
    body: (
      <>
          <p>
            Free albums are retained for as long as they remain active. If an
            album sits untouched by everyone for <strong style={INK}>1 year</strong>,
            it is automatically retired and its media is permanently deleted.
            If the album is attached to a Hushare account we email that
            account a warning first, so there is time to download everything.
            If it was created without an account - the default, and the way most
            albums are made - we have no address to write to, and no warning is
            possible. That is the trade for not asking you to sign up, and it is
            the reason we suggest attaching an album you want to keep. Paid plans are not subject to the inactivity rule: those
            albums are kept while the subscription is active and for a further
            year after it ends. You may request deletion of your album at any
            time by emailing us - see section 15.
          </p>
      </>
    ),
  },
  {
    id: 'rights',
    heading: 'Your rights',
    body: (
      <>
          <p>
            Depending on where you live (GDPR in the EU/UK, CCPA in
            California, and equivalent regimes elsewhere), you have the
            right to:
          </p>
          <ul className="list-disc pl-5 space-y-2 mt-3">
            <li>Access the data we hold about your album.</li>
            <li>Request correction or deletion.</li>
            <li>Object to, or restrict, processing.</li>
            <li>
              Export a copy of your album (we already offer a one-click ZIP
              download inside the app).
            </li>
            <li>Lodge a complaint with your local data-protection authority.</li>
          </ul>
          <p className="mt-3">
            To exercise any of these rights, email{' '}
            <a
              href="mailto:privacy@hushare.space"
              style={{ color: '#630826', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
            >
              privacy@hushare.space
            </a>{' '}
            from the address you used to contact us - or, if you never gave
            us one, include your album name and approximate creation date.
          </p>
      </>
    ),
  },
  {
    id: 'children',
    heading: 'Children',
    body: (
      <>
          <p>
            Hushare is not aimed at children under 13 (or the equivalent
            minimum age where you live) as{' '}
            <strong style={INK}>account holders</strong>. That is a legal line,
            not a judgement about the service: collecting personal data from a
            younger child requires verifiable parental consent, and we are not
            set up to obtain it, so we do not knowingly create accounts for
            them. If you believe a child has created an account or an album,
            contact us and we will remove it.
          </p>
          <p className="mt-3">
            A child <em>looking at</em> a family album, or appearing in one, is
            an ordinary use of Hushare and always has been. Opening a shared
            link needs no account and collects essentially nothing.
          </p>
          <p className="mt-3">
            Photos <em>of</em> children are a different question, and a far more
            common one - a school trip, a family wedding, a race with a junior
            category. Hushare has no way to know who is in a photograph, so this
            sits with whoever runs the album: they choose who is photographed,
            who receives the link, and which features are switched on. If you
            are running an album where children will appear, that is yours to
            get right, including any consent a parent or guardian must give
            under your local law.
          </p>
          <p className="mt-3">
            Face search deserves its own line here. A child&rsquo;s face template
            is biometric data exactly as an adult&rsquo;s is, and it needs the
            same explicit consent - the difference is only{' '}
            <strong style={INK}>who is entitled to give it</strong>. For a child
            that is their parent or guardian, nobody else.
          </p>
          <p className="mt-3">
            So it comes down to which one you are. If the children in the album
            are <strong style={INK}>your own</strong> - a family album, a
            birthday, your own kids at a match - you are the person who can
            decide, and you may switch face search on. If they are{' '}
            <strong style={INK}>other people&rsquo;s</strong> children - a school
            event, a club, a race with a junior category - you cannot consent on
            their parents&rsquo; behalf, however well-run your event is. You
            would need each parent&rsquo;s consent, on the entry or permission
            form, the same unticked box as for adults.
          </p>
          <p className="mt-3">
            If you cannot collect that, leave face search off.{' '}
            <strong style={INK}>Race-number search reads junior bibs perfectly
            well</strong>, finds the same photographs, and creates no biometric
            data of anybody - which is why we suggest it for events rather than
            treating it as the lesser option.
          </p>
          <p className="mt-3">
            A parent or guardian can ask us to take down a photograph of their
            child at any time, whether or not they hold the album link, by
            emailing{' '}
            <a
              href="mailto:privacy@hushare.space"
              style={{ color: '#630826', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
            >
              privacy@hushare.space
            </a>{' '}
            with enough detail to identify it. We will remove the photograph and
            any face data derived from it. We will not ask them to prove they
            own the album first.
          </p>
      </>
    ),
  },
  {
    id: 'transfers',
    heading: 'International data transfers',
    body: (
      <>
          <p>
            Hushare is built in Armenia and runs on infrastructure in several
            countries, so your data is processed outside the country you live
            in. Specifically:
          </p>
          <ul className="list-disc pl-5 space-y-2 mt-3">
            <li>Photos and videos: Cloudflare&apos;s global network, served from
              wherever is nearest to the viewer.</li>
            <li>The database (album records, captions, accounts):{' '}
              <strong style={INK}>Sydney, Australia</strong>.</li>
            <li>Face and race-number analysis, when an owner turns it on:{' '}
              <strong style={INK}>Ireland</strong>.</li>
          </ul>
          <p className="mt-3">
            Where such transfers require a legal basis, we rely on standard
            contractual clauses or equivalent safeguards with each provider.
          </p>
      </>
    ),
  },
  {
    id: 'security',
    heading: 'Security',
    body: (
      <>
          <p>
            Your photos are encrypted on the way to us and while they sit on
            our providers&apos; servers. An album can only be opened by someone
            who has its link; if you set a password, that password is needed
            both to see the album and to add to it; and only the management
            link can change anything. We never store your album password
            itself - only a scrambled version of it that cannot be turned back
            into the password. No system is perfectly secure, so share your
            management link only with people you trust.
          </p>
      </>
    ),
  },
  {
    id: 'breach',
    heading: 'If something goes wrong',
    body: (
      <>
          <p>
            If data we hold is exposed, lost, or reached by someone who should
            not have it, we will find out what happened, stop it, and{' '}
            <strong style={INK}>tell the people affected</strong> - in plain
            language, without waiting until we have every detail. You will hear
            what was involved, what we have done about it, and what you should
            do.
          </p>
          <p className="mt-3">
            <strong style={INK}>When.</strong> As soon as we know - not after an
            internal review, and not on a schedule that suits us. We would
            rather tell you something incomplete on the day than something
            complete a week later. If we learn more afterwards, you get that too.
          </p>
          <p className="mt-3">
            If you are an event organiser, the same applies to you first: the
            people in your album are your responsibility as much as ours, and
            you cannot warn them if we have not warned you.
          </p>
          <p className="mt-3">
            We are not going to promise you a regulator filing we cannot
            currently carry out. What we do promise is that you hear it from us,
            quickly, rather than us quietly hoping you never notice.
          </p>
      </>
    ),
  },
  {
    id: 'changes',
    heading: 'Changes to this policy',
    body: (
      <>
          <p>
            We will post updates here. The &ldquo;Last updated&rdquo; date at
            the top reflects the most recent change. Material changes will be
            surfaced inside the product before they take effect.
          </p>
      </>
    ),
  },
  {
    id: 'contact',
    heading: 'Contact',
    body: (
      <>
          <p>
            Questions, requests, complaints - all of it comes to one
            address:{' '}
            <a
              href="mailto:privacy@hushare.space"
              style={{ color: '#630826', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
            >
              privacy@hushare.space
            </a>
            . A human replies.
          </p>
      </>
    ),
  },
  ],
}
