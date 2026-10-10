'use client';

// Privacy policy — client shell on the app-wide language store.
//
// Legacy parity (~/workspace/dlala-040/js/privacy.js): renderPrivacy() injects
// ONLY PRIVACY[LANG], and onLangChange() re-renders when the header language
// switcher fires. Round 124: this page finally follows that contract — a
// header language switch re-renders the page in the chosen language
// (previously it stacked all three languages and ignored the switch).
//
// Content below is VERBATIM from js/privacy.js (PRIVACY.ar / .fr / .en).

import { useLang } from '@/lib/i18n';

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

// sr-only page title per language — byte-exact substrings of the <h2> titles above.
const H1: Record<'ar' | 'fr' | 'en', string> = {
  ar: 'سياسة الخصوصية — دلالة',
  fr: 'Politique de confidentialité — DLALA',
  en: 'Privacy Policy — DLALA',
};

const LEGAL_PROSE =
  '[&_h2]:text-xl [&_h2]:font-bold [&_h2]:mb-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_p]:mb-3 [&_p]:leading-7 [&_ul]:ps-6 [&_ul]:mb-3 [&_ul]:list-disc [&_li]:mb-1';

export default function PrivacyClient() {
  const { lang } = useLang();
  const rtl = lang === 'ar';
  return (
    <div className="min-h-screen bg-zinc-50" dir={rtl ? 'rtl' : 'ltr'}>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="sr-only">{H1[lang]}</h1>
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <section lang={lang} dir={rtl ? 'rtl' : 'ltr'}>
            <div className={LEGAL_PROSE} dangerouslySetInnerHTML={{ __html: PRIVACY[lang] }} />
          </section>
        </div>
      </main>
    </div>
  );
}
