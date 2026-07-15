import type { DictKey } from './en'

// Russian overrides. Any key omitted here falls back to English automatically.
export const ru: Partial<Record<DictKey, string>> = {
  'lang.label': 'Язык',

  'home.eyebrow': 'Без аккаунта · Без лишних хлопот',
  'home.title.line1': 'Каждый момент —',
  'home.title.line2': 'бережно сохранён',
  'home.subtitle': 'Создайте общий альбом, и любой сможет добавить фото по одной ссылке — без регистрации и без приложения.',
  'home.nameLabel': 'Название альбома',
  'home.namePlaceholder': 'напр. Свадьба Анны и Давида',
  'home.createBtn': 'Создать альбом',
  'home.creating': 'Создаём альбом…',
  'home.privateLinkNote': 'Вы получите личную ссылку для управления альбомом',
  'home.errorName': 'Пожалуйста, назовите альбом',
  'common.errorGeneric': 'Что-то пошло не так. Попробуйте ещё раз.',

  'myAlbums.title': 'Ваши альбомы на этом устройстве',
  'myAlbums.subtitle': 'Альбомы, созданные здесь. Нажмите, чтобы управлять — эти ссылки видны только вам.',
  'myAlbums.saved': 'сохранено: {n}',
  'myAlbums.manage': 'Управлять',
  'myAlbums.remove': 'Удалить',
}
