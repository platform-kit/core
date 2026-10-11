---
title: Every section
route: /sections
seoTitle: Every section, once — Northlight Press
description: Every section on one page, each with real copy — the reference the press builds its own pages from.
sections:
  - component: Hero
    props:
      layout: split
      eyebrow: Every section, once
      lines: ['Short books.', 'Read whole.', 'Kept for good.']
      sub: Every section this site can put on a page, from the opener to the close, with real copy in each.
      cta: Browse the library
      href: /content
      cta2: See the pricing
      href2: /pricing
      visual:
        kind: frame
        image: /img/pages/library.webp
        alt: The library, as a reader sees it
      rating:
        stars: 4.9
        line: '**4.9** from 1,200 readers'
      stats:
        - value: '4'
          label: books in print
        - value: '82%'
          label: finish the book
        - value: '11 min'
          label: a chapter
      float:
        value: '12,000+'
        line: readers this year
  - component: Logos
    props:
      heading: Sold through
      layout: row
      logos:
        - name: Bookshop
        - name: Blackwell's
        - name: Daunt
        - name: Powell's
        - name: The Strand
      rating:
        stars: 5
        line: Rated **5.0** on Bookshop
  - component: Perks
    props:
      tone: wash
      items:
        - icon: globe
          title: Ships worldwide
          body: From $5
        - icon: lock
          title: Secure payment
          body: Cards and wallets
        - icon: clock
          title: 30 days to return
          body: No questions asked
        - icon: chat
          title: A person answers
          body: Weekdays, 9 to 5
  - component: Features
    props:
      anchor: features
      eyebrow: What you get
      heading: Everything a book needs. *Nothing it doesn't.*
      lead: A short book, read whole, kept for good — and the few things around it that make the reading stick.
      columns: 3
      variant: cards
      items:
        - icon: book
          title: Read a chapter a day
          body: Every book is cut into chapters you can finish over coffee. Your place is kept on any device.
          highlight: true
        - icon: doc
          title: The short version
          body: A summary beside every chapter that loses nothing, and the two or three ideas to keep.
        - icon: check
          title: Test yourself
          body: A quiz per chapter. Pass it and the chapter is yours — bronze, silver, gold across the book.
        - icon: pen
          title: Highlights kept
          body: Mark a line and it waits for you, in the book and on your shelf.
        - icon: headphones
          title: Listen instead
          body: Every chapter spoken aloud, at the pace you choose.
        - icon: users
          title: Ask a coach
          body: A person who has read the book, when a chapter raises a question.
  - component: Features
    props:
      eyebrow: The companion
      heading: The same argument, *in a third of the words*.
      variant: list
      side: right
      image: /img/pages/editor.webp
      alt: A chapter and its companion, side by side
      cta: Open a book
      href: /content
      items:
        - icon: check
          title: Written by the editors
          body: Never a machine. Every summary is read against the chapter twice.
        - icon: check
          title: The same chapters, in the same order
          body: Nothing is moved, nothing is skipped.
        - icon: check
          title: Never sold as the book itself
          body: The companion sits beside the text; it does not replace it.
  - component: Bento
    props:
      anchor: bento
      eyebrow: One book, four ways
      heading: However you like it.
      columns: 3
      items:
        - kind: picture
          title: On the shelf
          body: Printed on demand, shipped worldwide.
          image: /img/store/books.webp
          size: 2x1
        - kind: stat
          value: '82%'
          label: finish the book they start
          size: 1x1
          tone: ink
        - kind: feature
          icon: headphones
          title: Listen
          body: Every chapter, spoken at the pace you choose.
          size: 1x1
        - kind: list
          icon: pen
          title: Keep
          points:
            - Highlights, in the book and on the shelf
            - Notes beside any line
            - Your place, on any device
          size: 1x2
        - kind: quote
          quote: A book is a conversation you can have at **any hour**.
          name: Ada Finch
          label: Editor
          size: 1x1
          tone: wash
        - kind: feature
          icon: users
          title: Ask a coach
          body: A person who has read the book.
          href: /pricing
          label: See how
          size: 1x1
  - component: Bento
    props:
      layout: beside
      cascade: true
      gap: tight
      eyebrow: The shelf
      heading: Four books. *One evening each.*
      lead: The tiles scroll forever beside the words — the cascade. Every one a picture, a number or a line.
      columns: 3
      items:
        - kind: picture
          image: /static/plain-words-d215884c.webp
          size: 1x2
        - kind: picture
          image: /img/articles/companion.webp
          size: 2x1
        - kind: stat
          value: '48'
          label: chapters
          size: 1x1
          tone: accent
        - kind: picture
          image: /static/the-quiet-room-e63f8713.webp
          size: 1x2
        - kind: picture
          image: /img/articles/first-hour.webp
          size: 1x1
        - kind: picture
          image: /static/working-hours-b83bf6ae.webp
          size: 1x2
        - kind: stat
          value: '11'
          label: minutes a chapter
          size: 1x1
          tone: ink
        - kind: picture
          image: /img/articles/autumn-list.webp
          size: 2x1
  - component: Steps
    props:
      anchor: how
      eyebrow: How it works
      heading: Three steps, and you are reading.
      layout: across
      items:
        - title: Pick a book
          body: Open any title and read the first chapters free — no account, no card.
        - title: Keep what you learned
          body: A short quiz after each chapter; the highlights you mark are kept.
        - title: Come back tomorrow
          body: Your place is saved, on any device, for as long as you like.
  - component: Steps
    props:
      tone: wash
      eyebrow: From the manuscript to the shelf
      heading: How a Northlight book is made.
      layout: path
      items:
        - title: Read
          body: Two editors, twice each.
          image: /img/articles/first-hour.webp
        - title: Cut
          body: To a length that gets finished.
          image: /img/articles/markdown.webp
        - title: Set
          body: In type, for the page and the screen.
          image: /img/articles/companion.webp
        - title: Print
          body: On demand, and on the shelf.
          image: /img/store/print.webp
  - component: Split
    props:
      eyebrow: The companion
      heading: A summary that *loses nothing*.
      body: |
        Beside every chapter sits its companion: the same argument in a third of the words, the two or three ideas worth keeping, and a short quiz to make sure they stuck.

        Switch between the two with one tap. Read the short version first, or after — the book does not mind.
      image: /img/pages/editor.webp
      alt: The editor, with a chapter and its companion side by side
      side: left
      points:
        - icon: check
          text: Written by the editors, not a machine
        - icon: check
          text: The same chapters, in the same order
      cta: Open a book
      href: /content
  - component: Stats
    props:
      tone: ink
      layout: beside
      eyebrow: The shelf in numbers
      heading: Small press, *whole* readers.
      lead: Every number here is a reader who finished. That is the only one we watch.
      stats:
        - value: '4'
          label: Books in print
          note: two more this autumn
        - value: '11'
          label: Minutes a chapter
          note: on average
        - value: '82%'
          label: Finish the book
          note: of readers who start one
        - stars: 4.9
          label: Average rating
          note: from 1,200 reviews
  - component: Testimonials
    props:
      anchor: readers
      eyebrow: In their words
      heading: What readers say
      layout: grid
      more: See all 120 reviews
      moreHref: /content/articles
      items:
        - quote: I finished a book for the first time in years — **in one evening**, on the train, without meaning to.
          name: Maya Chen
          role: Reader since 2024
          stars: 5
        - quote: The summaries are **honest**. Nothing is dumbed down, and nothing is padded either.
          name: Ola Berg
          role: Teacher
          stars: 5
        - quote: Every chapter ends with something I can actually do tomorrow morning.
          name: Sam Reyes
          role: Designer
          stars: 4
  - component: Testimonials
    props:
      eyebrow: One at a time
      layout: switcher
      items:
        - quote: I read The Quiet Room on a Sunday and **rearranged my week** by Monday.
          name: Priya Nair
          role: Founder, Ledger
          stats:
            - value: '3 weeks'
              label: to a new routine
            - value: '65%'
              label: fewer late nights
        - quote: The print edition is the nicest object on my desk.
          name: Jonas Weber
          role: Architect
        - quote: Working Hours paid for itself in the first week — I stopped answering mail after six.
          name: Léa Fontaine
          role: Editor
  - component: Quote
    props:
      quote: A book is a conversation you can have at *any hour*.
      name: Ada Finch
      role: Editor, Northlight Press
  - component: Testimonials
    props:
      layout: marquee
      items:
        - quote: Finished on the train.
          name: Maya Chen
          role: Reader
          stars: 5
        - quote: Honest summaries. Nothing padded.
          name: Ola Berg
          role: Teacher
          stars: 5
        - quote: Something to do tomorrow morning.
          name: Sam Reyes
          role: Designer
          stars: 4
        - quote: Rearranged my week by Monday.
          name: Priya Nair
          role: Founder
          stars: 5
        - quote: The nicest object on my desk.
          name: Jonas Weber
          role: Architect
          stars: 5
        - quote: I stopped answering mail after six.
          name: Léa Fontaine
          role: Editor
          stars: 5
  - component: Pricing
    props:
      anchor: pricing
      eyebrow: Pricing
      heading: Simple, and you can leave.
      featuredLabel: Most readers
      featuredTone: ink
      tiers:
        - name: Free
          price: $0
          tagline: The first chapters of every book.
          features: [The first chapters, The companion beside them, Your place kept]
          cta: Start reading
          href: /content
        - name: Member
          price: $9
          per: a month
          tagline: Every book, whole, and every chapter read aloud.
          features: [Every book whole, Every chapter read aloud, Highlights and notes kept, A coach when you want one]
          cta: Join
          href: /pricing
          featured: true
        - name: Print
          price: from $24
          tagline: A copy on the shelf, shipped worldwide.
          features: [The printed book, The files that go with it, Free shipping in the US]
          cta: Browse the shelf
          href: /store
      compare:
        heading: Compare the plans
        rows:
          - label: The first chapters
            cells: ['yes', 'yes', 'yes']
          - label: Every book, whole
            cells: ['no', 'yes', 'One book']
          - label: Read aloud
            cells: ['no', 'yes', 'no']
          - label: Highlights kept
            cells: ['no', 'yes', 'no']
          - label: On the shelf
            cells: ['no', 'no', 'yes']
  - component: Compare
    props:
      eyebrow: Three ways to have a book
      heading: Which one is for you?
      columns:
        - name: Free
          note: $0
        - name: Member
          note: $9 a month
          featured: true
          cta: Join
          href: /pricing
        - name: Print
          note: from $24
          cta: Browse
          href: /store
      rows:
        - label: The first chapters
          cells: ['yes', 'yes', 'yes']
        - label: Every book, whole
          cells: ['no', 'yes', 'One book']
        - label: The companion beside each chapter
          cells: ['no', 'yes', 'yes']
        - label: Highlights kept
          cells: ['no', 'yes', 'no']
        - label: On the shelf
          cells: ['no', 'no', 'yes']
  - component: FAQ
    props:
      anchor: questions
      eyebrow: Questions
      heading: Asked often
      lead: The things people write in about before they buy.
      layout: columns
      items:
        - question: Do I need an account to read?
          answer: Not for the first chapters of any book. An account keeps your place, your highlights and your quiz results — and opens the rest as a member.
        - question: Is the short version a replacement for the book?
          answer: No. It is the same argument in fewer words, written by our editors, and it sits *beside* the chapter, never instead of it.
        - question: Can I cancel any time?
          answer: Yes. Cancel from your account and you keep access to the end of the period you paid for. No calls, no forms.
        - question: Where do you ship printed books?
          answer: Everywhere the post goes. US orders ship from Portland; the rest of the world from Antwerp.
      more:
        heading: Still have a question?
        body: A person answers, weekdays nine to five.
        cta: Write to us
        href: /about
  - component: Team
    props:
      eyebrow: The press
      heading: Two editors and a printer.
      layout: rows
      people:
        - name: Ada Finch
          role: Editor
          bio: Reads every manuscript twice. Wrote Plain Words on the second reading, and has not stopped cutting since.
          links:
            - label: LinkedIn
              href: https://example.com
            - label: Letters
              href: /content/articles
        - name: Maren Ekholm
          role: Editor
          bio: Keeps the companions honest. Cuts more than she keeps.
          links:
            - label: X
              href: https://example.com
        - name: Tomas Reyes
          role: Design & print
          bio: Sets the type, chooses the paper, and argues about the spine.
          links:
            - label: Instagram
              href: https://example.com
            - label: Mail
              href: mailto:hello@northlight.example.com
  - component: Integrations
    props:
      eyebrow: Works with
      heading: Connects to what *you already use*.
      lead: Your highlights where you write, your books where you read, a word where you talk.
      layout: orbit
      cta: See every integration
      href: /about
      items:
        - name: Slack
        - name: Notion
        - name: Kindle
        - name: Obsidian
        - name: Readwise
        - name: Pocket
        - name: Apple Books
        - name: Zapier
  - component: Gallery
    props:
      eyebrow: On the shelf
      heading: The books, as objects.
      columns: 4
      shape: tall
      items:
        - image: /static/plain-words-d215884c.webp
          caption: Plain Words — Ada Finch
        - image: /static/the-field-guide-06c9188b.webp
          caption: The Field Guide — the editors
        - image: /static/the-quiet-room-e63f8713.webp
          caption: The Quiet Room — Maren Ekholm
        - image: /static/working-hours-b83bf6ae.webp
          caption: Working Hours — Tomas Reyes
  - component: Video
    props:
      eyebrow: Two minutes
      heading: How a Northlight book is made.
      video: https://www.youtube.com/watch?v=dQw4w9WgXcQ
      poster: /img/articles/reading-aloud.webp
      caption: From the manuscript to the shelf — the whole press, in two minutes.
  - component: Timeline
    props:
      eyebrow: The road ahead
      heading: What is coming.
      layout: columns
      items:
        - date: Now
          title: The library
          points: [Four books, Every chapter summarised, A quiz per chapter]
        - date: Autumn
          title: Read aloud
          points: [Every chapter spoken, A player in the book, Pick the pace]
        - date: Winter
          title: Two new books
          points: [The Long Table, Night Shift]
          upcoming: true
        - date: Spring
          title: The app
          points: [Offline reading, Your shelf in your pocket]
          upcoming: true
  - component: Timeline
    props:
      eyebrow: The press
      heading: How we got here.
      layout: list
      items:
        - date: '2021'
          title: The first book
          body: One title, printed on demand, sold from a table at the Saturday market.
        - date: '2022'
          title: A second, and a shop
          body: Working Hours joins Plain Words. A shop on the corner opens on Thursdays.
        - date: '2023'
          title: Online
          body: The library opens — read the first chapters free, keep the rest as a member.
        - date: 'Autumn'
          title: Read aloud
          body: Every chapter of every book, spoken.
          upcoming: true
  - component: Articles
    props:
      eyebrow: From the journal
      heading: Latest from the press.
      layout: featured
      limit: 3
      cta: All articles
  - component: Prose
    props:
      eyebrow: A note from the press
      heading: Why short books.
      body: |
        We publish short books because a short book gets read. Every title here can be finished in an evening and used for a year, and that is the whole editorial policy.

        A long book asks for a fortnight and gets a bookmark at page forty. A short one asks for a Sunday afternoon and gets finished — and a finished book changes something, because its argument is *whole* in the reader's head.

        > We would rather sell you one book you read than five you meant to.

        So: short books, read whole, kept for good.
      align: left
      measure: reading
  - component: Newsletter
    props:
      anchor: letter
      layout: card
      eyebrow: The Sunday letter
      heading: The next chapter, by email.
      lead: One letter a week, on Sunday — what we are reading, what we are printing, and a chapter to start.
      form: newsletter
      button: Subscribe
      fine: No spam, ever. Unsubscribe with one click.
      avatars:
        items:
          - name: Maya Chen
          - name: Ola Berg
          - name: Sam Reyes
          - name: Priya Nair
        line: Join **2,400** readers
  - component: Cta
    props:
      tone: ink
      layout: band
      eyebrow: Everything, for one price
      heading: Every book. Every chapter read aloud. *A coach when you want one.*
      lead: Nine dollars a month, and you can leave whenever you like.
      cta: See the pricing
      href: /pricing
      cta2: Read a chapter first
      href2: /content
      points:
        - icon: check
          text: Every book, whole
        - icon: check
          text: Cancel any time
        - icon: check
          text: Read on any device
      logos:
        - name: Bookshop
        - name: Blackwell's
        - name: Daunt
  - component: Cta
    props:
      layout: cards
      cards:
        - icon: users
          title: Join the readers
          body: People who finish books, talking about them — every Thursday at the shop, every day online.
          cta: Join
          href: /app
        - icon: mail
          title: Send us a manuscript
          body: Short, practical, finished. If it is one of those, we would like to read it.
          cta: Say hello
          href: /about
  - component: Cta
    props:
      layout: bar
      heading: The autumn list is out.
      lead: Two new books, and the print run is small.
      cta: See the list
      href: /store
  - component: Contact
    props:
      anchor: contact
      eyebrow: Contact
      heading: Say hello.
      lead: A question about an order, a manuscript you think we should read, or just a note.
      address: |
        Northlight Press
        14 Harbour Lane
        Bergen
      email: hello@northlight.example.com
      phone: +47 55 00 00 00
      hours: |
        Monday to Friday, 9 to 5
        The shop: Thursdays, 12 to 7
      map: https://maps.example.com/northlight
      mapLabel: Find the shop
      form: contact
  - component: Divider
    props:
      kind: ornament
  - component: Announcement
    props:
      badge: New
      text: The autumn list is out — **two new books**, and the print run is small.
      cta: See the list
      href: /store
      dismiss: false
  - component: Hero
    props:
      layout: centered
      tone: ink
      ground: aurora
      glow: visual
      eyebrow: A hero on the night
      lines: ['Read whole,', 'on a ^^phone^^.']
      sub: The same hero, centred, its visual a phone — a picture in a device, a floating card at each corner, the headline arriving word by word.
      cta: Get the app
      href: /content
      arrive: words
      visual:
        kind: phone
        image: /img/pages/library.webp
        alt: The library on a phone
      floats:
        - kind: stat
          at: tl
          value: '82%'
          line: finish the book
        - kind: chat
          at: br
          title: Mara
          line: Finished it on the train.
      badges:
        apple: 'https://apps.apple.com'
        google: 'https://play.google.com'
  - component: Features
    props:
      eyebrow: Features, turned over
      heading: The flip cards.
      variant: flip
      columns: 3
      items:
        - icon: book
          title: Read whole
          body: Turn the card
          image: /img/articles/first-hour.webp
        - icon: pen
          title: Keep
          body: Highlights that stay
          image: /img/articles/companion.webp
        - icon: headphones
          title: Listen
          body: Every chapter spoken
          image: /img/articles/reading-aloud.webp
  - component: Features
    props:
      tone: wash
      eyebrow: Around a picture
      heading: Six reasons, and the thing itself.
      variant: around
      image: /img/store/notebook-open.webp
      alt: The notebook, open
      items:
        - icon: sun
          title: The first hour
          body: One page a morning.
        - icon: pen
          title: Lies flat
          body: Sewn, not glued.
        - icon: leaf
          title: 100gsm paper
          body: Takes a fountain pen.
        - icon: bookmark
          title: A ribbon
          body: Your place, kept.
        - icon: shield
          title: A cover that lasts
          body: Cloth over board.
        - icon: gift
          title: Boxed
          body: Ready to give.
  - component: Stats
    props:
      eyebrow: Stats in serif
      heading: The numbers, counted up.
      layout: serif
      animate: true
      stats:
        - value: '12,000'
          label: copies sold
        - value: '82%'
          label: finish the book
        - value: '4.9'
          label: average rating
        - value: '11 min'
          label: a chapter
  - component: BeforeAfter
    props:
      eyebrow: Before and after
      heading: The same page, set twice.
      lead: Drag the handle — the manuscript on the left, the printed page on the right.
      before: /img/pages/editor.webp
      after: /img/pages/library.webp
      beforeLabel: The manuscript
      afterLabel: The page
      start: 45
      size: wide
  - component: Showcase
    props:
      eyebrow: A closer look
      heading: Everything in its place.
      layout: scroll
      device: browser
      side: right
      items:
        - icon: book
          title: Read
          body: Chapter by chapter, your place kept, the type set for a long sitting.
          image: /img/pages/library.webp
        - icon: pen
          title: Keep
          body: Highlights and notes, yours for good, wherever you open the book next.
          image: /img/pages/editor.webp
        - icon: headphones
          title: Listen
          body: Every chapter, spoken — for the walk, the train, the dishes.
          image: /img/pages/library.webp
  - component: Showcase
    props:
      tone: ink
      eyebrow: Tabbed
      heading: The same three, as tabs.
      layout: tabs
      device: phone
      side: left
      items:
        - icon: book
          title: Read
          body: Chapter by chapter, your place kept.
          image: /img/pages/library.webp
        - icon: pen
          title: Keep
          body: Highlights and notes, yours for good.
          image: /img/pages/editor.webp
        - icon: headphones
          title: Listen
          body: Every chapter, spoken.
          image: /img/pages/library.webp
  - component: Carousel
    props:
      eyebrow: A carousel
      heading: The autumn list, one at a time.
      layout: coverflow
      autoplay: 4
      items:
        - image: /img/articles/first-hour.webp
          title: The first hour
          body: A small daily practice
          href: /content
        - image: /img/articles/ten-minutes.webp
          title: Ten minutes
          body: Enough, if it is every day
        - image: /img/articles/companion.webp
          title: The companion
          body: What a summary is for
        - image: /img/articles/autumn-list.webp
          title: The autumn list
          body: Two new books
        - image: /img/articles/reading-aloud.webp
          title: Reading aloud
          body: Every chapter, spoken
  - component: Carousel
    props:
      tone: wash
      eyebrow: On an arc
      heading: Or fanned out.
      layout: arc
      items:
        - image: /img/articles/first-hour.webp
          title: The first hour
        - image: /img/articles/ten-minutes.webp
          title: Ten minutes
        - image: /img/articles/companion.webp
          title: The companion
        - image: /img/articles/autumn-list.webp
          title: The autumn list
        - image: /img/articles/reading-aloud.webp
          title: Reading aloud
  - component: Tabs
    props:
      eyebrow: Tabs
      heading: The particulars, one at a time.
      variant: underline
      items:
        - label: Overview
          icon: book
          body: Every book is 6 by 9 inches, 60 to 120 pages, printed on cream paper and bound to open flat.
        - label: Details
          icon: doc
          body: Sewn signatures, a cloth spine, endpapers in the season's colour. The e-book comes with every copy.
        - label: Shipping
          icon: globe
          body: Worldwide from the press. $5 in the US, $15 elsewhere, free over $40.
  - component: Testimonials
    props:
      eyebrow: As tweets
      heading: Said in public.
      layout: tweets
      items:
        - quote: Finished a @northlight book on one train ride and **bought the other three** at the station. This is how books should be.
          name: Mara Lindqvist
          handle: '@maralq'
        - quote: The first-hour notebook is the first I have kept past January. **One line** is the trick.
          name: Tom Okafor
          handle: '@tomokafor'
        - quote: Got three as gifts. All three people **have finished them**. When does that ever happen?
          name: June Park
          handle: '@junepark'
  - component: Testimonials
    props:
      tone: ink
      eyebrow: A stack
      heading: One on top of the other.
      layout: stack
      items:
        - quote: I have started a hundred books this year and **finished four**. All four were Northlight's.
          name: Mara Lindqvist
          role: Reads on the train
          stars: 5
        - quote: Arrived in two days, wrapped in paper. The book was **better than the wrapping**.
          name: June Park
          role: Bought three as gifts
          stars: 5
        - quote: The notebook is the first I have kept past January.
          name: Tom Okafor
          role: Keeps a notebook now
          stars: 5
  - component: Steps
    props:
      eyebrow: Steps, numbered
      heading: How a book gets made.
      layout: numbered
      items:
        - title: A manuscript arrives
          body: Short, and the shorter the better. We read it twice.
        - title: We cut it
          body: Whatever the reader does not need, they do not get.
        - title: We set it
          body: 6 by 9, cream paper, a cloth spine.
        - title: We print 500
          body: When they are gone, we print 500 more — or we do not.
  - component: Steps
    props:
      tone: wash
      eyebrow: Beside a screenshot
      heading: Three steps to a chapter.
      layout: beside
      device: laptop
      image: /img/pages/library.webp
      highlight: 1
      items:
        - title: Open the library
          body: Every book, the first chapter free.
        - title: Pick a book
          body: Short enough to finish tonight.
        - title: Read, or listen
          body: Your place kept, either way.
  - component: Pricing
    props:
      eyebrow: A choice list
      heading: Or pick one line.
      layout: choice
      tiers:
        - name: One book
          icon: book
          price: '$5'
          per: once
          cta: Buy
          href: /store
          features: ['The book, in print', 'The e-book with it', '- Every other book']
        - name: Member
          icon: star
          price: '$8'
          per: a month
          cta: Join
          href: /pricing
          featured: true
          features: ['Every book, online', 'A new one each season', 'The notebook at half price']
        - name: Patron
          icon: heart
          from: from
          price: '$20'
          per: a month
          cta: Join
          href: /pricing
          features: ['Everything in Member', 'Every book, in print, as it comes', 'Your name in the colophon']
  - component: FAQ
    props:
      eyebrow: With a mark
      heading: Questions, in two columns.
      layout: icons
      prefix: 'Q.'
      items:
        - question: How long is a book?
          answer: Sixty to a hundred and twenty pages. An evening.
        - question: Do I get the e-book?
          answer: With every printed copy, the moment you pay.
        - question: Where do you ship?
          answer: Everywhere. $5 in the US, $15 elsewhere, free over $40.
        - question: Can I return one?
          answer: Thirty days, no questions.
      more:
        heading: Still have questions?
        body: Write to us — a person answers.
        cta: Ask
        href: /about#contact
  - component: Team
    props:
      eyebrow: In mono
      heading: The press, and the shops that carry it.
      layout: mono
      people:
        - name: Ada Finch
          role: Editor
        - name: Maren Ekholm
          role: Editor
        - name: Tomas Reyes
          role: Typesetter
      logos:
        - name: Bookshop
        - name: Daunt
        - name: The Strand
  - component: Gallery
    props:
      eyebrow: Masonry
      heading: Pictures, as they are.
      layout: masonry
      filters: true
      items:
        - image: /img/articles/first-hour.webp
          caption: The first hour
          tag: Books
        - image: /img/store/notebook.webp
          caption: The notebook
          tag: Desk
        - image: /img/articles/autumn-list.webp
          caption: The autumn list
          tag: Books
        - image: /img/store/print.webp
          caption: The Working Hours print
          tag: Desk
        - image: /img/articles/reading-aloud.webp
          caption: Reading aloud
          tag: Books
        - image: /img/store/print.webp
          caption: On the press
          tag: Press
  - component: Gallery
    props:
      tone: wash
      eyebrow: A lookbook
      heading: The things, with prices.
      layout: lookbook
      columns: 3
      items:
        - image: /img/store/notebook.webp
          title: The first-hour notebook
          price: '$18'
          href: /store/products/notebook
        - image: /img/store/print.webp
          title: The Working Hours print
          price: '$22'
          href: /store/products/print
        - image: /img/store/books.webp
          title: The four books
          price: 'From $5'
          href: /store
  - component: Integrations
    props:
      eyebrow: Strewn about
      heading: Reads everywhere.
      layout: scatter
      items:
        - name: Kindle
          body: Send to it
        - name: Kobo
        - name: Apple Books
        - name: Readwise
          body: Highlights out
        - name: Notion
        - name: Obsidian
  - component: Contact
    props:
      layout: quote
      eyebrow: Beside a quote
      heading: Write to the press.
      form: contact
      quote:
        text: We answer every letter. Sometimes it takes a week; it is a small press.
        name: Ada Finch
        role: Editor
  - component: Countdown
    props:
      tone: ink
      glow: corner
      eyebrow: The launch
      heading: The winter list arrives in
      until: '2026-12-01T09:00'
      layout: centered
      cta: Reserve a copy
      href: /store
      over: It is here.
  - component: Cta
    props:
      layout: promo
      image: /img/store/print.webp
      alt: A book on the press
      heading: Buy two, and the third is half price.
      lead: On any three books in print, at the bag.
      from: From $5 a book
      cta: Shop the books
      href: /store
  - component: Footer
    props:
      layout: columns
      about: A small press for short, practical books.
      columns:
        - title: Read
          links:
            - label: The library
              href: /content
            - label: Pricing
              href: /pricing
        - title: The press
          links:
            - label: About
              href: /about
            - label: Contact
              href: /about#contact
      social:
        - label: Instagram
          href: https://instagram.com
        - label: X
          href: https://x.com
      legal: © {year} Northlight Press.
      small:
        - label: Privacy
          href: /privacy
        - label: Terms
          href: /terms
  - component: Close
    props:
      heading: Read the first chapter of any book, free.
      cta: Browse the library
      href: /content
---
