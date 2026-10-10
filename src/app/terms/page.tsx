// Terms of Use — Server-Side Rendered static page.
//
// Content copied VERBATIM from ~/workspace/dlala-040/js/terms.js
// (the TERMS map). The legacy page swaps language via a client
// switcher; this port renders all three languages (AR primary, FR, EN)
// so every word is preserved. No app-only features.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'شروط الاستخدام — دلالة DLALA',
  description: 'شروط استخدام موقع وتطبيق دلالة',
  openGraph: {
    type: 'website',
    siteName: 'DLALA',
    locale: 'ar_DZ',
    title: 'شروط الاستخدام — دلالة DLALA',
    description: 'شروط استخدام موقع وتطبيق دلالة',
    url: 'https://dzdlala.com/terms',
    images: ['https://dzdlala.com/icon-512.png'],
  },
  twitter: {
    card: 'summary',
    title: 'شروط الاستخدام — دلالة DLALA',
    description: 'شروط استخدام موقع وتطبيق دلالة',
    images: ['https://dzdlala.com/icon-512.png'],
  },
};

// Verbatim from js/terms.js — TERMS.ar / .fr / .en
const TERMS: Record<'ar' | 'fr' | 'en', string> = {
  ar: `<h2>شروط الاستخدام — دلالة</h2><p>آخر تحديث: سبتمبر 2026</p>
<p>بإنشائك حساباً على دلالة فأنت توافق على هذه الشروط.</p>
<h3>الخدمة</h3><p>دلالة سوق إعلانات مبوبة مجاني. نحن وسيط تقني فقط ولا نتدخل في المعاملات بين المستخدمين.</p>
<h3>حسابك</h3><ul>
<li>يجب أن تكون المعلومات المقدمة صحيحة.</li>
<li>أنت مسؤول عن الحفاظ على سرية بيانات دخولك.</li>
<li>يُمنع إنشاء حسابات وهمية أو متعددة للتحايل.</li></ul>
<h3>الإعلانات</h3><ul>
<li>يُمنع نشر إعلانات كاذبة أو مضللة أو مسروقة المحتوى.</li>
<li>يُمنع بيع المواد المحظورة قانوناً (أسلحة، مخدرات، سلع مسروقة...).</li>
<li>الصور يجب أن تكون لمنتجك الفعلي.</li>
<li>نحتفظ بحق إزالة أي إعلان مخالف دون إشعار مسبق.</li></ul>
<h3>السلوك</h3><p>يُمنع الاحتيال والمضايقة وخطاب الكراهية والرسائل المزعجة. المخالفات المتكررة تؤدي إلى حظر الحساب نهائياً.</p>
<h3>المسؤولية</h3><p>المعاملات تتم مباشرة بين المشتري والبائع على مسؤوليتهما. دلالة غير مسؤولة عن أي خسائر ناتجة عن استخدام المنصة.</p>
<h3>حذف الحساب</h3><p>يمكنك حذف حسابك نهائياً مع بياناتك في أي وقت من التطبيق.</p>`,
  fr: `<h2>Conditions d'utilisation — DLALA</h2><p>Dernière mise à jour : septembre 2026</p>
<p>En créant un compte sur DLALA, vous acceptez ces conditions.</p>
<h3>Le service</h3><p>DLALA est un marché d'annonces gratuites. Nous sommes un simple intermédiaire technique et n'intervenons pas dans les transactions entre utilisateurs.</p>
<h3>Votre compte</h3><ul>
<li>Les informations fournies doivent être exactes.</li>
<li>Vous êtes responsable de la confidentialité de vos identifiants.</li>
<li>Les comptes fictifs ou multiples pour contourner les règles sont interdits.</li></ul>
<h3>Les annonces</h3><ul>
<li>Les annonces fausses, trompeuses ou au contenu volé sont interdites.</li>
<li>La vente d'articles illégaux (armes, drogues, biens volés...) est interdite.</li>
<li>Les photos doivent montrer votre produit réel.</li>
<li>Nous pouvons retirer toute annonce non conforme sans préavis.</li></ul>
<h3>Comportement</h3><p>Fraude, harcèlement, discours haineux et spam sont interdits. Les récidives entraînent un bannissement définitif.</p>
<h3>Responsabilité</h3><p>Les transactions se font directement entre acheteur et vendeur, à leurs risques. DLALA n'est pas responsable des pertes liées à l'utilisation de la plateforme.</p>
<h3>Suppression du compte</h3><p>Vous pouvez supprimer définitivement votre compte et vos données à tout moment depuis l'application.</p>`,
  en: `<h2>Terms of Use — DLALA</h2><p>Last updated: September 2026</p>
<p>By creating a DLALA account you agree to these terms.</p>
<h3>The service</h3><p>DLALA is a free classifieds marketplace. We are a technical intermediary only and do not take part in transactions between users.</p>
<h3>Your account</h3><ul>
<li>Information you provide must be accurate.</li>
<li>You are responsible for keeping your credentials confidential.</li>
<li>Fake or multiple accounts to evade the rules are forbidden.</li></ul>
<h3>Listings</h3><ul>
<li>False, misleading, or stolen-content ads are forbidden.</li>
<li>Selling illegal items (weapons, drugs, stolen goods...) is forbidden.</li>
<li>Photos must show your actual product.</li>
<li>We may remove any non-compliant ad without prior notice.</li></ul>
<h3>Conduct</h3><p>Fraud, harassment, hate speech and spam are forbidden. Repeat offences lead to a permanent ban.</p>
<h3>Liability</h3><p>Transactions happen directly between buyer and seller at their own risk. DLALA is not liable for losses from using the platform.</p>
<h3>Account deletion</h3><p>You may permanently delete your account and data at any time from the app.</p>`,
};

const LEGAL_PROSE =
  '[&_h2]:text-xl [&_h2]:font-bold [&_h2]:mb-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_p]:mb-3 [&_p]:leading-7 [&_ul]:ps-6 [&_ul]:mb-3 [&_ul]:list-disc [&_li]:mb-1';


export default function TermsPage() {
  return (
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="sr-only">شروط الاستخدام</h1>
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <section lang="ar" dir="rtl">
            <div className={LEGAL_PROSE} dangerouslySetInnerHTML={{ __html: TERMS.ar }} />
          </section>
          <hr className="my-8 border-zinc-200" />
          <section lang="fr" dir="ltr">
            <div className={LEGAL_PROSE} dangerouslySetInnerHTML={{ __html: TERMS.fr }} />
          </section>
          <hr className="my-8 border-zinc-200" />
          <section lang="en" dir="ltr">
            <div className={LEGAL_PROSE} dangerouslySetInnerHTML={{ __html: TERMS.en }} />
          </section>
        </div>
      </main>
    </div>
  );
}
