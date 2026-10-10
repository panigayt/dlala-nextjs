// 0.0.0.1z: Algerian Darija price words (Zak, 21 Sep 2026).
// Verbatim port of ~/workspace/dlala-040/js/dz-price.js.
// Algerians count in centimes colloquially: 1,000 DZD = "100 ألف",
// 10,000 DZD = "مليون", 10,000,000 DZD = "مليار".
// Pure function — no DOM, no dependencies. Display-only: the stored value
// stays in DZD.
export function dzPriceWords(n: number): string {
  const v = Math.round(Number(n) || 0);
  if (v < 10) return ''; // 1 DZD = the "no price" convention — no words
  const parts: string[] = [];
  let r = v;
  const b = Math.floor(r / 10000000); r -= b * 10000000; // مليار
  const m = Math.floor(r / 10000);    r -= m * 10000;    // مليون
  const a = Math.floor(r / 10);       r -= a * 10;       // ألف
  const unit = (x: number, word: string) =>
    x === 1 ? word : x.toLocaleString('en-US') + ' ' + word;
  if (b) parts.push(unit(b, 'مليار'));
  if (m) parts.push(unit(m, 'مليون'));
  if (a) parts.push(unit(a, 'ألف'));
  // I-10: r is 1..9 DZD here = r*100 centimes — stay in the centime word
  // system ("سنتيم"), never print a "دج" tail inside a centime reading.
  if (r) parts.push((r * 100).toLocaleString('en-US') + ' سنتيم');
  return parts.join(' و ');
}
