// Demo data texts per locale. This is sample *user content*, not UI text:
// once seeded, everything here is editable inside the app.

const CONTENT = {
  sk: {
    users: { jana: 'Jana', peter: 'Peter', eva: 'Eva' },
    recipient: 'Mama',
    medMorning: 'ráno',
    medEvening: 'večer',
    cardioTitle: 'Kontrola u kardiológa',
    cardioLocation: 'Nemocnica, amb. 12',
    bloodTitle: 'Odber krvi',
    bloodLocation: 'Poliklinika, 2. poschodie',
    bloodTask: 'Odviezť mamu na odber',
    bloodRecord: 'Odber prebehol v poriadku, výsledky budú o týždeň.',
    shopTitle: 'Nákup liekov',
    shopNotes: 'Recept je v zásuvke v kuchyni.',
  },
  en: {
    users: { jana: 'Jana', peter: 'Peter', eva: 'Eva' },
    recipient: 'Mum',
    medMorning: 'morning',
    medEvening: 'evening',
    cardioTitle: 'Cardiology check-up',
    cardioLocation: 'Hospital, room 12',
    bloodTitle: 'Blood test',
    bloodLocation: 'Clinic, 2nd floor',
    bloodTask: 'Drive Mum to the blood test',
    bloodRecord: 'Blood test went fine, results in a week.',
    shopTitle: 'Buy medicines',
    shopNotes: 'The prescription is in the kitchen drawer.',
  },
  ru: {
    users: { jana: 'Яна', peter: 'Пётр', eva: 'Ева' },
    recipient: 'Мама',
    medMorning: 'утро',
    medEvening: 'вечер',
    cardioTitle: 'Приём у кардиолога',
    cardioLocation: 'Больница, кабинет 12',
    bloodTitle: 'Анализ крови',
    bloodLocation: 'Поликлиника, 2 этаж',
    bloodTask: 'Отвезти маму на анализ',
    bloodRecord: 'Анализ сдали, результаты через неделю.',
    shopTitle: 'Купить лекарства',
    shopNotes: 'Рецепт в ящике на кухне.',
  },
  ar: {
    users: { jana: 'يانا', peter: 'بيتر', eva: 'إيفا' },
    recipient: 'أمي',
    medMorning: 'صباحًا',
    medEvening: 'مساءً',
    cardioTitle: 'فحص عند طبيب القلب',
    cardioLocation: 'المستشفى، العيادة 12',
    bloodTitle: 'تحليل دم',
    bloodLocation: 'العيادة، الطابق الثاني',
    bloodTask: 'توصيل أمي إلى تحليل الدم',
    bloodRecord: 'تم التحليل بنجاح، النتائج بعد أسبوع.',
    shopTitle: 'شراء الأدوية',
    shopNotes: 'الوصفة في درج المطبخ.',
  },
  'zh-CN': {
    users: { jana: '雅娜', peter: '彼得', eva: '伊娃' },
    recipient: '妈妈',
    medMorning: '早上',
    medEvening: '晚上',
    cardioTitle: '心内科复查',
    cardioLocation: '医院 12 诊室',
    bloodTitle: '验血',
    bloodLocation: '门诊部二楼',
    bloodTask: '送妈妈去验血',
    bloodRecord: '验血顺利，一周后出结果。',
    shopTitle: '买药',
    shopNotes: '处方在厨房抽屉里。',
  },
};

export const SEED_LOCALES = Object.keys(CONTENT);

export function seedContent(locale) {
  return CONTENT[locale] ?? CONTENT.sk;
}
