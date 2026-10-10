// Conversations trilingual strings — verbatim from js/conversations.js
// CHAT_L10N (ar/fr/en) + js/i18n.{ar,fr,en}.js for the chrome keys
// (loading, errorGeneric, retry).
// Legacy lookup order parity: ct(key) = STRINGS[LANG] → CHAT_L10N[LANG] →
// CHAT_L10N.en → key.

import type { Lang } from '@/lib/i18n';

export const CONV_STRINGS: Record<Lang, Record<string, string>> = {
  ar: {
    announcementsNote: 'قناة الإعلانات — للقراءة فقط',
    announcementsTitle: 'إعلانات',
    back: 'رجوع',
    chatHidden: 'تم إخفاء المحادثة',
    deletedListing: 'إعلان محذوف',
    errorGeneric: 'حدث خطأ — حاول مجدداً',
    hideChat: 'إخفاء المحادثة',
    hideChatConfirm: 'إخفاء هذه المحادثة من قائمتك؟',
    loading: 'جارٍ التحميل...',
    messages: 'الرسائل',
    noConversations: 'لا توجد محادثات بعد',
    noConversationsHint: 'عندما تراسل بائعاً ستظهر محادثاتك هنا',
    photoLabel: 'صورة',
    proposalLabel: 'اقتراح سعر',
    retry: 'إعادة المحاولة',
    supportContact: 'اتصل بالدعم',
    supportTitle: 'دعم دلالة',
    undo: 'تراجع',
    unknownUser: 'مستخدم',
    viewListing: 'عرض الإعلان',
    you: 'أنت',
  },
  fr: {
    announcementsNote: "Canal d'annonces — lecture seule",
    announcementsTitle: 'Annonces',
    back: 'Retour',
    chatHidden: 'Conversation masquée',
    deletedListing: 'Annonce supprimée',
    errorGeneric: 'Une erreur est survenue — réessayez',
    hideChat: 'Masquer la conversation',
    hideChatConfirm: 'Masquer cette conversation de votre liste ?',
    loading: 'Chargement...',
    messages: 'Messages',
    noConversations: 'Aucune conversation',
    noConversationsHint: 'Vos discussions avec les vendeurs apparaîtront ici',
    photoLabel: 'Photo',
    proposalLabel: 'Proposition de prix',
    retry: 'Réessayer',
    supportContact: 'Contacter le support',
    supportTitle: 'Support Dlala',
    undo: 'Annuler',
    unknownUser: 'Utilisateur',
    viewListing: "Voir l'annonce",
    you: 'Vous',
  },
  en: {
    announcementsNote: 'Announcements channel — read only',
    announcementsTitle: 'Announcements',
    back: 'Back',
    chatHidden: 'Conversation hidden',
    deletedListing: 'Deleted listing',
    errorGeneric: 'Something went wrong — try again',
    hideChat: 'Hide conversation',
    hideChatConfirm: 'Hide this conversation from your list?',
    loading: 'Loading...',
    messages: 'Messages',
    noConversations: 'No conversations yet',
    noConversationsHint: 'Your chats with sellers will appear here',
    photoLabel: 'Photo',
    proposalLabel: 'Price proposal',
    retry: 'Try again',
    supportContact: 'Contact support',
    supportTitle: 'Dlala Support',
    undo: 'Undo',
    unknownUser: 'User',
    viewListing: 'View listing',
    you: 'You',
  },
};

// Legacy ct() parity: lang → en → key.
export function convSt(lang: Lang, key: string): string {
  return CONV_STRINGS[lang]?.[key] ?? CONV_STRINGS.en[key] ?? key;
}
