/* Product catalog — placeholder data & artwork until real photos are added.
   See ../README.md for the exact folder convention to swap in real photos. */

const CATEGORIES = [
  { id: "tote", name: "טוטים", tagline: "מרווחים ויומיומיים", icon: "🧺" },
  { id: "crossbody", name: "קרוסבאדי", tagline: "קלילים לכתף", icon: "👜" },
  { id: "clutch", name: "קלאצ'ים", tagline: "לערב ולאירוע", icon: "✨" },
  { id: "backpack", name: "תרמילי גב", tagline: "לשגרה נעה", icon: "🎒" },
  { id: "wallet", name: "ארנקים", tagline: "פרטי גימור קטנים", icon: "💳" },
];

const FRAME_COUNT = 12;

function framePaths(slug) {
  const frames = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    frames.push(`images/products/${slug}/360/frame-${String(i).padStart(2, "0")}.svg`);
  }
  return frames;
}

const PRODUCTS = [
  {
    slug: "tote-caramel",
    name: "טוט ‘כרמל’",
    category: "tote",
    price: 420,
    material: "עור פרה טבעי, עיבוד בגוון קרמל",
    badge: "עבודת יד",
    description:
      "טוט מרווח לשימוש יומיומי, נתפר בעבודת יד עם תפרי אוכף כפולים וידיות עור מחוזקות. מתאים למחשב נייד, פנקס ותיק החלפה.",
  },
  {
    slug: "tote-noir",
    name: "טוט ‘שחור לילה’",
    category: "tote",
    price: 460,
    material: "עור עגל מעובד, גימור מט",
    badge: "מהדורה מוגבלת",
    description:
      "גרסה עמוקה ומינימליסטית של הטוט הקלאסי שלנו — עור שחור מט עם פרטי חומרה בגוון זהב עתיק.",
  },
  {
    slug: "cross-tan",
    name: "קרוסבאדי ‘חוף’",
    category: "crossbody",
    price: 320,
    material: "עור זמש בגוון חול, רצועה מתכווננת",
    badge: "עבודת יד",
    description:
      "תיק צד קומפקטי עם רצועה ארוכה ומתכווננת, כניסה מהירה ותא פנימי לטלפון וארנק.",
  },
  {
    slug: "cross-burgundy",
    name: "קרוסבאדי ‘יין’",
    category: "crossbody",
    price: 340,
    material: "עור טבעי בגוון בורדו עמוק",
    badge: "צבע ייחודי",
    description:
      "גוון בורדו עשיר עם פרטי זהב, תיק צד אלגנטי שעובר בטבעיות מהיום ללילה.",
  },
  {
    slug: "clutch-gold",
    name: "קלאצ' ‘זהב שקיעה’",
    category: "clutch",
    price: 280,
    material: "עור מבריק בגימור מטאלי",
    badge: "לאירועים",
    description:
      "קלאצ' ערב קטן ומהודר עם שרשרת נשלפת, מתאים לחתונות ואירועים חגיגיים.",
  },
  {
    slug: "clutch-emerald",
    name: "קלאצ' ‘אזמרגד’",
    category: "clutch",
    price: 290,
    material: "עור טבעי בגוון ירוק עמוק, נצנצי זהב",
    badge: "עבודת יד",
    description:
      "גוון אזמרגד עשיר עם שרשרת עדינה בגימור זהב — פריט מרכזי לכל תלבושת ערב.",
  },
  {
    slug: "backpack-cognac",
    name: "תרמיל ‘קוניאק’",
    category: "backpack",
    price: 480,
    material: "עור עבה בגוון קוניאק, רצועות מתכווננות",
    badge: "עבודת יד",
    description:
      "תרמיל גב עמיד ליומיום, עם כיס קדמי, סגירת אבזם ורצועות גב מרופדות לנוחות מרבית.",
  },
  {
    slug: "wallet-mocha",
    name: "ארנק ‘מוקה’",
    category: "wallet",
    price: 140,
    material: "עור טבעי, תאי כרטיסים מרובים",
    badge: "מתנה מושלמת",
    description:
      "ארנק קומפקטי עם תאי כרטיסים, תא מטבעות ורוכסן — עיצוב נקי בגוון מוקה חם.",
  },
];

PRODUCTS.forEach((p) => {
  p.cover = `images/products/${p.slug}/cover.svg`;
  p.frames = framePaths(p.slug);
});
