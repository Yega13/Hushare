// Page furniture around the terms body, kept beside the content files for the same reason: it
// would otherwise be the last English left on a page meant to be readable.
export const CHROME: Record<string, { title: string; lastUpdated: string; intro: string; footer: string }> = {
  en: {
    title: 'Terms of Service',
    lastUpdated: 'Last updated',
    intro:
      'By using Hushare you agree to these terms. If you do not agree, please do not use Hushare. These terms are written in plain English on purpose - we want you to actually understand them.',
    footer: '- with love, from Yerevan',
  },
  ru: {
    title: 'Условия использования',
    lastUpdated: 'Последнее обновление',
    intro:
      'Пользуясь Hushare, вы соглашаетесь с этими условиями. Если вы с ними не согласны, пожалуйста, не пользуйтесь Hushare. Эти условия намеренно написаны простым языком — мы хотим, чтобы вы их действительно поняли.',
    footer: '— с любовью, из Еревана',
  },
  hy: {
    title: 'Օգտագործման պայմաններ',
    lastUpdated: 'Վերջին թարմացումը',
    intro:
      'Hushare-ից օգտվելով՝ դուք համաձայնվում եք այս պայմաններին։ Եթե համաձայն չեք, խնդրում ենք չօգտվել Hushare-ից։ Այս պայմանները դիտավորյալ գրված են պարզ լեզվով — ուզում ենք, որ դրանք իսկապես հասկանաք։',
    footer: '— սիրով, Երևանից',
  },
}
