// Privacy policy — Server-Side Rendered static page.
//
// Content copied VERBATIM from ~/workspace/dlala-040/js/privacy.js
// (the PRIVACY map). The legacy page swaps language via a client
// switcher; this port renders all three languages (AR primary, FR, EN)
// so every word is preserved. No app-only features.

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية — دلالة DLALA',
  description: 'سياسة الخصوصية لتطبيق وموقع دلالة',
  openGraph: {
    type: 'website',
    siteName: 'DLALA',
    locale: 'ar_DZ',
    title: 'سياسة الخصوصية — دلالة DLALA',
    description: 'سياسة الخصوصية لتطبيق وموقع دلالة',
    url: 'https://dzdlala.com/privacy',
    images: ['https://dzdlala.com/icon-512.png'],
  },
  twitter: {
    card: 'summary',
    title: 'سياسة الخصوصية — دلالة DLALA',
    description: 'سياسة الخصوصية لتطبيق وموقع دلالة',
    images: ['https://dzdlala.com/icon-512.png'],
  },
};

// Verbatim from js/privacy.js — PRIVACY.ar / .fr / .en
const PRIVACY: Record<'ar' | 'fr' | 'en', string> = {
  ar: `<h2>سياسة الخصوصية — دلالة</h2><p>آخر تحديث: سبتمبر 2026</p>
<p>دلالة سوق إعلانات مبوبة مجاني موجه للمستخدمين في الجزائر.</p>
<h3>البيانات التي نجمعها</h3><ul>
<li>بيانات الحساب: الاسم، اسم المستخدم، البريد الإلكتروني.</li>
<li>محتوى الإعلانات: العناوين، الأوصاف، الصور، الأسعار، الولاية.</li>
<li>بيانات الاستخدام: المشاهدات والتفاعلات لتحسين الخدمة.</li></ul>
<h3>استخدام البيانات</h3><p>نستخدم بياناتك لتشغيل السوق: عرض الإعلانات، التواصل بين المشترين والبائعين، ومنع الاحتيال. لا نبيع بياناتك لأي طرف ثالث.</p>
<h3>مشاركة البيانات</h3><p>الإعلانات المنشورة عامة. رقم هاتفك لا يظهر إلا إذا شاركته بنفسك داخل محادثة.</p>
<h3>الأمان</h3><p>نستخدم Firebase من Google مع قواعد أمان صارمة وتشفير أثناء النقل.</p>
<h3>حقوقك</h3><p>يمكنك تعديل إعلاناتك وحذفها، وحذف حسابك نهائياً من التطبيق في أي وقت.</p>
<h3>اتصل بنا</h3><p>عبر قسم الدعم داخل التطبيق.</p>`,
  fr: `<h2>Politique de confidentialité — DLALA</h2><p>Dernière mise à jour : septembre 2026</p>
<p>DLALA est un marché d'annonces gratuites destiné aux utilisateurs en Algérie.</p>
<h3>Données collectées</h3><ul>
<li>Données du compte : nom, nom d'utilisateur, e-mail.</li>
<li>Contenu des annonces : titres, descriptions, photos, prix, wilaya.</li>
<li>Données d'usage : vues et interactions pour améliorer le service.</li></ul>
<h3>Utilisation</h3><p>Vos données servent au fonctionnement du marché : affichage des annonces, mise en relation acheteurs/vendeurs, lutte contre la fraude. Nous ne vendons jamais vos données.</p>
<h3>Partage</h3><p>Les annonces publiées sont publiques. Votre numéro n'apparaît que si vous le partagez vous-même dans une conversation.</p>
<h3>Sécurité</h3><p>Nous utilisons Firebase (Google) avec des règles de sécurité strictes et un chiffrement en transit.</p>
<h3>Vos droits</h3><p>Vous pouvez modifier ou supprimer vos annonces, et supprimer définitivement votre compte depuis l'application à tout moment.</p>
<h3>Contact</h3><p>Via la rubrique d'assistance dans l'application.</p>`,
  en: `<h2>Privacy Policy — DLALA</h2><p>Last updated: September 2026</p>
<p>DLALA is a free classifieds marketplace for users in Algeria.</p>
<h3>Data we collect</h3><ul>
<li>Account data: name, username, email.</li>
<li>Ad content: titles, descriptions, photos, prices, wilaya.</li>
<li>Usage data: views and interactions to improve the service.</li></ul>
<h3>Use</h3><p>Your data runs the marketplace: showing ads, connecting buyers and sellers, preventing fraud. We never sell your data.</p>
<h3>Sharing</h3><p>Published ads are public. Your phone number appears only if you share it yourself inside a conversation.</p>
<h3>Security</h3><p>We use Google Firebase with strict security rules and encryption in transit.</p>
<h3>Your rights</h3><p>You may edit or delete your ads, and permanently delete your account from the app at any time.</p>
<h3>Contact</h3><p>Through the in-app support section.</p>`,
};

const LEGAL_PROSE =
  '[&_h2]:text-xl [&_h2]:font-bold [&_h2]:mb-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_p]:mb-3 [&_p]:leading-7 [&_ul]:ps-6 [&_ul]:mb-3 [&_ul]:list-disc [&_li]:mb-1';

function Header() {
  return (
    <header className="sticky top-0 z-10 bg-emerald-700 text-white shadow">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold">
          دلالة
        </Link>
        <nav className="text-sm">سوق الجزائر للإعلانات المبوبة</nav>
      </div>
    </header>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="sr-only">الخصوصية</h1>
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <section lang="ar" dir="rtl">
            <div className={LEGAL_PROSE} dangerouslySetInnerHTML={{ __html: PRIVACY.ar }} />
          </section>
          <hr className="my-8 border-zinc-200" />
          <section lang="fr" dir="ltr">
            <div className={LEGAL_PROSE} dangerouslySetInnerHTML={{ __html: PRIVACY.fr }} />
          </section>
          <hr className="my-8 border-zinc-200" />
          <section lang="en" dir="ltr">
            <div className={LEGAL_PROSE} dangerouslySetInnerHTML={{ __html: PRIVACY.en }} />
          </section>
        </div>
      </main>
    </div>
  );
}
