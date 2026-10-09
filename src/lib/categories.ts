// 22 categories — generated from the Flutter app (lib/data/categories.dart).
// Mirrors ~/workspace/dlala-040/js/categories.js exactly.

export interface Category {
  id: string;
  ar: string;
  fr: string;
  en: string;
}

export const CATEGORIES: Category[] = [
  { id: 'phones', ar: 'هواتف', fr: 'Téléphones', en: 'Phones' },
  { id: 'cars', ar: 'سيارات', fr: 'Voitures', en: 'Cars' },
  { id: 'moto', ar: 'دراجات نارية', fr: 'Motos', en: 'Motorcycles' },
  { id: 'electronics', ar: 'إلكترونيات', fr: 'Électronique', en: 'Electronics' },
  { id: 'phone_acc', ar: 'إكسسوارات هواتف', fr: 'Accessoires téléphone', en: 'Phone accessories' },
  { id: 'realestate', ar: 'عقارات', fr: 'Immobilier', en: 'Real estate' },
  { id: 'furniture', ar: 'أثاث', fr: 'Meubles', en: 'Furniture' },
  { id: 'home', ar: 'المنزل', fr: 'Maison', en: 'Home' },
  { id: 'clothes', ar: 'ملابس', fr: 'Vêtements', en: 'Clothes' },
  { id: 'shoes', ar: 'أحذية', fr: 'Chaussures', en: 'Shoes' },
  { id: 'kids', ar: 'مستلزمات الأطفال', fr: 'Articles pour enfants', en: 'Kids’ items' },
  { id: 'sports', ar: 'رياضة', fr: 'Sport', en: 'Sports' },
  { id: 'velos', ar: 'دراجات هوائية', fr: 'Vélos', en: 'Bicycles' },
  { id: 'trottinettes', ar: 'تروتينات', fr: 'Trottinettes', en: 'Scooters' },
  { id: 'books', ar: 'كتب', fr: 'Livres', en: 'Books' },
  { id: 'animals', ar: 'حيوانات', fr: 'Animaux', en: 'Animals' },
  { id: 'services', ar: 'خدمات', fr: 'Services', en: 'Services' },
  { id: 'machines', ar: 'آلات ومعدات', fr: 'Machines et équipements', en: 'Machines & equipment' },
  { id: 'spareparts', ar: 'قطع غيار', fr: 'Pièces détachées', en: 'Spare parts' },
  { id: 'jobs', ar: 'وظائف', fr: 'Emploi', en: 'Jobs' },
  { id: 'beauty', ar: 'عطور وعناية وتجميل', fr: 'Parfum, soin et beauté', en: 'Perfume, care & beauty' },
  { id: 'other', ar: 'أخرى', fr: 'Autres', en: 'Other' },
];

export function catName(id: string, lang = 'ar'): string {
  const c = CATEGORIES.find((c) => c.id === id);
  if (!c) return id;
  return c[lang as keyof Category] || c.en;
}

// Darija price words — centime-based naming (Zak, 21 Sep 2026).
// 10,000,000 DZD = "مليار"; 10,000 DZD = "مليون"; 1,000 DZD = "100 ألف".
// Display-only; stored value stays in DZD.
// Mirrors ~/workspace/dlala-040/js/dz-price.js exactly.
export function dzPriceWords(n: number): string {
  const v = Math.round(Number(n) || 0);
  if (v < 10) return ''; // 1 DZD = the "no price" convention — no words
  const parts: string[] = [];
  let r = v;
  const b = Math.floor(r / 10000000);
  r -= b * 10000000;
  const m = Math.floor(r / 10000);
  r -= m * 10000;
  const a = Math.floor(r / 10);
  r -= a * 10;
  const unit = (x: number, word: string) =>
    x === 1 ? word : x.toLocaleString('en-US') + ' ' + word;
  if (b) parts.push(unit(b, 'مليار'));
  if (m) parts.push(unit(m, 'مليون'));
  if (a) parts.push(unit(a, 'ألف'));
  if (r) parts.push((r * 100).toLocaleString('en-US') + ' سنتيم');
  return parts.join(' و ');
}
