// Page furniture around the policy body: title, contents label, intro. Separate from the section
// content because it is short, shared, and would otherwise be the last thing left hardcoded in
// English on a page whose whole purpose is that people can read it.
export const CHROME: Record<string, { title: string; lastUpdated: string; contents: string; intro: string; footer: string }> = {
  en: {
    title: 'Privacy Policy',
    lastUpdated: 'Last updated',
    contents: 'Contents',
    intro:
      'Hushare ("we", "us") helps anyone create a shared photo album from a single link - no sign-up, no app. This policy explains exactly what we store, why we store it, and the rights you have over it. Where something here is a promise, we have tried to make sure the code actually keeps it.',
    footer: '- with love, from Yerevan',
  },
  ru: {
    title: 'Политика конфиденциальности',
    lastUpdated: 'Последнее обновление',
    contents: 'Содержание',
    intro:
      'Hushare («мы») помогает любому создать общий фотоальбом по одной ссылке — без регистрации и без приложения. Эта политика объясняет, что именно мы храним, почему храним и какие у вас есть права. Там, где здесь написано обещание, мы постарались, чтобы код действительно его выполнял.',
    footer: '— с любовью, из Еревана',
  },
  hy: {
    title: 'Գաղտնիության քաղաքականություն',
    lastUpdated: 'Վերջին թարմացումը',
    contents: 'Բովանդակություն',
    intro:
      'Hushare-ը («մենք») օգնում է ցանկացած մարդու մեկ հղումով ստեղծել ընդհանուր լուսանկարների ալբոմ՝ առանց գրանցման և առանց հավելվածի։ Այս քաղաքականությունը բացատրում է, թե կոնկրետ ինչ ենք պահում, ինչու ենք պահում և ինչ իրավունքներ ունեք դրա նկատմամբ։',
    footer: '— սիրով, Երևանից',
  },
}
